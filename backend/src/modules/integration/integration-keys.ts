import { createHash, randomBytes } from 'crypto';

/** Mọi khoá tích hợp bắt đầu bằng tiền tố này (dễ nhận biết trong cấu hình và nhật ký) */
export const INTEGRATION_KEY_PREFIX = 'qlbs_int_';
/** Phạm vi: đọc lịch trực (máy khoá phòng khám) */
export const DUTY_READ_SCOPE = 'duty:read';

/** Sinh khoá mới: 256 bit ngẫu nhiên, mã hoá base64url. Chỉ hiển thị một lần. */
export function generateIntegrationKey(): string {
  return INTEGRATION_KEY_PREFIX + randomBytes(32).toString('base64url');
}

/** Băm SHA-256 (hex) để lưu và so khớp. CSDL không bao giờ giữ khoá gốc. */
export function hashIntegrationKey(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex');
}

/** 14 ký tự đầu của khoá (tiền tố + 5 ký tự), dùng để nhận diện khi quản trị. */
export function keyDisplayPrefix(key: string): string {
  return key.slice(0, INTEGRATION_KEY_PREFIX.length + 5);
}
