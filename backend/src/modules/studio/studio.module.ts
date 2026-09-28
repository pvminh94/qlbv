import { Module } from '@nestjs/common';
import { StudioController } from './studio.controller';
import { StudioQueryService } from './studio-query.service';
import { StudioService } from './studio.service';

@Module({
  controllers: [StudioController],
  providers: [StudioQueryService, StudioService],
  exports: [StudioQueryService, StudioService],
})
export class StudioModule {}
