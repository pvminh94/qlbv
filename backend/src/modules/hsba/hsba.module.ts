/**
 * Phân hệ Hồ sơ bệnh án.
 *
 * Ngoài CRUD, module còn đăng ký các tác vụ hàng đợi phát thông báo cho bước ký
 * kế tiếp — chạy nền nên thao tác ký luôn phản hồi tức thì.
 */
import { Injectable, Logger, Module, type OnModuleInit } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { DbService } from '../../db/db.service';
import {
  hsbaRequests,
  permissions,
  rolePermissions,
  userRoles,
  users,
} from '../../db/schema';
import { QueueService } from '../../infra/queue/queue.service';
import { NotificationCenterService } from '../notifications/notification-center.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { PrintingModule } from '../printing/printing.module';
import { HsbaRequestController, HsbaWorkflowController } from './hsba.controller';
import { signPermissionOf } from './sign-permissions';
import { HsbaService } from './hsba.service';

@Injectable()
export class HsbaQueueHandlers implements OnModuleInit {
  private readonly logger = new Logger(HsbaQueueHandlers.name);

  constructor(
    private readonly queue: QueueService,
    private readonly db: DbService,
    private readonly center: NotificationCenterService,
  ) {}

  onModuleInit(): void {
    this.queue.registerHandler('hsba.notifyNextStep', async (ctx) => {
      const { requestId, code, stepKey, stepName } = ctx.payload as {
        requestId: number;
        code: string;
        stepKey: string;
        stepName: string;
      };
      const targets = await this.usersWhoCanSign(stepKey);
      if (targets.length === 0) {
        this.logger.warn(`Bước ${stepKey} chưa có người được phân quyền ký`);
        return { message: `Không có người nhận cho bước ${stepName}` };
      }
      await this.center.notify(targets, {
        title: `Có phiếu chờ bạn ký: ${code}`,
        body: `Phiếu đề nghị sửa HSBA ${code} đang chờ bạn xử lý ở bước \"${stepName}\".`,
        level: 'INFO',
        link: `/ho-so-benh-an/${requestId}`,
        module: 'HSBA',
        entityId: String(requestId),
        externalKind: 'hsba.nextStep',
      });
      return { message: `Đã thông báo cho ${targets.length} người ở bước ${stepName}` };
    });

    this.queue.registerHandler('hsba.notifyReturned', async (ctx) => {
      const { requestId, code, reason } = ctx.payload as {
        requestId: number;
        code: string;
        reason: string;
      };
      const [row] = await this.db.db
        .select({ requesterId: hsbaRequests.requesterId, createdBy: hsbaRequests.createdBy })
        .from(hsbaRequests)
        .where(eq(hsbaRequests.id, requestId));
      const userIds = [...new Set([row?.requesterId, row?.createdBy].filter((v): v is number => !!v))];
      if (userIds.length === 0) return { message: 'Không xác định được người nhận' };
      await this.center.notify(userIds, {
        title: `Phiếu ${code} bị trả lại`,
        body: `Trạng thái phiếu: trả về cho người đề nghị. Lý do: ${reason}. Vui lòng chỉnh sửa và gởi lại khi sẵn sàng.`,
        level: 'WARNING',
        link: `/ho-so-benh-an/${requestId}`,
        module: 'HSBA',
        entityId: String(requestId),
        externalKind: 'hsba.returned',
      });
      return { message: `Đã thông báo trả lại phiếu ${code}` };
    });

    this.queue.registerHandler('hsba.notifyComment', async (ctx) => {
      const { requestId, code, commenter, userIds } = ctx.payload as {
        requestId: number;
        code: string;
        commenter: string;
        userIds: number[];
      };
      const targets = (userIds ?? []).filter((id) => typeof id === 'number');
      if (targets.length === 0) return { message: 'Không có đối tượng cần thông báo bình luận' };
      await this.center.notify(targets, {
        title: `Trao đổi mới trên phiếu ${code}`,
        body: `${commenter} vừa trao đổi về phiếu đề nghị sửa HSBA này.`,
        level: 'INFO',
        link: `/ho-so-benh-an/${requestId}`,
        module: 'HSBA',
        entityId: String(requestId),
      });
      return { message: `Đã thông báo bình luận cho ${targets.length} người` };
    });

    this.queue.registerHandler('hsba.notifyCompleted', async (ctx) => {
      const { requestId, code } = ctx.payload as { requestId: number; code: string };
      const [row] = await this.db.db
        .select({ requesterId: hsbaRequests.requesterId, createdBy: hsbaRequests.createdBy })
        .from(hsbaRequests)
        .where(eq(hsbaRequests.id, requestId));
      const userIds = [...new Set([row?.requesterId, row?.createdBy].filter((v): v is number => !!v))];
      if (userIds.length === 0) return { message: 'Không xác định được người nhận' };
      await this.center.notify(userIds, {
        title: `Phiếu ${code} đã được duyệt thành công`,
        body: 'Hồ sơ bệnh án điện tử đã được sửa theo đề nghị của bạn.',
        level: 'SUCCESS',
        link: `/ho-so-benh-an/${requestId}`,
        module: 'HSBA',
        entityId: String(requestId),
        externalKind: 'hsba.completed',
      });
      return { message: `Đã thông báo hoàn tất ${code}` };
    });
  }

  /**
   * Những người có quyền ký ở bước này (suy ra từ tên bước: hsba.request.sign-<bước>).
   * Vì quyền được gán theo vai trò nên chỉ cần tra bảng trung gian.
   */
  private async usersWhoCanSign(stepKey: string): Promise<number[]> {
    const permissionCode = signPermissionOf(stepKey);
    const rows = await this.db.db
      .selectDistinct({ userId: userRoles.userId })
      .from(permissions)
      .innerJoin(rolePermissions, eq(rolePermissions.permissionId, permissions.id))
      .innerJoin(userRoles, eq(userRoles.roleId, rolePermissions.roleId))
      .innerJoin(users, eq(users.id, userRoles.userId))
      .where(
        and(
          eq(permissions.code, permissionCode),
          eq(users.active, true),
          isNull(users.deletedAt),
        ),
      );
    return rows.map((r) => r.userId);
  }
}

@Module({
  imports: [PrintingModule, NotificationsModule],
  controllers: [HsbaWorkflowController, HsbaRequestController],
  providers: [HsbaService, HsbaQueueHandlers],
  exports: [HsbaService],
})
export class HsbaModule {}
