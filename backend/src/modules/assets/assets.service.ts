/**
 * Hồ sơ tài sản: danh sách (lọc sâu theo cây loại/vị trí, khoa, trạng thái, hạn kiểm định…),
 * chi tiết + dòng thời gian, thêm/sửa/xoá, thêm hàng loạt, tra cứu mã vạch, tổng quan.
 *
 * Phạm vi dữ liệu: người có `asset.view-all` (hoặc SUPER_ADMIN) xem toàn viện;
 * còn lại chỉ thấy tài sản thuộc các khoa trong phạm vi của mình (departmentIds) hoặc mình đang giữ.
 */
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, gte, ilike, inArray, isNull, lte, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { AccessContext } from '../../common/types/access-context';
import { buildPage } from '../../common/dto/query.dto';
import { DbService, type Executor, type Tx } from '../../db/db.service';
import {
  assetCategories,
  assetDepreciationLines,
  assetDepreciationRuns,
  assetEvents,
  assetFundingSources,
  assetLocations,
  assets,
  assetSuppliers,
  assetTransactionItems,
  assetTransactions,
  departments,
  users,
} from '../../db/schema';
import { normalizeVN } from '../hsba/hsba.service';
import { ACTIVE_STATUSES, ASSET_CONDITION, ASSET_STATUS, TX_TYPES } from './asset-constants';
import { bookValueOf, METHOD_LABEL, projectSchedule } from './depreciation';

export type AssetRow = typeof assets.$inferSelect;

/* ------------------------------------------------------------------ Trường nhập */
type F = 'text' | 'int' | 'intOrNull' | 'money' | 'rate' | 'date' | 'bool' | 'tags' | 'json';
/** Trường sửa tự do trên hồ sơ */
const EDITABLE: Record<string, F> = {
  name: 'text', barcode: 'text', categoryId: 'intOrNull', kind: 'text', model: 'text', serialNumber: 'text',
  manufacturerId: 'intOrNull', supplierId: 'intOrNull', countryOfOrigin: 'text', yearOfManufacture: 'intOrNull',
  specifications: 'text', unit: 'text', fundingSourceId: 'intOrNull', fundingBreakdown: 'json',
  acquisitionDate: 'date', invoiceNo: 'text', contractNo: 'text', warrantyUntil: 'date',
  depreciationMethod: 'text', usefulLifeMonths: 'int', annualRate: 'rate', depreciationStartDate: 'date',
  residualValue: 'money', condition: 'text', parentId: 'intOrNull', riskClass: 'text', registrationNo: 'text',
  requiresCalibration: 'bool', calibrationIntervalMonths: 'int', lastCalibrationDate: 'date', nextCalibrationDate: 'date',
  maintenanceIntervalMonths: 'int', lastMaintenanceDate: 'date', nextMaintenanceDate: 'date',
  attributes: 'json', tags: 'tags', imageUrl: 'text', note: 'text',
};
/** Trường chỉ sửa trực tiếp khi tài sản CHƯA phát sinh nghiệp vụ (nhập số dư ban đầu); sau đó phải qua chứng từ */
const CONTROLLED: Record<string, F> = {
  code: 'text', status: 'text', quantity: 'int', originalCost: 'money', openingAccumulated: 'money', openingDate: 'date',
  inUseDate: 'date', departmentId: 'intOrNull', locationId: 'intOrNull', custodianId: 'intOrNull', custodianName: 'text',
};
const LABEL: Record<string, string> = {
  code: 'Mã', name: 'Tên', status: 'Trạng thái', originalCost: 'Nguyên giá', departmentId: 'Khoa/phòng', locationId: 'Vị trí',
  custodianName: 'Người giữ', condition: 'Tình trạng', serialNumber: 'Số serial', model: 'Model', categoryId: 'Loại',
  usefulLifeMonths: 'Thời gian sử dụng (tháng)', annualRate: 'Tỉ lệ hao mòn', depreciationMethod: 'Phương pháp',
  openingAccumulated: 'Hao mòn luỹ kế đầu kỳ', nextCalibrationDate: 'Hạn kiểm định', nextMaintenanceDate: 'Hạn bảo dưỡng',
  warrantyUntil: 'Bảo hành đến', quantity: 'Số lượng', inUseDate: 'Ngày đưa vào sử dụng',
};

const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
export const todayISO = () => {
  const d = new Date(Date.now() + 7 * 3600_000); // giờ Việt Nam
  return d.toISOString().slice(0, 10);
};
export function addMonthsISO(date: string, months: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(d, last));
  return t.toISOString().slice(0, 10);
}

function cleanValue(type: F, v: unknown, key: string): unknown {
  switch (type) {
    case 'text':
      return String(v ?? '').trim();
    case 'int':
      return Math.max(0, Math.trunc(Number(v) || 0));
    case 'intOrNull':
      return v === null || v === '' || v === undefined || !(Number(v) > 0) ? null : Math.trunc(Number(v));
    case 'money': {
      const n = Number(String(v ?? 0).replace(/[^\d.-]/g, ''));
      if (!Number.isFinite(n) || n < 0) throw new BadRequestException(`${LABEL[key] ?? key}: số tiền không hợp lệ`);
      return Math.round(n * 100) / 100;
    }
    case 'rate': {
      const n = Number(v) || 0;
      if (n < 0 || n > 100) throw new BadRequestException('Tỉ lệ hao mòn phải từ 0 đến 100%/năm');
      return n;
    }
    case 'date': {
      const s = String(v ?? '').trim();
      if (!s) return null;
      if (!isDate(s)) throw new BadRequestException(`${LABEL[key] ?? key}: ngày không hợp lệ (${s})`);
      return s;
    }
    case 'bool':
      return v === true || v === 'true' || v === 1 || v === '1';
    case 'tags':
      return (Array.isArray(v) ? v : String(v ?? '').split(',')).map((x) => String(x).trim()).filter(Boolean);
    case 'json':
      return v && typeof v === 'object' ? v : type === 'json' && Array.isArray(v) ? v : {};
  }
}

