/**
 * BÁO CÁO TÀI SẢN (chuẩn, có tham số) + LỊCH BẢO TRÌ / KIỂM ĐỊNH
 *
 * Mọi báo cáo trả về cùng một cấu trúc `ReportResult` (cột + dòng + dòng nhóm/cộng) nên
 * giao diện, xuất Excel và in PDF dùng chung một bộ hiển thị. Phạm vi dữ liệu theo khoa
 * giống danh sách tài sản (người không có `asset.view-all` chỉ thấy khoa mình).
 */
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import * as ExcelJS from 'exceljs';
import type { AccessContext } from '../../common/types/access-context';
import { DbService } from '../../db/db.service';
import {
  assetCategories,
  assetFundingSources,
  assetInventories,
  assetInventoryItems,
  assetLocations,
  assets,
  assetSuppliers,
  assetTransactionItems,
  assetTransactions,
  departments,
  type ElementStyle,
  type PrintDocument,
  type PrintElement,
} from '../../db/schema';
import { renderPrintDocument } from '../../infra/rendering/pdf-renderer';
import { SettingsService } from '../settings/settings.service';
import { ACTIVE_STATUSES, ASSET_CONDITION, ASSET_GROUP, ASSET_KIND, ASSET_STATUS, INVENTORY_STATUS, TX_TYPES } from './asset-constants';
import { addMonthsISO, AssetsService, todayISO } from './assets.service';

export type ColType = 'text' | 'money' | 'int' | 'date' | 'pct' | 'status';
export interface ReportColumn {
  key: string;
  title: string;
  type?: ColType;
  width?: number;
}
export type ReportRow = Record<string, unknown> & { _kind?: 'group' | 'subtotal' | 'total'; _link?: string };
export interface ReportResult {
  key: string;
  title: string;
  subtitle: string;
  columns: ReportColumn[];
  rows: ReportRow[];
  /** Thẻ tóm tắt hiển thị phía trên bảng */
  summary: { label: string; value: number; type?: ColType; color?: string }[];
  /** Dữ liệu biểu đồ (nếu có) */
  chart?: { type: 'bar' | 'pie'; label: string; data: { name: string; value: number; value2?: number }[]; valueLabel?: string; value2Label?: string };
  orientation?: 'portrait' | 'landscape';
  params: Record<string, unknown>;
}

export interface ReportParam {
  key: string;
  label: string;
  type: 'date' | 'select' | 'number' | 'department' | 'category' | 'status' | 'group';
  default?: unknown;
  options?: { value: string; label: string }[];
}
export interface ReportDef {
  key: string;
  title: string;
  description: string;
  icon: string;
  color: string;
  params: ReportParam[];
}

const isDate = (s: unknown) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const yearStart = () => `${todayISO().slice(0, 4)}-01-01`;
const n = (v: unknown) => Number(v ?? 0) || 0;
const vnDate = (s: unknown) => (s ? String(s).slice(0, 10).split('-').reverse().join('/') : '');
const fmtMoney = (v: unknown) => n(v).toLocaleString('vi-VN', { maximumFractionDigits: 0 });

const REPORTS: ReportDef[] = [
  {
    key: 'so-tai-san',
    title: 'Sổ tài sản cố định',
    description: 'Danh sách tài sản theo loại: nguyên giá, tỉ lệ, hao mòn luỹ kế, giá trị còn lại — có cộng từng loại.',
    icon: 'BookOpen',
    color: '#0d9488',
    params: [
      { key: 'status', label: 'Trạng thái', type: 'status', default: 'ACTIVE' },
      { key: 'departmentId', label: 'Khoa/phòng', type: 'department' },
      { key: 'categoryId', label: 'Loại tài sản', type: 'category' },
      { key: 'group', label: 'Nhóm', type: 'group' },
      { key: 'kind', label: 'Phân loại', type: 'select', options: Object.entries(ASSET_KIND).map(([value, label]) => ({ value, label })) },
    ],
  },
  {
    key: 'tang-giam',
    title: 'Tình hình tăng, giảm tài sản',
    description: 'Đầu kỳ · tăng trong kỳ · giảm trong kỳ (thanh lý, mất) · cuối kỳ — số lượng và nguyên giá theo loại/nhóm/khoa.',
    icon: 'ArrowUpDown',
    color: '#2563eb',
    params: [
      { key: 'from', label: 'Từ ngày', type: 'date', default: 'YEAR_START' },
      { key: 'to', label: 'Đến ngày', type: 'date', default: 'TODAY' },
      {
        key: 'groupBy', label: 'Nhóm theo', type: 'select', default: 'category',
        options: [{ value: 'category', label: 'Loại tài sản' }, { value: 'group', label: 'Nhóm tài sản' }, { value: 'department', label: 'Khoa/phòng' }, { value: 'funding', label: 'Nguồn vốn' }],
      },
    ],
  },
  {
    key: 'theo-khoa',
    title: 'Tổng hợp tài sản theo khoa/phòng',
    description: 'Số lượng, nguyên giá, giá trị còn lại và cơ cấu trạng thái của từng khoa/phòng; thiết bị quá hạn kiểm định/bảo dưỡng.',
    icon: 'Building2',
    color: '#7c3aed',
    params: [{ key: 'group', label: 'Nhóm', type: 'group' }],
  },
  {
    key: 'chi-phi',
    title: 'Chi phí sửa chữa, bảo dưỡng, kiểm định',
    description: 'Chi phí thực tế từ chứng từ đã duyệt (hoàn thành sửa chữa, bảo dưỡng, kiểm định) — theo chứng từ, tài sản, khoa hoặc đơn vị thực hiện.',
    icon: 'Wrench',
    color: '#ea580c',
    params: [
      { key: 'from', label: 'Từ ngày', type: 'date', default: 'YEAR_START' },
      { key: 'to', label: 'Đến ngày', type: 'date', default: 'TODAY' },
      {
        key: 'view', label: 'Xem theo', type: 'select', default: 'detail',
        options: [{ value: 'detail', label: 'Chi tiết chứng từ' }, { value: 'asset', label: 'Từng tài sản' }, { value: 'department', label: 'Khoa/phòng' }, { value: 'supplier', label: 'Đơn vị thực hiện' }],
      },
      { key: 'departmentId', label: 'Khoa/phòng', type: 'department' },
    ],
  },
  {
    key: 'den-han',
    title: 'Thiết bị đến hạn kiểm định, bảo dưỡng, hết bảo hành',
    description: 'Danh sách quá hạn và sắp đến hạn trong N ngày tới — để lập kế hoạch và chứng từ kiểm định/bảo dưỡng.',
    icon: 'CalendarClock',
    color: '#dc2626',
    params: [
      { key: 'days', label: 'Trong số ngày tới', type: 'number', default: 60 },
      {
        key: 'type', label: 'Loại hạn', type: 'select', default: '',
        options: [{ value: '', label: 'Tất cả' }, { value: 'calibration', label: 'Kiểm định/hiệu chuẩn' }, { value: 'maintenance', label: 'Bảo dưỡng' }, { value: 'warranty', label: 'Bảo hành' }],
      },
      { key: 'departmentId', label: 'Khoa/phòng', type: 'department' },
    ],
  },
  {
    key: 'het-khau-hao',
    title: 'Tài sản đã hết khấu hao/hao mòn vẫn sử dụng',
    description: 'Tài sản giá trị còn lại bằng 0 (hoặc bằng giá trị thu hồi ước tính) nhưng vẫn đang theo dõi — phục vụ kế hoạch thay thế, thanh lý.',
    icon: 'Hourglass',
    color: '#64748b',
    params: [{ key: 'departmentId', label: 'Khoa/phòng', type: 'department' }, { key: 'group', label: 'Nhóm', type: 'group' }],
  },
  {
    key: 'thanh-ly',
    title: 'Tài sản ghi giảm (thanh lý, mất) trong kỳ',
    description: 'Chi tiết tài sản đã thanh lý/báo mất theo chứng từ đã duyệt: nguyên giá, hao mòn, giá trị còn lại, giá trị thu hồi.',
    icon: 'Trash2',
    color: '#9333ea',
    params: [
      { key: 'from', label: 'Từ ngày', type: 'date', default: 'YEAR_START' },
      { key: 'to', label: 'Đến ngày', type: 'date', default: 'TODAY' },
    ],
  },
  {
    key: 'kiem-ke',
    title: 'Tổng hợp kết quả kiểm kê',
    description: 'Các đợt kiểm kê trong năm: số theo sổ, có mặt, thiếu, thừa, sai vị trí, giá trị thiếu.',
    icon: 'ClipboardList',
    color: '#0891b2',
    params: [{ key: 'year', label: 'Năm', type: 'number', default: 'THIS_YEAR' }],
  },
];

