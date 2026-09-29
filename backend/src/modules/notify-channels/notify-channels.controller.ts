/**
 * API liên kết kênh thông báo cá nhân (Telegram). Mọi người dùng đăng nhập đều dùng được.
 */
import { Controller, Delete, Get, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators';
import type { AccessContext } from '../../common/types/access-context';
import { TelegramService } from './telegram.service';

@ApiTags('notify-channels')
@Controller('notify-channels')
export class NotifyChannelsController {
  constructor(private readonly telegram: TelegramService) {}

  @Get('telegram/status')
  @ApiOperation({ summary: 'Trạng thái liên kết Telegram của tôi' })
  async status(@CurrentUser() user: AccessContext) {
    const st = await this.telegram.statusOf(user.id);
    return {
      ...st,
      deepLink: st.botUsername ? `https://t.me/${st.botUsername}` : '',
    };
  }

  @Post('telegram/link-code')
  @ApiOperation({ summary: 'Tạo mã liên kết Telegram (hiệu lực 10 phút)' })
  linkCode(@CurrentUser() user: AccessContext) {
    const { code, expiresAt } = this.telegram.createLinkCode(user.id, user.username);
    return {
      code,
      expiresAt,
      deepLink: this.telegram.getBotUsername()
        ? `https://t.me/${this.telegram.getBotUsername()}?start=${code}`
        : '',
    };
  }

  @Delete('telegram/link')
  @ApiOperation({ summary: 'Huỷ liên kết Telegram của tôi' })
  async unlink(@CurrentUser() user: AccessContext) {
    await this.telegram.unlink(user.id);
    return { message: 'Đã huỷ liên kết Telegram' };
  }
}
