/**
 * Studio — query engine: dịch đặc tả widget (StudioDataSpec) thành truy vấn
 * an toàn. MơI tên trường/toán tử/nhóm đều phải khớp whitelist trong
 * `studio-datasources` + `studio.types`; không một chuỗi nào từ client
 * được ghép trực tiếp vào SQL.
 */
import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { and, asc, desc, sql, type SQL } from 'drizzle-orm';
import { DbService } from '../../db/db.service';
import type { AccessContext } from '../../common/types/access-context';
import {
  STUDIO_AGGS,
  STUDIO_AGG_LABELS,
  STUDIO_BUCKETS,
  STUDIO_DATE_PRESETS,
  STUDIO_FILTER_OPS,
  type StudioAgg,
  type StudioBucket,
  type StudioColumn,
  type StudioDataSpec,
  type StudioDatePreset,
  type StudioFilter,
  type StudioQueryResult,
} from './studio.types';
import { baseConditions, findDataSource, type DataSourceDef, type SourceColumn } from './studio-datasources';

const HARD_LIMIT = 500;
const DEFAULT_LIMIT = 50;

const DATE_YMD = /^\d{4}-\d{2}-\d{2}$/;

/** Khoảng [from, to] (chuỗi YYYY-MM-DD, to inclusive) cho preset ngày */
export function resolveDatePreset(preset: StudioDatePreset, today = new Date()): { from: string; to: string } | null {
  const pad = (n: number) => String(n).padStart(2, '0');
  const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const day = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const shift = (days: number) => { const d = new Date(day); d.setDate(d.getDate() + days); return d; };
  switch (preset) {
    case 'today': return { from: ymd(day), to: ymd(day) };
    case 'yesterday': return { from: ymd(shift(-1)), to: ymd(shift(-1)) };
    case '7d': return { from: ymd(shift(-6)), to: ymd(day) };
    case '14d': return { from: ymd(shift(-13)), to: ymd(day) };
    case '30d': return { from: ymd(shift(-29)), to: ymd(day) };
    case '90d': return { from: ymd(shift(-89)), to: ymd(day) };
    case 'month': {
      const first = new Date(day.getFullYear(), day.getMonth(), 1);
      return { from: ymd(first), to: ymd(day) };
    }
    case 'last_month': {
      const first = new Date(day.getFullYear(), day.getMonth() - 1, 1);
      const last = new Date(day.getFullYear(), day.getMonth(), 0);
      return { from: ymd(first), to: ymd(last) };
    }
    case 'quarter': {
      const q = Math.floor(day.getMonth() / 3) * 3;
      return { from: ymd(new Date(day.getFullYear(), q, 1)), to: ymd(day) };
    }
    case 'year': return { from: ymd(new Date(day.getFullYear(), 0, 1)), to: ymd(day) };
    default: return null; // custom: dùng from/to truyền tay
  }
}

@Injectable()
export class StudioQueryService {
  constructor(private readonly db: DbService) {}

  /** Kiểm tra người dùng được dùng nguồn không */
  assertSourceAllowed(def: DataSourceDef, user: AccessContext): void {
    if (user.isSuperAdmin) return;
    if (!user.permissions.includes(def.permission)) {
      throw new ForbiddenException(`Bạn không có quyền truy cập nguồn dữ liệu \"${def.name}\"`);
    }
  }

  private columnOf(def: DataSourceDef, key: string): SourceColumn {
    const column = def.columns.find((c) => c.key === key);
    if (!column) {
      throw new BadRequestException(`Trường \"${key}\" không tồn tại trong nguồn \"${def.name}\"`);
    }
    return column;
  }

  /** Biểu thức nhóm (có bucket nếu là cột ngày) */
  private dimensionExpr(column: SourceColumn, bucket?: StudioBucket): SQL<any> {
    if (bucket) {
      if (column.type !== 'date' && column.type !== 'datetime') {
        throw new BadRequestException(`Trường \"${column.label}\" không phải ngày — không nhóm theo ${bucket} được`);
      }
      if (!STUDIO_BUCKETS.includes(bucket)) {
        throw new BadRequestException(`Kiểu nhóm thời gian \"${bucket}\" không được hỗ trợ`);
      }
      switch (bucket) {
        case 'day': return sql`to_char(date_trunc('day', ${column.expr}), 'YYYY-MM-DD')`;
        case 'week': return sql`to_char(date_trunc('week', ${column.expr}), 'IYYY"-T"IW')`;
        case 'month': return sql`to_char(date_trunc('month', ${column.expr}), 'YYYY-MM')`;
        case 'quarter': return sql`to_char(date_trunc('quarter', ${column.expr}), 'YYYY"-Q"Q')`;
        case 'year': return sql`to_char(date_trunc('year', ${column.expr}), 'YYYY')`;
      }
    }
    return column.expr as SQL<any>;
  }

