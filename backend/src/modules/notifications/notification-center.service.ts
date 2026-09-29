/**
 * Trung tâm thông báo — ĐIỂM GỞI DUY NHẤT cho mọi sự kiện cần báo người dùng.
 *
 * Một lời gọi `notify()` = 3 lớp đồng bỘ:
 *  1. Lưu DB (bền — list Trung tâm thông báo + chuông 🔔 trên thanh công cụ);
 *  2. Phát SSE tức thời kèm NỘI DUNG (toast nổi trên màn hình không cần tải lại);
 *  3. Fan-out kênh ngoài (Telegram) — tuỳ chọn, bỏ qua im lặng nếu chưa bật.
 *
 * Các phân hệ nghiệp vụ KHÔNG tự insert bảng notifications nữa mà dùng hàm này.
 */
import { Injectable, Logger } from '@nestjs/common';
import { DbService } from '../../db/db.service';
import { notifications } from '../../db/schema';
import { RealtimeService } from '../realtime/realtime.service';
import type { ExternalNotifyPayload, NotifyEventKind } from '../notify-channels/notify-channels.module';
import { NotifyDeliveryService } from '../notify-channels/notify-channels.module';

export interface NotifyInput {
  title: string;
  body: string;
  /** INFO | SUCCESS | WARNING | ERROR — quyết định màu toast/icon trên FE */
  level?: 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR';
  /** Đường dẫn ứng dụng khi bấm vào thông báo (vd /ho-so-benh-an/12), rỗng = không có */
  link?: string;
  module?: string;
  entityId?: string;
  /** Nếu khai báo, sự kiện sẽ fan-out thêm sang kênh ngoài (Telegram) có cùng nội dung */
  externalKind?: NotifyEventKind;
}

@Injectable()
export class NotificationCenterService {
  private readonly logger = new Logger(NotificationCenterService.name);

  constructor(
    private readonly db: DbService,
    private readonly realtime: RealtimeService,
    private readonly delivery: NotifyDeliveryService,
  ) {}

  /** Gởi một thông báo tới nhiều người dùng (tự loại trùng & bỏ id không hợp lệ). */
  async notify(userIds: Array<number | null | undefined>, input: NotifyInput): Promise<void> {
    const targets = [...new Set(userIds.filter((v): v is number => typeof v === 'number' && v > 0))];
    if (targets.length === 0) return;
    const level = input.level ?? 'INFO';
    const link = input.link ?? '';
    const module = input.module ?? '';
    const entityId = input.entityId ?? '';

    try {
      await this.db.db.insert(notifications).values(
        targets.map((userId) => ({
          userId,
          title: input.title,
          body: input.body,
          level,
          link,
          module,
          entityId,
        })),
      );
    } catch (err) {
      this.logger.error(`Lưu thông báo thất bại: ${(err as Error).message}`);
      return; // ghi DB lỗi thì khả năng cao cả 3 lớp đều không nên tiếp tục (tránh spam lệch)
    }

    // Lớp 2: realtime kèm nội dung để FE hiện toast ngay, không cần query lại
    this.realtime.publish({
      topic: 'notification',
      type: 'new',
      userIds: targets,
      data: { title: input.title, body: input.body, level, link, module },
    });

    // Lớp 3: kênh ngoài — chạy nền, lỗi chỉ log
    if (input.externalKind) {
      void this.delivery
        .deliver(targets, {
          kind: input.externalKind,
          title: input.title,
          body: input.body,
          link,
        } satisfies ExternalNotifyPayload)
        .catch((err: Error) => this.logger.warn(`Kênh ngoài lỗi (bỏ qua): ${err.message}`));
    }
  }
}
