/**
 * Bộ máy render bản in: PrintDocument (JSON, toạ độ mm) → PDF.
 *
 * Đặc điểm:
 *  - Toạ độ tuyệt đối trên trang, đơn vị mm (1 mm = 2.8346 pt) → in ra chính xác.
 *  - Font mặc định: **Times New Roman** (font gốc do quản trị tải lên, hoặc Tinos — font tương thích
 *    metric, đủ dấu tiếng Việt). Mỗi phần tử có thể chọn font riêng (Arial, Courier New, Roboto,
 *    hoặc font bất kỳ đã tải lên) — xem font-registry.ts.
 *  - Phần tử: văn bản, trường dữ liệu, bảng động (tự sang trang, lặp tiêu đề, dòng tổng), đường kẻ
 *    ngang/dọc, khung (bo góc), hình ảnh (contain/cover/fill), mã QR, mã vạch Code128, ô chữ ký,
 *    số trang, ngày giờ. Hỗ trợ xoay, độ mờ, gạch chân/gạch ngang, căn đều hai bên, giãn ký tự.
 *  - Tài liệu nhiều trang, watermark, đánh số trang tự động, tiêu đề/chân trang lặp lại.
 *  - Phần tử nằm dưới bảng tự dời xuống khi bảng dài ra (giống section "Can grow" của Crystal Report).
 */
import * as fs from 'fs';
import * as path from 'path';
import fontkit from '@pdf-lib/fontkit';
import * as QRCode from 'qrcode';
import {
  PDFDocument,
  PDFFont,
  PDFPage,
  clip,
  concatTransformationMatrix,
  degrees,
  endPath,
  popGraphicsState,
  pushGraphicsState,
  rectangle,
  rgb,
  setCharacterSpacing,
  type RGB,
} from 'pdf-lib';
import type {
  BorderSide,
  ElementStyle,
  PrintDocument,
  PrintElement,
  PrintPage,
  TableColumnSpec,
} from '../../db/schema/printing';
import { evaluateFormula } from '../../common/utils/formula.util';
import { formatVN } from '../../common/utils/date.util';
import { code128Modules } from '../../common/utils/code128';
import { DEFAULT_FONT_FAMILY, canonicalFamily, fontRegistry, type FontVariant } from './font-registry';

export const MM = 2.834645669; // 1 mm tính bằng point

const PAPER_MM: Record<string, [number, number]> = {
  A3: [297, 420],
  A4: [210, 297],
  A5: [148, 210],
  A6: [105, 148],
  B5: [176, 250],
  Letter: [215.9, 279.4],
  Legal: [215.9, 355.6],
};

export interface RenderContext {
  /** Dữ liệu phân cấp: { request: {...}, signature: {...}, system: {...} } */
  data: Record<string, unknown>;
  /** Dòng dữ liệu cho phần tử bảng */
  rows?: Record<string, unknown>[];
  /** Tên tệp gợi ý */
  fileName?: string;
}

/* ------------------------------------------------------------------ Font */

class FontBook {
  private byFile = new Map<string, PDFFont>();
  private byKey = new Map<string, PDFFont>();

  constructor(private readonly doc: PDFDocument) {
    doc.registerFontkit(fontkit);
  }

  async prepare(families: Iterable<string>): Promise<void> {
    for (const fam of families) {
      for (const v of ['regular', 'bold', 'italic', 'boldItalic'] as FontVariant[]) {
        const key = `${canonicalFamily(fam)}|${v}`;
        if (this.byKey.has(key)) continue;
        const entry = fontRegistry.resolve(fam, v);
        let font = this.byFile.get(entry.file);
        if (!font) {
          font = await this.doc.embedFont(fontRegistry.bytes(entry), { subset: true });
          this.byFile.set(entry.file, font);
        }
        this.byKey.set(key, font);
      }
    }
  }

  get(family: string | undefined, bold?: boolean, italic?: boolean): PDFFont {
    const v: FontVariant = bold && italic ? 'boldItalic' : bold ? 'bold' : italic ? 'italic' : 'regular';
    return (
      this.byKey.get(`${canonicalFamily(family)}|${v}`) ??
      this.byKey.get(`${DEFAULT_FONT_FAMILY}|${v}`) ??
      (this.byKey.values().next().value as PDFFont)
    );
  }
}

function colorOf(value: string | undefined, fallback: RGB): RGB {
  if (!value) return fallback;
  let hex = value.replace('#', '').trim();
  if (/^[0-9a-fA-F]{3}$/.test(hex)) hex = hex.split('').map((c) => c + c).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return fallback;
  return rgb(
    parseInt(hex.slice(0, 2), 16) / 255,
    parseInt(hex.slice(2, 4), 16) / 255,
    parseInt(hex.slice(4, 6), 16) / 255,
  );
}

/* ------------------------------------------------------------- Truy xuất dữ liệu */

