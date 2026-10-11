import { Module } from '@nestjs/common';
import { DbModule } from '../../db/db.module';
import { IntegrationModule } from '../integration/integration.module';
import { SettingsModule } from '../settings/settings.module';
import { KioskController } from './kiosk.controller';
import { KioskService } from './kiosk.service';

@Module({
  imports: [DbModule, IntegrationModule, SettingsModule],
  controllers: [KioskController],
  providers: [KioskService],
  exports: [KioskService],
})
export class KioskModule {}
