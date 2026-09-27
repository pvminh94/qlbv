/**
 * Kiểu dữ liệu & giá trị mặc định cho trình thiết kế bản in ở giao diện.
 * Phản chiếu `PrintDocument` của backend (backend/src/db/schema/printing.ts).
 * Toạ độ và kích thước tính bằng milimét, gốc ở góc trên-trái của vùng in.
 */

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
  border?: { top?: BorderSide; right?: BorderSide; bottom?: BorderSide; left?: BorderSide };
  borderRadius?: number;
  opacity?: number;
  autoShrink?: boolean;
  wrap?: boolean;
}

export interface FieldFormat {
  type?: string;
  pattern?: string;
  decimals?: number;
  thousandSep?: string;
  decimalSep?: string;
  fallback?: string;
  prefix?: string;
  suffix?: string;
  expression?: string;
}

export interface ElementBinding {
  source: string;
  path?: string;
  rowIndex?: number;
  format?: FieldFormat;
}

export interface TableColumnSpec {
  id: string;
  title: string;
  width: number;
  align?: 'left' | 'center' | 'right';
  binding?: ElementBinding;
  style?: ElementStyle;
}

export interface TableSpec {
  dataSource: string;
  columns: TableColumnSpec[];
  headerRows?: number;
  headerStyle?: ElementStyle;
  bodyStyle?: ElementStyle;
  repeatHeader?: boolean;
  showIndex?: boolean;
  totalRow?: boolean;
  zebra?: boolean;
  minRowHeight?: number;
  /** Phần tử nằm dưới bảng tự dời xuống khi bảng dài ra (mặc định: có) */
  pushDown?: boolean;
}

export interface PrintElement {
  id: string;
  type: string;
  name?: string;
  x: number;
  y: number;
  w: number;
  h: number;
  z?: number;
  rotation?: number;
  text?: string;
  binding?: ElementBinding;
  style?: ElementStyle;
  table?: TableSpec;
  image?: { src?: string; fit?: 'contain' | 'cover' | 'fill'; path?: string };
  repeatOnEveryPage?: boolean;
  anchor?: 'header' | 'body' | 'footer';
  visibleWhen?: string;
  locked?: boolean;
  groupId?: string;
  meta?: Record<string, unknown>;
}

export interface PrintPage {
  id: string;
  name?: string;
  elements: PrintElement[];
  paperSize?: string;
  orientation?: 'portrait' | 'landscape';
  margins?: { top: number; right: number; bottom: number; left: number };
}

export interface PrintDocument {
  paperSize: string;
  orientation: 'portrait' | 'landscape';
  margins: { top: number; right: number; bottom: number; left: number };
  customSize?: { width: number; height: number };
  grid?: { size: number; show: boolean; snap: boolean };
  defaultStyle?: ElementStyle;
  pageNumbering?: { show: boolean; position: string; label?: string; format?: string };
  header?: { height: number; elements: PrintElement[] };
  footer?: { height: number; elements: PrintElement[] };
  watermark?: { text?: string; image?: string; opacity?: number; rotation?: number; fontSize?: number };
  pages?: PrintPage[];
  variables?: { key: string; label: string; type: string; group?: string }[];
  [key: string]: unknown;
}

/* ------------------------------------------------------------------ Font chữ */

/** Font mặc định của mọi bản in */
export const DEFAULT_FONT = 'Times New Roman';
/** Font nhúng sẵn (luôn có) — danh sách đầy đủ lấy từ GET /print/fonts */
export const BUILTIN_FONTS = ['Times New Roman', 'Arial', 'Courier New', 'Roboto'];
/** Tên cũ → tên chuẩn (khớp backend font-registry) */
const FONT_ALIASES: Record<string, string> = {
  tinos: 'Times New Roman',
  times: 'Times New Roman',
  'liberation serif': 'Times New Roman',
  serif: 'Times New Roman',
  'dejavu serif': 'Times New Roman',
  arimo: 'Arial',
  helvetica: 'Arial',
  'liberation sans': 'Arial',
  'dejavu sans': 'Arial',
  'sans-serif': 'Arial',
  cousine: 'Courier New',
  courier: 'Courier New',
  'liberation mono': 'Courier New',
  monospace: 'Courier New',
};
export function canonicalFont(name?: string | null): string {
  const raw = String(name ?? '').trim();
  if (!raw) return DEFAULT_FONT;
  return FONT_ALIASES[raw.toLowerCase()] ?? raw;
}

