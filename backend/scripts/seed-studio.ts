/**
 * Trang dashboard hệ thống mặc định cho Studio (GĐ3) — tái hiện bố cục
 * "Bảng điều khiển" cổ điển thành canvas kéo-thả để quản trị có thể chỉnh sửa.
 * Idempotent: chỉ tạo khi chưa có mã DASH_TONG_QUAN.
 */
import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from '../src/db/schema';
import { StudioKind, StudioScope, type StudioLayout } from '../src/db/schema';

export const STUDIO_DEFAULT_DASHBOARD = 'DASH_TONG_QUAN';

/** Bố cục mặc định: 5 KPI + diễn biến phiếu + số liệu theo khoa + tác vụ + nhật ký */
export function defaultOverviewLayout(): StudioLayout {
  return {
    widgets: [
      {
        id: 'kpi-tong-phieu', type: 'kpi', title: 'Tổng phiếu sửa HSBA', w: 2, h: 'S',
        dataSpec: { source: 'hsba-requests', metrics: [{ field: 'id', agg: 'count', label: 'Tổng phiếu' }] },
        options: { tone: 'primary', icon: 'clipboard' },
      },
      {
        id: 'kpi-cho-ky', type: 'kpi', title: 'Đang chờ ký/duyệt', w: 2, h: 'S',
        dataSpec: {
          source: 'hsba-requests',
          metrics: [{ field: 'id', agg: 'count', label: 'Phiếu chờ' }],
          filters: [{ field: 'status', op: 'in', value: ['CHO_DE_NGHI', 'CHO_KHTB', 'CHO_TC', 'CHO_TAICHINH'] }],
        },
        options: { tone: 'warning', icon: 'clock' },
      },
      {
        id: 'kpi-hoan-tat', type: 'kpi', title: 'Đã hoàn tất', w: 2, h: 'S',
        dataSpec: {
          source: 'hsba-requests',
          metrics: [{ field: 'id', agg: 'count', label: 'Đã hoàn tất' }],
          filters: [{ field: 'status', op: 'eq', value: 'HOAN_TAT' }],
        },
        options: { tone: 'success', icon: 'check' },
      },
      {
        id: 'kpi-tra-lai', type: 'kpi', title: 'Bị trả lại', w: 2, h: 'S',
        dataSpec: {
          source: 'hsba-requests',
          metrics: [{ field: 'id', agg: 'count', label: 'Bị trả lại' }],
          filters: [{ field: 'status', op: 'eq', value: 'TRA_LAI' }],
        },
        options: { tone: 'danger', icon: 'undo' },
      },
      {
        id: 'kpi-so-lieu-hom-nay', type: 'kpi', title: 'Ô số liệu hôm nay', w: 2, h: 'S',
        dataSpec: {
          source: 'report-entries',
          metrics: [{ field: 'value', agg: 'count', label: 'Ô số liệu' }],
          dateRange: { preset: 'today' },
        },
        options: { tone: 'primary', icon: 'sheet' },
      },
      {
        id: 'kpi-nhap-7-ngay', type: 'kpi', title: 'Ô số liệu 7 ngày', w: 2, h: 'S',
        dataSpec: {
          source: 'report-entries',
          metrics: [{ field: 'value', agg: 'count', label: 'Ô số liệu' }],
          dateRange: { preset: '7d' },
        },
        options: { tone: 'muted', icon: 'activity' },
      },
      {
        id: 'chart-dien-bien', type: 'area', title: 'Diễn biến phiếu 14 ngày gần nhất', w: 8, h: 'L',
        dataSpec: {
          source: 'hsba-requests',
          metrics: [{ field: 'id', agg: 'count', label: 'Phiếu tạo' }],
          dimensions: [{ field: 'createdAt', bucket: 'day' }],
          dateRange: { preset: '14d' },
        },
        options: { fillGaps: true },
      },
      {
        id: 'pie-trang-thai', type: 'donut', title: 'Phiếu theo trạng thái', w: 4, h: 'L',
        dataSpec: {
          source: 'hsba-requests',
          metrics: [{ field: 'id', agg: 'count', label: 'Số phiếu' }],
          dimensions: [{ field: 'status' }],
          dateRange: { preset: '90d' },
        },
      },
      {
        id: 'bar-theo-khoa', type: 'barh', title: 'Số liệu nhập theo khoa (30 ngày)', w: 7, h: 'L',
        dataSpec: {
          source: 'report-entries',
          metrics: [{ field: 'value', agg: 'sum', label: 'Tổng giá trị' }],
          dimensions: [{ field: 'departmentName' }],
          dateRange: { preset: '30d' },
          orderBy: [{ key: 'm0', dir: 'desc' }],
          limit: 12,
        },
      },
      {
        id: 'builtin-jobs', type: 'builtin', builtin: 'jobs', title: 'Tác vụ định kỳ', w: 5, h: 'L',
      },
      {
        id: 'builtin-audit', type: 'builtin', builtin: 'audit', title: 'Hoạt động gần đây', w: 12, h: 'M',
      },
    ],
  };
}

export async function seedStudioDefaultDashboard(
  db: NodePgDatabase<typeof schema>,
  log: (msg: string) => void,
): Promise<void> {
  const [existing] = await db
    .select({ id: schema.studioDashboards.id })
    .from(schema.studioDashboards)
    .where(eq(schema.studioDashboards.code, STUDIO_DEFAULT_DASHBOARD))
    .limit(1);
  if (existing) {
    log(`= Dashboard hệ thống "${STUDIO_DEFAULT_DASHBOARD}" đã tồn tại`);
    return;
  }
  await db.insert(schema.studioDashboards).values({
    code: STUDIO_DEFAULT_DASHBOARD,
    name: 'Tổng quan công tác',
    description: 'Bảng điều khiển mặc định của hệ thống — quản trị có thể chỉnh sửa trực tiếp, người dùng có thể nhân bản làm bản riêng.',
    kind: StudioKind.DASHBOARD,
    scope: StudioScope.SYSTEM,
    layout: defaultOverviewLayout(),
    isDefault: true,
    createdBy: 1,
    updatedBy: 1,
  });
  log(`+ Đã tạo dashboard hệ thống ${STUDIO_DEFAULT_DASHBOARD}`);
}
