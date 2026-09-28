/**
 * Studio — API thiết kế & dữ liệu cho dashboard/báo cáo tùy biến.
 *
 * `/studio/query` không gắn quyền tĩnh: quyền được kiểm tra theo TỪNG NGUỒN
 * dữ liệu trong engine (người được xem dashboard chia sẻ vẫn chỉ nhận số liệu
 * thuộc nguồn mình có quyền).
 */
import {
  Body, Controller, Delete, ForbiddenException, Get, HttpCode, Param, ParseIntPipe,
  Post, Put, Query, Res, StreamableFile,
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
    assertPerm(user, managePerm(k));
    return this.service.create(user, { ...body, kind: k });
  }

  @Put('pages/:id')
  async update(
    @Body() body: StudioSavePayload,
    @CurrentUser() user: AccessContext,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const row = await this.service.get(user, id);
    assertPerm(user, managePerm(row.kind));
    return this.service.update(user, id, body);
  }

  @Delete('pages/:id')
  async remove(@CurrentUser() user: AccessContext, @Param('id', ParseIntPipe) id: number) {
    const row = await this.service.get(user, id);
    assertPerm(user, managePerm(row.kind));
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
}