/* ------------------------------------------------------------------ Khổ giấy */

export const PAPER_SIZES_MM: Record<string, { width: number; height: number }> = {
  A4: { width: 210, height: 297 },
  A5: { width: 148, height: 210 },
  A3: { width: 297, height: 420 },
  A6: { width: 105, height: 148 },
  B5: { width: 176, height: 250 },
  Letter: { width: 215.9, height: 279.4 },
  Legal: { width: 215.9, height: 355.6 },
};

export function paperDimensions(
  doc: Pick<PrintDocument, 'paperSize' | 'orientation' | 'customSize'>,
): { width: number; height: number } {
  const base =
    doc.paperSize === 'Custom' && doc.customSize
      ? { width: doc.customSize.width, height: doc.customSize.height }
      : (PAPER_SIZES_MM[doc.paperSize] ?? PAPER_SIZES_MM.A4);
  return doc.orientation === 'landscape'
    ? { width: base.height, height: base.width }
    : { width: base.width, height: base.height };
}

/* ------------------------------------------------- Mẫu phần tử & thiết kế gốc */

let seq = 0;
export const nextId = (prefix: string): string => `${prefix}_${Date.now().toString(36)}${(seq += 1).toString(36)}`;

export const ELEMENT_TYPES: {
  type: string;
  label: string;
  hint: string;
  make: () => PrintElement;
}[] = [
  {
    type: 'text',
    label: 'Chữ',
    hint: 'Đoạn chữ cố định',
    make: () => ({
      id: nextId('text'),
      type: 'text',
      name: 'Đoạn chữ',
      x: 10,
      y: 10,
      w: 80,
      h: 8,
      text: 'Nội dung mới',
      style: { fontSize: 12, align: 'left', wrap: true, verticalAlign: 'top' },
    }),
  },
  {
    type: 'field',
    label: 'Trường dữ liệu',
    hint: 'Lấy dữ liệu từ hồ sơ/báo cáo',
    make: () => ({
      id: nextId('field'),
      type: 'field',
      name: 'Trường dữ liệu',
      x: 10,
      y: 20,
      w: 70,
      h: 7,
      binding: { source: 'field', path: 'patientName', format: { type: 'text', fallback: '' } },
      style: { fontSize: 12, align: 'left', wrap: false, verticalAlign: 'middle' },
    }),
  },
  {
    type: 'table',
    label: 'Bảng',
    hint: 'Bảng động theo dòng dữ liệu',
    make: () => ({
      id: nextId('table'),
      type: 'table',
      name: 'Bảng số liệu',
      x: 10,
      y: 40,
      w: 190,
      h: 60,
      table: {
        dataSource: 'rows',
        repeatHeader: true,
        zebra: false,
        totalRow: false,
        minRowHeight: 6,
        columns: [
          { id: nextId('col'), title: 'STT', width: 12, align: 'center', binding: { source: 'system', path: 'index' } },
          { id: nextId('col'), title: 'Chỉ tiêu', width: 90, align: 'left', binding: { source: 'row', path: 'rowLabel' } },
          { id: nextId('col'), title: 'Số lượng', width: 40, align: 'right', binding: { source: 'row', path: 'value', format: { type: 'integer' } } },
        ],
      },
      style: { fontSize: 11, wrap: true, verticalAlign: 'middle' },
    }),
  },
  {
    type: 'line',
    label: 'Đường kẻ',
    hint: 'Đường ngang/dọc phân cách',
    make: () => ({ id: nextId('line'), type: 'line', name: 'Đường kẻ', x: 10, y: 30, w: 100, h: 0.4, style: { border: { top: { width: 0.3, style: 'solid', color: '#111827' } } } }),
  },
  {
    type: 'rect',
    label: 'Khung/Hộp',
    hint: 'Khung viền, ô nền',
    make: () => ({
      id: nextId('rect'),
      type: 'rect',
      name: 'Khung',
      x: 10,
      y: 30,
      w: 90,
      h: 20,
      style: { border: { top: { width: 0.3, style: 'solid', color: '#111827' }, right: { width: 0.3, style: 'solid', color: '#111827' }, bottom: { width: 0.3, style: 'solid', color: '#111827' }, left: { width: 0.3, style: 'solid', color: '#111827' } } },
    }),
  },
  {
    type: 'image',
    label: 'Ảnh/Logo',
    hint: 'Chèn logo bệnh viện',
    make: () => ({
      id: nextId('image'),
      type: 'image',
      name: 'Logo',
      x: 10,
      y: 8,
      w: 24,
      h: 24,
      image: { fit: 'contain' },
    }),
  },
  {
    type: 'qrcode',
    label: 'Mã QR',
    hint: 'QR tra cứu/xác thực',
    make: () => ({ id: nextId('qr'), type: 'qrcode', name: 'Mã QR', x: 170, y: 8, w: 25, h: 25, binding: { source: 'field', path: 'code' } }),
  },
  {
    type: 'barcode',
    label: 'Mã vạch',
    hint: 'Code128 — mã phiếu, mã bệnh nhân',
    make: () => ({ id: nextId('bar'), type: 'barcode', name: 'Mã vạch', x: 140, y: 8, w: 55, h: 14, binding: { source: 'field', path: 'code' }, style: { fontSize: 9 } }),
  },
  {
    type: 'signature',
    label: 'Ô chữ ký',
    hint: 'Khối ký tên theo bước ký',
    make: () => ({
      id: nextId('sig'),
      type: 'signature',
      name: 'Chữ ký',
      x: 130,
      y: 240,
      w: 65,
      h: 35,
      text: 'NGƯỜI DUYỆT\n(Ký, ghi rõ họ tên)',
      binding: { source: 'field', path: 'signature.KHTB.fullName' },
      style: { fontSize: 12, align: 'center', wrap: true },
    }),
  },
  {
    type: 'datetime',
    label: 'Ngày giờ',
    hint: 'Ngày lập / ngày in',
    make: () => ({
      id: nextId('datetime'),
      type: 'datetime',
      name: 'Ngày giờ',
      x: 130,
      y: 20,
      w: 65,
      h: 7,
      text: 'dd/MM/yyyy',
      style: { fontSize: 11, align: 'right', italic: true },
    }),
  },
  {
    type: 'pageNumber',
    label: 'Số trang',
    hint: 'Trang x/y',
    make: () => ({ id: nextId('page'), type: 'pageNumber', name: 'Số trang', x: 90, y: 285, w: 30, h: 6, style: { fontSize: 9, align: 'center' } }),
  },
];

