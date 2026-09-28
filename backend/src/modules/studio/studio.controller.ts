/**
 * Studio — API thiết kế & dữ liệu cho dashboard/báo cáo tùy biến.
 *
 * `/studio/query` không gắn quyền tĩnh: quyền được kiểm tra theo TỪNG NGUỒN
 * dữ liệu trong engine (người được xem dashboard chia sẻ vẫn chỉ nhận số liệu
 * thuộc nguồn mình có quyền).
 */
import {
  Body, Controller, Delete, ForbiddenException, Get, HttpCode, Param, ParseIntPipe,
  Patch, Post, Put, Query, Res, StreamableFile,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import * as ExcelJS from 'exceljs';
import { CurrentUser, RequirePermissions } from '../../common/decorators';
import type { AccessContext } from '../../common/types/access-context';
import { StudioKind } from '../../db/schema';
import { describeSourcesFor } from './studio-datasources';
import { StudioQueryService } from './studio-query.service';
import { StudioService, type StudioSavePayload } from './studio.service';
import { StudioSubscriptionsService } from './studio-subscriptions.service';
import {
  STUDIO_AGG_LABELS, STUDIO_BUCKET_LABELS, STUDIO_DATE_PRESET_LABELS,
  STUDIO_FILTER_OP_LABELS, type StudioDataSpec,
} from './studio.types';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function kindOf(v?: string): StudioKind {
  return v === StudioKind.REPORT ? StudioKind.REPORT : StudioKind.DASHBOARD;
}
function viewPerm(kind: StudioKind) {
  return kind === StudioKind.REPORT ? 'studio.report.view' : 'studio.dashboard.view';
}
function managePerm(kind: StudioKind) {
  return kind === StudioKind.REPORT ? 'studio.report.manage' : 'studio.dashboard.manage';
}
function assertPerm(user: AccessContext, perm: string) {
  if (!user.isSuperAdmin && !user.permissions.includes(perm)) {
    throw new ForbiddenException(`Thiếu quyền ${perm}`);
  }
}

@ApiTags('Studio')
@ApiBearerAuth()
@Controller('studio')
export class StudioController {
  constructor(
    private readonly service: StudioService,
    private readonly engine: StudioQueryService,
    private readonly subscriptions: StudioSubscriptionsService,
  ) {}

  /* ---------------------------------------------------- Siêu dữ liệu */

  @Get('sources')
  @ApiOperation({ summary: 'Danh mục nguồn dữ liệu + trường (lọc theo quyền người dùng)' })
  sources(@CurrentUser() user: AccessContext) {
    return {
      sources: describeSourcesFor(user),
      vocabulary: {
        aggs: STUDIO_AGG_LABELS,
        filterOps: STUDIO_FILTER_OP_LABELS,
        datePresets: STUDIO_DATE_PRESET_LABELS,
        buckets: STUDIO_BUCKET_LABELS,
      },
    };
  }

  /* ------------------------------------------------------ Query engine */

  @Post('query')
  @HttpCode(200)
  @ApiOperation({ summary: 'Chạy đặc tả dữ liệu widget (whitelist — đã kiểm quyền nguồn)' })
  query(@Body() spec: StudioDataSpec, @CurrentUser() user: AccessContext) {
    return this.engine.run(spec, user);
  }

  @Post('query/export')
  @ApiOperation({ summary: 'Xuất kết quả đặc tả ra Excel (bảng phẳng)' })
  async export(
    @Body() body: StudioDataSpec & { title?: string },
    @CurrentUser() user: AccessContext,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.engine.run({ ...body, limit: 2000 }, user);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Du lieu');
    ws.addRow(result.columns.map((c) => c.label)).font = { bold: true };
    for (const row of result.rows) {
      ws.addRow(result.columns.map((c) => row[c.key] as never));
    }
    result.columns.forEach((_c, i) => { ws.getColumn(i + 1).width = 22; });
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    const title = (body.title || 'bao-cao-tuy-bien').replace(/[\\/:*?"<>|]/g, '').slice(0, 80) || 'bao-cao';
    res.set({
      'Content-Type': XLSX,
      'Content-Disposition': `attachment; filename="${encodeURIComponent(title)}.xlsx"`,
    });
    return new StreamableFile(buffer);
  }

  /* ------------------------------------------------------------- Trang */

  @Get('pages')
  @ApiOperation({ summary: 'Danh sách trang tôi được thấy (cá nhân + vai trò + hệ thống)' })
  list(@CurrentUser() user: AccessContext, @Query('kind') kind?: string) {
    const k = kindOf(kind);
    assertPerm(user, viewPerm(k));
    return this.service.list(user, k);
  }

  @Get('pages/default')
  @ApiOperation({ summary: 'Trang mặc định của tôi (cá nhân → vai trò → hệ thống)' })
  defaultPage(@CurrentUser() user: AccessContext, @Query('kind') kind?: string) {
    const k = kindOf(kind);
    assertPerm(user, viewPerm(k));
    return this.service.defaultFor(user, k);
  }

  @Get('pages/:id')
  get(@CurrentUser() user: AccessContext, @Param('id', ParseIntPipe) id: number) {
    return this.service.get(user, id);
  }

  @Post('pages')
  create(@Body() body: StudioSavePayload, @CurrentUser() user: AccessContext) {
    const k = kindOf(body.kind);
    // Trang cá nhân: đủ quyền xem; trang dùng chung (vai trò/hệ thống): cần quyền quản lý
    if (body.scope === 'SYSTEM' || body.scope === 'ROLE') assertPerm(user, managePerm(k));
    else assertPerm(user, viewPerm(k));
    return this.service.create(user, { ...body, kind: k });
  }

  @Put('pages/:id')
  async update(
    @Body() body: StudioSavePayload,
    @CurrentUser() user: AccessContext,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const row = await this.service.get(user, id);
    // Chủ trang cá nhân (canEdit trong service) không bắt buộc quyền quản lý
    if (row.scope !== 'PERSONAL' || row.ownerId !== user.id) assertPerm(user, managePerm(row.kind));
    return this.service.update(user, id, body);
  }

  @Delete('pages/:id')
  async remove(@CurrentUser() user: AccessContext, @Param('id', ParseIntPipe) id: number) {
    const row = await this.service.get(user, id);
    if (row.scope !== 'PERSONAL' || row.ownerId !== user.id) assertPerm(user, managePerm(row.kind));
    return this.service.remove(user, id);
  }

  @Post('pages/:id/duplicate')
  duplicate(@CurrentUser() user: AccessContext, @Param('id', ParseIntPipe) id: number) {
    return this.service.duplicate(user, id);
  }

  @Post('pages/:id/default')
  setDefault(
    @Body() body: { value?: boolean },
    @CurrentUser() user: AccessContext,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.service.setDefault(user, id, body?.value !== false);
  }

  /* ------------------------------------------- Ấn bản định kỳ (subscription) */

  @Get('subscriptions')
  @ApiOperation({ summary: 'Đăng ký ấn bản định kỳ của tôi' })
  listSubs(@CurrentUser() user: AccessContext) {
    return this.subscriptions.listMine(user);
  }

  @Post('subscriptions')
  createSub(@Body() body: { pageId?: number; label?: string; frequency?: string; hourOfDay?: number }, @CurrentUser() user: AccessContext) {
    return this.subscriptions.create(user, body);
  }

  @Patch('subscriptions/:id')
  updateSub(
    @Body() body: { label?: string; frequency?: string; hourOfDay?: number; active?: boolean },
    @CurrentUser() user: AccessContext,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.subscriptions.update(user, id, body);
  }

  @Delete('subscriptions/:id')
  removeSub(@CurrentUser() user: AccessContext, @Param('id', ParseIntPipe) id: number) {
    return this.subscriptions.remove(user, id);
  }

  @Post('subscriptions/:id/run')
  @ApiOperation({ summary: 'Phát hành thử ngay (không đổi lịch định kỳ)' })
  runSub(@CurrentUser() user: AccessContext, @Param('id', ParseIntPipe) id: number) {
    return this.subscriptions.runNow(user, id);
  }

  @Get('subscriptions/files')
  @ApiOperation({ summary: 'Ấn bản đã phát hành cho tôi (mới nhất)' })
  subFiles(@CurrentUser() user: AccessContext) {
    return this.subscriptions.listFiles(user);
  }

  @Get('subscriptions/files/:id/download')
  @ApiOperation({ summary: 'Tải ấn bản Excel' })
  async downloadSubFile(
    @CurrentUser() user: AccessContext,
    @Param('id', ParseIntPipe) id: number,
    @Res({ passthrough: true }) res: Response,
  ) {
    const fs = await import('fs');
    const file = await this.subscriptions.fileForDownload(user, id);
    res.set({
      'Content-Type': XLSX,
      'Content-Disposition': `attachment; filename="${encodeURIComponent(file.fileName)}"`,
    });
    return new StreamableFile(fs.createReadStream(file.abs));
  }
}