@Injectable()
export class AssetReportsService {
  constructor(
    private readonly db: DbService,
    private readonly assetsService: AssetsService,
    private readonly settings: SettingsService,
  ) {}

  catalog() {
    return REPORTS.map((r) => ({
      ...r,
      params: r.params.map((p) => ({
        ...p,
        default: p.default === 'YEAR_START' ? yearStart() : p.default === 'TODAY' ? todayISO() : p.default === 'THIS_YEAR' ? Number(todayISO().slice(0, 4)) : p.default,
      })),
    }));
  }

  private scope(user: AccessContext): SQL {
    return this.assetsService.scopeCondition(user) ?? sql`true`;
  }

  private range(p: Record<string, unknown>) {
    const from = isDate(p.from) ? String(p.from) : yearStart();
    const to = isDate(p.to) ? String(p.to) : todayISO();
    if (from > to) throw new BadRequestException('Khoảng thời gian không hợp lệ (từ ngày > đến ngày)');
    return { from, to };
  }

  private rows<T>(q: Promise<{ rows: unknown[] }>): Promise<T[]> {
    return q.then((r) => r.rows as T[]);
  }

  async run(key: string, params: Record<string, unknown>, user: AccessContext): Promise<ReportResult> {
    const def = REPORTS.find((r) => r.key === key);
    if (!def) throw new NotFoundException('Không có báo cáo này');
    switch (key) {
      case 'so-tai-san':
        return this.ledger(def, params, user);
      case 'tang-giam':
        return this.movement(def, params, user);
      case 'theo-khoa':
        return this.byDepartment(def, params, user);
      case 'chi-phi':
        return this.costs(def, params, user);
      case 'den-han':
        return this.due(def, params, user);
      case 'het-khau-hao':
        return this.fullyDepreciated(def, params, user);
      case 'thanh-ly':
        return this.disposals(def, params, user);
      case 'kiem-ke':
        return this.inventories(def, params, user);
      default:
        throw new NotFoundException('Không có báo cáo này');
    }
  }

  /* ------------------------------------------------------------ 1. Sổ TSCĐ */
  private async ledger(def: ReportDef, p: Record<string, unknown>, user: AccessContext): Promise<ReportResult> {
    const { items, summary } = await this.assetsService.list(
      {
        all: true, status: String(p.status ?? 'ACTIVE') || undefined, departmentId: n(p.departmentId) || undefined, categoryId: n(p.categoryId) || undefined,
        group: p.group ? String(p.group) : undefined, kind: p.kind ? String(p.kind) : undefined, sortBy: 'code', sortDir: 'asc',
      },
      user,
    );
    const byCat = new Map<string, typeof items>();
    for (const a of items) {
      const k = a.categoryName ?? '(Chưa phân loại)';
      if (!byCat.has(k)) byCat.set(k, []);
      byCat.get(k)!.push(a);
    }
    const rows: ReportRow[] = [];
    let stt = 0;
    for (const [cat, list] of [...byCat.entries()].sort((a, b) => a[0].localeCompare(b[0], 'vi'))) {
      rows.push({ _kind: 'group', code: cat, name: `${list.length} tài sản` });
      for (const a of list) {
        rows.push({
          stt: ++stt, code: a.code, name: a.name, unit: a.unit, acquisitionDate: a.acquisitionDate, departmentName: a.departmentName ?? 'Kho',
          fundingSourceName: a.fundingSourceName ?? '', originalCost: a.originalCost, annualRate: a.annualRate, accumulated: a.accumulatedDepreciation,
          bookValue: a.bookValue, status: a.status, _link: `/tai-san/${a.id}`,
        });
      }
      rows.push({
        _kind: 'subtotal', name: `Cộng ${cat}`, originalCost: list.reduce((s, a) => s + n(a.originalCost), 0),
        accumulated: list.reduce((s, a) => s + n(a.accumulatedDepreciation), 0), bookValue: list.reduce((s, a) => s + n(a.bookValue), 0),
      });
    }
    rows.push({ _kind: 'total', name: `TỔNG CỘNG (${items.length} tài sản)`, originalCost: summary.cost, accumulated: summary.accumulated, bookValue: summary.bookValue });
    return {
      key: def.key, title: def.title.toUpperCase(), subtitle: `Tính đến ngày ${vnDate(todayISO())}`, orientation: 'landscape', params: p,
      columns: [
        { key: 'stt', title: 'STT', type: 'int', width: 8 },
        { key: 'code', title: 'Mã tài sản', width: 24 },
        { key: 'name', title: 'Tên tài sản', width: 48 },
        { key: 'unit', title: 'ĐVT', width: 10 },
        { key: 'acquisitionDate', title: 'Ngày ghi tăng', type: 'date', width: 18 },
        { key: 'departmentName', title: 'Nơi sử dụng', width: 30 },
        { key: 'fundingSourceName', title: 'Nguồn vốn', width: 22 },
        { key: 'originalCost', title: 'Nguyên giá', type: 'money', width: 24 },
        { key: 'annualRate', title: 'Tỉ lệ %/năm', type: 'pct', width: 11 },
        { key: 'accumulated', title: 'Hao mòn luỹ kế', type: 'money', width: 24 },
        { key: 'bookValue', title: 'Giá trị còn lại', type: 'money', width: 24 },
        { key: 'status', title: 'Trạng thái', type: 'status', width: 20 },
      ],
      rows,
      summary: [
        { label: 'Số tài sản', value: items.length, type: 'int' },
        { label: 'Nguyên giá', value: summary.cost, type: 'money' },
        { label: 'Hao mòn luỹ kế', value: summary.accumulated, type: 'money', color: '#d97706' },
        { label: 'Giá trị còn lại', value: summary.bookValue, type: 'money', color: '#16a34a' },
      ],
      chart: { type: 'bar', label: 'Nguyên giá / giá trị còn lại theo loại', valueLabel: 'Nguyên giá', value2Label: 'Còn lại', data: [...byCat.entries()].map(([name, l]) => ({ name, value: l.reduce((s, a) => s + n(a.originalCost), 0), value2: l.reduce((s, a) => s + n(a.bookValue), 0) })).sort((a, b) => b.value - a.value).slice(0, 12) },
    };
  }

