'use client';

/**
 * Khung vẽ bản in chuyên nghiệp:
 *  - Thước đo mm ngang/dọc, lưới, lề, watermark, đánh số trang — hiển thị đúng như PDF.
 *  - Chọn nhiều (Shift/Ctrl + bấm, hoặc kéo khung chọn), kéo di chuyển cả nhóm, 8 tay nắm đổi kích thước.
 *  - Đường gióng thông minh (smart guides): tự hít vào mép/tâm phần tử khác, lề và tâm trang.
 *    Giữ Alt khi kéo để tắt hít.
 *  - Nhấp đúp để sửa chữ trực tiếp trên trang; kéo thả phần tử/trường dữ liệu từ cột trái vào trang.
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Lock, Repeat } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ElementView, PT_MM } from './element-view';
import { cssFontFamily } from './print-fonts';
import { paperDimensions, type ElementStyle, type PrintDocument, type PrintElement } from './print-types';

export const DND_MIME = 'application/x-qlbs-print';

export interface CanvasElement extends PrintElement {
  /** Phần tử tiêu đề/chân trang cấp tài liệu (lặp mọi trang) */
  __band?: 'header' | 'footer';
}

interface Props {
  doc: PrintDocument;
  pageIndex: number;
  pageCount: number;
  elements: CanvasElement[];
  selectedIds: string[];
  setSelection: (ids: string[]) => void;
  onPatch: (patches: Record<string, Partial<PrintElement>>) => void;
  onCommit: () => void;
  zoom: number;
  setZoom: (z: number) => void;
  showGrid: boolean;
  snap: boolean;
  showRulers: boolean;
  smartGuides: boolean;
  data: Record<string, unknown> | null;
  fontsVersion: number;
  readOnly?: boolean;
  onDropCreate: (payload: string, xMm: number, yMm: number) => void;
  onContextMenu: (e: React.MouseEvent, id: string | null) => void;
  onCursor: (pos: { x: number; y: number } | null) => void;
  editingId: string | null;
  setEditingId: (id: string | null) => void;
  /** Chiều rộng vùng nhìn (để “vừa trang”) */
  onViewport?: (size: { width: number; height: number }) => void;
}

const BASE_PX_PER_MM = 96 / 25.4; // 100% = đúng kích thước thật trên màn hình 96 dpi
const RULER = 22;
const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;
type Handle = (typeof HANDLES)[number];

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

type DragState =
  | { mode: 'move'; startX: number; startY: number; origins: Record<string, Box>; bbox: Box; moved: boolean }
  | { mode: 'resize'; id: string; handle: Handle; startX: number; startY: number; origin: Box; ratio: number }
  | { mode: 'marquee'; startX: number; startY: number; x0: number; y0: number; additive: boolean; base: string[] };

const EDITABLE_TEXT = new Set(['text', 'signature', 'rect', 'datetime', 'pageNumber']);