export function getByPath(obj: unknown, p: string): unknown {
  if (!p) return undefined;
  const segments = p.replace(/\[(\d+)\]/g, '.$1').split('.');
  let cur: unknown = obj;
  for (const seg of segments) {
    if (cur === null || cur === undefined) return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

/** Định dạng ngày theo mẫu dd/MM/yyyy HH:mm:ss */
function formatDatePattern(d: Date, pattern: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const map: Record<string, string> = {
    yyyy: get('year'),
    yy: get('year').slice(-2),
    MM: get('month'),
    dd: get('day'),
    HH: get('hour') === '24' ? '00' : get('hour'),
    mm: get('minute'),
    ss: get('second'),
  };
  return pattern.replace(/yyyy|yy|MM|dd|HH|mm|ss/g, (m) => map[m] ?? m);
}

const DATE_PATTERN_RE = /(dd|MM|yyyy|HH|mm)/;

export function formatValue(
  raw: unknown,
  format?: {
    type?: string;
    pattern?: string;
    decimals?: number;
    fallback?: string;
    prefix?: string;
    suffix?: string;
    expression?: string;
  },
): string {
  if (raw === undefined || raw === null || raw === '') {
    if (format?.expression) {
      const res = evaluateFormula(format.expression, { values: {} });
      return String(res.value);
    }
    return format?.fallback ?? '';
  }
  const type = format?.type ?? 'text';
  let out: string;
  switch (type) {
    case 'number':
    case 'integer': {
      const n = Number(typeof raw === 'string' ? raw.replace(/[^\d.-]/g, '') : raw);
      if (!Number.isFinite(n)) {
        out = String(raw);
        break;
      }
      const decimals = type === 'integer' ? 0 : (format?.decimals ?? 0);
      out = n.toLocaleString('vi-VN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
      break;
    }
    case 'currency': {
      const n = Number(raw);
      out = Number.isFinite(n) ? `${n.toLocaleString('vi-VN', { maximumFractionDigits: 0 })} đ` : String(raw);
      break;
    }
    case 'percent': {
      const n = Number(raw);
      out = Number.isFinite(n) ? `${(n * 100).toFixed(format?.decimals ?? 1)}%` : String(raw);
      break;
    }
    case 'date':
    case 'datetime': {
      const s = String(raw);
      const d = new Date(s.length === 10 ? `${s}T00:00:00+07:00` : s);
      if (Number.isNaN(d.getTime())) {
        out = s;
      } else if (format?.pattern && DATE_PATTERN_RE.test(format.pattern)) {
        out = formatDatePattern(d, format.pattern);
      } else {
        out = type === 'date' ? formatDatePattern(d, 'dd/MM/yyyy') : formatDatePattern(d, 'dd/MM/yyyy HH:mm');
      }
      break;
    }
    case 'bool':
      out = raw ? 'Có' : 'Không';
      break;
    default:
      out = String(raw);
  }
  return `${format?.prefix ?? ''}${out}${format?.suffix ?? ''}`;
}

/** Thay thế {đường.dẫn} trong chuỗi bằng dữ liệu thật */
export function interpolate(text: string, data: Record<string, unknown>): string {
  return String(text ?? '').replace(/\{([a-zA-Z0-9_.[\]]+)\}/g, (_m, expr: string) => {
    const value = getByPath(data, expr);
    if (value === undefined || value === null) return '';
    if (value instanceof Date) return formatDatePattern(value, 'dd/MM/yyyy HH:mm');
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) {
      return value.includes('T') ? formatValue(value, { type: 'datetime' }) : formatVN(value.slice(0, 10));
    }
    if (typeof value === 'object') return '';
    return String(value);
  });
}

/* --------------------------------------------------------------- Vẽ văn bản */

interface Line {
  text: string;
  /** Dòng cuối của đoạn — không căn đều */
  last: boolean;
}

function measure(font: PDFFont, text: string, size: number, spacing: number): number {
  if (!text) return 0;
  return font.widthOfTextAtSize(text, size) + spacing * Math.max(0, [...text].length - 1);
}

/** Loại ký tự font không vẽ được (tránh lỗi "WinAnsi cannot encode") */
function sanitize(text: string, font: PDFFont): string {
  try {
    font.encodeText(text);
    return text;
  } catch {
    return [...text]
      .map((ch) => {
        try {
          font.encodeText(ch);
          return ch;
        } catch {
          return '?';
        }
      })
      .join('');
  }
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number, spacing: number, wrap = true): Line[] {
  const out: Line[] = [];
  for (const paragraph of String(text ?? '').replace(/\r/g, '').replace(/\t/g, '    ').split('\n')) {
    if (!wrap) {
      out.push({ text: paragraph, last: true });
      continue;
    }
    if (paragraph === '') {
      out.push({ text: '', last: true });
      continue;
    }
    const words = paragraph.split(/ +/);
    let line = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (measure(font, candidate, size, spacing) > maxWidth && line) {
        out.push({ text: line, last: false });
        line = word;
      } else {
        line = candidate;
      }
      // Từ quá dài: cắt theo ký tự
      if (measure(font, line, size, spacing) > maxWidth) {
        let chunk = '';
        for (const ch of line) {
          if (measure(font, chunk + ch, size, spacing) > maxWidth && chunk) {
            out.push({ text: chunk, last: false });
            chunk = ch;
          } else chunk += ch;
        }
        line = chunk;
      }
    }
    out.push({ text: line, last: true });
  }
  return out;
}

function dashOf(side?: BorderSide): number[] | undefined {
  return side?.style === 'dashed' ? [3, 2] : side?.style === 'dotted' ? [0.8, 1.6] : undefined;
}

function hasSide(side?: BorderSide): side is BorderSide {
  return !!side && side.style !== 'none' && !!side.width && side.width > 0;
}

function drawBorders(page: PDFPage, style: ElementStyle | undefined, x: number, yTop: number, w: number, h: number): void {
  const border = style?.border;
  if (!border) return;
  const sides = ['top', 'right', 'bottom', 'left'] as const;
  const radius = (style?.borderRadius ?? 0) * MM;
  // Bo góc + 4 cạnh giống nhau → vẽ một khung bo tròn
  if (radius > 0 && sides.every((s) => hasSide(border[s]))) {
    const b = border.top as BorderSide;
    page.drawSvgPath(roundedRectPath(w, h, radius), {
      x,
      y: yTop,
      borderColor: colorOf(b.color, rgb(0, 0, 0)),
      borderWidth: Math.max(0.1, b.width ?? 0.3) * MM,
      borderDashArray: dashOf(b),
      opacity: 0,
      borderOpacity: style?.opacity ?? 1,
    });
    return;
  }
  for (const side of sides) {
    const spec = border[side];
    if (!hasSide(spec)) continue;
    const color = colorOf(spec.color, rgb(0, 0, 0));
    const thickness = Math.max(0.1, spec.width ?? 0.3) * MM;
    const dashArray = dashOf(spec);
    const seg = (x1: number, y1: number, x2: number, y2: number) =>
      page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness, color, dashArray, opacity: style?.opacity ?? 1 });
    const draw = (off: number) => {
      if (side === 'top') seg(x, yTop - off, x + w, yTop - off);
      if (side === 'bottom') seg(x, yTop - h + off, x + w, yTop - h + off);
      if (side === 'left') seg(x + off, yTop, x + off, yTop - h);
      if (side === 'right') seg(x + w - off, yTop, x + w - off, yTop - h);
    };
    if (spec.style === 'double') {
      draw(0);
      draw(thickness * 2.5);
    } else draw(0);
  }
}

/** Đường SVG hình chữ nhật bo góc, gốc trên-trái, trục y hướng xuống (quy ước drawSvgPath) */
function roundedRectPath(w: number, h: number, r: number): string {
  const rr = Math.min(r, w / 2, h / 2);
  return `M ${rr} 0 H ${w - rr} Q ${w} 0 ${w} ${rr} V ${h - rr} Q ${w} ${h} ${w - rr} ${h} H ${rr} Q 0 ${h} 0 ${h - rr} V ${rr} Q 0 0 ${rr} 0 Z`;
}