  /* ------------------------------------------------------------ 2. Tăng giảm */
  private async movement(def: ReportDef, p: Record<string, unknown>, user: AccessContext): Promise<ReportResult> {
    const { from, to } = this.range(p);
    const groupBy = ['category', 'group', 'department', 'funding'].includes(String(p.groupBy)) ? String(p.groupBy) : 'category';
    const gl =
      groupBy === 'category' ? sql`coalesce(${assetCategories.name}, '(Chưa phân loại)')`
      : groupBy === 'group' ? sql`coalesce(${assetCategories.group}, 'KHAC')`
      : groupBy === 'department' ? sql`coalesce(${departments.name}, 'Kho / chưa cấp phát')`
      : sql`coalesce(${assetFundingSources.name}, '(Chưa rõ nguồn vốn)')`;
    const acq = sql`coalesce(${assets.acquisitionDate}, ${assets.inUseDate}, (${assets.createdAt} at time zone 'Asia/Ho_Chi_Minh')::date)`;
    const rows = await this.rows<Record<string, unknown>>(
      this.db.db.execute(sql`
        with d as (
          select i.asset_id, min(t.tx_date) as disp
          from ${assetTransactionItems} i join ${assetTransactions} t on t.id = i.transaction_id
          where t.status = 'DA_DUYET' and t.type in ('THANH_LY', 'BAO_MAT') group by i.asset_id
        )
        select ${gl} as label,
          count(*) filter (where ${acq} < ${from}::date and (d.disp is null or d.disp >= ${from}::date))::int as oq,
          coalesce(sum(${assets.originalCost}) filter (where ${acq} < ${from}::date and (d.disp is null or d.disp >= ${from}::date)), 0)::float8 as oc,
          count(*) filter (where ${acq} between ${from}::date and ${to}::date)::int as iq,
          coalesce(sum(${assets.originalCost}) filter (where ${acq} between ${from}::date and ${to}::date), 0)::float8 as ic,
          count(*) filter (where d.disp between ${from}::date and ${to}::date)::int as dq,
          coalesce(sum(${assets.originalCost}) filter (where d.disp between ${from}::date and ${to}::date), 0)::float8 as dc,
          count(*) filter (where ${acq} <= ${to}::date and (d.disp is null or d.disp > ${to}::date))::int as cq,
          coalesce(sum(${assets.originalCost}) filter (where ${acq} <= ${to}::date and (d.disp is null or d.disp > ${to}::date)), 0)::float8 as cc
        from ${assets}
        left join d on d.asset_id = ${assets.id}
        left join ${assetCategories} on ${assetCategories.id} = ${assets.categoryId}
        left join ${departments} on ${departments.id} = ${assets.departmentId}
        left join ${assetFundingSources} on ${assetFundingSources.id} = ${assets.fundingSourceId}
        where ${assets.deletedAt} is null and ${this.scope(user)}
        group by 1 order by 1`),
    );
    const data = rows
      .map((r): Record<string, unknown> => ({ ...r, label: groupBy === 'group' ? ASSET_GROUP[String(r.label)] ?? r.label : r.label }))
      .filter((r) => n(r.oq) + n(r.iq) + n(r.dq) + n(r.cq) > 0);
    const sum = (k: string) => data.reduce((s, r) => s + n(r[k]), 0);
    const out: ReportRow[] = data.map((r, i) => ({ stt: i + 1, ...r }));
    out.push({ _kind: 'total', label: 'TỔNG CỘNG', oq: sum('oq'), oc: sum('oc'), iq: sum('iq'), ic: sum('ic'), dq: sum('dq'), dc: sum('dc'), cq: sum('cq'), cc: sum('cc') });
    const groupTitle = { category: 'Loại tài sản', group: 'Nhóm tài sản', department: 'Khoa/phòng', funding: 'Nguồn vốn' }[groupBy]!;
    return {
      key: def.key, title: 'BÁO CÁO TÌNH HÌNH TĂNG, GIẢM TÀI SẢN', subtitle: `Từ ngày ${vnDate(from)} đến ngày ${vnDate(to)} · theo ${groupTitle.toLowerCase()} · nguyên giá hiện hành`,
      orientation: 'landscape', params: { ...p, from, to, groupBy },
      columns: [
        { key: 'stt', title: 'STT', type: 'int', width: 8 },
        { key: 'label', title: groupTitle, width: 52 },
        { key: 'oq', title: 'Đầu kỳ SL', type: 'int', width: 12 },
        { key: 'oc', title: 'Đầu kỳ nguyên giá', type: 'money', width: 25 },
        { key: 'iq', title: 'Tăng SL', type: 'int', width: 12 },
        { key: 'ic', title: 'Tăng nguyên giá', type: 'money', width: 25 },
        { key: 'dq', title: 'Giảm SL', type: 'int', width: 12 },
        { key: 'dc', title: 'Giảm nguyên giá', type: 'money', width: 25 },
        { key: 'cq', title: 'Cuối kỳ SL', type: 'int', width: 12 },
        { key: 'cc', title: 'Cuối kỳ nguyên giá', type: 'money', width: 25 },
      ],
      rows: out,
      summary: [
        { label: 'Đầu kỳ', value: sum('oc'), type: 'money' },
        { label: `Tăng (${sum('iq')} TS)`, value: sum('ic'), type: 'money', color: '#16a34a' },
        { label: `Giảm (${sum('dq')} TS)`, value: sum('dc'), type: 'money', color: '#dc2626' },
        { label: 'Cuối kỳ', value: sum('cc'), type: 'money', color: '#0d9488' },
      ],
      chart: { type: 'bar', label: 'Tăng / giảm nguyên giá trong kỳ', valueLabel: 'Tăng', value2Label: 'Giảm', data: data.map((r) => ({ name: String(r.label), value: n(r.ic), value2: n(r.dc) })).filter((d) => d.value || d.value2).slice(0, 12) },
    };
  }

  /* ------------------------------------------------------------ 3. Theo khoa */
  private async byDepartment(def: ReportDef, p: Record<string, unknown>, user: AccessContext): Promise<ReportResult> {
    const today = todayISO();
    const groupCond = p.group ? sql`and ${assets.categoryId} in (select id from ${assetCategories} where group_code = ${String(p.group)})` : sql``;
    const rows = await this.rows<Record<string, unknown>>(
      this.db.db.execute(sql`
        select ${assets.departmentId} as id, coalesce(${departments.name}, 'Kho / chưa cấp phát') as label,
          count(*)::int as total,
          coalesce(sum(${assets.originalCost}), 0)::float8 as cost,
          coalesce(sum(${assets.accumulatedDepreciation}), 0)::float8 as acc,
          coalesce(sum(${this.assetsService.bookValueExpr}), 0)::float8 as book,
          count(*) filter (where ${assets.status} = 'DANG_SU_DUNG')::int as inuse,
          count(*) filter (where ${assets.status} = 'TRONG_KHO')::int as store,
          count(*) filter (where ${assets.status} in ('HONG', 'DANG_SUA_CHUA'))::int as broken,
          count(*) filter (where ${assets.status} = 'CHO_THANH_LY')::int as pending,
          count(*) filter (where ${assetCategories.group} = 'THIET_BI_Y_TE')::int as medical,
          count(*) filter (where ${assets.nextCalibrationDate} < ${today}::date or ${assets.nextMaintenanceDate} < ${today}::date)::int as overdue
        from ${assets}
        left join ${departments} on ${departments.id} = ${assets.departmentId}
        left join ${assetCategories} on ${assetCategories.id} = ${assets.categoryId}
        where ${assets.deletedAt} is null and ${assets.status} in (${sql.join(ACTIVE_STATUSES.map((s) => sql`${s}`), sql`, `)}) and ${this.scope(user)} ${groupCond}
        group by 1, 2 order by cost desc`),
    );
    const sum = (k: string) => rows.reduce((s, r) => s + n(r[k]), 0);
    const out: ReportRow[] = rows.map((r, i) => ({ stt: i + 1, ...r, _link: `/tai-san/danh-sach?departmentId=${r.id ?? -1}` }));
    out.push({ _kind: 'total', label: 'TỔNG CỘNG', ...Object.fromEntries(['total', 'cost', 'acc', 'book', 'inuse', 'store', 'broken', 'pending', 'medical', 'overdue'].map((k) => [k, sum(k)])) });
    return {
      key: def.key, title: 'TỔNG HỢP TÀI SẢN THEO KHOA/PHÒNG', subtitle: `Tính đến ngày ${vnDate(today)}${p.group ? ` · nhóm ${ASSET_GROUP[String(p.group)] ?? p.group}` : ''}`,
      orientation: 'landscape', params: p,
      columns: [
        { key: 'stt', title: 'STT', type: 'int', width: 8 },
        { key: 'label', title: 'Khoa/phòng', width: 46 },
        { key: 'total', title: 'Số TS', type: 'int', width: 12 },
        { key: 'cost', title: 'Nguyên giá', type: 'money', width: 26 },
        { key: 'acc', title: 'Hao mòn luỹ kế', type: 'money', width: 26 },
        { key: 'book', title: 'Giá trị còn lại', type: 'money', width: 26 },
        { key: 'inuse', title: 'Đang dùng', type: 'int', width: 13 },
        { key: 'store', title: 'Trong kho', type: 'int', width: 13 },
        { key: 'broken', title: 'Hỏng / sửa', type: 'int', width: 13 },
        { key: 'pending', title: 'Chờ TL', type: 'int', width: 12 },
        { key: 'medical', title: 'TBYT', type: 'int', width: 12 },
        { key: 'overdue', title: 'Quá hạn KĐ/BD', type: 'int', width: 16 },
      ],
      rows: out,
      summary: [
        { label: 'Số khoa/phòng', value: rows.length, type: 'int' },
        { label: 'Số tài sản', value: sum('total'), type: 'int' },
        { label: 'Nguyên giá', value: sum('cost'), type: 'money' },
        { label: 'Quá hạn KĐ/BD', value: sum('overdue'), type: 'int', color: '#dc2626' },
      ],
      chart: { type: 'bar', label: 'Nguyên giá / còn lại theo khoa', valueLabel: 'Nguyên giá', value2Label: 'Còn lại', data: rows.slice(0, 12).map((r) => ({ name: String(r.label), value: n(r.cost), value2: n(r.book) })) },
    };
  }

