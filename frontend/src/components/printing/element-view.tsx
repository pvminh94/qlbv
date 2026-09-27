'use client';

/**
 * Hiển thị một phần tử bản in trên khung vẽ theo đúng quy tắc của bộ render PDF:
 * cùng font (nạp từ máy chủ), cùng cỡ chữ (pt → px), giãn dòng, lề trong, viền, xoay…
 * Chế độ thiết kế (data = null) hiện tên trường {đường.dẫn}; chế độ dữ liệu mẫu hiện giá trị.
 */
import QRCode from 'qrcode';
import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { code128Modules } from '@/lib/code128';
import { cssFontFamily } from './print-fonts';
import { DATE_PATTERN_RE, formatDatePattern, formatValue, getByPath, interpolate } from './print-format';
import type { BorderSide, ElementStyle, PrintElement, TableColumnSpec } from './print-types';

/** 1 pt = 0.3528 mm */
export const PT_MM = 25.4 / 72;

export function borderCss(side: BorderSide | undefined, px: number): string | undefined {
  if (!side || side.style === 'none' || !side.width) return undefined;
  const w = Math.max(side.style === 'double' ? 3 : 1, side.width * px * (side.style === 'double' ? 3.5 : 1));
  return `${w}px ${side.style ?? 'solid'} ${side.color ?? '#000000'}`;
}

function textCss(style: ElementStyle, px: number): CSSProperties {
  return {
    fontFamily: cssFontFamily(style.fontFamily),
    fontSize: `${(style.fontSize ?? 12) * PT_MM * px}px`,
    fontWeight: style.bold ? 700 : 400,
    fontStyle: style.italic ? 'italic' : 'normal',
    textDecoration: [style.underline ? 'underline' : '', style.strike ? 'line-through' : ''].filter(Boolean).join(' ') || undefined,
    textAlign: style.align ?? 'left',
    textAlignLast: style.align === 'justify' ? 'left' : undefined,
    lineHeight: style.lineHeight ?? 1.35,
    letterSpacing: style.letterSpacing ? `${style.letterSpacing * PT_MM * px}px` : undefined,
    textTransform: style.textTransform && style.textTransform !== 'none' ? style.textTransform : undefined,
    color: style.color ?? '#000000',
    whiteSpace: style.wrap === false ? 'pre' : 'pre-wrap',
    overflowWrap: 'anywhere',
  };
}

/** Khối chữ trong hộp — tự thu nhỏ cỡ chữ cho vừa như bản in */
function TextBox({ text, style, px, className, fontsVersion }: { text: string; style: ElementStyle; px: number; className?: string; fontsVersion?: number }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const base = style.fontSize ?? 12;
  useLayoutEffect(() => {
    setScale(1);
  }, [text, base, px, style.fontFamily, style.wrap, style.lineHeight, fontsVersion]);
  useLayoutEffect(() => {
    if (style.autoShrink === false) return;
    const o = outer.current;
    const i = inner.current;
    if (!o || !i) return;
    const tooBig = i.scrollHeight > o.clientHeight + 1 || (style.wrap === false && i.scrollWidth > o.clientWidth + 1);
    if (tooBig && base * scale > 5) setScale((s) => Math.max(5 / base, s - 0.25 / base));
  }, [scale, text, base, px, style.autoShrink, style.wrap, fontsVersion]);
  const va = style.verticalAlign ?? 'top';
  return (
    <div
      ref={outer}
      className={className}
      style={{
        position: 'absolute',
        inset: 0,
        padding: `${(style.paddingY ?? 0) * px}px ${(style.paddingX ?? 0) * px}px`,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: va === 'middle' ? 'center' : va === 'bottom' ? 'flex-end' : 'flex-start',
        overflow: 'hidden',
      }}
    >
      <div ref={inner} style={{ ...textCss({ ...style, fontSize: base * scale }, px), overflow: 'hidden', flexShrink: 0 }}>
        {text || '\u200b'}
      </div>
    </div>
  );
}