function drawBackground(page: PDFPage, style: ElementStyle, x: number, yTop: number, w: number, h: number): void {
  if (!style.backgroundColor || style.backgroundColor === 'transparent') return;
  const color = colorOf(style.backgroundColor, rgb(1, 1, 1));
  const radius = (style.borderRadius ?? 0) * MM;
  if (radius > 0) {
    page.drawSvgPath(roundedRectPath(w, h, radius), { x, y: yTop, color, opacity: style.opacity ?? 1, borderWidth: 0 });
  } else {
    page.drawRectangle({ x, y: yTop - h, width: w, height: h, color, opacity: style.opacity ?? 1 });
  }
}

function applyTransform(text: string, transform?: string): string {
  if (transform === 'uppercase') return text.toLocaleUpperCase('vi-VN');
  if (transform === 'lowercase') return text.toLocaleLowerCase('vi-VN');
  if (transform === 'capitalize') return text.replace(/(^|\s)(\p{L})/gu, (_m, s: string, c: string) => s + c.toLocaleUpperCase('vi-VN'));
  return text;
}

/** Vẽ khối chữ trong hộp (toạ độ pt, gốc PDF dưới-trái; yTop = cạnh trên) */
function drawTextBox(
  page: PDFPage,
  box: { x: number; yTop: number; w: number; h: number },
  rawText: string,
  style: ElementStyle,
  fonts: FontBook,
  opts: { background?: boolean; borders?: boolean } = {},
): void {
  const { x, yTop, w, h } = box;
  const paddingX = (style.paddingX ?? 0) * MM;
  const paddingY = (style.paddingY ?? 0) * MM;
  const innerW = Math.max(1, w - paddingX * 2);
  const innerH = Math.max(1, h - paddingY * 2);

  if (opts.background !== false) drawBackground(page, style, x, yTop, w, h);

  const font = fonts.get(style.fontFamily, style.bold, style.italic);
  const text = sanitize(applyTransform(String(rawText ?? ''), style.textTransform), font);
  const spacing = style.letterSpacing ?? 0;
  const lineHeight = style.lineHeight ?? 1.35;
  const wrap = style.wrap !== false;
  let fontSize = style.fontSize ?? 12;
  let lines = wrapText(text, font, fontSize, innerW, spacing, wrap);

  // Tự thu nhỏ cỡ chữ cho vừa ô (theo chiều cao, và theo chiều rộng khi không xuống dòng)
  if (style.autoShrink !== false) {
    const tooBig = () =>
      lines.length * fontSize * lineHeight > innerH + 0.5 ||
      (!wrap && lines.some((l) => measure(font, l.text, fontSize, spacing) > innerW + 0.5));
    let guard = 0;
    while (tooBig() && fontSize > 5 && guard++ < 40) {
      fontSize -= 0.25;
      lines = wrapText(text, font, fontSize, innerW, spacing, wrap);
    }
  }

  const lineHeightPt = fontSize * lineHeight;
  const totalHeight = lines.length * lineHeightPt;
  const valign = style.verticalAlign ?? 'top';
  let cursorY =
    valign === 'middle'
      ? yTop - paddingY - (innerH - totalHeight) / 2
      : valign === 'bottom'
        ? yTop - paddingY - (innerH - totalHeight)
        : yTop - paddingY;

  const align = style.align ?? 'left';
  const color = colorOf(style.color, rgb(0, 0, 0));
  const opacity = style.opacity ?? 1;
  // Đường cơ sở: căn giữa dòng theo ascent/descent thật của font (khớp với trình duyệt)
  const ascent = font.heightAtSize(fontSize, { descender: false });
  const fullH = font.heightAtSize(fontSize);
  const baselineOffset = (lineHeightPt - fullH) / 2 + ascent;

  if (spacing) page.pushOperators(setCharacterSpacing(spacing));
  for (const line of lines) {
    if (line.text !== '') {
      const baseY = cursorY - baselineOffset;
      const lineWidth = measure(font, line.text, fontSize, spacing);
      if (align === 'justify' && !line.last && line.text.includes(' ')) {
        const words = line.text.split(' ');
        const wordsW = words.reduce((s, wd) => s + measure(font, wd, fontSize, spacing), 0);
        const gap = (innerW - wordsW) / (words.length - 1);
        let wx = x + paddingX;
        for (const wd of words) {
          page.drawText(wd, { x: wx, y: baseY, size: fontSize, font, color, opacity });
          wx += measure(font, wd, fontSize, spacing) + gap;
        }
        decorate(page, style, x + paddingX, baseY, innerW, fontSize, color, opacity);
      } else {
        const drawX =
          align === 'center'
            ? x + paddingX + (innerW - lineWidth) / 2
            : align === 'right'
              ? x + w - paddingX - lineWidth
              : x + paddingX;
        page.drawText(line.text, { x: drawX, y: baseY, size: fontSize, font, color, opacity });
        decorate(page, style, drawX, baseY, lineWidth, fontSize, color, opacity);
      }
    }
    cursorY -= lineHeightPt;
  }
  if (spacing) page.pushOperators(setCharacterSpacing(0));

  if (opts.borders !== false) drawBorders(page, style, x, yTop, w, h);
}

function decorate(page: PDFPage, style: ElementStyle, x: number, baseY: number, width: number, size: number, color: RGB, opacity: number): void {
  const thickness = Math.max(0.4, size * 0.05);
  if (style.underline) {
    page.drawLine({ start: { x, y: baseY - size * 0.12 }, end: { x: x + width, y: baseY - size * 0.12 }, thickness, color, opacity });
  }
  if (style.strike) {
    page.drawLine({ start: { x, y: baseY + size * 0.3 }, end: { x: x + width, y: baseY + size * 0.3 }, thickness, color, opacity });
  }
}

/* ------------------------------------------------------------------ Bố cục */

interface PageGeom {
  widthMm: number;
  heightMm: number;
  margins: { top: number; right: number; bottom: number; left: number };
}

function pageGeometry(doc: PrintDocument, spec?: PrintPage): PageGeom {
  const size = spec?.paperSize ?? doc.paperSize;
  const orientation = spec?.orientation ?? doc.orientation;
  let dims: [number, number];
  if (size === 'Custom' && doc.customSize) dims = [doc.customSize.width, doc.customSize.height];
  else {
    const entry = PAPER_MM[String(size)] ?? PAPER_MM['A4'];
    dims = orientation === 'landscape' ? [entry[1], entry[0]] : [entry[0], entry[1]];
  }
  return {
    widthMm: dims[0],
    heightMm: dims[1],
    margins: spec?.margins ?? doc.margins ?? { top: 15, right: 15, bottom: 15, left: 20 },
  };
}