  /* ------------------------------------------------------------ 4. Chi phí */
  private async costs(def: ReportDef, p: Record<string, unknown>, user: AccessContext): Promise<ReportResult> {
    const { from, to } = this.range(p);
    const view = ['detail', 'asset', 'department', 'supplier'].includes(String(p.view)) ? String(p.view) : 'detail';
    const deptCond = n(p.departmentId) ? sql`and ${assets.departmentId} = ${n(p.departmentId)}` : sql``;
    const base = sql`
      from ${assetTransactionItems}
      join ${assetTransactions} on ${assetTransactions.id} = ${assetTransactionItems.transactionId}
      join ${assets} on ${assets.id} = ${assetTransactionItems.assetId}
      left join ${departments} on ${departments.id} = coalesce(${assetTransactions.fromDepartmentId}, ${assets.departmentId})
      left join ${assetSuppliers} on ${assetSuppliers.id} = ${assetTransactions.supplierId}
      where ${assetTransactions.status} = 'DA_DUYET' and ${assetTransactions.type} in ('HOAN_THANH_SUA', 'BAO_DUONG', 'KIEM_DINH')
        and ${assetTransactions.txDate} between ${from}::date and ${to}::date and ${this.scope(user)} ${deptCond}`;
    const byType = await this.rows<{ type: string; amount: number; n: number }>(
      this.db.db.execute(sql`select ${assetTransactions.type} as type, coalesce(sum(${assetTransactionItems.amount}), 0)::float8 as amount, count(*)::int as n ${base} group by 1`),
    );
    const total = byType.reduce((s, r) => s + n(r.amount), 0);
    const tLabel = (t: string) => ({ HOAN_THANH_SUA: 'Sửa chữa', BAO_DUONG: 'Bảo dưỡng', KIEM_DINH: 'Kiểm định' })[t] ?? t;
    let columns: ReportColumn[];
    let out: ReportRow[];
    if (view === 'detail') {
      const rows = await this.rows<Record<string, unknown>>(
        this.db.db.execute(sql`
          select ${assetTransactions.id} as tx_id, ${assetTransactions.txDate} as date, ${assetTransactions.code} as tx_code, ${assetTransactions.type} as type,
            ${assets.id} as asset_id, ${assets.code} as code, ${assets.name} as name, ${departments.name} as dept, ${assetSuppliers.name} as supplier,
            ${assetTransactionItems.amount}::float8 as amount, nullif(${assetTransactionItems.note}, '') as note
          ${base} order by ${assetTransactions.txDate}, ${assetTransactions.code}`),
      );
      columns = [
        { key: 'stt', title: 'STT', type: 'int', width: 8 },
        { key: 'date', title: 'Ngày', type: 'date', width: 18 },
        { key: 'txCode', title: 'Số chứng từ', width: 24 },
        { key: 'typeLabel', title: 'Nội dung', width: 18 },
        { key: 'code', title: 'Mã tài sản', width: 24 },
        { key: 'name', title: 'Tên tài sản', width: 46 },
        { key: 'dept', title: 'Khoa/phòng', width: 30 },
        { key: 'supplier', title: 'Đơn vị thực hiện', width: 32 },
        { key: 'amount', title: 'Chi phí', type: 'money', width: 24 },
      ];
      out = rows.map((r, i) => ({ stt: i + 1, date: r.date, txCode: r.tx_code, typeLabel: tLabel(String(r.type)), code: r.code, name: r.name, dept: r.dept ?? 'Kho', supplier: r.supplier ?? '', amount: r.amount, _link: `/tai-san/nghiep-vu/${r.tx_id}` }));
    } else {
      const key = view === 'asset' ? sql`${assets.id}::text` : view === 'department' ? sql`coalesce(${departments.name}, 'Kho')` : sql`coalesce(${assetSuppliers.name}, '(Nội bộ / chưa ghi)')`;
      const label = view === 'asset' ? sql`max(${assets.code} || ' — ' || ${assets.name})` : key;
      const rows = await this.rows<Record<string, unknown>>(
        this.db.db.execute(sql`
          select ${key} as k, ${label} as label,
            coalesce(sum(${assetTransactionItems.amount}) filter (where ${assetTransactions.type} = 'HOAN_THANH_SUA'), 0)::float8 as repair,
            coalesce(sum(${assetTransactionItems.amount}) filter (where ${assetTransactions.type} = 'BAO_DUONG'), 0)::float8 as maint,
            coalesce(sum(${assetTransactionItems.amount}) filter (where ${assetTransactions.type} = 'KIEM_DINH'), 0)::float8 as calib,
            coalesce(sum(${assetTransactionItems.amount}), 0)::float8 as amount, count(*)::int as times
            ${view === 'asset' ? sql`, max(${assets.originalCost})::float8 as cost` : sql``}
          ${base} group by 1 ${view === 'asset' ? sql`` : sql`, 2`} order by amount desc`),
      );
      const title = { asset: 'Tài sản', department: 'Khoa/phòng', supplier: 'Đơn vị thực hiện' }[view]!;
      columns = [
        { key: 'stt', title: 'STT', type: 'int', width: 8 },
        { key: 'label', title, width: 70 },
        { key: 'times', title: 'Số lần', type: 'int', width: 12 },
        { key: 'repair', title: 'Sửa chữa', type: 'money', width: 24 },
        { key: 'maint', title: 'Bảo dưỡng', type: 'money', width: 24 },
        { key: 'calib', title: 'Kiểm định', type: 'money', width: 24 },
        { key: 'amount', title: 'Tổng chi phí', type: 'money', width: 26 },
        ...(view === 'asset' ? [{ key: 'ratio', title: '% nguyên giá', type: 'pct' as ColType, width: 14 }] : []),
      ];
      out = rows.map((r, i) => ({ stt: i + 1, ...r, ...(view === 'asset' ? { ratio: n(r.cost) ? Math.round((n(r.amount) / n(r.cost)) * 1000) / 10 : 0, _link: `/tai-san/${r.k}` } : {}) }));
    }
    out.push({ _kind: 'total', [view === 'detail' ? 'name' : 'label']: 'TỔNG CỘNG', amount: total, ...(view !== 'detail' ? { repair: byType.find((b) => b.type === 'HOAN_THANH_SUA')?.amount ?? 0, maint: byType.find((b) => b.type === 'BAO_DUONG')?.amount ?? 0, calib: byType.find((b) => b.type === 'KIEM_DINH')?.amount ?? 0, times: byType.reduce((s, b) => s + n(b.n), 0) } : {}) });
    return {
      key: def.key, title: 'BÁO CÁO CHI PHÍ SỬA CHỮA, BẢO DƯỠNG, KIỂM ĐỊNH TÀI SẢN', subtitle: `Từ ngày ${vnDate(from)} đến ngày ${vnDate(to)}`,
      orientation: 'landscape', params: { ...p, from, to, view }, columns, rows: out,
      summary: [
        { label: 'Tổng chi phí', value: total, type: 'money', color: '#ea580c' },
        ...['HOAN_THANH_SUA', 'BAO_DUONG', 'KIEM_DINH'].map((t) => ({ label: `${tLabel(t)} (${byType.find((b) => b.type === t)?.n ?? 0} lượt)`, value: n(byType.find((b) => b.type === t)?.amount), type: 'money' as ColType })),
      ],
      chart: { type: 'pie', label: 'Cơ cấu chi phí', data: byType.map((b) => ({ name: tLabel(b.type), value: n(b.amount) })).filter((d) => d.value > 0) },
    };
  }

