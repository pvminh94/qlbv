/**
 * Ánh xạ bước ký → mã quyền ký tương ứng.
 *
 * Vì lịch sử mã quyền không hoàn toàn trùng tên bước (TAICHINH ↔ sign-finance),
 * TUYỆT ĐỐI không suy ra bằng template string — thêm bước mới phải khai báo ở đây.
 */
export const SIGN_PERMISSION_BY_STEP: Record<string, string> = {
  DE_NGHI: 'hsba.request.sign-requester',
  KHTB: 'hsba.request.sign-khtb',
  BAOHIEM: 'hsba.request.sign-insurance',
  TAICHINH: 'hsba.request.sign-finance',
};

/** Quyền ký của một bước; bước lạ → fallback theo quy ước sign-<bước> viết thường */
export function signPermissionOf(stepKey: string): string {
  return SIGN_PERMISSION_BY_STEP[stepKey.toUpperCase()] ?? `hsba.request.sign-${stepKey.toLowerCase()}`;
}
