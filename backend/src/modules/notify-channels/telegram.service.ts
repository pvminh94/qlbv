/**
 * Kênh Telegram — gửi thông báo tức thời đến điện thoại Người dùng, hoàn toàn miễn phí.
 *
 * Thiết kế:
 *  - Bật/tắt + Bot Token nằm trong Cấu hình hệ thống (nhóm Thông báo).
 *  - Người dùng tự liên kết một lần: trang Cá nhân sinh mã → mở bot gởi `/start <mã>`
 *    → hệ thống ghi `telegram_chat_id` vào hồ sơ Người dùng.
 *  - Máy chủ LAN không có địa chỉ công khai nên KHÔNG dùng webhook; thay vào đó
 *    long-polling `getUpdates` chạy ngay trong tiến trình API (đi ra ngoài là được,
 *    tường lửa không chặn). OFFSET được lưu vào bảng settings để khởi động lại
 *    không nhận lặp tin cũ.
 */
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { eq, inArray } from 'drizzle-orm';
import { DbService } from '../../db/db.service';
import { users } from '../../db/schema';
import { SettingsService } from '../settings/settings.service';

const TG_API = 'https://api.telegram.org';
const OFFSET_KEY = 'telegram.updateOffset';
const POLL_INTERVAL_MS = 3_000;
const LINK_CODE_TTL_MS = 10 * 60_000;
const LONG_POLL_TIMEOUT = 25; // giây — phía Telegram giữ kết nối chờ tin mới

interface TgUpdate {
  update_id: number;
  message?: {
    text?: string;
    chat?: { id: number };
    from?: { id: number; username?: string; first_name?: string };
  };
}

interface LinkCode {
  userId: number;
  username: string;
  expiresAt: number;
}