function QrView({ value, color }: { value: string; color: string }) {
  const pathD = useMemo(() => {
    try {
      const qr = QRCode.create(value || ' ', { errorCorrectionLevel: 'M' });
      const n = qr.modules.size;
      let d = '';
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.modules.get(r, c)) d += `M${c + 1} ${r + 1}h1v1h-1z`;
      return { d, n: n + 2 };
    } catch {
      return { d: '', n: 10 };
    }
  }, [value]);
  return (
    <svg viewBox={`0 0 ${pathD.n} ${pathD.n}`} className="absolute inset-0 size-full" preserveAspectRatio="xMidYMid meet" shapeRendering="crispEdges">
      <path d={pathD.d} fill={color} />
    </svg>
  );
}

function BarcodeView({ value, style, px, showText }: { value: string; style: ElementStyle; px: number; showText: boolean }) {
  const modules = useMemo(() => code128Modules(value || ' '), [value]);
  const total = modules.reduce((s, m) => s + m, 0) + 20;
  let x = 10;
  const bars: { x: number; w: number }[] = [];
  modules.forEach((m, i) => {
    if (i % 2 === 0) bars.push({ x, w: m });
    x += m;
  });
  const fontPx = (style.fontSize ?? 9) * PT_MM * px;
  return (
    <div className="absolute inset-0 flex flex-col">
      <svg viewBox={`0 0 ${total} 10`} preserveAspectRatio="none" className="min-h-0 w-full flex-1" shapeRendering="crispEdges">
        {bars.map((b, i) => (
          <rect key={i} x={b.x} y={0} width={b.w} height={10} fill={style.color ?? '#000'} />
        ))}
      </svg>
      {showText ? (
        <div style={{ fontFamily: cssFontFamily(style.fontFamily), fontSize: fontPx, lineHeight: 1.25, textAlign: 'center', color: style.color ?? '#000' }}>{value}</div>
      ) : null}
    </div>
  );
}

function sampleColumnValue(col: TableColumnSpec, row: Record<string, unknown> | null, index: number): string {
  const b = col.binding;
  if (!b) return '';
  if (b.source === 'index' || (b.path === 'index' && b.source !== 'row')) return String(index + 1);
  if (!row) return b.path ? `{${b.path}}` : '';
  return formatValue(getByPath(row, b.path ?? ''), b.format);
}

