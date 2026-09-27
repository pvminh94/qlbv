import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { AssetCatalogsService } from './asset-catalogs.service';
import { AssetDepreciationService } from './asset-depreciation.service';
import { AssetInventoryController, AssetReportsController } from './asset-inventory.controller';
import { AssetInventoryService } from './asset-inventory.service';
import { AssetIoService } from './asset-io.service';
import { AssetReportsService } from './asset-reports.service';
import { AssetLabelsService } from './asset-labels.service';
import { AssetTransactionsService } from './asset-transactions.service';
import { AssetVoucherService } from './asset-voucher.service';
import { AssetCatalogsController, AssetDepreciationController, AssetsController, AssetTransactionsController } from './assets.controller';
import { AssetsService } from './assets.service';

/** Phân hệ Quản lý tài sản: danh mục · hồ sơ · chứng từ nghiệp vụ · khấu hao/hao mòn · in tem · nhập/xuất · kiểm kê · báo cáo · lịch bảo trì */
@Module({
  imports: [SettingsModule],
  controllers: [AssetCatalogsController, AssetsController, AssetTransactionsController, AssetDepreciationController, AssetInventoryController, AssetReportsController],
  providers: [AssetsService, AssetCatalogsService, AssetTransactionsService, AssetDepreciationService, AssetLabelsService, AssetIoService, AssetVoucherService, AssetInventoryService, AssetReportsService],
  exports: [AssetsService],
})
export class AssetsModule {}
