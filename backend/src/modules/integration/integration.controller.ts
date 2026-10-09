import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators';
import { DUTY_READ_SCOPE } from './integration-keys';
import { IntegrationDutyService } from './integration-duty.service';
import { IntegrationKeyGuard, RequireIntegrationScope } from './integration-key.guard';

/**
 * API tích hợp cho máy khoá phòng khám: chỉ đọc, xác thực bằng khoá API
 * (Authorization: Bearer qlbs_int_...). Không dùng JWT của người dùng.
 * Chỉ trả kỳ đã công bố/chốt và loại người đang nghỉ phép.
 */
@ApiTags('Tích hợp · Lịch trực (máy khoá)')
@Controller('integration/duty')
@Public()
@UseGuards(IntegrationKeyGuard)
@RequireIntegrationScope(DUTY_READ_SCOPE)
export class IntegrationController {
  constructor(private readonly service: IntegrationDutyService) {}

  @Get('on-duty')
  @ApiOperation({ summary: 'Ai đang trực phòng tại thời điểm at (mặc định: bây giờ), không gồm người nghỉ phép' })
  onDuty(@Query('room') room?: string, @Query('at') at?: string) {
    return this.service.onDuty({ room, at });
  }

  @Get('roster')
  @ApiOperation({ summary: 'Lịch trực theo khoảng ngày YYYY-MM-DD (tối đa 31 ngày), có cờ nghỉ phép' })
  roster(@Query('from') from?: string, @Query('to') to?: string, @Query('room') room?: string) {
    return this.service.roster({ from, to, room });
  }

  @Get('rooms')
  @ApiOperation({ summary: 'Danh mục phòng đang hoạt động' })
  rooms() {
    return this.service.rooms();
  }
}
