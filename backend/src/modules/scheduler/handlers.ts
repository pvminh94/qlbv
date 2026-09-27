/**
 * Thư viện hàm xử lý cho tác vụ định kỳ.
 *
 * Mỗi hàm nhận `JobContext` và trả về `{ message, ...số liệu }` để ghi vào lịch sử chạy.
 * Muốn thêm tác vụ mới: viết hàm ở đây rồi thêm vào `builtinHandlers` — sau đó
 * quản trị có thể tạo tác vụ từ giao diện mà không cần sửa mã nguồn.
 */
import { Logger } from '@nestjs/common';
import { and, eq, isNull, lt, sql } from 'drizzle-orm';
import * as fs from 'fs';
import { once } from 'events';
import * as zlib from 'zlib';
import * as path from 'path';
import { config } from '../../config/env';
import type { DbService } from '../../db/db.service';
import { departments, roles, scheduledJobs, users } from '../../db/schema';
import type { CacheService } from '../../infra/cache/cache.service';
import type { JobContext, JobHandler, JobResult } from '../../infra/queue/queue.service';
import { runAssetDueReminder } from '../assets/asset-reminder';
import { backupFileName, formatBytes, rotateBackups, writeBackup, type SqlExecutor } from '../backups/backup-writer';

export interface HandlerDeps {
  db: DbService;
  cache: CacheService;
  logger: Logger;
}

