/**
 * Tính khấu hao / hao mòn tài sản — hàm thuần, không truy cập CSDL (dễ kiểm thử).
 *
 *  STRAIGHT_LINE_YEARLY  (hao mòn TT23/2023 — đơn vị sự nghiệp công): tính theo NĂM.
 *      Mức năm = Nguyên giá × Tỉ lệ %/năm (tỉ lệ = 0 → Nguyên giá / số năm sử dụng).
 *      Năm đầu tính theo số tháng sử dụng thực tế (từ tháng bắt đầu đến tháng 12).
 *      Làm tròn LÊN tới đồng (TT23: "cộng thêm 01 vào phần số nguyên").
 *  STRAIGHT_LINE_MONTHLY (khấu hao đường thẳng TT45/2013): (Nguyên giá − Giá trị thu hồi) / số tháng.
 *  DECLINING_BALANCE     (số dư giảm dần có điều chỉnh): hệ số 1,5 (≤4 năm) · 2,0 (4–6 năm) · 2,5 (>6 năm);
 *      khi mức giảm dần < giá trị còn lại / số năm còn lại thì chuyển sang chia đều.
 *  NONE                  không tính (CCDC, đất…).
 *
 * Kỳ tháng: 'YYYY-MM' · kỳ năm: 'YYYY'. Không bao giờ vượt quá giá trị còn phải khấu hao.
 */
export type DepreciationMethod = 'NONE' | 'STRAIGHT_LINE_MONTHLY' | 'STRAIGHT_LINE_YEARLY' | 'DECLINING_BALANCE';

export interface DepreciableAsset {
  originalCost: number;
  residualValue: number;
  depreciationMethod: DepreciationMethod | string;
  usefulLifeMonths: number;
  annualRate: number;
  /** Ngày bắt đầu tính (YYYY-MM-DD) */
  startDate: string | null;
  /** Luỹ kế hiện tại (đã gồm đầu kỳ) */
  accumulated: number;
}

export const METHOD_LABEL: Record<string, string> = {
  NONE: 'Không tính',
  STRAIGHT_LINE_YEARLY: 'Hao mòn theo năm (TT23/2023)',
  STRAIGHT_LINE_MONTHLY: 'Khấu hao đường thẳng theo tháng',
  DECLINING_BALANCE: 'Số dư giảm dần có điều chỉnh',
};

export const periodTypeOf = (method: string): 'YEARLY' | 'MONTHLY' | null =>
  method === 'STRAIGHT_LINE_YEARLY' ? 'YEARLY' : method === 'STRAIGHT_LINE_MONTHLY' || method === 'DECLINING_BALANCE' ? 'MONTHLY' : null;

/** Giá trị phải khấu hao (TT23 không trừ giá trị thu hồi) */
export function depreciableBase(a: DepreciableAsset): number {
  if (a.depreciationMethod === 'NONE') return 0;
  const base = a.depreciationMethod === 'STRAIGHT_LINE_YEARLY' ? a.originalCost : a.originalCost - (a.residualValue || 0);
  return Math.max(0, base);
}

export const remainingOf = (a: DepreciableAsset) => Math.max(0, depreciableBase(a) - (a.accumulated || 0));
export const bookValueOf = (a: DepreciableAsset) => Math.max(0, (a.originalCost || 0) - (a.accumulated || 0));

function monthIndex(ym: string): number {
  const [y, m] = ym.split('-').map(Number);
  return y * 12 + (m - 1);
}

function decliningCoef(years: number): number {
  if (years <= 4) return 1.5;
  if (years <= 6) return 2.0;
  return 2.5;
}

