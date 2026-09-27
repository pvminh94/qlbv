/**
 * PHÂN HỆ QUẢN LÝ TÀI SẢN
 *
 *  Danh mục : loại tài sản (cây, phương pháp khấu hao mặc định) · vị trí · nhà cung cấp/hãng/đơn vị
 *             bảo trì · nguồn vốn
 *  Hồ sơ    : tài sản (TSCĐ hữu hình/vô hình, CCDC) — thông tin chung, tài chính, TBYT chuyên sâu
 *             (số lưu hành, phân loại rủi ro, kiểm định/hiệu chuẩn, bảo trì định kỳ), thuộc tính mở rộng
 *  Nghiệp vụ: chứng từ (ghi tăng, cấp phát, điều chuyển, thu hồi, báo hỏng, sửa chữa xong, thanh lý,
 *             đánh giá lại, báo mất) — lập nháp → duyệt mới áp dụng vào tài sản (nguyên tử)
 *  Dòng thời gian: mọi thay đổi của từng tài sản (asset_events)
 *  Khấu hao : kỳ tính (tháng/năm) + chi tiết từng tài sản, khoá sổ được
 *
 * Mọi mã/trạng thái là text để thêm loại mới không cần migration.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { departments } from './org';
import { users } from './system';

const money = (name: string) => numeric(name, { precision: 18, scale: 2, mode: 'number' });
const created = () => timestamp('created_at', { withTimezone: true }).defaultNow().notNull();
const updated = () => timestamp('updated_at', { withTimezone: true }).defaultNow().notNull();

/** Phương pháp tính khấu hao / hao mòn */
export type DepreciationMethod =
  | 'NONE' // không tính (đất, CCDC phân bổ 1 lần…)
  | 'STRAIGHT_LINE_MONTHLY' // khấu hao đường thẳng theo tháng (TT45/2013)
  | 'STRAIGHT_LINE_YEARLY' // hao mòn theo năm (TT23/2023 — đơn vị sự nghiệp công)
  | 'DECLINING_BALANCE'; // số dư giảm dần có điều chỉnh (theo tháng)

/* ------------------------------------------------------------------ Danh mục */