export function builtinHandlers(deps: HandlerDeps): Map<string, JobHandler> {
  const { db, cache, logger } = deps;
  const handlers = new Map<string, JobHandler>();

  /* ------------------------------------------------------------- Bộ đệm */

  handlers.set('cache.warm', async (): Promise<JobResult> => {
    const deptRows = await db.db
      .select({ id: departments.id, name: departments.name })
      .from(departments)
      .where(and(eq(departments.active, true), isNull(departments.deletedAt)));
    const roleRows = await db.db.select({ id: roles.id, code: roles.code }).from(roles).where(eq(roles.active, true));
    await cache.set('warm:departments', deptRows, config.cache.structureTtl);
    await cache.set('warm:roles', roleRows, config.cache.structureTtl);
    await cache.set('warm:at', new Date().toISOString(), 86_400);
    return { message: `Đã nạp ${deptRows.length} khoa và ${roleRows.length} vai trò vào bộ đệm` };
  });

  handlers.set('cache.cleanup', async (): Promise<JobResult> => {
    const before = cache.stats();
    await cache.delByPrefix('tmp:');
    await cache.delByPrefix('warm:');
    const after = cache.stats();
    return {
      message: 'Đã dọn bộ đệm tạm',
      backend: after.backend,
      sizeBefore: before.size,
      sizeAfter: after.size,
    };
  });

  /* ---------------------------------------------------------- Phiên đăng nhập */

  handlers.set('session.cleanup', async (): Promise<JobResult> => {
    // Thu hồi phiên của những tài khoản đã bị vô hiệu hoá
    const disabled = await db.db
      .select({ id: users.id, username: users.username })
      .from(users)
      .where(eq(users.active, false));
    let revoked = 0;
    for (const u of disabled) {
      const indexKey = `auth:user-sessions:${u.id}`;
      const sessionIds = await cache.smembers(indexKey);
      for (const sid of sessionIds) {
        await cache.del(`auth:session:${sid}`);
        revoked++;
      }
      if (sessionIds.length > 0) await cache.del(indexKey);
      await cache.del(`auth:ctx:${u.id}`);
    }
    return { message: `Đã thu hồi ${revoked} phiên của ${disabled.length} tài khoản bị vô hiệu hoá` };
  });

  /* ------------------------------------------------------------ Lưu trữ tệp */

  handlers.set('storage.cleanup', async (): Promise<JobResult> => {
    const dirs = [config.storage.exportsDir, config.storage.backupsDir];
    const cutoff = Date.now() - config.storage.retentionDays * 86_400_000;
    let removed = 0;
    let freedBytes = 0;
    for (const dir of dirs) {
      if (!fs.existsSync(dir)) continue;
      for (const name of fs.readdirSync(dir)) {
        const full = path.join(dir, name);
        try {
          const stat = fs.statSync(full);
          // Bản sao lưu CSDL do db.backup tự quản lý số lượng (payload.keep) — không xoá theo tuổi,
          // tránh trường hợp sao lưu ngừng chạy lâu ngày rồi mất luôn các bản tốt cuối cùng.
          if (dir === config.storage.backupsDir && /^qlbs-.*\.json(\.gz)?$/.test(name)) continue;
          if (stat.isFile() && stat.mtimeMs < cutoff) {
            freedBytes += stat.size;
            fs.unlinkSync(full);
            removed++;
          }
        } catch (err) {
          logger.warn(`Không xoá được ${full}: ${(err as Error).message}`);
        }
      }
    }
    return {
      message: `Đã xoá ${removed} tệp quá hạn (${Math.round(freedBytes / 1024)} KB)`,
      removed,
      freedBytes,
    };
  });

  /* ------------------------------------------------------------ Nhật ký */

  handlers.set('audit.digest', async (): Promise<JobResult> => {
    const rows = await db.db.execute<{ module: string; total: number }>(sql`
      select module, count(*)::int as total
      from audit_logs
      where created_at > now() - interval '1 day'
      group by module
      order by total desc
    `);
    const list = (rows as unknown as { rows: { module: string; total: number }[] }).rows ?? [];
    const summary = list.map((r) => `${r.module}: ${r.total}`).join(', ') || 'không có hoạt động';
    await cache.set('digest:audit:24h', { at: new Date().toISOString(), list }, 86_400);
    return { message: `Hoạt động 24 giờ qua — ${summary}`, modules: list.length };
  });

  /* ------------------------------------------------------------ Báo cáo */

  handlers.set('report.daily-digest', async (ctx: JobContext): Promise<JobResult> => {
    const day = (ctx.payload?.['date'] as string) ?? new Date().toISOString().slice(0, 10);
    const rows = await db.db.execute<{ name: string }>(sql`
      select d.name
      from departments d
      where d.active = true and d.report_enabled = true and d.deleted_at is null
        and not exists (
          select 1 from report_entries e
          join report_templates t on t.id = e.template_id
          where t.department_id = d.id and e.entry_date = ${day}::date
        )
      order by d.name
    `);
    const missing = ((rows as unknown as { rows: { name: string }[] }).rows ?? []).map((r) => r.name);
    await cache.set(`digest:missing:${day}`, missing, 86_400);
    return {
      message:
        missing.length === 0
          ? `Tất cả các khoa đã nhập số liệu ngày ${day}`
          : `${missing.length} khoa chưa nhập số liệu ngày ${day}: ${missing.join(', ')}`,
      date: day,
      missingCount: missing.length,
      departments: missing,
    };
  });

  handlers.set('report.snapshot', async (ctx: JobContext): Promise<JobResult> => {
    const payload = ctx.payload ?? {};
    const dateFrom = (payload['dateFrom'] as string) ?? new Date().toISOString().slice(0, 10);
    const dateTo = (payload['dateTo'] as string) ?? dateFrom;
    const [row] = await db.db.execute<{ total: number }>(sql`
      select count(*)::int as total from report_snapshots
      where date_from = ${dateFrom}::date and date_to = ${dateTo}::date
    `).then((r) => (r as unknown as { rows: { total: number }[] }).rows ?? []);
    return {
      message: `Kỳ ${dateFrom} → ${dateTo}: hiện có ${row?.total ?? 0} bản chốt số liệu`,
      dateFrom,
      dateTo,
    };
  });

  /* ------------------------------------------------------------ CSDL */

  handlers.set('db.backup', async (ctx?: JobContext): Promise<JobResult> => {
    /*
     * Sao lưu logic TOÀN BỘ CSDL (mọi bảng trong schema public, kể cả phiếu HSBA,
     * chữ ký, nhật ký, bản chốt báo cáo…) ra tệp JSON nén gzip.
     *  - Đọc trong một giao dịch REPEATABLE READ, READ ONLY → ảnh chụp nhất quán.
     *  - Đọc từng lô 1.000 dòng theo ctid và ghi dạng luồng → không ngốn RAM.
     *  - Tự xoá bản cũ, giữ lại `keep` bản mới nhất (payload.keep, mặc định 14).
     * Bản vá trước chỉ sao 17 bảng danh mục, bỏ sót toàn bộ dữ liệu phiếu HSBA.
     */
    const dir = config.storage.backupsDir;
    // Nhãn tuỳ chọn gắn vào tên tệp (vd "thu-cong") — chỉ chữ thường, số, gạch ngang
    const fileName = backupFileName(String((ctx?.payload as { label?: unknown } | undefined)?.label ?? ''));
    const fullPath = path.join(dir, fileName);
    const keepRaw = Number((ctx?.payload as { keep?: unknown } | undefined)?.keep ?? 14);
    const keep = Number.isFinite(keepRaw) && keepRaw >= 1 ? Math.floor(keepRaw) : 14;

    const { counts, totalRows, size } = await db.db.transaction(
      async (tx) => writeBackup(tx as unknown as SqlExecutor, fullPath),
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    );

    // Giữ lại `keep` bản mới nhất
    const removed = rotateBackups(dir, keep, [fileName]);
    const olds = removed.map((f) => ({ f }));
    const sizeText = formatBytes(size);
    logger.log(`Sao lưu CSDL: ${fileName} — ${Object.keys(counts).length} bảng, ${totalRows} dòng, ${sizeText}`);
    return {
      message: `Đã sao lưu ${Object.keys(counts).length} bảng · ${totalRows.toLocaleString('vi-VN')} dòng · ${sizeText} → ${fileName}${olds.length ? ` (đã xoá ${olds.length} bản cũ, giữ ${keep})` : ''}`,
      fileName,
      size,
      totalRows,
      counts,
      removed: olds.map((o) => o.f),
    };
  });

  /* ------------------------------------------------------------ Tài sản */

  handlers.set('asset.due-reminder', async (ctx?: JobContext): Promise<JobResult> => {
    const days = Number((ctx?.payload as { days?: unknown } | undefined)?.days ?? 15);
    return runAssetDueReminder(db, Number.isFinite(days) ? days : 15);
  });

  /* ------------------------------------------------------------ Hàng đợi */

  handlers.set('jobs.stats', async (): Promise<JobResult> => {
    const rows = await db.db
      .select({ total: sql<number>`count(*)::int` })
      .from(scheduledJobs)
      .where(eq(scheduledJobs.active, true));
    return { message: `Có ${rows[0]?.total ?? 0} tác vụ định kỳ đang bật` };
  });

  return handlers;
}

/** Đăng ký toàn bộ hàm xử lý có sẵn vào hàng đợi */
export function registerBuiltinHandlers(
  queue: { registerHandler: (code: string, handler: JobHandler) => void },
  deps: HandlerDeps,
): Map<string, JobHandler> {
  const handlers = builtinHandlers(deps);
  for (const [code, handler] of handlers) queue.registerHandler(code, handler);
  return handlers;
}

/** Dọn các lần chạy cũ (giữ lịch sử gọn) */
export async function pruneJobRuns(db: DbService, keepDays = 90): Promise<number> {
  const cutoff = new Date(Date.now() - keepDays * 86_400_000);
  const res = await db.db.execute(sql`delete from job_runs where started_at < ${cutoff}`);
  return (res as unknown as { rowCount?: number }).rowCount ?? 0;
}

export { lt };
