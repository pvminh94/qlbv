import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, Put, Query, Req, Res, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Audit, CurrentUser, RequirePermissions } from '../../common/decorators';
import type { AccessContext } from '../../common/types/access-context';
import { AssetCatalogsService } from './asset-catalogs.service';
import { AssetDepreciationService } from './asset-depreciation.service';
import { AssetIoService } from './asset-io.service';
import { AssetLabelsService, type LabelRequest } from './asset-labels.service';
import { AssetTransactionsService, type TxListQuery } from './asset-transactions.service';
import { AssetVoucherService } from './asset-voucher.service';
import { AssetsService, type AssetListQuery } from './assets.service';

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const fileHeaders = (res: Response, mime: string, fileName: string) =>
  res.set({ 'Content-Type': mime, 'Content-Disposition': `attachment; filename="${encodeURIComponent(fileName)}"` });
const bool = (v: unknown) => v === true || v === 'true' || v === '1';

/* ================================================================== Danh mục */
@ApiTags('Tài sản — danh mục')
@ApiBearerAuth()
@Controller('asset-catalogs')
export class AssetCatalogsController {
  constructor(private readonly service: AssetCatalogsService) {}

  @Get('meta')
  @RequirePermissions(['asset.view', 'asset.catalog.view'], 'any')
  meta() {
    return this.service.meta();
  }

  @Get(':kind')
  @RequirePermissions(['asset.view', 'asset.catalog.view'], 'any')
  @ApiOperation({ summary: 'Danh mục: categories | locations | suppliers | funding' })
  list(@Param('kind') kind: string, @Query('activeOnly') activeOnly?: string) {
    return this.service.list(kind, { activeOnly: bool(activeOnly) });
  }

  @Post(':kind')
  @RequirePermissions('asset.catalog.manage')
  @Audit({ module: 'ASSET', action: 'CREATE', entity: 'asset_catalog', description: 'Thêm danh mục tài sản' })
  create(@Param('kind') kind: string, @Body() body: Record<string, unknown>) {
    return this.service.create(kind, body);
  }

  @Put(':kind/:id')
  @RequirePermissions('asset.catalog.manage')
  @Audit({ module: 'ASSET', action: 'UPDATE', entity: 'asset_catalog', description: 'Sửa danh mục tài sản' })
  update(@Param('kind') kind: string, @Param('id', ParseIntPipe) id: number, @Body() body: Record<string, unknown>) {
    return this.service.update(kind, id, body);
  }

  @Delete(':kind/:id')
  @RequirePermissions('asset.catalog.manage')
  @Audit({ module: 'ASSET', action: 'DELETE', entity: 'asset_catalog', description: 'Xoá danh mục tài sản' })
  remove(@Param('kind') kind: string, @Param('id', ParseIntPipe) id: number) {
    return this.service.remove(kind, id);
  }
}

/* ================================================================== Tài sản */
@ApiTags('Tài sản')
@ApiBearerAuth()
@Controller('assets')
export class AssetsController {
  constructor(
    private readonly service: AssetsService,
    private readonly io: AssetIoService,
    private readonly labels: AssetLabelsService,
  ) {}

  @Get()
  @RequirePermissions('asset.view')
  @ApiOperation({ summary: 'Danh sách tài sản (lọc sâu, phân trang, kèm tổng giá trị)' })
  list(@Query() query: AssetListQuery, @CurrentUser() user: AccessContext) {
    return this.service.list({ ...query, all: bool(query.all), includeDeleted: false }, user);
  }

  @Get('dashboard')
  @RequirePermissions(['asset.dashboard', 'asset.view'], 'any')
  @ApiOperation({ summary: 'Tổng quan tài sản: giá trị, cơ cấu, cảnh báo kiểm định/bảo dưỡng' })
  dashboard(@Query() query: AssetListQuery, @CurrentUser() user: AccessContext) {
    return this.service.dashboard(user, query);
  }

  @Get('options')
  @RequirePermissions('asset.view')
  options(@CurrentUser() user: AccessContext) {
    return this.service.options(user);
  }

  @Get('export')
  @RequirePermissions('asset.export')
  @Audit({ module: 'ASSET', action: 'EXPORT', entity: 'asset', description: 'Xuất danh sách tài sản' })
  async export(@Query() query: AssetListQuery, @CurrentUser() user: AccessContext, @Res({ passthrough: true }) res: Response) {
    const r = await this.io.export(query, user);
    fileHeaders(res, XLSX, r.fileName);
    return new StreamableFile(r.buffer);
  }

