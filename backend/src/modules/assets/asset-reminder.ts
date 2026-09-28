/**
 * Tác vụ định kỳ `asset.due-reminder`: nhắc hạn kiểm định / bảo dưỡng / hết bảo hành.
 *  - Người quản lý tài sản (có asset.view-all hoặc asset.transaction.approve): bản tổng hợp toàn viện.
 *  - Người chỉ xem theo khoa (vd trưởng khoa): bản tổng hợp khoa mình.
 * Mỗi người nhận tối đa 1 thông báo nhắc hạn / ngày (chạy lại trong ngày không gửi trùng).
 */
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { DbService } from '../../db/db.service';
import { assets, departments, notifications, permissions, rolePermissions, userRoles, users } from '../../db/schema';
import { ACTIVE_STATUSES } from './asset-constants';
import type { RealtimeService } from '../realtime/realtime.service';

const TITLE_PREFIX = 'Nhắc hạn thiết bị';

export async function runAssetDueReminder(db: DbService, days = 15, realtime?: RealtimeService) {
  const d = Math.min(365, Math.max(0, Math.trunc(days)));
  const today = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
  const rows = await db.db
    .select({
      departmentId: assets.departmentId,
      departmentName: departments.name,
      calOver: sql<number>`count(*) filter (where ${assets.nextCalibrationDate} < ${today}::date)::int`,
      calSoon: sql<number>`count(*) filter (where ${assets.nextCalibrationDate} between ${today}::date and ${today}::date + ${d}::int)::int`,
      mtOver: sql<number>`count(*) filter (where ${assets.nextMaintenanceDate} < ${today}::date)::int`,
      mtSoon: sql<number>`count(*) filter (where ${assets.nextMaintenanceDate} between ${today}::date and ${today}::date + ${d}::int)::int`,
      wrSoon: sql<number>`count(*) filter (where ${assets.warrantyUntil} between ${today}::date and ${today}::date + ${d}::int)::int`,
    })
    .from(assets)
    .leftJoin(departments, eq(departments.id, assets.departmentId))
    .where(and(isNull(assets.deletedAt), inArray(assets.status, ACTIVE_STATUSES as never[])))
    .groupBy(assets.departmentId, departments.name);
  const active = rows.filter((r) => r.calOver + r.calSoon + r.mtOver + r.mtSoon + r.wrSoon > 0);
  if (!active.length) return { message: `Không có thiết bị quá hạn hoặc đến hạn trong ${d} ngày tới`, sent: 0 };

  const sum = (list: typeof active, k: keyof (typeof active)[number]) => list.reduce((s, r) => s + Number(r[k] ?? 0), 0);
  const text = (list: typeof active) => {
    const parts: string[] = [];
    const over = sum(list, 'calOver') + sum(list, 'mtOver');
    if (over) parts.push(`${over} lượt QUÁ HẠN (kiểm định ${sum(list, 'calOver')}, bảo dưỡng ${sum(list, 'mtOver')})`);
    const soon = sum(list, 'calSoon') + sum(list, 'mtSoon');
    if (soon) parts.push(`${soon} lượt đến hạn trong ${d} ngày (kiểm định ${sum(list, 'calSoon')}, bảo dưỡng ${sum(list, 'mtSoon')})`);
    const wr = sum(list, 'wrSoon');
    if (wr) parts.push(`${wr} thiết bị sắp hết bảo hành`);
    return parts.join('; ');
  };

  // Người nhận: ai có quyền xem tài sản
  const perms = await db.db
    .select({ userId: userRoles.userId, code: permissions.code, departmentId: users.departmentId })
    .from(permissions)
    .innerJoin(rolePermissions, eq(rolePermissions.permissionId, permissions.id))
    .innerJoin(userRoles, eq(userRoles.roleId, rolePermissions.roleId))
    .innerJoin(users, eq(users.id, userRoles.userId))
    .where(and(inArray(permissions.code, ['asset.view', 'asset.view-all', 'asset.transaction.approve']), eq(users.active, true), isNull(users.deletedAt)));
  const byUser = new Map<number, { codes: Set<string>; departmentId: number | null }>();
  for (const p of perms) {
    if (!byUser.has(p.userId)) byUser.set(p.userId, { codes: new Set(), departmentId: p.departmentId });
    byUser.get(p.userId)!.codes.add(p.code);
  }
  // Đã nhắc hôm nay → bỏ qua
  const already = new Set(
    (
      await db.db
        .select({ userId: notifications.userId })
        .from(notifications)
        .where(and(eq(notifications.module, 'ASSET'), sql`${notifications.title} like ${TITLE_PREFIX + '%'}`, sql`(${notifications.createdAt} at time zone 'Asia/Ho_Chi_Minh')::date = ${today}::date`))
    ).map((r) => r.userId),
  );
  const values: (typeof notifications.$inferInsert)[] = [];
  for (const [userId, u] of byUser) {
    if (already.has(userId)) continue;
    const global = u.codes.has('asset.view-all') || u.codes.has('asset.transaction.approve');
    const list = global ? active : active.filter((r) => r.departmentId && r.departmentId === u.departmentId);
    if (!list.length) continue;
    const over = sum(list, 'calOver') + sum(list, 'mtOver');
    values.push({
      userId,
      title: `${TITLE_PREFIX}${global ? '' : ` — ${list[0].departmentName ?? ''}`}: ${over ? `${over} quá hạn` : 'sắp đến hạn'}`,
      body: text(list),
      level: over ? 'WARNING' : 'INFO',
      link: '/tai-san/bao-tri',
      module: 'ASSET',
      entityId: today,
    });
  }
  if (values.length) {
    await db.db.insert(notifications).values(values);
    realtime?.publish({ topic: 'notification', type: 'new', userIds: values.map((v) => v.userId) });
  }
  return { message: `Đã gửi ${values.length} thông báo nhắc hạn — toàn viện: ${text(active)}`, sent: values.length, departments: active.length };
}
