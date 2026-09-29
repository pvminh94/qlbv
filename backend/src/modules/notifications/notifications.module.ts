/**
 * Trung tâm thông báo.
 *
 * Gồm hai phần:
 *  - `NotificationCenterService`: API nội bộ — mọi phân hệ nghiệp vụ gọi `notify()`
 *    để đồng bộ 3 lớp: lưu DB, phát SSE tức thời (toast nổi), fan-out kênh ngoài;
 *  - `NotificationsController`: REST API cho chuông 🔔 và trang /thong-bao.
 */
import { Module } from '@nestjs/common';
import { NotifyChannelsModule } from '../notify-channels/notify-channels.module';
import { NotificationCenterService } from './notification-center.service';
import { NotificationsController } from './notifications.controller';

@Module({
  imports: [NotifyChannelsModule],
  controllers: [NotificationsController],
  providers: [NotificationCenterService],
  exports: [NotificationCenterService],
})
export class NotificationsModule {}
