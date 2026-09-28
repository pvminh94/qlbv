/**
 * Studio — danh mục nguồn dữ liệu (whitelist tuyệt đối cho query engine).
 *
 * Người dùng KHÔNG BAO GIỜ viết SQL: mọi trường chọn/lọc/nhóm phải tồn tại
 * trong danh mục này (tên + kiểu + biểu thức drizzle đã kiểm soát), và mỗi
 * nguồn khai báo quyền xem + luật giới hạn phạm vi theo khoa của người dùng.
 */
import { SQL, and, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import type { AnyColumn } from 'drizzle-orm';
import {
  assetCategories,
  assetTransactions,
  assets,
  auditLogs,
  departments,
  hsbaRequests,
  reportEntries,
  reportRows,
  reportSections,
  reportTemplates,
  users,
  REQUEST_STATUS_LABELS,
} from '../../db/schema';
import { ASSET_STATUS, ASSET_CONDITION, TX_TYPES, TX_STATUS } from '../assets/asset-constants';
import type { AccessContext } from '../../common/types/access-context';

/** Bóc nhãn hiển thị từ các bảng hằng của phân hệ tài sản */
const labelOf = (m: Record<string, { label: string } | string>, k: string) => {
  const v = m[k];
  return typeof v === 'string' ? v : v?.label ?? k;
};

export type ColumnType = 'text' | 'number' | 'date' | 'datetime' | 'enum' | 'boolean';

export interface SourceColumn {
  key: string;
  label: string;
  type: ColumnType;
  /** Biểu thức drizzle — định nghĩa sẵn, client không gửi vào */
  expr: AnyColumn | SQL<any>;
  /** Cho phép tổng hợp sum/avg/min/max (số) */
  numeric?: boolean;
  /** Cho phép làm kích thước nhóm (mặc định true cho text/enum/date) */
  groupable?: boolean;
  /** Tuỳ chọn cho kiểu enum/boolean */
  options?: { value: string; label: string }[];
}

export interface StudioJoin {
  table: unknown;
  on: SQL;
}

export interface DataSourceDef {
  key: string;
  name: string;
  module: string;
  description: string;
  /** Quyền bắt buộc để dùng nguồn */
  permission: string;
  /** Nếu người dùng có quyền này → xem toàn viện, bỏ giới hạn khoa */
  viewAllPermission?: string;
  /** Cột ngày mặc định khi bộ lọc thời gian không chỉ định field */
  dateDefault?: string;
  from: unknown;
  joins?: StudioJoin[];
  columns: SourceColumn[];
  /** Điều kiện nền (ví dụ loại bỏ bản ghi đã xoá mềm) */
  base?: SQL | undefined;
  /** Điều kiện phạm vi khoa (trả undefined = toàn viện) */
  scope?: (user: AccessContext) => SQL | undefined;
}

/* ---------------------------------------------------------------- helpers */

function deptScopeIds(user: AccessContext): number[] {
  const ids = new Set(user.departmentIds ?? []);
  if (user.departmentId) ids.add(user.departmentId);
  return [...ids];
}

function canAll(user: AccessContext, perm?: string): boolean {
  if (user.isSuperAdmin) return true;
  if (perm && user.permissions.includes(perm)) return true;
  return user.dataScope === 'ALL';
}

const col = (def: Omit<SourceColumn, 'groupable'> & { groupable?: boolean }): SourceColumn => def;

/* ------------------------------------------------------------------ HSBA */

const hsbaStatusOptions = Object.entries(REQUEST_STATUS_LABELS).map(([value, label]) => ({ value, label }));

const hsbaRequestsSource: DataSourceDef = {
  key: 'hsba-requests',
  name: 'Phiếu đề nghị sửa HSBA',
  module: 'HSBA',
  description: 'Toàn bộ phiếu đề nghị sửa hồ sơ bệnh án, trạng thái và thời gian xử lý',
  permission: 'hsba.request.view',
  dateDefault: 'createdAt',
  from: hsbaRequests,
  base: isNull(hsbaRequests.deletedAt),
  scope: (user) => {
    if (user.isSuperAdmin || user.dataScope === 'ALL') return undefined;
    const ids = deptScopeIds(user);
    return ids.length
      ? or(inArray(hsbaRequests.departmentId, ids), eq(hsbaRequests.createdBy, user.id))
      : eq(hsbaRequests.createdBy, user.id);
  },
  columns: [
    col({ key: 'id', label: 'ID', type: 'number', expr: hsbaRequests.id, numeric: true, groupable: false }),
    col({ key: 'code', label: 'Số phiếu', type: 'text', expr: hsbaRequests.code }),
    col({ key: 'status', label: 'Trạng thái', type: 'enum', expr: hsbaRequests.status, options: hsbaStatusOptions }),
    col({ key: 'pendingStepKey', label: 'Bước đang chờ', type: 'text', expr: hsbaRequests.pendingStepKey }),
    col({ key: 'patientName', label: 'Tên người bệnh', type: 'text', expr: hsbaRequests.patientName }),
    col({ key: 'patientCode', label: 'Mã người bệnh', type: 'text', expr: hsbaRequests.patientCode }),
    col({ key: 'maKcb', label: 'Mã KCB', type: 'text', expr: hsbaRequests.maKcb }),
    col({ key: 'departmentName', label: 'Khoa/phòng', type: 'text', expr: hsbaRequests.departmentName }),
    col({ key: 'requesterName', label: 'Người đề nghị', type: 'text', expr: hsbaRequests.requesterName }),
    col({ key: 'reason', label: 'Lý do', type: 'text', expr: hsbaRequests.reason }),
    col({
      key: 'priority', label: 'Ưu tiên', type: 'enum', expr: hsbaRequests.priority,
      options: [
        { value: 'NORMAL', label: 'Bình thường' },
        { value: 'HIGH', label: 'Cao' },
        { value: 'URGENT', label: 'Khẩn' },
        { value: 'LOW', label: 'Thấp' },
      ],
    }),
    col({ key: 'returnCount', label: 'Số lần trả lại', type: 'number', expr: hsbaRequests.returnCount, numeric: true }),
    col({ key: 'createdAt', label: 'Ngày tạo', type: 'datetime', expr: hsbaRequests.createdAt }),
    col({ key: 'updatedAt', label: 'Cập nhật', type: 'datetime', expr: hsbaRequests.updatedAt }),
    col({ key: 'completedAt', label: 'Ngày hoàn tất', type: 'datetime', expr: hsbaRequests.completedAt }),
  ],
};

/* ---------------------------------------------------------- Báo cáo khoa */

const reportEntriesSource: DataSourceDef = {
  key: 'report-entries',
  name: 'Số liệu báo cáo khoa',
  module: 'REPORT',
  description: 'Ô số liệu các khoa nhập theo mẫu báo cáo (B4…), gộp theo hàng chỉ tiêu / khoa / ngày',
  permission: 'report.view.view',
  viewAllPermission: 'report.view.all-departments',
  dateDefault: 'entryDate',
  from: reportEntries,
  joins: [
    { table: reportRows, on: eq(reportRows.id, reportEntries.rowId) },
    { table: reportSections, on: eq(reportSections.id, reportRows.sectionId) },
    { table: reportTemplates, on: eq(reportTemplates.id, reportSections.templateId) },
    { table: departments, on: eq(departments.id, reportTemplates.departmentId) },
  ],
  scope: (user) => {
    if (canAll(user, 'report.view.all-departments')) return undefined;
    const ids = deptScopeIds(user);
    return ids.length
      ? or(inArray(reportTemplates.departmentId, ids), eq(reportEntries.updatedBy, user.id))
      : eq(reportEntries.updatedBy, user.id);
  },
  columns: [
    col({ key: 'entryDate', label: 'Ngày nhập', type: 'date', expr: reportEntries.entryDate }),
    col({ key: 'value', label: 'Giá trị', type: 'number', expr: reportEntries.value, numeric: true, groupable: false }),
    col({ key: 'rowLabel', label: 'Chỉ tiêu', type: 'text', expr: reportRows.rowLabel }),
    col({ key: 'groupLabel', label: 'Nhóm chỉ tiêu', type: 'text', expr: reportRows.groupLabel }),
    col({ key: 'templateName', label: 'Mẫu báo cáo', type: 'text', expr: reportTemplates.name }),
    col({ key: 'reportCode', label: 'Mã báo cáo', type: 'text', expr: reportTemplates.code }),
    col({ key: 'departmentName', label: 'Khoa/phòng', type: 'text', expr: departments.name }),
    col({ key: 'colKey', label: 'Cột dữ liệu', type: 'text', expr: reportEntries.colKey }),
    col({ key: 'updatedAt', label: 'Cập nhật', type: 'datetime', expr: reportEntries.updatedAt }),
  ],
};

/* ------------------------------------------------------------- Tài sản */

const bookValue = sql<number>`greatest(0, ${assets.originalCost} - ${assets.accumulatedDepreciation})::float8`;
const assetStatusOptions = Object.keys(ASSET_STATUS).map((value) => ({ value, label: labelOf(ASSET_STATUS, value) }));
const assetConditionOptions = Object.keys(ASSET_CONDITION).map((value) => ({ value, label: labelOf(ASSET_CONDITION, value) }));

const assetsSource: DataSourceDef = {
  key: 'assets',
  name: 'Tài sản / thiết bị',
  module: 'ASSET',
  description: 'Danh mục tài sản: số lượng, nguyên giá, giá trị còn lại, phân bổ theo khoa/nhóm/tình trạng',
  permission: 'asset.view',
  viewAllPermission: 'asset.view-all',
  dateDefault: 'acquisitionDate',
  from: assets,
  joins: [
    { table: departments, on: eq(departments.id, assets.departmentId) },
    { table: assetCategories, on: eq(assetCategories.id, assets.categoryId) },
  ],
  base: isNull(assets.deletedAt),
  scope: (user) => {
    if (user.isSuperAdmin || user.permissions.includes('asset.view-all')) return undefined;
    const ids = deptScopeIds(user);
    return ids.length
      ? or(inArray(assets.departmentId, ids), eq(assets.custodianId, user.id))
      : eq(assets.custodianId, user.id);
  },
  columns: [
    col({ key: 'id', label: 'ID', type: 'number', expr: assets.id, numeric: true, groupable: false }),
    col({ key: 'code', label: 'Mã tài sản', type: 'text', expr: assets.code }),
    col({ key: 'name', label: 'Tên tài sản', type: 'text', expr: assets.name }),
    col({ key: 'categoryName', label: 'Nhóm tài sản', type: 'text', expr: assetCategories.name }),
    col({
      key: 'kind', label: 'Loại', type: 'enum', expr: assets.kind,
      options: [
        { value: 'TSCD_HUU_HINH', label: 'TSCĐ hữu hình' },
        { value: 'TSCD_VO_HINH', label: 'TSCĐ vô hình' },
        { value: 'CCDC', label: 'Công cụ dụng cụ' },
      ],
    }),
    col({ key: 'departmentName', label: 'Khoa/phòng', type: 'text', expr: departments.name }),
    col({ key: 'status', label: 'Trạng thái', type: 'enum', expr: assets.status, options: assetStatusOptions }),
    col({ key: 'condition', label: 'Tình trạng', type: 'enum', expr: assets.condition, options: assetConditionOptions }),
    col({ key: 'quantity', label: 'Số lượng', type: 'number', expr: assets.quantity, numeric: true, groupable: false }),
    col({ key: 'originalCost', label: 'Nguyên giá', type: 'number', expr: assets.originalCost, numeric: true, groupable: false }),
    col({ key: 'accumulatedDepreciation', label: 'Khấu hao lũy kế', type: 'number', expr: assets.accumulatedDepreciation, numeric: true, groupable: false }),
    col({ key: 'bookValue', label: 'Giá trị còn lại', type: 'number', expr: bookValue, numeric: true, groupable: false }),
    col({ key: 'yearOfManufacture', label: 'Năm sản xuất', type: 'number', expr: assets.yearOfManufacture }),
    col({ key: 'riskClass', label: 'Nhóm rủi ro', type: 'enum', expr: assets.riskClass, options: ['A', 'B', 'C', 'D'].map((v) => ({ value: v, label: `Nhóm ${v}` })) }),
    col({ key: 'acquisitionDate', label: 'Ngày ghi tăng', type: 'date', expr: assets.acquisitionDate }),
    col({ key: 'inUseDate', label: 'Ngày đưa vào dùng', type: 'date', expr: assets.inUseDate }),
    col({ key: 'warrantyUntil', label: 'Bảo hành đến', type: 'date', expr: assets.warrantyUntil }),
  ],
};

const assetTxTypeOptions = Object.keys(TX_TYPES).map((value) => ({ value, label: labelOf(TX_TYPES, value) }));
const assetTxStatusOptions = Object.keys(TX_STATUS).map((value) => ({ value, label: labelOf(TX_STATUS, value) }));

const assetTransactionsSource: DataSourceDef = {
  key: 'asset-transactions',
  name: 'Chứng từ tài sản',
  module: 'ASSET',
  description: 'Ghi tăng, cấp phát, điều chuyển, thu hồi, báo hỏng, sửa chữa, thanh lý… theo thời gian',
  permission: 'asset.transaction.view',
  viewAllPermission: 'asset.view-all',
  dateDefault: 'txDate',
  from: assetTransactions,
  joins: [],
  columns: [
    col({ key: 'id', label: 'ID', type: 'number', expr: assetTransactions.id, numeric: true, groupable: false }),
    col({ key: 'code', label: 'Số chứng từ', type: 'text', expr: assetTransactions.code }),
    col({ key: 'type', label: 'Loại chứng từ', type: 'enum', expr: assetTransactions.type, options: assetTxTypeOptions }),
    col({ key: 'status', label: 'Trạng thái', type: 'enum', expr: assetTransactions.status, options: assetTxStatusOptions }),
    col({ key: 'txDate', label: 'Ngày chứng từ', type: 'date', expr: assetTransactions.txDate }),
    col({ key: 'amount', label: 'Giá trị', type: 'number', expr: assetTransactions.amount, numeric: true, groupable: false }),
    col({ key: 'createdAt', label: 'Ngày lập', type: 'datetime', expr: assetTransactions.createdAt }),
  ],
};

/* -------------------------------------------------------------- Hệ thống */

const usersSource: DataSourceDef = {
  key: 'users',
  name: 'Người dùng',
  module: 'SYSTEM',
  description: 'Tài khoản hệ thống theo khoa/phòng, trạng thái hoạt động, lần đăng nhập cuối',
  permission: 'user.view',
  dateDefault: 'createdAt',
  from: users,
  joins: [{ table: departments, on: eq(departments.id, users.departmentId) }],
  base: isNull(users.deletedAt),
  columns: [
    col({ key: 'id', label: 'ID', type: 'number', expr: users.id, numeric: true, groupable: false }),
    col({ key: 'username', label: 'Tên đăng nhập', type: 'text', expr: users.username }),
    col({ key: 'fullName', label: 'Họ tên', type: 'text', expr: users.fullName }),
    col({ key: 'title', label: 'Chức danh', type: 'text', expr: users.title }),
    col({ key: 'departmentName', label: 'Khoa/phòng', type: 'text', expr: departments.name }),
    col({
      key: 'active', label: 'Đang hoạt động', type: 'enum',
      expr: sql<string>`case when ${users.active} then 'true' else 'false' end`,
      options: [
        { value: 'true', label: 'Đang hoạt động' },
        { value: 'false', label: 'Ngừng' },
      ],
    }),
    col({ key: 'lastLoginAt', label: 'Đăng nhập cuối', type: 'datetime', expr: users.lastLoginAt }),
    col({ key: 'createdAt', label: 'Ngày tạo', type: 'datetime', expr: users.createdAt }),
  ],
};

const auditLogsSource: DataSourceDef = {
  key: 'audit-logs',
  name: 'Nhật ký kiểm toán',
  module: 'SYSTEM',
  description: 'Hoạt động của người dùng trên hệ thống theo thời gian / phân hệ / hành động',
  permission: 'audit.log.view',
  dateDefault: 'createdAt',
  from: auditLogs,
  joins: [],
  scope: (user) => {
    if (user.isSuperAdmin || user.dataScope === 'ALL') return undefined;
    const ids = deptScopeIds(user);
    return ids.length
      ? or(inArray(auditLogs.departmentId, ids), eq(auditLogs.userId, user.id))
      : eq(auditLogs.userId, user.id);
  },
  columns: [
    col({ key: 'id', label: 'ID', type: 'number', expr: auditLogs.id, numeric: true, groupable: false }),
    col({ key: 'username', label: 'Tài khoản', type: 'text', expr: auditLogs.username }),
    col({ key: 'fullName', label: 'Người thực hiện', type: 'text', expr: auditLogs.fullName }),
    col({ key: 'action', label: 'Hành động', type: 'text', expr: auditLogs.action }),
    col({ key: 'module', label: 'Phân hệ', type: 'text', expr: auditLogs.module }),
    col({ key: 'entity', label: 'Đối tượng', type: 'text', expr: auditLogs.entity }),
    col({ key: 'description', label: 'Diễn giải', type: 'text', expr: auditLogs.description, groupable: false }),
    col({ key: 'createdAt', label: 'Thời gian', type: 'datetime', expr: auditLogs.createdAt }),
  ],
};

/* ------------------------------------------------------------- Registry */

export const DATA_SOURCES: DataSourceDef[] = [
  hsbaRequestsSource,
  reportEntriesSource,
  assetsSource,
  assetTransactionsSource,
  usersSource,
  auditLogsSource,
];

export function findDataSource(key: string): DataSourceDef | undefined {
  return DATA_SOURCES.find((s) => s.key === key);
}

/** Danh mục nguồn + trường cho giao diện cấu hình (đã lọc theo quyền) */
export function describeSourcesFor(user: AccessContext) {
  return DATA_SOURCES.filter(
    (s) => user.isSuperAdmin || user.permissions.includes(s.permission),
  ).map((s) => ({
    key: s.key,
    name: s.name,
    module: s.module,
    description: s.description,
    dateDefault: s.dateDefault,
    columns: s.columns.map((c) => ({
      key: c.key,
      label: c.label,
      type: c.type,
      numeric: !!c.numeric,
      groupable: c.groupable ?? (c.type !== 'number' || !!c.numeric),
      options: c.options,
    })),
  }));
}

/* Điều kiện nền + phạm vi của nguồn (ghép bằng AND ở engine) */
export function baseConditions(def: DataSourceDef, user: AccessContext): (SQL | undefined)[] {
  const conditions: (SQL | undefined)[] = [def.base];
  if (def.scope) conditions.push(def.scope(user));
  return conditions;
}