/** Thiết kế trống dùng khi tạo mẫu in mới. */
export function emptyDocument(): PrintDocument {
  return {
    paperSize: 'A4',
    orientation: 'portrait',
    margins: { top: 15, right: 15, bottom: 15, left: 20 },
    grid: { size: 5, show: true, snap: true },
    defaultStyle: { fontFamily: DEFAULT_FONT, fontSize: 13, lineHeight: 1.35 },
    pageNumbering: { show: false, position: 'bottom-center', format: '{page}/{pages}' },
    pages: [
      {
        id: nextId('page1'),
        name: 'Trang 1',
        elements: [
          {
            id: nextId('national'),
            type: 'text',
            name: 'Quốc hiệu',
            x: 60,
            y: 6,
            w: 90,
            h: 7,
            text: 'CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM',
            style: { fontSize: 12, bold: true, align: 'center' },
          },
          {
            id: nextId('motto'),
            type: 'text',
            name: 'Tiêu ngữ',
            x: 60,
            y: 13,
            w: 90,
            h: 6,
            text: 'Độc lập – Tự do – Hạnh phúc',
            style: { fontSize: 12, bold: true, align: 'center' },
          },
        ],
      },
    ],
  };
}

/**
 * Chuẩn hoá thiết kế đọc từ CSDL: thiết kế cũ có thể lưu danh sách phần tử ở cấp tài liệu
 * (`document.elements`) thay vì theo trang — gom lại thành một trang để trình thiết kế sửa được.
 */