/** Một thao tác vẽ đã được xếp chỗ — thực thi sau khi biết tổng số trang, theo thứ tự lớp (z) */
interface DrawOp {
  page: number;
  z: number;
  order: number;
  run: (page: PDFPage, pageIndex: number, totalPages: number) => Promise<void> | void;
}

/** Xoay phần tử quanh tâm hộp (độ, chiều kim đồng hồ như trên trình thiết kế) */
function withRotation(page: PDFPage, el: PrintElement, geom: PageGeom, fn: () => void | Promise<void>) {
  const rot = Number(el.rotation ?? 0);
  if (!rot) return fn();
  const cx = (el.x + el.w / 2) * MM;
  const cy = (geom.heightMm - el.y - el.h / 2) * MM;
  const t = (-rot * Math.PI) / 180;
  const cos = Math.cos(t);
  const sin = Math.sin(t);
  page.pushOperators(
    pushGraphicsState(),
    concatTransformationMatrix(cos, sin, -sin, cos, cx - cx * cos + cy * sin, cy - cx * sin - cy * cos),
  );
  const done = () => page.pushOperators(popGraphicsState());
  const res = fn();
  if (res instanceof Promise) return res.then(done);
  done();
  return undefined;
}

/* ------------------------------------------------------------------- Render */

export interface RenderResult {
  buffer: Buffer;
  pages: number;
  widthMm: number;
  heightMm: number;
}

/** Họ font dùng trong tài liệu — để nhúng trước */
function collectFamilies(document: PrintDocument, defaultFamily: string, elements: PrintElement[]): Set<string> {
  const set = new Set<string>([canonicalFamily(defaultFamily)]);
  const add = (s?: ElementStyle) => {
    if (s?.fontFamily) set.add(canonicalFamily(s.fontFamily));
  };
  for (const el of elements) {
    add(el.style);
    add(el.table?.headerStyle);
    add(el.table?.bodyStyle);
    el.table?.columns?.forEach((c) => add(c.style));
  }
  void document;
  return set;
}

