/**
 * Chứng từ nghiệp vụ tài sản: Nháp → Chờ duyệt → Đã duyệt (áp dụng vào tài sản) | Từ chối | Huỷ.
 * Duyệt = một giao dịch CSDL: khoá dòng tài sản (FOR UPDATE), kiểm tra lại trạng thái hợp lệ,
 * áp dụng thay đổi, lưu ảnh trước/sau cho từng dòng và ghi dòng thời gian tài sản.
 */
import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, gte, ilike, inArray, lte, ne, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { AccessContext } from '../../common/types/access-context';
import { buildPage } from '../../common/dto/query.dto';
import { DbService, type Executor } from '../../db/db.service';
import {
  assetLocations,
  assets,
  assetSuppliers,
  assetTransactionItems,
  assetTransactions,
  departments,
  notifications,
  permissions,
  rolePermissions,
  userRoles,
  users,
} from '../../db/schema';
import { ASSET_CONDITION, ASSET_STATUS, TX_STATUS, TX_TYPES } from './asset-constants';
import { addMonthsISO, AssetsService, todayISO, type AssetRow } from './assets.service';

interface ItemInput {
  assetId: number;
  amount?: number;
  condition?: string;
  note?: string;
}

const HEADER_FIELDS = [
  'txDate', 'toDepartmentId', 'toLocationId', 'toCustodianId', 'toCustodianName', 'delivererName', 'receiverName',
  'reason', 'decisionNo', 'supplierId', 'note',
] as const;

export interface TxListQuery {
  q?: string;
  type?: string;
  status?: string;
  dateFrom?: string;
  dateTo?: string;
  assetId?: number;
  mine?: boolean | string;
  page?: number;
  pageSize?: number;
}

@Injectable()
export class AssetTransactionsService {
  private readonly logger = new Logger(AssetTransactionsService.name);
  constructor(
    private readonly db: DbService,
    private readonly assetsService: AssetsService,
  ) {}

  meta() {
    return { types: TX_TYPES, statuses: TX_STATUS, conditions: ASSET_CONDITION, assetStatuses: ASSET_STATUS };
  }

  private canApprove(user: AccessContext) {
    return user.isSuperAdmin || user.permissions.includes('asset.transaction.approve');
  }

  /* ------------------------------------------------------------ Danh sách / chi tiết */
  private scope(user: AccessContext): SQL | undefined {
    if (this.assetsService.canSeeAll(user)) return undefined;
    const ids = this.assetsService.scopeDeptIds(user);
    const conds: SQL[] = [eq(assetTransactions.createdBy, user.id)];
    if (ids.length) conds.push(inArray(assetTransactions.fromDepartmentId, ids), inArray(assetTransactions.toDepartmentId, ids));
    return or(...conds) as SQL;
  }