  /* ------------------------------------------------------------ 5. Đến hạn */
  private async due(def: ReportDef, p: Record<string, unknown>, user: AccessContext): Promise<ReportResult> {
    const days = Math.min(3650, Math.max(0, Math.trunc(n(p.days ?? 60))));
    const type = String(p.type ?? '');
    const today = todayISO();
    const until = sql`(${today}::date + ${days}::int)`;
    const deptCond = n(p.departmentId) ? (n(p.departmentId) === -1 ? sql`and ${assets.departmentId} is null` : sql`and ${assets.departmentId} = ${n(p.departmentId)}`) : sql``;
    const parts: SQL[] = [];
    const sel = (kind: string, col: SQL) => sql`
      select ${assets.id} as id, ${assets.code} as code, ${assets.name} as name, ${assets.model} as model, ${assets.serialNumber} as serial,
        coalesce(${departments.name}, 'Kho') as dept, ${assets.status} as status, ${kind} as kind, ${col} as due, (${col} - ${today}::date)::int as days_left
      from ${assets} left join ${departments} on ${departments.id} = ${assets.departmentId}
      where ${assets.deletedAt} is null and ${assets.status} in (${sql.join(ACTIVE_STATUSES.map((s) => sql`${s}`), sql`, `)}) and ${this.scope(user)} ${deptCond}
        and ${col} is not null and ${col} <= ${until} ${kind === 'warranty' ? sql`and ${col} >= ${today}::date - 30` : sql``}`;
    if (!type || type === 'calibration') parts.push(sel('calibration', sql`${assets.nextCalibrationDate}`));
    if (!type || type === 'maintenance') parts.push(sel('maintenance', sql`${assets.nextMaintenanceDate}`));
    if (!type || type === 'warranty') parts.push(sel('warranty', sql`${assets.warrantyUntil}`));
    const rows = await this.rows<Record<string, unknown>>(this.db.db.execute(sql`select * from (${sql.join(parts, sql` union all `)}) x order by due, code`));
    const kindLabel: Record<string, string> = { calibration: 'Kiểm định/hiệu chuẩn', maintenance: 'Bảo dưỡng', warranty: 'Hết bảo hành' };
    const overdue = rows.filter((r) => n(r.days_left) < 0 && r.kind !== 'warranty').length;
    return {
      key: def.key, title: 'DANH SÁCH THIẾT BỊ ĐẾN HẠN KIỂM ĐỊNH, BẢO DƯỠNG, HẾT BẢO HÀNH', subtitle: `Quá hạn và đến hạn trong ${days} ngày tới (tính từ ${vnDate(today)})`,
      orientation: 'landscape', params: { ...p, days },
      columns: [
        { key: 'stt', title: 'STT', type: 'int', width: 8 },
        { key: 'kindLabel', title: 'Loại hạn', width: 24 },
        { key: 'due', title: 'Ngày đến hạn', type: 'date', width: 18 },
        { key: 'daysText', title: 'Còn lại', width: 18 },
        { key: 'code', title: 'Mã tài sản', width: 24 },
        { key: 'name', title: 'Tên thiết bị', width: 50 },
        { key: 'modelSerial', title: 'Model / Serial', width: 34 },
        { key: 'dept', title: 'Khoa/phòng', width: 34 },
        { key: 'status', title: 'Trạng thái', type: 'status', width: 20 },
      ],
      rows: rows.map((r, i) => ({
        stt: i + 1, kindLabel: kindLabel[String(r.kind)], due: r.due, daysText: n(r.days_left) < 0 ? `Quá ${-n(r.days_left)} ngày` : n(r.days_left) === 0 ? 'Hôm nay' : `${r.days_left} ngày`,
        _overdue: n(r.days_left) < 0, code: r.code, name: r.name, modelSerial: [r.model, r.serial].filter(Boolean).join(' / '), dept: r.dept, status: r.status, _link: `/tai-san/${r.id}`,
      })),
      summary: [
        { label: 'Tổng số lượt đến hạn', value: rows.length, type: 'int' },
        { label: 'Đã quá hạn', value: overdue, type: 'int', color: '#dc2626' },
        { label: 'Kiểm định', value: rows.filter((r) => r.kind === 'calibration').length, type: 'int', color: '#2563eb' },
        { label: 'Bảo dưỡng', value: rows.filter((r) => r.kind === 'maintenance').length, type: 'int', color: '#d97706' },
      ],
    };
  }