export async function renderPrintDocument(document: PrintDocument, ctx: RenderContext): Promise<RenderResult> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(ctx.fileName ?? 'QLBS');
  pdf.setProducer('QLBS — Phần mềm Quản lý Bệnh viện');
  pdf.setCreator('QLBS Print Designer');
  pdf.setLanguage('vi-VN');

  // Trang thiết kế (thiết kế cũ lưu phần tử ở cấp tài liệu → 1 trang)
  const specs: PrintPage[] =
    document.pages && document.pages.length > 0
      ? document.pages
      : [{ id: 'page-1', elements: ((document as Record<string, unknown>).elements as PrintElement[]) ?? [] }];

  const repeatDeclared: PrintElement[] = [
    ...(document.header?.elements ?? []),
    ...(document.footer?.elements ?? []),
  ].map((el) => ({ ...el, repeatOnEveryPage: true }));
  const allElements = [...specs.flatMap((p) => p.elements ?? []), ...repeatDeclared];

  const defaultFamily = canonicalFamily(document.defaultStyle?.fontFamily ?? DEFAULT_FONT_FAMILY);
  const fonts = new FontBook(pdf);
  await fonts.prepare(collectFamilies(document, defaultFamily, allElements));

  /** Kiểu hiệu lực = kiểu mặc định của tài liệu + kiểu riêng của phần tử */
  const baseStyle: ElementStyle = {
    fontFamily: defaultFamily,
    fontSize: document.defaultStyle?.fontSize ?? 12,
    lineHeight: document.defaultStyle?.lineHeight ?? 1.35,
    color: document.defaultStyle?.color,
  };
  const eff = (s?: ElementStyle, extra?: ElementStyle): ElementStyle => {
    const merged: ElementStyle = { ...baseStyle, ...(extra ?? {}), ...(s ?? {}) };
    if (!merged.fontFamily) merged.fontFamily = defaultFamily;
    return merged;
  };

  const data: Record<string, unknown> = { ...ctx.data };
  const now = new Date();
  data['system'] = {
    day: formatDatePattern(now, 'dd'),
    month: formatDatePattern(now, 'MM'),
    year: formatDatePattern(now, 'yyyy'),
    date: formatDatePattern(now, 'dd/MM/yyyy'),
    time: formatDatePattern(now, 'HH:mm'),
    datetime: formatDatePattern(now, 'dd/MM/yyyy HH:mm'),
    page: '',
    pages: '',
    ...(data['system'] as Record<string, unknown> | undefined),
  };
  if (data['today'] === undefined) data['today'] = formatDatePattern(now, 'dd/MM/yyyy');
  if (data['now'] === undefined) data['now'] = formatDatePattern(now, 'dd/MM/yyyy HH:mm');

  const isVisible = (el: PrintElement): boolean => {
    if (el.meta?.['hidden'] === true) return false;
    if (!el.visibleWhen?.trim()) return true;
    try {
      const res = evaluateFormula(interpolate(el.visibleWhen, data), { values: {}, texts: data as never });
      return res.value !== 0;
    } catch {
      return true;
    }
  };

  const geoms: PageGeom[] = [];
  const pdfPages: PDFPage[] = [];
  const addPage = (geom: PageGeom): number => {
    pdfPages.push(pdf.addPage([geom.widthMm * MM, geom.heightMm * MM]));
    geoms.push(geom);
    return pdfPages.length - 1;
  };

  const ops: DrawOp[] = [];
  let order = 0;
  const push = (pageIdx: number, z: number, run: DrawOp['run']) => ops.push({ page: pageIdx, z, order: order++, run });

  const anchorY = (el: PrintElement, geom: PageGeom): number => {
    if (el.anchor === 'footer' && el.y < 0) return geom.heightMm + el.y;
    if (el.anchor === 'header' && el.y < 0) return -el.y;
    return el.y;
  };

  /* ---------- Vẽ một phần tử thường (không phải bảng) */
  const drawElement = async (page: PDFPage, el: PrintElement, geom: PageGeom, pageIndex: number, totalPages: number) => {
    const system = data['system'] as Record<string, unknown>;
    system['page'] = String(pageIndex + 1);
    system['pages'] = String(totalPages);
    const H = geom.heightMm * MM;
    const box = { x: el.x * MM, yTop: H - el.y * MM, w: el.w * MM, h: el.h * MM };
    const style = eff(el.style);
    const withPages = (s: string) =>
      s.replace(/\{page\}/g, String(pageIndex + 1)).replace(/\{(pages|total)\}/g, String(totalPages));

    await withRotation(page, el, geom, async () => {
      switch (el.type) {
        case 'text':
          drawTextBox(page, box, interpolate(withPages(el.text ?? ''), data), style, fonts);
          break;
        case 'field': {
          const raw = el.binding?.path ? getByPath(data, el.binding.path) : undefined;
          const value = formatValue(raw, el.binding?.format as never);
          const label = (el.meta?.['label'] as string | undefined) ?? '';
          drawTextBox(page, box, value || interpolate(label, data), style, fonts);
          break;
        }
        case 'pageNumber': {
          const template = el.text || (el.meta?.['label'] as string | undefined) || 'Trang {page}/{pages}';
          drawTextBox(page, box, interpolate(withPages(template), data), style, fonts);
          break;
        }
        case 'datetime': {
          const pattern = el.text ?? '';
          let text: string;
          const raw = el.binding?.path ? getByPath(data, el.binding.path) : undefined;
          if (pattern && !pattern.includes('{') && DATE_PATTERN_RE.test(pattern)) {
            const d = raw ? new Date(String(raw)) : now;
            text = formatDatePattern(Number.isNaN(d.getTime()) ? now : d, pattern);
          } else {
            text = interpolate(withPages(pattern || (el.meta?.['label'] as string) || '{system.datetime}'), data);
          }
          drawTextBox(page, box, text, style, fonts);
          break;
        }
        case 'line': {
          const side = style.border?.top ?? style.border?.bottom;
          const thickness = Math.max(0.1, side?.width ?? 0.3) * MM;
          const color = colorOf(side?.color ?? el.style?.color, rgb(0, 0, 0));
          const vertical = el.h > el.w;
          const dashArray = dashOf(side);
          const opacity = style.opacity ?? 1;
          if (vertical) {
            const lx = box.x + box.w / 2;
            page.drawLine({ start: { x: lx, y: box.yTop }, end: { x: lx, y: box.yTop - box.h }, thickness, color, dashArray, opacity });
          } else {
            const ly = box.yTop - box.h / 2;
            const width = el.w ? box.w : (geom.widthMm - el.x - geom.margins.right) * MM;
            page.drawLine({ start: { x: box.x, y: ly }, end: { x: box.x + width, y: ly }, thickness, color, dashArray, opacity });
            if (side?.style === 'double') {
              page.drawLine({ start: { x: box.x, y: ly - thickness * 2.5 }, end: { x: box.x + width, y: ly - thickness * 2.5 }, thickness, color, opacity });
            }
          }
          break;
        }
        case 'rect': {
          drawBackground(page, style, box.x, box.yTop, box.w, box.h);
          if (el.style?.border === undefined) {
            // Thiết kế cũ: khung viền đơn theo màu chữ
            const side: BorderSide = { width: 0.3, style: 'solid', color: el.style?.color ?? '#000000' };
            drawBorders(page, { ...style, border: { top: side, right: side, bottom: side, left: side } }, box.x, box.yTop, box.w, box.h);
          } else drawBorders(page, style, box.x, box.yTop, box.w, box.h);
          if (el.text) drawTextBox(page, box, interpolate(el.text, data), style, fonts, { background: false, borders: false });
          break;
        }
        case 'image':
          await drawImage(pdf, page, el, box, data, style);
          break;
        case 'qrcode': {
          const raw = el.binding?.path ? getByPath(data, el.binding.path) : undefined;
          const content = raw !== undefined && raw !== null && raw !== '' ? String(raw) : interpolate(el.text ?? '', data);
          if (content) drawQr(page, content, box, colorOf(el.style?.color, rgb(0, 0, 0)), el.meta?.['ecLevel'] as string);
          break;
        }
        case 'barcode': {
          const raw = el.binding?.path ? getByPath(data, el.binding.path) : undefined;
          const content = raw !== undefined && raw !== null && raw !== '' ? String(raw) : interpolate(el.text ?? '', data);
          if (content) drawBarcode(page, content, box, style, fonts, el.meta?.['showText'] !== false);
          break;
        }
        case 'signature':
          drawSignature(page, el, box, style, fonts, data);
          break;
        default:
          if (el.text) drawTextBox(page, box, interpolate(withPages(el.text), data), style, fonts);
      }
    });
  };

  /* ---------- Bảng động: xếp chỗ, tự sang trang, trả về vị trí kết thúc */
  const layoutTable = (el: PrintElement, startPage: number, startYmm: number): { page: number; endYmm: number } => {
    const spec = el.table;
    const tableStyle = eff(el.style);
    let columns: TableColumnSpec[] = [...(spec?.columns ?? [])];
    const isIndexCol = (c: TableColumnSpec) => c.binding?.source === 'index' || (c.binding?.path === 'index' && c.binding?.source !== 'row');
    if (spec?.showIndex && !columns.some(isIndexCol)) {
      columns = [{ id: '__idx', title: 'STT', width: 10, align: 'center', binding: { source: 'index' } }, ...columns];
    }
    if (!columns.length) return { page: startPage, endYmm: startYmm };

    // Nguồn dòng: mảng trong dữ liệu theo đường dẫn dataSource, mặc định ctx.rows
    const fromData = spec?.dataSource ? getByPath(data, spec.dataSource) : undefined;
    const rows: Record<string, unknown>[] = Array.isArray(fromData) ? (fromData as Record<string, unknown>[]) : (ctx.rows ?? []);

    const totalW = el.w * MM;
    const declared = columns.reduce((s, c) => s + (Number(c.width) || 1), 0) || 1;
    const colW = columns.map((c) => ((Number(c.width) || 1) / declared) * totalW);
    const fs0 = tableStyle.fontSize ?? 11;
    const thin = (color: string, width = 0.2): ElementStyle['border'] => ({
      top: { width, style: 'solid', color },
      bottom: { width, style: 'solid', color },
      left: { width, style: 'solid', color },
      right: { width, style: 'solid', color },
    });
    const headerStyle: ElementStyle = {
      ...tableStyle,
      bold: true,
      align: 'center',
      verticalAlign: 'middle',
      backgroundColor: '#f1f5f9',
      paddingX: 1,
      paddingY: 0.8,
      autoShrink: false,
      ...spec?.headerStyle,
      fontSize: spec?.headerStyle?.fontSize ?? fs0,
      border: spec?.headerStyle?.border ?? thin('#000000', 0.25),
    };
    const bodyStyle: ElementStyle = {
      ...tableStyle,
      verticalAlign: 'middle',
      paddingX: 1,
      paddingY: 0.6,
      autoShrink: false,
      backgroundColor: undefined,
      ...spec?.bodyStyle,
      fontSize: spec?.bodyStyle?.fontSize ?? fs0,
      border: spec?.bodyStyle?.border ?? thin('#000000', 0.2),
    };

    const cellHeight = (text: string, st: ElementStyle, width: number, minMm: number): number => {
      const f = fonts.get(st.fontFamily, st.bold, st.italic);
      const size = st.fontSize ?? 11;
      const inner = Math.max(4, width - (st.paddingX ?? 0) * 2 * MM);
      const lines = wrapText(sanitize(applyTransform(text, st.textTransform), f), f, size, inner, st.letterSpacing ?? 0, st.wrap !== false);
      return Math.max(minMm * MM, lines.length * size * (st.lineHeight ?? 1.2) + (st.paddingY ?? 0) * 2 * MM);
    };

    const colStyle = (col: TableColumnSpec, base: ElementStyle): ElementStyle => ({
      ...base,
      ...(col.style ?? {}),
      align: col.align ?? col.style?.align ?? base.align ?? 'left',
    });

    const cellValue = (row: Record<string, unknown>, col: TableColumnSpec, index: number): string => {
      const b = col.binding;
      if (!b) return '';
      if (isIndexCol(col)) return String(index + 1);
      if (!b.path) return '';
      let raw = getByPath(row, b.path);
      if (raw === undefined && b.source !== 'row') raw = getByPath(data, b.path);
      return formatValue(raw, b.format);
    };

    const minRow = spec?.minRowHeight ?? 6;
    const headerH = Math.max(
      ...columns.map((c, i) => cellHeight(c.title ?? '', colStyle(c, headerStyle), colW[i], minRow + 1)),
    );

    let pageIdx = startPage;
    let geom = geoms[pageIdx];
    let cursor = startYmm * MM; // khoảng cách từ mép trên trang (pt)
    const z = el.z ?? 0;
    const bottomLimit = () => (geom.heightMm - geom.margins.bottom) * MM;

    const placeRow = (values: string[], st: ElementStyle, h: number, zebra: boolean, isHeader: boolean) => {
      const p = pageIdx;
      const g = geom;
      const top = cursor;
      push(p, z, (page) => {
        let cx = el.x * MM;
        columns.forEach((col, i) => {
          const cs = colStyle(col, st);
          if (!isHeader && zebra && !cs.backgroundColor) cs.backgroundColor = '#f5f7fa';
          drawTextBox(page, { x: cx, yTop: g.heightMm * MM - top, w: colW[i], h }, values[i] ?? '', cs, fonts);
          cx += colW[i];
        });
      });
      cursor += h;
    };

    const header = () => placeRow(columns.map((c) => c.title ?? ''), headerStyle, headerH, false, true);
    header();

    rows.forEach((row, idx) => {
      const values = columns.map((c) => cellValue(row, c, idx));
      // Kiểu riêng cho từng dòng (dòng nhóm / cộng nhóm trong báo cáo): row.__style
      const rs = row && typeof row.__style === 'object' ? (row.__style as ElementStyle) : undefined;
      const rowStyle: ElementStyle = rs ? { ...bodyStyle, ...rs } : bodyStyle;
      const h = Math.max(...values.map((v, i) => cellHeight(v, colStyle(columns[i], rowStyle), colW[i], minRow)));
      if (cursor + h > bottomLimit() + 0.5) {
        // Sang trang: dùng trang thiết kế kế tiếp nếu còn trống, nếu không thêm trang mới cùng khổ
        pageIdx = pageIdx + 1 < pdfPages.length ? pageIdx + 1 : addPage(geom);
        geom = geoms[pageIdx];
        cursor = geom.margins.top * MM;
        if (spec?.repeatHeader !== false) header();
      }
      placeRow(values, rowStyle, h, !!spec?.zebra && idx % 2 === 1 && !rs, false);
    });

    if (spec?.totalRow) {
      const numericTypes = new Set(['number', 'integer', 'currency', 'percent']);
      const labelCol = columns.findIndex((c) => !isIndexCol(c));
      const values = columns.map((c, i) => {
        const t = c.binding?.format?.type;
        if (c.binding?.path && t && numericTypes.has(t) && !isIndexCol(c)) {
          const sum = rows.reduce((s, r) => {
            const n = Number(getByPath(r, c.binding?.path ?? ''));
            return s + (Number.isFinite(n) ? n : 0);
          }, 0);
          return formatValue(t === 'percent' ? sum / Math.max(1, rows.length) : sum, c.binding?.format);
        }
        return i === (labelCol === -1 ? 0 : labelCol) ? 'Tổng cộng' : '';
      });
      const st: ElementStyle = { ...bodyStyle, bold: true, backgroundColor: '#f1f5f9' };
      const h = Math.max(...values.map((v, i) => cellHeight(v, colStyle(columns[i], st), colW[i], minRow)));
      if (cursor + h > bottomLimit() + 0.5) {
        pageIdx = pageIdx + 1 < pdfPages.length ? pageIdx + 1 : addPage(geom);
        geom = geoms[pageIdx];
        cursor = geom.margins.top * MM;
        if (spec?.repeatHeader !== false) header();
      }
      placeRow(values, st, h, false, false);
    }

    return { page: pageIdx, endYmm: cursor / MM };
  };

  /* ---------- Xếp chỗ từng trang thiết kế */
  const repeatEls = allElements.filter((el) => el.repeatOnEveryPage === true && el.type !== 'table');

  for (const spec of specs) {
    const geom = pageGeometry(document, spec);
    const first = addPage(geom);
    const els = (spec.elements ?? [])
      .filter((el) => !(el.repeatOnEveryPage === true && el.type !== 'table'))
      .filter(isVisible)
      .map((el) => ({ ...el, y: anchorY(el, geom) }));

    // Bảng theo thứ tự từ trên xuống; phần tử nằm dưới bảng sẽ dời theo phần bảng dài thêm
    const tables = els.filter((e) => e.type === 'table').sort((a, b) => a.y - b.y);
    const others = els.filter((e) => e.type !== 'table');
    /** Độ dời (mm) và trang cho phần tử thường */
    const placement = new Map<string, { page: number; dy: number }>();
    others.forEach((e) => placement.set(e.id, { page: first, dy: 0 }));

    let shiftPage = first;
    let shiftDy = 0;
    for (const t of tables) {
      const place = { page: shiftPage, y: t.y + shiftDy };
      const res = layoutTable(t, place.page, place.y);
      const designedEnd = t.y + t.h;
      if (t.table?.pushDown === false) continue;
      // Các phần tử nằm dưới bảng (và không neo chân trang)
      const below = others.filter((o) => o.y >= designedEnd - 0.01 && o.anchor !== 'footer');
      if (!below.length) {
        shiftPage = res.page;
        shiftDy = res.endYmm - designedEnd;
        continue;
      }
      let dy = res.endYmm - designedEnd;
      let targetPage = res.page;
      if (dy < 0 && t.meta?.['shrink'] !== true) dy = 0; // không kéo lên khi bảng ngắn hơn thiết kế
      const geomT = geoms[targetPage];
      const blockBottom = Math.max(...below.map((o) => o.y + o.h)) + dy;
      const limit = geomT.heightMm - geomT.margins.bottom;
      if (blockBottom > limit + 0.01) {
        // Không đủ chỗ → chuyển cả khối sang trang mới, bắt đầu từ lề trên
        targetPage = targetPage + 1 < pdfPages.length ? targetPage + 1 : addPage(geomT);
        const top = Math.min(...below.map((o) => o.y));
        dy = geoms[targetPage].margins.top - top;
      }
      below.forEach((o) => placement.set(o.id, { page: targetPage, dy }));
      shiftPage = targetPage;
      shiftDy = dy;
    }

    for (const el of others) {
      const pl = placement.get(el.id) ?? { page: first, dy: 0 };
      const moved: PrintElement = pl.dy ? { ...el, y: el.y + pl.dy } : el;
      push(pl.page, el.z ?? 0, (page, idx, total) => drawElement(page, moved, geoms[pl.page], idx, total));
    }
  }

  const total = pdfPages.length;

  /* ---------- Watermark (dưới cùng) */
  const wm = document.watermark;
  if (wm?.text?.trim() || wm?.image) {
    for (let i = 0; i < total; i++) {
      push(i, -1e6, async (page) => {
        const g = geoms[i];
        const W = g.widthMm * MM;
        const H = g.heightMm * MM;
        const opacity = wm.opacity ?? 0.08;
        if (wm.image) {
          const bytes = decodeImage(wm.image);
          if (bytes) {
            const img = await embedAny(pdf, bytes);
            if (img) {
              const scale = Math.min((W * 0.6) / img.width, (H * 0.6) / img.height);
              page.drawImage(img, { x: (W - img.width * scale) / 2, y: (H - img.height * scale) / 2, width: img.width * scale, height: img.height * scale, opacity });
            }
          }
        }
        if (wm.text?.trim()) {
          const size = wm.fontSize ?? 60;
          const font = fonts.get(defaultFamily, true, false);
          const text = sanitize(interpolate(wm.text, data), font);
          const tw = font.widthOfTextAtSize(text, size);
          const angle = ((wm.rotation ?? 45) * Math.PI) / 180;
          const x = W / 2 - (Math.cos(angle) * tw) / 2 + (Math.sin(angle) * size * 0.35);
          const y = H / 2 - (Math.sin(angle) * tw) / 2 - (Math.cos(angle) * size * 0.35);
          page.drawText(text, { x, y, size, font, color: rgb(0.5, 0.5, 0.5), opacity, rotate: degrees(wm.rotation ?? 45) });
        }
      });
    }
  }

  /* ---------- Phần tử lặp lại trên mọi trang */
  for (let i = 0; i < total; i++) {
    for (const el of repeatEls) {
      if (!isVisible(el)) continue;
      const g = geoms[i];
      const placed: PrintElement = { ...el, y: anchorY(el, g) };
      push(i, el.z ?? 0, (page, idx, tot) => drawElement(page, placed, g, idx, tot));
    }
  }

  /* ---------- Đánh số trang tự động */
  const pn = document.pageNumbering;
  if (pn?.show) {
    for (let i = 0; i < total; i++) {
      const g = geoms[i];
      const pos = String(pn.position ?? 'bottom-center');
      const top = pos.startsWith('top');
      const w = 60;
      const h = 6;
      const x = pos.endsWith('left') ? g.margins.left : pos.endsWith('right') ? g.widthMm - g.margins.right - w : (g.widthMm - w) / 2;
      const y = top ? Math.max(2, g.margins.top / 2 - h / 2) : g.heightMm - Math.max(h + 2, g.margins.bottom / 2 + h / 2);
      const format = pn.format || pn.label || 'Trang {page}/{pages}';
      const el: PrintElement = {
        id: `__pn_${i}`,
        type: 'pageNumber',
        x,
        y,
        w,
        h,
        text: format,
        style: { fontSize: 10, align: pos.endsWith('left') ? 'left' : pos.endsWith('right') ? 'right' : 'center', verticalAlign: 'middle' },
      };
      push(i, 1e6, (page, idx, tot) => drawElement(page, el, g, idx, tot));
    }
  }

  /* ---------- Thực thi theo trang → lớp → thứ tự khai báo */
  ops.sort((a, b) => a.page - b.page || a.z - b.z || a.order - b.order);
  for (const op of ops) {
    await op.run(pdfPages[op.page], op.page, total);
  }

  const bytes = await pdf.save();
  return {
    buffer: Buffer.from(bytes),
    pages: total,
    widthMm: geoms[0]?.widthMm ?? 210,
    heightMm: geoms[0]?.heightMm ?? 297,
  };
}

