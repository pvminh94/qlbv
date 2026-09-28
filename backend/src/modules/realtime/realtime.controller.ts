import { Controller, Get, HttpException, HttpStatus, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { CurrentUser } from '../../common/decorators';
import type { AccessContext } from '../../common/types/access-context';
import { RealtimeService } from './realtime.service';

/**
 * Kênh Server-Sent Events: trình duyệt giữ một kết nối `GET /realtime/stream`,
 * máy chủ đẩy sự kiện ngay khi dữ liệu thay đổi (thông báo, tài sản, HSBA…).
 *
 * Viết tay bằng @Res (không dùng @Sse) để:
 *  - kiểm soát hoàn toàn header (X-Accel-Buffering cho proxy),
 *  - giới hạn số kết nối mỗi người dùng,
 *  - không bị TransformInterceptor bọc phản hồi.
 */
@ApiTags('Realtime')
@ApiBearerAuth()
@Controller('realtime')
export class RealtimeController {
  constructor(private readonly realtime: RealtimeService) {}

  @Get('stream')
  @ApiOperation({ summary: 'Luồng sự kiện SSE (heartbeat 25 giây)' })
  stream(@CurrentUser() user: AccessContext, @Req() req: Request, @Res() res: Response): void {
    if (!this.realtime.tryAcquire(user.id)) {
      throw new HttpException(
        'Quá nhiều kết nối realtime — hãy bớt tab đang mở',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    res.write(`retry: 5000\n`);
    res.write(`data: ${JSON.stringify({ topic: '_meta', type: 'hello', at: new Date().toISOString() })}\n\n`);

    const subscription = this.realtime.streamFor(user).subscribe((event) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    });
    // Dòng comment giữ kết nối qua proxy không bị đóng vì "nhàn rỗi"
    const heartbeat = setInterval(() => res.write(`: ping\n\n`), 25_000);

    req.on('close', () => {
      clearInterval(heartbeat);
      subscription.unsubscribe();
      this.realtime.release(user.id);
    });
  }

  @Get('stats')
  @ApiExcludeEndpoint()
  stats(@CurrentUser() user: AccessContext) {
    if (!user.isSuperAdmin) return { connections: null };
    return this.realtime.stats();
  }
}