  /* ------------------------------------------------------------ 6. Hết khấu hao */
  private async fullyDepreciated(def: ReportDef, p: Record<string, unknown>, user: AccessContext): Promise<ReportResult> {
    const deptCond = n(p.departmentId) ? (n(p.departmentId) === -1 ? sql`and ${assets.departmentId} is null` : sql`and ${assets.departmentId} = ${n(p.departmentId)}`) : sql``;
    const groupCond = p.group ? sql`and ${assetCategories.group} = ${String(p.group)}` : sql``;
    const rows = await this.rows<Record<string, unknown>>(
      this.db.db.execute(sql`
        select ${assets.id} as id, ${assets.code} as code, ${assets.name} as name, coalesce(${departments.name}, 'Kho') as dept, ${assetCategories.name} as cat,
          coalesce(${assets.inUseDate}, ${assets.acquisitionDate}) as since, ${assets.usefulLifeMonths} as life, ${assets.originalCost}::float8 as cost,
          ${assets.accumulatedDepreciation}::float8 as acc, ${assets.status} as status, ${assets.condition} as condition,
          round(extract(epoch from age(now(), coalesce(${assets.inUseDate}, ${assets.acquisitionDate})::timestamp)) / 31557600.0, 1)::float8 as years
        from ${assets}
        left join ${departments} on ${departments.id} = ${assets.departmentId}
        left join ${assetCategories} on ${assetCategories.id} = ${assets.categoryId}
        where ${assets.deletedAt} is null and ${assets.status} in (${sql.join(ACTIVE_STATUSES.map((s) => sql`${s}`), sql`, `)}) and ${this.scope(user)}
          and ${assets.originalCost} > 0 and ${assets.depreciationMethod} <> 'NONE'
          and ${assets.originalCost} - ${assets.accumulatedDepreciation} <= ${assets.residualValue} ${deptCond} ${groupCond}
        order by years desc nulls last, code`),
    );
    const cost = rows.reduce((s, r) => s + n(r.cost), 0);
    return {
      key: def.key, title: 'TÀI SẢN ĐÃ HẾT KHẤU HAO/HAO MÒN VẪN ĐANG SỬ DỤNG', subtitle: `Tính đến ngày ${vnDate(todayISO())}`, orientation: 'landscape', params: p,
      columns: [
        { key: 'stt', title: 'STT', type: 'int', width: 8 },
        { key: 'code', title: 'Mã tài sản', width: 24 },
        { key: 'name', title: 'Tên tài sản', width: 50 },
        { key: 'cat', title: 'Loại', width: 30 },
        { key: 'dept', title: 'Khoa/phòng', width: 32 },
        { key: 'since', title: 'Sử dụng từ', type: 'date', width: 18 },
        { key: 'years', title: 'Số năm', width: 12 },
        { key: 'cost', title: 'Nguyên giá', type: 'money', width: 24 },
        { key: 'conditionText', title: 'Tình trạng', width: 18 },
        { key: 'status', title: 'Trạng thái', type: 'status', width: 20 },
      ],
      rows: [
        ...rows.map((r, i) => ({ stt: i + 1, ...r, years: r.years ?? '', conditionText: ASSET_CONDITION[String(r.condition)] ?? r.condition, _link: `/tai-san/${r.id}` })),
        { _kind: 'total' as const, name: `TỔNG CỘNG (${rows.length} tài sản)`, cost },
      ],
      summary: [
        { label: 'Số tài sản', value: rows.length, type: 'int' },
        { label: 'Tổng nguyên giá', value: cost, type: 'money' },
        { label: 'Tình trạng kém/hỏng', value: rows.filter((r) => ['KEM', 'HONG'].includes(String(r.condition))).length, type: 'int', color: '#dc2626' },
      ],
    };
  }

  /* ------------------------------------------------------------ 7. Ghi giảm */
  private async disposals(def: ReportDef, p: Record<string, unknown>, user: AccessContext): Promise<ReportResult> {
    const { from, to } = this.range(p);
    const rows = await this.rows<Record<string, unknown>>(
      this.db.db.execute(sql`
        select ${assetTransactions.id} as tx_id, ${assetTransactions.txDate} as date, ${assetTransactions.code} as tx_code, ${assetTransactions.type} as type,
          ${assetTransactions.decisionNo} as decision, ${assets.id} as id, ${assets.code} as code, ${assets.name} as name,
          coalesce(${departments.name}, 'Kho') as dept,
          coalesce((${assetTransactionItems.before}->>'originalCost')::float8, ${assets.originalCost}::float8) as cost,
          coalesce((${assetTransactionItems.before}->>'accumulatedDepreciation')::float8, ${assets.accumulatedDepreciation}::float8) as acc,
          ${assetTransactionItems.amount}::float8 as recovered
        from ${assetTransactionItems}
        join ${assetTransactions} on ${assetTransactions.id} = ${assetTransactionItems.transactionId}
        join ${assets} on ${assets.id} = ${assetTransactionItems.assetId}
        left join ${departments} on ${departments.id} = coalesce((${assetTransactionItems.before}->>'departmentId')::int, ${assetTransactions.fromDepartmentId})
        where ${assetTransactions.status} = 'DA_DUYET' and ${assetTransactions.type} in ('THANH_LY', 'BAO_MAT')
          and ${assetTransactions.txDate} between ${from}::date and ${to}::date and ${this.scope(user)}
        order by ${assetTransactions.txDate}, ${assetTransactions.code}`),
    );
    const sum = (k: string) => rows.reduce((s, r) => s + n(r[k]), 0);
    const book = (r: Record<string, unknown>) => Math.max(0, n(r.cost) - n(r.acc));
    return {
      key: def.key, title: 'BÁO CÁO TÀI SẢN GHI GIẢM (THANH LÝ, MẤT)', subtitle: `Từ ngày ${vnDate(from)} đến ngày ${vnDate(to)}`, orientation: 'landscape', params: { ...p, from, to },
      columns: [
        { key: 'stt', title: 'STT', type: 'int', width: 8 },
        { key: 'date', title: 'Ngày', type: 'date', width: 18 },
        { key: 'txCode', title: 'Chứng từ', width: 24 },
        { key: 'typeLabel', title: 'Hình thức', width: 16 },
        { key: 'code', title: 'Mã tài sản', width: 24 },
        { key: 'name', title: 'Tên tài sản', width: 46 },
        { key: 'dept', title: 'Khoa/phòng', width: 28 },
        { key: 'cost', title: 'Nguyên giá', type: 'money', width: 22 },
        { key: 'acc', title: 'Hao mòn luỹ kế', type: 'money', width: 22 },
        { key: 'book', title: 'Giá trị còn lại', type: 'money', width: 22 },
        { key: 'recovered', title: 'Thu hồi', type: 'money', width: 20 },
      ],
      rows: [
        ...rows.map((r, i) => ({ stt: i + 1, date: r.date, txCode: r.tx_code, typeLabel: TX_TYPES[String(r.type)]?.label ?? r.type, code: r.code, name: r.name, dept: r.dept, cost: r.cost, acc: r.acc, book: book(r), recovered: r.recovered, _link: `/tai-san/nghiep-vu/${r.tx_id}` })),
        { _kind: 'total' as const, name: `TỔNG CỘNG (${rows.length} tài sản)`, cost: sum('cost'), acc: sum('acc'), book: rows.reduce((s, r) => s + book(r), 0), recovered: sum('recovered') },
      ],
      summary: [
        { label: 'Thanh lý', value: rows.filter((r) => r.type === 'THANH_LY').length, type: 'int' },
        { label: 'Báo mất', value: rows.filter((r) => r.type === 'BAO_MAT').length, type: 'int', color: '#dc2626' },
        { label: 'Nguyên giá ghi giảm', value: sum('cost'), type: 'money' },
        { label: 'Giá trị thu hồi', value: sum('recovered'), type: 'money', color: '#16a34a' },
      ],
    };
  }