/* ------------------------------------------------------------- Ảnh / QR / mã vạch */

function decodeImage(src: string): Buffer | null {
  if (!src) return null;
  if (src.startsWith('data:') || /^[A-Za-z0-9+/=\s]{64,}$/.test(src)) {
    try {
      return Buffer.from(src.includes(',') ? src.split(',')[1] : src, 'base64');
    } catch {
      return null;
    }
  }
  return null;
}

async function embedAny(pdf: PDFDocument, bytes: Buffer) {
  try {
    const head = bytes.subarray(0, 4).toString('hex');
    if (head === '89504e47') return await pdf.embedPng(bytes);
    if (head.startsWith('ffd8')) return await pdf.embedJpg(bytes);
  } catch {
    return null;
  }
  return null;
}

async function drawImage(
  pdf: PDFDocument,
  page: PDFPage,
  el: PrintElement,
  box: { x: number; yTop: number; w: number; h: number },
  data: Record<string, unknown>,
  style: ElementStyle,
): Promise<void> {
  let bytes: Buffer | null = null;
  const bound = el.binding?.path ? getByPath(data, el.binding.path) : undefined;
  const src = typeof bound === 'string' && bound ? bound : el.image?.src ?? '';
  bytes = decodeImage(src);
  if (!bytes && el.image?.path) {
    const full = path.resolve(el.image.path);
    if (fs.existsSync(full)) bytes = fs.readFileSync(full);
  }
  if (bytes) {
    const img = await embedAny(pdf, bytes);
    if (img) {
      const fit = el.image?.fit ?? 'contain';
      const { x, yTop, w, h } = box;
      if (fit === 'fill') {
        page.drawImage(img, { x, y: yTop - h, width: w, height: h, opacity: style.opacity ?? 1 });
      } else {
        const scale = fit === 'cover' ? Math.max(w / img.width, h / img.height) : Math.min(w / img.width, h / img.height);
        const iw = img.width * scale;
        const ih = img.height * scale;
        if (fit === 'cover') page.pushOperators(pushGraphicsState(), rectangle(x, yTop - h, w, h), clip(), endPath());
        page.drawImage(img, { x: x + (w - iw) / 2, y: yTop - h + (h - ih) / 2, width: iw, height: ih, opacity: style.opacity ?? 1 });
        if (fit === 'cover') page.pushOperators(popGraphicsState());
      }
    }
  }
  drawBorders(page, style, box.x, box.yTop, box.w, box.h);
}

