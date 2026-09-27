/**
 * Phân hệ THIẾT KẾ BẢN IN — khung định dạng bản in chuyên nghiệp.
 *
 * Mỗi bản in là một tài liệu JSON (`document`) gồm nhiều trang, mỗi trang có danh sách
 * phần tử với đầy đủ thuộc tính hình học, kiểu chữ, khung viền, điều kiện hiển thị và
 * liên kết dữ liệu (binding). Toạ độ tính bằng milimét để in chính xác tuyệt đối.
 *
 * Nhờ vậy không cần sửa mã nguồn khi muốn thay đổi bố cục giấy tờ.
 */
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { users } from './system';
import type { PaperSize, PrintModule } from './types';

/* ------------------------------------------------------ Kiểu dữ liệu tài liệu in */

/** Định dạng số/ngày khi in */
export interface FieldFormat {
  /** text | number | integer | currency | percent | date | datetime | bool | formula */
  type?: string;
  pattern?: string; // vd: 'dd/MM/yyyy' hoặc '#,##0'
  decimals?: number;
  thousandSep?: string;
  decimalSep?: string;
  fallback?: string; // giá trị thay thế khi rỗng
  prefix?: string;
  suffix?: string;
  /** Biểu thức tính toán: hs + tq, hoặc sum(entries) … */
  expression?: string;
}

/** Liên kết dữ liệu của phần tử */
export interface ElementBinding {
  /** Nguồn dữ liệu: field | row | rows | param | system | entry */
  source: string;
  /** Đường dẫn trường: patientName, signature.KHTB.fullName … */
  path?: string;
  /** Chỉ số dòng khi in bảng nhiều dòng */
  rowIndex?: number;
  format?: FieldFormat;
}

/** Đường viền của một cạnh */
export interface BorderSide {
  width?: number;
  style?: 'solid' | 'dashed' | 'dotted' | 'double' | 'none';
  color?: string;
}

export interface ElementStyle {
  fontFamily?: string;
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  color?: string;
  backgroundColor?: string;
  align?: 'left' | 'center' | 'right' | 'justify';
  verticalAlign?: 'top' | 'middle' | 'bottom';
  lineHeight?: number;
  letterSpacing?: number;
  textTransform?: 'none' | 'uppercase' | 'lowercase' | 'capitalize';
  paddingX?: number;
  paddingY?: number;
  border?: {
    top?: BorderSide;
    right?: BorderSide;
    bottom?: BorderSide;
    left?: BorderSide;
  };
  borderRadius?: number;
  opacity?: number;
  /** Tự thu nhỏ cỡ chữ cho vừa ô */
  autoShrink?: boolean;
  /** Xuống dòng tự động */
  wrap?: boolean;
}

/** Cấu hình bảng động */
export interface TableColumnSpec {
  id: string;
  title: string;
  width: number;
  align?: 'left' | 'center' | 'right';
  binding?: ElementBinding;
  style?: ElementStyle;
}

export interface TableSpec {
  /** Nguồn dòng: 'rows' (danh sách dòng báo cáo) | 'entries' | 'signatures' | 'custom' */
  dataSource: string;
  columns: TableColumnSpec[];
  headerRows?: number;
  headerStyle?: ElementStyle;
  bodyStyle?: ElementStyle;
  /** Lặp lại dòng tiêu đề ở mỗi trang */
  repeatHeader?: boolean;
  showIndex?: boolean;
  /** Dòng tổng cuối bảng */
  totalRow?: boolean;
  zebra?: boolean;
  minRowHeight?: number;
  /** Phần tử nằm dưới bảng tự dời xuống khi bảng dài ra (mặc định: có) */
  pushDown?: boolean;
}

