import { BKK_OFFSET_MS, addDays, bangkokToday, shiftInterval } from '../duty/duty-rules';

/** Có múi giờ ở cuối chuỗi (Z, +07:00, +0700, -05:00) */
const ZONE_RE = /(Z|[+-]\d{2}:?\d{2})$/i;
/** Thời điểm ISO 8601 có giờ: 2026-10-09T19:30 hoặc 2026-10-09T19:30:00(.sss)(zone) */
const INSTANT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:?\d{2})?$/i;

/**
 * Đọc tham số `at`. Không có tham số → thời điểm hiện tại.
 * Không ghi múi giờ → hiểu là giờ Bangkok (+07:00). Trả về null nếu sai định dạng.
 */
export function parseInstant(raw: string | undefined, now: number = Date.now()): number | null {
  if (raw === undefined || raw.trim() === '') return now;
  const text = raw.trim();
  if (!INSTANT_RE.test(text)) return null;
  const withZone = ZONE_RE.test(text) ? text : `${text}+07:00`;
  const ms = Date.parse(withZone);
  return Number.isNaN(ms) ? null : ms;
}

/** Thời điểm theo giờ Bangkok, định dạng 2026-10-09T17:00:00+07:00 */
export function bangkokIso(ms: number): string {
  return new Date(ms + BKK_OFFSET_MS).toISOString().slice(0, 19) + '+07:00';
}

/**
 * Ngày lịch có thể chứa thời điểm `ms`: hôm đó và hôm trước
 * (ca đêm bắt đầu hôm trước và kéo dài sang hôm nay).
 */
export function candidateDutyDates(ms: number): string[] {
  const today = bangkokToday(ms);
  return [today, addDays(today, -1)];
}

/** Ca có phủ thời điểm `ms` không. Đầu ca tính vào, cuối ca không tính (nửa mở). */
export function coversInstant(
  ms: number,
  dutyDate: string,
  startTime: string,
  endTime: string,
  crossesMidnight: boolean,
): boolean {
  const { start, end } = shiftInterval(dutyDate, startTime, endTime, crossesMidnight);
  return start <= ms && ms < end;
}

/** Ngày dương lịch (giờ Bangkok) nơi ca kết thúc. Ca đêm 17:00–07:00 kết thúc ngày hôm sau. */
export function shiftEndDay(dutyDate: string, startTime: string, endTime: string, crossesMidnight: boolean): string {
  const { end } = shiftInterval(dutyDate, startTime, endTime, crossesMidnight);
  return bangkokToday(end - 1);
}