  @Get('import/template')
  @RequirePermissions('asset.import')
  async importTemplate(@Res({ passthrough: true }) res: Response) {
    const r = await this.io.template();
    fileHeaders(res, XLSX, r.fileName);
    return new StreamableFile(r.buffer);
  }

  /** Gửi nội dung tệp thô (application/octet-stream), tên tệp ở ?name= */
  @Post('import')
  @RequirePermissions('asset.import')
  @Audit({ module: 'ASSET', action: 'IMPORT', entity: 'asset', description: 'Nhập tài sản từ tệp' })
  async import(
    @Req() req: Request,
    @Query('name') name: string,
    @Query('dryRun') dryRun: string,
    @Query('updateExisting') updateExisting: string,
    @CurrentUser() user: AccessContext,
  ) {
    const buf = await this.io.readUpload(req);
    return this.io.import(buf, name, { dryRun: bool(dryRun), updateExisting: bool(updateExisting) }, user);
  }

  @Get('lookup/:code')
  @RequirePermissions('asset.view')
  @ApiOperation({ summary: 'Tra cứu theo mã tài sản / mã vạch / serial (quét mã)' })
  lookup(@Param('code') code: string, @CurrentUser() user: AccessContext) {
    return this.service.lookup(decodeURIComponent(code), user);
  }

  @Get('labels/templates')
  @RequirePermissions('asset.label.print')
  labelTemplates() {
    return this.labels.templates();
  }

  @Post('labels')
  @HttpCode(200)
  @RequirePermissions('asset.label.print')
  @Audit({ module: 'ASSET', action: 'EXPORT', entity: 'asset_label', description: 'In tem tài sản' })
  async printLabels(@Body() body: LabelRequest, @CurrentUser() user: AccessContext, @Res({ passthrough: true }) res: Response) {
    const r = await this.labels.render(body, user);
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${r.fileName}"`, 'X-Label-Count': String(r.count) });
    return new StreamableFile(r.buffer);
  }

  @Get(':id')
  @RequirePermissions('asset.view')
  detail(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AccessContext) {
    return this.service.detail(id, user);
  }

  @Post()
  @RequirePermissions('asset.create')
  @Audit({ module: 'ASSET', action: 'CREATE', entity: 'asset', description: 'Thêm tài sản' })
  create(@Body() body: Record<string, unknown>, @CurrentUser() user: AccessContext) {
    return this.service.create(body, user);
  }

  @Put(':id')
  @RequirePermissions('asset.update')
  @Audit({ module: 'ASSET', action: 'UPDATE', entity: 'asset', description: 'Sửa hồ sơ tài sản' })
  update(@Param('id', ParseIntPipe) id: number, @Body() body: Record<string, unknown>, @CurrentUser() user: AccessContext) {
    return this.service.update(id, body, user);
  }

  @Delete(':id')
  @RequirePermissions('asset.delete')
  @Audit({ module: 'ASSET', action: 'DELETE', entity: 'asset', description: 'Xoá tài sản' })
  remove(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AccessContext) {
    return this.service.remove(id, user);
  }
}

/* ================================================================== Chứng từ */
@ApiTags('Tài sản — chứng từ nghiệp vụ')
@ApiBearerAuth()
@Controller('asset-transactions')
export class AssetTransactionsController {
  constructor(
    private readonly service: AssetTransactionsService,
    private readonly voucher: AssetVoucherService,
  ) {}

  @Get('meta')
  @RequirePermissions(['asset.view', 'asset.transaction.view'], 'any')
  meta() {
    return this.service.meta();
  }

  @Get()
  @RequirePermissions('asset.transaction.view')
  list(@Query() query: TxListQuery, @CurrentUser() user: AccessContext) {
    return this.service.list(query, user);
  }

  @Get(':id/print')
  @RequirePermissions('asset.transaction.view')
  @ApiOperation({ summary: 'In biên bản chứng từ (PDF) theo mẫu BIEN_BAN_TAI_SAN' })
  async print(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AccessContext, @Res({ passthrough: true }) res: Response) {
    const r = await this.voucher.render(id, user);
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${encodeURIComponent(r.fileName)}"` });
    return new StreamableFile(r.buffer);
  }

