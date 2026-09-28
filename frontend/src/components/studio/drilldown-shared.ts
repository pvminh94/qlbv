/**
 * Studio — bội dùng chung của drill-down: suy bộ lọc từ điểm được bấm.
 * (Tách khỏi dialog để tránh vòng import widget ↔ dialog giữa các client component.)
 */
import type { StudioBucket, StudioDataSpec, StudioFilter } from '@/lib/studio';

/** Một giá trị kích thước tại điểm được bấm */
export interface DrillDim {
  field: string;
  bucket?: StudioBucket;
  value: unknown;
  /** Nhãn hiển thị của cột kích thước (câu mô tả) */
  label: string;
}

/** Điểm được bấm: danh sách kích thước kèm câu mô tả hiển thị */
export interface DrillPoint {
  dims: DrillDim[];
  display: string;
}

const PAGE_SIZE = 50;

/** Khoảng [from,to] YYYY-MM-DD từ nhãn bucket (đối xứng với engine: YYYY-MM-DD / IYYY-Tww / YYYY-MM / YYYY-Qn / YYYY) */
export function bucketLabelToRange(label: string): { from: string; to: string } | null {
  const pad = (n: number) => String(n).padStart(2, '0');
  const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(label)) return { from: label, to: label };
  let m = /^(\d{4})-(\d{2})$/.exec(label);
  if (m) {
    const y = +m[1], mo = +m[2];
    return { from: `${y}-${m[2]}-01`, to: ymd(new Date(y, mo, 0)) };
  }
  m = /^(\d{4})-T(\d{2})$/.exec(label);
  if (m) {
    const jan4 = new Date(+m[1], 0, 4);
    const dow = (jan4.getDay() + 6) % 7;
    const monday = new Date(jan4);
    monday.setDate(jan4.getDate() - dow + (+m[2] - 1) * 7);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    return { from: ymd(monday), to: ymd(sunday) };
  }
  m = /^(\d{4})-Q(\d)$/.exec(label);
  if (m) {
    const q = +m[2];
    return { from: `${m[1]}-${pad((q - 1) * 3 + 1)}-01`, to: ymd(new Date(+m[1], q * 3, 0)) };
  }
  if (/^\d{4}$/.test(label)) return { from: `${label}-01-01`, to: `${label}-12-31` };
  return null;
}

/** Gộp spec của ô + điểm được bấm thành spec records hoàn chỉnh */
export function buildDrilldownSpec(spec: StudioDataSpec, point: DrillPoint): StudioDataSpec | null {
  if (!spec.source) return null;
  const filters: StudioFilter[] = [...(spec.filters ?? [])];
  let dateRange = spec.dateRange ? { ...spec.dateRange } : undefined;

  for (const d of point.dims) {
    if (d.bucket) {
      const range = bucketLabelToRange(String(d.value ?? ''));
      if (range) {
        dateRange = { ...(dateRange ?? {}), field: d.field, preset: undefined, from: range.from, to: range.to };
      }
      continue;
    }
    const v = d.value;
    if (v === null || v === undefined || v === '') filters.push({ field: d.field, op: 'null' });
    else if (typeof v === 'number') filters.push({ field: d.field, op: 'eq', value: v });
    else filters.push({ field: d.field, op: 'eq', value: String(v) });
  }

  return { source: spec.source, mode: 'records', filters, dateRange, limit: PAGE_SIZE };
}

/** Câu mô tả các điều kiện đã áp (hiển thị dưới tiêu đề dialog) */
export function describeDrilldown(point: DrillPoint): string {
  return point.dims
    .map((d) => `${d.label}: ${d.value === null || d.value === undefined || d.value === '' ? 'Trống' : String(d.value)}`)
    .join(' · ');
}

export const DRILL_PAGE_SIZE = PAGE_SIZE;
