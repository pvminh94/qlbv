import { Module, forwardRef } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SettingsModule } from '../settings/settings.module';
import { UsersController } from './users.controller';
import { UserImportService } from './user-import.service';
import { UsersService } from './users.service';

@Module({
  imports: [forwardRef(() => AuthModule), SettingsModule],
  controllers: [UsersController],
  providers: [UsersService, UserImportService],
  exports: [UsersService],
})
export class UsersModule {}
