import {
  Body,
  Controller,
  StreamableFile,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Audit, ClientInfo, CurrentUser, RequirePermissions } from '../../common/decorators';
import { AdvancedQueryDto } from '../../common/dto/query.dto';
import type { AccessContext, ClientMeta } from '../../common/types/access-context';
import {
  BulkSignDto,
  CreateAttachmentDto,
  CreateCommentDto,
  CreateRequestDto,
  CreateWorkflowDto,
  DuplicatesQueryDto,
  RequestQueryDto,
  ReturnRequestDto,
  SignRequestDto,
  UpdateRequestDto,
  UpdateWorkflowDto,
} from './dto/hsba.dto';
import { HsbaService } from './hsba.service';

@ApiTags('Hồ sơ bệnh án — Quy trình ký')
@ApiBearerAuth()
@Controller('hsba/workflows')
export class HsbaWorkflowController {
  constructor(private readonly service: HsbaService) {}

  @Get()
  @RequirePermissions('hsba.workflow.view')
  @ApiOperation({ summary: 'Danh sách quy trình ký' })
  list(@Query() query: AdvancedQueryDto) {
    return this.service.listWorkflows(query);
  }

  @Get(':id')
  @RequirePermissions('hsba.workflow.view')
  @ApiOperation({ summary: 'Chi tiết quy trình ký (các bước cấu hình động)' })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.service.findWorkflow(id);
  }

  @Post()
  @RequirePermissions('hsba.workflow.create')
  @Audit({ module: 'HSBA', action: 'CREATE', entity: 'hsba_workflow', description: 'Thêm quy trình ký' })
  @ApiOperation({ summary: 'Tạo quy trình ký mới (số bước tuỳ ý)' })
  create(@Body() dto: CreateWorkflowDto) {
    return this.service.createWorkflow(dto);
  }

  @Put(':id')
  @RequirePermissions('hsba.workflow.update')
  @Audit({ module: 'HSBA', action: 'UPDATE', entity: 'hsba_workflow', description: 'Sửa quy trình ký' })
  @ApiOperation({ summary: 'Cập nhật quy trình ký' })
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateWorkflowDto) {
    return this.service.updateWorkflow(id, dto);
  }

  @Delete(':id')
  @RequirePermissions('hsba.workflow.delete')
  @Audit({ module: 'HSBA', action: 'DELETE', entity: 'hsba_workflow', description: 'Xoá quy trình ký' })
  @ApiOperation({ summary: 'Xoá quy trình ký (chặn nếu đang có phiếu dùng)' })
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.removeWorkflow(id);
  }
}

@ApiTags('Hồ sơ bệnh án — Phiếu đề nghị sửa')
@ApiBearerAuth()
@Controller('hsba/requests')
export class HsbaRequestController {
  constructor(private readonly service: HsbaService) {}

  @Get()
  @RequirePermissions('hsba.request.view')
  @ApiOperation({ summary: 'Danh sách phiếu — tìm kiếm sâu, lọc nâng cao, phân trang' })
  list(@Query() query: RequestQueryDto, @CurrentUser() user: AccessContext) {
    return this.service.list(query, user);
  }

  @Get('my-turn')
  @RequirePermissions('hsba.request.view')
  @ApiOperation({ summary: 'Phiếu đang chờ chính tôi xử lý' })
  myTurn(@Query() query: RequestQueryDto, @CurrentUser() user: AccessContext) {
    return this.service.myTurn(user, query);
  }

  @Get('stats')
  @RequirePermissions('hsba.request.view')
  @ApiOperation({ summary: 'Thống kê phiếu theo trạng thái và theo khoa' })
  stats(@Query() query: RequestQueryDto, @CurrentUser() user: AccessContext) {
    return this.service.stats(user, query);
  }

  @Get('verify/:id/:stepKey/:hash')
  @ApiOperation({ summary: 'Xác thực chữ ký số của nội dung phiếu (dùng cho QR)' })
  verify(
    @Param('id', ParseIntPipe) id: number,
    @Param('stepKey') stepKey: string,
    @Param('hash') hash: string,
  ) {
    return this.service.verify(id, stepKey, hash);
  }

  @Get('duplicates')
  @RequirePermissions('hsba.request.view')
  @ApiOperation({ summary: 'Tra cứu phiếu đang mở trùng mã KCB / mã thẻ BHYT (cảnh báo tạo trùng)' })
  duplicates(@Query() query: DuplicatesQueryDto) {
    return this.service.findOpenDuplicates(query);
  }

