/**
 * Studio — ấn bản định kỳ (subscription).
 *
 * Người dùng đăng ký nhận file Excel dựng từ một trang Studio (dashboard/báo cáo)
 * theo lịch: hằng ngày / hằng tuần (thứ Hai) / hằng tháng (mùng 1) vào một giờ
 * cố định (giờ máy chủ). Tác vụ hàng đợi `STUDIO_SUBSCRIPTIONS` (mỗi 5 phút)
 * rà các bản ghi đến hạn, dựng file bằng quyền của chính người đăng ký và gửi
 * thông báo kèm ấn bản tải được. Vì vậy số liệu trong ấn bản luôn tôn trọng
 * phân quyền/phạm vi khoa như khi người đó tự mở trang.
 */
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import { and, desc, eq, isNotNull, lte, sql } from 'drizzle-orm';
import * as ExcelJS from 'exceljs';
import * as fs from 'fs';
import * as path from 'path';
import { config } from '../../config/env';
import { DbService } from '../../db/db.service';
import {
  notifications,
  studioDashboards,
  studioSubscriptionFiles,
  studioSubscriptions,
  STUDIO_SUB_FREQUENCY_LABELS,
  StudioScope,
  StudioSubFrequency,
  type StudioWidget,
} from '../../db/schema';
import type { AccessContext } from '../../common/types/access-context';
import { AuthService } from '../auth/auth.service';
import { SchedulerService } from '../scheduler/scheduler.service';
import { StudioQueryService } from './studio-query.service';
import { StudioService } from './studio.service';
import type { StudioDataSpec, StudioQueryResult } from './studio.types';

export type StudioSubscriptionRow = typeof studioSubscriptions.$inferSelect;
export type StudioSubscriptionFileRow = typeof studioSubscriptionFiles.$inferSelect;

const MAX_SUBS_PER_USER = 10;
/** Không dựng quá nhiều ấn bản trong một lượt rà (tránh nghẽn hàng đợi) */
const MAX_DISPATCH_PER_TICK = 20;
/** Số dòng tối đa mỗi sheet khi xuất */
const EXPORT_LIMIT = 2000;

/** Tính thờI điểm phát hành kế tiếp từ `after` (mặc định: bây giờ) */
export function nextRunAfter(frequency: StudioSubFrequency, hourOfDay: number, after = new Date()): Date {
  const d = new Date(after);
  const at = (day: Date) => new Date(day.getFullYear(), day.getMonth(), day.getDate(), hourOfDay, 0, 0, 0);
  if (frequency === StudioSubFrequency.DAILY) {
    const today = at(d);
    if (today.getTime() > d.getTime()) return today;
    const t = at(d);
    t.setDate(t.getDate() + 1);
    return t;
  }
  if (frequency === StudioSubFrequency.WEEKLY) {
    // Thứ Hai kế tiếp (getDay: 0=CN..6=T7)
    for (let i = 0; i < 8; i++) {
      const cand = at(d);
      cand.setDate(cand.getDate() + i);
      if (cand.getDay() === 1 && cand.getTime() > d.getTime()) return cand;
    }
  }
  if (frequency === StudioSubFrequency.MONTHLY) {
    const cand = new Date(d.getFullYear(), d.getMonth(), 1, hourOfDay, 0, 0, 0);
    if (cand.getTime() > d.getTime()) return cand;
    return new Date(d.getFullYear(), d.getMonth() + 1, 1, hourOfDay, 0, 0, 0);
  }
  return new Date(d.getTime() + 86_400_000);
}

@Injectable()
export class StudioSubscriptionsService implements OnModuleInit {
  private readonly logger = new Logger(StudioSubscriptionsService.name);

  constructor(
    private readonly db: DbService,
    private readonly engine: StudioQueryService,
    private readonly studio: StudioService,
    private readonly auth: AuthService,
    private readonly scheduler: SchedulerService,
  ) {}

  onModuleInit(): void {
    // Đăng ký hàm xử lý qua SchedulerService (bọc tracked → ghi lịch sử chạy tác vụ).
    // Job STUDIO_SUBSCRIPTIONS (seed) gọi handler này; hàng đợi inline chạy mỗi 5 phút.
    this.scheduler.registerHandler('studio.subscription-dispatch', async () => this.dispatch());
  }

