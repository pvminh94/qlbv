/**
 * Studio — kiểu dữ liệu & hàm gọi API cho dashboard/báo cáo tùy biến.
 * Khớp 1-1 với backend `studio.types` / `studio-datasources`.
 */

/* ------------------------------------------------------------------ Kiểu */

export type StudioAgg = 'count' | 'countd' | 'sum' | 'avg' | 'min' | 'max';
export type StudioFilterOp =
  | 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'nin'
  | 'contains' | 'starts' | 'between' | 'null' | 'notnull';
export type StudioDatePreset =
  | 'today' | 'yesterday' | '7d' | '14d' | '30d' | '90d'
  | 'month' | 'last_month' | 'quarter' | 'year' | 'custom';
export type StudioBucket = 'day' | 'week' | 'month' | 'quarter' | 'year';
export type StudioColumnType = 'text' | 'number' | 'date' | 'datetime' | 'enum' | 'boolean';

export interface StudioMetric { field: string; agg: StudioAgg; label?: string }
export interface StudioDimension { field: string; bucket?: StudioBucket }
export interface StudioFilter { field: string; op: StudioFilterOp; value?: unknown }
export interface StudioDateRange { field?: string; preset?: StudioDatePreset; from?: string; to?: string }

export type StudioQueryMode = 'aggregate' | 'records';

export interface StudioDataSpec {
  source: string;
  /** aggregate (mặc định) cho biểu đồ/bảng · records = bản ghi gốc (drill-down) */
  mode?: StudioQueryMode;
  metrics?: StudioMetric[];
  dimensions?: StudioDimension[];
  filters?: StudioFilter[];
  dateRange?: StudioDateRange;
  orderBy?: { key: string; dir: 'asc' | 'desc' }[];
  limit?: number;
  /** records: bỏ qua N dòng đầu (phân trang) */
  offset?: number;
  /** records: chọn cột hiển thị (mặc định theo nguồn) */
  fields?: string[];
}

export type StudioWidgetType =
  | 'kpi' | 'line' | 'area' | 'bar' | 'barh' | 'pie' | 'donut'
  | 'table' | 'text' | 'builtin';
export type StudioWidgetHeight = 'S' | 'M' | 'L';

export interface StudioWidget {
  id: string;
  type: StudioWidgetType;
  title: string;
  w: number;
  h: StudioWidgetHeight;
  builtin?: string;
  dataSpec?: StudioDataSpec;
  options?: Record<string, unknown>;
  /** Lỗi truy vấn của ô (được gán lúc render, không lưu) */
  _error?: string;
}

export interface StudioLayout { widgets: StudioWidget[] }

export type StudioKind = 'DASHBOARD' | 'REPORT';
export type StudioScope = 'SYSTEM' | 'ROLE' | 'PERSONAL';

export interface StudioPage {
  id: number;
  code: string;
  name: string;
  description: string;
  kind: StudioKind;
  scope: StudioScope;
  roleCode: string;
  ownerId: number | null;
  layout: StudioLayout;
  isDefault: boolean;
  updatedAt: string;
}

export interface StudioSourceColumnMeta {
  key: string;
  label: string;
  type: StudioColumnType;
  numeric: boolean;
  groupable: boolean;
  options?: { value: string; label: string }[];
}

export interface StudioSourceMeta {
  key: string;
  name: string;
  module: string;
  description: string;
  dateDefault?: string;
  /** Cột mặc định khi xem bản ghi gốc (drill-down) */
  recordDefault: string[];
  columns: StudioSourceColumnMeta[];
}

export interface StudioVocabulary {
  aggs: Record<StudioAgg, string>;
  filterOps: Record<StudioFilterOp, string>;
  datePresets: Record<StudioDatePreset, string>;
  buckets: Record<StudioBucket, string>;
}

export interface StudioResultColumn { key: string; label: string; type: string; role: 'dimension' | 'metric' }
export interface StudioQueryResult {
  columns: StudioResultColumn[];
  rows: Record<string, unknown>[];
  meta: { source: string; total: number; truncated: boolean };
}

/* -------------------------------------------------------------- Hằng số */

/** Nhãn loại ô */
export const WIDGET_TYPE_LABELS: Record<StudioWidgetType, string> = {
  kpi: 'Thẻ chỉ số (KPI)',
  line: 'Biểu đồ đường',
  area: 'Biểu đồ vùng',
  bar: 'Biểu đồ cột',
  barh: 'Biểu đồ thanh ngang',
  pie: 'Biểu đồ tròn',
  donut: 'Biểu đồ vành khuyên',
  table: 'Bảng dữ liệu',
  text: 'Văn bản / tiêu đề',
  builtin: 'Ô tích hợp sẵn',
};

/** Ô tích hợp sẵn có thể thêm */
export const BUILTIN_WIDGETS: { key: string; label: string; description: string }[] = [
  { key: 'jobs', label: 'Tác vụ định kỳ', description: 'Trạng thái các tác vụ chạy nền' },
  { key: 'audit', label: 'Hoạt động gần đây', description: 'Nhật ký thao tác mới nhất' },
  { key: 'notifications', label: 'Thông báo của tôi', description: 'Thông báo chưa đọc' },
];


/* ------------------------------------------- Ấn bản định kỳ (subscription) */

export type StudioSubFrequency = 'DAILY' | 'WEEKLY' | 'MONTHLY';