/** Mức khấu hao/hao mòn của MỘT kỳ ('YYYY' hoặc 'YYYY-MM') tính từ trạng thái hiện tại */
export function amountForPeriod(a: DepreciableAsset, period: string): number {
  const remaining = remainingOf(a);
  if (remaining <= 0 || !a.startDate || a.depreciationMethod === 'NONE') return 0;
  const start = a.startDate.slice(0, 7); // YYYY-MM
  const life = Math.max(1, a.usefulLifeMonths || 1);
  const base = depreciableBase(a);

  if (a.depreciationMethod === 'STRAIGHT_LINE_YEARLY') {
    if (!/^\d{4}$/.test(period)) return 0;
    const year = Number(period);
    const startYear = Number(start.slice(0, 4));
    if (year < startYear) return 0;
    const annual = a.annualRate > 0 ? (a.originalCost * a.annualRate) / 100 : (base * 12) / life;
    const months = year === startYear ? 12 - Number(start.slice(5, 7)) + 1 : 12;
    return Math.min(remaining, Math.ceil((annual * months) / 12));
  }

  if (!/^\d{4}-\d{2}$/.test(period)) return 0;
  const idx = monthIndex(period) - monthIndex(start); // 0 = tháng đầu tiên
  if (idx < 0) return 0;

  if (a.depreciationMethod === 'STRAIGHT_LINE_MONTHLY') {
    if (idx >= life) return Math.round(remaining); // quá hạn mà còn dư → khấu hao nốt
    const monthly = base / life;
    const monthsLeft = life - idx;
    // Tháng cuối (hoặc chạy bù): lấy đúng phần còn lại để tổng khớp nguyên giá
    return monthsLeft <= 1 ? Math.round(remaining) : Math.min(Math.round(remaining), Math.round(monthly));
  }

  if (a.depreciationMethod === 'DECLINING_BALANCE') {
    if (idx >= life - 1) return Math.round(remaining); // tháng cuối / quá hạn: khấu hao nốt
    const years = life / 12;
    const rate = (1 / years) * decliningCoef(years);
    const yearOfUse = Math.floor(idx / 12);
    const monthInYear = idx % 12;
    const yearsLeftAtYearStart = Math.max(1 / 12, (life - yearOfUse * 12) / 12);
    // Tỉ lệ năm hiệu lực: giảm dần, hoặc chia đều khi mức chia đều cao hơn (≤ 100%)
    const k = Math.min(1, Math.max(rate, 1 / yearsLeftAtYearStart));
    // Giá trị còn lại đầu năm sử dụng (suy ngược từ số dư hiện tại)
    const bookAtYearStart = remaining / Math.max(1e-9, 1 - (monthInYear * k) / 12);
    return Math.min(Math.round(remaining), Math.round((bookAtYearStart * k) / 12));
  }
  return 0;
}

export interface ScheduleRow {
  period: string;
  amount: number;
  accumulated: number;
  bookValue: number;
}

/** Lịch khấu hao dự kiến theo NĂM, từ trạng thái hiện tại tới khi hết giá trị (tối đa 60 năm) */
export function projectSchedule(a: DepreciableAsset, fromPeriod: string): ScheduleRow[] {
  const rows: ScheduleRow[] = [];
  if (!a.startDate || a.depreciationMethod === 'NONE') return rows;
  const state = { ...a };
  const startYear = Math.max(Number(fromPeriod.slice(0, 4)), Number(a.startDate.slice(0, 4)));
  const fromMonth = fromPeriod.length > 4 ? fromPeriod : `${fromPeriod}-01`;
  for (let y = startYear; y < startYear + 60 && remainingOf(state) > 0; y++) {
    let amount = 0;
    if (a.depreciationMethod === 'STRAIGHT_LINE_YEARLY') {
      amount = amountForPeriod(state, String(y));
      state.accumulated += amount;
    } else {
      for (let m = 1; m <= 12; m++) {
        const p = `${y}-${String(m).padStart(2, '0')}`;
        if (p < fromMonth) continue;
        const v = amountForPeriod(state, p);
        state.accumulated += v;
        amount += v;
      }
    }
    if (amount > 0) rows.push({ period: String(y), amount, accumulated: state.accumulated, bookValue: bookValueOf(state) });
  }
  return rows;
}

/** Kỳ liền trước ('2026' → '2025', '2026-01' → '2025-12') */
export function previousPeriod(period: string): string {
  if (/^\d{4}$/.test(period)) return String(Number(period) - 1);
  const idx = monthIndex(period) - 1;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
}

/** Ngày cuối kỳ (YYYY-MM-DD) */
export function periodEnd(period: string): string {
  if (/^\d{4}$/.test(period)) return `${period}-12-31`;
  const [y, m] = period.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${period}-${String(last).padStart(2, '0')}`;
}
