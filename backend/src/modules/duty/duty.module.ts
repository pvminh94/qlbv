import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { DutyCatalogController } from './duty-catalog.controller';
import { DutyCatalogService } from './duty-catalog.service';
import { DutyCoreService } from './duty-core.service';
import { DutyRequestController } from './duty-request.controller';
import { DutyRequestService } from './duty-request.service';
import { DutyController } from './duty.controller';
import { DutyService } from './duty.service';

@Module({
  imports: [NotificationsModule],
  controllers: [DutyController, DutyRequestController, DutyCatalogController],
  providers: [DutyCoreService, DutyService, DutyRequestService, DutyCatalogService],
  exports: [DutyService],
})
export class DutyModule {}
