/**
 * Studio — kiểu dữ liệu & từ vựng của query engine.
 * Mọi giá trị từ client phải khớp whitelist ở đây + registry nguồn dữ liệu.
 */

/** Phép tổng hợp cho chỉ số (metric) */
export const STUDIO_AGGS = ['count', 'countd', 'sum', 'avg', 'min', 'max'] as const;
export type StudioAgg = (typeof STUDIO_AGGS)[number];

export const STUDIO_AGG_LABELS: Record<StudioAgg, string> = {
  count: 'Đếm',
  countd: 'Đếm riêng biệt',
  sum: 'Tổng',
  avg: 'Trung bình',
  min: 'Nhỏ nhất',
  max: 'Lớn nhất',
};

/** Toán tử lọc */
export const STUDIO_FILTER_OPS = [
  'eq',
  'ne',
  'gt',
  'gte',
  'lt',
  'lte',
  'in',
  'nin',
  'contains',
  'starts',
  'between',
  'null',
  'notnull',
] as const;
export type StudioFilterOp = (typeof STUDIO_FILTER_OPS)[number];

export const STUDIO_FILTER_OP_LABELS: Record<StudioFilterOp, string> = {
  eq: 'bằng',
  ne: 'khác',
  gt: 'lớn hơn',
  gte: 'từ (≥)',
  lt: 'nhỏ hơn',
  lte: 'đến (≤)',
  in: 'thuộc',
  nin: 'không thuộc',
  contains: 'chứa',
  starts: 'bắt đầu bằng',
  between: 'trong khoảng',
  null: 'trống',
  notnull: 'không trống',
};

/** Khoảng thời gian có sẵn (áp vào cột ngày) */
export const STUDIO_DATE_PRESETS = [
  'today',
  'yesterday',
  '7d',
  '14d',
  '30d',
  '90d',
  'month',
  'last_month',
  'quarter',
  'year',
  'custom',
] as const;
export type StudioDatePreset = (typeof STUDIO_DATE_PRESETS)[number];

export const STUDIO_DATE_PRESET_LABELS: Record<StudioDatePreset, string> = {
  today: 'Hôm nay',
  yesterday: 'Hôm qua',
  '7d': '7 ngày qua',
  '14d': '14 ngày qua',
  '30d': '30 ngày qua',
  '90d': '90 ngày qua',
  month: 'Tháng này',
  last_month: 'Tháng trước',
  quarter: 'Quý này',
  year: 'Năm nay',
  custom: 'Tùy chọn',
};

/** Nhóm theo thời gian */
export const STUDIO_BUCKETS = ['day', 'week', 'month', 'quarter', 'year'] as const;
export type StudioBucket = (typeof STUDIO_BUCKETS)[number];

export const STUDIO_BUCKET_LABELS: Record<StudioBucket, string> = {
  day: 'Theo ngày',
  week: 'Theo tuần',
  month: 'Theo tháng',
  quarter: 'Theo quý',
  year: 'Theo năm',
};

/** Loại widget trên canvas */
export const STUDIO_WIDGET_TYPES = [
  'kpi',
  'line',
  'area',
  'bar',
  'barh',
  'pie',
  'donut',
  'table',
  'text',
  'builtin',
] as const;

/** Widget tích hợp sẵn (không qua query engine) */
export const STUDIO_BUILTINS = ['jobs', 'audit', 'notifications'] as const;

export interface StudioMetric {
  field: string;
  agg: StudioAgg;
  label?: string;
}
export interface StudioDimension {
  field: string;
  bucket?: StudioBucket;
}
export interface StudioFilter {
  field: string;
  op: StudioFilterOp;
  value?: unknown;
}
export interface StudioDateRange {
  field?: string;
  preset?: StudioDatePreset;
  from?: string;
  to?: string;
}
export interface StudioOrderBy {
  key: string;
  dir: 'asc' | 'desc';
}

/**
 * Chế độ chạy:
 *  - aggregate (mặc định): chỉ số + nhóm — phục vụ biểu đồ/bảng/KPI;
 *  - records: danh sách bản ghi gốc (drill-down) — có phân trang offset/total thật.
 */
export const STUDIO_QUERY_MODES = ['aggregate', 'records'] as const;
export type StudioQueryMode = (typeof STUDIO_QUERY_MODES)[number];

/** Đặc tả truy vấn dữ liệu cho một widget (được validate nghiêm ngặt) */
export interface StudioDataSpec {
  source: string;
  mode?: StudioQueryMode;
  metrics?: StudioMetric[];
  dimensions?: StudioDimension[];
  filters?: StudioFilter[];
  dateRange?: StudioDateRange;
  orderBy?: StudioOrderBy[];
  limit?: number;
  /** Chỉ dùng với mode=records: bỏ qua N dòng đầu (phân trang) */
  offset?: number;
  /** Chỉ dùng với mode=records: chọn cột hiển thị (mặc định theo nguồn) */
  fields?: string[];
}

export interface StudioColumn {
  key: string;
  label: string;
  type: 'text' | 'number' | 'date' | 'datetime';
  role: 'dimension' | 'metric';
}

export interface StudioQueryResult {
  columns: StudioColumn[];
  rows: Record<string, unknown>[];
  meta: { source: string; total: number; truncated: boolean };
}