/** Một phần tử trên bản in */
export interface PrintElement {
  id: string;
  /** text | field | table | line | rect | image | qrcode | signature | pageNumber | datetime | html */
  type: string;
  name?: string;
  /** Toạ độ & kích thước (mm), gốc trên-trái */
  x: number;
  y: number;
  w: number;
  h: number;
  z?: number;
  rotation?: number;
  /** Nội dung tĩnh (với type = text/html) */
  text?: string;
  binding?: ElementBinding;
  style?: ElementStyle;
  table?: TableSpec;
  image?: { src?: string; fit?: 'contain' | 'cover' | 'fill'; path?: string };
  /** Vẽ lặp trên mọi trang (tiêu đề/chân trang) */
  repeatOnEveryPage?: boolean;
  /** Nhóm neo: header | body | footer */
  anchor?: 'header' | 'body' | 'footer';
  /** Điều kiện hiển thị dạng biểu thức: status == 'HOAN_TAT' */
  visibleWhen?: string;
  locked?: boolean;
  groupId?: string;
  meta?: Record<string, unknown>;
}

export interface PrintPage {
  id: string;
  name?: string;
  elements: PrintElement[];
  /** Ghi đè khổ giấy cho riêng trang này */
  paperSize?: string;
  orientation?: 'portrait' | 'landscape';
  margins?: { top: number; right: number; bottom: number; left: number };
}

export interface PrintDocument {
  paperSize: PaperSize | string;
  orientation: 'portrait' | 'landscape';
  /** Lề trang (mm) */
  margins: { top: number; right: number; bottom: number; left: number };
  /** Khổ tuỳ chỉnh khi paperSize = Custom */
  customSize?: { width: number; height: number };
  /** Lưới thiết kế */
  grid?: { size: number; show: boolean; snap: boolean };
  /** Cỡ chữ mặc định */
  defaultStyle?: ElementStyle;
  /** Dàn trang nâng cao */
  pageNumbering?: { show: boolean; position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'bottom-center'; label?: string; format?: string };
  header?: { height: number; elements: PrintElement[] };
  footer?: { height: number; elements: PrintElement[] };
  watermark?: { text?: string; image?: string; opacity?: number; rotation?: number; fontSize?: number };
  /** Tài liệu nhiều trang (bỏ trống → dùng 1 trang) */
  pages?: PrintPage[];
  /** Biến dữ liệu mô tả cho trình thiết kế gợi ý trường */
  variables?: { key: string; label: string; type: string; group?: string }[];
  [key: string]: unknown;
}

export const printTemplates = pgTable(
  'print_templates',
  {
    id: serial('id').primaryKey(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    description: text('description').default('').notNull(),
    /** Phân hệ dùng: HSBA | REPORT | UTILITY | GENERIC */
    module: text('module').$type<PrintModule>().default('GENERIC').notNull(),
    /** Loại chứng từ cụ thể: PHIEU_SUA_HSBA, BAO_CAO_TUAN… */
    docType: text('doc_type').default('').notNull(),
    paperSize: text('paper_size').$type<PaperSize | string>().default('A4').notNull(),
    orientation: text('orientation').default('portrait').notNull(),
    /** Toàn bộ định nghĩa bản in (xem PrintDocument) */
    document: jsonb('document').$type<PrintDocument>().notNull(),
    /** Ảnh xem trước (tuỳ chọn) */
    thumbnail: text('thumbnail').default('').notNull(),
    version: integer('version').default(1).notNull(),
    isDefault: boolean('is_default').default(false).notNull(),
    /** Dùng chung cho mọi khoa hay riêng 1 khoa */
    departmentId: integer('department_id'),
    active: boolean('active').default(true).notNull(),
    createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('print_templates_code_uq').on(t.code),
    index('print_templates_module_idx').on(t.module, t.docType),
    index('print_templates_active_idx').on(t.active),
  ],
);

/** Phiên bản bản in — cho phép khôi phục thiết kế cũ */
export const printTemplateVersions = pgTable(
  'print_template_versions',
  {
    id: serial('id').primaryKey(),
    templateId: integer('template_id')
      .notNull()
      .references(() => printTemplates.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    document: jsonb('document').$type<PrintDocument>().notNull(),
    note: text('note').default('').notNull(),
    createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('print_template_versions_uq').on(t.templateId, t.version),
    index('print_template_versions_tmpl_idx').on(t.templateId),
  ],
);

export type PrintTemplate = typeof printTemplates.$inferSelect;
export type NewPrintTemplate = typeof printTemplates.$inferInsert;
export type PrintTemplateVersion = typeof printTemplateVersions.$inferSelect;
