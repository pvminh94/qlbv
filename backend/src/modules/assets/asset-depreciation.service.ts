/**
 * Kỳ khấu hao / hao mòn: xem trước → chốt (ghi sổ từng tài sản, cộng luỹ kế) → huỷ kỳ gần nhất nếu cần.
 * Kỳ năm 'YYYY' áp dụng cho tài sản hao mòn theo năm (TT23); kỳ tháng 'YYYY-MM' cho khấu hao theo tháng.
 */
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import * as ExcelJS from 'exceljs';
import type { AccessContext } from '../../common/types/access-context';
import { DbService, type Executor } from '../../db/db.service';
import { assetCategories, assetDepreciationLines, assetDepreciationRuns, assets, departments } from '../../db/schema';
import { ACTIVE_STATUSES } from './asset-constants';
import { amountForPeriod, bookValueOf, METHOD_LABEL, periodEnd, previousPeriod } from './depreciation';
import { AssetsService, todayISO, type AssetRow } from './assets.service';

const periodType = (p: string): 'YEARLY' | 'MONTHLY' => {
  if (/^\d{4}$/.test(p)) return 'YEARLY';
  if (/^\d{4}-(0[1-9]|1[0-2])$/.test(p)) return 'MONTHLY';
  throw new BadRequestException('Kỳ không hợp lệ — dùng YYYY (năm) hoặc YYYY-MM (tháng)');
};

/** Kỳ cuối cùng đã nằm trong số dư đầu kỳ */
function coveredByOpening(a: AssetRow, type: 'YEARLY' | 'MONTHLY'): string {
  if (!a.openingDate || !(a.openingAccumulated > 0)) return '';
  const p = type === 'YEARLY' ? a.openingDate.slice(0, 4) : a.openingDate.slice(0, 7);
  return periodEnd(p) === a.openingDate ? p : previousPeriod(p);
}

export interface PreviewLine {
  assetId: number;
  code: string;
  name: string;
  method: string;
  costBasis: number;
  amount: number;
  accumulatedBefore: number;
  accumulatedAfter: number;
  bookValueAfter: number;
  departmentId: number | null;
  categoryId: number | null;
  warning?: string;
}

@Injectable()
export class AssetDepreciationService {
  constructor(
    private readonly db: DbService,
    private readonly assetsService: AssetsService,
  ) {}

  private async compute(executor: Executor, period: string, lock = false) {
    const type = periodType(period);
    if (period > (type === 'YEARLY' ? todayISO().slice(0, 4) : todayISO().slice(0, 7))) {
      throw new BadRequestException('Không tính khấu hao cho kỳ trong tương lai');
    }
    const methods = type === 'YEARLY' ? ['STRAIGHT_LINE_YEARLY'] : ['STRAIGHT_LINE_MONTHLY', 'DECLINING_BALANCE'];
    const q = executor
      .select()
      .from(assets)
      .where(and(isNull(assets.deletedAt), inArray(assets.status, ACTIVE_STATUSES as never[]), inArray(assets.depreciationMethod, methods as never[]), sql`${assets.originalCost} > 0`))
      .orderBy(asc(assets.code));
    const rows: AssetRow[] = lock ? await q.for('update') : await q;
    const lines: PreviewLine[] = [];
    const skipped = { done: 0, notStarted: 0, fullyDepreciated: 0, noStartDate: 0 };
    const warnings: string[] = [];
    let gaps = 0;
    const end = periodEnd(period);
    for (const a of rows) {
      const startDate = a.depreciationStartDate ?? a.inUseDate ?? a.acquisitionDate;
      if (!startDate) {
        skipped.noStartDate++;
        continue;
      }
      if (startDate > end) {
        skipped.notStarted++;
        continue;
      }
      const last = a.lastDepreciationPeriod || coveredByOpening(a, type);
      if (last && last >= period) {
        skipped.done++;
        continue;
      }
      const state = { ...a, startDate, accumulated: a.accumulatedDepreciation, depreciationMethod: a.depreciationMethod };
      const amount = amountForPeriod(state, period);
      if (amount <= 0) {
        skipped.fullyDepreciated++;
        continue;
      }
      let warning: string | undefined;
      const startPeriod = type === 'YEARLY' ? startDate.slice(0, 4) : startDate.slice(0, 7);
      if (last && last !== previousPeriod(period) && previousPeriod(period) >= startPeriod) {
        warning = `Kỳ gần nhất đã tính là ${last} — có thể bỏ sót kỳ giữa`;
        gaps++;
      } else if (!last && startPeriod < period) {
        warning = `Chưa tính kỳ nào từ khi bắt đầu (${startPeriod})`;
        gaps++;
      }
      lines.push({
        assetId: a.id,
        code: a.code,
        name: a.name,
        method: a.depreciationMethod,
        costBasis: a.originalCost,
        amount,
        accumulatedBefore: a.accumulatedDepreciation,
        accumulatedAfter: a.accumulatedDepreciation + amount,
        bookValueAfter: bookValueOf({ ...state, accumulated: a.accumulatedDepreciation + amount }),
        departmentId: a.departmentId,
        categoryId: a.categoryId,
        warning,
      });
    }
    if (gaps) warnings.push(`${gaps} tài sản có dấu hiệu bỏ sót kỳ trước — nên chốt các kỳ trước theo thứ tự (hoặc nhập số dư đầu kỳ).`);
    return { period, periodType: type, lines, skipped, warnings, total: lines.reduce((s, l) => s + l.amount, 0) };
  }