export const assetCategories = pgTable(
  'asset_categories',
  {
    id: serial('id').primaryKey(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    parentId: integer('parent_id'),
    /** /1/5/12/ — truy vấn cây con nhanh */
    path: text('path').default('').notNull(),
    level: integer('level').default(1).notNull(),
    /** TSCD_HUU_HINH | TSCD_VO_HINH | CCDC */
    kind: text('kind').default('TSCD_HUU_HINH').notNull(),
    /** THIET_BI_Y_TE | CNTT | NOI_THAT | PHUONG_TIEN | NHA_CUA | MAY_MOC | CCDC | KHAC */
    group: text('group_code').default('KHAC').notNull(),
    /** Tiền tố sinh mã tài sản tự động (vd TBYT → TBYT-000123) */
    codePrefix: text('code_prefix').default('').notNull(),
    depreciationMethod: text('depreciation_method').$type<DepreciationMethod>().default('STRAIGHT_LINE_YEARLY').notNull(),
    /** Thời gian sử dụng mặc định (tháng) */
    usefulLifeMonths: integer('useful_life_months').default(60).notNull(),
    /** Tỉ lệ hao mòn %/năm mặc định (TT23) — 0 = tính theo thời gian sử dụng */
    annualRate: numeric('annual_rate', { precision: 7, scale: 3, mode: 'number' }).default(0).notNull(),
    requiresCalibration: boolean('requires_calibration').default(false).notNull(),
    calibrationIntervalMonths: integer('calibration_interval_months').default(0).notNull(),
    maintenanceIntervalMonths: integer('maintenance_interval_months').default(0).notNull(),
    /** Thuộc tính mở rộng áp dụng cho loại: [{key,label,type,options?,required?}] */
    customFields: jsonb('custom_fields').$type<AssetCustomField[]>().default([]).notNull(),
    sortOrder: integer('sort_order').default(0).notNull(),
    active: boolean('active').default(true).notNull(),
    note: text('note').default('').notNull(),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [
    uniqueIndex('asset_categories_code_uq').on(sql`lower(${t.code})`),
    index('asset_categories_parent_idx').on(t.parentId),
    index('asset_categories_path_idx').on(t.path),
  ],
);

export interface AssetCustomField {
  key: string;
  label: string;
  type: 'text' | 'number' | 'date' | 'select' | 'bool';
  options?: string[];
  required?: boolean;
}

export const assetLocations = pgTable(
  'asset_locations',
  {
    id: serial('id').primaryKey(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    parentId: integer('parent_id'),
    path: text('path').default('').notNull(),
    level: integer('level').default(1).notNull(),
    /** KHU | TOA_NHA | TANG | PHONG | KHO | KHAC */
    kind: text('kind').default('PHONG').notNull(),
    departmentId: integer('department_id').references(() => departments.id, { onDelete: 'set null' }),
    sortOrder: integer('sort_order').default(0).notNull(),
    active: boolean('active').default(true).notNull(),
    note: text('note').default('').notNull(),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [
    uniqueIndex('asset_locations_code_uq').on(sql`lower(${t.code})`),
    index('asset_locations_parent_idx').on(t.parentId),
    index('asset_locations_dept_idx').on(t.departmentId),
  ],
);

export const assetSuppliers = pgTable(
  'asset_suppliers',
  {
    id: serial('id').primaryKey(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    /** Vai trò: NCC (nhà cung cấp) · HANG_SX (hãng sản xuất) · BAO_TRI (đơn vị bảo trì/kiểm định) — có thể nhiều */
    roles: text('roles').array().default(sql`'{NCC}'::text[]`).notNull(),
    taxCode: text('tax_code').default('').notNull(),
    address: text('address').default('').notNull(),
    phone: text('phone').default('').notNull(),
    email: text('email').default('').notNull(),
    contactName: text('contact_name').default('').notNull(),
    country: text('country').default('').notNull(),
    sortOrder: integer('sort_order').default(0).notNull(),
    active: boolean('active').default(true).notNull(),
    note: text('note').default('').notNull(),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [uniqueIndex('asset_suppliers_code_uq').on(sql`lower(${t.code})`)],
);

export const assetFundingSources = pgTable(
  'asset_funding_sources',
  {
    id: serial('id').primaryKey(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    sortOrder: integer('sort_order').default(0).notNull(),
    active: boolean('active').default(true).notNull(),
    note: text('note').default('').notNull(),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [uniqueIndex('asset_funding_sources_code_uq').on(sql`lower(${t.code})`)],
);

/* ------------------------------------------------------------------ Tài sản */

/** Trạng thái vòng đời */
export type AssetStatus =
  | 'TRONG_KHO' // mới ghi tăng, chưa cấp phát
  | 'DANG_SU_DUNG'
  | 'DANG_SUA_CHUA'
  | 'HONG' // báo hỏng, chờ xử lý
  | 'CHO_THANH_LY'
  | 'DA_THANH_LY'
  | 'MAT';

export const assets = pgTable(
  'assets',
  {
    id: serial('id').primaryKey(),
    code: text('code').notNull(),
    /** Mã vạch/QR in trên tem — mặc định bằng mã tài sản, có thể dùng mã cũ khi chuyển đổi dữ liệu */
    barcode: text('barcode').default('').notNull(),
    name: text('name').notNull(),
    categoryId: integer('category_id').references(() => assetCategories.id, { onDelete: 'restrict' }),
    /** TSCD_HUU_HINH | TSCD_VO_HINH | CCDC — sao từ loại, cho phép ghi đè */
    kind: text('kind').default('TSCD_HUU_HINH').notNull(),
    model: text('model').default('').notNull(),
    serialNumber: text('serial_number').default('').notNull(),
    manufacturerId: integer('manufacturer_id').references(() => assetSuppliers.id, { onDelete: 'set null' }),
    supplierId: integer('supplier_id').references(() => assetSuppliers.id, { onDelete: 'set null' }),
    countryOfOrigin: text('country_of_origin').default('').notNull(),
    yearOfManufacture: integer('year_of_manufacture'),
    specifications: text('specifications').default('').notNull(),
    unit: text('unit').default('Cái').notNull(),
    quantity: integer('quantity').default(1).notNull(),

    // ---- Tài chính
    originalCost: money('original_cost').default(0).notNull(),
    fundingSourceId: integer('funding_source_id').references(() => assetFundingSources.id, { onDelete: 'set null' }),
    /** Cơ cấu nhiều nguồn vốn: [{sourceId, amount}] */
    fundingBreakdown: jsonb('funding_breakdown').$type<{ sourceId: number; amount: number }[]>().default([]).notNull(),
    acquisitionDate: date('acquisition_date'),
    inUseDate: date('in_use_date'),
    invoiceNo: text('invoice_no').default('').notNull(),
    contractNo: text('contract_no').default('').notNull(),
    warrantyUntil: date('warranty_until'),
    depreciationMethod: text('depreciation_method').$type<DepreciationMethod>().default('STRAIGHT_LINE_YEARLY').notNull(),
    usefulLifeMonths: integer('useful_life_months').default(60).notNull(),
    annualRate: numeric('annual_rate', { precision: 7, scale: 3, mode: 'number' }).default(0).notNull(),
    depreciationStartDate: date('depreciation_start_date'),
    residualValue: money('residual_value').default(0).notNull(),
    /** Hao mòn/khấu hao luỹ kế đầu kỳ khi chuyển đổi dữ liệu (tính đến openingDate) */
    openingAccumulated: money('opening_accumulated').default(0).notNull(),
    openingDate: date('opening_date'),
    /** Luỹ kế hiện tại = đầu kỳ + các kỳ đã chạy (cập nhật khi chốt kỳ khấu hao) */
    accumulatedDepreciation: money('accumulated_depreciation').default(0).notNull(),
    lastDepreciationPeriod: text('last_depreciation_period').default('').notNull(),

    // ---- Quản lý sử dụng
    status: text('status').$type<AssetStatus>().default('TRONG_KHO').notNull(),
    /** TOT | KHA | TRUNG_BINH | KEM | HONG */
    condition: text('condition').default('TOT').notNull(),
    departmentId: integer('department_id').references(() => departments.id, { onDelete: 'set null' }),
    locationId: integer('location_id').references(() => assetLocations.id, { onDelete: 'set null' }),
    custodianId: integer('custodian_id').references(() => users.id, { onDelete: 'set null' }),
    custodianName: text('custodian_name').default('').notNull(),
    /** Tài sản cha (linh kiện/phụ kiện đi kèm) */
    parentId: integer('parent_id'),

    // ---- Trang thiết bị y tế
    riskClass: text('risk_class').default('').notNull(), // A | B | C | D
    registrationNo: text('registration_no').default('').notNull(), // số lưu hành / số đăng ký
    requiresCalibration: boolean('requires_calibration').default(false).notNull(),
    calibrationIntervalMonths: integer('calibration_interval_months').default(0).notNull(),
    lastCalibrationDate: date('last_calibration_date'),
    nextCalibrationDate: date('next_calibration_date'),
    maintenanceIntervalMonths: integer('maintenance_interval_months').default(0).notNull(),
    lastMaintenanceDate: date('last_maintenance_date'),
    nextMaintenanceDate: date('next_maintenance_date'),

    attributes: jsonb('attributes').$type<Record<string, unknown>>().default({}).notNull(),
    tags: text('tags').array().default(sql`'{}'::text[]`).notNull(),
    imageUrl: text('image_url').default('').notNull(),
    note: text('note').default('').notNull(),
    /** Chuỗi tìm kiếm không dấu (mã, tên, serial, model, khoa, vị trí…) */
    searchText: text('search_text').default('').notNull(),
    lastInventoryAt: timestamp('last_inventory_at', { withTimezone: true }),
    createdBy: integer('created_by'),
    updatedBy: integer('updated_by'),
    createdAt: created(),
    updatedAt: updated(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('assets_code_uq').on(sql`lower(${t.code})`),
    index('assets_barcode_idx').on(t.barcode),
    index('assets_serial_idx').on(t.serialNumber),
    index('assets_category_idx').on(t.categoryId),
    index('assets_dept_status_idx').on(t.departmentId, t.status),
    index('assets_location_idx').on(t.locationId),
    index('assets_status_idx').on(t.status),
    index('assets_next_cal_idx').on(t.nextCalibrationDate),
    index('assets_next_mt_idx').on(t.nextMaintenanceDate),
    index('assets_parent_idx').on(t.parentId),
  ],
);

/* ------------------------------------------------------------------ Chứng từ nghiệp vụ */

export type AssetTxType =
  | 'GHI_TANG'
  | 'CAP_PHAT'
  | 'DIEU_CHUYEN'
  | 'THU_HOI'
  | 'BAO_HONG'
  | 'SUA_CHUA'
  | 'HOAN_THANH_SUA'
  | 'BAO_DUONG'
  | 'KIEM_DINH'
  | 'DE_NGHI_THANH_LY'
  | 'THANH_LY'
  | 'DANH_GIA_LAI'
  | 'BAO_MAT';

export const assetTransactions = pgTable(
  'asset_transactions',
  {
    id: serial('id').primaryKey(),
    code: text('code').notNull(),
    type: text('type').$type<AssetTxType>().notNull(),
    txDate: date('tx_date').notNull(),
    /** NHAP (nháp) | CHO_DUYET | DA_DUYET (đã áp dụng) | TU_CHOI | HUY */
    status: text('status').default('NHAP').notNull(),
    fromDepartmentId: integer('from_department_id').references(() => departments.id, { onDelete: 'set null' }),
    toDepartmentId: integer('to_department_id').references(() => departments.id, { onDelete: 'set null' }),
    toLocationId: integer('to_location_id').references(() => assetLocations.id, { onDelete: 'set null' }),
    toCustodianId: integer('to_custodian_id').references(() => users.id, { onDelete: 'set null' }),
    toCustodianName: text('to_custodian_name').default('').notNull(),
    /** Người giao / người nhận (in biên bản) */
    delivererName: text('deliverer_name').default('').notNull(),
    receiverName: text('receiver_name').default('').notNull(),
    reason: text('reason').default('').notNull(),
    /** Số quyết định / căn cứ */
    decisionNo: text('decision_no').default('').notNull(),
    /** Giá trị thu hồi khi thanh lý / chi phí sửa chữa */
    amount: money('amount').default(0).notNull(),
    supplierId: integer('supplier_id').references(() => assetSuppliers.id, { onDelete: 'set null' }),
    note: text('note').default('').notNull(),
    createdBy: integer('created_by').references(() => users.id, { onDelete: 'set null' }),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    approvedBy: integer('approved_by').references(() => users.id, { onDelete: 'set null' }),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    rejectReason: text('reject_reason').default('').notNull(),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [
    uniqueIndex('asset_transactions_code_uq').on(t.code),
    index('asset_transactions_type_idx').on(t.type, t.status),
    index('asset_transactions_date_idx').on(t.txDate),
  ],
);

export const assetTransactionItems = pgTable(
  'asset_transaction_items',
  {
    id: serial('id').primaryKey(),
    transactionId: integer('transaction_id')
      .notNull()
      .references(() => assetTransactions.id, { onDelete: 'cascade' }),
    assetId: integer('asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
    /** Ảnh chụp trạng thái trước/sau khi duyệt */
    before: jsonb('before').$type<Record<string, unknown>>().default({}).notNull(),
    after: jsonb('after').$type<Record<string, unknown>>().default({}).notNull(),
    /** Đánh giá lại: nguyên giá mới · thanh lý: giá bán từng tài sản · sửa chữa: chi phí */
    amount: money('amount').default(0).notNull(),
    condition: text('condition').default('').notNull(),
    note: text('note').default('').notNull(),
  },
  (t) => [
    index('asset_tx_items_tx_idx').on(t.transactionId),
    index('asset_tx_items_asset_idx').on(t.assetId),
    uniqueIndex('asset_tx_items_uq').on(t.transactionId, t.assetId),
  ],
);

/* ------------------------------------------------------------------ Dòng thời gian */

export const assetEvents = pgTable(
  'asset_events',
  {
    id: serial('id').primaryKey(),
    assetId: integer('asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
    /** CREATE | UPDATE | TX_<type> | DEPRECIATION | LABEL | INVENTORY | MAINTENANCE … */
    eventType: text('event_type').notNull(),
    title: text('title').notNull(),
    detail: jsonb('detail').$type<Record<string, unknown>>().default({}).notNull(),
    transactionId: integer('transaction_id'),
    userId: integer('user_id'),
    userName: text('user_name').default('').notNull(),
    createdAt: created(),
  },
  (t) => [index('asset_events_asset_idx').on(t.assetId, t.createdAt)],
);

/* ------------------------------------------------------------------ Khấu hao */

export const assetDepreciationRuns = pgTable(
  'asset_depreciation_runs',
  {
    id: serial('id').primaryKey(),
    /** YYYY-MM (tháng) hoặc YYYY (năm — hao mòn TT23) */
    period: text('period').notNull(),
    /** MONTHLY | YEARLY */
    periodType: text('period_type').notNull(),
    /** DA_CHOT | DA_HUY */
    status: text('status').default('DA_CHOT').notNull(),
    assetCount: integer('asset_count').default(0).notNull(),
    totalAmount: money('total_amount').default(0).notNull(),
    note: text('note').default('').notNull(),
    createdBy: integer('created_by'),
    createdByName: text('created_by_name').default('').notNull(),
    createdAt: created(),
  },
  (t) => [uniqueIndex('asset_depr_runs_period_uq').on(t.period).where(sql`status = 'DA_CHOT'`)],
);

export const assetDepreciationLines = pgTable(
  'asset_depreciation_lines',
  {
    id: serial('id').primaryKey(),
    runId: integer('run_id')
      .notNull()
      .references(() => assetDepreciationRuns.id, { onDelete: 'cascade' }),
    assetId: integer('asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
    method: text('method').notNull(),
    costBasis: money('cost_basis').default(0).notNull(),
    amount: money('amount').default(0).notNull(),
    accumulatedBefore: money('accumulated_before').default(0).notNull(),
    accumulatedAfter: money('accumulated_after').default(0).notNull(),
    bookValueAfter: money('book_value_after').default(0).notNull(),
    departmentId: integer('department_id'),
    categoryId: integer('category_id'),
  },
  (t) => [index('asset_depr_lines_run_idx').on(t.runId), index('asset_depr_lines_asset_idx').on(t.assetId)],
);

/* ------------------------------------------------------------------ Kiểm kê (GĐ2) */

/**
 * Đợt kiểm kê: Nháp → Đang kiểm kê (đã chụp sổ sách) → Chờ duyệt (đã khoá số liệu đếm)
 *              → Hoàn tất (ghi nhận ngày kiểm kê vào tài sản) | Huỷ.
 * Phạm vi: khoa/phòng, vị trí (gồm cây con), loại tài sản, nhóm — để trống = toàn viện.
 */
export interface InventoryScope {
  departmentIds?: number[];
  locationIds?: number[];
  categoryIds?: number[];
  groups?: string[];
  /** Gồm tài sản đang trong kho (chưa cấp phát cho khoa nào) */
  includeStore?: boolean;
}
export interface InventoryMember {
  name: string;
  position?: string;
  /** Chức trách trong hội đồng: Chủ tịch, Uỷ viên, Thư ký… */
  role?: string;
}

export const assetInventories = pgTable(
  'asset_inventories',
  {
    id: serial('id').primaryKey(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    /** NHAP | DANG_KIEM_KE | CHO_DUYET | HOAN_TAT | DA_HUY */
    status: text('status').default('NHAP').notNull(),
    scope: jsonb('scope').$type<InventoryScope>().default({}).notNull(),
    plannedDate: date('planned_date'),
    /** Thời điểm chốt sổ sách (ngày kiểm kê trên biên bản) */
    snapshotAt: timestamp('snapshot_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    decisionNo: text('decision_no').default('').notNull(),
    committee: jsonb('committee').$type<InventoryMember[]>().default([]).notNull(),
    /** Tài khoản được phân công quét (ngoài người có quyền quản lý kiểm kê) */
    memberIds: integer('member_ids').array().default(sql`'{}'::int[]`).notNull(),
    /** Kiểm kê "mù": người quét không thấy danh sách dự kiến / tình trạng sổ sách */
    blind: boolean('blind').default(false).notNull(),
    note: text('note').default('').notNull(),
    conclusion: text('conclusion').default('').notNull(),
    createdBy: integer('created_by'),
    createdByName: text('created_by_name').default('').notNull(),
    approvedBy: integer('approved_by'),
    approvedByName: text('approved_by_name').default('').notNull(),
    createdAt: created(),
    updatedAt: updated(),
  },
  (t) => [uniqueIndex('asset_inventories_code_uq').on(t.code), index('asset_inventories_status_idx').on(t.status)],
);

export const assetInventoryItems = pgTable(
  'asset_inventory_items',
  {
    id: serial('id').primaryKey(),
    inventoryId: integer('inventory_id')
      .notNull()
      .references(() => assetInventories.id, { onDelete: 'cascade' }),
    /** null = quét được mã không có trong hồ sơ (tài sản thừa chưa có hồ sơ) */
    assetId: integer('asset_id').references(() => assets.id, { onDelete: 'set null' }),
    scannedCode: text('scanned_code').default('').notNull(),
    /** true = có trong sổ sách của phạm vi kiểm kê; false = phát hiện thêm khi quét */
    expected: boolean('expected').default(true).notNull(),
    // ---- Sổ sách tại thời điểm chốt
    bookDepartmentId: integer('book_department_id'),
    bookLocationId: integer('book_location_id'),
    bookCustodianName: text('book_custodian_name').default('').notNull(),
    bookStatus: text('book_status').default('').notNull(),
    bookCondition: text('book_condition').default('').notNull(),
    bookCost: money('book_cost').default(0).notNull(),
    bookValue: money('book_value').default(0).notNull(),
    // ---- Thực tế
    /** CHUA_KIEM | CO (thấy) | KHONG_THAY (xác nhận không thấy) */
    checkState: text('check_state').default('CHUA_KIEM').notNull(),
    actualDepartmentId: integer('actual_department_id'),
    actualLocationId: integer('actual_location_id'),
    actualCondition: text('actual_condition').default('').notNull(),
    /** KHOP | SAI_VI_TRI | SAI_TINH_TRANG | THIEU | THUA | KHONG_RO | '' (chưa kiểm) */
    result: text('result').default('').notNull(),
    scanCount: integer('scan_count').default(0).notNull(),
    /** CAMERA | SCANNER | MANUAL | OFFLINE */
    method: text('method').default('').notNull(),
    checkedAt: timestamp('checked_at', { withTimezone: true }),
    checkedBy: integer('checked_by'),
    checkedByName: text('checked_by_name').default('').notNull(),
    note: text('note').default('').notNull(),
    /** Xử lý chênh lệch: DIEU_CHUYEN | BAO_MAT | BAO_HONG | GHI_NHAN (chấp nhận, không lập chứng từ) */
    resolution: text('resolution').default('').notNull(),
    resolutionTxId: integer('resolution_tx_id'),
  },
  (t) => [
    index('asset_inv_items_inv_idx').on(t.inventoryId, t.result),
    uniqueIndex('asset_inv_items_asset_uq').on(t.inventoryId, t.assetId).where(sql`asset_id is not null`),
    index('asset_inv_items_asset_idx').on(t.assetId),
  ],
);

/** Nhật ký lượt quét — khoá (inventoryId, clientId) giúp đồng bộ offline không bị trùng */
export const assetInventoryScans = pgTable(
  'asset_inventory_scans',
  {
    id: serial('id').primaryKey(),
    inventoryId: integer('inventory_id')
      .notNull()
      .references(() => assetInventories.id, { onDelete: 'cascade' }),
    clientId: text('client_id').notNull(),
    code: text('code').notNull(),
    itemId: integer('item_id'),
    /** FOUND | DUPLICATE | EXTRA | UNKNOWN */
    outcome: text('outcome').default('').notNull(),
    method: text('method').default('').notNull(),
    locationId: integer('location_id'),
    userId: integer('user_id'),
    userName: text('user_name').default('').notNull(),
    deviceId: text('device_id').default('').notNull(),
    scannedAt: timestamp('scanned_at', { withTimezone: true }).notNull(),
    createdAt: created(),
  },
  (t) => [uniqueIndex('asset_inv_scans_client_uq').on(t.inventoryId, t.clientId), index('asset_inv_scans_inv_idx').on(t.inventoryId, t.scannedAt)],
);