  private exportsDir(): string {
    const dir = path.join(config.storage.exportsDir, 'studio');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  /* ------------------------------------------------------------ Đọc */

  /** Đăng ký của tôi (kèm tên trang + lịch) */
  async listMine(user: AccessContext) {
    const rows = await this.db.db
      .select({
        sub: studioSubscriptions,
        pageName: studioDashboards.name,
        pageKind: studioDashboards.kind,
      })
      .from(studioSubscriptions)
      .leftJoin(studioDashboards, eq(studioDashboards.id, studioSubscriptions.pageId))
      .where(eq(studioSubscriptions.userId, user.id))
      .orderBy(desc(studioSubscriptions.updatedAt));
    return rows.map((r) => ({ ...r.sub, pageName: r.pageName ?? '(trang đã xoá)', pageKind: r.pageKind }));
  }

  /** Ấn bản (file) đã phát hành cho tôi */
  async listFiles(user: AccessContext, limit = 30) {
    return this.db.db
      .select()
      .from(studioSubscriptionFiles)
      .where(eq(studioSubscriptionFiles.userId, user.id))
      .orderBy(desc(studioSubscriptionFiles.createdAt))
      .limit(Math.min(limit, 100));
  }

  private assertFrequency(v: unknown): StudioSubFrequency {
    const f = String(v ?? '').toUpperCase();
    if (!Object.values(StudioSubFrequency).includes(f as StudioSubFrequency)) {
      throw new BadRequestException(`Tần suất \\\"${f}\\\" không hợp lệ (DAILY | WEEKLY | MONTHLY)`);
    }
    return f as StudioSubFrequency;
  }

  private assertHour(v: unknown): number {
    const h = Number(v ?? 6);
    if (!Number.isInteger(h) || h < 0 || h > 23) throw new BadRequestException('Giờ phát hành phải trong khoảng 0–23');
    return h;
  }

  /* ------------------------------------------------------------ Ghi */

  async create(user: AccessContext, body: { pageId?: number; label?: string; frequency?: string; hourOfDay?: number }) {
    const pageId = Number(body.pageId);
    if (!pageId) throw new BadRequestException('Thiếu trang cần đăng ký');
    // Phải được xem trang (tôn trọng phạm vi PERSONAL/ROLE/SYSTEM)
    await this.studio.get(user, pageId);

    const [{ n: count }] = await this.db.db
      .select({ n: sql<number>`count(*)::int` })
      .from(studioSubscriptions)
      .where(eq(studioSubscriptions.userId, user.id));
    if ((count ?? 0) >= MAX_SUBS_PER_USER) {
      throw new BadRequestException(`Tối đa ${MAX_SUBS_PER_USER} đăng ký cho một tài khoản`);
    }

    const frequency = this.assertFrequency(body.frequency ?? 'DAILY');
    const hourOfDay = this.assertHour(body.hourOfDay ?? 6);
    const [dup] = await this.db.db
      .select({ id: studioSubscriptions.id })
      .from(studioSubscriptions)
      .where(and(
        eq(studioSubscriptions.pageId, pageId),
        eq(studioSubscriptions.userId, user.id),
        eq(studioSubscriptions.frequency, frequency),
        eq(studioSubscriptions.hourOfDay, hourOfDay),
      ))
      .limit(1);
    if (dup) throw new BadRequestException('Bạn đã có đăng ký cùng trang, cùng lịch này rồi');

    const [row] = await this.db.db
      .insert(studioSubscriptions)
      .values({
        pageId,
        userId: user.id,
        label: String(body.label ?? '').trim().slice(0, 160),
        frequency,
        hourOfDay,
        nextRunAt: nextRunAfter(frequency, hourOfDay),
      })
      .returning();
    return row;
  }

  async update(user: AccessContext, id: number, body: { label?: string; frequency?: string; hourOfDay?: number; active?: boolean }) {
    const sub = await this.getOwned(user, id);
    const patch: Partial<typeof studioSubscriptions.$inferInsert> = { updatedAt: new Date() };
    if (body.label !== undefined) patch.label = String(body.label).trim().slice(0, 160);
    if (body.frequency !== undefined) patch.frequency = this.assertFrequency(body.frequency);
    if (body.hourOfDay !== undefined) patch.hourOfDay = this.assertHour(body.hourOfDay);
    if (body.active !== undefined) patch.active = !!body.active;
    // Tính lại lịch nếu đổi tần suất/giờ, hoặc kích hoạt lại mà lịch đã qua
    const freq = (patch.frequency ?? sub.frequency) as StudioSubFrequency;
    const hour = patch.hourOfDay ?? sub.hourOfDay;
    if (patch.frequency !== undefined || patch.hourOfDay !== undefined ||
        (patch.active === true && (!sub.nextRunAt || sub.nextRunAt.getTime() < Date.now()))) {
      patch.nextRunAt = nextRunAfter(freq, hour);
      patch.lastError = '';
      patch.lastStatus = 'PENDING';
    }
    const [row] = await this.db.db
      .update(studioSubscriptions)
      .set(patch)
      .where(eq(studioSubscriptions.id, id))
      .returning();
    return row;
  }

  private async getOwned(user: AccessContext, id: number): Promise<StudioSubscriptionRow> {
    const [sub] = await this.db.db
      .select()
      .from(studioSubscriptions)
      .where(eq(studioSubscriptions.id, id))
      .limit(1);
    if (!sub) throw new NotFoundException('Không tìm thấy đăng ký');
    if (sub.userId !== user.id && !this.studio.isStudioAdmin(user)) {
      throw new ForbiddenException('Đây là đăng ký của người khác');
    }
    return sub;
  }

  async remove(user: AccessContext, id: number) {
    const sub = await this.getOwned(user, id);
    await this.db.db.delete(studioSubscriptions).where(eq(studioSubscriptions.id, sub.id));
    return { id: sub.id };
  }

  /* ------------------------------------------- Dựng ấn bản & phát hành */

  /** Chạy thử một đăng ký ngay (không đổi lịch định kỳ) */
  async runNow(user: AccessContext, id: number) {
    const sub = await this.getOwned(user, id);
    const file = await this.generate(sub, 'manual');
    return file;
  }

  /** Tải ấn bản (chủ sở hữu hoặc quản trị) */
  async fileForDownload(user: AccessContext, fileId: number) {
    const [file] = await this.db.db
      .select()
      .from(studioSubscriptionFiles)
      .where(eq(studioSubscriptionFiles.id, fileId))
      .limit(1);
    if (!file) throw new NotFoundException('Không tìm thấy ấn bản');
    if (file.userId !== user.id && !this.studio.isStudioAdmin(user)) {
      throw new ForbiddenException('Ấn bản này thuộc về người khác');
    }
    const abs = path.join(this.exportsDir(), file.filePath);
    if (!file.filePath || !fs.existsSync(abs)) {
      throw new NotFoundException('Tệp ấn bản không còn trên máy chủ (đã quá hạn lưu trữ)');
    }
    return { abs, fileName: file.fileName };
  }

  /** Hàng đợi gọi định kỳ: rà đăng ký đến hạn và phát hành */
  async dispatch(): Promise<{ message: string; generated: number; failed: number }> {
    const due = await this.db.db
      .select()
      .from(studioSubscriptions)
      .where(and(
        eq(studioSubscriptions.active, true),
        isNotNull(studioSubscriptions.nextRunAt),
        lte(studioSubscriptions.nextRunAt, new Date()),
      ))
      .orderBy(studioSubscriptions.nextRunAt)
      .limit(MAX_DISPATCH_PER_TICK);

    let generated = 0;
    let failed = 0;
    for (const sub of due) {
      try {
        await this.generate(sub, 'queue');
        generated++;
      } catch (err) {
        failed++;
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`Ấn bản #${sub.id} lỗi: ${msg}`);
        await this.db.db
          .update(studioSubscriptions)
          .set({
            lastStatus: 'FAILED',
            lastError: msg.slice(0, 500),
            lastRunAt: new Date(),
            nextRunAt: nextRunAfter(sub.frequency as StudioSubFrequency, sub.hourOfDay),
          })
          .where(eq(studioSubscriptions.id, sub.id));
      }
    }
    return { message: `Đã phát hành ${generated} ấn bản${failed ? `, ${failed} lỗi` : ''}`, generated, failed };
  }

