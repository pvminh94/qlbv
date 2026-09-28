/**
 * Phân hệ HỒ SƠ BỆNH ÁN — Giấy đề nghị sửa HSBA điện tử.
 *
 * Quy trình ký được cấu hình động qua bảng `hsba_workflows` (không set cứng 3 bước):
 *   steps = [{ key, name, title, kind: 'requester' | 'role', roleCodes: [...], allowReturn }]
 * Trạng thái phiếu = `CHO_<KEY_BƯỚC>` khi đang chờ bước đó; hoặc HOAN_TAT / TRA_LAI / DA_HUY.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { departments } from './org';
import { users } from './system';
import type { RequestStatus } from './types';

/** Một bước trong quy trình ký */
export interface WorkflowStep {
  /** Khoá bước, viết HOA không dấu: DE_NGHI, KHTB, TAICHINH… */
  key: string;
  /** Tên bước hiển thị trên giao diện */
  name: string;
  /** Tiêu đề chữ ký in trên bản PDF */
  title: string;
  /** requester = đúng người đề nghị được ghi trên phiếu; role = theo vai trò; dept_head = trưởng khoa */
  kind: 'requester' | 'role' | 'dept_head' | 'creator';
  /** Mã vai trò được phép ký ở bước này (khi kind = 'role') */
  roleCodes?: string[];
  /** Nội dung câu xác nhận hiển thị cho người ký */
  confirmText?: string;
  /** Cho phép trả lại phiếu ở bước này */
  allowReturn?: boolean;
  /** Bắt buộc ghi ý kiến khi ký */
  requireNote?: boolean;
}