@Injectable()
export class TelegramService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TelegramService.name);
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight = false;
  private botUsername = '';
  /** Mã liên kết tạm thời trong bộ nhớ (10 phút, một tiến trình API) */
  private readonly linkCodes = new Map<string, LinkCode>();

  constructor(
    private readonly db: DbService,
    private readonly settings: SettingsService,
  ) {}

  onModuleInit(): void {
    this.scheduleNext(2_000); // chờ migrate/khởi động xong
  }

  onModuleDestroy(): void {
    if (this.timer) clearTimeout(this.timer);
  }

  /* ------------------------------------------------------------------ cấu hình */

  private async config(): Promise<{ enabled: boolean; token: string }> {
    const map = await this.settings.getMany(['telegram.enabled', 'telegram.botToken']);
    return { enabled: map['telegram.enabled'] === true, token: String(map['telegram.botToken'] ?? '') };
  }

  /** Username bot (điền sau lần polling đầu tiên) — đồng bộ để dựng deep-link */
  getBotUsername(): string {
    return this.botUsername;
  }

  /* ------------------------------------------------------------ liên kết tài khoản */

  /** Sinh mã liên kết 6 ký tự chữ-số cho Người dùng đang đăng nhập. */
  createLinkCode(userId: number, username: string): { code: string; expiresAt: Date } {
    // Huỷ mã cũ của cùng Người dùng
    for (const [k, v] of this.linkCodes) if (v.userId === userId) this.linkCodes.delete(k);
    const code = Math.random().toString(36).slice(2, 8).toUpperCase();
    const expiresAt = new Date(Date.now() + LINK_CODE_TTL_MS);
    this.linkCodes.set(code, { userId, username, expiresAt: expiresAt.getTime() });
    return { code, expiresAt };
  }

  /** Trạng thái liên kết hiện tại của một Người dùng. */
  async statusOf(userId: number): Promise<{ enabled: boolean; botUsername: string; linked: boolean }> {
    const { enabled, token } = await this.config();
    const [row] = await this.db.db
      .select({ chatId: users.telegramChatId })
      .from(users)
      .where(eq(users.id, userId));
    return { enabled: enabled && !!token, botUsername: this.botUsername, linked: !!row?.chatId };
  }

  async unlink(userId: number): Promise<void> {
    await this.db.db.update(users).set({ telegramChatId: null }).where(eq(users.id, userId));
  }

  /* ------------------------------------------------------------------ gởi tin */

  /** Gửi tin cho một danh sách Người dùng (bỏ qua ai chưa liên kết). Trả về số tin đã gởi. */
  async sendToUsers(userIds: number[], text: string): Promise<number> {
    const { enabled, token } = await this.config();
    if (!enabled || !token || userIds.length === 0) return 0;
    const rows = await this.db.db
      .select({ id: users.id, chatId: users.telegramChatId })
      .from(users)
      .where(inArray(users.id, userIds));
    let sent = 0;
    for (const row of rows) {
      if (!row.chatId) continue;
      const ok = await this.api(token, 'sendMessage', {
        chat_id: row.chatId,
        text,
        disable_web_page_preview: true,
      });
      if (ok) sent += 1;
    }
    if (sent > 0) this.logger.log(`Đã gởi ${sent} tin Telegram`);
    return sent;
  }

  private async api(token: string, method: string, body: Record<string, unknown>): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), LONG_POLL_TIMEOUT * 1000 + 5_000);
      const res = await fetch(`${TG_API}/bot${token}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timer);
      const data = (await res.json().catch(() => null)) as { ok?: boolean; description?: string } | null;
      if (!res.ok || !data?.ok) {
        this.logger.warn(`Telegram ${method} lỗi ${res.status}: ${data?.description ?? 'không rõ'}`);
        return false;
      }
      return true;
    } catch (err) {
      this.logger.warn(`Telegram ${method} không gọi được: ${(err as Error).message}`);
      return false;
    }
  }

  /* --------------------------------------------------------------- long polling */

  private scheduleNext(delay = POLL_INTERVAL_MS): void {
    this.timer = setTimeout(() => {
      void this.pollOnce()
        .catch((err) => this.logger.warn(`Polling Telegram lỗi: ${(err as Error).message}`))
        .finally(() => this.scheduleNext());
    }, delay);
  }

  private async pollOnce(): Promise<void> {
    if (this.inFlight) return;
    const { enabled, token } = await this.config();
    if (!enabled || !token) return;
    this.inFlight = true;
    try {
      // Xác định username bot (một lần) để dựng https://t.me/<bot>?start=
      if (!this.botUsername) {
        const me = await this.apiGet<{ result?: { username?: string } }>(token, 'getMe');
        const name = me?.result?.username;
        if (name) {
          this.botUsername = name;
          this.logger.log(`Kết nối Telegram Bot @${name} thành công`);
        } else {
          return; // token chưa đúng — thử lại chu kỳ sau
        }
      }
      const offset = await this.readOffset();
      const data = await this.apiGet<{ result?: TgUpdate[] }>(token, `getUpdates?offset=${offset}&timeout=${LONG_POLL_TIMEOUT}&allowed_updates=["message"]`);
      const updates = data?.result ?? [];
      let maxId = offset ? offset - 1 : 0;
      for (const up of updates) {
        maxId = Math.max(maxId, up.update_id);
        await this.handleUpdate(up, token);
      }
      if (maxId >= offset) await this.writeOffset(maxId + 1);
    } finally {
      this.inFlight = false;
    }
  }

  private async apiGet<T>(token: string, path: string): Promise<T | null> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), (LONG_POLL_TIMEOUT + 10) * 1000);
      const res = await fetch(`${TG_API}/bot${token}/${path}`, { signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) return null;
      return (await res.json()) as T;
    } catch {
      return null; // mạng chập chờn — chu kỳ sau gọi lại
    }
  }

  private async handleUpdate(up: TgUpdate, token: string): Promise<void> {
    const chatId = up.message?.chat?.id;
    const text = up.message?.text?.trim() ?? '';
    if (!chatId || !text.startsWith('/start')) return;
    const code = text.replace('/start', '').trim().toUpperCase();
    if (!code) {
      await this.api(token, 'sendMessage', {
        chat_id: chatId,
        text: 'Chào bạn! Để nhận thông báo từ hệ thống QLBS, vào trang Cá nhân trong phần mềm, bấm "Tạo mã liên kết Telegram", rồi gởi: /start <MÃ>',
      });
      return;
    }
    // Dọn mã hết hạn
    const now = Date.now();
    for (const [k, v] of this.linkCodes) if (v.expiresAt < now) this.linkCodes.delete(k);
    const link = this.linkCodes.get(code);
    if (!link) {
      await this.api(token, 'sendMessage', {
        chat_id: chatId,
        text: `Mã ${code} không đúng hoặc đã hết hạn. Vào trang Cá nhân tạo mã mới rồi thử lại nhé.`,
      });
      return;
    }
    this.linkCodes.delete(code);
    await this.db.db
      .update(users)
      .set({ telegramChatId: String(chatId) })
      .where(eq(users.id, link.userId));
    await this.api(token, 'sendMessage', {
      chat_id: chatId,
      text: `Liên kết thành công với tài khoản "${link.username}". Từ nay thông báo ký/duyệt phiếu sẽ được gởi tức thời về đây.`,
    });
    this.logger.log(`Người dùng ${link.username} (#${link.userId}) đã liên kết Telegram ${chatId}`);
  }

  /* ------------------------------------------------- lưu offset vào bảng settings */

  private async readOffset(): Promise<number> {
    return Number(await this.settings.get<number>(OFFSET_KEY, 0)) || 0;
  }

  private async writeOffset(offset: number): Promise<void> {
    await this.settings.set({
      key: OFFSET_KEY,
      value: offset,
      group: 'notification',
      label: 'Telegram polling offset (tự động)',
      valueType: 'number',
    });
  }
}