  @Get(':id')
  @RequirePermissions('asset.transaction.view')
  detail(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AccessContext) {
    return this.service.detail(id, user);
  }

  @Post()
  @RequirePermissions('asset.transaction.create')
  @Audit({ module: 'ASSET', action: 'CREATE', entity: 'asset_transaction', description: 'Lập chứng từ tài sản' })
  create(@Body() body: Record<string, unknown>, @CurrentUser() user: AccessContext) {
    return this.service.create(body, user);
  }

  @Put(':id')
  @RequirePermissions('asset.transaction.create')
  @Audit({ module: 'ASSET', action: 'UPDATE', entity: 'asset_transaction', description: 'Sửa chứng từ tài sản' })
  update(@Param('id', ParseIntPipe) id: number, @Body() body: Record<string, unknown>, @CurrentUser() user: AccessContext) {
    return this.service.update(id, body, user);
  }

  @Post(':id/submit')
  @RequirePermissions('asset.transaction.create')
  @Audit({ module: 'ASSET', action: 'UPDATE', entity: 'asset_transaction', description: 'Gửi duyệt chứng từ tài sản' })
  submit(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AccessContext) {
    return this.service.submit(id, user);
  }

  @Post(':id/approve')
  @RequirePermissions('asset.transaction.approve')
  @Audit({ module: 'ASSET', action: 'SIGN', entity: 'asset_transaction', description: 'Duyệt chứng từ tài sản' })
  approve(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AccessContext) {
    return this.service.approve(id, user);
  }

  @Post(':id/reject')
  @RequirePermissions('asset.transaction.approve')
  @Audit({ module: 'ASSET', action: 'RETURN', entity: 'asset_transaction', description: 'Từ chối chứng từ tài sản' })
  reject(@Param('id', ParseIntPipe) id: number, @Body('reason') reason: string, @CurrentUser() user: AccessContext) {
    return this.service.reject(id, reason, user);
  }

  @Post(':id/cancel')
  @RequirePermissions('asset.transaction.create')
  @Audit({ module: 'ASSET', action: 'CANCEL', entity: 'asset_transaction', description: 'Huỷ chứng từ tài sản' })
  cancel(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AccessContext) {
    return this.service.cancel(id, user);
  }
}

/* ================================================================== Khấu hao */
@ApiTags('Tài sản — khấu hao / hao mòn')
@ApiBearerAuth()
@Controller('asset-depreciation')
export class AssetDepreciationController {
  constructor(private readonly service: AssetDepreciationService) {}

  @Get('suggest')
  @RequirePermissions('asset.depreciation.view')
  suggest() {
    return this.service.suggest();
  }

  @Get('preview')
  @RequirePermissions('asset.depreciation.view')
  preview(@Query('period') period: string) {
    return this.service.preview(String(period ?? ''));
  }

  @Get('runs')
  @RequirePermissions('asset.depreciation.view')
  runs() {
    return this.service.runs();
  }

  @Get('runs/:id')
  @RequirePermissions('asset.depreciation.view')
  run(@Param('id', ParseIntPipe) id: number) {
    return this.service.runDetail(id);
  }

  @Get('runs/:id/export')
  @RequirePermissions('asset.depreciation.view')
  async exportRun(@Param('id', ParseIntPipe) id: number, @Res({ passthrough: true }) res: Response) {
    const r = await this.service.exportRun(id);
    fileHeaders(res, XLSX, r.fileName);
    return new StreamableFile(r.buffer);
  }

  @Post('runs')
  @RequirePermissions('asset.depreciation.run')
  @Audit({ module: 'ASSET', action: 'RUN', entity: 'asset_depreciation', description: 'Chốt kỳ khấu hao / hao mòn' })
  create(@Body() body: { period: string; note?: string }, @CurrentUser() user: AccessContext) {
    return this.service.run(String(body?.period ?? ''), String(body?.note ?? ''), user);
  }

  @Post('runs/:id/cancel')
  @RequirePermissions('asset.depreciation.run')
  @Audit({ module: 'ASSET', action: 'CANCEL', entity: 'asset_depreciation', description: 'Huỷ kỳ khấu hao / hao mòn' })
  cancel(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AccessContext) {
    return this.service.cancel(id, user);
  }
}
