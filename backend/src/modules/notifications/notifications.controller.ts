import {
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Query,
} from '@nestjs/common';
import { IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { and, desc, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { Inject } from '@nestjs/common';
import { DB, type Database } from '../../db/db.service';
import { notifications } from '../../db/schema';
import { CurrentUser } from '../../common/decorators';
import type { AccessContext } from '../../common/types/access-context';

/**
 * Thông báo trong ứng dụng. Mọi phân hệ tạo thông báo qua
 * {@link NotificationCenterService.notify} — controller này chỉ phục vụ đọc/lọc.
 */

/**
 * Tham số lọc thông báo. page/pageSize bật chế độ phân trang (trang /thong-bao);
 * không truyền thì giữ hành vi cũ (limit phẳng) cho nút chuông 🔔.
 */
class NotificationQueryDto {
  @ApiProperty({ required: false, description: "'true' = chỉ tin chưa đọc (tương thích cũ)" })
  @IsOptional()
  @IsString()
  unreadOnly?: string;

  @ApiProperty({ required: false, enum: ['all', 'read', 'unread'], description: 'Lọc theo trạng thái đọc' })
  @IsOptional()
  @IsString()
  read?: 'all' | 'read' | 'unread';

  @ApiProperty({ required: false, description: 'Lọc theo mã mô-đun (HSBA, ASSET…)' })
  @IsOptional()
  @IsString()
  module?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  limit?: string;

  // FE truyền số — transformer tự ép kiểu qua @Type
  @ApiProperty({ required: false, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page = 1;

  @ApiProperty({ required: false, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(100)
  pageSize = 20;
}

@ApiTags('Thông báo')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(@Inject(DB) private readonly db: Database) {}

  @Get()
  @ApiOperation({ summary: 'Thông báo của tôi (lọc module / trạng thái đọc, phân trang)' })
  async list(@CurrentUser() user: AccessContext, @Query() query: NotificationQueryDto) {
    const where = [eq(notifications.userId, user.id)];
    if (query.unreadOnly === 'true' || query.read === 'unread') where.push(isNull(notifications.readAt));
    if (query.read === 'read') where.push(isNotNull(notifications.readAt));
    if (query.module) where.push(eq(notifications.module, query.module.toUpperCase()));
    const condition = and(...where);

    // Nhóm nút chuông 🔔 dùng limit — trả về phẳng như cũ; trang /thong-bao dùng page/pageSize
    if (query.limit !== undefined && query.page === undefined) {
      const rows = await this.db
        .select()
        .from(notifications)
        .where(condition)
        .orderBy(desc(notifications.createdAt))
        .limit(Math.min(Number(query.limit) || 50, 200));
      const [count] = await this.db
        .select({
          total: sql<number>`count(*)::int`,
          unread: sql<number>`count(*) filter (where ${notifications.readAt} is null)::int`,
        })
        .from(notifications)
        .where(eq(notifications.userId, user.id));
      return { items: rows, total: count?.total ?? 0, unread: count?.unread ?? 0 };
    }

    const [count] = await this.db
      .select({
        total: sql<number>`count(*)::int`,
        unread: sql<number>`count(*) filter (where ${notifications.readAt} is null)::int`,
      })
      .from(notifications)
      .where(eq(notifications.userId, user.id));
    const [filtered] = await this.db
      .select({ total: sql<number>`count(*)::int` })
      .from(notifications)
      .where(condition);
    const rows = await this.db
      .select()
      .from(notifications)
      .where(condition)
      .orderBy(desc(notifications.createdAt))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);
    const total = filtered?.total ?? 0;
    return {
      items: rows,
      total,
      page: query.page,
      pageSize: query.pageSize,
      totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      unread: count?.unread ?? 0,
      grandTotal: count?.total ?? 0,
    };
  }

  @Get('modules')
  @ApiOperation({ summary: 'Danh sách mô-đun đã phát thông báo (dựng bộ lọc trang thông báo)' })
  async modules(@CurrentUser() user: AccessContext) {
    const rows = await this.db
      .select({ module: notifications.module, total: sql<number>`count(*)::int` })
      .from(notifications)
      .where(eq(notifications.userId, user.id))
      .groupBy(notifications.module)
      .orderBy(notifications.module);
    return { items: rows.filter((r) => r.module) };
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Đánh dấu đã đọc' })
  async read(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AccessContext) {
    await this.db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.id, id), eq(notifications.userId, user.id)));
    return { read: true };
  }

  @Patch('read-all')
  @ApiOperation({ summary: 'Đánh dấu đã đọc tất cả' })
  async readAll(@CurrentUser() user: AccessContext) {
    await this.db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.userId, user.id), isNull(notifications.readAt)));
    return { read: true };
  }

  @Delete('read')
  @ApiOperation({ summary: 'Xoá tất cả thông báo đã đọc của tôi' })
  async removeRead(@CurrentUser() user: AccessContext) {
    const changed = await this.db
      .delete(notifications)
      .where(and(eq(notifications.userId, user.id), isNotNull(notifications.readAt)))
      .returning({ id: notifications.id });
    return { deleted: changed.length };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Xoá thông báo' })
  async remove(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AccessContext) {
    await this.db
      .delete(notifications)
      .where(and(eq(notifications.id, id), eq(notifications.userId, user.id)));
    return { deleted: true };
  }
}
