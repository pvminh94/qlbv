/**
 * Mã vạch Code 128 (tập B + tự chuyển tập C cho dãy số dài) — không cần thư viện ngoài.
 * Trả về danh sách độ rộng module xen kẽ vạch/khoảng trắng, bắt đầu bằng vạch.
 * Dùng chung thuật toán với frontend (backend/src/common/utils/code128.ts).
 */
const PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];
const START_B = 104;
const START_C = 105;
const CODE_B = 100;
const CODE_C = 99;
const STOP = 106;

/** Mã hoá chuỗi → mảng giá trị ký hiệu (đã gồm start, checksum, stop) */
export function code128Values(input: string): number[] {
  const text = String(input ?? '').replace(/[^\x20-\x7e]/g, '');
  const values: number[] = [];
  let i = 0;
  const digitRun = (from: number): number => {
    let n = 0;
    while (from + n < text.length && /\d/.test(text[from + n])) n++;
    return n;
  };
  let set: 'B' | 'C' = digitRun(0) >= 4 && digitRun(0) === text.length ? 'C' : digitRun(0) >= 4 ? 'C' : 'B';
  if (set === 'C' && digitRun(0) % 2 === 1 && digitRun(0) !== text.length) set = 'B';
  values.push(set === 'C' ? START_C : START_B);
  while (i < text.length) {
    if (set === 'C') {
      if (digitRun(i) >= 2) {
        values.push(Number(text.slice(i, i + 2)));
        i += 2;
        continue;
      }
      values.push(CODE_B);
      set = 'B';
      continue;
    }
    const run = digitRun(i);
    if (run >= 6 && run % 2 === 0) {
      values.push(CODE_C);
      set = 'C';
      continue;
    }
    values.push(text.charCodeAt(i) - 32);
    i++;
  }
  let checksum = values[0];
  for (let k = 1; k < values.length; k++) checksum += values[k] * k;
  values.push(checksum % 103, STOP);
  return values;
}

/** Độ rộng module (vạch, trắng, vạch, …) — tổng = 11 × số ký hiệu + 2 */
export function code128Modules(input: string): number[] {
  return code128Values(input).flatMap((v) => PATTERNS[v].split('').map(Number));
}
