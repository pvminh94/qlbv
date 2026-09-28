/**
 * Trình chạy migration.
 *
 * Áp dụng lần lượt các tệp .sql trong thư mục `drizzle/` theo thứ tự tên tệp,
 * ghi nhớ tệp đã chạy trong bảng `_qlbs_migrations` (kèm mã băm để phát hiện sửa đổi).
 *
 * Dùng:  npm run db:migrate          → áp dụng tất cả
 *        npm run db:migrate -- --list → chỉ liệt kê
 *        npm run db:migrate -- --status
 */
import 'dotenv/config';
import { syncDbComments } from './db-comments';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { Client } from 'pg';

const DRIZZLE_DIR = path.resolve(__dirname, '..', 'drizzle');
const TRACKING_TABLE = '_qlbs_migrations';

function connectionString(): string {
  return (
    process.env.DATABASE_URL ?? 'postgresql://qlbs:qlbs@localhost:5432/qlbs'
  );
}

function migrationFiles(): { name: string; sql: string; checksum: string }[] {
  if (!fs.existsSync(DRIZZLE_DIR)) return [];
  return fs
    .readdirSync(DRIZZLE_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((name) => {
      const sql = fs.readFileSync(path.join(DRIZZLE_DIR, name), 'utf8');
      return { name, sql, checksum: createHash('sha256').update(sql).digest('hex').slice(0, 16) };
    });
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const files = migrationFiles();

  const client = new Client({ connectionString: connectionString() });
  await client.connect();

  await client.query(`
    create table if not exists ${TRACKING_TABLE} (
      name        text primary key,
      checksum    text not null,
      applied_at  timestamptz not null default now(),
      duration_ms integer not null default 0
    )
  `);

  const applied = await client.query<{ name: string; checksum: string }>(
    `select name, checksum from ${TRACKING_TABLE} order by name`,
  );
  const appliedMap = new Map(applied.rows.map((r) => [r.name, r.checksum]));

  if (args.includes('--list')) {
    console.log(`Tìm thấy ${files.length} tệp migration:`);
    for (const f of files) {
      const state = appliedMap.has(f.name) ? '✔ đã áp dụng' : '· chưa áp dụng';
      console.log(`  ${state}  ${f.name}  (${f.checksum})`);
    }
    await client.end();
    return;
  }

  if (args.includes('--status')) {
    console.log(`Đã áp dụng: ${appliedMap.size}/${files.length}`);
    for (const [name, checksum] of appliedMap) {
      const current = files.find((f) => f.name === name);
      const drift = current && current.checksum !== checksum ? '  ⚠ NỘI DUNG ĐÃ THAY ĐỔI' : '';
      console.log(`  ✔ ${name}${drift}`);
    }
    await client.end();
    return;
  }

  let ran = 0;
  for (const file of files) {
    const previous = appliedMap.get(file.name);
    if (previous !== undefined) {
      if (previous !== file.checksum) {
        console.warn(
          `⚠ ${file.name} đã được áp dụng nhưng nội dung tệp đã thay đổi so với lúc chạy — bỏ qua.`,
        );
      }
      continue;
    }

    const started = Date.now();
    process.stdout.write(`→ Đang áp dụng ${file.name} ... `);
    try {
      await client.query('BEGIN');
      // drizzle-kit ngăn cách các câu lệnh bằng dấu đặc biệt này
      const statements = file.sql
        .split('--> statement-breakpoint')
        .map((s) => s.trim())
        .filter(Boolean);
      for (const statement of statements) {
        await client.query(statement);
      }
      await client.query(
        `insert into ${TRACKING_TABLE} (name, checksum, duration_ms) values ($1, $2, $3)`,
        [file.name, file.checksum, Date.now() - started],
      );
      await client.query('COMMIT');
      console.log(`xong (${Date.now() - started} ms, ${statements.length} câu lệnh)`);
      ran++;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      console.error(`\n✗ LỖI khi áp dụng ${file.name}:\n${(err as Error).message}`);
      await client.end();
      process.exit(1);
    }
  }

  const total = files.length;
  const nowApplied = (await client.query<{ total: string }>(
    `select count(*)::text as total from ${TRACKING_TABLE}`,
  )).rows[0]?.total;

  console.log(
    ran === 0
      ? `✔ CSDL đã cập nhật (${nowApplied}/${total} migration) — không có gì mới.`
      : `✔ Đã áp dụng ${ran} migration. Tổng: ${nowApplied}/${total}.`,
  );
  await client.end();

  /* Gắn ghi chú tiếng Việt cho bảng/cột (từ điển dữ liệu) */
  await syncDbComments().catch((err) =>
    console.warn('⚠ Không gắn được ghi chú CSDL (bỏ qua, không ảnh hưởng dữ liệu):', err?.message ?? err),
  );
}

main().catch((err) => {
  console.error('Không chạy được migration:', err);
  process.exit(1);
});