export interface AssetListQuery {
  q?: string;
  page?: number;
  pageSize?: number;
  all?: boolean;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  status?: string; // có thể nhiều, cách nhau dấu phẩy; 'ACTIVE' = đang theo dõi
  categoryId?: number;
  locationId?: number;
  departmentId?: number;
  fundingSourceId?: number;
  supplierId?: number;
  group?: string;
  kind?: string;
  condition?: string;
  custodianId?: number;
  due?: 'calibration' | 'maintenance' | 'warranty' | 'overdue';
  dueDays?: number;
  costMin?: number;
  costMax?: number;
  acquiredFrom?: string;
  acquiredTo?: string;
  ids?: string;
  includeDeleted?: boolean;
}

@Injectable()
export class AssetsService {
  constructor(private readonly db: DbService) {}

  /* ------------------------------------------------------------ Phạm vi */
  canSeeAll(user: AccessContext) {
    return user.isSuperAdmin || user.permissions.includes('asset.view-all');
  }

  scopeDeptIds(user: AccessContext): number[] {
    const ids = new Set(user.departmentIds ?? []);
    if (user.departmentId) ids.add(user.departmentId);
    return [...ids];
  }

  scopeCondition(user: AccessContext): SQL | undefined {
    if (this.canSeeAll(user)) return undefined;
    const ids = this.scopeDeptIds(user);
    return (ids.length ? or(inArray(assets.departmentId, ids), eq(assets.custodianId, user.id)) : eq(assets.custodianId, user.id)) as SQL;
  }

  assertInScope(user: AccessContext, a: Pick<AssetRow, 'departmentId' | 'custodianId' | 'code'>) {
    if (this.canSeeAll(user)) return;
    if (a.custodianId === user.id) return;
    if (a.departmentId && this.scopeDeptIds(user).includes(a.departmentId)) return;
    throw new ForbiddenException(`Tài sản ${a.code} không thuộc phạm vi khoa/phòng của bạn`);
  }

  /* ------------------------------------------------------------ Biểu thức dùng chung */
  readonly bookValueExpr = sql<number>`greatest(0, ${assets.originalCost} - ${assets.accumulatedDepreciation})::float8`;

  private selection() {
    const mf = alias(assetSuppliers, 'mf');
    return {
      mf,
      fields: {
        id: assets.id,
        code: assets.code,
        barcode: assets.barcode,
        name: assets.name,
        kind: assets.kind,
        model: assets.model,
        serialNumber: assets.serialNumber,
        unit: assets.unit,
        quantity: assets.quantity,
        status: assets.status,
        condition: assets.condition,
        categoryId: assets.categoryId,
        categoryName: assetCategories.name,
        categoryCode: assetCategories.code,
        group: assetCategories.group,
        departmentId: assets.departmentId,
        departmentName: departments.name,
        locationId: assets.locationId,
        locationName: assetLocations.name,
        custodianId: assets.custodianId,
        custodianName: assets.custodianName,
        supplierId: assets.supplierId,
        supplierName: assetSuppliers.name,
        manufacturerId: assets.manufacturerId,
        manufacturerName: mf.name,
        countryOfOrigin: assets.countryOfOrigin,
        yearOfManufacture: assets.yearOfManufacture,
        fundingSourceId: assets.fundingSourceId,
        fundingSourceName: assetFundingSources.name,
        originalCost: assets.originalCost,
        accumulatedDepreciation: assets.accumulatedDepreciation,
        bookValue: this.bookValueExpr,
        depreciationMethod: assets.depreciationMethod,
        usefulLifeMonths: assets.usefulLifeMonths,
        annualRate: assets.annualRate,
        acquisitionDate: assets.acquisitionDate,
        inUseDate: assets.inUseDate,
        warrantyUntil: assets.warrantyUntil,
        requiresCalibration: assets.requiresCalibration,
        nextCalibrationDate: assets.nextCalibrationDate,
        nextMaintenanceDate: assets.nextMaintenanceDate,
        lastDepreciationPeriod: assets.lastDepreciationPeriod,
        riskClass: assets.riskClass,
        tags: assets.tags,
        parentId: assets.parentId,
        lastInventoryAt: assets.lastInventoryAt,
        createdAt: assets.createdAt,
        updatedAt: assets.updatedAt,
        deletedAt: assets.deletedAt,
      },
    };
  }

  private joined(executor: Executor = this.db.db) {
    const { mf, fields } = this.selection();
    return executor
      .select(fields)
      .from(assets)
      .leftJoin(assetCategories, eq(assetCategories.id, assets.categoryId))
      .leftJoin(departments, eq(departments.id, assets.departmentId))
      .leftJoin(assetLocations, eq(assetLocations.id, assets.locationId))
      .leftJoin(assetSuppliers, eq(assetSuppliers.id, assets.supplierId))
      .leftJoin(mf, eq(mf.id, assets.manufacturerId))
      .leftJoin(assetFundingSources, eq(assetFundingSources.id, assets.fundingSourceId));
  }

