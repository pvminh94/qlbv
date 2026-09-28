/**
 * Đồng bộ TỪ ĐIỂN DỮ LIỆU (schema-comments.ts) vào CSDL dưới dạng COMMENT ON
 * — hiển thị trực tiếp trong DBeaver/pgAdmin/DataGrip hoặc psql \d+.
 *
 *   npm run db:comments            gắn/cập nhật toàn bộ ghi chú
 *
 * Script này CŨNG TỰ CHẠY ở cuối `npm run db:migrate`. Idempotent — chạy lặp
 * lại tuỳ ý, không ảnh hưởng dữ liệu (COMMENT chỉ là siêu dữ liệu).
 *
 * Ngoài gắn ghi chú, script IN CẢNH BÁO mọi bảng/cột thực tế trong CSDL chưa
 * có ghi chú → khi thêm bảng/cột mới, bổ sung mô tả vào
 * `src/db/schema-comments.ts` để cảnh báo biến mất.
 */
import { Client } from 'pg';
import { config } from '../src/config/env';
import {
  COLUMN_COMMENTS,
  COLUMN_COMMENTS_COMMON,
  TABLE_COMMENTS,
} from '../src/db/schema-comments';

function q(ident: string): string {
  return `"${ident.replace(/"/g, '""')}"`;
}
function lit(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}
/** Từ điển khai báo theo ĐÚNG tên cột trong CSDL (snake_case) */

export async function syncDbComments(): Promise<void> {
  const client = new Client({ connectionString: config.database.url });
  await client.connect();
  try {
    const { rows: realTables } = await client.query<{ table_name: string }>(
      `select table_name from information_schema.tables
       where table_schema = 'public' and table_type = 'BASE TABLE'
         and table_name not in ('__drizzle_migrations', '_qlbs_migrations')`,
    );
    const realSet = new Set(realTables.map((r) => r.table_name));

    let tables = 0;
    let columns = 0;

    /* 1. Ghi chú bảng */
    for (const [table, note] of Object.entries(TABLE_COMMENTS)) {
      if (!realSet.has(table)) continue;
      await client.query(`comment on table ${q(table)} is ${lit(note)}`);
      tables++;
      await client
        .query(`comment on constraint ${q(`${table}_pkey`)} on ${q(table)} is 'Khoá chính'`)
        .catch(() => undefined); // một số bảng không có khoá chính/lệch tên — bỏ qua
    }

    /* 2. Ghi chú cột riêng của từng bảng */
    for (const [table, cols] of Object.entries(COLUMN_COMMENTS)) {
      if (!realSet.has(table)) continue;
      for (const [col, note] of Object.entries(cols)) {
        const res = await client.query(
          `comment on column ${q(table)}.${q(col)} is ${lit(note)}`,
        ).then(() => true).catch(() => false);
        if (res) columns++;
      }
    }

    /* 3. Ghi chú chung theo tên cột — chỉ cho cột CHƯA có ghi chú nào */
    for (const table of realSet) {
      const { rows: cols } = await client.query<{ column_name: string; has_note: boolean }>(
        `select c.column_name,
                (pd.description is not null) as has_note
           from information_schema.columns c
           left join pg_catalog.pg_statio_all_tables st
             on st.schemaname = c.table_schema and st.relname = c.table_name
           left join pg_catalog.pg_description pd
             on pd.objoid = st.relid and pd.objsubid = c.ordinal_position
          where c.table_schema = 'public' and c.table_name = $1`,
        [table],
      );
      for (const col of cols) {
        if (col.has_note) continue;
        const note = COLUMN_COMMENTS_COMMON[col.column_name];
        if (!note) continue;
        await client.query(`comment on column ${q(table)}.${q(col.column_name)} is ${lit(note)}`);
        columns++;
      }
    }

    /* 4. Cảnh báo phần còn thiếu — bắt buộc bổ sung nhờ cơ chế này */
    const { rows: missingTables } = await client.query<{ relname: string }>(
      `select c.relname from pg_catalog.pg_class c
         join pg_catalog.pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r'
          and c.relname not in ('__drizzle_migrations', '_qlbs_migrations')
          and obj_description(c.oid) is null
        order by 1`,
    );
    const { rows: missingCols } = await client.query<{ table_name: string; column_name: string }>(
      `select c.table_name, c.column_name
         from information_schema.columns c
         left join pg_catalog.pg_statio_all_tables st
           on st.schemaname = c.table_schema and st.relname = c.table_name
         left join pg_catalog.pg_description pd
           on pd.objoid = st.relid and pd.objsubid = c.ordinal_position
        where c.table_schema = 'public' and c.table_name not in ('__drizzle_migrations', '_qlbs_migrations') and pd.description is null
        order by c.table_name, c.ordinal_position`,
    );

    console.log(`✔ Từ điển dữ liệu: ghi chú ${tables} bảng, ${columns} cột.`);
    if (missingTables.length > 0) {
      console.warn(`⚠ ${missingTables.length} bảng CHƯA có ghi chú (bổ sung vào src/db/schema-comments.ts):`);
      console.warn(`   ${missingTables.map((r) => r.relname).join(', ')}`);
    }
    if (missingCols.length > 0) {
      console.warn(`⚠ ${missingCols.length} cột CHƯA có ghi chú (bổ sung vào src/db/schema-comments.ts):`);
      const byTable = new Map<string, string[]>();
      for (const r of missingCols) {
        const arr = byTable.get(r.table_name) ?? [];
        arr.push(r.column_name);
        byTable.set(r.table_name, arr);
      }
      for (const [t, cs] of [...byTable.entries()].slice(0, 12)) {
        console.warn(`   ${t}: ${cs.join(', ')}`);
      }
      if (byTable.size > 12) console.warn(`   … và ${byTable.size - 12} bảng khác`);
    }
  } finally {
    await client.end();
  }
}

/* Chạy trực tiếp: npm run db:comments */
if (require.main === module) {
  syncDbComments().catch((err) => {
    console.error('Không gắn được ghi chú CSDL:', err);
    process.exit(1);
  });
}
