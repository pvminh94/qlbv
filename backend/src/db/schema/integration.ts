import { integer, pgTable, serial, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

/**
 * Khoá API cho hệ thống máy (không phải người dùng). Chỉ lưu băm SHA-256 của khoá;
 * khoá đầy đủ chỉ hiển thị đúng một lần khi tạo bằng `npm run integration:key -- create`.
 */
export const integrationKeys = pgTable(
  'integration_keys',
  {
    id: serial('id').primaryKey(),
    /** Tên gợi nhớ, ví dụ "Máy khóa phòng khám" */
    name: text('name').notNull(),
    /** 14 ký tự đầu của khoá, để nhận diện khi quản trị (không đủ để giả mạo) */
    keyPrefix: text('key_prefix').notNull(),
    /** SHA-256 (hex) của khoá đầy đủ */
    keyHash: text('key_hash').notNull(),
    /** Phạm vi quyền. Hiện chỉ có duty:read (đọc lịch trực) */
    scope: text('scope').default('duty:read').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    useCount: integer('use_count').default(0).notNull(),
    /** Đã thu hồi: mọi yêu cầu dùng khoá này bị từ chối ngay */
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('integration_keys_hash_uq').on(t.keyHash)],
);