  /** Điều kiện lọc (dùng chung cho danh sách, xuất Excel, in tem, thống kê) */
  buildWhere(query: AssetListQuery, user: AccessContext): SQL[] {
    const w: SQL[] = [];
    if (!query.includeDeleted) w.push(isNull(assets.deletedAt));
    const scope = this.scopeCondition(user);
    if (scope) w.push(scope);
    const kw = query.q?.trim();
    if (kw) {
      const loose = `%${normalizeVN(kw)}%`;
      const like = `%${kw}%`;
      w.push(or(sql`${assets.searchText} like ${loose}`, ilike(assets.code, like), ilike(assets.barcode, like), ilike(assets.serialNumber, like)) as SQL);
    }
    if (query.ids) {
      const ids = String(query.ids).split(',').map(Number).filter((n) => n > 0);
      if (ids.length) w.push(inArray(assets.id, ids));
    }
    if (query.status) {
      const list = String(query.status).split(',').flatMap((s) => (s === 'ACTIVE' ? ACTIVE_STATUSES : [s])).filter(Boolean);
      if (list.length) w.push(inArray(assets.status, list as never[]));
    }
    if (query.categoryId) {
      w.push(sql`${assets.categoryId} in (select id from ${assetCategories} where path like (select path from ${assetCategories} where id = ${Number(query.categoryId)}) || '%')`);
    }
    if (query.locationId) {
      w.push(sql`${assets.locationId} in (select id from ${assetLocations} where path like (select path from ${assetLocations} where id = ${Number(query.locationId)}) || '%')`);
    }
    if (query.departmentId) w.push(Number(query.departmentId) === -1 ? isNull(assets.departmentId) : eq(assets.departmentId, Number(query.departmentId)));
    if (query.fundingSourceId) w.push(eq(assets.fundingSourceId, Number(query.fundingSourceId)));
    if (query.supplierId) w.push(or(eq(assets.supplierId, Number(query.supplierId)), eq(assets.manufacturerId, Number(query.supplierId))) as SQL);
    if (query.custodianId) w.push(eq(assets.custodianId, Number(query.custodianId)));
    if (query.group) w.push(sql`${assets.categoryId} in (select id from ${assetCategories} where group_code = ${query.group})`);
    if (query.kind) w.push(eq(assets.kind, query.kind));
    if (query.condition) w.push(eq(assets.condition, query.condition));
    if (query.costMin !== undefined && String(query.costMin) !== '') w.push(gte(assets.originalCost, Number(query.costMin)));
    if (query.costMax !== undefined && String(query.costMax) !== '') w.push(lte(assets.originalCost, Number(query.costMax)));
    if (query.acquiredFrom && isDate(query.acquiredFrom)) w.push(gte(assets.acquisitionDate, query.acquiredFrom));
    if (query.acquiredTo && isDate(query.acquiredTo)) w.push(lte(assets.acquisitionDate, query.acquiredTo));
    if (query.due) {
      const today = todayISO();
      const until = addMonthsISO(today, 0);
      const days = Math.max(0, Number(query.dueDays ?? 30));
      const end = sql`(${until}::date + ${days}::int)`;
      w.push(inArray(assets.status, ACTIVE_STATUSES as never[]));
      if (query.due === 'calibration') w.push(sql`${assets.nextCalibrationDate} is not null and ${assets.nextCalibrationDate} <= ${end}`);
      if (query.due === 'maintenance') w.push(sql`${assets.nextMaintenanceDate} is not null and ${assets.nextMaintenanceDate} <= ${end}`);
      if (query.due === 'warranty') w.push(sql`${assets.warrantyUntil} is not null and ${assets.warrantyUntil} between ${today}::date and ${end}`);
      if (query.due === 'overdue') {
        w.push(sql`(${assets.nextCalibrationDate} < ${today}::date or ${assets.nextMaintenanceDate} < ${today}::date)`);
      }
    }
    return w;
  }

  private orderOf(query: AssetListQuery) {
    const cols: Record<string, unknown> = {
      code: assets.code, name: assets.name, status: assets.status, originalCost: assets.originalCost,
      bookValue: this.bookValueExpr, acquisitionDate: assets.acquisitionDate, departmentName: departments.name,
      categoryName: assetCategories.name, nextCalibrationDate: assets.nextCalibrationDate,
      nextMaintenanceDate: assets.nextMaintenanceDate, warrantyUntil: assets.warrantyUntil, createdAt: assets.createdAt,
      updatedAt: assets.updatedAt,
    };
    const col = cols[query.sortBy ?? ''] as SQL | undefined;
    if (!col) return [desc(assets.id)];
    return [query.sortDir === 'asc' ? sql`${col} asc nulls last` : sql`${col} desc nulls last`, desc(assets.id)];
  }

  async list(query: AssetListQuery, user: AccessContext) {
    const where = and(...this.buildWhere(query, user));
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = query.all ? 20_000 : Math.min(500, Math.max(1, Number(query.pageSize) || 20));
    const [agg] = await this.db.db
      .select({
        total: sql<number>`count(*)::int`,
        cost: sql<number>`coalesce(sum(${assets.originalCost}),0)::float8`,
        accumulated: sql<number>`coalesce(sum(${assets.accumulatedDepreciation}),0)::float8`,
        bookValue: sql<number>`coalesce(sum(greatest(0, ${assets.originalCost} - ${assets.accumulatedDepreciation})),0)::float8`,
      })
      .from(assets)
      .where(where);
    const rows = await this.joined()
      .where(where)
      .orderBy(...(this.orderOf(query) as never[]))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    return { ...buildPage(rows, agg?.total ?? 0, page, pageSize), summary: agg };
  }

  /** Lấy bản ghi thô + kiểm tra phạm vi */
  async getRaw(id: number, user?: AccessContext, executor: Executor = this.db.db): Promise<AssetRow> {
    const [a] = await executor.select().from(assets).where(and(eq(assets.id, id), isNull(assets.deletedAt)));
    if (!a) throw new NotFoundException('Không tìm thấy tài sản');
    if (user) this.assertInScope(user, a);
    return a;
  }