function TableView({ el, style, px, data }: { el: PrintElement; style: ElementStyle; px: number; data: Record<string, unknown> | null }) {
  const spec = el.table;
  let columns = spec?.columns ?? [];
  if (spec?.showIndex && !columns.some((c) => c.binding?.source === 'index' || c.binding?.path === 'index')) {
    columns = [{ id: '__idx', title: 'STT', width: 10, align: 'center', binding: { source: 'index' } }, ...columns];
  }
  const total = columns.reduce((s, c) => s + (Number(c.width) || 1), 0) || 1;
  const fs = style.fontSize ?? 11;
  const rowsData = data ? (getByPath(data, spec?.dataSource || 'rows') as Record<string, unknown>[] | undefined) : undefined;
  const minRow = spec?.minRowHeight ?? 6;
  const headerStyle: ElementStyle = { ...style, bold: true, align: 'center', ...spec?.headerStyle, fontSize: spec?.headerStyle?.fontSize ?? fs };
  const bodyStyle: ElementStyle = { ...style, ...spec?.bodyStyle, fontSize: spec?.bodyStyle?.fontSize ?? fs };
  const border = (s: ElementStyle, fallback: string, w: number) => borderCss(s.border?.top ?? { width: w, style: 'solid', color: fallback }, px);
  const rowCount = Math.max(1, rowsData ? Math.min(rowsData.length, 30) : Math.max(1, Math.floor((el.h - minRow - 1) / minRow)));
  const cell = (s: ElementStyle, align: string | undefined, bg?: string): CSSProperties => ({
    ...textCss({ ...s, align: (align as ElementStyle['align']) ?? s.align }, px),
    padding: `${0.6 * px}px ${1 * px}px`,
    border: border(s, '#000000', 0.2),
    background: bg ?? s.backgroundColor,
    verticalAlign: 'middle',
  });
  return (
    <table className="absolute left-0 top-0 w-full border-collapse" style={{ tableLayout: 'fixed' }}>
      <colgroup>
        {columns.map((c) => (
          <col key={c.id} style={{ width: `${((Number(c.width) || 1) / total) * 100}%` }} />
        ))}
      </colgroup>
      <thead>
        <tr style={{ height: (minRow + 1) * px }}>
          {columns.map((c) => (
            <th key={c.id} style={cell({ ...headerStyle, ...(c.style ?? {}) }, 'center', headerStyle.backgroundColor ?? '#f1f5f9')}>
              {c.title}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {Array.from({ length: rowCount }, (_, i) => (
          <tr key={i} style={{ height: minRow * px }}>
            {columns.map((c) => (
              <td key={c.id} style={cell({ ...bodyStyle, ...(c.style ?? {}) }, c.align, spec?.zebra && i % 2 === 1 ? '#f5f7fa' : undefined)}>
                {sampleColumnValue(c, rowsData?.[i] ?? null, i)}
              </td>
            ))}
          </tr>
        ))}
        {spec?.totalRow ? (
          <tr style={{ height: minRow * px }}>
            {columns.map((c, i) => (
              <td key={c.id} style={cell({ ...bodyStyle, bold: true }, c.align, '#f1f5f9')}>
                {i === (columns[0]?.id === '__idx' || columns[0]?.binding?.source === 'index' ? 1 : 0) ? 'Tổng cộng' : ''}
              </td>
            ))}
          </tr>
        ) : null}
      </tbody>
    </table>
  );
}

export interface ElementViewProps {
  el: PrintElement;
  style: ElementStyle;
  px: number;
  data: Record<string, unknown> | null;
  page: number;
  pages: number;
  fontsVersion?: number;
}

/** Nội dung bên trong hộp phần tử (hộp ngoài do khung vẽ định vị) */
export function ElementView({ el, style, px, data, page, pages, fontsVersion }: ElementViewProps) {
  const withPages = (s: string) => s.replace(/\{page\}/g, String(page)).replace(/\{(pages|total)\}/g, String(pages));
  const boundValue = (): string => {
    const p = el.binding?.path ?? '';
    if (!data) return p ? `{${p}}` : '';
    return formatValue(getByPath(data, p), el.binding?.format);
  };
  const boxStyle: CSSProperties = {
    position: 'absolute',
    inset: 0,
    background: style.backgroundColor,
    borderTop: borderCss(style.border?.top, px),
    borderRight: borderCss(style.border?.right, px),
    borderBottom: borderCss(style.border?.bottom, px),
    borderLeft: borderCss(style.border?.left, px),
    borderRadius: (style.borderRadius ?? 0) * px,
    opacity: style.opacity ?? 1,
  };
  const tb = (text: string) => <TextBox text={text} style={style} px={px} fontsVersion={fontsVersion} />;

  switch (el.type) {
    case 'text':
      return <div style={boxStyle}>{tb(interpolate(withPages(el.text ?? ''), data))}</div>;
    case 'field': {
      const v = boundValue();
      const label = String(el.meta?.label ?? '');
      return <div style={boxStyle}>{tb(v || interpolate(label, data))}</div>;
    }
    case 'pageNumber':
      return <div style={boxStyle}>{tb(interpolate(withPages(String(el.text || el.meta?.label || 'Trang {page}/{pages}')), data))}</div>;
    case 'datetime': {
      const pattern = el.text ?? '';
      const text =
        pattern && !pattern.includes('{') && DATE_PATTERN_RE.test(pattern)
          ? formatDatePattern(new Date(), pattern)
          : interpolate(withPages(pattern || String(el.meta?.label ?? '{system.datetime}')), data ?? { system: { datetime: formatDatePattern(new Date(), 'dd/MM/yyyy HH:mm') } });
      return <div style={boxStyle}>{tb(text)}</div>;
    }
    case 'line': {
      const side = style.border?.top ?? style.border?.bottom ?? { width: 0.3, style: 'solid', color: style.color ?? '#000' };
      const vertical = el.h > el.w;
      const css = borderCss({ ...side, color: side.color ?? style.color }, px) ?? `1px solid ${style.color ?? '#000'}`;
      return (
        <div className="absolute inset-0 flex items-center justify-center" style={{ opacity: style.opacity ?? 1 }}>
          <div style={vertical ? { height: '100%', borderLeft: css } : { width: '100%', borderTop: css }} />
        </div>
      );
    }
    case 'rect': {
      const legacy = el.style?.border === undefined;
      const s = legacy ? `${Math.max(1, 0.3 * px)}px solid ${el.style?.color ?? '#000'}` : undefined;
      return (
        <div style={{ ...boxStyle, ...(legacy ? { border: s } : {}) }}>
          {el.text ? tb(interpolate(el.text, data)) : null}
        </div>
      );
    }
    case 'image': {
      const src = el.image?.src ?? '';
      const ok = src.startsWith('data:') || /^https?:|^\//.test(src);
      return (
        <div style={boxStyle}>
          {ok ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={src} alt="" draggable={false} className="absolute inset-0 size-full" style={{ objectFit: el.image?.fit ?? 'contain' }} />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center border border-dashed border-slate-300 bg-slate-50 text-[10px] text-slate-400">
              Ảnh / Logo
            </div>
          )}
        </div>
      );
    }
    case 'qrcode': {
      const v = data ? boundValue() || interpolate(el.text ?? '', data) : el.binding?.path ? `QLBS:${el.binding.path}` : el.text || 'QLBS';
      return (
        <div style={boxStyle}>
          <QrView value={v} color={style.color ?? '#000'} />
        </div>
      );
    }
    case 'barcode': {
      const v = data ? boundValue() || interpolate(el.text ?? '', data) : el.binding?.path ? '{' + el.binding.path + '}' : el.text || '123456';
      return (
        <div style={boxStyle}>
          <BarcodeView value={v} style={style} px={px} showText={el.meta?.showText !== false} />
        </div>
      );
    }
    case 'signature': {
      const title = interpolate(String(el.text ?? el.meta?.title ?? ''), data);
      const lines = title ? title.split('\n') : [];
      const name = boundValue();
      const fontPx = (style.fontSize ?? 12) * PT_MM * px;
      const lh = style.lineHeight ?? 1.25;
      const base = (el.binding?.path ?? '').replace(/\.(fullName|name)$/, '');
      const signed = data && base ? getByPath(data, `${base}.signed`) === true : false;
      const signedTime = data && base ? String(getByPath(data, `${base}.signedTime`) ?? getByPath(data, `${base}.signedAt`) ?? '') : '';
      const common: CSSProperties = { fontFamily: cssFontFamily(style.fontFamily), color: style.color ?? '#000', textAlign: style.align ?? 'center', lineHeight: lh, whiteSpace: 'nowrap', overflow: 'hidden' };
      return (
        <div style={boxStyle}>
          {lines.map((l, i) => (
            <div key={i} style={{ ...common, fontSize: i === 0 ? fontPx : fontPx * ((style.fontSize ?? 12) - 1) / (style.fontSize ?? 12), fontWeight: i === 0 ? 700 : style.bold ? 700 : 400, fontStyle: i === 0 ? (style.italic ? 'italic' : 'normal') : 'italic' }}>
              {l}
            </div>
          ))}
          {signed && el.meta?.showStamp !== false ? (
            <div className="absolute inset-x-0" style={{ ...common, top: '50%', transform: 'translateY(-40%)', fontSize: fontPx * 0.78, fontStyle: 'italic', color: '#1d4ed8', whiteSpace: 'pre', lineHeight: 1.15 }}>
              {`Đã ký điện tử${signedTime ? `\n${signedTime}` : ''}`}
            </div>
          ) : !data ? (
            <div className="absolute inset-x-2 top-1/2 border-b border-dashed border-slate-300" />
          ) : null}
          <div className="absolute inset-x-0 bottom-0" style={{ ...common, fontSize: fontPx, fontWeight: 700 }}>
            {name}
          </div>
        </div>
      );
    }
    case 'table':
      return (
        <div style={{ ...boxStyle, overflow: 'hidden' }}>
          <TableView el={el} style={style} px={px} data={data} />
        </div>
      );
    default:
      return <div style={boxStyle}>{tb(interpolate(el.text ?? '', data))}</div>;
  }
}
