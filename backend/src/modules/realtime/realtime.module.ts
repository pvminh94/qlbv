import { Global, Module } from '@nestjs/common';
import { RealtimeController } from './realtime.controller';
import { RealtimeService } from './realtime.service';

/**
 * Module realtime (SSE) — toàn cục: mọi service nghiệp vụ inject `RealtimeService`
 * để phát sự kiện mà không cần import module lặp lại.
 */
@Global()
@Module({
  controllers: [RealtimeController],
  providers: [RealtimeService],
  exports: [RealtimeService],
})
export class RealtimeModule {}