  @Get(':id')
  @RequirePermissions('hsba.request.view')
  @ApiOperation({ summary: 'Chi tiết phiếu kèm dòng thời gian ký' })
  findOne(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AccessContext) {
    return this.service.findOne(id, user);
  }

  @Get(':id/print-data')
  @RequirePermissions('hsba.request.print')
  @ApiOperation({ summary: 'Dữ liệu của phiếu dùng cho bản in (trình thiết kế mẫu in dùng để xem trước bằng dữ liệu thật)' })
  printData(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AccessContext) {
    return this.service.printData(id, user);
  }

  @Get(':id/pdf')
  @RequirePermissions('hsba.request.print')
  @ApiOperation({ summary: 'Kết xuất phiếu ra PDF theo mẫu in cấu hình được' })
  async pdf(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AccessContext,
    @Res({ passthrough: true }) res: Response,
    @Query('template') template?: string,
  ) {
    const result = await this.service.exportPdf(id, user, template);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${encodeURIComponent(result.fileName)}"`,
      'X-Print-Template': result.templateCode,
      'X-Print-Pages': String(result.pages),
    });
    return new StreamableFile(result.buffer);
  }

  @Post()
  @RequirePermissions('hsba.request.create')
  @Audit({ module: 'HSBA', action: 'CREATE', entity: 'hsba_request', description: 'Tạo phiếu đề nghị sửa HSBA' })
  @ApiOperation({ summary: 'Tạo phiếu đề nghị sửa HSBA (tự chọn quy trình theo khoa)' })
  create(
    @Body() dto: CreateRequestDto,
    @CurrentUser() user: AccessContext,
    @ClientInfo() client: ClientMeta,
  ) {
    return this.service.create(dto, user, client);
  }

  @Put(':id')
  @RequirePermissions('hsba.request.update')
  @Audit({ module: 'HSBA', action: 'UPDATE', entity: 'hsba_request', description: 'Sửa phiếu đề nghị' })
  @ApiOperation({ summary: 'Cập nhật nội dung phiếu' })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateRequestDto,
    @CurrentUser() user: AccessContext,
  ) {
    return this.service.update(id, dto, user);
  }

  @Post(':id/sign')
  // Bước ký nào do quy trình quyết định → chỉ cần có một trong các quyền ký
  @RequirePermissions(
    ['hsba.request.sign-requester', 'hsba.request.sign-khtb', 'hsba.request.sign-insurance', 'hsba.request.sign-finance'],
    'any',
  )
  @Audit({ module: 'HSBA', action: 'SIGN', entity: 'hsba_request', description: 'Ký phiếu đề nghị sửa HSBA' })
  @ApiOperation({ summary: 'Ký ở bước đang chờ (kiểm tra theo cấu hình quy trình)' })
  sign(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SignRequestDto,
    @CurrentUser() user: AccessContext,
    @ClientInfo() client: ClientMeta,
  ) {
    return this.service.sign(id, dto, user, client);
  }

  @Post('bulk-sign')
  @RequirePermissions(
    ['hsba.request.sign-requester', 'hsba.request.sign-khtb', 'hsba.request.sign-insurance', 'hsba.request.sign-finance'],
    'any',
  )
  @ApiOperation({ summary: 'Ký nhiều phiếu đang chờ tôi xử lý trong một lần' })
  bulkSign(
    @Body() dto: BulkSignDto,
    @CurrentUser() user: AccessContext,
    @ClientInfo() client: ClientMeta,
  ) {
    return this.service.bulkSign(dto.ids, dto.note, user, client);
  }

  @Post(':id/return')
  @RequirePermissions('hsba.request.return')
  @Audit({ module: 'HSBA', action: 'RETURN', entity: 'hsba_request', description: 'Trả lại phiếu' })
  @ApiOperation({ summary: 'Trả lại phiếu kèm lý do (huỷ chữ ký phía sau)' })
  returnRequest(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ReturnRequestDto,
    @CurrentUser() user: AccessContext,
    @ClientInfo() client: ClientMeta,
  ) {
    return this.service.returnRequest(id, dto.reason, user, client);
  }

  @Post(':id/cancel')
  @RequirePermissions('hsba.request.cancel')
  @Audit({ module: 'HSBA', action: 'CANCEL', entity: 'hsba_request', description: 'Huỷ phiếu' })
  @ApiOperation({ summary: 'Huỷ phiếu' })
  cancel(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { reason?: string },
    @CurrentUser() user: AccessContext,
    @ClientInfo() client: ClientMeta,
  ) {
    return this.service.cancel(id, body?.reason, user, client);
  }

  /* ------------------------------------------------------------------ BÌNH LUẬN */

  @Get(':id/comments')
  @RequirePermissions('hsba.request.view')
  @ApiOperation({ summary: 'Danh sách trao đổi của phiếu' })
  comments(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AccessContext) {
    return this.service.listComments(id, user);
  }

  @Post(':id/comments')
  @RequirePermissions('hsba.request.comment')
  @Audit({ module: 'HSBA', action: 'COMMENT', entity: 'hsba_request', description: 'Trao đổi trên phiếu' })
  @ApiOperation({ summary: 'Thêm trao đổi' })
  addComment(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateCommentDto,
    @CurrentUser() user: AccessContext,
    @ClientInfo() client: ClientMeta,
  ) {
    return this.service.addComment(id, dto, user, client);
  }

  @Delete(':id/comments/:commentId')
  @RequirePermissions('hsba.request.comment')
  @Audit({ module: 'HSBA', action: 'COMMENT_DELETE', entity: 'hsba_request', description: 'Xoá trao đổi (mềm)' })
  @ApiOperation({ summary: 'Xoá trao đổi (tác giả hoặc quản trị phiếu)' })
  removeComment(
    @Param('id', ParseIntPipe) id: number,
    @Param('commentId', ParseIntPipe) commentId: number,
    @CurrentUser() user: AccessContext,
  ) {
    return this.service.removeComment(id, commentId, user);
  }

  /* -------------------------------------------------------------- TỆP ĐÍNH KÈM */

  @Get(':id/attachments')
  @RequirePermissions('hsba.request.view')
  @ApiOperation({ summary: 'Danh sách tệp minh chứng của phiếu' })
  attachments(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AccessContext) {
    return this.service.listAttachments(id, user);
  }

  @Post(':id/attachments')
  @RequirePermissions('file.upload')
  @Audit({ module: 'HSBA', action: 'ATTACHMENT', entity: 'hsba_request', description: 'Đính kèm tệp minh chứng' })
  @ApiOperation({ summary: 'Tải tệp minh chứng (base64, kiểm tra kiểu/kích thước/chữ ký tệp)' })
  upload(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateAttachmentDto,
    @CurrentUser() user: AccessContext,
    @ClientInfo() client: ClientMeta,
  ) {
    return this.service.uploadAttachment(id, dto, user, client);
  }

  @Get(':id/attachments/:attachmentId')
  @RequirePermissions('hsba.request.view')
  @ApiOperation({ summary: 'Tải/xem tệp minh chứng (stream có kiểm tra quyền xem phiếu)' })
  async downloadAttachment(
    @Param('id', ParseIntPipe) id: number,
    @Param('attachmentId', ParseIntPipe) attachmentId: number,
    @CurrentUser() user: AccessContext,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { row, absPath } = await this.service.readAttachment(id, attachmentId, user);
    res.set({
      'Content-Type': row.mimeType,
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(row.fileName)}`,
      'Cache-Control': 'private, max-age=60',
      'X-Content-Type-Options': 'nosniff',
    });
    const { createReadStream } = await import('node:fs');
    return new StreamableFile(createReadStream(absPath));
  }

  @Delete(':id/attachments/:attachmentId')
  @RequirePermissions('file.upload')
  @Audit({ module: 'HSBA', action: 'ATTACHMENT_DELETE', entity: 'hsba_request', description: 'Xoá tệp minh chứng' })
  @ApiOperation({ summary: 'Xoá tệp minh chứng (ngườI đăng hoặc quản trị phiếu)' })
  removeAttachment(
    @Param('id', ParseIntPipe) id: number,
    @Param('attachmentId', ParseIntPipe) attachmentId: number,
    @CurrentUser() user: AccessContext,
    @ClientInfo() client: ClientMeta,
  ) {
    return this.service.removeAttachment(id, attachmentId, user, client);
  }

  @Patch(':id/restore')
  @RequirePermissions('hsba.request.delete')
  @ApiOperation({ summary: 'Khôi phục phiếu đã xoá mềm' })
  restore(@Param('id', ParseIntPipe) id: number) {
    return this.service.restore(id);
  }

  @Delete(':id')
  @RequirePermissions('hsba.request.delete')
  @Audit({ module: 'HSBA', action: 'DELETE', entity: 'hsba_request', description: 'Xoá phiếu' })
  @ApiOperation({ summary: 'Xoá mềm phiếu' })
  remove(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: AccessContext) {
    return this.service.remove(id, user);
  }
}
