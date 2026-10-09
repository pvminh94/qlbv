/**
 * Quản lý khoá API tích hợp (máy khoá phòng khám đọc lịch trực).
 *   npm run integration:key -- create --name "Máy khóa phòng khám"
 *   npm run integration:key -- list
 *   npm run integration:key -- revoke --id 3
 * Khoá đầy đủ chỉ in ra đúng một lần khi tạo. CSDL chỉ lưu băm SHA-256.
 */
import 'dotenv/config';
import { Client } from 'pg';
import {
  DUTY_READ_SCOPE,
  generateIntegrationKey,
  hashIntegrationKey,
  keyDisplayPrefix,
} from '../src/modules/integration/integration-keys';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const fmt = (v: Date | string | null) =>
  v ? new Date(v).toLocaleString('vi-VN', { timeZone: 'Asia/Bangkok' }) : '—';

async function main(): Promise<number> {
  const cmd = process.argv[2];
  const client = new Client({
    connectionString: process.env.DATABASE_URL ?? 'postgresql://qlbs:qlbs@localhost:5432/qlbs',
  });
  await client.connect();
  try {
    if (cmd === 'create') {
      const name = (arg('name') ?? '').trim();
      if (name.length < 3 || name.length > 80) {
        console.error('Cần --name với 3 đến 80 ký tự, ví dụ: --name "Máy khóa phòng khám"');
        return 2;
      }
      const key = generateIntegrationKey();
      const { rows } = await client.query(
        'INSERT INTO integration_keys (name, key_prefix, key_hash, scope) VALUES ($1, $2, $3, $4) RETURNING id',
        [name, keyDisplayPrefix(key), hashIntegrationKey(key), DUTY_READ_SCOPE],
      );
      console.log(`Đã tạo khoá API #${rows[0].id} "${name}" (phạm vi: ${DUTY_READ_SCOPE}).`);
      console.log('KHOÁ NÀY CHỈ HIỂN THỊ MỘT LẦN. Đặt vào máy khóa (UNLOCK_QLBS_KEY), không gửi qua chat:');
      console.log(key);
      return 0;
    }
    if (cmd === 'list') {
      const { rows } = await client.query(
        'SELECT id, name, key_prefix, scope, created_at, last_used_at, use_count, revoked_at ' +
          'FROM integration_keys ORDER BY id',
      );
      if (rows.length === 0) console.log('Chưa có khoá API tích hợp nào.');
      for (const r of rows) {
        const status = r.revoked_at ? `ĐÃ THU HỒI ${fmt(r.revoked_at)}` : 'đang hoạt động';
        console.log(
          `#${r.id}  ${r.name}  [${r.key_prefix}…]  phạm vi=${r.scope}  tạo=${fmt(r.created_at)}  ` +
            `dùng lần cuối=${fmt(r.last_used_at)}  số lần=${r.use_count}  ${status}`,
        );
      }
      return 0;
    }
    if (cmd === 'revoke') {
      const id = Number(arg('id'));
      if (!Number.isInteger(id) || id <= 0) {
        console.error('Cần --id, ví dụ: --id 3 (xem danh sách bằng lệnh list)');
        return 2;
      }
      const { rowCount } = await client.query(
        'UPDATE integration_keys SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL',
        [id],
      );
      if (!rowCount) {
        console.error(`Không có khoá #${id} đang hoạt động.`);
        return 1;
      }
      console.log(`Đã thu hồi khoá #${id}. Mọi yêu cầu dùng khoá này sẽ bị từ chối ngay.`);
      return 0;
    }
    console.log('Cách dùng: integration:key -- create --name "..." | list | revoke --id N');
    return 2;
  } finally {
    await client.end();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err: Error) => {
    console.error(`Lỗi: ${err.message}`);
    process.exit(1);
  });
