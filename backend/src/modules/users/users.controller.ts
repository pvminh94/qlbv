import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Audit, CurrentUser, RequirePermissions } from '../../common/decorators';
import type { AccessContext } from '../../common/types/access-context';
import {
  CreateUserDto,
  ImportUsersDto,
  ResetPasswordDto,
  SetDepartmentScopesDto,
  SetRolesDto,
  UpdateUserDto,
  UserQueryDto,
} from './dto/user.dto';
import { UserImportService } from './user-import.service';
import { UsersService } from './users.service';

@ApiTags('Người dùng')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(
    private readonly service: UsersService,
    private readonly importer: UserImportService,
  ) {}

  @Get()
  @RequirePermissions('user.view')
  @ApiOperation({ summary: 'Danh sách người dùng (lọc nâng cao + phân trang)' })
  list(@Query() query: UserQueryDto) {
    return this.service.list(query);
  }

  @Get('stats')
  @RequirePermissions('user.view')
  @ApiOperation({ summary: 'Thống kê người dùng' })
  stats() {
    return this.service.stats();
  }

  @Get(':id/effective-permissions')
  @RequirePermissions('user.view')
  @ApiOperation({ summary: 'Quyền hiệu lực của một người dùng (gộp từ vai trò + phạm vi + khoa)' })
  effectivePermissions(@Param('id', ParseIntPipe) id: number) {
    return this.service.effectivePermissions(id);
  }

  @Get(':id')
  @RequirePermissions('user.view')
  @ApiOperation({ summary: 'Chi tiết người dùng (vai trò, phạm vi khoa, lịch sử đăng nhập)' })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.service.findOne(id);
  }

  @Post()
  @RequirePermissions('user.create')
  @Audit({ module: 'ADMIN', action: 'CREATE', entity: 'user', description: 'Thêm người dùng' })
  @ApiOperation({ summary: 'Thêm người dùng mới' })
  create(@Body() dto: CreateUserDto, @CurrentUser() actor: AccessContext) {
    return this.service.create(dto, actor);
  }

  @Put(':id')
  @RequirePermissions('user.update')
  @Audit({ module: 'ADMIN', action: 'UPDATE', entity: 'user', description: 'Sửa người dùng' })
  @ApiOperation({ summary: 'Cập nhật người dùng' })
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateUserDto,
    @CurrentUser() actor: AccessContext,
  ) {
    return this.service.update(id, dto, actor);
  }

  @Delete(':id')
  @RequirePermissions('user.delete')
  @Audit({ module: 'ADMIN', action: 'DELETE', entity: 'user', description: 'Xoá người dùng' })
  @ApiOperation({ summary: 'Xoá người dùng (xoá mềm)' })
  remove(@Param('id', ParseIntPipe) id: number, @CurrentUser() actor: AccessContext) {
    return this.service.remove(id, actor);
  }

  @Patch(':id/restore')
  @RequirePermissions('user.delete')
  @ApiOperation({ summary: 'Khôi phục người dùng đã xoá' })
  restore(@Param('id', ParseIntPipe) id: number) {
    return this.service.restore(id);
  }

  @Patch(':id/active')
  @RequirePermissions('user.update')
  @Audit({ module: 'ADMIN', action: 'UPDATE', entity: 'user', description: 'Bật/tắt tài khoản' })
  @ApiOperation({ summary: 'Kích hoạt / vô hiệu hoá tài khoản' })
  toggleActive(
    @Param('id', ParseIntPipe) id: number,
    @Body('active') active: boolean,
    @CurrentUser() actor: AccessContext,
  ) {
    return this.service.toggleActive(id, !!active, actor);
  }

  @Post(':id/reset-password')
  @RequirePermissions('user.reset-password')
  @Audit({ module: 'ADMIN', action: 'UPDATE', entity: 'user', description: 'Đặt lại mật khẩu' })
  @ApiOperation({ summary: 'Đặt lại mật khẩu cho người dùng' })
  resetPassword(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ResetPasswordDto,
    @CurrentUser() actor: AccessContext,
  ) {
    return this.service.resetPassword(id, dto, actor);
  }

  @Post(':id/unlock')
  @RequirePermissions('user.update')
  @ApiOperation({ summary: 'Mở khoá tài khoản bị tạm khoá' })
  unlock(@Param('id', ParseIntPipe) id: number) {
    return this.service.unlock(id);
  }

  @Put(':id/roles')
  @RequirePermissions('user.assign-role')
  @Audit({ module: 'ADMIN', action: 'UPDATE', entity: 'user', description: 'Gán vai trò' })
  @ApiOperation({ summary: 'Gán vai trò cho người dùng' })
  setRoles(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SetRolesDto,
    @CurrentUser() actor: AccessContext,
  ) {
    return this.service.setRoles(id, dto, actor);
  }

  @Put(':id/department-scopes')
  @RequirePermissions('user.assign-role')
  @ApiOperation({ summary: 'Gán phạm vi khoa được phép truy cập' })
  setScopes(@Param('id', ParseIntPipe) id: number, @Body() dto: SetDepartmentScopesDto) {
    return this.service.setDepartmentScopes(id, dto);
  }

  @Get('import/template')
  @RequirePermissions('user.import')
  @ApiOperation({ summary: 'Tải tệp Excel mẫu để nhập danh sách nhân viên' })
  async importTemplate(@Res({ passthrough: true }) res: Response) {
    const buf = await this.importer.template();
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="mau-nhap-nhan-vien.xlsx"`,
    });
    return new StreamableFile(buf);
  }

  /**
   * Nhập nhân viên từ tệp .xlsx/.csv/.txt — gửi nội dung tệp thô
   * (Content-Type: application/octet-stream), tên tệp ở ?name=
   */
  @Post('import/file')
  @RequirePermissions('user.import')
  @ApiOperation({ summary: 'Nhập danh sách nhân viên từ tệp Excel/CSV/TXT (dryRun=true để xem trước)' })
  async importFile(
    @Req() req: Request,
    @Query('name') name: string,
    @Query('dryRun') dryRun: string,
    @Query('overwrite') overwrite: string,
    @Query('addTitles') addTitles: string,
    @CurrentUser() actor: AccessContext,
  ) {
    const buf = await this.importer.readUpload(req);
    return this.importer.importFile(
      buf,
      String(name ?? ''),
      { dryRun: dryRun === 'true', overwrite: overwrite === 'true', addTitles: addTitles === 'true' },
      actor,
    );
  }

  @Post('import')
  @RequirePermissions('user.import')
  @ApiOperation({ summary: 'Nhập danh sách người dùng từ JSON (các dòng đã đọc sẵn)' })
  importUsers(@Body() dto: ImportUsersDto, @CurrentUser() actor: AccessContext) {
    return this.importer.importJson(dto.rows, { dryRun: dto.dryRun, overwrite: dto.overwrite, addTitles: dto.addTitles }, actor);
  }
}
