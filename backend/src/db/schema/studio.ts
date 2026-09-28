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