  async detail(id: number, user: AccessContext) {
    const raw = await this.getRaw(id, user);
    const [row] = await this.joined().where(eq(assets.id, id));
    const [children, parent, events, txs, lines] = await Promise.all([
      this.joined().where(and(eq(assets.parentId, id), isNull(assets.deletedAt))).orderBy(asc(assets.code)),
      raw.parentId ? this.joined().where(eq(assets.id, raw.parentId)).then((r) => r[0] ?? null) : Promise.resolve(null),
      this.db.db.select().from(assetEvents).where(eq(assetEvents.assetId, id)).orderBy(desc(assetEvents.createdAt), desc(assetEvents.id)).limit(300),
      this.db.db
        .select({
          id: assetTransactions.id, code: assetTransactions.code, type: assetTransactions.type, txDate: assetTransactions.txDate,
          status: assetTransactions.status, reason: assetTransactions.reason, amount: assetTransactionItems.amount,
          itemNote: assetTransactionItems.note,
        })
        .from(assetTransactionItems)
        .innerJoin(assetTransactions, eq(assetTransactions.id, assetTransactionItems.transactionId))
        .where(eq(assetTransactionItems.assetId, id))
        .orderBy(desc(assetTransactions.txDate), desc(assetTransactions.id)),
      this.db.db
        .select({
          id: assetDepreciationLines.id, period: assetDepreciationRuns.period, periodType: assetDepreciationRuns.periodType,
          amount: assetDepreciationLines.amount, accumulatedAfter: assetDepreciationLines.accumulatedAfter,
          bookValueAfter: assetDepreciationLines.bookValueAfter, runId: assetDepreciationRuns.id,
        })
        .from(assetDepreciationLines)
        .innerJoin(assetDepreciationRuns, eq(assetDepreciationRuns.id, assetDepreciationLines.runId))
        .where(and(eq(assetDepreciationLines.assetId, id), eq(assetDepreciationRuns.status, 'DA_CHOT')))
        .orderBy(desc(assetDepreciationRuns.period)),
    ]);
    const startDate = raw.depreciationStartDate ?? raw.inUseDate ?? raw.acquisitionDate;
    const schedule = ACTIVE_STATUSES.includes(raw.status)
      ? projectSchedule(
          { ...raw, startDate, accumulated: raw.accumulatedDepreciation },
          raw.lastDepreciationPeriod
            ? nextPeriodAfter(raw.lastDepreciationPeriod)
            : raw.openingDate
              ? nextPeriodAfter(raw.depreciationMethod === 'STRAIGHT_LINE_YEARLY' ? raw.openingDate.slice(0, 4) : raw.openingDate.slice(0, 7))
              : (startDate ?? todayISO()).slice(0, raw.depreciationMethod === 'STRAIGHT_LINE_YEARLY' ? 4 : 7),
        )
      : [];
    const locked = await this.hasHistory(id);
    return {
      ...row,
      raw,
      methodLabel: METHOD_LABEL[raw.depreciationMethod] ?? raw.depreciationMethod,
      statusLabel: ASSET_STATUS[raw.status]?.label ?? raw.status,
      conditionLabel: ASSET_CONDITION[raw.condition] ?? raw.condition,
      depreciationRemaining: Math.max(0, raw.originalCost - raw.accumulatedDepreciation),
      parent,
      children,
      events,
      transactions: txs.map((t) => ({ ...t, typeLabel: TX_TYPES[t.type]?.label ?? t.type })),
      depreciation: lines,
      schedule,
      locked,
    };
  }

  /** Đã có chứng từ được duyệt hoặc đã chốt khấu hao → khoá các trường nhạy cảm */
  async hasHistory(id: number, executor: Executor = this.db.db): Promise<boolean> {
    const [r] = await executor.execute<{ n: number }>(sql`
      select (exists(select 1 from ${assetTransactionItems} i join ${assetTransactions} t on t.id = i.transaction_id
                     where i.asset_id = ${id} and t.status = 'DA_DUYET' and t.type <> 'GHI_TANG')
           or exists(select 1 from ${assetDepreciationLines} l join ${assetDepreciationRuns} r on r.id = l.run_id
                     where l.asset_id = ${id} and r.status = 'DA_CHOT'))::int as n`).then((r) => r.rows);
    return Number(r?.n) > 0;
  }

  /** Tìm nhanh theo mã tài sản / mã vạch / số serial (quét mã, URL QR /ts/<mã>) */
  async lookup(code: string, user: AccessContext) {
    const c = code.trim();
    if (!c) throw new BadRequestException('Chưa nhập mã');
    const [a] = await this.db.db
      .select({ id: assets.id, departmentId: assets.departmentId, custodianId: assets.custodianId, code: assets.code })
      .from(assets)
      .where(and(isNull(assets.deletedAt), or(sql`lower(${assets.code}) = lower(${c})`, sql`lower(${assets.barcode}) = lower(${c})`, sql`lower(${assets.serialNumber}) = lower(${c})`)))
      .orderBy(sql`case when lower(${assets.code}) = lower(${c}) then 0 when lower(${assets.barcode}) = lower(${c}) then 1 else 2 end`)
      .limit(1);
    if (!a) throw new NotFoundException(`Không tìm thấy tài sản có mã "${c}"`);
    this.assertInScope(user, a);
    const [row] = await this.joined().where(eq(assets.id, a.id));
    return row;
  }

