/**
 * KIỂM KÊ TÀI SẢN
 *
 *  Nháp ──bắt đầu──▶ Đang kiểm kê ──khoá số liệu──▶ Chờ duyệt ──duyệt──▶ Hoàn tất
 *    │ (chụp sổ sách theo phạm vi)   │ ◀──mở lại───────┘                  (ghi ngày kiểm kê,
 *    └────────────── huỷ ────────────┴──────────────────                  tình trạng vào hồ sơ)
 *
 *  - Quét mã (camera/máy quét/nhập tay) → đối chiếu sổ sách: Khớp · Sai vị trí · Khác tình trạng
 *    · Thiếu · Thừa · Chưa có hồ sơ.
 *  - Đồng bộ offline: thiết bị gửi lô lượt quét kèm `clientId` duy nhất → gửi lại bao nhiêu lần
 *    cũng không bị trùng (khoá (inventoryId, clientId)); lượt quét cũ hơn không ghi đè lượt mới.
 *  - Xử lý chênh lệch: tự lập chứng từ nháp (điều chuyển / thu hồi / cấp phát / báo mất / báo hỏng)
 *    — vẫn đi qua quy trình duyệt chứng từ như bình thường.
 */
import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, ilike, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import * as ExcelJS from 'exceljs';
import type { AccessContext } from '../../common/types/access-context';
import { buildPage } from '../../common/dto/query.dto';
import { DbService, type Executor } from '../../db/db.service';
import {
  assetCategories,
  assetEvents,
  assetInventories,
  assetInventoryItems,
  assetInventoryScans,
  assetLocations,
  assets,
  departments,
  notifications,
  permissions,
  printTemplates,
  rolePermissions,
  userRoles,
  users,
  type InventoryMember,
  type InventoryScope,
  type PrintDocument,
} from '../../db/schema';
import { renderPrintDocument } from '../../infra/rendering/pdf-renderer';
import { SettingsService } from '../settings/settings.service';
import { normalizeVN } from '../hsba/hsba.service';
import {
  ACTIVE_STATUSES,
  ASSET_CONDITION,
  ASSET_GROUP,
  ASSET_STATUS,
  CONDITION_RANK,
  INVENTORY_RESOLUTION,
  INVENTORY_RESULT,
  INVENTORY_STATUS,
} from './asset-constants';
import { defaultInventoryDocument, INVENTORY_TEMPLATE_CODE } from './asset-inventory-template';
import { AssetTransactionsService } from './asset-transactions.service';
import { AssetsService } from './assets.service';

type Item = typeof assetInventoryItems.$inferSelect;
type Inventory = typeof assetInventories.$inferSelect;

export interface ScanInput {
  clientId?: string;
  code: string;
  scannedAt?: string;
  method?: string;
  departmentId?: number | null;
  locationId?: number | null;
  condition?: string;
  note?: string;
}

export interface InventoryItemsQuery {
  q?: string;
  result?: string;
  checkState?: string;
  departmentId?: number;
  locationId?: number;
  expected?: string;
  page?: number;
  pageSize?: number;
  all?: boolean;
}

const fmt = (n: unknown) => Number(n ?? 0).toLocaleString('vi-VN', { maximumFractionDigits: 0 });
const vnDateTime = (d: Date | string | null | undefined) =>
  d ? new Date(d).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' }) : '';
const intArr = (ids: number[]) => sql`array[${sql.join(ids.map((i) => sql`${i}`), sql`, `)}]::int[]`;
const cleanIds = (v: unknown): number[] =>
  [...new Set((Array.isArray(v) ? v : String(v ?? '').split(',')).map((x) => Math.trunc(Number(x))).filter((n) => n > 0))];

