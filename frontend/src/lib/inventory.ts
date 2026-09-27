'use client';

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '@/lib/api';

/* Kiểm kê tài sản — hằng số, kiểu dữ liệu, hook dùng chung (nhãn lấy từ /asset-inventories/meta,
   key ổn định nên khai báo sẵn để hiển thị khi chưa tải xong meta) */

export const INVENTORY_STATUS: Record<string, { label: string; color: string }> = {
  NHAP: { label: 'Nháp', color: '#64748b' },
  DANG_KIEM_KE: { label: 'Đang kiểm kê', color: '#2563eb' },
  CHO_DUYET: { label: 'Chờ duyệt', color: '#d97706' },
  HOAN_TAT: { label: 'Hoàn tất', color: '#16a34a' },
  DA_HUY: { label: 'Đã huỷ', color: '#334155' },
};

export const INVENTORY_RESULT: Record<string, { label: string; color: string; hint: string }> = {
  KHOP: { label: 'Khớp', color: '#16a34a', hint: 'Có mặt đúng nơi sử dụng, tình trạng như sổ sách' },
  SAI_VI_TRI: { label: 'Sai vị trí', color: '#2563eb', hint: 'Có mặt nhưng ở khoa/vị trí khác sổ sách' },
  SAI_TINH_TRANG: { label: 'Khác tình trạng', color: '#d97706', hint: 'Có mặt, tình trạng thực tế khác sổ sách' },
  THIEU: { label: 'Thiếu', color: '#dc2626', hint: 'Có trong sổ sách nhưng không tìm thấy' },
  THUA: { label: 'Thừa', color: '#9333ea', hint: 'Tìm thấy nhưng không thuộc phạm vi/sổ sách' },
  KHONG_RO: { label: 'Chưa có hồ sơ', color: '#be185d', hint: 'Mã không có trong hồ sơ tài sản' },
};

export const INVENTORY_RESOLUTION: Record<string, { label: string; txType?: string }> = {
  DIEU_CHUYEN: { label: 'Điều chuyển về đúng nơi sử dụng', txType: 'DIEU_CHUYEN' },
  BAO_MAT: { label: 'Báo mất', txType: 'BAO_MAT' },
  BAO_HONG: { label: 'Báo hỏng', txType: 'BAO_HONG' },
  GHI_NHAN: { label: 'Ghi nhận, không lập chứng từ' },
};

export const CHECK_BUTTON: Record<string, { label: string; color: string }> = {
  CO: { label: 'Có mặt', color: '#16a34a' },
  KHONG_THAY: { label: 'Không thấy', color: '#dc2626' },
  CHUA_KIEM: { label: 'Đặt lại', color: '#64748b' },
};

export interface InventoryStats {
  expected: number; checked: number; found: number; pending: number;
  KHOP: number; SAI_VI_TRI: number; SAI_TINH_TRANG: number; THIEU: number; THUA: number; KHONG_RO: number;
  expectedCost: number; foundCost: number; missingCost: number; missingValue: number; extraCost: number;
  unresolved: number; lastScanAt: string | null;
}

export interface InventoryRow {
  id: number; code: string; name: string; status: string; statusLabel: string;
  scope: { departmentIds?: number[]; locationIds?: number[]; categoryIds?: number[]; groups?: string[]; includeStore?: boolean };
  scopeText: string; plannedDate: string | null; snapshotAt: string | null; finishedAt: string | null; completedAt: string | null;
  decisionNo: string; committee: { name: string; position?: string; role?: string }[];
  memberIds: number[]; blind: boolean; note: string; conclusion: string;
  createdByName: string; approvedByName: string;
  stats: InventoryStats;
  can: { edit: boolean; start: boolean; scan: boolean; finish: boolean; reopen: boolean; resolve: boolean; complete: boolean; cancel: boolean; remove: boolean; seeExpected: boolean };
}

export interface InventoryItemRow {
  id: number; assetId: number | null; code: string; barcode: string; name: string; model: string; serialNumber: string; unit: string;
  currentStatus: string | null; expected: boolean; scannedCode: string;
  bookDepartmentId: number | null; bookDepartmentName: string | null; bookLocationId: number | null; bookLocationName: string | null;
  bookCustodianName: string; bookStatus: string; bookCondition: string; bookCost: number; bookValue: number;
  checkState: string; actualDepartmentId: number | null; actualDepartmentName: string | null;
  actualLocationId: number | null; actualLocationName: string | null; actualCondition: string;
  result: string; scanCount: number; method: string; checkedAt: string | null; checkedByName: string;
  note: string; resolution: string; resolutionTxId: number | null;
}

export interface ScanOutcome {
  clientId: string; code: string; outcome: 'FOUND' | 'DUPLICATE' | 'EXTRA' | 'UNKNOWN' | 'INVALID';
  itemId?: number; result?: string; assetId?: number; item?: InventoryItemRow | null; synced?: boolean;
}

export interface ListedScan {
  clientId: string;
  code: string;
  at: number;
  method: string;
  departmentId?: number | null;
  locationId?: number | null;
  condition?: string;
  synced: boolean;
}

/** Phiên kiểm kê trên thiết bị (localStorage `qlbs-inv-*`) — hỗ trợ offline và giữ tiến độ khi đổi máy/mất mạng */
export interface LocalSession {
  id: number;
  savedAt: number;
  status: string;
  blind: boolean;
  expected: { code: string; barcode: string; serialNumber: string; name: string; departmentId: number | null; locationId: number | null; condition: string }[];
  found: { code: string; name: string }[];
  departments: { id: number; name: string }[];
  locations: { id: number; name: string; level: number }[];
  scans: ListedScan[];
  edit?: { departmentId?: number | null; locationId?: number | null; condition?: string };
}

export const sessionKey = (id: number) => `qlbs-inv-${id}`;
export const deviceIdKey = 'qlbs-device-id';

export function getDeviceId(): string {
  if (typeof localStorage === 'undefined') return '';
  let id = localStorage.getItem(deviceIdKey);
  if (!id) {
    id = Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem(deviceIdKey, id);
  }
  return id;
}

export function loadSession(id: number): LocalSession | null {
  try {
    const s = JSON.parse(localStorage.getItem(sessionKey(id)) ?? 'null') as LocalSession | null;
    return s && s.id === id ? s : null;
  } catch {
    return null;
  }
}

export function saveSession(s: LocalSession) {
  try {
    localStorage.setItem(sessionKey(s.id), JSON.stringify({ ...s, savedAt: Date.now() }));
  } catch {
    /* bộ nhớ đầy — bỏ qua, dữ liệu chưa đồng bộ vẫn nằm trong s */
  }
}

export const useInventoryMeta = () =>
  useQuery({
    queryKey: ['asset-inventory-meta'],
    queryFn: () => apiFetch<Record<string, unknown>>('/asset-inventories/meta'),
    staleTime: 600_000,
  });