export const hsbaWorkflows = pgTable(
  'hsba_workflows',
  {
    id: serial('id').primaryKey(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    description: text('description').default('').notNull(),
    steps: jsonb('steps').$type<WorkflowStep[]>().default([]).notNull(),
    /** Áp dụng mặc định cho các khoa chưa gán quy trình riêng */
    isDefault: boolean('is_default').default(false).notNull(),
    /** Áp dụng riêng cho khoa (null = dùng chung) */
    departmentId: integer('department_id').references(() => departments.id, {
      onDelete: 'cascade',
    }),
    active: boolean('active').default(true).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('hsba_workflows_code_uq').on(t.code),
    index('hsba_workflows_dept_idx').on(t.departmentId),
  ],
);

export const hsbaRequests = pgTable(
  'hsba_requests',
  {
    id: serial('id').primaryKey(),
    /** Mã phiếu: SDS-0001 */
    code: text('code').notNull(),
    status: text('status').$type<RequestStatus | string>().default('CHO_DE_NGHI').notNull(),
    workflowId: integer('workflow_id').references(() => hsbaWorkflows.id, {
      onDelete: 'set null',
    }),
    /** Chỉ số bước đang chờ (0-based) */
    currentStep: integer('current_step').default(0).notNull(),
    /** Bước kế tiếp đang chờ (khoá bước) */
    pendingStepKey: text('pending_step_key').default('DE_NGHI').notNull(),

    /* ---------------------------------------------------------- Người đề nghị */
    createdBy: integer('created_by')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    /** Tài khoản sẽ ký với tư cách người đề nghị */
    requesterId: integer('requester_id').references(() => users.id, { onDelete: 'set null' }),
    requesterName: text('requester_name').notNull(),
    requesterTitle: text('requester_title').default('').notNull(),
    departmentId: integer('department_id').references(() => departments.id, {
      onDelete: 'set null',
    }),
    departmentName: text('department_name').default('').notNull(),

    /* ------------------------------------------------------- Hồ sơ bệnh án */
    patientName: text('patient_name').notNull(),
    patientBirthYear: text('patient_birth_year').default('').notNull(),
    patientBirthDate: date('patient_birth_date'),
    patientGender: text('patient_gender').default('').notNull(),
    patientCode: text('patient_code').default('').notNull(),
    patientAddress: text('patient_address').default('').notNull(),
    /** Mã KCB (mã hồ sơ / mã vào viện) */
    maKcb: text('ma_kcb').default('').notNull(),
    maTheBhyt: text('ma_the_bhyt').default('').notNull(),
    ngayVaoVien: date('ngay_vao_vien'),
    ngayRaVien: date('ngay_ra_vien'),
    /** Đối tượng: BHYT | VIEN_PHI | DICH_VU… tự do */
    doiTuong: text('doi_tuong').default('').notNull(),

    /* -------------------------------------------------------- Nội dung đề nghị */
    reason: text('reason').notNull(),
    content: text('content').notNull(),
    /** Số tiền đề nghị hủy thanh toán (nếu có) */
    amount: text('amount').default('').notNull(),
    attachmentsNote: text('attachments_note').default('').notNull(),

    /* ------------------------------------------------------------- Tiện ích mở rộng */
    /** Các trường tự định nghĩa thêm — cấu hình được, không cần sửa mã nguồn */
    extraFields: jsonb('extra_fields').$type<Record<string, unknown>>().default({}).notNull(),
    priority: text('priority').default('NORMAL').notNull(),
    /** Ghi chú nội bộ của quản trị */
    internalNote: text('internal_note').default('').notNull(),

    /* ---------------------------------------------------------------- Trạng thái */
    returnReason: text('return_reason').default('').notNull(),
    returnedBy: integer('returned_by').references(() => users.id, { onDelete: 'set null' }),
    returnedAt: timestamp('returned_at', { withTimezone: true }),
    /** Số lần bị trả lại */
    returnCount: integer('return_count').default(0).notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    /** Số ngày đang chờ xử lý (tính nhanh phục vụ báo cáo) */
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    /**
     * Chuỗi tìm kiếm đã bỏ dấu, viết thường (tên người bệnh, mã KCB, mã thẻ, số phiếu…).
     * Nhờ vậy tra cứu "hồng ánh" hay "hong anh" đều khớp mà không cần tiện ích CSDL.
     */
    searchText: text('search_text').default('').notNull(),
  },
  (t) => [
    uniqueIndex('hsba_requests_code_uq').on(t.code),
    index('hsba_requests_status_idx').on(t.status),
    index('hsba_requests_created_idx').on(t.createdAt),
    index('hsba_requests_dept_idx').on(t.departmentId),
    index('hsba_requests_requester_idx').on(t.requesterId),
    index('hsba_requests_creator_idx').on(t.createdBy),
    index('hsba_requests_patient_idx').on(t.patientName),
    index('hsba_requests_search_text_idx').on(t.searchText),
    // Danh sách "chờ tôi xử lý" lọc theo (bước đang chờ, trạng thái)
    index('hsba_requests_pending_idx').on(t.pendingStepKey, t.status),
    index('hsba_requests_status_created_idx').on(t.status, t.createdAt),
    index('hsba_requests_dept_created_idx').on(t.departmentId, t.createdAt),
    index('hsba_requests_return_count_idx').on(t.returnCount),
    // Số tiền lưu dạng chuỗi → sắp xếp/lọc theo số cần chỉ mục biểu thức
    index('hsba_requests_amount_num_idx').on(
      sql`(coalesce(nullif(regexp_replace(${t.amount}, '[^0-9.-]', '', 'g'), ''), '0'))::numeric`,
    ),
    index('hsba_requests_search_idx').using(
      'gin',
      sql`to_tsvector('simple', ${t.patientName} || ' ' || ${t.maKcb} || ' ' || ${t.code} || ' ' || ${t.maTheBhyt} || ' ' || ${t.requesterName})`,
    ),
  ],
);

export const hsbaSignatures = pgTable(
  'hsba_signatures',
  {
    id: serial('id').primaryKey(),
    requestId: integer('request_id')
      .notNull()
      .references(() => hsbaRequests.id, { onDelete: 'cascade' }),
    /** Khoá bước ký: DE_NGHI | KHTB | TAICHINH… (theo cấu hình quy trình) */
    stepKey: text('step_key').notNull(),
    stepName: text('step_name').default('').notNull(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    username: text('username').default('').notNull(),
    fullName: text('full_name').notNull(),
    title: text('title').default('').notNull(),
    note: text('note').default('').notNull(),
    /** Mã băm xác thực nội dung đã ký — chống sửa đổi sau khi ký */
    contentHash: text('content_hash').default('').notNull(),
    ip: text('ip').default('').notNull(),
    userAgent: text('user_agent').default('').notNull(),
    signedAt: timestamp('signed_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('hsba_signatures_request_step_uq').on(t.requestId, t.stepKey),
    index('hsba_signatures_user_idx').on(t.userId),
  ],
);

export const hsbaLogs = pgTable(
  'hsba_logs',
  {
    id: serial('id').primaryKey(),
    requestId: integer('request_id')
      .notNull()
      .references(() => hsbaRequests.id, { onDelete: 'cascade' }),
    userId: integer('user_id').references(() => users.id, { onDelete: 'set null' }),
    username: text('username').default('').notNull(),
    fullName: text('full_name').default('').notNull(),
    action: text('action').notNull(),
    detail: text('detail').default('').notNull(),
    fromStatus: text('from_status').default('').notNull(),
    toStatus: text('to_status').default('').notNull(),
    ip: text('ip').default('').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('hsba_logs_request_idx').on(t.requestId),
    index('hsba_logs_created_idx').on(t.createdAt),
    // Trang chi tiết đọc nhật ký theo phiếu, mới nhất trước
    index('hsba_logs_request_created_idx').on(t.requestId, t.createdAt),
  ],
);

export type HsbaRequest = typeof hsbaRequests.$inferSelect;
export type NewHsbaRequest = typeof hsbaRequests.$inferInsert;
export type HsbaSignature = typeof hsbaSignatures.$inferSelect;
export type HsbaWorkflow = typeof hsbaWorkflows.$inferSelect;

/** Trao đổi trên phiếu — phối hợp giữa khối lâm sàng và khối xét duyệt. */
export const hsbaComments = pgTable(
  'hsba_comments',
  {
    id: serial('id').primaryKey(),
    requestId: integer('request_id')
      .notNull()
      .references(() => hsbaRequests.id, { onDelete: 'cascade' }),
    userId: integer('user_id').references(() => users.id, { onDelete: 'set null' }),
    username: text('username').default('').notNull(),
    fullName: text('full_name').default('').notNull(),
    title: text('title').default('').notNull(),
    content: text('content').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    editedAt: timestamp('edited_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('hsba_comments_request_idx').on(t.requestId),
    index('hsba_comments_request_created_idx').on(t.requestId, t.createdAt),
  ],
);

/** Tệp minh chứng đính kèm: hồ sơ giấy, phản hồi BHXH… nội dung nằm ngoài đĩa. */
export const hsbaAttachments = pgTable(
  'hsba_attachments',
  {
    id: serial('id').primaryKey(),
    requestId: integer('request_id')
      .notNull()
      .references(() => hsbaRequests.id, { onDelete: 'cascade' }),
    fileName: text('file_name').notNull(),
    mimeType: text('mime_type').default('application/octet-stream').notNull(),
    sizeBytes: integer('size_bytes').default(0).notNull(),
    storagePath: text('storage_path').notNull(),
    note: text('note').default('').notNull(),
    uploadedBy: integer('uploaded_by').references(() => users.id, { onDelete: 'set null' }),
    username: text('username').default('').notNull(),
    fullName: text('full_name').default('').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [index('hsba_attachments_request_idx').on(t.requestId)],
);

export type HsbaComment = typeof hsbaComments.$inferSelect;
export type HsbaAttachment = typeof hsbaAttachments.$inferSelect;
