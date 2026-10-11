import { Body, Controller, Get, Headers, Param, Post, Query, Res, UnauthorizedException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { Public } from '../../common/decorators';
import { KioskService } from './kiosk.service';

@ApiTags('Kiosk · Điểm danh Sinh trắc học & Mở khoá Phòng khám')
@Controller('kiosk')
export class KioskController {
  constructor(private readonly service: KioskService) {}

  @Public()
  @Get('status')
  @ApiOperation({ summary: 'Trạng thái Kiosk phòng khám & phiên mã QR động' })
  async getStatus(@Query('room') room: string, @Headers('host') host: string) {
    return this.service.getKioskStatus(room || 'PK01', host);
  }

  @Public()
  @Post('session/refresh')
  @ApiOperation({ summary: 'Làm mới mã QR cho phòng khám' })
  async refreshSession(
    @Body() body: { roomCode: string; roomName?: string },
    @Headers('host') host: string,
  ) {
    const session = this.service.createQrSession(
      body.roomCode || 'PK01',
      body.roomName || `Phòng khám ${body.roomCode}`,
      host,
    );
    return {
      success: true,
      sessionId: session.sessionId,
      qrUrl: session.qrUrl,
      expiresInSeconds: 90,
      challengeSequence: session.challengeSequence,
    };
  }

  @Public()
  @Get('events/:roomCode')
  @ApiOperation({ summary: 'Kênh thời gian thực Server-Sent Events (SSE) mở khoá máy tính phòng khám' })
  streamEvents(@Param('roomCode') roomCode: string, @Res() res: Response) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    // Gửi sự kiện khởi tạo kết nối
    res.write(`event: CONNECTED\ndata: ${JSON.stringify({ roomCode, connectedAt: new Date().toISOString() })}\n\n`);

    // Giữ kết nối SSE bằng heartbeat 25 giây
    const heartbeat = setInterval(() => {
      try {
        res.write(`:heartbeat\n\n`);
      } catch {
        clearInterval(heartbeat);
      }
    }, 25000);

    res.on('close', () => clearInterval(heartbeat));
    this.service.registerSseClient(roomCode, res);
  }

  @Public()
  @Post('verify-face')
  @ApiOperation({ summary: 'Xác thực khuôn mặt Bác sĩ qua điện thoại & Mở khoá PC theo lịch trực' })
  async verifyFace(
    @Body()
    body: {
      sessionId: string;
      snapshotBase64: string;
      completedChallenges?: string[];
      deviceInfo?: string;
    },
  ) {
    return this.service.verifyFaceAndUnlock({
      sessionId: body.sessionId,
      snapshotBase64: body.snapshotBase64,
      completedChallenges: body.completedChallenges || ['BLINK'],
      deviceInfo: body.deviceInfo,
    });
  }

  @Public()
  @Post('override-pin')
  @ApiOperation({ summary: 'Mở khoá khẩn cấp tại chỗ bằng mã PIN IT' })
  async overridePin(@Body() body: { roomCode: string; pin: string; reason?: string }) {
    const masterPin = process.env.IT_MASTER_PIN || '999888';
    if (body.pin !== masterPin) {
      throw new UnauthorizedException('Mã PIN khẩn cấp IT không chính xác.');
    }

    this.service.broadcastToRoom(body.roomCode, 'UNLOCK_EVENT', {
      type: 'UNLOCK_SUCCESS',
      doctor: {
        fullName: 'Kỹ thuật viên IT',
        title: 'IT Support',
        shiftName: 'Mở khoá Khẩn cấp',
      },
      roomCode: body.roomCode,
      method: 'IT_EMERGENCY_PIN',
    });

    return { success: true, message: 'Đã mở khoá khẩn cấp phòng khám thành công.' };
  }

  @Public()
  @Post('lock')
  @ApiOperation({ summary: 'Khoá lại màn hình phòng khám khi Bác sĩ rời phòng' })
  async lockRoom(@Body() body: { roomCode: string }) {
    this.service.broadcastToRoom(body.roomCode, 'LOCK_EVENT', {
      type: 'LOCK_TRIGGERED',
      roomCode: body.roomCode,
      timestamp: new Date().toISOString(),
    });
    return { success: true, message: 'Đã khoá phòng khám.' };
  }

  @Public()
  @Post('enroll')
  @ApiOperation({ summary: 'Đăng ký khuôn mặt Bác sĩ (gọi sang VPS 2 AI Engine & lưu vào CSDL QLBV)' })
  async enrollBiometrics(@Body() body: { userId: number; imageBase64: string }) {
    return this.service.enrollUserBiometrics(body.userId, body.imageBase64);
  }

  @Public()
  @Get('doctors/:userId/avatar')
  @ApiOperation({ summary: 'Xem ảnh đại diện sinh trắc học đã lưu của Bác sĩ' })
  getDoctorAvatar(@Param('userId') userId: string, @Res() res: Response) {
    const filePath = path.resolve(process.cwd(), 'uploads', 'faces', `user_${userId}_avatar.jpg`);
    if (fs.existsSync(filePath)) {
      res.setHeader('Content-Type', 'image/jpeg');
      return res.sendFile(filePath);
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 24 24" fill="none" stroke="#0f766e" stroke-width="1.5"><circle cx="12" cy="8" r="4"/><path d="M6 20v-2a6 6 0 0 1 12 0v2"/></svg>`;
    res.setHeader('Content-Type', 'image/svg+xml');
    return res.send(svg);
  }
}