  /* ------------------------------------------------------------ Sinh mã */
  async nextCode(tx: Executor, prefix: string, year: number, count = 1): Promise<string[]> {
    const p = (prefix || 'TS').toUpperCase().replace(/[^A-Z0-9-]/g, '') || 'TS';
    const head = `${p}.${year}.`;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('asset_code'), hashtext(${head}))`);
    const [r] = await tx
      .execute<{ n: number }>(sql`select coalesce(max(nullif(regexp_replace(substr(code, ${head.length + 1}), '\\D', '', 'g'), '')::int), 0) as n
        from ${assets} where upper(code) like ${head + '%'}`)
      .then((x) => x.rows);
    const start = Number(r?.n ?? 0);
    return Array.from({ length: count }, (_, i) => `${head}${String(start + i + 1).padStart(4, '0')}`);
  }

  buildSearch(a: Partial<AssetRow>, extra: string[] = []) {
    return normalizeVN([a.code, a.name, a.model, a.serialNumber, a.barcode, a.custodianName, a.registrationNo, a.specifications?.slice(0, 200), ...(a.tags ?? []), ...extra].filter(Boolean).join(' '));
  }

  async addEvent(
    tx: Executor,
    assetId: number,
    eventType: string,
    title: string,
    detail: Record<string, unknown>,
    user?: Pick<AccessContext, 'id' | 'fullName'> | null,
    transactionId?: number,
  ) {
    await tx.insert(assetEvents).values({ assetId, eventType, title, detail, transactionId: transactionId ?? null, userId: user?.id ?? null, userName: user?.fullName ?? 'Hệ thống' });
  }

  /* ------------------------------------------------------------ Thêm / sửa / xoá */
  private async categoryDefaults(tx: Executor, categoryId: number | null) {
    if (!categoryId) return null;
    const [c] = await tx.select().from(assetCategories).where(eq(assetCategories.id, categoryId));
    if (!c) throw new BadRequestException('Loại tài sản không tồn tại');
    return c;
  }

  private cleanBody(body: Record<string, unknown>, allowControlled: boolean) {
    const out: Record<string, unknown> = {};
    const spec = allowControlled ? { ...EDITABLE, ...CONTROLLED } : EDITABLE;
    for (const [k, t] of Object.entries(spec)) if (k in body) out[k] = cleanValue(t, body[k], k);
    if ('status' in out && !(String(out.status) in ASSET_STATUS)) throw new BadRequestException('Trạng thái không hợp lệ');
    if ('condition' in out && out.condition && !(String(out.condition) in ASSET_CONDITION)) throw new BadRequestException('Tình trạng không hợp lệ');
    if ('depreciationMethod' in out && !(String(out.depreciationMethod) in METHOD_LABEL)) throw new BadRequestException('Phương pháp khấu hao không hợp lệ');
    if ('fundingBreakdown' in out) {
      const arr = Array.isArray(out.fundingBreakdown) ? (out.fundingBreakdown as { sourceId: unknown; amount: unknown }[]) : [];
      out.fundingBreakdown = arr.map((x) => ({ sourceId: Number(x.sourceId) || 0, amount: Number(x.amount) || 0 })).filter((x) => x.sourceId > 0 && x.amount > 0);
    }
    if ('code' in out) out.code = String(out.code).trim().toUpperCase();
    return out;
  }

  private async assertUniqueCode(tx: Executor, code: string, exceptId?: number) {
    if (!code) return;
    const [dup] = await tx
      .select({ id: assets.id })
      .from(assets)
      .where(and(sql`lower(${assets.code}) = lower(${code})`, exceptId ? sql`${assets.id} <> ${exceptId}` : undefined));
    if (dup) throw new ConflictException(`Mã tài sản "${code}" đã tồn tại`);
  }

  /** Ngày kế tiếp theo chu kỳ (nếu chưa nhập) */
  private fillDueDates(d: Record<string, unknown>) {
    if (!d.nextCalibrationDate && d.lastCalibrationDate && Number(d.calibrationIntervalMonths) > 0) {
      d.nextCalibrationDate = addMonthsISO(String(d.lastCalibrationDate), Number(d.calibrationIntervalMonths));
    }
    if (!d.nextMaintenanceDate && Number(d.maintenanceIntervalMonths) > 0) {
      const base = (d.lastMaintenanceDate ?? d.inUseDate ?? d.acquisitionDate) as string | null;
      if (base) d.nextMaintenanceDate = addMonthsISO(base, Number(d.maintenanceIntervalMonths));
    }
  }

  /**
   * Thêm tài sản. `copies` > 1 → tạo nhiều tài sản giống nhau (mỗi cái một mã, vd 20 máy tính cùng lô).
   * Lô nhiều tài sản dùng chung nguyên giá từng chiếc.
   */
  async create(body: Record<string, unknown>, user: AccessContext) {
    const copies = Math.min(500, Math.max(1, Math.trunc(Number(body.copies) || 1)));
    const data = this.cleanBody(body, true);
    if (!data.name) throw new BadRequestException('Chưa nhập tên tài sản');
    if (!this.canSeeAll(user)) {
      const deptIds = this.scopeDeptIds(user);
      if (!data.departmentId || !deptIds.includes(Number(data.departmentId))) {
        throw new ForbiddenException('Bạn chỉ được thêm tài sản cho khoa/phòng trong phạm vi của mình');
      }
    }
    const ids = await this.db.db.transaction(async (tx) => {
      const cat = await this.categoryDefaults(tx, (data.categoryId as number) ?? null);
      // Kế thừa mặc định từ loại tài sản cho các trường chưa nhập
      if (cat) {
        if (!('kind' in body)) data.kind = cat.kind;
        if (!('depreciationMethod' in body)) data.depreciationMethod = cat.depreciationMethod;
        if (!('usefulLifeMonths' in body)) data.usefulLifeMonths = cat.usefulLifeMonths;
        if (!('annualRate' in body)) data.annualRate = cat.annualRate;
        if (!('requiresCalibration' in body)) data.requiresCalibration = cat.requiresCalibration;
        if (!('calibrationIntervalMonths' in body)) data.calibrationIntervalMonths = cat.calibrationIntervalMonths;
        if (!('maintenanceIntervalMonths' in body)) data.maintenanceIntervalMonths = cat.maintenanceIntervalMonths;
      }
      if (!data.status) data.status = data.departmentId ? 'DANG_SU_DUNG' : 'TRONG_KHO';
      if (data.status === 'DANG_SU_DUNG' && !data.inUseDate) data.inUseDate = data.acquisitionDate ?? todayISO();
      if (!data.acquisitionDate) data.acquisitionDate = todayISO();
      if (Number(data.openingAccumulated) > Number(data.originalCost ?? 0)) throw new BadRequestException('Hao mòn luỹ kế đầu kỳ không được lớn hơn nguyên giá');
      if (Number(data.openingAccumulated) > 0 && !data.openingDate) data.openingDate = todayISO();
      this.fillDueDates(data);
      if (data.custodianId && !data.custodianName) {
        const [u] = await tx.select({ fullName: users.fullName }).from(users).where(eq(users.id, Number(data.custodianId)));
        data.custodianName = u?.fullName ?? '';
      }
      const year = Number(String(data.acquisitionDate).slice(0, 4)) || new Date().getFullYear();
      let codes: string[];
      if (data.code && copies === 1) {
        await this.assertUniqueCode(tx, data.code as string);
        codes = [data.code as string];
      } else {
        codes = await this.nextCode(tx, cat?.codePrefix || String(data.code || '') || 'TS', year, copies);
      }
      const created: number[] = [];
      for (const code of codes) {
        const row = {
          ...data,
          code,
          barcode: copies > 1 ? '' : ((data.barcode as string) ?? ''),
          serialNumber: copies > 1 ? '' : ((data.serialNumber as string) ?? ''),
          accumulatedDepreciation: Number(data.openingAccumulated ?? 0),
          createdBy: user.id,
          updatedBy: user.id,
        } as Record<string, unknown>;
        row.searchText = this.buildSearch(row as Partial<AssetRow>);
        const [r] = await tx.insert(assets).values(row as never).returning({ id: assets.id });
        created.push(r.id);
        await this.addEvent(tx, r.id, 'CREATED', copies > 1 ? `Thêm mới (lô ${copies} tài sản)` : 'Thêm mới tài sản', {
          code, originalCost: row.originalCost ?? 0, status: row.status, departmentId: row.departmentId ?? null,
        }, user);
      }
      return created;
    });
    if (ids.length === 1) return this.detail(ids[0], user);
    return { ids, count: ids.length };
  }

  async update(id: number, body: Record<string, unknown>, user: AccessContext) {
    const cur = await this.getRaw(id, user);
    const locked = await this.hasHistory(id);
    const data = this.cleanBody(body, !locked);
    const blocked = Object.keys(CONTROLLED).filter((k) => k in body && !(k in data) && (body as Record<string, unknown>)[k] !== (cur as Record<string, unknown>)[k]);
    if (locked && blocked.length) {
      const changed = blocked.filter((k) => String(body[k] ?? '') !== String((cur as Record<string, unknown>)[k] ?? ''));
      if (changed.length) {
        throw new BadRequestException(
          `Tài sản đã phát sinh nghiệp vụ — không sửa trực tiếp: ${changed.map((k) => LABEL[k] ?? k).join(', ')}. Hãy lập chứng từ (điều chuyển, đánh giá lại…).`,
        );
      }
    }
    if (data.parentId === id) throw new BadRequestException('Tài sản không thể là thành phần của chính nó');
    if (!this.canSeeAll(user) && 'departmentId' in data && data.departmentId !== cur.departmentId) {
      if (!data.departmentId || !this.scopeDeptIds(user).includes(Number(data.departmentId))) throw new ForbiddenException('Không thể chuyển tài sản ra ngoài phạm vi khoa của bạn');
    }
    if ('openingAccumulated' in data || 'originalCost' in data) {
      const cost = Number(data.originalCost ?? cur.originalCost);
      const open = Number(data.openingAccumulated ?? cur.openingAccumulated);
      if (open > cost) throw new BadRequestException('Hao mòn luỹ kế đầu kỳ không được lớn hơn nguyên giá');
      data.accumulatedDepreciation = open; // chưa có kỳ khấu hao nào (vì chưa bị khoá)
    }
    const merged = { ...cur, ...data } as Record<string, unknown>;
    if (('lastCalibrationDate' in data || 'calibrationIntervalMonths' in data) && !('nextCalibrationDate' in body)) merged.nextCalibrationDate = null;
    if (('lastMaintenanceDate' in data || 'maintenanceIntervalMonths' in data) && !('nextMaintenanceDate' in body)) merged.nextMaintenanceDate = null;
    this.fillDueDates(merged);
    for (const k of ['nextCalibrationDate', 'nextMaintenanceDate']) if (merged[k] !== (cur as Record<string, unknown>)[k]) data[k] = merged[k];
    if ('custodianId' in data && data.custodianId && !('custodianName' in body)) {
      const [u] = await this.db.db.select({ fullName: users.fullName }).from(users).where(eq(users.id, Number(data.custodianId)));
      data.custodianName = u?.fullName ?? '';
    }
    if (data.code) await this.assertUniqueCode(this.db.db, data.code as string, id);
    // Ghi lại các trường thay đổi
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const [k, v] of Object.entries(data)) {
      const before = (cur as Record<string, unknown>)[k];
      if (JSON.stringify(before ?? null) !== JSON.stringify(v ?? null)) changes[k] = { from: before ?? null, to: v ?? null };
    }
    if (!Object.keys(changes).length) return this.detail(id, user);
    await this.db.db.transaction(async (tx) => {
      const next = { ...cur, ...data } as Partial<AssetRow>;
      await tx.update(assets).set({ ...data, searchText: this.buildSearch(next), updatedBy: user.id, updatedAt: new Date() } as never).where(eq(assets.id, id));
      const names = Object.keys(changes).map((k) => LABEL[k] ?? k);
      await this.addEvent(tx, id, 'UPDATED', `Cập nhật hồ sơ: ${names.slice(0, 5).join(', ')}${names.length > 5 ? '…' : ''}`, { changes }, user);
    });
    return this.detail(id, user);
  }

  async remove(id: number, user: AccessContext) {
    const cur = await this.getRaw(id, user);
    if (await this.hasHistory(id)) {
      throw new ConflictException('Tài sản đã phát sinh nghiệp vụ/khấu hao — không xoá được. Hãy lập chứng từ Thanh lý hoặc Báo mất.');
    }
    const [pending] = await this.db.db
      .select({ code: assetTransactions.code })
      .from(assetTransactionItems)
      .innerJoin(assetTransactions, eq(assetTransactions.id, assetTransactionItems.transactionId))
      .where(and(eq(assetTransactionItems.assetId, id), inArray(assetTransactions.status, ['NHAP', 'CHO_DUYET', 'TU_CHOI'])))
      .limit(1);
    if (pending) throw new ConflictException(`Tài sản đang nằm trong chứng từ ${pending.code} — hãy bỏ khỏi chứng từ trước`);
    await this.db.db.transaction(async (tx) => {
      // Đổi mã khi xoá mềm để giải phóng mã cho tài sản khác
      await tx.update(assets).set({ deletedAt: new Date(), code: `${cur.code}~DEL${id}`, updatedBy: user.id }).where(eq(assets.id, id));
      await tx.update(assets).set({ parentId: null }).where(eq(assets.parentId, id));
      await this.addEvent(tx, id, 'DELETED', 'Xoá tài sản', { code: cur.code }, user);
    });
    return { id };
  }

  /* ------------------------------------------------------------ Tổng quan */
  async dashboard(user: AccessContext, query: AssetListQuery = {}) {
    const base = this.buildWhere({ ...query, status: query.status || undefined }, user);
    const where = and(...base);
    const active = and(...base, inArray(assets.status, ACTIVE_STATUSES as never[]));
    const today = todayISO();
    const in30 = addMonthsISO(today, 1);
    const q = <T>(s: SQL) => this.db.db.execute(s).then((r) => r.rows as T[]);

    const [totals] = await this.db.db
      .select({
        count: sql<number>`count(*)::int`,
        activeCount: sql<number>`count(*) filter (where ${assets.status} in ('TRONG_KHO','DANG_SU_DUNG','DANG_SUA_CHUA','HONG','CHO_THANH_LY'))::int`,
        cost: sql<number>`coalesce(sum(${assets.originalCost}) filter (where ${assets.status} not in ('DA_THANH_LY','MAT')),0)::float8`,
        accumulated: sql<number>`coalesce(sum(${assets.accumulatedDepreciation}) filter (where ${assets.status} not in ('DA_THANH_LY','MAT')),0)::float8`,
        bookValue: sql<number>`coalesce(sum(greatest(0, ${assets.originalCost} - ${assets.accumulatedDepreciation})) filter (where ${assets.status} not in ('DA_THANH_LY','MAT')),0)::float8`,
        fullyDepreciated: sql<number>`count(*) filter (where ${assets.status} not in ('DA_THANH_LY','MAT') and ${assets.depreciationMethod} <> 'NONE' and ${assets.originalCost} > 0 and ${assets.accumulatedDepreciation} >= ${assets.originalCost} - (case when ${assets.depreciationMethod} = 'STRAIGHT_LINE_YEARLY' then 0 else ${assets.residualValue} end))::int`,
        broken: sql<number>`count(*) filter (where ${assets.status} = 'HONG')::int`,
        repairing: sql<number>`count(*) filter (where ${assets.status} = 'DANG_SUA_CHUA')::int`,
        calOverdue: sql<number>`count(*) filter (where ${assets.status} in ('TRONG_KHO','DANG_SU_DUNG','DANG_SUA_CHUA','HONG') and ${assets.nextCalibrationDate} < ${today}::date)::int`,
        calDue30: sql<number>`count(*) filter (where ${assets.status} in ('TRONG_KHO','DANG_SU_DUNG','DANG_SUA_CHUA','HONG') and ${assets.nextCalibrationDate} between ${today}::date and ${in30}::date)::int`,
        mtOverdue: sql<number>`count(*) filter (where ${assets.status} in ('TRONG_KHO','DANG_SU_DUNG','DANG_SUA_CHUA','HONG') and ${assets.nextMaintenanceDate} < ${today}::date)::int`,
        mtDue30: sql<number>`count(*) filter (where ${assets.status} in ('TRONG_KHO','DANG_SU_DUNG','DANG_SUA_CHUA','HONG') and ${assets.nextMaintenanceDate} between ${today}::date and ${in30}::date)::int`,
        warrantyDue30: sql<number>`count(*) filter (where ${assets.status} in ('TRONG_KHO','DANG_SU_DUNG','DANG_SUA_CHUA','HONG') and ${assets.warrantyUntil} between ${today}::date and ${in30}::date)::int`,
        noInventory12m: sql<number>`count(*) filter (where ${assets.status} in ('TRONG_KHO','DANG_SU_DUNG','DANG_SUA_CHUA','HONG') and (${assets.lastInventoryAt} is null or ${assets.lastInventoryAt} < now() - interval '12 months'))::int`,
      })
      .from(assets)
      .where(where);

    const groupBy = (keyExpr: SQL, labelExpr: SQL, joins: SQL, cond: SQL | undefined, limit = 50) =>
      q<{ key: string; label: string; count: number; cost: number; bookValue: number }>(sql`
        select ${keyExpr} as key, ${labelExpr} as label, count(*)::int as count,
               coalesce(sum(assets.original_cost),0)::float8 as cost,
               coalesce(sum(greatest(0, assets.original_cost - assets.accumulated_depreciation)),0)::float8 as "bookValue"
        from ${assets} ${joins}
        where ${cond ?? sql`true`}
        group by 1, 2 order by cost desc, count desc limit ${limit}`);

    const [byStatus, byGroup, byDepartment, byCategory, byFunding, byYear, byAge, upcoming, pendingTx, recent] = await Promise.all([
      groupBy(sql`assets.status`, sql`assets.status`, sql``, where),
      groupBy(sql`coalesce(c.group_code,'KHAC')`, sql`coalesce(c.group_code,'KHAC')`, sql`left join ${assetCategories} c on c.id = assets.category_id`, active),
      groupBy(sql`coalesce(assets.department_id, 0)`, sql`coalesce(d.name, 'Kho / chưa giao')`, sql`left join ${departments} d on d.id = assets.department_id`, active, 30),
      groupBy(sql`coalesce(r.id, 0)`, sql`coalesce(r.name, 'Chưa phân loại')`, sql`left join ${assetCategories} c on c.id = assets.category_id left join ${assetCategories} r on r.id = nullif(split_part(c.path, '/', 2), '')::int`, active, 30),
      groupBy(sql`coalesce(assets.funding_source_id, 0)`, sql`coalesce(f.name, 'Chưa xác định')`, sql`left join ${assetFundingSources} f on f.id = assets.funding_source_id`, active),
      q<{ year: number; count: number; cost: number }>(sql`
        select extract(year from assets.acquisition_date)::int as year, count(*)::int as count, coalesce(sum(assets.original_cost),0)::float8 as cost
        from ${assets} where ${where ?? sql`true`} and assets.acquisition_date >= (${today}::date - interval '10 years')
        group by 1 order by 1`),
      q<{ bucket: string; count: number; cost: number }>(sql`
        select case when age < 3 then '< 3 năm' when age < 5 then '3–5 năm' when age < 10 then '5–10 năm' else '≥ 10 năm' end as bucket,
               count(*)::int as count, coalesce(sum(original_cost),0)::float8 as cost
        from (select assets.original_cost, extract(year from age(${today}::date, coalesce(assets.in_use_date, assets.acquisition_date)))::int as age
              from ${assets} where ${active ?? sql`true`} and coalesce(assets.in_use_date, assets.acquisition_date) is not null) s
        group by 1 order by min(age)`),
      q<Record<string, unknown>>(sql`
        select * from (
          select assets.id, assets.code, assets.name, 'KIEM_DINH' as kind, assets.next_calibration_date as due, d.name as "departmentName"
          from ${assets} left join ${departments} d on d.id = assets.department_id
          where ${active ?? sql`true`} and assets.next_calibration_date <= (${today}::date + 60)
          union all
          select assets.id, assets.code, assets.name, 'BAO_DUONG', assets.next_maintenance_date, d.name
          from ${assets} left join ${departments} d on d.id = assets.department_id
          where ${active ?? sql`true`} and assets.next_maintenance_date <= (${today}::date + 60)
          union all
          select assets.id, assets.code, assets.name, 'BAO_HANH', assets.warranty_until, d.name
          from ${assets} left join ${departments} d on d.id = assets.department_id
          where ${active ?? sql`true`} and assets.warranty_until between ${today}::date and (${today}::date + 60)
        ) u order by due asc limit 30`),
      this.db.db
        .select({ type: assetTransactions.type, count: sql<number>`count(*)::int` })
        .from(assetTransactions)
        .where(eq(assetTransactions.status, 'CHO_DUYET'))
        .groupBy(assetTransactions.type),
      q<Record<string, unknown>>(sql`
        select e.id, e.asset_id as "assetId", a.code, a.name, e.event_type as "eventType", e.title, e.user_name as "userName", e.created_at as "createdAt"
        from ${assetEvents} e join ${assets} on assets.id = e.asset_id join ${assets} a on a.id = e.asset_id
        where ${where ?? sql`true`} order by e.created_at desc, e.id desc limit 15`),
    ]);

    return {
      totals,
      byStatus: byStatus.map((r) => ({ ...r, label: ASSET_STATUS[r.key]?.label ?? r.key, color: ASSET_STATUS[r.key]?.color })),
      byGroup,
      byDepartment,
      byCategory,
      byFunding,
      byYear,
      byAge,
      upcoming,
      pendingTx: pendingTx.map((p) => ({ ...p, label: TX_TYPES[p.type]?.label ?? p.type })),
      pendingTotal: pendingTx.reduce((s, p) => s + p.count, 0),
      recent,
      generatedAt: new Date().toISOString(),
    };
  }

  /** Gợi ý người dùng/khoa cho ô chọn */
  async options(user: AccessContext) {
    const deptWhere = this.canSeeAll(user) ? isNull(departments.deletedAt) : and(isNull(departments.deletedAt), inArray(departments.id, this.scopeDeptIds(user).length ? this.scopeDeptIds(user) : [-1]));
    const [depts, people] = await Promise.all([
      this.db.db.select({ id: departments.id, code: departments.code, name: departments.name }).from(departments).where(deptWhere).orderBy(asc(departments.sortOrder), asc(departments.name)),
      this.db.db
        .select({ id: users.id, fullName: users.fullName, username: users.username, departmentId: users.departmentId })
        .from(users)
        .where(and(isNull(users.deletedAt), eq(users.active, true)))
        .orderBy(asc(users.fullName)),
    ]);
    return { departments: depts, users: people };
  }
}

/** Kỳ liền sau ('2025' → '2026', '2025-12' → '2026-01') */
export function nextPeriodAfter(p: string): string {
  if (/^\d{4}$/.test(p)) return String(Number(p) + 1);
  const [y, m] = p.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

export { bookValueOf };
export type { Tx };
