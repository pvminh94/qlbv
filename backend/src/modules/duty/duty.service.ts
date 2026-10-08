import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, gte, ilike, inArray, isNull, lte, ne, or, sql, type SQL } from 'drizzle-orm';
import * as ExcelJS from 'exceljs';
import { DbService, type Executor } from '../../db/db.service';
import {
  dutyAbsences,
  dutyAssignments,
  dutyClosedDays,
  dutyLogs,
  dutyPeriods,
  dutyRoles,
  dutyRooms,
  dutyShiftTypes,
  dutySlots,
  departments,
  users,
  type DutyRules,
} from '../../db/schema';
import type { AccessContext } from '../../common/types/access-context';
import { DutyCoreService, type PairCtx, type SlotRow } from './duty-core.service';
import {
  DEFAULT_DUTY_RULES,
  bangkokToday,
  dateRange,
  fmtDate,
  fmtDm,
  isoWeekday,
  normalizeRules,
  violationText,
  addDays,
  shiftInterval,
  type EvaluateResult,
} from './duty-rules';
import type {
  AbsenceDto,
  AbsenceQueryDto,
  AssignDto,
  ForceDto,
  GenerateSlotsDto,
  PeriodDto,
  PeriodQueryDto,
  SlotDto,
  UnlockDto,
  UpdatePeriodDto,
  UpdateSlotDto,
} from './duty.dto';

const DAY_LABEL = ['', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'Chủ nhật'];
const ADVISORY_NS = 9301;