export function normalizeDocument(input: PrintDocument | null | undefined): PrintDocument {
  const doc: PrintDocument = { ...(input ?? emptyDocument()) };
  if (!doc.pages || doc.pages.length === 0) {
    const legacy = (doc.elements as PrintElement[] | undefined) ?? [];
    doc.pages = [{ id: nextId('page1'), name: 'Trang 1', elements: legacy }];
    delete (doc as Record<string, unknown>).elements;
  }
  if (!doc.pages.some((p) => (p.elements ?? []).length > 0)) {
    doc.pages = doc.pages.map((p, i) => (i === 0 && p.elements.length === 0 ? { ...p, elements: emptyDocument().pages?.[0]?.elements ?? [] } : p));
  }
  doc.grid = doc.grid ?? { size: 5, show: true, snap: true };
  doc.margins = doc.margins ?? { top: 15, right: 15, bottom: 15, left: 20 };
  return doc;
}

/** Danh sách trường gợi ý cho liên kết dữ liệu (dùng khi chưa có `variables`). */
export const FALLBACK_VARIABLES: { key: string; label: string; type: string; group: string }[] = [
  { key: 'code', label: 'Số phiếu', type: 'text', group: 'Phiếu' },
  { key: 'patientName', label: 'Họ tên người bệnh', type: 'text', group: 'Người bệnh' },
  { key: 'patientBirthYear', label: 'Năm sinh', type: 'text', group: 'Người bệnh' },
  { key: 'patientGender', label: 'Giới tính', type: 'text', group: 'Người bệnh' },
  { key: 'maKcb', label: 'Mã KCB', type: 'text', group: 'Người bệnh' },
  { key: 'maTheBhyt', label: 'Mã thẻ BHYT', type: 'text', group: 'Người bệnh' },
  { key: 'ngayVaoVien', label: 'Ngày vào viện', type: 'date', group: 'Người bệnh' },
  { key: 'ngayRaVien', label: 'Ngày ra viện', type: 'date', group: 'Người bệnh' },
  { key: 'reason', label: 'Lý do đề nghị', type: 'text', group: 'Nội dung' },
  { key: 'content', label: 'Nội dung cần sửa', type: 'text', group: 'Nội dung' },
  { key: 'amount', label: 'Số tiền', type: 'currency', group: 'Nội dung' },
  { key: 'departmentName', label: 'Khoa đề nghị', type: 'text', group: 'Đơn vị' },
  { key: 'requesterName', label: 'Người đề nghị', type: 'text', group: 'Người ký' },
  { key: 'signature.DE_NGHI.fullName', label: 'Người đề nghị (ký)', type: 'text', group: 'Người ký' },
  { key: 'signature.KHTB.fullName', label: 'Duyệt/TB.KHTH (ký)', type: 'text', group: 'Người ký' },
  { key: 'signature.TAICHINH.fullName', label: 'Tài chính (ký)', type: 'text', group: 'Người ký' },
  { key: 'today', label: 'Ngày hiện tại', type: 'date', group: 'Hệ thống' },
  { key: 'now', label: 'Thời điểm hiện tại', type: 'datetime', group: 'Hệ thống' },
  { key: 'index', label: 'Số thứ tự dòng', type: 'integer', group: 'Bảng' },
  { key: 'rowLabel', label: 'Tên chỉ tiêu (dòng)', type: 'text', group: 'Bảng' },
  { key: 'value', label: 'Giá trị (dòng)', type: 'number', group: 'Bảng' },
];