  async list(query: TxListQuery, user: AccessContext) {
    const fromD = alias(departments, 'fd');
    const toD = alias(departments, 'td');
    const creator = alias(users, 'cu');
    const approver = alias(users, 'au');
    const w: SQL[] = [];
    const s = this.scope(user);
    if (s) w.push(s);
    if (query.type) w.push(inArray(assetTransactions.type, String(query.type).split(',') as never[]));
    if (query.status) w.push(inArray(assetTransactions.status, String(query.status).split(',')));
    if (query.dateFrom) w.push(gte(assetTransactions.txDate, query.dateFrom));
    if (query.dateTo) w.push(lte(assetTransactions.txDate, query.dateTo));
    if (query.mine === true || query.mine === 'true') w.push(eq(assetTransactions.createdBy, user.id));
    if (query.assetId) w.push(sql`${assetTransactions.id} in (select transaction_id from ${assetTransactionItems} where asset_id = ${Number(query.assetId)})`);
    if (query.q?.trim()) {
      const like = `%${query.q.trim()}%`;
      w.push(
        or(
          ilike(assetTransactions.code, like),
          ilike(assetTransactions.reason, like),
          ilike(assetTransactions.decisionNo, like),
          sql`${assetTransactions.id} in (select i.transaction_id from ${assetTransactionItems} i join ${assets} a on a.id = i.asset_id where a.code ilike ${like} or a.name ilike ${like})`,
        ) as SQL,
      );
    }
    const where = w.length ? and(...w) : undefined;
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(query.pageSize) || 20));
    const [{ total } = { total: 0 }] = await this.db.db.select({ total: sql<number>`count(*)::int` }).from(assetTransactions).where(where);
    const rows = await this.db.db
      .select({
        id: assetTransactions.id,
        code: assetTransactions.code,
        type: assetTransactions.type,
        txDate: assetTransactions.txDate,
        status: assetTransactions.status,
        reason: assetTransactions.reason,
        decisionNo: assetTransactions.decisionNo,
        amount: assetTransactions.amount,
        fromDepartmentName: fromD.name,
        toDepartmentName: toD.name,
        createdByName: creator.fullName,
        createdBy: assetTransactions.createdBy,
        approvedByName: approver.fullName,
        approvedAt: assetTransactions.approvedAt,
        createdAt: assetTransactions.createdAt,
        itemCount: sql<number>`(select count(*)::int from ${assetTransactionItems} i where i.transaction_id = ${assetTransactions.id})`,
        preview: sql<string>`(select string_agg(a.code, ', ' order by a.code) from (select a.code from ${assetTransactionItems} i join ${assets} a on a.id = i.asset_id where i.transaction_id = ${assetTransactions.id} limit 3) a)`,
      })
      .from(assetTransactions)
      .leftJoin(fromD, eq(fromD.id, assetTransactions.fromDepartmentId))
      .leftJoin(toD, eq(toD.id, assetTransactions.toDepartmentId))
      .leftJoin(creator, eq(creator.id, assetTransactions.createdBy))
      .leftJoin(approver, eq(approver.id, assetTransactions.approvedBy))
      .where(where)
      .orderBy(desc(assetTransactions.txDate), desc(assetTransactions.id))
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    const [counts] = await this.db.db
      .select({
        pending: sql<number>`count(*) filter (where ${assetTransactions.status} = 'CHO_DUYET')::int`,
        draft: sql<number>`count(*) filter (where ${assetTransactions.status} = 'NHAP')::int`,
      })
      .from(assetTransactions)
      .where(s);
    return { ...buildPage(rows.map((r) => ({ ...r, typeLabel: TX_TYPES[r.type]?.label ?? r.type })), total, page, pageSize), counts };
  }

  async detail(id: number, user: AccessContext) {
    const fromD = alias(departments, 'fd');
    const toD = alias(departments, 'td');
    const creator = alias(users, 'cu');
    const approver = alias(users, 'au');
    const custodian = alias(users, 'tc');
    const [t] = await this.db.db
      .select({
        tx: assetTransactions,
        fromDepartmentName: fromD.name,
        toDepartmentName: toD.name,
        toLocationName: assetLocations.name,
        toCustodianFullName: custodian.fullName,
        supplierName: assetSuppliers.name,
        createdByName: creator.fullName,
        approvedByName: approver.fullName,
      })
      .from(assetTransactions)
      .leftJoin(fromD, eq(fromD.id, assetTransactions.fromDepartmentId))
      .leftJoin(toD, eq(toD.id, assetTransactions.toDepartmentId))
      .leftJoin(assetLocations, eq(assetLocations.id, assetTransactions.toLocationId))
      .leftJoin(custodian, eq(custodian.id, assetTransactions.toCustodianId))
      .leftJoin(assetSuppliers, eq(assetSuppliers.id, assetTransactions.supplierId))
      .leftJoin(creator, eq(creator.id, assetTransactions.createdBy))
      .leftJoin(approver, eq(approver.id, assetTransactions.approvedBy))
      .where(eq(assetTransactions.id, id));
    if (!t) throw new NotFoundException('Không tìm thấy chứng từ');
    const s = this.scope(user);
    if (s) {
      const [ok] = await this.db.db.select({ id: assetTransactions.id }).from(assetTransactions).where(and(eq(assetTransactions.id, id), s));
      if (!ok) throw new ForbiddenException('Chứng từ không thuộc phạm vi của bạn');
    }
    const d = alias(departments, 'ad');
    const items = await this.db.db
      .select({
        id: assetTransactionItems.id,
        assetId: assetTransactionItems.assetId,
        amount: assetTransactionItems.amount,
        condition: assetTransactionItems.condition,
        note: assetTransactionItems.note,
        before: assetTransactionItems.before,
        after: assetTransactionItems.after,
        code: assets.code,
        name: assets.name,
        model: assets.model,
        serialNumber: assets.serialNumber,
        unit: assets.unit,
        status: assets.status,
        originalCost: assets.originalCost,
        bookValue: sql<number>`greatest(0, ${assets.originalCost} - ${assets.accumulatedDepreciation})::float8`,
        departmentName: d.name,
        custodianName: assets.custodianName,
      })
      .from(assetTransactionItems)
      .innerJoin(assets, eq(assets.id, assetTransactionItems.assetId))
      .leftJoin(d, eq(d.id, assets.departmentId))
      .where(eq(assetTransactionItems.transactionId, id))
      .orderBy(asc(assets.code));
    const meta = TX_TYPES[t.tx.type];
    const isOwner = t.tx.createdBy === user.id;
    const canApprove = this.canApprove(user);
    return {
      ...t.tx,
      fromDepartmentName: t.fromDepartmentName,
      toDepartmentName: t.toDepartmentName,
      toLocationName: t.toLocationName,
      toCustodianFullName: t.toCustodianFullName,
      supplierName: t.supplierName,
      createdByName: t.createdByName,
      approvedByName: t.approvedByName,
      typeLabel: meta?.label ?? t.tx.type,
      typeMeta: meta,
      items,
      can: {
        edit: ['NHAP', 'TU_CHOI'].includes(t.tx.status) && (isOwner || canApprove),
        submit: ['NHAP', 'TU_CHOI'].includes(t.tx.status) && (isOwner || canApprove),
        approve: ['CHO_DUYET', 'NHAP'].includes(t.tx.status) && canApprove,
        reject: t.tx.status === 'CHO_DUYET' && canApprove,
        cancel: ['NHAP', 'CHO_DUYET', 'TU_CHOI'].includes(t.tx.status) && (isOwner || canApprove),
      },
    };
  }

  /* ------------------------------------------------------------ Lập / sửa */
  private cleanHeader(body: Record<string, unknown>) {
    const h: Record<string, unknown> = {};
    for (const k of HEADER_FIELDS) {
      if (!(k in body)) continue;
      const v = body[k];
      if (k.endsWith('Id')) h[k] = v === null || v === '' || !(Number(v) > 0) ? null : Math.trunc(Number(v));
      else h[k] = String(v ?? '').trim();
    }
    if ('txDate' in h && h.txDate && !/^\d{4}-\d{2}-\d{2}$/.test(String(h.txDate))) throw new BadRequestException('Ngày chứng từ không hợp lệ');
    return h;
  }

  private cleanItems(raw: unknown): ItemInput[] {
    const arr = Array.isArray(raw) ? raw : [];
    const seen = new Set<number>();
    const out: ItemInput[] = [];
    for (const r of arr as Record<string, unknown>[]) {
      const assetId = Math.trunc(Number(r?.assetId));
      if (!(assetId > 0) || seen.has(assetId)) continue;
      seen.add(assetId);
      const amount = Number(r.amount ?? 0);
      if (!Number.isFinite(amount) || amount < 0) throw new BadRequestException('Số tiền trên dòng chứng từ không hợp lệ');
      const condition = String(r.condition ?? '').trim();
      if (condition && !(condition in ASSET_CONDITION)) throw new BadRequestException('Tình trạng không hợp lệ');
      out.push({ assetId, amount: Math.round(amount * 100) / 100, condition, note: String(r.note ?? '').trim() });
    }
    if (!out.length) throw new BadRequestException('Chứng từ chưa có tài sản nào');
    if (out.length > 2000) throw new BadRequestException('Tối đa 2000 tài sản / chứng từ');
    return out;
  }

  /** Kiểm tra tài sản: tồn tại, trong phạm vi, trạng thái hợp lệ, không nằm trong chứng từ chờ duyệt khác */
  private async validateItems(executor: Executor, type: string, items: ItemInput[], user: AccessContext, exceptTxId?: number, lock = false) {
    const meta = TX_TYPES[type];
    const ids = items.map((i) => i.assetId);
    const q = executor.select().from(assets).where(and(inArray(assets.id, ids), sql`${assets.deletedAt} is null`));
    const rows: AssetRow[] = lock ? await q.for('update') : await q;
    const map = new Map(rows.map((r) => [r.id, r]));
    const errors: string[] = [];
    for (const i of items) {
      const a = map.get(i.assetId);
      if (!a) {
        errors.push(`Tài sản #${i.assetId} không tồn tại`);
        continue;
      }
      try {
        this.assetsService.assertInScope(user, a);
      } catch (e) {
        errors.push((e as Error).message);
        continue;
      }
      if (!meta.allowed.includes(a.status)) {
        errors.push(`${a.code}: đang "${ASSET_STATUS[a.status]?.label ?? a.status}" — không lập được chứng từ ${meta.label}`);
      }
      if (type === 'DANH_GIA_LAI' && !(Number(i.amount) > 0)) errors.push(`${a.code}: chưa nhập nguyên giá mới`);
      if (type === 'DANH_GIA_LAI' && Number(i.amount) < Number(a.accumulatedDepreciation)) {
        errors.push(`${a.code}: nguyên giá mới nhỏ hơn hao mòn luỹ kế (${a.accumulatedDepreciation.toLocaleString('vi-VN')})`);
      }
    }
    const busy = await executor
      .select({ code: assetTransactions.code, assetCode: assets.code })
      .from(assetTransactionItems)
      .innerJoin(assetTransactions, eq(assetTransactions.id, assetTransactionItems.transactionId))
      .innerJoin(assets, eq(assets.id, assetTransactionItems.assetId))
      .where(and(inArray(assetTransactionItems.assetId, ids), eq(assetTransactions.status, 'CHO_DUYET'), exceptTxId ? ne(assetTransactions.id, exceptTxId) : undefined));
    for (const b of busy) errors.push(`${b.assetCode}: đang nằm trong chứng từ ${b.code} chờ duyệt`);
    if (errors.length) throw new BadRequestException(errors.slice(0, 12).join(' · ') + (errors.length > 12 ? ` · … (${errors.length} lỗi)` : ''));
    return map;
  }

  private validateHeader(type: string, h: Record<string, unknown>) {
    const meta = TX_TYPES[type];
    if (meta.needsTarget && !h.toDepartmentId && !h.toLocationId && !h.toCustodianId && !h.toCustodianName) {
      throw new BadRequestException(`Chứng từ ${meta.label} cần chọn khoa/phòng, vị trí hoặc người nhận`);
    }
  }

  private async nextTxCode(tx: Executor, type: string, date: string) {
    const head = `${TX_TYPES[type].short}-${date.slice(0, 4)}${date.slice(5, 7)}-`;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('asset_tx_code'), hashtext(${head}))`);
    const [r] = await tx
      .execute<{ n: number }>(sql`select coalesce(max(nullif(regexp_replace(substr(code, ${head.length + 1}), '\\D', '', 'g'), '')::int), 0) as n from ${assetTransactions} where code like ${head + '%'}`)
      .then((x) => x.rows);
    return `${head}${String(Number(r?.n ?? 0) + 1).padStart(3, '0')}`;
  }

  async create(body: Record<string, unknown>, user: AccessContext) {
    const type = String(body.type ?? '');
    if (!TX_TYPES[type]) throw new BadRequestException('Loại chứng từ không hợp lệ');
    const h = this.cleanHeader(body);
    h.txDate = h.txDate || todayISO();
    this.validateHeader(type, h);
    const items = this.cleanItems(body.items);
    const map = await this.validateItems(this.db.db, type, items, user);
    const deptSet = new Set([...map.values()].map((a) => a.departmentId ?? 0));
    const id = await this.db.db.transaction(async (tx) => {
      const code = await this.nextTxCode(tx, type, String(h.txDate));
      const [row] = await tx
        .insert(assetTransactions)
        .values({
          ...(h as object),
          code,
          type: type as never,
          txDate: String(h.txDate),
          status: 'NHAP',
          fromDepartmentId: deptSet.size === 1 ? [...deptSet][0] || null : null,
          amount: items.reduce((s, i) => s + Number(i.amount ?? 0), 0),
          createdBy: user.id,
        })
        .returning({ id: assetTransactions.id });
      await tx.insert(assetTransactionItems).values(items.map((i) => ({ transactionId: row.id, assetId: i.assetId, amount: i.amount ?? 0, condition: i.condition ?? '', note: i.note ?? '' })));
      return row.id;
    });
    if (body.approveNow && this.canApprove(user)) return this.approve(id, user);
    if (body.submit) return this.submit(id, user);
    return this.detail(id, user);
  }

  private async loadForAction(id: number, user: AccessContext, allowed: string[], needOwnerOrApprover = true) {
    const [t] = await this.db.db.select().from(assetTransactions).where(eq(assetTransactions.id, id));
    if (!t) throw new NotFoundException('Không tìm thấy chứng từ');
    if (!allowed.includes(t.status)) throw new ConflictException(`Chứng từ đang ở trạng thái "${TX_STATUS[t.status]?.label ?? t.status}" — không thực hiện được thao tác này`);
    if (needOwnerOrApprover && t.createdBy !== user.id && !this.canApprove(user)) throw new ForbiddenException('Chỉ người lập hoặc người duyệt mới thao tác được chứng từ này');
    return t;
  }

  async update(id: number, body: Record<string, unknown>, user: AccessContext) {
    const t = await this.loadForAction(id, user, ['NHAP', 'TU_CHOI']);
    const h = this.cleanHeader(body);
    const merged = { ...t, ...h } as Record<string, unknown>;
    this.validateHeader(t.type, merged);
    const items = 'items' in body ? this.cleanItems(body.items) : null;
    let fromDepartmentId = t.fromDepartmentId;
    if (items) {
      const map = await this.validateItems(this.db.db, t.type, items, user, id);
      const deptSet = new Set([...map.values()].map((a) => a.departmentId ?? 0));
      fromDepartmentId = deptSet.size === 1 ? [...deptSet][0] || null : null;
    }
    await this.db.db.transaction(async (tx) => {
      await tx
        .update(assetTransactions)
        .set({
          ...(h as object),
          fromDepartmentId,
          ...(items ? { amount: items.reduce((s, i) => s + Number(i.amount ?? 0), 0) } : {}),
          updatedAt: new Date(),
        })
        .where(eq(assetTransactions.id, id));
      if (items) {
        await tx.delete(assetTransactionItems).where(eq(assetTransactionItems.transactionId, id));
        await tx.insert(assetTransactionItems).values(items.map((i) => ({ transactionId: id, assetId: i.assetId, amount: i.amount ?? 0, condition: i.condition ?? '', note: i.note ?? '' })));
      }
    });
    return this.detail(id, user);
  }

  async submit(id: number, user: AccessContext) {
    const t = await this.loadForAction(id, user, ['NHAP', 'TU_CHOI']);
    const items = await this.db.db.select().from(assetTransactionItems).where(eq(assetTransactionItems.transactionId, id));
    await this.validateItems(this.db.db, t.type, items.map((i) => ({ assetId: i.assetId, amount: i.amount })), user, id);
    await this.db.db.update(assetTransactions).set({ status: 'CHO_DUYET', submittedAt: new Date(), rejectReason: '', updatedAt: new Date() }).where(eq(assetTransactions.id, id));
    await this.notifyApprovers(t.id, t.code, TX_TYPES[t.type].label, user);
    return this.detail(id, user);
  }

  async reject(id: number, reason: string, user: AccessContext) {
    if (!this.canApprove(user)) throw new ForbiddenException('Bạn không có quyền duyệt chứng từ tài sản');
    const t = await this.loadForAction(id, user, ['CHO_DUYET'], false);
    const why = String(reason ?? '').trim();
    if (!why) throw new BadRequestException('Hãy nhập lý do từ chối');
    await this.db.db.update(assetTransactions).set({ status: 'TU_CHOI', rejectReason: why, approvedBy: user.id, approvedAt: new Date(), updatedAt: new Date() }).where(eq(assetTransactions.id, id));
    if (t.createdBy && t.createdBy !== user.id) {
      await this.db.db.insert(notifications).values({
        userId: t.createdBy, title: `Chứng từ ${t.code} bị từ chối`, body: `${user.fullName}: ${why}`, level: 'WARNING',
        link: `/tai-san/nghiep-vu/${id}`, module: 'ASSET', entityId: String(id),
      });
    }
    return this.detail(id, user);
  }

  async cancel(id: number, user: AccessContext) {
    await this.loadForAction(id, user, ['NHAP', 'CHO_DUYET', 'TU_CHOI']);
    await this.db.db.update(assetTransactions).set({ status: 'DA_HUY', updatedAt: new Date() }).where(eq(assetTransactions.id, id));
    return this.detail(id, user);
  }

  /* ------------------------------------------------------------ Duyệt & áp dụng */
  async approve(id: number, user: AccessContext) {
    if (!this.canApprove(user)) throw new ForbiddenException('Bạn không có quyền duyệt chứng từ tài sản');
    const result = await this.db.db.transaction(async (tx) => {
      const [t] = await tx.select().from(assetTransactions).where(eq(assetTransactions.id, id)).for('update');
      if (!t) throw new NotFoundException('Không tìm thấy chứng từ');
      if (!['CHO_DUYET', 'NHAP'].includes(t.status)) throw new ConflictException(`Chứng từ đang "${TX_STATUS[t.status]?.label}" — không duyệt được`);
      const items = await tx.select().from(assetTransactionItems).where(eq(assetTransactionItems.transactionId, id));
      const map = await this.validateItems(tx, t.type, items.map((i) => ({ assetId: i.assetId, amount: i.amount })), user, id, true);
      let custodianName = t.toCustodianName;
      if (t.toCustodianId && !custodianName) {
        const [u] = await tx.select({ fullName: users.fullName }).from(users).where(eq(users.id, t.toCustodianId));
        custodianName = u?.fullName ?? '';
      }
      const [toDept] = t.toDepartmentId ? await tx.select({ name: departments.name }).from(departments).where(eq(departments.id, t.toDepartmentId)) : [];
      for (const item of items) {
        const a = map.get(item.assetId)!;
        const patch = this.effect(t, item, a, custodianName);
        const before: Record<string, unknown> = {};
        for (const k of Object.keys(patch)) before[k] = (a as Record<string, unknown>)[k] ?? null;
        const next = { ...a, ...patch } as AssetRow;
        await tx
          .update(assets)
          .set({ ...(patch as object), searchText: this.assetsService.buildSearch(next), updatedBy: user.id, updatedAt: new Date() })
          .where(eq(assets.id, a.id));
        await tx.update(assetTransactionItems).set({ before, after: patch }).where(eq(assetTransactionItems.id, item.id));
        const title = `${TX_TYPES[t.type].label} — ${t.code}${toDept?.name && ['CAP_PHAT', 'DIEU_CHUYEN', 'GHI_TANG'].includes(t.type) ? ` → ${toDept.name}` : ''}`;
        await this.assetsService.addEvent(tx, a.id, t.type, title, { before, after: patch, amount: item.amount, note: item.note, reason: t.reason }, user, t.id);
      }
      await tx.update(assetTransactions).set({ status: 'DA_DUYET', approvedBy: user.id, approvedAt: new Date(), submittedAt: t.submittedAt ?? new Date(), updatedAt: new Date() }).where(eq(assetTransactions.id, id));
      return t;
    });
    if (result.createdBy && result.createdBy !== user.id) {
      await this.db.db.insert(notifications).values({
        userId: result.createdBy, title: `Chứng từ ${result.code} đã được duyệt`, body: `${TX_TYPES[result.type].label} — ${user.fullName} đã duyệt.`, level: 'SUCCESS',
        link: `/tai-san/nghiep-vu/${id}`, module: 'ASSET', entityId: String(id),
      });
    }
    return this.detail(id, user);
  }

  /** Thay đổi áp dụng lên một tài sản khi duyệt */
  private effect(t: typeof assetTransactions.$inferSelect, item: typeof assetTransactionItems.$inferSelect, a: AssetRow, custodianName: string): Partial<AssetRow> {
    const date = t.txDate;
    const cond = (item.condition || '') as string;
    const target = (): Partial<AssetRow> => {
      const p: Partial<AssetRow> = {};
      if (t.toDepartmentId) p.departmentId = t.toDepartmentId;
      if (t.toLocationId) p.locationId = t.toLocationId;
      if (t.toCustodianId || custodianName) {
        p.custodianId = t.toCustodianId ?? null;
        p.custodianName = custodianName;
      } else if (t.toDepartmentId && t.toDepartmentId !== a.departmentId) {
        // Đổi khoa mà không chỉ định người giữ → bỏ người giữ cũ
        p.custodianId = null;
        p.custodianName = '';
      }
      return p;
    };
    switch (t.type) {
      case 'GHI_TANG': {
        const p: Partial<AssetRow> = { acquisitionDate: a.acquisitionDate ?? date, ...target() };
        if (t.supplierId) p.supplierId = t.supplierId;
        if (t.toDepartmentId) {
          p.status = 'DANG_SU_DUNG';
          p.inUseDate = a.inUseDate ?? date;
        }
        return p;
      }
      case 'CAP_PHAT':
        return { status: 'DANG_SU_DUNG', inUseDate: a.inUseDate ?? date, depreciationStartDate: a.depreciationStartDate ?? a.inUseDate ?? date, ...target(), ...(cond ? { condition: cond } : {}) };
      case 'DIEU_CHUYEN':
        return { ...target(), ...(cond ? { condition: cond } : {}) };
      case 'THU_HOI':
        return { status: 'TRONG_KHO', departmentId: null, custodianId: null, custodianName: '', locationId: t.toLocationId ?? null, ...(cond ? { condition: cond } : {}) };
      case 'BAO_HONG':
        return { status: 'HONG', condition: cond || 'HONG' };
      case 'SUA_CHUA':
        return { status: 'DANG_SUA_CHUA', attributes: { ...(a.attributes ?? {}), _statusBeforeRepair: a.status === 'DANG_SUA_CHUA' ? 'DANG_SU_DUNG' : a.status } };
      case 'HOAN_THANH_SUA': {
        const prev = String((a.attributes ?? {})._statusBeforeRepair ?? '');
        const back = a.departmentId ? 'DANG_SU_DUNG' : prev === 'TRONG_KHO' || !a.departmentId ? 'TRONG_KHO' : 'DANG_SU_DUNG';
        const attrs = { ...(a.attributes ?? {}) };
        delete attrs._statusBeforeRepair;
        return {
          status: cond === 'HONG' ? 'HONG' : back,
          condition: cond || 'TOT',
          attributes: attrs,
          lastMaintenanceDate: date,
          ...(a.maintenanceIntervalMonths > 0 ? { nextMaintenanceDate: addMonthsISO(date, a.maintenanceIntervalMonths) } : {}),
        };
      }
      case 'BAO_DUONG':
        return {
          lastMaintenanceDate: date,
          nextMaintenanceDate: a.maintenanceIntervalMonths > 0 ? addMonthsISO(date, a.maintenanceIntervalMonths) : a.nextMaintenanceDate,
          ...(cond ? { condition: cond } : {}),
        };
      case 'KIEM_DINH':
        return {
          lastCalibrationDate: date,
          nextCalibrationDate: a.calibrationIntervalMonths > 0 ? addMonthsISO(date, a.calibrationIntervalMonths) : addMonthsISO(date, 12),
          ...(cond ? { condition: cond } : {}),
        };
      case 'DANH_GIA_LAI':
        return { originalCost: Number(item.amount) };
      case 'DE_NGHI_THANH_LY':
        return { status: 'CHO_THANH_LY', ...(cond ? { condition: cond } : {}) };
      case 'THANH_LY':
        return { status: 'DA_THANH_LY', custodianId: null, custodianName: '' };
      case 'BAO_MAT':
        return { status: 'MAT' };
      default:
        return {};
    }
  }

  private async notifyApprovers(txId: number, code: string, typeLabel: string, actor: AccessContext) {
    try {
      const rows = await this.db.db
        .selectDistinct({ userId: userRoles.userId })
        .from(permissions)
        .innerJoin(rolePermissions, eq(rolePermissions.permissionId, permissions.id))
        .innerJoin(userRoles, eq(userRoles.roleId, rolePermissions.roleId))
        .innerJoin(users, eq(users.id, userRoles.userId))
        .where(and(eq(permissions.code, 'asset.transaction.approve'), eq(users.active, true), sql`${users.deletedAt} is null`));
      const targets = rows.map((r) => r.userId).filter((u) => u !== actor.id);
      if (!targets.length) return;
      await this.db.db.insert(notifications).values(
        targets.map((userId) => ({
          userId, title: `Chứng từ tài sản chờ duyệt: ${code}`, body: `${typeLabel} — lập bởi ${actor.fullName}.`, level: 'INFO',
          link: `/tai-san/nghiep-vu/${txId}`, module: 'ASSET', entityId: String(txId),
        })),
      );
    } catch (e) {
      this.logger.warn(`Không gửi được thông báo duyệt: ${(e as Error).message}`);
    }
  }
}