  async preview(period: string) {
    const r = await this.compute(this.db.db, period);
    const [existing] = await this.db.db.select().from(assetDepreciationRuns).where(and(eq(assetDepreciationRuns.period, period), eq(assetDepreciationRuns.status, 'DA_CHOT')));
    return { ...r, byDepartment: await this.summarize(r.lines), existingRun: existing ?? null, methodLabels: METHOD_LABEL };
  }

  private async summarize(lines: { amount: number; departmentId: number | null }[]) {
    const depts = await this.db.db.select({ id: departments.id, name: departments.name }).from(departments);
    const dm = new Map(depts.map((d) => [d.id, d.name]));
    const agg = new Map<number, { departmentId: number; name: string; count: number; amount: number }>();
    for (const l of lines) {
      const k = l.departmentId ?? 0;
      const g = agg.get(k) ?? { departmentId: k, name: k ? (dm.get(k) ?? `#${k}`) : 'Kho / chưa giao', count: 0, amount: 0 };
      g.count++;
      g.amount += l.amount;
      agg.set(k, g);
    }
    return [...agg.values()].sort((a, b) => b.amount - a.amount);
  }

  async run(period: string, note: string, user: AccessContext) {
    const runId = await this.db.db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('asset_depreciation'))`);
      const [existing] = await tx.select({ id: assetDepreciationRuns.id }).from(assetDepreciationRuns).where(and(eq(assetDepreciationRuns.period, period), eq(assetDepreciationRuns.status, 'DA_CHOT')));
      if (existing) throw new ConflictException(`Kỳ ${period} đã được chốt — huỷ kỳ đó trước nếu muốn tính lại`);
      const r = await this.compute(tx, period, true);
      if (!r.lines.length) throw new BadRequestException(`Không có tài sản nào phát sinh khấu hao/hao mòn trong kỳ ${period}`);
      const [run] = await tx
        .insert(assetDepreciationRuns)
        .values({ period, periodType: r.periodType, status: 'DA_CHOT', assetCount: r.lines.length, totalAmount: r.total, note: String(note ?? '').trim(), createdBy: user.id, createdByName: user.fullName })
        .returning({ id: assetDepreciationRuns.id });
      for (let i = 0; i < r.lines.length; i += 500) {
        const chunk = r.lines.slice(i, i + 500);
        await tx.insert(assetDepreciationLines).values(
          chunk.map((l) => ({ runId: run.id, assetId: l.assetId, method: l.method, costBasis: l.costBasis, amount: l.amount, accumulatedBefore: l.accumulatedBefore, accumulatedAfter: l.accumulatedAfter, bookValueAfter: l.bookValueAfter, departmentId: l.departmentId, categoryId: l.categoryId })),
        );
      }
      // Cập nhật luỹ kế hàng loạt từ bảng dòng vừa ghi
      await tx.execute(sql`
        update ${assets} a set accumulated_depreciation = l.accumulated_after, last_depreciation_period = ${period}, updated_at = now()
        from ${assetDepreciationLines} l where l.run_id = ${run.id} and l.asset_id = a.id`);
      await tx.execute(sql`
        insert into asset_events (asset_id, event_type, title, detail, user_id, user_name)
        select l.asset_id, 'DEPRECIATION', ${`Chốt ${r.periodType === 'YEARLY' ? 'hao mòn năm' : 'khấu hao tháng'} ${period}`},
               jsonb_build_object('runId', l.run_id, 'amount', l.amount, 'accumulatedAfter', l.accumulated_after, 'bookValueAfter', l.book_value_after),
               ${user.id}, ${user.fullName}
        from ${assetDepreciationLines} l where l.run_id = ${run.id}`);
      return run.id;
    });
    return this.runDetail(runId);
  }

  async cancel(runId: number, user: AccessContext) {
    await this.db.db.transaction(async (tx) => {
      const [run] = await tx.select().from(assetDepreciationRuns).where(eq(assetDepreciationRuns.id, runId)).for('update');
      if (!run) throw new NotFoundException('Không tìm thấy kỳ khấu hao');
      if (run.status !== 'DA_CHOT') throw new ConflictException('Kỳ này đã huỷ');
      const [later] = await tx
        .select({ period: assetDepreciationRuns.period })
        .from(assetDepreciationRuns)
        .where(and(eq(assetDepreciationRuns.periodType, run.periodType), eq(assetDepreciationRuns.status, 'DA_CHOT'), sql`${assetDepreciationRuns.period} > ${run.period}`))
        .limit(1);
      if (later) throw new ConflictException(`Phải huỷ kỳ sau (${later.period}) trước khi huỷ kỳ ${run.period}`);
      // Trả luỹ kế + kỳ gần nhất về trước kỳ này
      await tx.execute(sql`
        update ${assets} a set accumulated_depreciation = greatest(0, a.accumulated_depreciation - l.amount),
          last_depreciation_period = coalesce((
            select r2.period from ${assetDepreciationLines} l2 join ${assetDepreciationRuns} r2 on r2.id = l2.run_id
            where l2.asset_id = a.id and r2.status = 'DA_CHOT' and r2.id <> ${runId} and r2.period_type = ${run.periodType}
            order by r2.period desc limit 1), ''),
          updated_at = now()
        from ${assetDepreciationLines} l where l.run_id = ${runId} and l.asset_id = a.id`);
      await tx.update(assetDepreciationRuns).set({ status: 'DA_HUY', note: `${run.note}${run.note ? ' · ' : ''}Huỷ bởi ${user.fullName}` }).where(eq(assetDepreciationRuns.id, runId));
      await tx.execute(sql`
        insert into asset_events (asset_id, event_type, title, detail, user_id, user_name)
        select l.asset_id, 'DEPRECIATION_CANCEL', ${`Huỷ kỳ khấu hao ${run.period}`}, jsonb_build_object('runId', l.run_id, 'amount', l.amount), ${user.id}, ${user.fullName}
        from ${assetDepreciationLines} l where l.run_id = ${runId}`);
    });
    return this.runDetail(runId);
  }

  async runs() {
    return this.db.db.select().from(assetDepreciationRuns).orderBy(desc(assetDepreciationRuns.period), desc(assetDepreciationRuns.id)).limit(200);
  }

  async runDetail(runId: number) {
    const [run] = await this.db.db.select().from(assetDepreciationRuns).where(eq(assetDepreciationRuns.id, runId));
    if (!run) throw new NotFoundException('Không tìm thấy kỳ khấu hao');
    const lines = await this.db.db
      .select({
        id: assetDepreciationLines.id, assetId: assetDepreciationLines.assetId, code: assets.code, name: assets.name,
        method: assetDepreciationLines.method, costBasis: assetDepreciationLines.costBasis, amount: assetDepreciationLines.amount,
        accumulatedBefore: assetDepreciationLines.accumulatedBefore, accumulatedAfter: assetDepreciationLines.accumulatedAfter,
        bookValueAfter: assetDepreciationLines.bookValueAfter, departmentId: assetDepreciationLines.departmentId,
        departmentName: departments.name, categoryName: assetCategories.name,
      })
      .from(assetDepreciationLines)
      .innerJoin(assets, eq(assets.id, assetDepreciationLines.assetId))
      .leftJoin(departments, eq(departments.id, assetDepreciationLines.departmentId))
      .leftJoin(assetCategories, eq(assetCategories.id, assetDepreciationLines.categoryId))
      .where(eq(assetDepreciationLines.runId, runId))
      .orderBy(asc(departments.name), asc(assets.code));
    return { ...run, lines, byDepartment: await this.summarize(lines) };
  }

  /** Sổ theo dõi khấu hao/hao mòn của một kỳ (Excel) */
  async exportRun(runId: number) {
    const run = await this.runDetail(runId);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(`Ky ${run.period}`);
    ws.addRow([`SỔ THEO DÕI ${run.periodType === 'YEARLY' ? 'HAO MÒN' : 'KHẤU HAO'} TÀI SẢN CỐ ĐỊNH — KỲ ${run.period}`]).font = { bold: true, size: 13 };
    ws.addRow([`Trạng thái: ${run.status === 'DA_CHOT' ? 'Đã chốt' : 'Đã huỷ'} · Người chốt: ${run.createdByName} · ${run.assetCount} tài sản`]);
    ws.addRow([]);
    const head = ws.addRow(['STT', 'Mã tài sản', 'Tên tài sản', 'Loại', 'Khoa/phòng', 'Phương pháp', 'Nguyên giá', 'Luỹ kế đầu kỳ', 'Hao mòn/khấu hao kỳ', 'Luỹ kế cuối kỳ', 'Giá trị còn lại']);
    head.font = { bold: true };
    head.eachCell((c) => {
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
      c.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
      c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    });
    run.lines.forEach((l, i) => {
      ws.addRow([i + 1, l.code, l.name, l.categoryName ?? '', l.departmentName ?? 'Kho', METHOD_LABEL[l.method] ?? l.method, l.costBasis, l.accumulatedBefore, l.amount, l.accumulatedAfter, l.bookValueAfter]);
    });
    const sum = (k: 'costBasis' | 'accumulatedBefore' | 'amount' | 'accumulatedAfter' | 'bookValueAfter') => run.lines.reduce((s, l) => s + Number(l[k]), 0);
    const total = ws.addRow(['', '', 'TỔNG CỘNG', '', '', '', sum('costBasis'), sum('accumulatedBefore'), sum('amount'), sum('accumulatedAfter'), sum('bookValueAfter')]);
    total.font = { bold: true };
    ws.columns.forEach((c, i) => {
      c.width = [6, 18, 38, 22, 24, 24, 16, 16, 18, 16, 16][i] ?? 14;
      if (i >= 6) c.numFmt = '#,##0';
    });
    ws.views = [{ state: 'frozen', ySplit: 4 }];
    return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), fileName: `so-khau-hao-${run.period}.xlsx` };
  }

  /** Gợi ý kỳ kế tiếp cần chốt */
  async suggest() {
    const today = todayISO();
    const last = await this.db.db
      .select({ periodType: assetDepreciationRuns.periodType, period: sql<string>`max(${assetDepreciationRuns.period})` })
      .from(assetDepreciationRuns)
      .where(eq(assetDepreciationRuns.status, 'DA_CHOT'))
      .groupBy(assetDepreciationRuns.periodType);
    const m = Object.fromEntries(last.map((l) => [l.periodType, l.period]));
    const [counts] = await this.db.db
      .select({
        yearly: sql<number>`count(*) filter (where ${assets.depreciationMethod} = 'STRAIGHT_LINE_YEARLY')::int`,
        monthly: sql<number>`count(*) filter (where ${assets.depreciationMethod} in ('STRAIGHT_LINE_MONTHLY','DECLINING_BALANCE'))::int`,
      })
      .from(assets)
      .where(and(isNull(assets.deletedAt), inArray(assets.status, ACTIVE_STATUSES as never[])));
    return {
      lastYearly: m.YEARLY ?? null,
      lastMonthly: m.MONTHLY ?? null,
      yearlyAssets: counts?.yearly ?? 0,
      monthlyAssets: counts?.monthly ?? 0,
      suggestedYear: m.YEARLY ? String(Math.min(Number(m.YEARLY) + 1, Number(today.slice(0, 4)))) : String(Number(today.slice(0, 4)) - (today.slice(5, 7) === '12' ? 0 : 1)),
      suggestedMonth: m.MONTHLY ? (m.MONTHLY >= today.slice(0, 7) ? today.slice(0, 7) : nextMonth(m.MONTHLY)) : today.slice(0, 7),
    };
  }
}

function nextMonth(p: string) {
  const [y, m] = p.split('-').map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}
