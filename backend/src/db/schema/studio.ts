/**
 * Studio — Bảng điều khiển & báo cáo tùy biến (người dùng tự thiết kế).
 *
 * `studioDashboards` lưu cả dashboard lẫn báo cáo (phân biệt bởi `kind`):
 *  - Bố cục canvas (lưới 12 cột, kéo-thả) nằm trong JSONB `layout`.
 *  - Mỗi widget tự mang "dataSpec" (nguồn dữ liệu + chỉ số + kích thước + lọc)
 *    được xác thực bởi query engine phía máy chủ (whitelist — không SQL tự do).
 *
 * Phạm vi sở hữu (`scope`):
 *  - SYSTEM  : do quản trị dựng sẵn, mọi người (đủ quyền xem) dùng được.
 *  - ROLE    : gắn với một vai trò — làm mặc định cho vai trò đó.
 *  - PERSONAL: bản riêng của từng người dùng (chỉ chủ sở hữu thấy).
 */
import { boolean, index, integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './system';

export const StudioKind = {
  DASHBOARD: 'DASHBOARD',
  REPORT: 'REPORT',
} as const;
export type StudioKind = (typeof StudioKind)[keyof typeof StudioKind];

export const StudioScope = {
  SYSTEM: 'SYSTEM',
  ROLE: 'ROLE',
  PERSONAL: 'PERSONAL',
} as const;
export type StudioScope = (typeof StudioScope)[keyof typeof StudioScope];

/** Một widget trên canvas */
export interface StudioWidget {
  id: string;
  /** Loại hiển thị: kpi | line | area | bar | barh | pie | donut | table | text | builtin */
  type: string;
  title: string;
  /** Độ rộng theo cột lưới (3..12) */
  w: number;
  /** Cao theo nấc: S | M | L */
  h: 'S' | 'M' | 'L';
  /** Widget tích hợp sẵn (không cần dataSpec): jobs | audit | notifications */
  builtin?: string;
  /** Đặc tả dữ liệu cho query engine */
  dataSpec?: {
    source?: string;
    metrics?: { field: string; agg: string; label?: string }[];
    dimensions?: { field: string; bucket?: string }[];
    filters?: { field: string; op: string; value?: unknown }[];
    dateRange?: { field?: string; preset?: string; from?: string; to?: string };
    orderBy?: { key: string; dir: 'asc' | 'desc' }[];
    limit?: number;
  };
  /** Tùy chọn hiển thị (màu, định dạng, chú thích…) */
  options?: Record<string, unknown>;
}

export interface StudioLayout {
  widgets: StudioWidget[];
  /** Bộ lọc chung áp cho toàn trang (GĐ sau) */
  filters?: Record<string, unknown>;
}

export const studioDashboards = pgTable(
  'studio_dashboards',
  {
    id: serial('id').primaryKey(),
    /** Mã duy nhất (tự sinh hoặc tự đặt) */
    code: text('code').notNull(),
    name: text('name').notNull(),
    description: text('description').default('').notNull(),
    kind: text('kind').$type<StudioKind>().default(StudioKind.DASHBOARD).notNull(),
    scope: text('scope').$type<StudioScope>().default(StudioScope.PERSONAL).notNull(),
    /** Vai trò áp dụng khi scope = ROLE (mã vai trò) */
    roleCode: text('role_code').default('').notNull(),
    /** Chủ sở hữu khi scope = PERSONAL */
    ownerId: integer('owner_id'),
    layout: jsonb('layout').$type<StudioLayout>().notNull(),
    /** Trang mặc định cho phạm vi của nó */
    isDefault: boolean('is_default').default(false).notNull(),
    createdBy: integer('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedBy: integer('updated_by').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('studio_dashboards_code_unique').on(t.code).where(sql`${t.deletedAt} is null`),
    index('studio_dashboards_kind_idx').on(t.kind),
    index('studio_dashboards_scope_idx').on(t.scope),
    index('studio_dashboards_owner_idx').on(t.ownerId),
  ],
);

/* ------------------------------------------- Ấn bản định kỳ (subscription) */

/** Tần suất phát hành ấn bản */
export const StudioSubFrequency = {
  DAILY: 'DAILY',
  WEEKLY: 'WEEKLY',
  MONTHLY: 'MONTHLY',
} as const;
export type StudioSubFrequency = (typeof StudioSubFrequency)[keyof typeof StudioSubFrequency];

export const STUDIO_SUB_FREQUENCY_LABELS: Record<StudioSubFrequency, string> = {
  DAILY: 'Hằng ngày',
  WEEKLY: 'Hằng tuần (thứ Hai)',
  MONTHLY: 'Hằng tháng (ngày mùng 1)',
};

/**
 * Đăng ký nhận ấn bản Excel của một trang Studio theo lịch cố định.
 * Tác vụ `studio.subscriptions` (chạy định kỳ) rà các bản ghi đến hạn,
 * dựng file Excel từ bố cục trang (quyền của chính người đăng ký) và
 * gửi thông báo kèm ấn bản tải được.
 */
export const studioSubscriptions = pgTable(
  'studio_subscriptions',
  {
    id: serial('id').primaryKey(),
    pageId: integer('page_id')
      .notNull()
      .references(() => studioDashboards.id, { onDelete: 'cascade' }),
    /** Người nhận ấn bản (cũng là người tạo — dữ liệu render theo quyền người này) */
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    label: text('label').default('').notNull(),
    frequency: text('frequency').$type<StudioSubFrequency>().default(StudioSubFrequency.DAILY).notNull(),
    /** Giờ phát hành (giờ máy chủ), mặc định 06:00 */
    hourOfDay: integer('hour_of_day').default(6).notNull(),
    active: boolean('active').default(true).notNull(),
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    nextRunAt: timestamp('next_run_at', { withTimezone: true }),
    lastStatus: text('last_status').default('PENDING').notNull(),
    lastError: text('last_error').default('').notNull(),
    runCount: integer('run_count').default(0).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('studio_subs_page_user_uq').on(t.pageId, t.userId, t.frequency, t.hourOfDay),
    index('studio_subs_due_idx').on(t.active, t.nextRunAt),
    index('studio_subs_user_idx').on(t.userId),
  ],
);

/** File ấn bản đã sinh (Excel) — lưu trữ trong thư mục upload/studio-exports */
export const studioSubscriptionFiles = pgTable(
  'studio_subscription_files',
  {
    id: serial('id').primaryKey(),
    subscriptionId: integer('subscription_id')
      .notNull()
      .references(() => studioSubscriptions.id, { onDelete: 'cascade' }),
    /** Chủ nhân file (mirror của subscription.userId — truy vấn nhanh) */
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    pageId: integer('page_id').notNull(),
    pageName: text('page_name').default('').notNull(),
    fileName: text('file_name').notNull(),
    /** Đường dẫn tương đối trong thư mục lưu trữ */
    filePath: text('file_path').default('').notNull(),
    sizeBytes: integer('size_bytes').default(0).notNull(),
    /** queue = theo lịch · manual = bấm chạy thử */
    trigger: text('trigger').default('queue').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('studio_sub_files_user_idx').on(t.userId, t.createdAt),
    index('studio_sub_files_sub_idx').on(t.subscriptionId),
  ],
);