function drawQr(page: PDFPage, content: string, box: { x: number; yTop: number; w: number; h: number }, color: RGB, ec?: string): void {
  const level = (['L', 'M', 'Q', 'H'].includes(String(ec)) ? ec : 'M') as QRCode.QRCodeErrorCorrectionLevel;
  const qr = QRCode.create(content, { errorCorrectionLevel: level });
  const n = qr.modules.size;
  const quiet = 1;
  const side = Math.min(box.w, box.h);
  const cell = side / (n + quiet * 2);
  const ox = box.x + (box.w - side) / 2 + quiet * cell;
  const oyTop = box.yTop - (box.h - side) / 2 - quiet * cell;
  for (let r = 0; r < n; r++) {
    let c = 0;
    while (c < n) {
      if (!qr.modules.get(r, c)) {
        c++;
        continue;
      }
      let run = 1;
      while (c + run < n && qr.modules.get(r, c + run)) run++;
      page.drawRectangle({ x: ox + c * cell, y: oyTop - (r + 1) * cell, width: run * cell + 0.05, height: cell + 0.05, color });
      c += run;
    }
  }
}

function drawBarcode(
  page: PDFPage,
  content: string,
  box: { x: number; yTop: number; w: number; h: number },
  style: ElementStyle,
  fonts: FontBook,
  showText: boolean,
): void {
  const modules = code128Modules(content);
  const total = modules.reduce((s, m) => s + m, 0) + 20; // 10 module lề mỗi bên
  const unit = box.w / total;
  const textH = showText ? Math.min(box.h * 0.3, (style.fontSize ?? 9) * 1.25) : 0;
  const barH = box.h - textH;
  const color = colorOf(style.color, rgb(0, 0, 0));
  let cx = box.x + 10 * unit;
  modules.forEach((m, i) => {
    if (i % 2 === 0) page.drawRectangle({ x: cx, y: box.yTop - barH, width: m * unit, height: barH, color });
    cx += m * unit;
  });
  if (showText) {
    drawTextBox(page, { x: box.x, yTop: box.yTop - barH, w: box.w, h: textH }, content, { ...style, align: 'center', verticalAlign: 'middle', border: undefined, backgroundColor: undefined, fontSize: style.fontSize ?? 9 }, fonts);
  }
}