  /**
   * Dựng file Excel từ bố cục trang (mỗi ô dữ liệu = 1 sheet) bằng quyền
   * của người đăng ký, lưu đĩa + ghi nhận + gửi thông báo.
   */
  private async generate(sub: StudioSubscriptionRow, trigger: 'queue' | 'manual'): Promise<StudioSubscriptionFileRow> {
    const [page] = await this.db.db
      .select()
      .from(studioDashboards)
      .where(eq(studioDashboards.id, sub.pageId))
      .limit(1);
    if (!page) throw new NotFoundException('Trang Studio gốc không còn tồn tại');

    const ctx = await this.auth.buildSystemContext(sub.userId, `studio-sub-${sub.id}`);
    if (!ctx) throw new ForbiddenException('Tài khoản đăng ký đã bị vô hiệu');
    // Tôn trọng sự thay đổi phạm vi: người đăng ký không còn được xem trang thì thôi
    if (page.scope === StudioScope.PERSONAL && page.ownerId !== sub.userId && !this.studio.isStudioAdmin(ctx)) {
      throw new ForbiddenException('Trang cá nhân đã đổi chủ');
    }
    if (page.scope === StudioScope.ROLE && !ctx.roles.includes(page.roleCode) && !this.studio.isStudioAdmin(ctx)) {
      throw new ForbiddenException('Bạn không còn thuộc vai trò của trang này');
    }

    /* --- dựng workbook --- */
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Studio';
    const widgets = (page.layout?.widgets ?? []).filter((w: StudioWidget) => w.dataSpec?.source);
    const usedNames = new Set<string>();
    let sheets = 0;
    let totalRows = 0;

    for (const w of widgets) {
      const spec = w.dataSpec as StudioDataSpec;
      let result: StudioQueryResult;
      try {
        result = await this.engine.run({ ...spec, limit: EXPORT_LIMIT, mode: undefined } as StudioDataSpec, ctx);
      } catch (err) {
        // Ô lỗi → sheet ghi lỗi (người nhận vẫn có file để xem các ô còn lại)
        const ws = wb.addWorksheet(this.sheetName(usedNames, w.title || 'Loi'));
        ws.addRow([`Ô "${w.title}" lỗi: ${err instanceof Error ? err.message : String(err)}`]);
        sheets++;
        continue;
      }
      const ws = wb.addWorksheet(this.sheetName(usedNames, w.title || `O ${w.id}`));
      ws.addRow(result.columns.map((c) => c.label)).font = { bold: true };
      for (const row of result.rows) {
        ws.addRow(result.columns.map((c) => row[c.key] as never));
      }
      result.columns.forEach((_c, i) => { ws.getColumn(i + 1).width = 22; });
      sheets++;
      totalRows += result.rows.length;
    }
    if (!sheets) {
      const ws = wb.addWorksheet('Thong tin');
      ws.addRow([`Trang "${page.name}" không có ô dữ liệu nào để xuất.`]);
    }

    /* --- lưu đĩa --- */
    const stamp = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const name = `${pad(stamp.getDate())}${pad(stamp.getMonth() + 1)}${stamp.getFullYear()}-${pad(stamp.getHours())}${pad(stamp.getMinutes())}${pad(stamp.getSeconds())}`;
    const safeTitle = page.name.replace(/[\\\\/:*?"<>|]/g, '').replace(/\\s+/g, '-').slice(0, 40) || 'trang';
    const fileName = `${safeTitle}-${name}.xlsx`;
    const rel = `sub-${sub.id}/${fileName}`;
    const abs = path.join(this.exportsDir(), rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    fs.writeFileSync(abs, buffer);

    /* --- ghi nhận + thông báo --- */
    const [file] = await this.db.db
      .insert(studioSubscriptionFiles)
      .values({
        subscriptionId: sub.id,
        userId: sub.userId,
        pageId: sub.pageId,
        pageName: page.name,
        fileName,
        filePath: rel,
        sizeBytes: buffer.length,
        trigger,
      })
      .returning();

    await this.db.db.insert(notifications).values({
      userId: sub.userId,
      title: `Ấn bản định kỳ: ${page.name}`,
      body: `${sub.label || STUDIO_SUB_FREQUENCY_LABELS[sub.frequency as StudioSubFrequency]} — ${sheets} bảng, ${totalRows} dòng. Vào mục Ấn bản định kỳ để tải về.`,
      level: 'INFO',
      link: page.kind === 'REPORT'
        ? `/bao-cao/tuy-bien/${sub.pageId}?an-ban=1`
        : `/dashboard?an-ban=1`,
      module: 'STUDIO',
      entityId: String(file.id),
    });

    await this.db.db
      .update(studioSubscriptions)
      .set({
        lastRunAt: new Date(),
        lastStatus: 'SUCCESS',
        lastError: '',
        runCount: sql`${studioSubscriptions.runCount} + 1`,
        nextRunAt: nextRunAfter(sub.frequency as StudioSubFrequency, sub.hourOfDay),
      })
      .where(eq(studioSubscriptions.id, sub.id));

    return file;
  }

  /** Tên sheet hợp lệ (≤31 ký tự, không ký tự cấm, không trùng) */
  private sheetName(used: Set<string>, raw: string): string {
    const base = raw.replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 28) || 'Sheet';
    let name = base;
    let i = 2;
    while (used.has(name.toLowerCase())) name = `${base.slice(0, 25)} ${i++}`;
    used.add(name.toLowerCase());
    return name;
  }
}