export const SUB_FREQUENCY_LABELS: Record<StudioSubFrequency, string> = {
  DAILY: 'Hằng ngày',
  WEEKLY: 'Hằng tuần (thứ Hai)',
  MONTHLY: 'Hằng tháng (ngày mùng 1)',
};

export interface StudioSubscription {
  id: number;
  pageId: number;
  pageName: string;
  pageKind: StudioKind;
  userId: number;
  label: string;
  frequency: StudioSubFrequency;
  hourOfDay: number;
  active: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  lastStatus: string;
  lastError: string;
  runCount: number;
  createdAt: string;
}

export interface StudioSubscriptionFile {
  id: number;
  subscriptionId: number;
  pageId: number;
  pageName: string;
  fileName: string;
  sizeBytes: number;
  trigger: 'queue' | 'manual';
  createdAt: string;
}

/* -------------------------------------------------------------- Gọi API */

import { apiFetch } from './api';

export const studioApi = {
  sources: () =>
    apiFetch<{ sources: StudioSourceMeta[]; vocabulary: StudioVocabulary }>('/studio/sources'),
  pages: (kind: StudioKind) => apiFetch<StudioPage[]>(`/studio/pages?kind=${kind}`),
  defaultPage: (kind: StudioKind) => apiFetch<StudioPage | null>(`/studio/pages/default?kind=${kind}`),
  getPage: (id: number) => apiFetch<StudioPage>(`/studio/pages/${id}`),
  createPage: (body: Partial<StudioPage> & { layout: StudioLayout }) =>
    apiFetch<StudioPage>('/studio/pages', { method: 'POST', body }),
  updatePage: (id: number, body: Partial<StudioPage>) =>
    apiFetch<StudioPage>(`/studio/pages/${id}`, { method: 'PUT', body }),
  removePage: (id: number) => apiFetch(`/studio/pages/${id}`, { method: 'DELETE' }),
  duplicatePage: (id: number) => apiFetch<StudioPage>(`/studio/pages/${id}/duplicate`, { method: 'POST' }),
  setDefault: (id: number, value: boolean) =>
    apiFetch<StudioPage>(`/studio/pages/${id}/default`, { method: 'POST', body: { value } }),
  run: (spec: StudioDataSpec) =>
    apiFetch<StudioQueryResult>('/studio/query', { method: 'POST', body: spec }),
  /* --- ấn bản định kỳ --- */
  subscriptions: () => apiFetch<StudioSubscription[]>('/studio/subscriptions'),
  createSubscription: (body: { pageId: number; label?: string; frequency: StudioSubFrequency; hourOfDay?: number }) =>
    apiFetch<StudioSubscription>('/studio/subscriptions', { method: 'POST', body }),
  updateSubscription: (id: number, body: Partial<Pick<StudioSubscription, 'label' | 'frequency' | 'hourOfDay' | 'active'>>) =>
    apiFetch<StudioSubscription>(`/studio/subscriptions/${id}`, { method: 'PATCH', body }),
  removeSubscription: (id: number) => apiFetch(`/studio/subscriptions/${id}`, { method: 'DELETE' }),
  runSubscription: (id: number) => apiFetch<StudioSubscriptionFile>(`/studio/subscriptions/${id}/run`, { method: 'POST' }),
  subscriptionFiles: () => apiFetch<StudioSubscriptionFile[]>('/studio/subscriptions/files'),
};

/* -------------------------------------------------------------- Tiện ích */

export function newWidgetId(): string {
  return `w${Math.random().toString(36).slice(2, 10)}`;
}

/** Bản đồ nguồn dữ liệu → chủ đề realtime để tự tải lại đúng ô */
export const SOURCE_REALTIME_TOPIC: Record<string, string> = {
  'hsba-requests': 'hsba',
  'report-entries': 'report',
  assets: 'asset',
  'asset-transactions': 'asset',
  'asset-inventories': 'asset',
  'asset-inventory-items': 'asset',
  'asset-depreciation-lines': 'asset',
  'report-snapshots': 'report',
  users: 'system',
  'audit-logs': 'system',
  'job-runs': 'system',
};

/** Khoảng ngày [from..to] liên tiếp (YYYY-MM-DD) cho tuỳ chọn fillGaps */
export function dateSequence(preset: StudioDatePreset, from?: string, to?: string): string[] {
  const dayMs = 86_400_000;
  const pad = (n: number) => String(n).padStart(2, '0');
  const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let start = new Date(today);
  const end = new Date(today);
  switch (preset) {
    case 'today': break;
    case 'yesterday': start.setDate(start.getDate() - 1); end.setDate(end.getDate() - 1); break;
    case '7d': start.setDate(start.getDate() - 6); break;
    case '14d': start.setDate(start.getDate() - 13); break;
    case '30d': start.setDate(start.getDate() - 29); break;
    case '90d': start.setDate(start.getDate() - 89); break;
    case 'month': start = new Date(today.getFullYear(), today.getMonth(), 1); break;
    case 'last_month':
      start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      end.setDate(0);
      break;
    case 'quarter': start = new Date(today.getFullYear(), Math.floor(today.getMonth() / 3) * 3, 1); break;
    case 'year': start = new Date(today.getFullYear(), 0, 1); break;
    default:
      if (from && to) { start = new Date(`${from}T00:00:00`); end.setTime(new Date(`${to}T00:00:00`).getTime()); }
      else return [];
  }
  const out: string[] = [];
  for (let t = start.getTime(); t <= end.getTime() && out.length < 400; t += dayMs) out.push(ymd(new Date(t)));
  return out;
}
