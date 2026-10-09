/**
 * Kiểm thử các hàm thuần của API tích hợp máy khoá (khoá API, giờ `at`, phủ ca). Không cần CSDL.
 * Chạy: npm test  (node --test --import tsx test/*.test.ts)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DUTY_READ_SCOPE,
  INTEGRATION_KEY_PREFIX,
  generateIntegrationKey,
  hashIntegrationKey,
  keyDisplayPrefix,
} from '../src/modules/integration/integration-keys';
import {
  bangkokIso,
  candidateDutyDates,
  coversInstant,
  parseInstant,
  shiftEndDay,
} from '../src/modules/integration/integration-time';
import { normalizeIp } from '../src/modules/integration/integration-key.guard';

/** Mốc giờ Bangkok → mili giây Unix */
const bkk = (ymd: string, hhmm: string) => Date.parse(`${ymd}T${hhmm}:00+07:00`);

test('khoá API: tiền tố, độ dài, không trùng, băm ổn định', () => {
  const a = generateIntegrationKey();
  const b = generateIntegrationKey();
  assert.ok(a.startsWith(INTEGRATION_KEY_PREFIX));
  assert.ok(a.length >= 40, 'khoá đủ dài');
  assert.notEqual(a, b);
  assert.match(hashIntegrationKey(a), /^[0-9a-f]{64}$/);
  assert.equal(hashIntegrationKey(a), hashIntegrationKey(a));
  assert.notEqual(hashIntegrationKey(a), a, 'CSDL không lưu khoá gốc');
  assert.equal(keyDisplayPrefix(a).length, INTEGRATION_KEY_PREFIX.length + 5);
  assert.equal(DUTY_READ_SCOPE, 'duty:read');
});

test('tham số at: không có → hiện tại; không múi giờ → giờ Bangkok; sai định dạng → null', () => {
  const now = 1_700_000_000_000;
  assert.equal(parseInstant(undefined, now), now);
  assert.equal(parseInstant('', now), now);
  assert.equal(parseInstant('2026-10-09T19:30', now), bkk('2026-10-09', '19:30'));
  assert.equal(parseInstant('2026-10-09T19:30:00+07:00', now), bkk('2026-10-09', '19:30'));
  assert.equal(parseInstant('2026-10-09T12:30:00Z', now), bkk('2026-10-09', '19:30'));
  assert.equal(parseInstant('2026-10-09T19:30:00.250+0700', now), bkk('2026-10-09', '19:30') + 250);
  assert.equal(parseInstant('2026-10-09', now), null, 'thiếu giờ');
  assert.equal(parseInstant('hôm nay', now), null);
  assert.equal(parseInstant('2026-10-09T25:00', now), null, 'giờ không hợp lệ');
});

test('bangkokIso xuất giờ Bangkok kèm +07:00', () => {
  assert.equal(bangkokIso(bkk('2026-10-09', '17:00')), '2026-10-09T17:00:00+07:00');
  assert.equal(bangkokIso(bkk('2026-10-10', '07:00')), '2026-10-10T07:00:00+07:00');
});

test('ngày lịch cần xét là hôm nay và hôm trước (ca đêm)', () => {
  assert.deepEqual(candidateDutyDates(bkk('2026-10-09', '03:00')), ['2026-10-09', '2026-10-08']);
  assert.deepEqual(candidateDutyDates(bkk('2026-01-01', '00:30')), ['2026-01-01', '2025-12-31']);
});

test('ca sáng/chiều/cả ngày: đầu ca tính vào, cuối ca không tính', () => {
  const S = ['07:00', '12:00', false] as const;
  assert.equal(coversInstant(bkk('2026-10-08', '07:00'), '2026-10-08', ...S), true);
  assert.equal(coversInstant(bkk('2026-10-08', '06:59'), '2026-10-08', ...S), false);
  assert.equal(coversInstant(bkk('2026-10-08', '11:59'), '2026-10-08', ...S), true);
  assert.equal(coversInstant(bkk('2026-10-08', '12:00'), '2026-10-08', ...S), false);
});

test('ca đêm 17:00–07:00 phủ cả buổi tối hôm trước lẫn sáng hôm sau', () => {
  const D = ['17:00', '07:00', true] as const;
  assert.equal(coversInstant(bkk('2026-10-08', '16:59'), '2026-10-08', ...D), false);
  assert.equal(coversInstant(bkk('2026-10-08', '17:00'), '2026-10-08', ...D), true);
  assert.equal(coversInstant(bkk('2026-10-08', '23:59'), '2026-10-08', ...D), true);
  assert.equal(coversInstant(bkk('2026-10-09', '03:00'), '2026-10-08', ...D), true);
  assert.equal(coversInstant(bkk('2026-10-09', '06:59'), '2026-10-08', ...D), true);
  assert.equal(coversInstant(bkk('2026-10-09', '07:00'), '2026-10-08', ...D), false);
});

test('ca đêm hôm nay được tìm thấy khi tra cứu trong đêm', () => {
  // 2026-10-09 19:19 (giờ hiện tại của dự án): ca D của chính ngày 09/10 phải đang phủ thời điểm này
  const now = bkk('2026-10-09', '19:19');
  const dates = candidateDutyDates(now);
  assert.ok(dates.includes('2026-10-09'));
  assert.equal(coversInstant(now, '2026-10-09', '17:00', '07:00', true), true);
});

test('ca đêm kết thúc ngày hôm sau: nghỉ phép phải tính cả ngày kết thúc', () => {
  assert.equal(shiftEndDay('2026-10-08', '17:00', '07:00', true), '2026-10-09');
  assert.equal(shiftEndDay('2026-10-08', '07:00', '12:00', false), '2026-10-08');
});

test('địa chỉ IPv4 đóng gói trong IPv6 được chuẩn hoá trước khi kiểm tra allowlist', () => {
  assert.equal(normalizeIp('::ffff:10.0.0.5'), '10.0.0.5');
  assert.equal(normalizeIp('203.0.113.10'), '203.0.113.10');
  assert.equal(normalizeIp(undefined), '');
});
