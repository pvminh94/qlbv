import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, Put, Query, Res, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Audit, CurrentUser, RequirePermissions } from '../../common/decorators';
import type { AccessContext } from '../../common/types/access-context';
import { AssetInventoryService, type InventoryItemsQuery, type ScanInput } from './asset-inventory.service';
import { AssetReportsService } from './asset-reports.service';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const file = (res: Response, mime: string, fileName: string, inline = false) =>
  res.set({ 'Content-Type': mime, 'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${encodeURIComponent(fileName)}"` });

/* ================================================================== Kiểm kê */
@ApiTags('Tài sản — kiểm kê')
@ApiBearerAuth()
@Controller('asset-inventories')
export class AssetInventoryController {
  constructor(private readonly service: AssetInventoryService) {}

  @Get('meta')
  @RequirePermissions(['asset.inventory.view', 'asset.inventory.scan', 'asset.inventory.manage'], 'any')
  meta() {
    return this.service.meta();
  }

  @Post('scope-preview')
  @HttpCode(200)
  @RequirePermissions('asset.inventory.manage')
  @ApiOperation({ summary: 'Đếm số tài sản thuộc phạm vi kiểm kê trước khi lập đợt' })
  scopePreview(@Body() body: Record<string, unknown>, @CurrentUser() user: AccessContext) {
    return this.service.scopePreview(body, user);
  }

  @Get()
  @RequirePermissions(['asset.inventory.view', 'asset.inventory.scan', 'asset.inventory.manage'], 'any')
  list(@Query() q: { q?: string; status?: string; page?: number; pageSize?: number }, @CurrentUser() user: AccessContext) {
    return this.service.list(q, user);
  }

  @Get(':id')
  @RequirePermissions(['asset.inventory.view', 'asset.inventory.scan', 'asset.inventory.manage'], 'any')
  detail(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AccessContext) {
    return this.service.detail(id, user);
  }

  @Get(':id/items')
  @RequirePermissions(['asset.inventory.view', 'asset.inventory.scan', 'asset.inventory.manage'], 'any')
  items(@Param('id', ParseIntPipe) id: number, @Query() q: InventoryItemsQuery, @CurrentUser() user: AccessContext) {
    return this.service.items(id, { ...q, all: false }, user);
  }

  @Get(':id/offline-pack')
  @RequirePermissions(['asset.inventory.scan', 'asset.inventory.manage'], 'any')
  @ApiOperation({ summary: 'Tải dữ liệu để kiểm kê offline trên điện thoại' })
  offlinePack(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AccessContext) {
    return this.service.offlinePack(id, user);
  }

  @Get(':id/export')
  @RequirePermissions(['asset.inventory.view', 'asset.inventory.manage'], 'any')
  @Audit({ module: 'ASSET', action: 'EXPORT', entity: 'asset_inventory', description: 'Xuất kết quả kiểm kê' })
  async export(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AccessContext, @Res({ passthrough: true }) res: Response) {
    const r = await this.service.export(id, user);
    file(res, XLSX, r.fileName);
    return new StreamableFile(r.buffer);
  }

  @Get(':id/print')
  @RequirePermissions(['asset.inventory.view', 'asset.inventory.manage'], 'any')
  async print(@Param('id', ParseIntPipe) id: number, @Query('onlyDiff') onlyDiff: string, @CurrentUser() user: AccessContext, @Res({ passthrough: true }) res: Response) {
    const r = await this.service.render(id, { onlyDiff: onlyDiff === 'true' || onlyDiff === '1' }, user);
    file(res, 'application/pdf', r.fileName, true);
    return new StreamableFile(r.buffer);
  }

  @Post()
  @RequirePermissions('asset.inventory.manage')
  @Audit({ module: 'ASSET', action: 'CREATE', entity: 'asset_inventory', description: 'Lập đợt kiểm kê' })
  create(@Body() body: Record<string, unknown>, @CurrentUser() user: AccessContext) {
    return this.service.create(body, user);
  }

  @Put(':id')
  @RequirePermissions('asset.inventory.manage')
  @Audit({ module: 'ASSET', action: 'UPDATE', entity: 'asset_inventory', description: 'Sửa đợt kiểm kê' })
  update(@Param('id', ParseIntPipe) id: number, @Body() body: Record<string, unknown>, @CurrentUser() user: AccessContext) {
    return this.service.update(id, body, user);
  }

  @Delete(':id')
  @RequirePermissions('asset.inventory.manage')
  @Audit({ module: 'ASSET', action: 'DELETE', entity: 'asset_inventory', description: 'Xoá đợt kiểm kê nháp' })
  remove(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AccessContext) {
    return this.service.remove(id, user);
  }

  @Post(':id/start')
  @HttpCode(200)
  @RequirePermissions('asset.inventory.manage')
  @Audit({ module: 'ASSET', action: 'UPDATE', entity: 'asset_inventory', description: 'Bắt đầu kiểm kê (chốt sổ sách)' })
  start(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AccessContext) {
    return this.service.start(id, user);
  }

  @Post(':id/scans')
  @HttpCode(200)
  @RequirePermissions(['asset.inventory.scan', 'asset.inventory.manage'], 'any')
  @ApiOperation({ summary: 'Gửi lô lượt quét (online hoặc đồng bộ offline, idempotent theo clientId)' })
  scan(@Param('id', ParseIntPipe) id: number, @Body() body: { scans?: ScanInput[]; deviceId?: string }, @CurrentUser() user: AccessContext) {
    return this.service.scan(id, body, user);
  }

  @Put(':id/items/:itemId')
  @RequirePermissions(['asset.inventory.scan', 'asset.inventory.manage'], 'any')
  updateItem(@Param('id', ParseIntPipe) id: number, @Param('itemId', ParseIntPipe) itemId: number, @Body() body: Record<string, unknown>, @CurrentUser() user: AccessContext) {
    return this.service.updateItem(id, itemId, body, user);
  }

  @Delete(':id/items/:itemId')
  @RequirePermissions(['asset.inventory.scan', 'asset.inventory.manage'], 'any')
  removeItem(@Param('id', ParseIntPipe) id: number, @Param('itemId', ParseIntPipe) itemId: number, @CurrentUser() user: AccessContext) {
    return this.service.removeItem(id, itemId, user);
  }

  @Post(':id/items/bulk')
  @HttpCode(200)
  @RequirePermissions('asset.inventory.manage')
  bulk(@Param('id', ParseIntPipe) id: number, @Body() body: { itemIds?: unknown; checkState?: string }, @CurrentUser() user: AccessContext) {
    return this.service.bulkMark(id, body, user);
  }

  @Post(':id/finish')
  @HttpCode(200)
  @RequirePermissions('asset.inventory.manage')
  @Audit({ module: 'ASSET', action: 'UPDATE', entity: 'asset_inventory', description: 'Khoá số liệu kiểm kê, trình duyệt' })
  finish(@Param('id', ParseIntPipe) id: number, @Body() body: { conclusion?: string }, @CurrentUser() user: AccessContext) {
    return this.service.finish(id, body ?? {}, user);
  }

  @Post(':id/reopen')
  @HttpCode(200)
  @RequirePermissions('asset.inventory.manage')
  @Audit({ module: 'ASSET', action: 'UPDATE', entity: 'asset_inventory', description: 'Mở lại kiểm kê' })
  reopen(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AccessContext) {
    return this.service.reopen(id, user);
  }

  @Post(':id/resolve')
  @HttpCode(200)
  @RequirePermissions('asset.inventory.manage')
  @Audit({ module: 'ASSET', action: 'CREATE', entity: 'asset_inventory', description: 'Xử lý chênh lệch kiểm kê' })
  resolve(@Param('id', ParseIntPipe) id: number, @Body() body: { action?: string; itemIds?: unknown; submit?: boolean }, @CurrentUser() user: AccessContext) {
    return this.service.resolve(id, body, user);
  }

  @Post(':id/complete')
  @HttpCode(200)
  @RequirePermissions('asset.inventory.approve')
  @Audit({ module: 'ASSET', action: 'APPROVE', entity: 'asset_inventory', description: 'Duyệt hoàn tất kiểm kê' })
  complete(@Param('id', ParseIntPipe) id: number, @Body() body: { conclusion?: string; updateCondition?: boolean }, @CurrentUser() user: AccessContext) {
    return this.service.complete(id, body ?? {}, user);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermissions('asset.inventory.manage')
  @Audit({ module: 'ASSET', action: 'UPDATE', entity: 'asset_inventory', description: 'Huỷ đợt kiểm kê' })
  cancel(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AccessContext) {
    return this.service.cancel(id, user);
  }
}

/* ================================================================== Báo cáo & lịch bảo trì */
@ApiTags('Tài sản — báo cáo')
@ApiBearerAuth()
@Controller('asset-reports')
export class AssetReportsController {
  constructor(private readonly service: AssetReportsService) {}

  @Get()
  @RequirePermissions('asset.report.view')
  catalog() {
    return this.service.catalog();
  }

  @Get('schedule')
  @RequirePermissions('asset.view')
  @ApiOperation({ summary: 'Lịch kiểm định / bảo dưỡng / bảo hành trong khoảng ngày (kèm lần lặp dự kiến)' })
  schedule(@Query() q: { from?: string; to?: string; types?: string; departmentId?: number; group?: string }, @CurrentUser() user: AccessContext) {
    return this.service.schedule(q, user);
  }

  @Get(':key')
  @RequirePermissions('asset.report.view')
  run(@Param('key') key: string, @Query() q: Record<string, unknown>, @CurrentUser() user: AccessContext) {
    return this.service.run(key, q, user);
  }

  @Get(':key/export')
  @RequirePermissions('asset.report.view')
  @Audit({ module: 'ASSET', action: 'EXPORT', entity: 'asset_report', description: 'Xuất báo cáo tài sản' })
  async export(@Param('key') key: string, @Query() q: Record<string, unknown>, @CurrentUser() user: AccessContext, @Res({ passthrough: true }) res: Response) {
    const r = await this.service.export(key, q, user);
    file(res, XLSX, r.fileName);
    return new StreamableFile(r.buffer);
  }

  @Get(':key/print')
  @RequirePermissions('asset.report.view')
  async print(@Param('key') key: string, @Query() q: Record<string, unknown>, @CurrentUser() user: AccessContext, @Res({ passthrough: true }) res: Response) {
    const r = await this.service.print(key, q, user);
    file(res, 'application/pdf', r.fileName, true);
    return new StreamableFile(r.buffer);
  }
}