  private aggExpr(agg: StudioAgg, column: SourceColumn | undefined): SQL<any> {
    if (!STUDIO_AGGS.includes(agg)) {
      throw new BadRequestException(`Phép tổng hợp \"${agg}\" không được hỗ trợ`);
    }
    if (agg === 'count' && !column) return sql`count(*)::int`;
    const expr = column!.expr;
    switch (agg) {
      case 'count': return sql`count(${expr})::int`;
      case 'countd': return sql`count(distinct ${expr})::int`;
      case 'sum': return sql`coalesce(sum(${expr}), 0)::float8`;
      case 'avg': return sql`coalesce(avg(${expr}), 0)::float8`;
      case 'min': return sql`min(${expr})`;
      case 'max': return sql`max(${expr})`;
    }
  }

  /** Điều kiện lọc đơn lẻ */
  private filterExpr(def: DataSourceDef, f: StudioFilter): SQL<any> {
    const column = this.columnOf(def, f.field);
    if (!STUDIO_FILTER_OPS.includes(f.op)) {
      throw new BadRequestException(`Toán tử \"${f.op}\" không được hỗ trợ`);
    }
    const expr = column.expr;

    if (f.op === 'null') return sql`${expr} is null`;
    if (f.op === 'notnull') return sql`${expr} is not null`;

    const value = f.value;
    const text = String(value ?? '').slice(0, 200);
    const likeEsc = text.replace(/[\\%_]/g, (c) => `\\${c}`);

    if (f.op === 'contains') return sql`${expr}::text ilike ${'%' + likeEsc + '%'}`;
    if (f.op === 'starts') return sql`${expr}::text ilike ${likeEsc + '%'}`;

    /** Một giá trị so sánh đơn, có kiểm tra enum */
    const single = (v: unknown): string | number => {
      if (typeof v === 'number' && Number.isFinite(v)) return v;
      const s = String(v ?? '').slice(0, 200);
      if (column.type === 'enum' && column.options?.length) {
        if (!column.options.some((o) => o.value === s)) {
          throw new BadRequestException(`Giá trị \"${s}\" không hợp lệ cho trường \"${column.label}\"`);
        }
      }
      if (column.type === 'boolean') return s === 'true' ? 'true' : 'false';
      if (column.type === 'number') {
        const n = Number(s);
        if (!Number.isFinite(n)) throw new BadRequestException(`Giá trị \"${s}\" không phải số`);
        return n;
      }
      return s;
    };

    switch (f.op) {
      case 'eq': {
        const v = single(value);
        if (column.type === 'boolean') return sql`${expr} = ${v === 'true'}`;
        return sql`${expr} = ${v}`;
      }
      case 'ne': {
        const v = single(value);
        if (column.type === 'boolean') return sql`${expr} <> ${v === 'true'}`;
        return sql`${expr} <> ${v}`;
      }
      case 'gt': {
        const v = single(value);
        return sql`${expr} > ${v}`;
      }
      case 'gte': {
        const v = single(value);
        return sql`${expr} >= ${v}`;
      }
      case 'lt': {
        const v = single(value);
        return sql`${expr} < ${v}`;
      }
      case 'lte': {
        const v = single(value);
        return sql`${expr} <= ${v}`;
      }
      case 'in':
      case 'nin': {
        const list = Array.isArray(value) ? value : String(value ?? '').split(',').map((s) => s.trim()).filter(Boolean);
        if (!list.length) return sql`true`;
        if (list.length > 50) throw new BadRequestException('Danh sách giá trị lọc tối đa 50 phần tử');
        const values = list.map(single);
        return f.op === 'in'
          ? sql`${expr} in (${sql.join(values.map((v) => sql`${v}`), sql`, `)})`
          : sql`(${expr} is null or ${expr} not in (${sql.join(values.map((v) => sql`${v}`), sql`, `)}))`;
      }
      case 'between': {
        const arr = Array.isArray(value) ? value : String(value ?? '').split(',');
        if (arr.length !== 2) throw new BadRequestException('Khoảng lọc cần 2 giá trị');
        return sql`${expr} between ${single(arr[0])} and ${single(arr[1])}`;
      }
      default:
        throw new BadRequestException(`Toán tử \"${f.op}\" không được hỗ trợ`);
    }
  }

  /** Điều kiện khoảng thời gian (preset hoặc custom) */
  private dateRangeExpr(def: DataSourceDef, spec: StudioDataSpec): SQL<any> | undefined {
    const range = spec.dateRange;
    if (!range || (!range.preset && !range.from && !range.to)) return undefined;
    const preset = range.preset && STUDIO_DATE_PRESETS.includes(range.preset) ? range.preset : undefined;
    let from = range.from;
    let to = range.to;
    if (preset && preset !== 'custom') {
      const resolved = resolveDatePreset(preset);
      if (resolved) { from = resolved.from; to = resolved.to; }
    }
    if (from && !DATE_YMD.test(from)) throw new BadRequestException(`Ngày bắt đầu \"${from}\" không đúng định dạng YYYY-MM-DD`);
    if (to && !DATE_YMD.test(to)) throw new BadRequestException(`Ngày kết thúc \"${to}\" không đúng định dạng YYYY-MM-DD`);
    if (!from && !to) return undefined;

    const column = this.columnOf(def, range.field || def.dateDefault || '');
    if (column.type !== 'date' && column.type !== 'datetime') {
      throw new BadRequestException(`Trường \"${column.label}\" không phải ngày`);
    }
    const expr = column.expr;
    const conditions: SQL[] = [];
    if (from) conditions.push(sql`${expr} >= ${from}`);
    if (to) {
      // Cột datetime: so đến cuối ngày; cột date: so inclusive bình thường
      conditions.push(column.type === 'datetime' ? sql`${expr} < (${to}::date + 1)` : sql`${expr} <= ${to}`);
    }
    return and(...conditions);
  }