/** Lấy mã từ nội dung QR (URL …/ts/<mã>) hoặc mã vạch thuần */
export function extractAssetCode(raw: string): string {
  const s = String(raw ?? '').trim();
  const m = s.match(/\/ts\/([^/?#\s]+)/);
  return (m ? decodeURIComponent(m[1]) : s).slice(0, 120);
}

/** Đối chiếu sổ sách ↔ thực tế cho một dòng kiểm kê */
export function inventoryResultOf(it: Pick<Item, 'expected' | 'assetId' | 'checkState' | 'actualDepartmentId' | 'bookDepartmentId' | 'actualLocationId' | 'bookLocationId' | 'actualCondition' | 'bookCondition'>): string {
  if (!it.expected) return it.assetId ? 'THUA' : 'KHONG_RO';
  if (it.checkState === 'CHUA_KIEM') return '';
  if (it.checkState === 'KHONG_THAY') return 'THIEU';
  if ((it.actualDepartmentId ?? null) !== (it.bookDepartmentId ?? null)) return 'SAI_VI_TRI';
  if (it.actualLocationId && it.bookLocationId && it.actualLocationId !== it.bookLocationId) return 'SAI_VI_TRI';
  if (it.actualCondition && it.bookCondition && it.actualCondition !== it.bookCondition) return 'SAI_TINH_TRANG';
  return 'KHOP';
}

@Injectable()
export class AssetInventoryService {
  private readonly logger = new Logger(AssetInventoryService.name);
  constructor(
    private readonly db: DbService,
    private readonly assetsService: AssetsService,
    private readonly txService: AssetTransactionsService,
    private readonly settings: SettingsService,
  ) {}

  meta() {
    return { statuses: INVENTORY_STATUS, results: INVENTORY_RESULT, resolutions: INVENTORY_RESOLUTION, conditions: ASSET_CONDITION, groups: ASSET_GROUP };
  }

  /* ------------------------------------------------------------ Quyền */
  private has(user: AccessContext, p: string) {
    return user.isSuperAdmin || user.permissions.includes(p);
  }
  canManage(user: AccessContext) {
    return this.has(user, 'asset.inventory.manage');
  }
  canApprove(user: AccessContext) {
    return this.has(user, 'asset.inventory.approve');
  }
  /** Người có liên quan tới đợt: quản lý, xem toàn viện, người lập, thành viên được phân công, khoa trong phạm vi */
  private isInvolved(user: AccessContext, inv: Inventory) {
    if (this.canManage(user) || this.canApprove(user) || this.assetsService.canSeeAll(user)) return true;
    if (inv.createdBy === user.id || (inv.memberIds ?? []).includes(user.id)) return true;
    const mine = this.assetsService.scopeDeptIds(user);
    const scopeDepts = inv.scope?.departmentIds ?? [];
    return scopeDepts.some((d) => mine.includes(d));
  }
  private canScan(user: AccessContext, inv: Inventory) {
    return (this.canManage(user) || this.has(user, 'asset.inventory.scan')) && this.isInvolved(user, inv);
  }
  private visibility(user: AccessContext): SQL | undefined {
    if (this.canManage(user) || this.canApprove(user) || this.assetsService.canSeeAll(user)) return undefined;
    const ids = this.assetsService.scopeDeptIds(user);
    const conds: SQL[] = [eq(assetInventories.createdBy, user.id), sql`${assetInventories.memberIds} @> array[${user.id}]::int[]`];
    if (ids.length) {
      conds.push(sql`exists (select 1 from jsonb_array_elements_text(coalesce(${assetInventories.scope}->'departmentIds', '[]'::jsonb)) d where d::int = any(${intArr(ids)}))`);
    }
    return or(...conds) as SQL;
  }

  private async load(id: number, executor: Executor = this.db.db): Promise<Inventory> {
    const [inv] = await executor.select().from(assetInventories).where(eq(assetInventories.id, id));
    if (!inv) throw new NotFoundException('Không tìm thấy đợt kiểm kê');
    return inv;
  }
  private async loadFor(id: number, user: AccessContext, statuses?: string[]) {
    const inv = await this.load(id);
    if (!this.isInvolved(user, inv)) throw new ForbiddenException('Bạn không tham gia đợt kiểm kê này');
    if (statuses && !statuses.includes(inv.status)) {
      throw new ConflictException(`Đợt kiểm kê đang "${INVENTORY_STATUS[inv.status]?.label ?? inv.status}" — không thực hiện được thao tác này`);
    }
    return inv;
  }

  /* ------------------------------------------------------------ Phạm vi → điều kiện tài sản */
  private cleanScope(v: unknown): InventoryScope {
    const s = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
    return {
      departmentIds: cleanIds(s.departmentIds),
      locationIds: cleanIds(s.locationIds),
      categoryIds: cleanIds(s.categoryIds),
      groups: (Array.isArray(s.groups) ? s.groups : []).map(String).filter((g) => ASSET_GROUP[g]),
      includeStore: s.includeStore === undefined ? true : Boolean(s.includeStore),
    };
  }

  private scopeWhere(scope: InventoryScope): SQL[] {
    const w: SQL[] = [isNull(assets.deletedAt), inArray(assets.status, ACTIVE_STATUSES as never[])];
    const depts = scope.departmentIds ?? [];
    if (depts.length) w.push((scope.includeStore ? or(inArray(assets.departmentId, depts), isNull(assets.departmentId)) : inArray(assets.departmentId, depts)) as SQL);
    else if (scope.includeStore === false) w.push(sql`${assets.departmentId} is not null`);
    const locs = scope.locationIds ?? [];
    if (locs.length) {
      w.push(sql`${assets.locationId} in (select l.id from ${assetLocations} l join ${assetLocations} p on l.path like p.path || '%' where p.id = any(${intArr(locs)}))`);
    }
    const cats = scope.categoryIds ?? [];
    if (cats.length) {
      w.push(sql`${assets.categoryId} in (select c.id from ${assetCategories} c join ${assetCategories} p on c.path like p.path || '%' where p.id = any(${intArr(cats)}))`);
    }
    if (scope.groups?.length) w.push(sql`${assets.categoryId} in (select id from ${assetCategories} where group_code in (${sql.join(scope.groups.map((g) => sql`${g}`), sql`, `)}))`);
    return w;
  }

  /** Người không xem toàn viện chỉ được kiểm kê trong khoa của mình */
  private assertScopeAllowed(scope: InventoryScope, user: AccessContext) {
    if (this.assetsService.canSeeAll(user)) return;
    const mine = this.assetsService.scopeDeptIds(user);
    const depts = scope.departmentIds ?? [];
    if (!depts.length || depts.some((d) => !mine.includes(d))) {
      throw new ForbiddenException('Bạn chỉ lập được đợt kiểm kê cho khoa/phòng thuộc phạm vi của mình');
    }
  }

  async scopePreview(body: Record<string, unknown>, user: AccessContext) {
    const scope = this.cleanScope(body.scope ?? body);
    const [r] = await this.db.db
      .select({
        count: sql<number>`count(*)::int`,
        cost: sql<number>`coalesce(sum(${assets.originalCost}), 0)::float8`,
        bookValue: sql<number>`coalesce(sum(${this.assetsService.bookValueExpr}), 0)::float8`,
        departments: sql<number>`count(distinct ${assets.departmentId})::int`,
        store: sql<number>`count(*) filter (where ${assets.departmentId} is null)::int`,
      })
      .from(assets)
      .where(and(...this.scopeWhere(scope)));
    void user;
    return r;
  }

  /* ------------------------------------------------------------ Danh sách / chi tiết */
  private statsSql(ids: number[]) {
    return this.db.db
      .select({
        inventoryId: assetInventoryItems.inventoryId,
        expected: sql<number>`count(*) filter (where ${assetInventoryItems.expected})::int`,
        checked: sql<number>`count(*) filter (where ${assetInventoryItems.expected} and ${assetInventoryItems.checkState} <> 'CHUA_KIEM')::int`,
        found: sql<number>`count(*) filter (where ${assetInventoryItems.checkState} = 'CO')::int`,
        pending: sql<number>`count(*) filter (where ${assetInventoryItems.expected} and ${assetInventoryItems.checkState} = 'CHUA_KIEM')::int`,
        KHOP: sql<number>`count(*) filter (where ${assetInventoryItems.result} = 'KHOP')::int`,
        SAI_VI_TRI: sql<number>`count(*) filter (where ${assetInventoryItems.result} = 'SAI_VI_TRI')::int`,
        SAI_TINH_TRANG: sql<number>`count(*) filter (where ${assetInventoryItems.result} = 'SAI_TINH_TRANG')::int`,
        THIEU: sql<number>`count(*) filter (where ${assetInventoryItems.result} = 'THIEU')::int`,
        THUA: sql<number>`count(*) filter (where ${assetInventoryItems.result} = 'THUA')::int`,
        KHONG_RO: sql<number>`count(*) filter (where ${assetInventoryItems.result} = 'KHONG_RO')::int`,
        expectedCost: sql<number>`coalesce(sum(${assetInventoryItems.bookCost}) filter (where ${assetInventoryItems.expected}), 0)::float8`,
        foundCost: sql<number>`coalesce(sum(${assetInventoryItems.bookCost}) filter (where ${assetInventoryItems.expected} and ${assetInventoryItems.checkState} = 'CO'), 0)::float8`,
        missingCost: sql<number>`coalesce(sum(${assetInventoryItems.bookCost}) filter (where ${assetInventoryItems.result} = 'THIEU'), 0)::float8`,
        missingValue: sql<number>`coalesce(sum(${assetInventoryItems.bookValue}) filter (where ${assetInventoryItems.result} = 'THIEU'), 0)::float8`,
        extraCost: sql<number>`coalesce(sum(${assetInventoryItems.bookCost}) filter (where not ${assetInventoryItems.expected}), 0)::float8`,
        unresolved: sql<number>`count(*) filter (where ${assetInventoryItems.result} in ('SAI_VI_TRI','THIEU','THUA','KHONG_RO','SAI_TINH_TRANG') and ${assetInventoryItems.resolution} = '')::int`,
        lastScanAt: sql<string | null>`max(${assetInventoryItems.checkedAt})`,
      })
      .from(assetInventoryItems)
      .where(inArray(assetInventoryItems.inventoryId, ids.length ? ids : [0]))
      .groupBy(assetInventoryItems.inventoryId);
  }

  private emptyStats() {
    return {
      expected: 0, checked: 0, found: 0, pending: 0, KHOP: 0, SAI_VI_TRI: 0, SAI_TINH_TRANG: 0, THIEU: 0, THUA: 0, KHONG_RO: 0,
      expectedCost: 0, foundCost: 0, missingCost: 0, missingValue: 0, extraCost: 0, unresolved: 0, lastScanAt: null as string | null,
    };
  }

  async list(query: { q?: string; status?: string; page?: number; pageSize?: number }, user: AccessContext) {
    const w: SQL[] = [];
    const vis = this.visibility(user);
    if (vis) w.push(vis);
    if (query.status) w.push(inArray(assetInventories.status, String(query.status).split(',').filter(Boolean)));
    if (query.q?.trim()) w.push(or(ilike(assetInventories.code, `%${query.q.trim()}%`), ilike(assetInventories.name, `%${query.q.trim()}%`)) as SQL);
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(query.pageSize) || 20));
    const where = w.length ? and(...w) : undefined;
    const [rows, [{ total }], counts] = await Promise.all([
      this.db.db.select().from(assetInventories).where(where).orderBy(desc(assetInventories.id)).limit(pageSize).offset((page - 1) * pageSize),
      this.db.db.select({ total: sql<number>`count(*)::int` }).from(assetInventories).where(where),
      this.db.db
        .select({ status: assetInventories.status, n: sql<number>`count(*)::int` })
        .from(assetInventories)
        .where(vis)
        .groupBy(assetInventories.status),
    ]);
    const stats = await this.statsSql(rows.map((r) => r.id));
    const byId = new Map(stats.map((s) => [s.inventoryId, s]));
    const deptNames = await this.deptNames(rows.flatMap((r) => r.scope?.departmentIds ?? []));
    const items = rows.map((r) => ({
      ...r,
      statusLabel: INVENTORY_STATUS[r.status]?.label ?? r.status,
      scopeText: this.scopeText(r.scope, deptNames),
      stats: byId.get(r.id) ?? this.emptyStats(),
      can: this.actions(r, user),
    }));
    return { ...buildPage(items, total, page, pageSize), counts: Object.fromEntries(counts.map((c) => [c.status, c.n])) };
  }

  private async deptNames(ids: number[]) {
    const uniq = [...new Set(ids)];
    if (!uniq.length) return new Map<number, string>();
    const rows = await this.db.db.select({ id: departments.id, name: departments.name }).from(departments).where(inArray(departments.id, uniq));
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  private scopeText(scope: InventoryScope, deptNames: Map<number, string>, extra?: { locations?: Map<number, string>; categories?: Map<number, string> }) {
    const parts: string[] = [];
    const d = scope?.departmentIds ?? [];
    parts.push(d.length ? d.map((i) => deptNames.get(i) ?? `#${i}`).join(', ') + (scope.includeStore ? ' + kho' : '') : scope?.includeStore === false ? 'Toàn viện (không gồm kho)' : 'Toàn viện');
    if (scope?.locationIds?.length) parts.push('Vị trí: ' + scope.locationIds.map((i) => extra?.locations?.get(i) ?? `#${i}`).join(', '));
    if (scope?.categoryIds?.length) parts.push('Loại: ' + scope.categoryIds.map((i) => extra?.categories?.get(i) ?? `#${i}`).join(', '));
    if (scope?.groups?.length) parts.push('Nhóm: ' + scope.groups.map((g) => ASSET_GROUP[g] ?? g).join(', '));
    return parts.join(' · ');
  }

  private actions(inv: Inventory, user: AccessContext) {
    const manage = this.canManage(user);
    return {
      edit: manage && ['NHAP', 'DANG_KIEM_KE'].includes(inv.status),
      start: manage && inv.status === 'NHAP',
      scan: inv.status === 'DANG_KIEM_KE' && this.canScan(user, inv),
      finish: manage && inv.status === 'DANG_KIEM_KE',
      reopen: manage && inv.status === 'CHO_DUYET',
      resolve: manage && ['CHO_DUYET', 'HOAN_TAT'].includes(inv.status),
      complete: this.canApprove(user) && inv.status === 'CHO_DUYET',
      cancel: manage && ['NHAP', 'DANG_KIEM_KE', 'CHO_DUYET'].includes(inv.status),
      remove: manage && inv.status === 'NHAP',
      seeExpected: !inv.blind || manage || this.canApprove(user),
    };
  }

  async detail(id: number, user: AccessContext) {
    const inv = await this.loadFor(id, user);
    const [stats] = await this.statsSql([id]);
    const bd = alias(departments, 'bd');
    const byDept = await this.db.db
      .select({
        departmentId: assetInventoryItems.bookDepartmentId,
        departmentName: bd.name,
        expected: sql<number>`count(*) filter (where ${assetInventoryItems.expected})::int`,
        checked: sql<number>`count(*) filter (where ${assetInventoryItems.expected} and ${assetInventoryItems.checkState} <> 'CHUA_KIEM')::int`,
        found: sql<number>`count(*) filter (where ${assetInventoryItems.checkState} = 'CO')::int`,
        missing: sql<number>`count(*) filter (where ${assetInventoryItems.result} = 'THIEU')::int`,
        misplaced: sql<number>`count(*) filter (where ${assetInventoryItems.result} = 'SAI_VI_TRI')::int`,
        extra: sql<number>`count(*) filter (where ${assetInventoryItems.result} in ('THUA','KHONG_RO'))::int`,
        cost: sql<number>`coalesce(sum(${assetInventoryItems.bookCost}) filter (where ${assetInventoryItems.expected}), 0)::float8`,
      })
      .from(assetInventoryItems)
      .leftJoin(bd, eq(bd.id, assetInventoryItems.bookDepartmentId))
      .where(eq(assetInventoryItems.inventoryId, id))
      .groupBy(assetInventoryItems.bookDepartmentId, bd.name)
      .orderBy(asc(bd.name));
    const scanners = await this.db.db
      .select({ userId: assetInventoryScans.userId, userName: assetInventoryScans.userName, n: sql<number>`count(*)::int`, last: sql<string>`max(${assetInventoryScans.scannedAt})` })
      .from(assetInventoryScans)
      .where(eq(assetInventoryScans.inventoryId, id))
      .groupBy(assetInventoryScans.userId, assetInventoryScans.userName)
      .orderBy(desc(sql`count(*)`));
    const recent = await this.db.db
      .select({
        id: assetInventoryScans.id, code: assetInventoryScans.code, outcome: assetInventoryScans.outcome, userName: assetInventoryScans.userName,
        scannedAt: assetInventoryScans.scannedAt, method: assetInventoryScans.method, assetName: assets.name, assetId: assetInventoryItems.assetId,
      })
      .from(assetInventoryScans)
      .leftJoin(assetInventoryItems, eq(assetInventoryItems.id, assetInventoryScans.itemId))
      .leftJoin(assets, eq(assets.id, assetInventoryItems.assetId))
      .where(eq(assetInventoryScans.inventoryId, id))
      .orderBy(desc(assetInventoryScans.scannedAt))
      .limit(15);
    const [dn, locs, cats, memberRows] = await Promise.all([
      this.deptNames(inv.scope?.departmentIds ?? []),
      inv.scope?.locationIds?.length ? this.db.db.select({ id: assetLocations.id, name: assetLocations.name }).from(assetLocations).where(inArray(assetLocations.id, inv.scope.locationIds)) : [],
      inv.scope?.categoryIds?.length ? this.db.db.select({ id: assetCategories.id, name: assetCategories.name }).from(assetCategories).where(inArray(assetCategories.id, inv.scope.categoryIds)) : [],
      inv.memberIds?.length ? this.db.db.select({ id: users.id, fullName: users.fullName, username: users.username }).from(users).where(inArray(users.id, inv.memberIds)) : [],
    ]);
    const can = this.actions(inv, user);
    return {
      ...inv,
      statusLabel: INVENTORY_STATUS[inv.status]?.label ?? inv.status,
      scopeText: this.scopeText(inv.scope, dn, { locations: new Map(locs.map((l) => [l.id, l.name])), categories: new Map(cats.map((c) => [c.id, c.name])) }),
      members: memberRows,
      stats: can.seeExpected ? stats ?? this.emptyStats() : { ...this.emptyStats(), found: stats?.found ?? 0, THUA: stats?.THUA ?? 0, KHONG_RO: stats?.KHONG_RO ?? 0 },
      byDepartment: can.seeExpected ? byDept : [],
      scanners,
      recent,
      can,
    };
  }

  async items(id: number, query: InventoryItemsQuery, user: AccessContext) {
    const inv = await this.loadFor(id, user);
    const can = this.actions(inv, user);
    const bd = alias(departments, 'bd');
    const ad = alias(departments, 'ad');
    const bl = alias(assetLocations, 'bl');
    const al = alias(assetLocations, 'al');
    const w: SQL[] = [eq(assetInventoryItems.inventoryId, id)];
    // Kiểm kê "mù": người quét chỉ thấy những gì mình/đội đã quét
    if (!can.seeExpected) w.push(sql`${assetInventoryItems.checkState} <> 'CHUA_KIEM'`);
    if (query.result) {
      const list = String(query.result).split(',').filter(Boolean);
      w.push(list.includes('PENDING') ? (or(eq(assetInventoryItems.result, ''), inArray(assetInventoryItems.result, list)) as SQL) : inArray(assetInventoryItems.result, list));
    }
    if (query.checkState) w.push(eq(assetInventoryItems.checkState, query.checkState));
    if (query.expected === 'true' || query.expected === 'false') w.push(eq(assetInventoryItems.expected, query.expected === 'true'));
    if (query.departmentId) w.push(Number(query.departmentId) === -1 ? isNull(assetInventoryItems.bookDepartmentId) : eq(assetInventoryItems.bookDepartmentId, Number(query.departmentId)));
    if (query.locationId) w.push(eq(assetInventoryItems.bookLocationId, Number(query.locationId)));
    const kw = query.q?.trim();
    if (kw) {
      w.push(or(ilike(assets.code, `%${kw}%`), ilike(assetInventoryItems.scannedCode, `%${kw}%`), ilike(assets.serialNumber, `%${kw}%`), sql`${assets.searchText} like ${`%${normalizeVN(kw)}%`}`) as SQL);
    }
    const where = and(...w);
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = query.all ? 20000 : Math.min(500, Math.max(1, Number(query.pageSize) || 50));
    const base = this.db.db
      .select({
        id: assetInventoryItems.id,
        assetId: assetInventoryItems.assetId,
        code: sql<string>`coalesce(${assets.code}, ${assetInventoryItems.scannedCode})`,
        barcode: assets.barcode,
        name: sql<string>`coalesce(${assets.name}, '(Chưa có hồ sơ)')`,
        model: assets.model,
        serialNumber: assets.serialNumber,
        unit: assets.unit,
        currentStatus: assets.status,
        expected: assetInventoryItems.expected,
        scannedCode: assetInventoryItems.scannedCode,
        bookDepartmentId: assetInventoryItems.bookDepartmentId,
        bookDepartmentName: bd.name,
        bookLocationId: assetInventoryItems.bookLocationId,
        bookLocationName: bl.name,
        bookCustodianName: assetInventoryItems.bookCustodianName,
        bookStatus: assetInventoryItems.bookStatus,
        bookCondition: assetInventoryItems.bookCondition,
        bookCost: assetInventoryItems.bookCost,
        bookValue: assetInventoryItems.bookValue,
        checkState: assetInventoryItems.checkState,
        actualDepartmentId: assetInventoryItems.actualDepartmentId,
        actualDepartmentName: ad.name,
        actualLocationId: assetInventoryItems.actualLocationId,
        actualLocationName: al.name,
        actualCondition: assetInventoryItems.actualCondition,
        result: assetInventoryItems.result,
        scanCount: assetInventoryItems.scanCount,
        method: assetInventoryItems.method,
        checkedAt: assetInventoryItems.checkedAt,
        checkedByName: assetInventoryItems.checkedByName,
        note: assetInventoryItems.note,
        resolution: assetInventoryItems.resolution,
        resolutionTxId: assetInventoryItems.resolutionTxId,
      })
      .from(assetInventoryItems)
      .leftJoin(assets, eq(assets.id, assetInventoryItems.assetId))
      .leftJoin(bd, eq(bd.id, assetInventoryItems.bookDepartmentId))
      .leftJoin(ad, eq(ad.id, assetInventoryItems.actualDepartmentId))
      .leftJoin(bl, eq(bl.id, assetInventoryItems.bookLocationId))
      .leftJoin(al, eq(al.id, assetInventoryItems.actualLocationId));
    const [rows, [{ total }]] = await Promise.all([
      base
        .where(where)
        .orderBy(sql`case ${assetInventoryItems.result} when 'THIEU' then 0 when 'KHONG_RO' then 1 when 'THUA' then 2 when 'SAI_VI_TRI' then 3 when 'SAI_TINH_TRANG' then 4 when '' then 5 else 6 end`, asc(bd.name), asc(sql`coalesce(${assets.code}, ${assetInventoryItems.scannedCode})`))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      this.db.db
        .select({ total: sql<number>`count(*)::int` })
        .from(assetInventoryItems)
        .leftJoin(assets, eq(assets.id, assetInventoryItems.assetId))
        .where(where),
    ]);
    return buildPage(rows, total, page, pageSize);
  }

  /* ------------------------------------------------------------ Lập / sửa */
  private cleanCommittee(v: unknown): InventoryMember[] {
    return (Array.isArray(v) ? v : [])
      .map((m) => (m && typeof m === 'object' ? (m as Record<string, unknown>) : {}))
      .map((m) => ({ name: String(m.name ?? '').trim(), position: String(m.position ?? '').trim(), role: String(m.role ?? '').trim() }))
      .filter((m) => m.name)
      .slice(0, 30);
  }

  private async nextCode(tx: Executor) {
    const y = new Date(Date.now() + 7 * 3600_000).getUTCFullYear();
    const head = `KK-${y}-`;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('asset_inv_code'), ${y})`);
    const [r] = await tx
      .execute<{ n: number }>(sql`select coalesce(max(nullif(regexp_replace(substr(code, ${head.length + 1}), '\\D', '', 'g'), '')::int), 0) as n from ${assetInventories} where code like ${head + '%'}`)
      .then((x) => x.rows);
    return `${head}${String(Number(r?.n ?? 0) + 1).padStart(3, '0')}`;
  }

  private header(body: Record<string, unknown>, partial = false) {
    const h: Partial<typeof assetInventories.$inferInsert> = {};
    const has = (k: string) => !partial || k in body;
    if (has('name')) {
      h.name = String(body.name ?? '').trim();
      if (!h.name) throw new BadRequestException('Chưa nhập tên đợt kiểm kê');
    }
    if (has('plannedDate')) {
      const d = String(body.plannedDate ?? '').trim();
      if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new BadRequestException('Ngày kiểm kê không hợp lệ');
      h.plannedDate = d || null;
    }
    if (has('decisionNo')) h.decisionNo = String(body.decisionNo ?? '').trim();
    if (has('note')) h.note = String(body.note ?? '').trim();
    if (has('committee')) h.committee = this.cleanCommittee(body.committee);
    if (has('memberIds')) h.memberIds = cleanIds(body.memberIds);
    if (has('blind')) h.blind = Boolean(body.blind);
    if (has('conclusion')) h.conclusion = String(body.conclusion ?? '').trim();
    return h;
  }

  async create(body: Record<string, unknown>, user: AccessContext) {
    const scope = this.cleanScope(body.scope);
    this.assertScopeAllowed(scope, user);
    const h = this.header(body);
    const id = await this.db.db.transaction(async (tx) => {
      const code = await this.nextCode(tx);
      const [row] = await tx
        .insert(assetInventories)
        .values({ ...(h as typeof assetInventories.$inferInsert), code, name: h.name!, scope, status: 'NHAP', createdBy: user.id, createdByName: user.fullName })
        .returning({ id: assetInventories.id });
      return row.id;
    });
    if (body.start) return this.start(id, user);
    return this.detail(id, user);
  }

  async update(id: number, body: Record<string, unknown>, user: AccessContext) {
    const inv = await this.loadFor(id, user, ['NHAP', 'DANG_KIEM_KE', 'CHO_DUYET']);
    const h = this.header(body, true);
    const patch: Partial<typeof assetInventories.$inferInsert> = { ...h, updatedAt: new Date() };
    if ('scope' in body) {
      if (inv.status !== 'NHAP') throw new ConflictException('Đã chốt sổ sách — không đổi được phạm vi kiểm kê (huỷ và lập đợt mới nếu cần)');
      patch.scope = this.cleanScope(body.scope);
      this.assertScopeAllowed(patch.scope, user);
    }
    if (inv.status === 'CHO_DUYET') {
      // Chờ duyệt: chỉ còn sửa kết luận / hội đồng / ghi chú
      for (const k of Object.keys(patch)) if (!['conclusion', 'committee', 'note', 'decisionNo', 'updatedAt'].includes(k)) delete (patch as Record<string, unknown>)[k];
    }
    await this.db.db.update(assetInventories).set(patch).where(eq(assetInventories.id, id));
    return this.detail(id, user);
  }

  async remove(id: number, user: AccessContext) {
    await this.loadFor(id, user, ['NHAP']);
    await this.db.db.delete(assetInventories).where(eq(assetInventories.id, id));
    return { id };
  }

  /* ------------------------------------------------------------ Bắt đầu: chụp sổ sách */
  async start(id: number, user: AccessContext) {
    const inv = await this.loadFor(id, user, ['NHAP']);
    const count = await this.db.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('asset_inv'), ${id})`);
      const [cur] = await tx.select({ status: assetInventories.status }).from(assetInventories).where(eq(assetInventories.id, id));
      if (cur?.status !== 'NHAP') throw new ConflictException('Đợt kiểm kê đã được bắt đầu');
      const rows = await tx
        .select({
          id: assets.id, departmentId: assets.departmentId, locationId: assets.locationId, custodianName: assets.custodianName,
          status: assets.status, condition: assets.condition, originalCost: assets.originalCost, bookValue: this.assetsService.bookValueExpr,
        })
        .from(assets)
        .where(and(...this.scopeWhere(inv.scope)));
      if (!rows.length) throw new BadRequestException('Phạm vi kiểm kê không có tài sản nào đang theo dõi');
      for (let i = 0; i < rows.length; i += 1000) {
        await tx.insert(assetInventoryItems).values(
          rows.slice(i, i + 1000).map((a) => ({
            inventoryId: id, assetId: a.id, expected: true, bookDepartmentId: a.departmentId, bookLocationId: a.locationId,
            bookCustodianName: a.custodianName, bookStatus: a.status, bookCondition: a.condition, bookCost: a.originalCost, bookValue: Number(a.bookValue),
          })),
        );
      }
      await tx.update(assetInventories).set({ status: 'DANG_KIEM_KE', snapshotAt: new Date(), updatedAt: new Date() }).where(eq(assetInventories.id, id));
      return rows.length;
    });
    this.logger.log(`Kiểm kê ${inv.code}: chốt sổ sách ${count} tài sản`);
    await this.notifyMembers(inv, `Bắt đầu kiểm kê ${inv.code}`, `${inv.name} — ${count} tài sản cần kiểm. Mở trang kiểm kê để quét mã.`);
    return this.detail(id, user);
  }

  /* ------------------------------------------------------------ Quét mã (online & đồng bộ offline) */
  async scan(id: number, body: { scans?: ScanInput[]; deviceId?: string }, user: AccessContext) {
    const inv = await this.loadFor(id, user, ['DANG_KIEM_KE']);
    if (!this.canScan(user, inv)) throw new ForbiddenException('Bạn không có quyền quét trong đợt kiểm kê này');
    const scans = (Array.isArray(body.scans) ? body.scans : []).slice(0, 500);
    if (!scans.length) throw new BadRequestException('Không có lượt quét nào');
    const deviceId = String(body.deviceId ?? '').slice(0, 80);
    const seeExpected = this.actions(inv, user).seeExpected;

    const results = await this.db.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('asset_inv'), ${id})`);
      const out: Record<string, unknown>[] = [];
      for (const s of scans) {
        const code = extractAssetCode(s.code);
        const clientId = String(s.clientId ?? '').slice(0, 64) || `srv-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        if (!code) {
          out.push({ clientId, code, outcome: 'INVALID', message: 'Mã rỗng' });
          continue;
        }
        const [dup] = await tx
          .select({ itemId: assetInventoryScans.itemId, outcome: assetInventoryScans.outcome })
          .from(assetInventoryScans)
          .where(and(eq(assetInventoryScans.inventoryId, id), eq(assetInventoryScans.clientId, clientId)));
        if (dup) {
          out.push({ clientId, code, outcome: dup.outcome, itemId: dup.itemId, synced: true });
          continue;
        }
        const at = s.scannedAt && !Number.isNaN(Date.parse(s.scannedAt)) ? new Date(Math.min(Date.parse(s.scannedAt), Date.now() + 60_000)) : new Date();
        const method = ['CAMERA', 'SCANNER', 'MANUAL', 'OFFLINE'].includes(String(s.method)) ? String(s.method) : 'SCANNER';
        const condition = s.condition && ASSET_CONDITION[s.condition] ? s.condition : '';
        const [asset] = await tx
          .select({
            id: assets.id, departmentId: assets.departmentId, locationId: assets.locationId, custodianName: assets.custodianName,
            status: assets.status, condition: assets.condition, originalCost: assets.originalCost, bookValue: this.assetsService.bookValueExpr,
          })
          .from(assets)
          .where(and(isNull(assets.deletedAt), or(sql`lower(${assets.code}) = lower(${code})`, sql`lower(${assets.barcode}) = lower(${code})`, sql`lower(${assets.serialNumber}) = lower(${code})`)))
          .orderBy(sql`case when lower(${assets.code}) = lower(${code}) then 0 when lower(${assets.barcode}) = lower(${code}) then 1 else 2 end`)
          .limit(1);

        let item: Item | undefined;
        let outcome = 'FOUND';
        if (asset) {
          [item] = await tx.select().from(assetInventoryItems).where(and(eq(assetInventoryItems.inventoryId, id), eq(assetInventoryItems.assetId, asset.id)));
          if (!item) {
            outcome = 'EXTRA';
            const draft = {
              inventoryId: id, assetId: asset.id, expected: false, scannedCode: code, bookDepartmentId: asset.departmentId, bookLocationId: asset.locationId,
              bookCustodianName: asset.custodianName, bookStatus: asset.status, bookCondition: asset.condition, bookCost: asset.originalCost,
              bookValue: Number(asset.bookValue), checkState: 'CO',
              actualDepartmentId: s.departmentId !== undefined ? s.departmentId || null : asset.departmentId,
              actualLocationId: s.locationId || asset.locationId, actualCondition: condition || asset.condition,
              scanCount: 1, method, checkedAt: at, checkedBy: user.id, checkedByName: user.fullName, note: String(s.note ?? '').slice(0, 500),
            };
            [item] = await tx.insert(assetInventoryItems).values({ ...draft, result: inventoryResultOf(draft as never) }).returning();
          }
        } else {
          [item] = await tx.select().from(assetInventoryItems).where(and(eq(assetInventoryItems.inventoryId, id), isNull(assetInventoryItems.assetId), sql`lower(${assetInventoryItems.scannedCode}) = lower(${code})`));
          if (!item) {
            outcome = 'UNKNOWN';
            [item] = await tx
              .insert(assetInventoryItems)
              .values({
                inventoryId: id, assetId: null, expected: false, scannedCode: code, checkState: 'CO', result: 'KHONG_RO',
                actualDepartmentId: s.departmentId || null, actualLocationId: s.locationId || null, actualCondition: condition,
                scanCount: 1, method, checkedAt: at, checkedBy: user.id, checkedByName: user.fullName, note: String(s.note ?? '').slice(0, 500),
              })
              .returning();
          }
        }

        if (outcome === 'FOUND' && item) {
          if (item.checkState === 'CO') {
            outcome = 'DUPLICATE';
            // Lượt quét mới hơn có thể cập nhật vị trí/tình trạng (vd quét lại ở phòng khác)
            const newer = !item.checkedAt || at.getTime() >= new Date(item.checkedAt).getTime();
            const patch: Partial<Item> = { scanCount: item.scanCount + 1 };
            if (newer && (s.locationId || s.departmentId !== undefined || condition)) {
              if (s.departmentId !== undefined) patch.actualDepartmentId = s.departmentId || null;
              if (s.locationId) patch.actualLocationId = s.locationId;
              if (condition) patch.actualCondition = condition;
              patch.checkedAt = at;
              patch.checkedBy = user.id;
              patch.checkedByName = user.fullName;
            }
            const merged = { ...item, ...patch };
            patch.result = inventoryResultOf(merged);
            [item] = await tx.update(assetInventoryItems).set(patch).where(eq(assetInventoryItems.id, item.id)).returning();
          } else {
            const patch: Partial<Item> = {
              checkState: 'CO',
              actualDepartmentId: s.departmentId !== undefined ? s.departmentId || null : item.bookDepartmentId,
              actualLocationId: s.locationId || item.bookLocationId,
              actualCondition: condition || item.bookCondition,
              scanCount: item.scanCount + 1,
              method,
              checkedAt: at,
              checkedBy: user.id,
              checkedByName: user.fullName,
              note: s.note ? String(s.note).slice(0, 500) : item.note,
            };
            patch.result = inventoryResultOf({ ...item, ...patch });
            [item] = await tx.update(assetInventoryItems).set(patch).where(eq(assetInventoryItems.id, item.id)).returning();
          }
        } else if (item && outcome !== 'EXTRA' && outcome !== 'UNKNOWN') {
          // Mã không có hồ sơ / tài sản thừa đã quét trước đó
          outcome = 'DUPLICATE';
          [item] = await tx.update(assetInventoryItems).set({ scanCount: item.scanCount + 1 }).where(eq(assetInventoryItems.id, item.id)).returning();
        }

        await tx.insert(assetInventoryScans).values({
          inventoryId: id, clientId, code, itemId: item?.id ?? null, outcome, method, locationId: s.locationId || null,
          userId: user.id, userName: user.fullName, deviceId, scannedAt: at,
        });
        out.push({ clientId, code, outcome, itemId: item?.id, result: item?.result, assetId: item?.assetId });
      }
      return out;
    });

    // Bổ sung thông tin hiển thị cho các dòng vừa quét
    const itemIds = results.map((r) => Number(r.itemId)).filter((n) => n > 0);
    const info = itemIds.length ? (await this.items(id, { all: true } as InventoryItemsQuery, user)).items.filter((i) => itemIds.includes(i.id)) : [];
    const byId = new Map(info.map((i) => [i.id, i]));
    const [stats] = await this.statsSql([id]);
    return {
      results: results.map((r) => ({ ...r, item: byId.get(Number(r.itemId)) ?? null })),
      stats: seeExpected ? stats : { found: stats?.found ?? 0 },
    };
  }

  /** Gói dữ liệu cho thiết bị kiểm kê offline: danh sách mã cần kiểm + danh mục để chọn vị trí */
  async offlinePack(id: number, user: AccessContext) {
    const inv = await this.loadFor(id, user);
    const can = this.actions(inv, user);
    const rows = await this.db.db
      .select({
        id: assetInventoryItems.id, assetId: assetInventoryItems.assetId, code: assets.code, barcode: assets.barcode, serialNumber: assets.serialNumber,
        name: assets.name, bookDepartmentId: assetInventoryItems.bookDepartmentId, bookLocationId: assetInventoryItems.bookLocationId,
        bookCondition: assetInventoryItems.bookCondition, checkState: assetInventoryItems.checkState, result: assetInventoryItems.result,
        expected: assetInventoryItems.expected, scannedCode: assetInventoryItems.scannedCode,
      })
      .from(assetInventoryItems)
      .leftJoin(assets, eq(assets.id, assetInventoryItems.assetId))
      .where(eq(assetInventoryItems.inventoryId, id));
    const [depts, locs] = await Promise.all([
      this.db.db.select({ id: departments.id, name: departments.name }).from(departments).where(and(eq(departments.active, true), isNull(departments.deletedAt))).orderBy(asc(departments.name)),
      this.db.db.select({ id: assetLocations.id, name: assetLocations.name, level: assetLocations.level, path: assetLocations.path }).from(assetLocations).where(eq(assetLocations.active, true)).orderBy(asc(assetLocations.path)),
    ]);
    return {
      inventory: { id: inv.id, code: inv.code, name: inv.name, status: inv.status, blind: inv.blind && !can.seeExpected, scope: inv.scope },
      items: rows,
      departments: depts,
      locations: locs,
      generatedAt: new Date().toISOString(),
    };
  }

  /* ------------------------------------------------------------ Xác nhận thủ công */
  async updateItem(id: number, itemId: number, body: Record<string, unknown>, user: AccessContext) {
    const inv = await this.loadFor(id, user, ['DANG_KIEM_KE', 'CHO_DUYET']);
    const manage = this.canManage(user);
    if (inv.status === 'DANG_KIEM_KE' ? !this.canScan(user, inv) : !manage) throw new ForbiddenException('Bạn không sửa được dòng kiểm kê này');
    const [item] = await this.db.db.select().from(assetInventoryItems).where(and(eq(assetInventoryItems.id, itemId), eq(assetInventoryItems.inventoryId, id)));
    if (!item) throw new NotFoundException('Không tìm thấy dòng kiểm kê');
    const patch: Partial<Item> = {};
    if ('checkState' in body) {
      const st = String(body.checkState);
      if (!['CO', 'KHONG_THAY', 'CHUA_KIEM'].includes(st)) throw new BadRequestException('Trạng thái kiểm không hợp lệ');
      if (!item.expected && st !== 'CO') throw new BadRequestException('Tài sản thừa/chưa có hồ sơ chỉ có thể ở trạng thái "có" — xoá dòng nếu quét nhầm');
      patch.checkState = st;
      if (st === 'CO' && item.checkState !== 'CO') {
        patch.actualDepartmentId = item.bookDepartmentId;
        patch.actualLocationId = item.bookLocationId;
        patch.actualCondition = item.bookCondition;
        patch.method = 'MANUAL';
      }
      if (st !== 'CO') {
        patch.actualDepartmentId = null;
        patch.actualLocationId = null;
        patch.actualCondition = '';
        if (st === 'KHONG_THAY') patch.method = 'MANUAL';
      }
      patch.checkedAt = st === 'CHUA_KIEM' ? null : new Date();
      patch.checkedBy = st === 'CHUA_KIEM' ? null : user.id;
      patch.checkedByName = st === 'CHUA_KIEM' ? '' : user.fullName;
    }
    if ('actualDepartmentId' in body) patch.actualDepartmentId = Number(body.actualDepartmentId) > 0 ? Number(body.actualDepartmentId) : null;
    if ('actualLocationId' in body) patch.actualLocationId = Number(body.actualLocationId) > 0 ? Number(body.actualLocationId) : null;
    if ('actualCondition' in body) {
      const c = String(body.actualCondition ?? '');
      if (c && !ASSET_CONDITION[c]) throw new BadRequestException('Tình trạng không hợp lệ');
      patch.actualCondition = c;
    }
    if ('note' in body) patch.note = String(body.note ?? '').slice(0, 500);
    if ('resolution' in body && manage) {
      const r = String(body.resolution ?? '');
      if (r && r !== 'GHI_NHAN') throw new BadRequestException('Dùng chức năng "Xử lý chênh lệch" để lập chứng từ');
      if (item.resolutionTxId) throw new ConflictException('Dòng này đã lập chứng từ xử lý');
      patch.resolution = r;
    }
    const merged = { ...item, ...patch };
    if (merged.checkState === 'CO' && (('actualDepartmentId' in body) || ('actualLocationId' in body) || ('actualCondition' in body)) && item.checkState !== 'CO' && !('checkState' in body)) {
      merged.checkState = 'CO';
      patch.checkState = 'CO';
    }
    patch.result = inventoryResultOf(merged);
    const [row] = await this.db.db.update(assetInventoryItems).set(patch).where(eq(assetInventoryItems.id, itemId)).returning();
    return row;
  }

  /** Xoá dòng thừa quét nhầm */
  async removeItem(id: number, itemId: number, user: AccessContext) {
    const inv = await this.loadFor(id, user, ['DANG_KIEM_KE', 'CHO_DUYET']);
    if (!this.canScan(user, inv) && !this.canManage(user)) throw new ForbiddenException('Không có quyền');
    const [item] = await this.db.db.select().from(assetInventoryItems).where(and(eq(assetInventoryItems.id, itemId), eq(assetInventoryItems.inventoryId, id)));
    if (!item) throw new NotFoundException('Không tìm thấy dòng kiểm kê');
    if (item.expected) throw new BadRequestException('Tài sản trong sổ sách không xoá được — đánh dấu "Chưa kiểm" hoặc "Không thấy"');
    await this.db.db.delete(assetInventoryItems).where(eq(assetInventoryItems.id, itemId));
    return { id: itemId };
  }

  /** Đánh dấu hàng loạt (vd: toàn bộ còn lại của khoa X là "không thấy") */
  async bulkMark(id: number, body: { itemIds?: unknown; checkState?: string; departmentId?: number }, user: AccessContext) {
    await this.loadFor(id, user, ['DANG_KIEM_KE', 'CHO_DUYET']);
    if (!this.canManage(user)) throw new ForbiddenException('Cần quyền điều hành kiểm kê');
    const st = String(body.checkState ?? '');
    if (!['CO', 'KHONG_THAY', 'CHUA_KIEM'].includes(st)) throw new BadRequestException('Trạng thái kiểm không hợp lệ');
    const ids = cleanIds(body.itemIds);
    if (!ids.length) throw new BadRequestException('Chưa chọn dòng nào');
    const rows = await this.db.db.select().from(assetInventoryItems).where(and(eq(assetInventoryItems.inventoryId, id), inArray(assetInventoryItems.id, ids), eq(assetInventoryItems.expected, true)));
    await this.db.db.transaction(async (tx) => {
      for (const it of rows) {
        const patch: Partial<Item> =
          st === 'CO'
            ? { checkState: 'CO', actualDepartmentId: it.checkState === 'CO' ? it.actualDepartmentId : it.bookDepartmentId, actualLocationId: it.checkState === 'CO' ? it.actualLocationId : it.bookLocationId, actualCondition: it.checkState === 'CO' ? it.actualCondition : it.bookCondition, method: it.checkState === 'CO' ? it.method : 'MANUAL', checkedAt: new Date(), checkedBy: user.id, checkedByName: user.fullName }
            : { checkState: st, actualDepartmentId: null, actualLocationId: null, actualCondition: '', method: st === 'KHONG_THAY' ? 'MANUAL' : '', checkedAt: st === 'CHUA_KIEM' ? null : new Date(), checkedBy: st === 'CHUA_KIEM' ? null : user.id, checkedByName: st === 'CHUA_KIEM' ? '' : user.fullName };
        patch.result = inventoryResultOf({ ...it, ...patch });
        await tx.update(assetInventoryItems).set(patch).where(eq(assetInventoryItems.id, it.id));
      }
    });
    return { updated: rows.length };
  }

  /* ------------------------------------------------------------ Khoá số liệu / mở lại */
  async finish(id: number, body: { conclusion?: string }, user: AccessContext) {
    const inv = await this.loadFor(id, user, ['DANG_KIEM_KE']);
    if (!this.canManage(user)) throw new ForbiddenException('Cần quyền điều hành kiểm kê');
    await this.db.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('asset_inv'), ${id})`);
      // Còn chưa kiểm → coi là không tìm thấy (đánh dấu AUTO để mở lại thì trả về như cũ)
      await tx
        .update(assetInventoryItems)
        .set({ checkState: 'KHONG_THAY', result: 'THIEU', method: 'AUTO' })
        .where(and(eq(assetInventoryItems.inventoryId, id), eq(assetInventoryItems.expected, true), eq(assetInventoryItems.checkState, 'CHUA_KIEM')));
      await tx
        .update(assetInventories)
        .set({ status: 'CHO_DUYET', finishedAt: new Date(), updatedAt: new Date(), ...(body.conclusion !== undefined ? { conclusion: String(body.conclusion).trim() } : {}) })
        .where(eq(assetInventories.id, id));
    });
    await this.notifyApprovers(inv, user);
    return this.detail(id, user);
  }

  async reopen(id: number, user: AccessContext) {
    await this.loadFor(id, user, ['CHO_DUYET']);
    if (!this.canManage(user)) throw new ForbiddenException('Cần quyền điều hành kiểm kê');
    await this.db.db.transaction(async (tx) => {
      await tx
        .update(assetInventoryItems)
        .set({ checkState: 'CHUA_KIEM', result: '', method: '' })
        .where(and(eq(assetInventoryItems.inventoryId, id), eq(assetInventoryItems.method, 'AUTO'), isNull(assetInventoryItems.resolutionTxId)));
      await tx.update(assetInventories).set({ status: 'DANG_KIEM_KE', finishedAt: null, updatedAt: new Date() }).where(eq(assetInventories.id, id));
    });
    return this.detail(id, user);
  }

  async cancel(id: number, user: AccessContext) {
    await this.loadFor(id, user, ['NHAP', 'DANG_KIEM_KE', 'CHO_DUYET']);
    if (!this.canManage(user)) throw new ForbiddenException('Cần quyền điều hành kiểm kê');
    await this.db.db.update(assetInventories).set({ status: 'DA_HUY', updatedAt: new Date() }).where(eq(assetInventories.id, id));
    return this.detail(id, user);
  }

  /* ------------------------------------------------------------ Xử lý chênh lệch → chứng từ nháp */
  async resolve(id: number, body: { action?: string; itemIds?: unknown; submit?: boolean }, user: AccessContext) {
    const inv = await this.loadFor(id, user, ['CHO_DUYET', 'HOAN_TAT']);
    if (!this.canManage(user)) throw new ForbiddenException('Cần quyền điều hành kiểm kê');
    const action = String(body.action ?? '');
    if (!INVENTORY_RESOLUTION[action]) throw new BadRequestException('Cách xử lý không hợp lệ');
    const ids = cleanIds(body.itemIds);
    const eligible: Record<string, string[]> = { DIEU_CHUYEN: ['SAI_VI_TRI', 'THUA'], BAO_MAT: ['THIEU'], BAO_HONG: ['SAI_TINH_TRANG', 'KHOP', 'SAI_VI_TRI', 'THUA'], GHI_NHAN: ['SAI_VI_TRI', 'SAI_TINH_TRANG', 'THIEU', 'THUA', 'KHONG_RO'] };
    const w: SQL[] = [eq(assetInventoryItems.inventoryId, id), inArray(assetInventoryItems.result, eligible[action]), eq(assetInventoryItems.resolution, '')];
    if (ids.length) w.push(inArray(assetInventoryItems.id, ids));
    if (action === 'BAO_HONG') w.push(eq(assetInventoryItems.actualCondition, 'HONG'));
    const rows = await this.db.db
      .select({ item: assetInventoryItems, status: assets.status, departmentId: assets.departmentId, locationId: assets.locationId })
      .from(assetInventoryItems)
      .leftJoin(assets, eq(assets.id, assetInventoryItems.assetId))
      .where(and(...w));
    if (!rows.length) throw new BadRequestException('Không có dòng nào phù hợp để xử lý theo cách này (hoặc đã xử lý rồi)');

    if (action === 'GHI_NHAN') {
      await this.db.db.update(assetInventoryItems).set({ resolution: 'GHI_NHAN' }).where(inArray(assetInventoryItems.id, rows.map((r) => r.item.id)));
      return { created: [], resolved: rows.length, errors: [] };
    }

    // Nhóm thành từng chứng từ
    const groups = new Map<string, { type: string; header: Record<string, unknown>; items: typeof rows }>();
    const skipped: string[] = [];
    for (const r of rows) {
      if (!r.item.assetId) continue;
      let type = INVENTORY_RESOLUTION[action].txType!;
      const header: Record<string, unknown> = {};
      if (action === 'DIEU_CHUYEN') {
        const toDept = r.item.actualDepartmentId ?? null;
        const toLoc = r.item.actualLocationId ?? null;
        if (toDept === (r.departmentId ?? null) && (!toLoc || toLoc === r.locationId)) {
          skipped.push(`#${r.item.id}: nơi thực tế trùng hồ sơ hiện tại`);
          continue;
        }
        if (r.status === 'TRONG_KHO' && toDept) type = 'CAP_PHAT';
        else if (!toDept && r.departmentId && ['DANG_SU_DUNG', 'HONG'].includes(String(r.status))) type = 'THU_HOI';
        header.toDepartmentId = toDept;
        header.toLocationId = toLoc;
      }
      const key = `${type}|${header.toDepartmentId ?? ''}|${header.toLocationId ?? ''}`;
      if (!groups.has(key)) groups.set(key, { type, header, items: [] });
      groups.get(key)!.items.push(r);
    }
    const created: { id: number; code: string; type: string; count: number }[] = [];
    const errors: string[] = [...skipped];
    for (const g of groups.values()) {
      try {
        const t = (await this.txService.create(
          {
            type: g.type,
            ...g.header,
            decisionNo: inv.decisionNo,
            reason: `Xử lý chênh lệch theo kết quả kiểm kê ${inv.code} — ${inv.name}`,
            items: g.items.map((r) => ({ assetId: r.item.assetId, condition: r.item.actualCondition || '', note: r.item.note || INVENTORY_RESULT[r.item.result]?.label || '' })),
            submit: Boolean(body.submit),
          },
          user,
        )) as { id: number; code: string };
        await this.db.db
          .update(assetInventoryItems)
          .set({ resolution: action, resolutionTxId: t.id })
          .where(inArray(assetInventoryItems.id, g.items.map((r) => r.item.id)));
        created.push({ id: t.id, code: t.code, type: g.type, count: g.items.length });
      } catch (e) {
        errors.push((e as Error).message);
      }
    }
    return { created, resolved: created.reduce((s, c) => s + c.count, 0), errors };
  }

  /* ------------------------------------------------------------ Duyệt hoàn tất */
  async complete(id: number, body: { conclusion?: string; updateCondition?: boolean }, user: AccessContext) {
    const inv = await this.loadFor(id, user, ['CHO_DUYET']);
    if (!this.canApprove(user)) throw new ForbiddenException('Cần quyền duyệt kết quả kiểm kê');
    const updateCondition = body.updateCondition !== false;
    const when = inv.snapshotAt ?? new Date();
    const summary = await this.db.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('asset_inv'), ${id})`);
      const rows = await tx
        .select({ item: assetInventoryItems, condition: assets.condition })
        .from(assetInventoryItems)
        .innerJoin(assets, eq(assets.id, assetInventoryItems.assetId))
        .where(eq(assetInventoryItems.inventoryId, id));
      const found = rows.filter((r) => r.item.checkState === 'CO');
      const missing = rows.filter((r) => r.item.result === 'THIEU');
      if (found.length) {
        const ids = found.map((r) => r.item.assetId!);
        for (let i = 0; i < ids.length; i += 1000) {
          await tx.update(assets).set({ lastInventoryAt: when }).where(inArray(assets.id, ids.slice(i, i + 1000)));
        }
      }
      let condChanged = 0;
      if (updateCondition) {
        for (const r of found) {
          if (r.item.actualCondition && r.item.actualCondition !== r.condition) {
            await tx.update(assets).set({ condition: r.item.actualCondition, updatedAt: new Date() }).where(eq(assets.id, r.item.assetId!));
            condChanged++;
          }
        }
      }
      const events = rows
        .filter((r) => r.item.result)
        .map((r) => ({
          assetId: r.item.assetId!,
          eventType: 'INVENTORY',
          title: `Kiểm kê ${inv.code}: ${INVENTORY_RESULT[r.item.result]?.label ?? r.item.result}`,
          detail: {
            inventoryId: id, result: r.item.result, checkState: r.item.checkState,
            actualCondition: r.item.actualCondition, bookCondition: r.item.bookCondition, note: r.item.note,
            conditionUpdated: updateCondition && !!r.item.actualCondition && r.item.actualCondition !== r.condition,
          } as Record<string, unknown>,
          userId: user.id,
          userName: user.fullName,
        }));
      for (let i = 0; i < events.length; i += 1000) await tx.insert(assetEvents).values(events.slice(i, i + 1000));
      await tx
        .update(assetInventories)
        .set({
          status: 'HOAN_TAT', completedAt: new Date(), approvedBy: user.id, approvedByName: user.fullName, updatedAt: new Date(),
          ...(body.conclusion !== undefined ? { conclusion: String(body.conclusion).trim() } : {}),
        })
        .where(eq(assetInventories.id, id));
      return { found: found.length, missing: missing.length, condChanged };
    });
    this.logger.log(`Kiểm kê ${inv.code} hoàn tất: ${summary.found} có, ${summary.missing} thiếu, ${summary.condChanged} đổi tình trạng`);
    if (inv.createdBy && inv.createdBy !== user.id) {
      await this.db.db
        .insert(notifications)
        .values({ userId: inv.createdBy, title: `Đã duyệt kết quả kiểm kê ${inv.code}`, body: `${inv.name} — duyệt bởi ${user.fullName}.`, level: 'SUCCESS', link: `/tai-san/kiem-ke/${id}`, module: 'ASSET', entityId: String(id) })
        .catch(() => undefined);
    }
    return { ...(await this.detail(id, user)), summary };
  }

  /* ------------------------------------------------------------ Thông báo */
  private async notifyApprovers(inv: Inventory, actor: AccessContext) {
    try {
      const rows = await this.db.db
        .selectDistinct({ userId: userRoles.userId })
        .from(permissions)
        .innerJoin(rolePermissions, eq(rolePermissions.permissionId, permissions.id))
        .innerJoin(userRoles, eq(userRoles.roleId, rolePermissions.roleId))
        .innerJoin(users, eq(users.id, userRoles.userId))
        .where(and(eq(permissions.code, 'asset.inventory.approve'), eq(users.active, true), isNull(users.deletedAt)));
      const targets = rows.map((r) => r.userId).filter((u) => u !== actor.id);
      if (targets.length) {
        await this.db.db.insert(notifications).values(
          targets.map((userId) => ({ userId, title: `Kết quả kiểm kê chờ duyệt: ${inv.code}`, body: `${inv.name} — khoá số liệu bởi ${actor.fullName}.`, level: 'INFO', link: `/tai-san/kiem-ke/${inv.id}`, module: 'ASSET', entityId: String(inv.id) })),
        );
      }
    } catch (e) {
      this.logger.warn(`Không gửi được thông báo: ${(e as Error).message}`);
    }
  }

  private async notifyMembers(inv: Inventory, title: string, body: string) {
    const ids = (inv.memberIds ?? []).filter((u) => u !== inv.createdBy);
    if (!ids.length) return;
    await this.db.db
      .insert(notifications)
      .values(ids.map((userId) => ({ userId, title, body, level: 'INFO', link: `/tai-san/kiem-ke/${inv.id}/quet`, module: 'ASSET', entityId: String(inv.id) })))
      .catch((e) => this.logger.warn(`Không gửi được thông báo: ${(e as Error).message}`));
  }

  /* ------------------------------------------------------------ Xuất Excel */
  async export(id: number, user: AccessContext) {
    const d = await this.detail(id, user);
    if (!d.can.seeExpected) throw new ForbiddenException('Kiểm kê mù — chỉ người điều hành được xuất kết quả');
    const { items } = await this.items(id, { all: true }, user);
    const wb = new ExcelJS.Workbook();
    wb.creator = 'QLBS';
    const head = (ws: ExcelJS.Worksheet, title: string) => {
      ws.addRow([title]).font = { bold: true, size: 14 };
      ws.addRow([`${d.code} — ${d.name} · Phạm vi: ${d.scopeText} · Chốt sổ: ${vnDateTime(d.snapshotAt)}`]).font = { italic: true, color: { argb: 'FF475569' } };
      ws.addRow([]);
    };
    const style = (row: ExcelJS.Row) => {
      row.font = { bold: true };
      row.height = 30;
      row.eachCell((c) => {
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFCCFBF1' } };
        c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        c.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
      });
    };
    const s1 = wb.addWorksheet('Tổng hợp');
    head(s1, 'TỔNG HỢP KẾT QUẢ KIỂM KÊ');
    style(s1.addRow(['Khoa/phòng (sổ sách)', 'Theo sổ', 'Đã kiểm', 'Có mặt', 'Thiếu', 'Sai vị trí', 'Thừa', 'Nguyên giá theo sổ']));
    for (const r of d.byDepartment) s1.addRow([r.departmentName ?? 'Kho / chưa cấp phát', r.expected, r.checked, r.found, r.missing, r.misplaced, r.extra, r.cost]);
    const st = d.stats;
    s1.addRow(['TỔNG CỘNG', st.expected, st.checked, st.found, st.THIEU, st.SAI_VI_TRI, st.THUA + st.KHONG_RO, st.expectedCost]).font = { bold: true };
    [34, 10, 10, 10, 10, 10, 10, 18].forEach((w, i) => (s1.getColumn(i + 1).width = w));
    s1.getColumn(8).numFmt = '#,##0';

    const s2 = wb.addWorksheet('Chi tiết');
    head(s2, 'CHI TIẾT KIỂM KÊ TÀI SẢN');
    const cols: [string, number, (r: (typeof items)[number]) => unknown, string?][] = [
      ['STT', 6, () => ''],
      ['Mã tài sản', 18, (r) => r.code],
      ['Tên tài sản', 34, (r) => r.name],
      ['Model / Serial', 22, (r) => [r.model, r.serialNumber].filter(Boolean).join(' / ')],
      ['Khoa/phòng (sổ)', 22, (r) => (r.expected ? r.bookDepartmentName ?? 'Kho' : '')],
      ['Vị trí (sổ)', 16, (r) => r.bookLocationName ?? ''],
      ['Tình trạng (sổ)', 12, (r) => ASSET_CONDITION[r.bookCondition] ?? r.bookCondition],
      ['Nguyên giá', 15, (r) => Number(r.bookCost ?? 0), '#,##0'],
      ['Giá trị còn lại', 15, (r) => Number(r.bookValue ?? 0), '#,##0'],
      ['Kiểm', 11, (r) => (r.checkState === 'CO' ? 'Có' : r.checkState === 'KHONG_THAY' ? 'Không thấy' : 'Chưa kiểm')],
      ['Khoa/phòng (thực tế)', 22, (r) => (r.checkState === 'CO' ? r.actualDepartmentName ?? 'Kho' : '')],
      ['Vị trí (thực tế)', 16, (r) => r.actualLocationName ?? ''],
      ['Tình trạng (thực tế)', 12, (r) => ASSET_CONDITION[r.actualCondition] ?? r.actualCondition],
      ['Kết quả', 14, (r) => INVENTORY_RESULT[r.result]?.label ?? ''],
      ['Người kiểm', 18, (r) => r.checkedByName],
      ['Thời điểm', 17, (r) => vnDateTime(r.checkedAt)],
      ['Xử lý', 18, (r) => INVENTORY_RESOLUTION[r.resolution]?.label ?? ''],
      ['Ghi chú', 24, (r) => r.note],
    ];
    style(s2.addRow(cols.map((c) => c[0])));
    items.forEach((r, i) => {
      const row = s2.addRow(cols.map((c, ci) => (ci === 0 ? i + 1 : c[2](r))));
      const color = INVENTORY_RESULT[r.result]?.color;
      if (color && r.result !== 'KHOP') row.getCell(14).font = { bold: true, color: { argb: `FF${color.slice(1)}` } };
    });
    cols.forEach((c, i) => {
      s2.getColumn(i + 1).width = c[1];
      if (c[3]) s2.getColumn(i + 1).numFmt = c[3];
    });
    s2.views = [{ state: 'frozen', ySplit: 4, xSplit: 3 }];
    s2.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4 + items.length, column: cols.length } };
    return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), fileName: `kiem-ke-${d.code}.xlsx` };
  }

  /* ------------------------------------------------------------ In biên bản kiểm kê */
  private async template(): Promise<PrintDocument> {
    const list = await this.db.db
      .select({ document: printTemplates.document, isDefault: printTemplates.isDefault })
      .from(printTemplates)
      .where(and(eq(printTemplates.docType, INVENTORY_TEMPLATE_CODE), eq(printTemplates.active, true)))
      .orderBy(asc(printTemplates.name));
    const t = list.find((x) => x.isDefault) ?? list[0];
    return (t?.document as PrintDocument) ?? defaultInventoryDocument();
  }

  async render(id: number, opts: { onlyDiff?: boolean }, user: AccessContext) {
    const d = await this.detail(id, user);
    if (!d.can.seeExpected) throw new ForbiddenException('Kiểm kê mù — chỉ người điều hành được in biên bản');
    const { items } = await this.items(id, { all: true, ...(opts.onlyDiff ? { result: 'THIEU,THUA,KHONG_RO,SAI_VI_TRI,SAI_TINH_TRANG' } : {}) }, user);
    const [hospitalName, parentOrgName, place, director] = await Promise.all([
      this.settings.get('hospital.name', ''),
      this.settings.get('hospital.parentName', ''),
      this.settings.get('hospital.place', ''),
      this.settings.get('hospital.director', ''),
    ]).then((r) => r.map((x) => String(x ?? '')));
    const snap = d.snapshotAt ? new Date(new Date(d.snapshotAt).getTime() + 7 * 3600_000) : new Date(Date.now() + 7 * 3600_000);
    const dd = String(snap.getUTCDate()).padStart(2, '0');
    const mm = String(snap.getUTCMonth() + 1).padStart(2, '0');
    const yy = snap.getUTCFullYear();
    const st = d.stats;
    const committee = d.committee ?? [];
    const chair = committee.find((m) => /chủ tịch|trưởng ban/i.test(m.role ?? '')) ?? committee[0];
    const rows = items.map((r, i) => {
      const bookQty = r.expected ? 1 : 0;
      const realQty = r.checkState === 'CO' ? 1 : 0;
      const cost = Number(r.bookCost ?? 0);
      const place = [r.bookDepartmentName ?? (r.expected ? 'Kho' : ''), r.bookLocationName].filter(Boolean).join(' — ');
      const actualPlace = r.result === 'SAI_VI_TRI' || r.result === 'THUA' ? [r.actualDepartmentName ?? 'Kho', r.actualLocationName].filter(Boolean).join(' — ') : '';
      return {
        stt: String(i + 1),
        code: r.code,
        nameText: [r.name, r.serialNumber && `S/N: ${r.serialNumber}`].filter(Boolean).join('\n'),
        placeText: place,
        bookQty: bookQty ? '1' : '',
        bookCost: bookQty ? fmt(cost) : '',
        realQty: realQty ? '1' : '',
        realCost: realQty ? fmt(cost) : '',
        diffQty: realQty - bookQty ? (realQty - bookQty > 0 ? '+1' : '-1') : '',
        diffCost: realQty - bookQty ? `${realQty - bookQty > 0 ? '+' : '-'}${fmt(cost)}` : '',
        resultText: [
          INVENTORY_RESULT[r.result]?.label,
          actualPlace && `thực tế: ${actualPlace}`,
          r.result === 'SAI_TINH_TRANG' || (r.actualCondition && r.actualCondition !== r.bookCondition) ? `tình trạng: ${ASSET_CONDITION[r.actualCondition] ?? r.actualCondition}` : '',
          r.note,
        ].filter(Boolean).join('; '),
      };
    });
    const extraCount = st.THUA + st.KHONG_RO;
    const data = {
      hospitalName,
      parentOrgName,
      code: d.code,
      title: 'BIÊN BẢN KIỂM KÊ TÀI SẢN',
      inventoryName: d.name,
      placeDateText: `${place ? `${place}, ngày` : 'Ngày'} ${dd} tháng ${mm} năm ${yy}`,
      snapshotText: `Thời điểm kiểm kê: ${vnDateTime(d.snapshotAt) || '……'}${d.finishedAt ? ` — kết thúc ${vnDateTime(d.finishedAt)}` : ''}`,
      decisionText: d.decisionNo || '………………………………………………',
      scopeText: d.scopeText,
      committeeText: committee.length
        ? committee.map((m) => `- Ông/bà ${m.name}${m.position ? `, ${m.position}` : ''}${m.role ? ` — ${m.role}` : ''}`).join('\n')
        : '- ………………………………………………',
      summaryText:
        `Theo sổ sách: ${st.expected} tài sản, nguyên giá ${fmt(st.expectedCost)} đồng. Thực tế kiểm kê: có mặt ${Math.max(0, st.found - extraCount)} tài sản, nguyên giá ${fmt(st.foundCost)} đồng. ` +
        `Thiếu: ${st.THIEU} (nguyên giá ${fmt(st.missingCost)}, giá trị còn lại ${fmt(st.missingValue)} đồng). Thừa: ${extraCount}. Sai vị trí: ${st.SAI_VI_TRI}. Khác tình trạng: ${st.SAI_TINH_TRANG}.`,
      detailNote: opts.onlyDiff ? 'Chi tiết các tài sản chênh lệch:' : 'Chi tiết kết quả kiểm kê:',
      conclusion: d.conclusion || '………………………………………………………………………………………………………………',
      creatorName: d.createdByName,
      chairName: chair?.name ?? '',
      approverName: d.approvedByName || director,
      items: rows,
    };
    const { buffer } = await renderPrintDocument(await this.template(), { data, fileName: `${d.code}.pdf` });
    return { buffer, fileName: `bien-ban-kiem-ke-${d.code}.pdf` };
  }
}