const fmtVn = (d: Date | string | null | undefined) =>
  d
    ? new Date(d).toLocaleString('vi-VN', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' })
    : '';

function parseInstant(value: string, label: string): Date {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new BadRequestException(`${label} không hợp lệ`);
  return d;
}

function assertRange(start: string, end: string) {
  if (start > end) throw new BadRequestException('Ngày bắt đầu phải trước hoặc trùng ngày kết thúc');
  if (dateRange(start, end).length > 62) throw new BadRequestException('Kỳ lịch tối đa 62 ngày (nên lập theo tuần hoặc theo tháng)');
}

@Injectable()
export class DutyService {
  constructor(
    private readonly db: DbService,
    readonly core: DutyCoreService,
  ) {}

  /* ================================================================ Kỳ lịch */

  async listPeriods(user: AccessContext, q: PeriodQueryDto) {
    const where: SQL[] = [];
    if (!this.core.canManageAny(user)) where.push(ne(dutyPeriods.status, 'NHAP'));
    if (q.from) where.push(gte(dutyPeriods.endDate, q.from));
    if (q.to) where.push(lte(dutyPeriods.startDate, q.to));
    const periods = await this.db.db
      .select()
      .from(dutyPeriods)
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(dutyPeriods.startDate))
      .limit(300);
    if (!periods.length) return [];
    const ids = periods.map((p) => p.id);
    const slotAgg = await this.db.db
      .select({
        periodId: dutySlots.periodId,
        slots: sql<number>`count(*)::int`,
        required: sql<number>`coalesce(sum(${dutySlots.requiredCount}), 0)::int`,
      })
      .from(dutySlots)
      .where(inArray(dutySlots.periodId, ids))
      .groupBy(dutySlots.periodId);
    const filledAgg = await this.db.db
      .select({ periodId: dutySlots.periodId, filled: sql<number>`count(${dutyAssignments.id})::int` })
      .from(dutySlots)
      .leftJoin(dutyAssignments, eq(dutyAssignments.slotId, dutySlots.id))
      .where(inArray(dutySlots.periodId, ids))
      .groupBy(dutySlots.periodId);
    const sMap = new Map(slotAgg.map((r) => [r.periodId, r]));
    const fMap = new Map(filledAgg.map((r) => [r.periodId, r.filled]));
    return periods.map((p) => {
      const { phase, locked } = this.core.phaseOf(p);
      const s = sMap.get(p.id);
      return {
        ...p,
        phase,
        locked,
        slotCount: s?.slots ?? 0,
        requiredCount: s?.required ?? 0,
        filledCount: fMap.get(p.id) ?? 0,
      };
    });
  }

  async getPeriodView(user: AccessContext, id: number) {
    const p = await this.core.getPeriod(id);
    if (!this.core.canSeePeriod(user, p.status)) throw new NotFoundException('Không tìm thấy kỳ lịch');
    return { ...p, ...this.core.phaseOf(p) };
  }

  async createPeriod(user: AccessContext, dto: PeriodDto) {
    assertRange(dto.startDate, dto.endDate);
    const lockAt = parseInstant(dto.lockAt, 'Thời điểm chốt lịch');
    const opens = dto.registrationOpensAt ? parseInstant(dto.registrationOpensAt, 'Thời điểm mở đăng ký') : null;
    const [row] = await this.db.db
      .insert(dutyPeriods)
      .values({
        name: dto.name,
        startDate: dto.startDate,
        endDate: dto.endDate,
        lockAt,
        registrationOpensAt: opens,
        rules: normalizeRules(dto.rules),
        note: dto.note ?? '',
        status: 'NHAP',
        createdBy: user.id,
        updatedBy: user.id,
      })
      .returning();
    await this.core.log(this.db.db, {
      periodId: row.id,
      action: 'PERIOD_CREATE',
      actorId: user.id,
      detail: { name: row.name, startDate: row.startDate, endDate: row.endDate, lockAt: row.lockAt },
    });
    this.core.emit('period', row.id);
    return row;
  }

  async updatePeriod(user: AccessContext, id: number, dto: UpdatePeriodDto) {
    const p = await this.core.getPeriod(id);
    const { locked } = this.core.phaseOf(p);
    const structural = dto.startDate !== undefined || dto.endDate !== undefined;
    if (locked && (structural || dto.rules !== undefined || dto.lockAt !== undefined || dto.registrationOpensAt !== undefined)) {
      throw new ConflictException('Kỳ lịch đã chốt — chỉ được sửa tên và ghi chú (mở chốt để chỉnh cấu hình)');
    }
    const startDate = dto.startDate ?? p.startDate;
    const endDate = dto.endDate ?? p.endDate;
    const datesChanged = startDate !== p.startDate || endDate !== p.endDate;
    if (datesChanged && p.status !== 'NHAP') throw new ConflictException('Chỉ đổi ngày của kỳ đang ở trạng thái nháp');
    assertRange(startDate, endDate);
    if (datesChanged) {
      const [{ n }] = await this.db.db
        .select({ n: sql<number>`count(*)::int` })
        .from(dutySlots)
        .where(and(eq(dutySlots.periodId, id), or(lte(dutySlots.dutyDate, addDays(startDate, -1)), gte(dutySlots.dutyDate, addDays(endDate, 1)))));
      if (n > 0) throw new ConflictException(`Còn ${n} ô trực nằm ngoài khoảng ngày mới — xoá các ô đó trước`);
    }
    const patch: Partial<typeof dutyPeriods.$inferInsert> = { updatedAt: new Date(), updatedBy: user.id };
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.note !== undefined) patch.note = dto.note;
    if (dto.startDate !== undefined) patch.startDate = dto.startDate;
    if (dto.endDate !== undefined) patch.endDate = dto.endDate;
    if (dto.lockAt !== undefined) patch.lockAt = parseInstant(dto.lockAt, 'Thời điểm chốt lịch');
    if (dto.registrationOpensAt !== undefined) {
      patch.registrationOpensAt = dto.registrationOpensAt ? parseInstant(dto.registrationOpensAt, 'Thời điểm mở đăng ký') : null;
    }
    if (dto.rules !== undefined) patch.rules = normalizeRules({ ...p.rules, ...dto.rules });
    const [row] = await this.db.db.update(dutyPeriods).set(patch).where(eq(dutyPeriods.id, id)).returning();
    const changed = Object.keys(patch).filter((k) => !['updatedAt', 'updatedBy'].includes(k));
    await this.core.log(this.db.db, { periodId: id, action: 'PERIOD_UPDATE', actorId: user.id, detail: { changed } });
    this.core.emit('period', id);
    return { ...row, ...this.core.phaseOf(row) };
  }

  async deletePeriod(user: AccessContext, id: number) {
    const p = await this.core.getPeriod(id);
    if (p.status !== 'NHAP') throw new ConflictException('Chỉ xoá được kỳ lịch đang ở trạng thái nháp');
    const [{ n }] = await this.db.db
      .select({ n: sql<number>`count(*)::int` })
      .from(dutyAssignments)
      .innerJoin(dutySlots, eq(dutySlots.id, dutyAssignments.slotId))
      .where(eq(dutySlots.periodId, id));
    if (n > 0) throw new ConflictException(`Kỳ lịch đã có ${n} phân công — không thể xoá`);
    await this.db.db.delete(dutyPeriods).where(eq(dutyPeriods.id, id));
    this.core.emit('period', id);
    return { ok: true };
  }

  /** Công bố: NHAP → CONG_BO. Kiểm tra đủ người (nếu cấu hình bắt buộc) rồi báo cho từng người trực. */
  async publishPeriod(user: AccessContext, id: number, force: boolean) {
    const p = await this.core.getPeriod(id);
    if (p.status !== 'NHAP') throw new ConflictException('Kỳ lịch này đã được công bố');
    const rows = await this.core.loadSlots(this.db.db, eq(dutySlots.periodId, id));
    if (!rows.length) throw new ConflictException('Kỳ lịch chưa có ô trực nào — hãy tạo ô trước khi công bố');
    const missing = rows.filter((r) => Number(r.filled) < r.requiredCount);
    const rules = p.rules ?? DEFAULT_DUTY_RULES;
    if (missing.length && rules.requireFullBeforePublish && !force) {
      const sample = missing
        .slice(0, 5)
        .map((r) => `${fmtDm(r.dutyDate)} ${r.roomCode} ${r.shiftCode} (${r.filled}/${r.requiredCount})`)
        .join('; ');
      throw new ConflictException(`Còn ${missing.length} ô thiếu người: ${sample}${missing.length > 5 ? '…' : ''}. Bổ sung người hoặc công bố có ghi nhận.`);
    }
    const assigned = await this.db.db
      .select({ userId: dutyAssignments.userId })
      .from(dutyAssignments)
      .innerJoin(dutySlots, eq(dutySlots.id, dutyAssignments.slotId))
      .where(eq(dutySlots.periodId, id));
    const perUser = new Map<number, number>();
    for (const a of assigned) perUser.set(a.userId, (perUser.get(a.userId) ?? 0) + 1);

    await this.db.transaction(async (tx) => {
      await tx
        .update(dutyPeriods)
        .set({ status: 'CONG_BO', publishedAt: new Date(), updatedAt: new Date(), updatedBy: user.id })
        .where(eq(dutyPeriods.id, id));
      await this.core.log(tx, {
        periodId: id,
        action: 'PUBLISH',
        actorId: user.id,
        reason: missing.length && force ? 'Công bố có ghi nhận ô thiếu người' : '',
        detail: { slots: rows.length, missing: missing.length, forced: force && missing.length > 0 },
      });
    });
    for (const [userId, n] of perUser) {
      this.core.notifyAfterCommit([userId], {
        title: 'Đã công bố lịch trực',
        body: `${p.name}: bạn có ${n} ca trực. Mở mục Lịch của tôi để xem chi tiết.`,
        level: 'INFO',
        link: '/lich-truc/cua-toi',
        module: 'DUTY',
        entityId: String(id),
      });
    }
    this.core.emit('period', id);
    return { ok: true, missing: missing.length, notified: perUser.size };
  }

  /** Chốt sớm (trước mốc tự động) */
  async lockPeriod(user: AccessContext, id: number) {
    const p = await this.core.getPeriod(id);
    if (p.status === 'NHAP') throw new ConflictException('Hãy công bố kỳ lịch trước khi chốt');
    if (p.status === 'DA_CHOT') throw new ConflictException('Kỳ lịch đã được chốt');
    await this.db.db
      .update(dutyPeriods)
      .set({ status: 'DA_CHOT', lockedAt: new Date(), updatedAt: new Date(), updatedBy: user.id })
      .where(eq(dutyPeriods.id, id));
    await this.core.log(this.db.db, { periodId: id, action: 'LOCK', actorId: user.id, detail: { early: p.lockAt.getTime() > Date.now() } });
    this.core.emit('period', id);
    return { ok: true };
  }

  /** Mở chốt: chỉ khi kỳ đang khoá; bắt buộc ghi lý do và đặt mốc chốt mới ở tương lai */
  async unlockPeriod(user: AccessContext, id: number, dto: UnlockDto) {
    const p = await this.core.getPeriod(id);
    const { phase } = this.core.phaseOf(p);
    if (phase === 'NHAP') throw new ConflictException('Kỳ lịch chưa công bố nên chưa có trạng thái chốt');
    if (phase === 'MO') throw new ConflictException('Kỳ lịch đang mở, không cần mở chốt');
    const newLock = parseInstant(dto.lockAt, 'Mốc chốt mới');
    if (newLock.getTime() <= Date.now()) throw new BadRequestException('Mốc chốt mới phải ở tương lai');
    await this.db.db
      .update(dutyPeriods)
      .set({ status: 'CONG_BO', lockedAt: null, lockAt: newLock, updatedAt: new Date(), updatedBy: user.id })
      .where(eq(dutyPeriods.id, id));
    await this.core.log(this.db.db, {
      periodId: id,
      action: 'UNLOCK',
      actorId: user.id,
      reason: dto.reason,
      detail: { newLockAt: newLock.toISOString() },
    });
    this.core.emit('period', id);
    return { ok: true };
  }

  /* ================================================================ Ô trực */

  private async roomsByIds(ids: number[]) {
    return this.db.db.select().from(dutyRooms).where(inArray(dutyRooms.id, ids));
  }

  /** Tạo hàng loạt ô: ngày (theo thứ) × phòng × ca × vai trò, bỏ qua ngày nghỉ và ô đã có */
  async generateSlots(user: AccessContext, periodId: number, dto: GenerateSlotsDto) {
    const p = await this.core.getPeriod(periodId);
    if (this.core.phaseOf(p).locked) throw new ConflictException('Kỳ lịch đã chốt — không thể thêm ô trực');
    const roomIds = [...new Set(dto.roomIds)];
    const shiftIds = [...new Set(dto.shiftIds)];
    const roleIds = [...new Set(dto.roleIds)];
    const weekdays = [...new Set(dto.weekdays)];

    const rooms = await this.roomsByIds(roomIds);
    if (rooms.length !== roomIds.length) throw new NotFoundException('Có phòng khám không tồn tại');
    for (const r of rooms) {
      if (!r.active) throw new BadRequestException(`Phòng ${r.code} đang tắt — bật lại trong danh mục trước`);
      this.core.ensureManageDept(user, r.departmentId, `Phòng ${r.code}`);
    }
    const shifts = await this.db.db.select().from(dutyShiftTypes).where(inArray(dutyShiftTypes.id, shiftIds));
    if (shifts.length !== shiftIds.length || shifts.some((s) => !s.active)) throw new BadRequestException('Ca trực không tồn tại hoặc đang tắt');
    const roles = await this.db.db.select().from(dutyRoles).where(inArray(dutyRoles.id, roleIds));
    if (roles.length !== roleIds.length || roles.some((r) => !r.active)) throw new BadRequestException('Vai trò trực không tồn tại hoặc đang tắt');

    const closed = new Set(
      (
        await this.db.db
          .select({ date: dutyClosedDays.date })
          .from(dutyClosedDays)
          .where(and(gte(dutyClosedDays.date, p.startDate), lte(dutyClosedDays.date, p.endDate)))
      ).map((r) => r.date),
    );
    const days = dateRange(p.startDate, p.endDate).filter(
      (d) => weekdays.includes(isoWeekday(d)) && !(dto.skipClosedDays !== false && closed.has(d)),
    );
    const total = days.length * rooms.length * shifts.length * roles.length;
    if (total > 4000) throw new BadRequestException(`Lần tạo này sinh ${total} ô (tối đa 4000) — hãy chia nhỏ phạm vi`);
    const values: Array<typeof dutySlots.$inferInsert> = [];
    for (const d of days) {
      for (const r of rooms) {
        for (const s of shifts) {
          for (const role of roles) {
            values.push({ periodId, dutyDate: d, roomId: r.id, shiftId: s.id, roleId: role.id, requiredCount: dto.requiredCount ?? 1 });
          }
        }
      }
    }
    let created = 0;
    if (values.length) {
      const inserted = await this.db.db.insert(dutySlots).values(values).onConflictDoNothing().returning({ id: dutySlots.id });
      created = inserted.length;
    }
    await this.core.log(this.db.db, {
      periodId,
      action: 'SLOTS_GENERATE',
      actorId: user.id,
      detail: { created, attempted: values.length, rooms: rooms.map((r) => r.code), shifts: shifts.map((s) => s.code), roles: roles.map((r) => r.code), weekdays },
    });
    this.core.emit('slots', periodId);
    return { created, skipped: values.length - created, days: days.length };
  }

  async createSlot(user: AccessContext, periodId: number, dto: SlotDto) {
    const p = await this.core.getPeriod(periodId);
    if (this.core.phaseOf(p).locked) throw new ConflictException('Kỳ lịch đã chốt — không thể thêm ô trực');
    if (dto.dutyDate < p.startDate || dto.dutyDate > p.endDate) throw new BadRequestException('Ngày trực nằm ngoài kỳ lịch');
    const [room] = await this.roomsByIds([dto.roomId]);
    if (!room) throw new NotFoundException('Không tìm thấy phòng khám');
    this.core.ensureManageDept(user, room.departmentId, `Phòng ${room.code}`);
    const [dup] = await this.db.db
      .select({ id: dutySlots.id })
      .from(dutySlots)
      .where(
        and(
          eq(dutySlots.periodId, periodId),
          eq(dutySlots.dutyDate, dto.dutyDate),
          eq(dutySlots.roomId, dto.roomId),
          eq(dutySlots.shiftId, dto.shiftId),
          eq(dutySlots.roleId, dto.roleId),
        ),
      )
      .limit(1);
    if (dup) throw new ConflictException('Ô trực này đã tồn tại');
    const [row] = await this.db.db
      .insert(dutySlots)
      .values({ periodId, dutyDate: dto.dutyDate, roomId: dto.roomId, shiftId: dto.shiftId, roleId: dto.roleId, requiredCount: dto.requiredCount ?? 1, note: dto.note ?? '' })
      .returning();
    await this.core.log(this.db.db, { periodId, slotId: row.id, action: 'SLOT_CREATE', actorId: user.id, detail: { date: dto.dutyDate, room: room.code } });
    this.core.emit('slots', periodId);
    return this.slotDetail(row.id);
  }

  async updateSlot(user: AccessContext, slotId: number, dto: UpdateSlotDto) {
    const s = await this.core.getSlot(slotId);
    this.core.ensureManageDept(user, s.roomDepartmentId, `Phòng ${s.roomCode}`);
    if (this.core.phaseOf({ status: s.periodStatus, lockAt: s.lockAt }).locked) throw new ConflictException('Kỳ lịch đã chốt — không sửa ô trực');
    if (dto.requiredCount !== undefined && dto.requiredCount < Number(s.filled)) {
      throw new ConflictException(`Ô đang có ${s.filled} người trực — số người cần không thể nhỏ hơn`);
    }
    await this.db.db
      .update(dutySlots)
      .set({ ...(dto.requiredCount !== undefined ? { requiredCount: dto.requiredCount } : {}), ...(dto.note !== undefined ? { note: dto.note } : {}), updatedAt: new Date() })
      .where(eq(dutySlots.id, slotId));
    await this.core.log(this.db.db, { periodId: s.periodId, slotId, action: 'SLOT_UPDATE', actorId: user.id, detail: { ...dto } });
    this.core.emit('slots', s.periodId);
    return this.slotDetail(slotId);
  }

  async deleteSlot(user: AccessContext, slotId: number, dto: ForceDto) {
    const s = await this.core.getSlot(slotId);
    this.core.ensureManageDept(user, s.roomDepartmentId, `Phòng ${s.roomCode}`);
    if (this.core.phaseOf({ status: s.periodStatus, lockAt: s.lockAt }).locked) throw new ConflictException('Kỳ lịch đã chốt — không xoá ô trực');
    const people = await this.assignmentsOfSlots([slotId]);
    if (people.length && !dto.force) {
      throw new ConflictException(`Ô đang có ${people.length} người trực. Gỡ phân công trước, hoặc xoá kèm lý do`);
    }
    if (people.length && !dto.reason?.trim()) throw new BadRequestException('Vui lòng ghi lý do xoá ô đang có người trực');
    await this.db.db.transaction(async (tx) => {
      await tx.delete(dutySlots).where(eq(dutySlots.id, slotId));
      await this.core.log(tx, {
        periodId: s.periodId,
        slotId,
        action: 'SLOT_DELETE',
        actorId: user.id,
        reason: dto.reason ?? '',
        detail: { date: s.dutyDate, room: s.roomCode, shift: s.shiftCode, people: people.map((p) => p.fullName) },
      });
    });
    if (people.length && s.periodStatus !== 'NHAP') {
      for (const p of people) {
        this.core.notifyAfterCommit([p.userId], {
          title: 'Ca trực đã bị huỷ',
          body: `Ca ${s.shiftCode} · ${s.roomCode} ngày ${fmtDate(s.dutyDate)} đã được huỷ khỏi lịch.`,
          level: 'WARNING',
          link: '/lich-truc/cua-toi',
          module: 'DUTY',
          entityId: String(s.periodId),
        });
      }
    }
    this.core.emit('slots', s.periodId);
    return { ok: true };
  }

  /** Người đang trực trong các ô (kèm tên, chức danh, khoa) */
  async assignmentsOfSlots(slotIds: number[]) {
    if (!slotIds.length) return [];
    return this.db
      .db.select({
        id: dutyAssignments.id,
        slotId: dutyAssignments.slotId,
        userId: dutyAssignments.userId,
        source: dutyAssignments.source,
        note: dutyAssignments.note,
        createdAt: dutyAssignments.createdAt,
        fullName: users.fullName,
        title: users.title,
        departmentId: users.departmentId,
        departmentName: departments.name,
      })
      .from(dutyAssignments)
      .innerJoin(users, eq(users.id, dutyAssignments.userId))
      .leftJoin(departments, eq(departments.id, users.departmentId))
      .where(inArray(dutyAssignments.slotId, slotIds))
      .orderBy(asc(users.fullName));
  }

  async slotDetail(slotId: number) {
    const s = await this.core.getSlot(slotId);
    const people = await this.assignmentsOfSlots([slotId]);
    return { ...this.slotDto(s), assignments: people };
  }

  slotDto(s: SlotRow) {
    const iv = this.core.toEngineSlot(s);
    return {
      id: s.id,
      periodId: s.periodId,
      dutyDate: s.dutyDate,
      roomId: s.roomId,
      roomCode: s.roomCode,
      roomName: s.roomName,
      roomDepartmentId: s.roomDepartmentId,
      shiftId: s.shiftId,
      shiftCode: s.shiftCode,
      shiftName: s.shiftName,
      shiftColor: s.shiftColor,
      startTime: s.startTime,
      endTime: s.endTime,
      isNight: s.isNight,
      hours: iv.hours,
      start: iv.start,
      end: iv.end,
      roleId: s.roleId,
      roleName: s.roleName,
      requiredTitle: s.requiredTitle,
      requiredCount: s.requiredCount,
      filled: Number(s.filled) || 0,
      note: s.note,
      periodStatus: s.periodStatus,
      locked: this.core.phaseOf({ status: s.periodStatus, lockAt: s.lockAt }).locked,
      past: iv.start <= Date.now(),
    };
  }

  /* ================================================================ Phân công */

  /** Quản lý xếp người vào ô (theo phạm vi khoa); kỳ đã chốt chỉ đổi qua ngoại lệ */
  async assign(user: AccessContext, slotId: number, dto: AssignDto) {
    const s = await this.core.getSlot(slotId);
    this.core.ensureManageDept(user, s.roomDepartmentId, `Phòng ${s.roomCode}`);
    const { locked } = this.core.phaseOf({ status: s.periodStatus, lockAt: s.lockAt });
    if (locked) throw new ConflictException('Kỳ lịch đã chốt — chỉ đổi người trực qua mục Đổi trực khẩn (KHTH)');
    if (dto.force) {
      if (!this.core.isAll(user)) throw new ForbiddenException('Chỉ điều phối toàn viện mới được bỏ qua ràng buộc');
      if (!dto.reason || dto.reason.trim().length < 5) throw new BadRequestException('Bỏ qua ràng buộc phải ghi lý do (tối thiểu 5 ký tự)');
    }
    const result = await this.db.db.transaction(async (tx) => {
      await tx.execute(sql`select id from duty_slots where id = ${slotId} for update`);
      await tx.execute(sql`select pg_advisory_xact_lock(${ADVISORY_NS}, ${dto.userId})`);
      const fresh = await this.core.getSlot(slotId, tx);
      const userMap = await this.core.loadUsers(tx, [dto.userId]);
      const u = userMap.get(dto.userId);
      if (!u) throw new NotFoundException('Không tìm thấy nhân viên');
      const pairs: PairCtx[] = this.core.pairsFor(fresh, [u]);
      const res = (await this.core.evaluatePairs(tx, pairs)).get(`${slotId}:${dto.userId}`) as EvaluateResult;
      if (!res.ok && !dto.force) throw new ConflictException(violationText(res));
      const [row] = await tx
        .insert(dutyAssignments)
        .values({ slotId, userId: dto.userId, source: 'PHAN_CONG', note: dto.note ?? '', createdBy: user.id })
        .onConflictDoNothing()
        .returning({ id: dutyAssignments.id });
      if (!row) throw new ConflictException('Nhân viên này đã được xếp trong ca');
      await this.core.log(tx, {
        periodId: s.periodId,
        slotId,
        action: 'ASSIGN',
        actorId: user.id,
        userId: dto.userId,
        reason: dto.force ? dto.reason ?? '' : dto.note ?? '',
        detail: {
          forced: !!dto.force && res.errors.length > 0,
          violations: dto.force ? res.errors.map((e) => e.message) : [],
          warnings: res.warnings.map((w) => w.message),
          shift: s.shiftCode,
          room: s.roomCode,
          date: s.dutyDate,
        },
      });
      return { name: u.fullName, warnings: res.warnings.length };
    });
    if (s.periodStatus !== 'NHAP') {
      this.core.notifyAfterCommit([dto.userId], {
        title: 'Bạn được xếp lịch trực',
        body: `${DAY_LABEL[isoWeekday(s.dutyDate)]} ${fmtDate(s.dutyDate)} · ${s.roomCode} · ${s.shiftCode} (${s.roleName})`,
        level: 'INFO',
        link: '/lich-truc/cua-toi',
        module: 'DUTY',
        entityId: String(s.periodId),
      });
    }
    this.core.emit('assign', s.periodId);
    return { ...(await this.slotDetail(slotId)), warnings: result.warnings };
  }

  async unassign(user: AccessContext, assignmentId: number, reason?: string) {
    const [a] = await this.db.db.select().from(dutyAssignments).where(eq(dutyAssignments.id, assignmentId)).limit(1);
    if (!a) throw new NotFoundException('Không tìm thấy phân công');
    const s = await this.core.getSlot(a.slotId);
    this.core.ensureManageDept(user, s.roomDepartmentId, `Phòng ${s.roomCode}`);
    if (this.core.phaseOf({ status: s.periodStatus, lockAt: s.lockAt }).locked) {
      throw new ConflictException('Kỳ lịch đã chốt — chỉ gỡ người trực qua mục Đổi trực khẩn (KHTH)');
    }
    await this.db.db.transaction(async (tx) => {
      await tx.delete(dutyAssignments).where(eq(dutyAssignments.id, assignmentId));
      await this.core.log(tx, {
        periodId: s.periodId,
        slotId: s.id,
        action: 'UNASSIGN',
        actorId: user.id,
        userId: a.userId,
        reason: reason ?? '',
        detail: { shift: s.shiftCode, room: s.roomCode, date: s.dutyDate, source: a.source },
      });
    });
    if (s.periodStatus !== 'NHAP') {
      this.core.notifyAfterCommit([a.userId], {
        title: 'Bạn được gỡ khỏi ca trực',
        body: `${fmtDate(s.dutyDate)} · ${s.roomCode} · ${s.shiftCode}${reason ? ` — ${reason}` : ''}`,
        level: 'WARNING',
        link: '/lich-truc/cua-toi',
        module: 'DUTY',
        entityId: String(s.periodId),
      });
    }
    this.core.emit('assign', s.periodId);
    return { ok: true };
  }

  private registrationBlockReason(p: { status: string; rules: DutyRules; registrationOpensAt: Date | null }, now = Date.now()): string | null {
    if (p.status === 'NHAP') return 'Kỳ lịch chưa được công bố';
    if (!(p.rules ?? DEFAULT_DUTY_RULES).allowSelfRegister) return 'Kỳ lịch này không cho tự đăng ký — liên hệ người phân công';
    if (p.registrationOpensAt && p.registrationOpensAt.getTime() > now) return `Đăng ký mở từ ${fmtVn(p.registrationOpensAt)}`;
    return null;
  }

  /** Nhân viên tự đăng ký ca trống (sau khi công bố, trước khi chốt, đúng ràng buộc) */
  async selfRegister(user: AccessContext, slotId: number) {
    const s = await this.core.getSlot(slotId);
    const { locked } = this.core.phaseOf({ status: s.periodStatus, lockAt: s.lockAt });
    if (locked) throw new ConflictException('Kỳ lịch đã chốt — không thể tự đăng ký. Hãy gửi yêu cầu ngoại lệ tới KHTH');
    const blocked = this.registrationBlockReason({ status: s.periodStatus, rules: s.rules, registrationOpensAt: s.registrationOpensAt });
    if (blocked) throw new ConflictException(blocked);
    await this.db.db.transaction(async (tx) => {
      await tx.execute(sql`select id from duty_slots where id = ${slotId} for update`);
      await tx.execute(sql`select pg_advisory_xact_lock(${ADVISORY_NS}, ${user.id})`);
      const fresh = await this.core.getSlot(slotId, tx);
      const userMap = await this.core.loadUsers(tx, [user.id]);
      const u = userMap.get(user.id);
      if (!u) throw new NotFoundException('Không tìm thấy tài khoản');
      const res = (await this.core.evaluatePairs(tx, this.core.pairsFor(fresh, [u]))).get(`${slotId}:${user.id}`) as EvaluateResult;
      if (!res.ok) throw new ConflictException(violationText(res));
      await tx.insert(dutyAssignments).values({ slotId, userId: user.id, source: 'DANG_KY', createdBy: user.id });
      await this.core.log(tx, {
        periodId: s.periodId,
        slotId,
        action: 'SELF_REGISTER',
        actorId: user.id,
        userId: user.id,
        detail: { shift: s.shiftCode, room: s.roomCode, date: s.dutyDate, warnings: res.warnings.map((w) => w.message) },
      });
    });
    this.core.emit('assign', s.periodId);
    return { ok: true };
  }

  /** Chỉ hủy ca do chính mình đăng ký, trước giờ bắt đầu và trước khi chốt */
  async selfUnregister(user: AccessContext, slotId: number) {
    const s = await this.core.getSlot(slotId);
    const [a] = await this.db.db
      .select()
      .from(dutyAssignments)
      .where(and(eq(dutyAssignments.slotId, slotId), eq(dutyAssignments.userId, user.id)))
      .limit(1);
    if (!a) throw new NotFoundException('Bạn chưa đăng ký ca này');
    if (a.source !== 'DANG_KY') {
      throw new ConflictException('Ca do người phân công xếp — hãy gửi yêu cầu nhường ca để được duyệt');
    }
    if (this.core.phaseOf({ status: s.periodStatus, lockAt: s.lockAt }).locked) throw new ConflictException('Kỳ lịch đã chốt — không thể huỷ đăng ký');
    const iv = this.core.toEngineSlot(s);
    if (iv.start <= Date.now()) throw new ConflictException('Ca đã bắt đầu, không thể huỷ đăng ký');
    await this.db.db.transaction(async (tx) => {
      await tx.delete(dutyAssignments).where(eq(dutyAssignments.id, a.id));
      await this.core.log(tx, { periodId: s.periodId, slotId, action: 'SELF_UNREGISTER', actorId: user.id, userId: user.id, detail: { shift: s.shiftCode, room: s.roomCode, date: s.dutyDate } });
    });
    this.core.emit('assign', s.periodId);
    return { ok: true };
  }

  /** Các ô của kỳ kèm kết quả kiểm tra cho chính người dùng (để hiển thị "có thể đăng ký" hay lý do) */
  async myOptions(user: AccessContext, periodId: number) {
    const p = await this.getPeriodView(user, periodId);
    const rows = await this.core.loadSlots(this.db.db, eq(dutySlots.periodId, periodId));
    const me = (await this.core.loadUsers(this.db.db, [user.id])).get(user.id);
    if (!me) throw new NotFoundException('Không tìm thấy tài khoản');
    const blocked = this.registrationBlockReason(p);
    const { locked } = this.core.phaseOf(p);
    const pairs: PairCtx[] = rows.flatMap((r) => this.core.pairsFor(r, [me], { registrationBlocked: blocked }).map((pc) => ({ ...pc, locked })));
    const results = await this.core.evaluatePairs(this.db.db, pairs);
    const mineSet = new Set(
      (await this.db.db.select({ slotId: dutyAssignments.slotId }).from(dutyAssignments).where(eq(dutyAssignments.userId, user.id))).map((r) => r.slotId),
    );
    return {
      blocked,
      locked,
      items: rows.map((r) => {
        const res = results.get(`${r.id}:${user.id}`);
        return {
          slotId: r.id,
          mine: mineSet.has(r.id),
          canRegister: !res || res.ok,
          errors: res?.errors.map((e) => e.message) ?? [],
          warnings: res?.warnings.map((w) => w.message) ?? [],
        };
      }),
    };
  }

  /** Ứng viên cho một ô: mọi nhân viên đang hoạt động, kèm kết quả kiểm tra (để chọn người có cảnh báo) */
  async candidates(user: AccessContext, slotId: number, q?: string) {
    const s = await this.core.getSlot(slotId);
    this.core.ensureManageDept(user, s.roomDepartmentId, `Phòng ${s.roomCode}`);
    const conds: SQL[] = [eq(users.active, true), isNull(users.deletedAt)];
    if (q?.trim()) {
      const like = `%${q.trim()}%`;
      conds.push(or(ilike(users.fullName, like), ilike(users.username, like)) as SQL);
    }
    const rows = await this.db.db
      .select({ id: users.id, fullName: users.fullName, title: users.title, departmentId: users.departmentId, active: users.active, deletedAt: users.deletedAt, departmentName: departments.name })
      .from(users)
      .leftJoin(departments, eq(departments.id, users.departmentId))
      .where(and(...conds))
      .orderBy(asc(users.fullName))
      .limit(400);
    const engine = rows.map((r) => ({
      id: r.id,
      fullName: r.fullName,
      title: r.title ?? '',
      departmentId: r.departmentId,
      active: !!r.active && !r.deletedAt,
      departmentName: r.departmentName ?? '',
    }));
    const { locked } = this.core.phaseOf({ status: s.periodStatus, lockAt: s.lockAt });
    const pairs = this.core.pairsFor(s, engine).map((pc) => ({ ...pc, locked }));
    const results = await this.core.evaluatePairs(this.db.db, pairs);
    const list = engine.map((u) => {
      const res = results.get(`${s.id}:${u.id}`) as EvaluateResult;
      return {
        userId: u.id,
        fullName: u.fullName,
        title: u.title,
        departmentId: u.departmentId,
        departmentName: u.departmentName,
        sameDepartment: !!s.roomDepartmentId && u.departmentId === s.roomDepartmentId,
        ok: res.ok,
        errors: res.errors.map((e) => e.message),
        warnings: res.warnings.map((w) => w.message),
        codes: res.errors.map((e) => e.code),
      };
    });
    list.sort((a, b) => Number(b.ok) - Number(a.ok) || a.errors.length - b.errors.length || a.warnings.length - b.warnings.length || a.fullName.localeCompare(b.fullName, 'vi'));
    return list;
  }

  /* ================================================================ Lưới lịch */

  /** Toàn bộ dữ liệu một kỳ cho màn hình lịch: phòng, ca, vai trò, ngày, ô, người trực, ngày nghỉ */
  async grid(user: AccessContext, periodId: number) {
    const p = await this.getPeriodView(user, periodId);
    const { locked, phase } = this.core.phaseOf(p);
    const slots = await this.core.loadSlots(this.db.db, eq(dutySlots.periodId, periodId));
    const assignments = await this.assignmentsOfSlots(slots.map((s) => s.id));
    const byslot = new Map<number, typeof assignments>();
    for (const a of assignments) {
      const list = byslot.get(a.slotId) ?? [];
      list.push(a);
      byslot.set(a.slotId, list);
    }
    const closed = await this.db.db
      .select({ date: dutyClosedDays.date, name: dutyClosedDays.name })
      .from(dutyClosedDays)
      .where(and(gte(dutyClosedDays.date, p.startDate), lte(dutyClosedDays.date, p.endDate)));
    const closedMap = new Map(closed.map((c) => [c.date, c.name]));
    const roomMap = new Map<number, { id: number; code: string; name: string; departmentId: number | null; location: string; sortOrder: number }>();
    const shiftMap = new Map<number, { id: number; code: string; name: string; startTime: string; endTime: string; color: string; isNight: boolean; sortOrder: number }>();
    const roleMap = new Map<number, { id: number; code: string; name: string; requiredTitle: string; sortOrder: number }>();
    for (const s of slots) {
      if (!roomMap.has(s.roomId)) roomMap.set(s.roomId, { id: s.roomId, code: s.roomCode, name: s.roomName, departmentId: s.roomDepartmentId, location: s.roomLocation, sortOrder: s.roomSort });
      if (!shiftMap.has(s.shiftId)) shiftMap.set(s.shiftId, { id: s.shiftId, code: s.shiftCode, name: s.shiftName, startTime: s.startTime, endTime: s.endTime, color: s.shiftColor, isNight: s.isNight, sortOrder: s.shiftSort });
      if (!roleMap.has(s.roleId)) roleMap.set(s.roleId, { id: s.roleId, code: s.roleCode, name: s.roleName, requiredTitle: s.requiredTitle, sortOrder: s.roleSort });
    }
    const days = dateRange(p.startDate, p.endDate).map((d) => ({
      date: d,
      weekday: isoWeekday(d),
      label: DAY_LABEL[isoWeekday(d)],
      closed: closedMap.has(d),
      closedName: closedMap.get(d) ?? '',
    }));
    const canManage = this.core.canManageAny(user);
    let absences: Array<{ id: number; userId: number; fullName: string; startDate: string; endDate: string; reason: string }> = [];
    if (canManage) {
      absences = await this.db.db
        .select({ id: dutyAbsences.id, userId: dutyAbsences.userId, fullName: users.fullName, startDate: dutyAbsences.startDate, endDate: dutyAbsences.endDate, reason: dutyAbsences.reason })
        .from(dutyAbsences)
        .innerJoin(users, eq(users.id, dutyAbsences.userId))
        .where(and(lte(dutyAbsences.startDate, p.endDate), gte(dutyAbsences.endDate, p.startDate)))
        .orderBy(asc(users.fullName));
    }
    const slotDtos = slots.map((s) => ({
      ...this.slotDto(s),
      assignments: (byslot.get(s.id) ?? []).map((a) => ({
        id: a.id,
        userId: a.userId,
        fullName: a.fullName,
        title: a.title,
        departmentName: a.departmentName ?? '',
        source: a.source,
        note: a.note,
      })),
    }));
    const required = slotDtos.reduce((acc, s) => acc + s.requiredCount, 0);
    const filled = slotDtos.reduce((acc, s) => acc + Math.min(s.filled, s.requiredCount), 0);
    const people = new Set(assignments.map((a) => a.userId)).size;
    return {
      period: { ...p, phase, locked },
      rooms: [...roomMap.values()].sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code, 'vi', { numeric: true })),
      shifts: [...shiftMap.values()].sort((a, b) => a.sortOrder - b.sortOrder || a.startTime.localeCompare(b.startTime)),
      roles: [...roleMap.values()].sort((a, b) => a.sortOrder - b.sortOrder),
      days,
      slots: slotDtos,
      absences,
      summary: {
        slots: slotDtos.length,
        required,
        filled,
        missing: slotDtos.filter((s) => s.filled < s.requiredCount).length,
        people,
      },
      viewer: {
        userId: user.id,
        canManage,
        canManageAll: this.core.isAll(user),
        canRegister: this.core.hasPerm(user, 'duty.register'),
        canExport: this.core.hasPerm(user, 'duty.export'),
        canApproveSwap: this.core.hasPerm(user, 'duty.swap.approve'),
        canResolveException: this.core.hasPerm(user, 'duty.exception.resolve'),
        mySlotIds: assignments.filter((a) => a.userId === user.id).map((a) => a.slotId),
      },
    };
  }

  /* ================================================================ Nghỉ phép */

  async listAbsences(user: AccessContext, q: AbsenceQueryDto) {
    const where: SQL[] = [];
    if (!this.core.canManageAny(user)) where.push(eq(dutyAbsences.userId, user.id));
    else if (q.userId) where.push(eq(dutyAbsences.userId, q.userId));
    if (q.from) where.push(gte(dutyAbsences.endDate, q.from));
    if (q.to) where.push(lte(dutyAbsences.startDate, q.to));
    return this.db.db
      .select({
        id: dutyAbsences.id,
        userId: dutyAbsences.userId,
        fullName: users.fullName,
        startDate: dutyAbsences.startDate,
        endDate: dutyAbsences.endDate,
        reason: dutyAbsences.reason,
        note: dutyAbsences.note,
        createdBy: dutyAbsences.createdBy,
      })
      .from(dutyAbsences)
      .innerJoin(users, eq(users.id, dutyAbsences.userId))
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(dutyAbsences.startDate))
      .limit(500);
  }

  /** Ca trực của người này bị ảnh hưởng bởi khoảng nghỉ (từ hôm nay trở đi) */
  async affectedByAbsence(userId: number, startDate: string, endDate: string) {
    const from = startDate > bangkokToday() ? startDate : bangkokToday();
    if (from > endDate) return [];
    const rows = await this.db.db
      .select({ slotId: dutySlots.id, dutyDate: dutySlots.dutyDate, roomCode: dutyRooms.code, shiftCode: dutyShiftTypes.code, roleName: dutyRoles.name, periodId: dutySlots.periodId, periodName: dutyPeriods.name })
      .from(dutyAssignments)
      .innerJoin(dutySlots, eq(dutySlots.id, dutyAssignments.slotId))
      .innerJoin(dutyRooms, eq(dutyRooms.id, dutySlots.roomId))
      .innerJoin(dutyShiftTypes, eq(dutyShiftTypes.id, dutySlots.shiftId))
      .innerJoin(dutyRoles, eq(dutyRoles.id, dutySlots.roleId))
      .innerJoin(dutyPeriods, eq(dutyPeriods.id, dutySlots.periodId))
      .where(and(eq(dutyAssignments.userId, userId), gte(dutySlots.dutyDate, from), lte(dutySlots.dutyDate, endDate)))
      .orderBy(asc(dutySlots.dutyDate));
    return rows;
  }

  async createAbsence(user: AccessContext, dto: AbsenceDto) {
    const userId = dto.userId ?? user.id;
    if (dto.startDate > dto.endDate) throw new BadRequestException('Ngày bắt đầu phải trước hoặc trùng ngày kết thúc');
    if (userId !== user.id) {
      if (!this.core.canManageAny(user)) throw new ForbiddenException('Bạn chỉ được ghi nhận nghỉ phép của chính mình');
      const target = (await this.core.loadUsers(this.db.db, [userId])).get(userId);
      if (!target) throw new NotFoundException('Không tìm thấy nhân viên');
      if (!this.core.isAll(user)) this.core.ensureManageDept(user, target.departmentId, `Nhân viên ${target.fullName}`);
    }
    const [row] = await this.db.db
      .insert(dutyAbsences)
      .values({ userId, startDate: dto.startDate, endDate: dto.endDate, reason: dto.reason, note: dto.note ?? '', createdBy: user.id })
      .returning();
    const affected = await this.affectedByAbsence(userId, dto.startDate, dto.endDate);
    if (affected.length) {
      const holders = await this.core.holderIds(['duty.manage', 'duty.manage-all']);
      const who = (await this.core.loadUsers(this.db.db, [userId])).get(userId)?.fullName ?? 'Nhân viên';
      this.core.notifyAfterCommit(holders.filter((id) => id !== userId), {
        title: 'Nghỉ phép ảnh hưởng ca trực',
        body: `${who} nghỉ ${fmtDate(dto.startDate)} → ${fmtDate(dto.endDate)}: ${affected.length} ca trực cần sắp xếp lại.`,
        level: 'WARNING',
        link: '/lich-truc',
        module: 'DUTY',
        entityId: String(row.id),
      });
    }
    await this.core.log(this.db.db, {
      action: 'ABSENCE',
      actorId: user.id,
      userId,
      detail: { startDate: dto.startDate, endDate: dto.endDate, reason: dto.reason, affected: affected.length },
    });
    this.core.emit('absence', affected[0]?.periodId ?? null);
    return { ...row, affected };
  }

  async deleteAbsence(user: AccessContext, id: number) {
    const [row] = await this.db.db.select().from(dutyAbsences).where(eq(dutyAbsences.id, id)).limit(1);
    if (!row) throw new NotFoundException('Không tìm thấy bản ghi nghỉ phép');
    if (row.userId !== user.id) {
      if (!this.core.canManageAny(user)) throw new ForbiddenException('Không có quyền xoá bản ghi này');
      const target = (await this.core.loadUsers(this.db.db, [row.userId])).get(row.userId);
      if (!this.core.isAll(user) && target) this.core.ensureManageDept(user, target.departmentId, `Nhân viên ${target.fullName}`);
    }
    await this.db.db.delete(dutyAbsences).where(eq(dutyAbsences.id, id));
    this.core.emit('absence', null);
    return { ok: true };
  }

  /** Danh bạ nhân viên đang hoạt động (chỉ tên, chức danh, khoa) — để chọn người nhận khi nhường/đổi ca */
  async staff(q?: string) {
    const conds: SQL[] = [eq(users.active, true), isNull(users.deletedAt)];
    if (q?.trim()) {
      const like = `%${q.trim()}%`;
      conds.push(or(ilike(users.fullName, like), ilike(users.username, like)) as SQL);
    }
    const rows = await this.db.db
      .select({ id: users.id, fullName: users.fullName, title: users.title, departmentName: departments.name })
      .from(users)
      .leftJoin(departments, eq(departments.id, users.departmentId))
      .where(and(...conds))
      .orderBy(asc(users.fullName))
      .limit(500);
    return rows.map((r) => ({ id: r.id, fullName: r.fullName, title: r.title ?? '', departmentName: r.departmentName ?? '' }));
  }

  /* ================================================================ Của tôi */

  async me(user: AccessContext) {
    const today = bangkokToday();
    const mine = await this.db.db
      .select({ slotId: dutyAssignments.slotId, source: dutyAssignments.source })
      .from(dutyAssignments)
      .innerJoin(dutySlots, eq(dutySlots.id, dutyAssignments.slotId))
      .where(and(eq(dutyAssignments.userId, user.id), gte(dutySlots.dutyDate, addDays(today, -14))));
    const srcMap = new Map(mine.map((m) => [m.slotId, m.source]));
    const slotRows = mine.length ? await this.core.loadSlots(this.db.db, inArray(dutySlots.id, mine.map((m) => m.slotId))) : [];
    const absences = await this.db.db
      .select()
      .from(dutyAbsences)
      .where(and(eq(dutyAbsences.userId, user.id), gte(dutyAbsences.endDate, today)))
      .orderBy(asc(dutyAbsences.startDate));
    const periods = await this.db.db
      .select()
      .from(dutyPeriods)
      .where(and(ne(dutyPeriods.status, 'NHAP'), gte(dutyPeriods.endDate, today)))
      .orderBy(asc(dutyPeriods.startDate))
      .limit(20);
    return {
      today,
      assignments: slotRows
        .sort((a, b) => a.dutyDate.localeCompare(b.dutyDate))
        .map((s) => {
          const dto = this.slotDto(s);
          const src = srcMap.get(s.id) ?? 'PHAN_CONG';
          return {
            ...dto,
            source: src,
            canSelfCancel: src === 'DANG_KY' && !dto.locked && !dto.past,
            canRequestSwap: !dto.locked && !dto.past,
          };
        }),
      absences,
      periods: periods.map((p) => ({ ...p, ...this.core.phaseOf(p) })),
    };
  }

  /* ================================================================ Tổng hợp & xuất */

  async summary(user: AccessContext, periodId: number) {
    await this.getPeriodView(user, periodId);
    const rows = await this.db.db
      .select({
        userId: dutyAssignments.userId,
        slotId: dutySlots.id,
        dutyDate: dutySlots.dutyDate,
        startTime: dutyShiftTypes.startTime,
        endTime: dutyShiftTypes.endTime,
        crossesMidnight: dutyShiftTypes.crossesMidnight,
        isNight: dutyShiftTypes.isNight,
        fullName: users.fullName,
        title: users.title,
        departmentName: departments.name,
      })
      .from(dutyAssignments)
      .innerJoin(dutySlots, eq(dutySlots.id, dutyAssignments.slotId))
      .innerJoin(dutyShiftTypes, eq(dutyShiftTypes.id, dutySlots.shiftId))
      .innerJoin(users, eq(users.id, dutyAssignments.userId))
      .leftJoin(departments, eq(departments.id, users.departmentId))
      .where(eq(dutySlots.periodId, periodId));
    const agg = new Map<number, { userId: number; fullName: string; title: string; departmentName: string; shifts: number; nights: number; hours: number; days: Set<string> }>();
    for (const r of rows) {
      const cur = agg.get(r.userId) ?? { userId: r.userId, fullName: r.fullName, title: r.title ?? '', departmentName: r.departmentName ?? '', shifts: 0, nights: 0, hours: 0, days: new Set<string>() };
      const iv = shiftInterval(r.dutyDate, r.startTime, r.endTime, r.crossesMidnight);
      cur.shifts += 1;
      if (r.isNight) cur.nights += 1;
      cur.hours += iv.hours;
      cur.days.add(r.dutyDate);
      agg.set(r.userId, cur);
    }
    const items = [...agg.values()]
      .map((x) => ({ userId: x.userId, fullName: x.fullName, title: x.title, departmentName: x.departmentName, shifts: x.shifts, nights: x.nights, hours: Math.round(x.hours * 10) / 10, days: x.days.size }))
      .sort((a, b) => b.hours - a.hours || a.fullName.localeCompare(b.fullName, 'vi'));
    const hours = items.map((i) => i.hours);
    return {
      items,
      fairness: {
        people: items.length,
        maxHours: hours.length ? Math.max(...hours) : 0,
        minHours: hours.length ? Math.min(...hours) : 0,
        gapHours: hours.length ? Math.round((Math.max(...hours) - Math.min(...hours)) * 10) / 10 : 0,
      },
    };
  }

  async exportWorkbook(user: AccessContext, periodId: number): Promise<{ buffer: Buffer; fileName: string }> {
    const g = await this.grid(user, periodId);
    const wb = new ExcelJS.Workbook();
    wb.creator = 'QLBS — Lịch trực';
    wb.created = new Date();
    const ws = wb.addWorksheet('Lịch trực', { views: [{ state: 'frozen', xSplit: 1, ySplit: 2 }] });
    const dayCols = g.days;
    ws.columns = [{ header: 'Phòng khám', key: 'room', width: 16 }, ...dayCols.map((d, i) => ({ header: `${d.label}\n${fmtDm(d.date)}`, key: `d${i}`, width: 26 }))];
    ws.getRow(1).values = [`LỊCH TRỰC — ${g.period.name}`];
    ws.mergeCells(1, 1, 1, dayCols.length + 1);
    ws.getRow(1).font = { bold: true, size: 14 };
    ws.getRow(1).alignment = { horizontal: 'center' };
    const header = ws.getRow(2);
    header.values = ['Phòng khám', ...dayCols.map((d) => `${d.label} ${fmtDm(d.date)}${d.closed ? ' (nghỉ)' : ''}`)];
    header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    header.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F766E' } };
    header.height = 30;
    for (const room of g.rooms) {
      const cells: string[] = [room.code];
      let maxLines = 1;
      for (const d of dayCols) {
        const lines: string[] = [];
        for (const s of g.slots.filter((x) => x.roomId === room.id && x.dutyDate === d.date).sort((a, b) => a.start - b.start)) {
          const names = s.assignments.map((a) => a.fullName).join(', ') || '— chưa có người —';
          lines.push(`${s.shiftCode}: ${names}`);
        }
        maxLines = Math.max(maxLines, lines.length);
        cells.push(lines.join('\n'));
      }
      const row = ws.addRow(cells);
      row.height = Math.max(20, maxLines * 16 + 6);
      row.alignment = { vertical: 'middle', wrapText: true };
      row.getCell(1).font = { bold: true };
      row.getCell(1).alignment = { horizontal: 'center', vertical: 'middle' };
      row.eachCell((c, col) => {
        c.border = { top: { style: 'thin', color: { argb: 'FFCBD5E1' } }, bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } }, left: { style: 'thin', color: { argb: 'FFCBD5E1' } }, right: { style: 'thin', color: { argb: 'FFCBD5E1' } } };
        if (col > 1 && dayCols[col - 2]?.closed) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
      });
    }
    const s2 = wb.addWorksheet('Tổng hợp giờ trực');
    s2.columns = [
      { header: 'Họ và tên', key: 'fullName', width: 28 },
      { header: 'Chức danh', key: 'title', width: 18 },
      { header: 'Khoa', key: 'departmentName', width: 24 },
      { header: 'Số ca', key: 'shifts', width: 10 },
      { header: 'Ca đêm', key: 'nights', width: 10 },
      { header: 'Số ngày trực', key: 'days', width: 14 },
      { header: 'Tổng giờ', key: 'hours', width: 12 },
    ];
    const sum = await this.summary(user, periodId);
    s2.addRows(sum.items);
    s2.getRow(1).font = { bold: true };
    const fileName = `lich-truc-${g.period.startDate}_${g.period.endDate}.xlsx`;
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    await this.core.log(this.db.db, { periodId, action: 'EXPORT', actorId: user.id, detail: { fileName } });
    return { buffer, fileName };
  }

  async logs(user: AccessContext, periodId: number) {
    if (!this.core.canManageAny(user)) throw new ForbiddenException('Chỉ người quản lý lịch mới xem được nhật ký');
    await this.core.getPeriod(periodId);
    return this.db.db
      .select({
        id: dutyLogs.id,
        action: dutyLogs.action,
        reason: dutyLogs.reason,
        detail: dutyLogs.detail,
        slotId: dutyLogs.slotId,
        requestId: dutyLogs.requestId,
        createdAt: dutyLogs.createdAt,
        actorName: sql<string>`(select full_name from users where id = ${dutyLogs.actorId})`,
        userName: sql<string>`(select full_name from users where id = ${dutyLogs.userId})`,
      })
      .from(dutyLogs)
      .where(eq(dutyLogs.periodId, periodId))
      .orderBy(desc(dutyLogs.createdAt))
      .limit(300);
  }
}
