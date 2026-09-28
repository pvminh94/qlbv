import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { AdvancedQueryDto, toBoolean } from '../../../common/dto/query.dto';

/* ------------------------------------------------------------------ Quy trình ký */

export class WorkflowStepDto {
  @ApiProperty({ example: 'DE_NGHI' })
  @IsString()
  @IsNotEmpty()
  key!: string;

  @ApiProperty({ example: 'Người đề nghị xác nhận' })
  @IsString()
  name!: string;

  @ApiProperty({ example: 'NGƯỜI ĐỀ NGHỊ SỬA HSBA' })
  @IsString()
  title!: string;

  @ApiProperty({ enum: ['requester', 'role', 'dept_head', 'creator'] })
  @IsString()
  kind!: 'requester' | 'role' | 'dept_head' | 'creator';

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  roleCodes?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  confirmText?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  allowReturn?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  requireNote?: boolean;
}

export class CreateWorkflowDto {
  @ApiProperty({ example: 'MAC_DINH' })
  @IsString()
  @IsNotEmpty()
  code!: string;

  @ApiProperty()
  @IsString()
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ type: [WorkflowStepDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WorkflowStepDto)
  steps!: WorkflowStepDto[];

  @ApiPropertyOptional({ description: 'Áp dụng làm quy trình mặc định' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  isDefault?: boolean;

  @ApiPropertyOptional({ description: 'Áp dụng riêng cho khoa' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  departmentId?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  active?: boolean;
}

export class UpdateWorkflowDto extends PartialType(CreateWorkflowDto) {}

/* ---------------------------------------------------------------------- Phiếu */

export class CreateRequestDto {
  @ApiProperty({ description: 'Tài khoản sẽ ký với tư cách người đề nghị' })
  @Type(() => Number)
  @IsInt()
  requesterId!: number;

  @ApiProperty({ example: 'Nguyễn Văn A' })
  @IsString()
  @IsNotEmpty({ message: 'Vui lòng nhập họ tên người đề nghị' })
  @MaxLength(128)
  requesterName!: string;

  @ApiPropertyOptional({ example: 'Bác sĩ điều trị' })
  @IsOptional()
  @IsString()
  requesterTitle?: string;

  @ApiPropertyOptional({ description: 'Khoa của người đề nghị' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  departmentId?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  departmentName?: string;

  /* -------- Người bệnh -------- */
  @ApiProperty({ example: 'Nguyễn Thị Hồng Ánh' })
  @IsString()
  @IsNotEmpty({ message: 'Vui lòng nhập tên người bệnh' })
  patientName!: string;

  @ApiPropertyOptional({ example: '1985' })
  @IsOptional()
  @IsString()
  patientBirthYear?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  patientBirthDate?: string;

  @ApiPropertyOptional({ example: 'Nữ' })
  @IsOptional()
  @IsString()
  patientGender?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  patientCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  patientAddress?: string;

  @ApiPropertyOptional({ description: 'Mã KCB / mã hồ sơ' })
  @IsOptional()
  @IsString()
  maKcb?: string;

  @ApiPropertyOptional({ description: 'Mã thẻ BHYT' })
  @IsOptional()
  @IsString()
  maTheBhyt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  ngayVaoVien?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsDateString()
  ngayRaVien?: string;

  @ApiPropertyOptional({ example: 'BHYT' })
  @IsOptional()
  @IsString()
  doiTuong?: string;

  /* -------- Nội dung -------- */
  @ApiProperty({ description: 'Lý do sai sót' })
  @IsString()
  @IsNotEmpty({ message: 'Vui lòng nhập lý do sai' })
  reason!: string;

  @ApiProperty({ description: 'Nội dung cần sửa trong HSBA điện tử' })
  @IsString()
  @IsNotEmpty({ message: 'Vui lòng nhập nội dung đề nghị sửa' })
  content!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  amount?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  attachmentsNote?: string;

  @ApiPropertyOptional({ description: 'Trường tự định nghĩa thêm' })
  @IsOptional()
  @IsObject()
  extraFields?: Record<string, unknown>;

  @ApiPropertyOptional({ enum: ['LOW', 'NORMAL', 'HIGH', 'URGENT'] })
  @IsOptional()
  @IsString()
  priority?: string;

  @ApiPropertyOptional({ description: 'Ký xác nhận ngay khi tạo (nếu tài khoản tạo chính là người đề nghị)' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  signNow?: boolean;

  @ApiPropertyOptional({ description: 'Quy trình ký áp dụng' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  workflowId?: number;

  @ApiPropertyOptional({
    description:
      'Bỏ qua cảnh báo trùng phiếu — chỉ dùng sau khi giao diện đã hiển thị danh sách phiếu đang mở cùng mã KCB/thẻ cho ngườI nhập xác nhận',
  })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  force?: boolean;
}

export class UpdateRequestDto extends PartialType(CreateRequestDto) {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  internalNote?: string;
}

export class SignRequestDto {
  @ApiPropertyOptional({ description: 'Ghi chú / ý kiến khi ký' })
  @IsOptional()
  @IsString()
  note?: string;

  @ApiPropertyOptional({ description: 'Bước ký (bỏ trống = bước đang chờ)' })
  @IsOptional()
  @IsString()
  stepKey?: string;
}

export class ReturnRequestDto {
  @ApiProperty({ description: 'Lý do trả lại' })
  @IsString()
  @IsNotEmpty({ message: 'Vui lòng nhập lý do trả lại' })
  reason!: string;
}

export class RequestQueryDto extends AdvancedQueryDto {
  @ApiPropertyOptional({ description: 'Lọc theo trạng thái' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ description: 'Lọc theo khoa' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  departmentId?: number;

  @ApiPropertyOptional({ description: 'Chỉ lấy phiếu đang chờ chính tôi xử lý' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  myTurn?: boolean;

  @ApiPropertyOptional({ description: 'Chỉ lấy phiếu do tôi tạo hoặc tôi là người đề nghị' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  mine?: boolean;
}

export class BulkSignDto {
  @ApiProperty({ type: [Number] })
  @IsArray()
  @IsInt({ each: true })
  ids!: number[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  note?: string;
}


export class CreateCommentDto {
  @ApiProperty({ maxLength: 4000 })
  @IsString()
  @MaxLength(4000)
  content!: string;
}

export class CreateAttachmentDto {
  @ApiProperty({ maxLength: 255 })
  @IsString()
  @MaxLength(255)
  fileName!: string;

  @ApiPropertyOptional({ maxLength: 127 })
  @IsOptional()
  @IsString()
  @MaxLength(127)
  mimeType?: string;

  @ApiProperty({ description: 'Nội dung tệp dạng base64 (giới hạn theo cấu hình máy chủ)' })
  @IsString()
  contentBase64!: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class DuplicatesQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(60)
  maKcb?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(30)
  maTheBhyt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  excludeId?: number;
}