/**
 * Ô chữ ký: tiêu đề (dòng đầu đậm, các dòng sau nghiêng — vd "(Ký, ghi rõ họ tên)"),
 * khoảng trống để ký, họ tên in đậm ở đáy; tuỳ chọn dấu "Đã ký điện tử" + thời điểm ký.
 */
function drawSignature(
  page: PDFPage,
  el: PrintElement,
  box: { x: number; yTop: number; w: number; h: number },
  style: ElementStyle,
  fonts: FontBook,
  data: Record<string, unknown>,
): void {
  drawBackground(page, style, box.x, box.yTop, box.w, box.h);
  const size = style.fontSize ?? 12;
  const lh = size * (style.lineHeight ?? 1.25);
  const title = interpolate(String(el.text ?? (el.meta?.['title'] as string) ?? ''), data);
  const titleLines = title ? title.split('\n') : [];
  let y = box.yTop;
  titleLines.forEach((line, i) => {
    const st: ElementStyle = { ...style, align: style.align ?? 'center', bold: i === 0 ? true : style.bold, italic: i === 0 ? style.italic : true, fontSize: i === 0 ? size : size - 1, verticalAlign: 'top', border: undefined, backgroundColor: undefined, autoShrink: true, wrap: false };
    drawTextBox(page, { x: box.x, yTop: y, w: box.w, h: lh }, line, st, fonts);
    y -= lh;
  });
  const namePath = el.binding?.path ?? '';
  const name = namePath ? formatValue(getByPath(data, namePath), el.binding?.format) : '';
  const base = namePath.replace(/\.(fullName|name)$/, '');
  const signedTime = base && base !== namePath ? String(getByPath(data, `${base}.signedTime`) ?? getByPath(data, `${base}.signedAt`) ?? '') : '';
  const signed = base && base !== namePath ? getByPath(data, `${base}.signed`) === true : false;
  if (signed && el.meta?.['showStamp'] !== false) {
    const stampColor = '#1d4ed8';
    drawTextBox(page, { x: box.x, yTop: box.yTop - box.h / 2 + lh * 0.2, w: box.w, h: lh * 1.6 }, `Đã ký điện tử${signedTime ? `\n${signedTime}` : ''}`, { ...style, align: 'center', verticalAlign: 'middle', italic: true, bold: false, fontSize: Math.max(7, size - 3), color: stampColor, border: undefined, backgroundColor: undefined, lineHeight: 1.15 }, fonts);
  }
  if (name) {
    drawTextBox(page, { x: box.x, yTop: box.yTop - box.h + lh, w: box.w, h: lh }, name, { ...style, align: style.align ?? 'center', bold: true, verticalAlign: 'bottom', border: undefined, backgroundColor: undefined, wrap: false }, fonts);
  }
  drawBorders(page, style, box.x, box.yTop, box.w, box.h);
}