  /* ------------------------------------------------------------ 8. Kiểm kê */
  private async inventories(def: ReportDef, p: Record<string, unknown>, user: AccessContext): Promise<ReportResult> {
    const year = Math.trunc(n(p.year)) || Number(todayISO().slice(0, 4));
    const ids = this.assetsService.scopeDeptIds(user);
    const vis = this.assetsService.canSeeAll(user)
      ? sql`true`
      : ids.length
        ? sql`(${assetInventories.createdBy} = ${user.id} or exists (select 1 from jsonb_array_elements_text(coalesce(${assetInventories.scope}->'departmentIds', '[]'::jsonb)) d where d::int = any(array[${sql.join(ids.map((i) => sql`${i}`), sql`, `)}]::int[])))`
        : sql`${assetInventories.createdBy} = ${user.id}`;
    const rows = await this.rows<Record<string, unknown>>(
      this.db.db.execute(sql`
        select ${assetInventories.id} as id, ${assetInventories.code} as code, ${assetInventories.name} as name, ${assetInventories.status} as status,
          ${assetInventories.snapshotAt} as snap,
          count(i.id) filter (where i.expected)::int as expected,
          count(i.id) filter (where i.check_state = 'CO' and i.expected)::int as found,
          count(i.id) filter (where i.result = 'THIEU')::int as missing,
          count(i.id) filter (where i.result in ('THUA', 'KHONG_RO'))::int as extra,
          count(i.id) filter (where i.result = 'SAI_VI_TRI')::int as misplaced,
          count(i.id) filter (where i.result = 'SAI_TINH_TRANG')::int as condition,
          coalesce(sum(i.book_cost) filter (where i.result = 'THIEU'), 0)::float8 as missing_cost
        from ${assetInventories}
        left join ${assetInventoryItems} i on i.inventory_id = ${assetInventories.id}
        where ${assetInventories.status} <> 'DA_HUY' and extract(year from coalesce(${assetInventories.snapshotAt}, ${assetInventories.createdAt})) = ${year} and ${vis}
        group by ${assetInventories.id} order by ${assetInventories.id}`),
    );
    const sum = (k: string) => rows.reduce((s, r) => s + n(r[k]), 0);
    return {
      key: def.key, title: 'TỔNG HỢP KẾT QUẢ KIỂM KÊ TÀI SẢN', subtitle: `Năm ${year}`, orientation: 'landscape', params: { ...p, year },
      columns: [
        { key: 'stt', title: 'STT', type: 'int', width: 8 },
        { key: 'code', title: 'Mã đợt', width: 20 },
        { key: 'name', title: 'Tên đợt kiểm kê', width: 56 },
        { key: 'snap', title: 'Ngày chốt sổ', type: 'date', width: 18 },
        { key: 'statusText', title: 'Trạng thái', width: 18 },
        { key: 'expected', title: 'Theo sổ', type: 'int', width: 13 },
        { key: 'found', title: 'Có mặt', type: 'int', width: 13 },
        { key: 'missing', title: 'Thiếu', type: 'int', width: 12 },
        { key: 'extra', title: 'Thừa', type: 'int', width: 12 },
        { key: 'misplaced', title: 'Sai vị trí', type: 'int', width: 13 },
        { key: 'condition', title: 'Khác tình trạng', type: 'int', width: 15 },
        { key: 'rate', title: 'Tỉ lệ khớp %', type: 'pct', width: 14 },
        { key: 'missingCost', title: 'Nguyên giá thiếu', type: 'money', width: 24 },
      ],
      rows: [
        ...rows.map((r, i) => ({
          stt: i + 1, ...r, snap: r.snap ? new Date(new Date(String(r.snap)).getTime() + 7 * 3600_000).toISOString().slice(0, 10) : '', statusText: INVENTORY_STATUS[String(r.status)]?.label ?? r.status,
          rate: n(r.expected) ? Math.round((n(r.found) / n(r.expected)) * 1000) / 10 : 0, missingCost: r.missing_cost, _link: `/tai-san/kiem-ke/${r.id}`,
        })),
        { _kind: 'total' as const, name: 'TỔNG CỘNG', expected: sum('expected'), found: sum('found'), missing: sum('missing'), extra: sum('extra'), misplaced: sum('misplaced'), condition: sum('condition'), missingCost: sum('missing_cost') },
      ],
      summary: [
        { label: 'Số đợt', value: rows.length, type: 'int' },
        { label: 'Tài sản đã kiểm', value: sum('found'), type: 'int', color: '#16a34a' },
        { label: 'Thiếu', value: sum('missing'), type: 'int', color: '#dc2626' },
        { label: 'Nguyên giá thiếu', value: sum('missing_cost'), type: 'money', color: '#dc2626' },
      ],
    };
  }

  /* ------------------------------------------------------------ Lịch bảo trì / kiểm định */
  /**
   * Sự kiện trong khoảng [from, to]: hạn kiểm định, bảo dưỡng (kèm các lần lặp dự kiến theo chu kỳ),
   * hết bảo hành. Các hạn đã quá (trước hôm nay) luôn được trả về trong `overdue`.
   */
  async schedule(q: { from?: string; to?: string; types?: string; departmentId?: number; group?: string }, user: AccessContext) {
    const today = todayISO();
    const from = isDate(q.from) ? String(q.from) : `${today.slice(0, 7)}-01`;
    const to = isDate(q.to) ? String(q.to) : addMonthsISO(from, 1);
    if (from > to) throw new BadRequestException('Khoảng thời gian không hợp lệ');
    const types = String(q.types ?? 'calibration,maintenance,warranty').split(',').filter(Boolean);
    const deptCond = n(q.departmentId) ? (n(q.departmentId) === -1 ? sql`and ${assets.departmentId} is null` : sql`and ${assets.departmentId} = ${n(q.departmentId)}`) : sql``;
    const groupCond = q.group ? sql`and ${assetCategories.group} = ${String(q.group)}` : sql``;
    const rows = await this.rows<{
      id: number; code: string; name: string; dept: string | null; location: string | null; status: string; risk: string; group: string | null;
      cal: string | null; cal_iv: number; mt: string | null; mt_iv: number; wr: string | null;
    }>(
      this.db.db.execute(sql`
        select ${assets.id} as id, ${assets.code} as code, ${assets.name} as name, ${departments.name} as dept, ${assetLocations.name} as location,
          ${assets.status} as status, ${assets.riskClass} as risk, ${assetCategories.group} as group,
          ${assets.nextCalibrationDate}::text as cal, ${assets.calibrationIntervalMonths} as cal_iv,
          ${assets.nextMaintenanceDate}::text as mt, ${assets.maintenanceIntervalMonths} as mt_iv, ${assets.warrantyUntil}::text as wr
        from ${assets}
        left join ${departments} on ${departments.id} = ${assets.departmentId}
        left join ${assetLocations} on ${assetLocations.id} = ${assets.locationId}
        left join ${assetCategories} on ${assetCategories.id} = ${assets.categoryId}
        where ${assets.deletedAt} is null and ${assets.status} in (${sql.join(ACTIVE_STATUSES.map((s) => sql`${s}`), sql`, `)}) and ${this.scope(user)} ${deptCond} ${groupCond}
          and (${assets.nextCalibrationDate} is not null or ${assets.nextMaintenanceDate} is not null or ${assets.warrantyUntil} is not null)`),
    );
    type Ev = { date: string; kind: string; projected: boolean; assetId: number; code: string; name: string; department: string; location: string; status: string; riskClass: string; daysLeft: number };
    const events: Ev[] = [];
    const overdue: Ev[] = [];
    const dayDiff = (d: string) => Math.round((Date.parse(d) - Date.parse(today)) / 86_400_000);
    const push = (r: (typeof rows)[number], kind: string, date: string, projected: boolean) => {
      const ev: Ev = { date, kind, projected, assetId: r.id, code: r.code, name: r.name, department: r.dept ?? 'Kho', location: r.location ?? '', status: r.status, riskClass: r.risk, daysLeft: dayDiff(date) };
      if (!projected && date < today && kind !== 'warranty') overdue.push(ev);
      if (date >= from && date <= to) events.push(ev);
    };
    for (const r of rows) {
      const cycles: [string, string | null, number][] = [];
      if (types.includes('calibration')) cycles.push(['calibration', r.cal, r.cal_iv]);
      if (types.includes('maintenance')) cycles.push(['maintenance', r.mt, r.mt_iv]);
      for (const [kind, first, iv] of cycles) {
        if (!first) continue;
        push(r, kind, first, false);
        if (iv > 0) {
          // Lần lặp dự kiến (nếu hạn hiện tại được thực hiện đúng hạn)
          let d = addMonthsISO(first, iv);
          let guard = 0;
          while (d <= to && guard++ < 240) {
            if (d >= from) push(r, kind, d, true);
            d = addMonthsISO(d, iv);
          }
        }
      }
      if (types.includes('warranty') && r.wr) push(r, 'warranty', r.wr, false);
    }
    events.sort((a, b) => a.date.localeCompare(b.date) || a.code.localeCompare(b.code));
    overdue.sort((a, b) => a.date.localeCompare(b.date));
    return {
      from, to, today, events, overdue,
      counts: {
        calibration: events.filter((e) => e.kind === 'calibration').length,
        maintenance: events.filter((e) => e.kind === 'maintenance').length,
        warranty: events.filter((e) => e.kind === 'warranty').length,
        overdue: overdue.length,
        assets: new Set(events.map((e) => e.assetId)).size,
      },
    };
  }

