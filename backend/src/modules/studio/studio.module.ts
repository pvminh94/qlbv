import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SchedulerModule } from '../scheduler/scheduler.module';
import { StudioController } from './studio.controller';
import { StudioQueryService } from './studio-query.service';
import { StudioService } from './studio.service';
import { StudioSubscriptionsService } from './studio-subscriptions.service';

@Module({
  imports: [AuthModule, SchedulerModule],
  controllers: [StudioController],
  providers: [StudioQueryService, StudioService, StudioSubscriptionsService],
  exports: [StudioQueryService, StudioService, StudioSubscriptionsService],
})
export class StudioModule {}