  /** Chạy đặc tả và trả về {columns, rows} phẳng cho biểu đồ/bảng */
  async run(spec: StudioDataSpec, user: AccessContext): Promise<StudioQueryResult> {
    const def = findDataSource(spec.source);
    if (!def) throw new BadRequestException(`Nguồn dữ liệu \"${spec.source}\" không tồn tại`);
    this.assertSourceAllowed(def, user);

    const metrics = spec.metrics ?? [];
    const dimensions = spec.dimensions ?? [];
    if (!metrics.length) throw new BadRequestException('Cần ít nhất một chỉ số (metric)');
    if (metrics.length > 4) throw new BadRequestException('Tối đa 4 chỉ số cho một widget');
    if (dimensions.length > 2) throw new BadRequestException('Tối đa 2 kích thước nhóm');

    /* --- select + groupBy --- */
    const select: Record<string, SQL<any>> = {};
    const columns: StudioColumn[] = [];
    const groupExprs: SQL<any>[] = [];

    dimensions.forEach((d, i) => {
      const column = this.columnOf(def, d.field);
      const groupable = column.groupable ?? (column.type !== 'number' || !!column.numeric);
      if (!groupable) throw new BadRequestException(`Trường \"${column.label}\" không dùng để nhóm được`);
      const expr = this.dimensionExpr(column, d.bucket);
      const key = `d${i}`;
      select[key] = expr;
      groupExprs.push(expr);
      columns.push({ key, label: column.label, type: d.bucket ? 'text' : (column.type === 'enum' || column.type === 'boolean' ? 'text' : column.type), role: 'dimension' });
    });

    metrics.forEach((m, i) => {
      const column = m.field === '*' ? undefined : this.columnOf(def, m.field);
      if (column && m.agg !== 'count' && m.agg !== 'countd' && !column.numeric) {
        throw new BadRequestException(`Trường \"${column.label}\" không phải số — không tính ${STUDIO_AGG_LABELS[m.agg]} được`);
      }
      const label = (m.label?.trim() || '') ||
        (m.agg === 'count'
          ? 'Số lượng'
          : column
            ? m.agg === 'countd'
              ? `Số ${column.label.toLowerCase()} riêng biệt`
              : `${STUDIO_AGG_LABELS[m.agg]} ${column.label}`.trim()
            : 'Số lượng');
      const key = `m${i}`;
      select[key] = this.aggExpr(m.agg, column);
      columns.push({ key, label: label.slice(0, 120), type: 'number', role: 'metric' });
    });

    /* --- where --- */
    const conditions: (SQL | undefined)[] = [...baseConditions(def, user)];
    for (const f of spec.filters ?? []) conditions.push(this.filterExpr(def, f));
    const dateCond = this.dateRangeExpr(def, spec);
    if (dateCond) conditions.push(dateCond);

    /* --- order --- */
    const selectExprs: Record<string, SQL<any>> = select;
    const orderExprs: (SQL<any>)[] = [];
    for (const o of spec.orderBy ?? []) {
      const expr = selectExprs[o.key];
      if (!expr) throw new BadRequestException(`Không thể sắp xếp theo \"${o.key}\"`);
      orderExprs.push(o.dir === 'desc' ? desc(expr) : asc(expr));
    }
    if (!orderExprs.length && groupExprs.length) orderExprs.push(asc(groupExprs[0]));

    const limit = Math.min(Math.max(Number(spec.limit) || DEFAULT_LIMIT, 1), HARD_LIMIT);

    /* --- build & run --- */
    let qb = this.db.db.select(select).from(def.from as never).$dynamic();
    for (const join of def.joins ?? []) {
      qb = qb.leftJoin(join.table as never, join.on);
    }
    const where = and(...conditions.filter((c): c is SQL => !!c));
    if (where) qb = qb.where(where);
    if (groupExprs.length) qb = qb.groupBy(...groupExprs);
    if (orderExprs.length) qb = qb.orderBy(...orderExprs);
    qb = qb.limit(limit + 1); // +1 để phát hiện bị cắt

    const raw = (await qb) as Record<string, unknown>[];
    const truncated = raw.length > limit;
    const rows = truncated ? raw.slice(0, limit) : raw;

    return { columns, rows, meta: { source: def.key, total: rows.length, truncated } };
  }
}