  /* ------------------------------------------------------------ Hiển thị giá trị */
  private display(col: ReportColumn, v: unknown): string {
    if (v === null || v === undefined || v === '') return '';
    switch (col.type) {
      case 'money':
        return fmtMoney(v);
      case 'int':
        return n(v).toLocaleString('vi-VN');
      case 'pct':
        return `${n(v).toLocaleString('vi-VN', { maximumFractionDigits: 2 })}`;
      case 'date':
        return vnDate(v);
      case 'status':
        return ASSET_STATUS[String(v)]?.label ?? String(v);
      default:
        return String(v);
    }
  }

  /* ------------------------------------------------------------ Xuất Excel */
  async export(key: string, params: Record<string, unknown>, user: AccessContext) {
    const r = await this.run(key, params, user);
    const hospitalName = String((await this.settings.get('hospital.name', '')) ?? '');
    const wb = new ExcelJS.Workbook();
    wb.creator = 'QLBS';
    const ws = wb.addWorksheet(r.title.slice(0, 30).replace(/[\\/*?:[\]]/g, ''));
    ws.addRow([hospitalName.toUpperCase()]).font = { bold: true, color: { argb: 'FF334155' } };
    const t = ws.addRow([r.title]);
    t.font = { bold: true, size: 14 };
    ws.mergeCells(t.number, 1, t.number, r.columns.length);
    t.alignment = { horizontal: 'center' };
    const s = ws.addRow([r.subtitle]);
    s.font = { italic: true, color: { argb: 'FF475569' } };
    ws.mergeCells(s.number, 1, s.number, r.columns.length);
    s.alignment = { horizontal: 'center' };
    ws.addRow([]);
    const hr = ws.addRow(r.columns.map((c) => c.title));
    hr.font = { bold: true };
    hr.height = 32;
    hr.eachCell((c) => {
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFCCFBF1' } };
      c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      c.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
    });
    for (const row of r.rows) {
      const values = r.columns.map((c) => {
        const v = row[c.key];
        if (v === null || v === undefined || v === '') return '';
        if (c.type === 'money' || c.type === 'int' || c.type === 'pct') return n(v);
        if (c.type === 'date') return v ? new Date(String(v).slice(0, 10)) : '';
        if (c.type === 'status') return ASSET_STATUS[String(v)]?.label ?? v;
        return v;
      });
      const xr = ws.addRow(values);
      xr.eachCell({ includeEmpty: true }, (c) => (c.border = { bottom: { style: 'hair', color: { argb: 'FFCBD5E1' } }, left: { style: 'hair', color: { argb: 'FFCBD5E1' } }, right: { style: 'hair', color: { argb: 'FFCBD5E1' } } }));
      if (row._kind) {
        xr.font = { bold: true, italic: row._kind === 'group' };
        const color = row._kind === 'group' ? 'FFF1F5F9' : row._kind === 'subtotal' ? 'FFF8FAFC' : 'FFE2E8F0';
        xr.eachCell({ includeEmpty: true }, (c) => (c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } }));
      }
    }
    r.columns.forEach((c, i) => {
      const col = ws.getColumn(i + 1);
      col.width = Math.max(6, Math.round((c.width ?? 20) * 0.75));
      if (c.type === 'money') col.numFmt = '#,##0';
      if (c.type === 'int') col.numFmt = '#,##0';
      if (c.type === 'pct') col.numFmt = '0.##';
      if (c.type === 'date') col.numFmt = 'dd/mm/yyyy';
    });
    ws.views = [{ state: 'frozen', ySplit: 5 }];
    ws.pageSetup = { orientation: r.orientation ?? 'portrait', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
    return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), fileName: `bao-cao-${key}-${todayISO()}.xlsx` };
  }

  /* ------------------------------------------------------------ In PDF (dựng mẫu động) */
  async print(key: string, params: Record<string, unknown>, user: AccessContext) {
    const r = await this.run(key, params, user);
    const [hospitalName, parentOrgName, place, director] = await Promise.all([
      this.settings.get('hospital.name', ''),
      this.settings.get('hospital.parentName', ''),
      this.settings.get('hospital.place', ''),
      this.settings.get('hospital.director', ''),
    ]).then((x) => x.map((v) => String(v ?? '')));
    const landscape = r.orientation === 'landscape';
    const L = 12;
    const W = landscape ? 273 : 186;
    const base: ElementStyle = { fontFamily: 'Times New Roman', color: '#000000', fontSize: 11 };
    const txt = (id: string, x: number, y: number, w: number, h: number, text: string, style: ElementStyle = {}) =>
      ({ id, type: 'text', x, y, w, h, text, style: { ...base, ...style } }) as PrintElement;
    const [y, m, d] = todayISO().split('-');
    const rows = r.rows.map((row) => {
      const o: Record<string, unknown> = {};
      for (const c of r.columns) o[c.key] = this.display(c, row[c.key]);
      if (row._kind === 'group') o.__style = { bold: true, italic: true, backgroundColor: '#eef2f7' };
      if (row._kind === 'subtotal') o.__style = { bold: true, backgroundColor: '#f8fafc' };
      if (row._kind === 'total') o.__style = { bold: true, backgroundColor: '#e2e8f0' };
      return o;
    });
    const sigW = W / 3;
    const doc = {
      paperSize: 'A4',
      orientation: landscape ? 'landscape' : 'portrait',
      margins: { top: 10, right: 12, bottom: 12, left: 12 },
      pageNumbering: { show: true, position: 'bottom-right', format: 'Trang {page}/{pages}' },
      defaultStyle: base,
      pages: [
        {
          id: 'p1',
          name: 'Báo cáo',
          elements: [
            txt('org-parent', L, 10, 100, 5, parentOrgName, { align: 'center', textTransform: 'uppercase', autoShrink: true }),
            txt('org', L, 15, 100, 5, hospitalName, { bold: true, align: 'center', textTransform: 'uppercase', autoShrink: true }),
            txt('title', L, 24, W, 7, r.title, { bold: true, align: 'center', fontSize: 14, wrap: true }),
            txt('sub', L, 31, W, 6, r.subtitle, { italic: true, align: 'center', wrap: true, autoShrink: true }),
            {
              id: 'table', type: 'table', x: L, y: 39, w: W, h: 10, style: { ...base, fontSize: 9 },
              table: { dataSource: 'rows', repeatHeader: true, minRowHeight: 5.5, columns: r.columns.map((c) => ({ id: c.key, title: c.title, width: c.width ?? 20, align: ['money', 'int', 'pct'].includes(c.type ?? '') ? 'right' : c.type === 'date' ? 'center' : 'left', binding: { source: 'row', path: c.key } })) },
            } as PrintElement,
            txt('date', L + W - sigW, 53, sigW, 5, `${place ? `${place}, ngày` : 'Ngày'} ${d} tháng ${m} năm ${y}`, { italic: true, align: 'center' }),
            txt('s1', L, 58, sigW, 5, 'NGƯỜI LẬP BIỂU', { bold: true, align: 'center' }),
            txt('s1n', L, 80, sigW, 5, user.fullName, { bold: true, align: 'center' }),
            txt('s2', L + sigW, 58, sigW, 5, 'KẾ TOÁN TRƯỞNG', { bold: true, align: 'center' }),
            txt('s3', L + 2 * sigW, 58, sigW, 5, 'THỦ TRƯỞNG ĐƠN VỊ', { bold: true, align: 'center' }),
            txt('s3n', L + 2 * sigW, 80, sigW, 5, director, { bold: true, align: 'center' }),
          ],
        },
      ],
    } as unknown as PrintDocument;
    const { buffer } = await renderPrintDocument(doc, { data: { rows }, fileName: `${key}.pdf` });
    return { buffer, fileName: `bao-cao-${key}-${todayISO()}.pdf` };
  }
}