export function DesignerCanvas(props: Props) {
  const {
    doc,
    pageIndex,
    pageCount,
    elements,
    selectedIds,
    setSelection,
    onPatch,
    onCommit,
    zoom,
    showGrid,
    snap,
    showRulers,
    smartGuides,
    data,
    fontsVersion,
    readOnly,
  } = props;
  const scrollRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [guides, setGuides] = useState<{ v: number[]; h: number[] }>({ v: [], h: [] });
  const [marquee, setMarquee] = useState<Box | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [dropHint, setDropHint] = useState(false);

  const page = doc.pages?.[pageIndex];
  const dims = paperDimensions({
    paperSize: page?.paperSize ?? doc.paperSize,
    orientation: page?.orientation ?? doc.orientation,
    customSize: doc.customSize,
  });
  const margins = page?.margins ?? doc.margins;
  const px = BASE_PX_PER_MM * zoom;
  const gridSize = doc.grid?.size ?? 5;

  /** y hiển thị: phần tử neo chân trang có y âm (tính từ đáy trang) */
  const viewY = (el: PrintElement): number => (el.anchor === 'footer' && el.y < 0 ? dims.height + el.y : el.anchor === 'header' && el.y < 0 ? -el.y : el.y);
  const storeY = (el: PrintElement, y: number): number => (el.anchor === 'footer' && el.y < 0 ? y - dims.height : el.anchor === 'header' && el.y < 0 ? -y : y);

  const boxes = useMemo(() => {
    const m: Record<string, Box> = {};
    elements.forEach((el) => {
      m[el.id] = { x: el.x, y: viewY(el), w: el.w, h: el.h };
    });
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elements, dims.height]);

  const byId = useMemo(() => Object.fromEntries(elements.map((e) => [e.id, e])), [elements]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !props.onViewport) return;
    const ro = new ResizeObserver(() => props.onViewport?.({ width: el.clientWidth - RULER - 48, height: el.clientHeight - RULER - 48 }));
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ctrl + lăn chuột để thu phóng
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const next = Math.min(4, Math.max(0.25, +(zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1)).toFixed(3)));
      props.setZoom(next);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom]);

  const toMm = (clientX: number, clientY: number): { x: number; y: number } => {
    const r = pageRef.current?.getBoundingClientRect();
    if (!r) return { x: 0, y: 0 };
    return { x: (clientX - r.left) / px, y: (clientY - r.top) / px };
  };

  const round = (v: number) => Math.round(v * 10) / 10;
  const gridSnap = (v: number) => (snap ? Math.round(v / gridSize) * gridSize : round(v));

  /** Mốc gióng: mép & tâm các phần tử không được chọn + lề + tâm trang */
  const targets = useMemo(() => {
    const vx: number[] = [margins.left, dims.width - margins.right, dims.width / 2, 0, dims.width];
    const hy: number[] = [margins.top, dims.height - margins.bottom, dims.height / 2, 0, dims.height];
    elements.forEach((el) => {
      if (selectedIds.includes(el.id) || el.meta?.hidden === true) return;
      const b = boxes[el.id];
      vx.push(b.x, b.x + b.w / 2, b.x + b.w);
      hy.push(b.y, b.y + b.h / 2, b.y + b.h);
    });
    return { vx, hy };
  }, [elements, selectedIds, boxes, margins, dims]);

  const snapAxis = (cands: number[], list: number[], thr: number): { delta: number; at: number } | null => {
    let best: { delta: number; at: number } | null = null;
    for (const c of cands) {
      for (const t of list) {
        const d = t - c;
        if (Math.abs(d) <= thr && (!best || Math.abs(d) < Math.abs(best.delta))) best = { delta: d, at: t };
      }
    }
    return best;
  };

  useEffect(() => {
    if (!drag) return;
    const thr = 6 / px;
    const onMove = (e: PointerEvent) => {
      const dx = (e.clientX - drag.startX) / px;
      const dy = (e.clientY - drag.startY) / px;
      const useSmart = smartGuides && !e.altKey;
      if (drag.mode === 'marquee') {
        const p = toMm(e.clientX, e.clientY);
        const box = { x: Math.min(p.x, drag.x0), y: Math.min(p.y, drag.y0), w: Math.abs(p.x - drag.x0), h: Math.abs(p.y - drag.y0) };
        setMarquee(box);
        const hit = elements
          .filter((el) => {
            const b = boxes[el.id];
            return b.x < box.x + box.w && b.x + b.w > box.x && b.y < box.y + box.h && b.y + b.h > box.y;
          })
          .map((el) => el.id);
        setSelection(drag.additive ? Array.from(new Set([...drag.base, ...hit])) : hit);
        return;
      }
      if (drag.mode === 'move') {
        if (!drag.moved && Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < 3) return;
        const bb = drag.bbox;
        let nx = bb.x + dx;
        let ny = bb.y + dy;
        const gv: number[] = [];
        const gh: number[] = [];
        const sx = useSmart ? snapAxis([nx, nx + bb.w / 2, nx + bb.w], targets.vx, thr) : null;
        const sy = useSmart ? snapAxis([ny, ny + bb.h / 2, ny + bb.h], targets.hy, thr) : null;
        if (sx) {
          nx += sx.delta;
          gv.push(sx.at);
        } else if (!e.altKey) nx = gridSnap(nx);
        if (sy) {
          ny += sy.delta;
          gh.push(sy.at);
        } else if (!e.altKey) ny = gridSnap(ny);
        const ddx = nx - bb.x;
        const ddy = ny - bb.y;
        setGuides({ v: gv, h: gh });
        const patches: Record<string, Partial<PrintElement>> = {};
        Object.entries(drag.origins).forEach(([id, o]) => {
          const el = byId[id];
          if (!el) return;
          patches[id] = { x: round(o.x + ddx), y: round(storeY(el, o.y + ddy)) };
        });
        if (!drag.moved) setDrag({ ...drag, moved: true });
        onPatch(patches);
        return;
      }
      // resize
      const o = drag.origin;
      const h = drag.handle;
      let x1 = o.x;
      let y1 = o.y;
      let x2 = o.x + o.w;
      let y2 = o.y + o.h;
      if (h.includes('w')) x1 = o.x + dx;
      if (h.includes('e')) x2 = o.x + o.w + dx;
      if (h.includes('n')) y1 = o.y + dy;
      if (h.includes('s')) y2 = o.y + o.h + dy;
      const gv: number[] = [];
      const gh: number[] = [];
      const snapEdge = (v: number, list: number[], out: number[]) => {
        if (e.altKey) return v;
        const s = useSmart ? snapAxis([v], list, thr) : null;
        if (s) {
          out.push(s.at);
          return v + s.delta;
        }
        return gridSnap(v);
      };
      if (h.includes('w')) x1 = snapEdge(x1, targets.vx, gv);
      if (h.includes('e')) x2 = snapEdge(x2, targets.vx, gv);
      if (h.includes('n')) y1 = snapEdge(y1, targets.hy, gh);
      if (h.includes('s')) y2 = snapEdge(y2, targets.hy, gh);
      const minS = 0.4;
      if (x2 - x1 < minS) {
        if (h.includes('w')) x1 = x2 - minS;
        else x2 = x1 + minS;
      }
      if (y2 - y1 < minS) {
        if (h.includes('n')) y1 = y2 - minS;
        else y2 = y1 + minS;
      }
      // Shift: giữ tỉ lệ (góc)
      if (e.shiftKey && h.length === 2 && drag.ratio > 0) {
        const w = x2 - x1;
        const hh = w / drag.ratio;
        if (h.includes('n')) y1 = y2 - hh;
        else y2 = y1 + hh;
      }
      setGuides({ v: gv, h: gh });
      const el = byId[drag.id];
      if (el) onPatch({ [drag.id]: { x: round(x1), y: round(storeY(el, y1)), w: round(x2 - x1), h: round(y2 - y1) } });
    };
    const onUp = () => {
      const wasEdit = drag.mode === 'resize' || (drag.mode === 'move' && drag.moved);
      setDrag(null);
      setGuides({ v: [], h: [] });
      setMarquee(null);
      if (wasEdit) onCommit();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag, px, snap, gridSize, smartGuides, targets, boxes]);

  const startMove = (e: React.PointerEvent, el: CanvasElement) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    if (props.editingId === el.id) return;
    let sel = selectedIds;
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      sel = selectedIds.includes(el.id) ? selectedIds.filter((i) => i !== el.id) : [...selectedIds, el.id];
      setSelection(sel);
      return;
    }
    if (!selectedIds.includes(el.id)) {
      sel = [el.id];
      setSelection(sel);
    }
    if (readOnly) return;
    const movable = sel.filter((id) => byId[id] && !byId[id].locked);
    if (!movable.length) return;
    const origins: Record<string, Box> = {};
    movable.forEach((id) => (origins[id] = boxes[id]));
    const xs = movable.map((id) => boxes[id]);
    const bx = Math.min(...xs.map((b) => b.x));
    const by = Math.min(...xs.map((b) => b.y));
    const bbox = { x: bx, y: by, w: Math.max(...xs.map((b) => b.x + b.w)) - bx, h: Math.max(...xs.map((b) => b.y + b.h)) - by };
    setDrag({ mode: 'move', startX: e.clientX, startY: e.clientY, origins, bbox, moved: false });
  };

  const startResize = (e: React.PointerEvent, el: CanvasElement, handle: Handle) => {
    e.stopPropagation();
    e.preventDefault();
    if (readOnly || el.locked) return;
    const b = boxes[el.id];
    setDrag({ mode: 'resize', id: el.id, handle, startX: e.clientX, startY: e.clientY, origin: b, ratio: b.h ? b.w / b.h : 0 });
  };

  const startMarquee = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const p = toMm(e.clientX, e.clientY);
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    if (!additive) setSelection([]);
    props.setEditingId(null);
    setDrag({ mode: 'marquee', startX: e.clientX, startY: e.clientY, x0: p.x, y0: p.y, additive, base: selectedIds });
  };

  const baseStyle = (el: PrintElement): ElementStyle => ({
    fontFamily: doc.defaultStyle?.fontFamily,
    fontSize: doc.defaultStyle?.fontSize ?? 12,
    lineHeight: doc.defaultStyle?.lineHeight ?? 1.35,
    color: doc.defaultStyle?.color,
    ...(el.style ?? {}),
  });

  const single = selectedIds.length === 1 ? byId[selectedIds[0]] : null;
  const selBox = useMemo(() => {
    const bs = selectedIds.map((id) => boxes[id]).filter(Boolean);
    if (bs.length < 2) return null;
    const x = Math.min(...bs.map((b) => b.x));
    const y = Math.min(...bs.map((b) => b.y));
    return { x, y, w: Math.max(...bs.map((b) => b.x + b.w)) - x, h: Math.max(...bs.map((b) => b.y + b.h)) - y };
  }, [selectedIds, boxes]);

  const wm = doc.watermark;
  const pn = doc.pageNumbering;

  return (
    <div
      ref={scrollRef}
      className="relative min-h-0 flex-1 overflow-auto bg-[#e5e7eb] dark:bg-slate-800"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) {
          setSelection([]);
          props.setEditingId(null);
        }
      }}
    >
      <div className="flex min-h-full min-w-max justify-center p-6" onPointerDown={(e) => { if (e.target === e.currentTarget) { setSelection([]); props.setEditingId(null); } }}>
        <div className="relative" style={{ paddingLeft: showRulers ? RULER : 0, paddingTop: showRulers ? RULER : 0 }}>
          {showRulers ? (
            <>
              <div className="sticky top-0 z-20 -mt-[22px] mb-0 flex" style={{ height: RULER, marginLeft: -RULER }}>
                <div className="shrink-0 border-b border-r border-slate-300 bg-slate-100" style={{ width: RULER, height: RULER }} />
                <Ruler axis="x" lengthMm={dims.width} px={px} marginA={margins.left} marginB={margins.right} cursor={cursor?.x} />
              </div>
              <div className="sticky left-0 z-10 float-left" style={{ width: RULER, marginLeft: -RULER, height: dims.height * px }}>
                <Ruler axis="y" lengthMm={dims.height} px={px} marginA={margins.top} marginB={margins.bottom} cursor={cursor?.y} />
              </div>
            </>
          ) : null}

          {/* Trang giấy */}
          <div
            ref={pageRef}
            data-testid="print-page"
            className={cn('relative bg-white shadow-[0_2px_12px_rgba(0,0,0,0.25)]', dropHint && 'ring-4 ring-sky-400/60')}
            style={{
              width: dims.width * px,
              height: dims.height * px,
              backgroundImage: showGrid
                ? `linear-gradient(to right, rgba(148,163,184,0.22) 1px, transparent 1px), linear-gradient(to bottom, rgba(148,163,184,0.22) 1px, transparent 1px)`
                : undefined,
              backgroundSize: showGrid ? `${gridSize * px}px ${gridSize * px}px` : undefined,
            }}
            onPointerDown={startMarquee}
            onPointerMove={(e) => {
              const p = toMm(e.clientX, e.clientY);
              setCursor(p);
              props.onCursor(p);
            }}
            onPointerLeave={() => {
              setCursor(null);
              props.onCursor(null);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              props.onContextMenu(e, null);
            }}
            onDragOver={(e) => {
              if (Array.from(e.dataTransfer.types).includes(DND_MIME)) {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'copy';
                setDropHint(true);
              }
            }}
            onDragLeave={() => setDropHint(false)}
            onDrop={(e) => {
              setDropHint(false);
              const payload = e.dataTransfer.getData(DND_MIME);
              if (!payload) return;
              e.preventDefault();
              const p = toMm(e.clientX, e.clientY);
              props.onDropCreate(payload, gridSnap(p.x), gridSnap(p.y));
            }}
          >
            {/* Watermark */}
            {wm?.text?.trim() ? (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden">
                <div
                  style={{
                    transform: `rotate(${-(wm.rotation ?? 45)}deg)`,
                    fontFamily: cssFontFamily(doc.defaultStyle?.fontFamily),
                    fontWeight: 700,
                    fontSize: (wm.fontSize ?? 60) * PT_MM * px,
                    color: `rgba(128,128,128,${wm.opacity ?? 0.08})`,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {wm.text}
                </div>
              </div>
            ) : null}

            {/* Lề */}
            <div
              className="pointer-events-none absolute border border-dashed border-rose-400/60"
              style={{
                left: margins.left * px,
                top: margins.top * px,
                width: (dims.width - margins.left - margins.right) * px,
                height: (dims.height - margins.top - margins.bottom) * px,
              }}
            />

            {/* Số trang tự động */}
            {pn?.show ? <AutoPageNumber doc={doc} dims={dims} margins={margins} px={px} page={pageIndex + 1} pages={pageCount} /> : null}

            {[...elements]
              .sort((a, b) => (a.z ?? 0) - (b.z ?? 0))
              .map((el) => {
                const b = boxes[el.id];
                const isSel = selectedIds.includes(el.id);
                const hidden = el.meta?.hidden === true;
                const editing = props.editingId === el.id;
                const style = baseStyle(el);
                const wrapper: CSSProperties = {
                  left: b.x * px,
                  top: b.y * px,
                  width: Math.max(2, b.w * px),
                  height: Math.max(2, b.h * px),
                  transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
                  opacity: hidden ? 0.35 : undefined,
                };
                return (
                  <div
                    key={el.id}
                    data-el-id={el.id}
                    className={cn(
                      'group absolute',
                      el.locked ? 'cursor-default' : 'cursor-move',
                      !isSel && 'hover:outline hover:outline-1 hover:outline-sky-400/80',
                      isSel && 'outline outline-1 outline-sky-500',
                      el.__band && !isSel && 'outline-dashed outline-1 outline-violet-300',
                    )}
                    style={wrapper}
                    onPointerDown={(e) => startMove(e, el)}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      if (!readOnly && EDITABLE_TEXT.has(el.type) && !el.locked) props.setEditingId(el.id);
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (!selectedIds.includes(el.id)) setSelection([el.id]);
                      props.onContextMenu(e, el.id);
                    }}
                  >
                    {editing ? (
                      <InlineEditor
                        el={el}
                        style={style}
                        px={px}
                        onDone={(text) => {
                          props.setEditingId(null);
                          if (text !== null && text !== (el.text ?? '')) {
                            onPatch({ [el.id]: { text } });
                            onCommit();
                          }
                        }}
                      />
                    ) : (
                      <ElementView el={el} style={style} px={px} data={data} page={pageIndex + 1} pages={pageCount} fontsVersion={fontsVersion} />
                    )}
                    {el.locked && isSel ? (
                      <span className="absolute -left-2 -top-2 rounded bg-slate-700 p-0.5 text-white">
                        <Lock className="size-2.5" />
                      </span>
                    ) : null}
                    {el.__band || el.repeatOnEveryPage ? (
                      <span className="pointer-events-none absolute -right-1.5 -top-1.5 hidden rounded bg-violet-500 p-0.5 text-white group-hover:block" title="Lặp lại mọi trang">
                        <Repeat className="size-2.5" />
                      </span>
                    ) : null}
                    {single?.id === el.id && !el.locked && !readOnly && !editing
                      ? HANDLES.map((h) => (
                          <span
                            key={h}
                            onPointerDown={(e) => startResize(e, el, h)}
                            className="absolute z-10 size-2 border border-sky-600 bg-white"
                            style={handleStyle(h)}
                          />
                        ))
                      : null}
                  </div>
                );
              })}

            {selBox ? (
              <div
                className="pointer-events-none absolute border border-dashed border-sky-600"
                style={{ left: selBox.x * px - 2, top: selBox.y * px - 2, width: selBox.w * px + 4, height: selBox.h * px + 4 }}
              />
            ) : null}

            {/* Thông tin kích thước khi kéo */}
            {drag && drag.mode !== 'marquee' && single ? (
              <div
                className="pointer-events-none absolute z-30 whitespace-nowrap rounded bg-slate-900/85 px-1.5 py-0.5 text-[10px] tabular-nums text-white"
                style={{ left: boxes[single.id].x * px, top: boxes[single.id].y * px - 20 }}
              >
                X {boxes[single.id].x.toFixed(1)} · Y {boxes[single.id].y.toFixed(1)} · {boxes[single.id].w.toFixed(1)} × {boxes[single.id].h.toFixed(1)} mm
              </div>
            ) : null}

            {guides.v.map((x, i) => (
              <div key={`v${i}`} className="pointer-events-none absolute top-0 z-30 h-full w-px bg-fuchsia-500" style={{ left: x * px }} />
            ))}
            {guides.h.map((y, i) => (
              <div key={`h${i}`} className="pointer-events-none absolute left-0 z-30 h-px w-full bg-fuchsia-500" style={{ top: y * px }} />
            ))}
            {marquee ? (
              <div
                className="pointer-events-none absolute z-30 border border-sky-500 bg-sky-400/10"
                style={{ left: marquee.x * px, top: marquee.y * px, width: marquee.w * px, height: marquee.h * px }}
              />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function handleStyle(h: Handle): CSSProperties {
  const s: CSSProperties = {};
  if (h.includes('n')) s.top = -4;
  if (h.includes('s')) s.bottom = -4;
  if (h.includes('w')) s.left = -4;
  if (h.includes('e')) s.right = -4;
  if (h === 'n' || h === 's') {
    s.left = '50%';
    s.marginLeft = -4;
  }
  if (h === 'e' || h === 'w') {
    s.top = '50%';
    s.marginTop = -4;
  }
  s.cursor = h === 'n' || h === 's' ? 'ns-resize' : h === 'e' || h === 'w' ? 'ew-resize' : h === 'nw' || h === 'se' ? 'nwse-resize' : 'nesw-resize';
  return s;
}

function AutoPageNumber({ doc, dims, margins, px, page, pages }: { doc: PrintDocument; dims: { width: number; height: number }; margins: { top: number; right: number; bottom: number; left: number }; px: number; page: number; pages: number }) {
  const pn = doc.pageNumbering;
  const pos = String(pn?.position ?? 'bottom-center');
  const w = 60;
  const h = 6;
  const x = pos.endsWith('left') ? margins.left : pos.endsWith('right') ? dims.width - margins.right - w : (dims.width - w) / 2;
  const y = pos.startsWith('top') ? Math.max(2, margins.top / 2 - h / 2) : dims.height - Math.max(h + 2, margins.bottom / 2 + h / 2);
  const text = String(pn?.format || pn?.label || 'Trang {page}/{pages}').replace(/\{page\}/g, String(page)).replace(/\{(pages|total)\}/g, String(pages));
  return (
    <div
      className="pointer-events-none absolute flex items-center text-slate-700"
      style={{
        left: x * px,
        top: y * px,
        width: w * px,
        height: h * px,
        justifyContent: pos.endsWith('left') ? 'flex-start' : pos.endsWith('right') ? 'flex-end' : 'center',
        fontFamily: cssFontFamily(doc.defaultStyle?.fontFamily),
        fontSize: 10 * PT_MM * px,
      }}
    >
      {text}
    </div>
  );
}

function InlineEditor({ el, style, px, onDone }: { el: PrintElement; style: ElementStyle; px: number; onDone: (text: string | null) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState(el.text ?? '');
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onPointerDown={(e) => e.stopPropagation()}
      onBlur={() => onDone(value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') onDone(null);
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) onDone(value);
      }}
      className="absolute inset-0 z-20 resize-none bg-sky-50/95 outline outline-2 outline-sky-500"
      style={{
        fontFamily: cssFontFamily(style.fontFamily),
        fontSize: (style.fontSize ?? 12) * PT_MM * px,
        fontWeight: style.bold ? 700 : 400,
        fontStyle: style.italic ? 'italic' : 'normal',
        textAlign: style.align === 'justify' ? 'justify' : (style.align ?? 'left'),
        lineHeight: style.lineHeight ?? 1.35,
        padding: `${(style.paddingY ?? 0) * px}px ${(style.paddingX ?? 0) * px}px`,
        color: style.color ?? '#000',
        minHeight: 24,
      }}
    />
  );
}

function Ruler({ axis, lengthMm, px, marginA, marginB, cursor }: { axis: 'x' | 'y'; lengthMm: number; px: number; marginA: number; marginB: number; cursor?: number }) {
  const len = lengthMm * px;
  const step = px >= 3 ? 1 : px >= 1.5 ? 2 : 5;
  const labelEvery = px >= 2 ? 10 : px >= 1 ? 20 : 50;
  const ticks: React.ReactNode[] = [];
  for (let mm = 0; mm <= lengthMm; mm += step) {
    const major = mm % 10 === 0;
    const mid = mm % 5 === 0;
    const size = major ? 10 : mid ? 6 : 3;
    const p = mm * px;
    ticks.push(
      axis === 'x' ? (
        <line key={mm} x1={p} x2={p} y1={RULER} y2={RULER - size} stroke="#64748b" strokeWidth={1} />
      ) : (
        <line key={mm} y1={p} y2={p} x1={RULER} x2={RULER - size} stroke="#64748b" strokeWidth={1} />
      ),
    );
    if (mm % labelEvery === 0 && mm > 0) {
      ticks.push(
        axis === 'x' ? (
          <text key={`t${mm}`} x={p + 2} y={9} fontSize={9} fill="#475569">
            {mm}
          </text>
        ) : (
          <text key={`t${mm}`} x={9} y={p + 2} fontSize={9} fill="#475569" transform={`rotate(-90 9 ${p + 2})`}>
            {mm}
          </text>
        ),
      );
    }
  }
  const marginFill = '#cbd5e1';
  return (
    <svg
      width={axis === 'x' ? len : RULER}
      height={axis === 'x' ? RULER : len}
      className={cn('block shrink-0 select-none bg-slate-50', axis === 'x' ? 'border-b border-slate-300' : 'border-r border-slate-300')}
    >
      {axis === 'x' ? (
        <>
          <rect x={0} y={0} width={marginA * px} height={RULER} fill={marginFill} />
          <rect x={len - marginB * px} y={0} width={marginB * px} height={RULER} fill={marginFill} />
        </>
      ) : (
        <>
          <rect x={0} y={0} width={RULER} height={marginA * px} fill={marginFill} />
          <rect x={0} y={len - marginB * px} width={RULER} height={marginB * px} fill={marginFill} />
        </>
      )}
      {ticks}
      {cursor !== undefined ? (
        axis === 'x' ? (
          <line x1={cursor * px} x2={cursor * px} y1={0} y2={RULER} stroke="#ef4444" strokeWidth={1} />
        ) : (
          <line y1={cursor * px} y2={cursor * px} x1={0} x2={RULER} stroke="#ef4444" strokeWidth={1} />
        )
      ) : null}
    </svg>
  );
}
