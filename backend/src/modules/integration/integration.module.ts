import { Module } from '@nestjs/common';
import { IntegrationController } from './integration.controller';
import { IntegrationDutyService } from './integration-duty.service';
import { IntegrationKeyGuard } from './integration-key.guard';

@Module({
  controllers: [IntegrationController],
  providers: [IntegrationDutyService, IntegrationKeyGuard],
  exports: [IntegrationDutyService],
})
export class IntegrationModule {}
