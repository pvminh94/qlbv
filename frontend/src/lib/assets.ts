'use client';

/** Hằng số & tiện ích phân hệ Quản lý tài sản (bản sao phía giao diện của backend/modules/assets/asset-constants.ts) */
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from './api';

export const ASSET_STATUS: Record<string, { label: string; color: string }> = {
  TRONG_KHO: { label: 'Trong kho', color: '#64748b' },
  DANG_SU_DUNG: { label: 'Đang sử dụng', color: '#16a34a' },
  DANG_SUA_CHUA: { label: 'Đang sửa chữa', color: '#d97706' },
  HONG: { label: 'Hỏng', color: '#dc2626' },
  CHO_THANH_LY: { label: 'Chờ thanh lý', color: '#9333ea' },
  DA_THANH_LY: { label: 'Đã thanh lý', color: '#334155' },
  MAT: { label: 'Mất', color: '#991b1b' },
};

export const ASSET_CONDITION: Record<string, string> = { TOT: 'Tốt', KHA: 'Khá', TRUNG_BINH: 'Trung bình', KEM: 'Kém', HONG: 'Hỏng' };

export const TX_STATUS: Record<string, { label: string; color: string }> = {
  NHAP: { label: 'Nháp', color: '#64748b' },
  CHO_DUYET: { label: 'Chờ duyệt', color: '#d97706' },
  DA_DUYET: { label: 'Đã duyệt', color: '#16a34a' },
  TU_CHOI: { label: 'Từ chối', color: '#dc2626' },
  DA_HUY: { label: 'Đã huỷ', color: '#334155' },
};

export const GROUP_COLORS = ['#0d9488', '#2563eb', '#7c3aed', '#db2777', '#ea580c', '#ca8a04', '#16a34a', '#0891b2', '#64748b', '#9333ea'];

export interface TxTypeMeta {
  label: string;
  short: string;
  allowed: string[];
  needsTarget?: boolean;
  amountLabel?: string;
  description: string;
}

export interface AssetRow {
  id: number;
  code: string;
  barcode: string;
  name: string;
  model: string;
  serialNumber: string;
  unit: string;
  status: string;
  condition: string;
  categoryId: number | null;
  categoryName: string | null;
  group: string | null;
  departmentId: number | null;
  departmentName: string | null;
  locationId: number | null;
  locationName: string | null;
  custodianId: number | null;
  custodianName: string;
  supplierName: string | null;
  manufacturerName: string | null;
  fundingSourceName: string | null;
  countryOfOrigin: string;
  yearOfManufacture: number | null;
  originalCost: number;
  accumulatedDepreciation: number;
  bookValue: number;
  depreciationMethod: string;
  usefulLifeMonths: number;
  annualRate: number;
  acquisitionDate: string | null;
  inUseDate: string | null;
  warrantyUntil: string | null;
  requiresCalibration: boolean;
  nextCalibrationDate: string | null;
  nextMaintenanceDate: string | null;
  lastDepreciationPeriod: string;
  riskClass: string;
  tags: string[];
  parentId: number | null;
  lastInventoryAt?: string | null;
  updatedAt: string;
}

export interface CatalogItem {
  id: number;
  code: string;
  name: string;
  parentId?: number | null;
  level?: number;
  path?: string;
  active: boolean;
  usage: number;
  hasChildren?: boolean;
  [k: string]: unknown;
}

/** Tiền đầy đủ: 1.250.000.000 */
export const money = (v: unknown) => Number(v ?? 0).toLocaleString('vi-VN', { maximumFractionDigits: 0 });

/** Tiền rút gọn: 1,25 tỷ · 350 tr */
export function moneyShort(v: unknown): string {
  const n = Number(v ?? 0);
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${(n / 1e9).toLocaleString('vi-VN', { maximumFractionDigits: 2 })} tỷ`;
  if (abs >= 1e6) return `${(n / 1e6).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} tr`;
  if (abs >= 1e3) return `${(n / 1e3).toLocaleString('vi-VN', { maximumFractionDigits: 0 })} nghìn`;
  return n.toLocaleString('vi-VN');
}

export const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0);

/** Số ngày từ hôm nay tới một ngày (âm = quá hạn) */
export function daysUntil(date?: string | null): number | null {
  if (!date) return null;
  const t = new Date(`${date.slice(0, 10)}T00:00:00`).getTime();
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.round((t - now.getTime()) / 86_400_000);
}

export function useAssetCatalog(kind: 'categories' | 'locations' | 'suppliers' | 'funding', activeOnly = false) {
  return useQuery({
    queryKey: ['asset-catalog', kind, activeOnly],
    queryFn: () => apiFetch<CatalogItem[]>(`/asset-catalogs/${kind}${activeOnly ? '?activeOnly=true' : ''}`),
    staleTime: 60_000,
  });
}

export function useAssetMeta() {
  return useQuery({
    queryKey: ['asset-meta'],
    queryFn: async () => {
      const [cat, tx] = await Promise.all([
        apiFetch<{ kinds: Record<string, string>; groups: Record<string, string>; methods: Record<string, string>; locationKinds: Record<string, string>; supplierRoles: Record<string, string> }>('/asset-catalogs/meta'),
        apiFetch<{ types: Record<string, TxTypeMeta> }>('/asset-transactions/meta'),
      ]);
      return { ...cat, txTypes: tx.types };
    },
    staleTime: 5 * 60_000,
  });
}

export function useAssetOptions() {
  return useQuery({
    queryKey: ['asset-options'],
    queryFn: () =>
      apiFetch<{ departments: { id: number; code: string; name: string }[]; users: { id: number; fullName: string; username: string; departmentId: number | null }[] }>('/assets/options'),
    staleTime: 60_000,
  });
}

/** Tên hiển thị dạng cây: "— — Tên" */
export const treeLabel = (c: CatalogItem) => `${'\u2003'.repeat(Math.max(0, (c.level ?? 1) - 1))}${c.name}`;
