import { BadRequestException, Injectable } from '@nestjs/common';
import { and, asc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { DbService } from '../../db/db.service';
import {
  dutyAbsences,
  dutyAssignments,
  dutyPeriods,
  dutyRoles,
  dutyRooms,
  dutyShiftTypes,
  dutySlots,
  users,
} from '../../db/schema';
import { addDays, dateRange, shiftInterval } from '../duty/duty-rules';
import { bangkokIso, candidateDutyDates, coversInstant, parseInstant, shiftEndDay } from './integration-time';

/** Máy khoá chỉ tin lịch đã công bố hoặc đã chốt; kỳ nháp không bao giờ được trả về */
export const PUBLISHED_PERIOD_STATUSES = ['CONG_BO', 'DA_CHOT'] as const;
export const MAX_ROSTER_DAYS = 31;
const MAX_ROOM_CODE = 40;

interface DutyRow {
  dutyDate: string;
  roomCode: string;
  roomName: string;
  shiftCode: string;
  shiftName: string;
  startTime: string;
  endTime: string;
  crossesMidnight: boolean;
  roleCode: string;
  roleName: string;
  userId: number;
  username: string;
  fullName: string;
  title: string;
}

function isYmd(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  return new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
}

function cleanRoom(room: string | undefined): string | undefined {
  const value = room?.trim();
  if (!value) return undefined;
  if (value.length > MAX_ROOM_CODE) throw new BadRequestException('Mã phòng quá dài');
  return value;
}

function sortEntries<T extends { shift: { startsAt: string }; room: { code: string }; staff: { username: string } }>(
  items: T[],
): T[] {
  return items.sort(
    (a, b) =>
      a.shift.startsAt.localeCompare(b.shift.startsAt) ||
      a.room.code.localeCompare(b.room.code) ||
      a.staff.username.localeCompare(b.staff.username),
  );
}

@Injectable()
export class IntegrationDutyService {
  constructor(private readonly db: DbService) {}

  /** Danh mục phòng đang hoạt động (máy khoá dùng để đối chiếu mã phòng). */
  async rooms() {
    const rows = await this.db.db
      .select({ code: dutyRooms.code, name: dutyRooms.name })
      .from(dutyRooms)
      .where(eq(dutyRooms.active, true))
      .orderBy(asc(dutyRooms.sortOrder), asc(dutyRooms.code));
    return { rooms: rows };
  }

  /** Ai đang trực phòng `room` (hoặc mọi phòng nếu bỏ trống) tại thời điểm `at`. Không gồm người nghỉ phép. */
  async onDuty(input: { room?: string; at?: string }, now: number = Date.now()) {
    const atMs = parseInstant(input.at, now);
    if (atMs === null) {
      throw new BadRequestException(
        'Tham số at phải là thời điểm ISO 8601 có giờ, ví dụ 2026-10-09T19:30:00+07:00',
      );
    }
    const rows = await this.loadRows(candidateDutyDates(atMs), cleanRoom(input.room));
    const leave = await this.leaveLookup(rows);
    const onDuty = rows
      .filter((r) => coversInstant(atMs, r.dutyDate, r.startTime, r.endTime, r.crossesMidnight))
      .filter((r) => !leave(r.userId, r.dutyDate, shiftEndDay(r.dutyDate, r.startTime, r.endTime, r.crossesMidnight)))
      .map((r) => this.toEntry(r, false));
    return { at: bangkokIso(atMs), onDuty: sortEntries(onDuty) };
  }

  /** Lịch trực theo khoảng ngày YYYY-MM-DD (tối đa 31 ngày). Có cờ onLeave cho người nghỉ phép. */
  async roster(input: { from?: string; to?: string; room?: string }) {
    const from = input.from ?? '';
    const to = input.to ?? '';
    if (!isYmd(from) || !isYmd(to)) throw new BadRequestException('from và to phải có dạng YYYY-MM-DD');
    if (to < from) throw new BadRequestException('to phải bằng hoặc sau from');
    const days = dateRange(from, to);
    if (days.length > MAX_ROSTER_DAYS) {
      throw new BadRequestException(`Khoảng ngày tối đa ${MAX_ROSTER_DAYS} ngày`);
    }
    const rows = await this.loadRows(days, cleanRoom(input.room));
    const leave = await this.leaveLookup(rows);
    const items = rows.map((r) =>
      this.toEntry(r, leave(r.userId, r.dutyDate, shiftEndDay(r.dutyDate, r.startTime, r.endTime, r.crossesMidnight))),
    );
    return { from, to, items: sortEntries(items) };
  }

  private async loadRows(dates: string[], room?: string): Promise<DutyRow[]> {
    if (dates.length === 0) return [];
    // Không lọc theo cờ `active` của ca: ca đã tắt trong danh mục chỉ ngừng được xếp mới,
    // còn phân công đã nằm trong kỳ đã công bố/chốt vẫn là cam kết thực tế. Phòng đã đóng
    // và nhân sự đã vô hiệu hoá thì vẫn bị loại (từ chối là hướng an toàn).
    const where = [
      inArray(dutySlots.dutyDate, dates),
      inArray(dutyPeriods.status, [...PUBLISHED_PERIOD_STATUSES]),
      eq(dutyRooms.active, true),
      eq(users.active, true),
    ];
    if (room) where.push(sql`lower(${dutyRooms.code}) = lower(${room})`);
    return this.db.db
      .select({
        dutyDate: dutySlots.dutyDate,
        roomCode: dutyRooms.code,
        roomName: dutyRooms.name,
        shiftCode: dutyShiftTypes.code,
        shiftName: dutyShiftTypes.name,
        startTime: dutyShiftTypes.startTime,
        endTime: dutyShiftTypes.endTime,
        crossesMidnight: dutyShiftTypes.crossesMidnight,
        roleCode: dutyRoles.code,
        roleName: dutyRoles.name,
        userId: users.id,
        username: users.username,
        fullName: users.fullName,
        title: users.title,
      })
      .from(dutyAssignments)
      .innerJoin(dutySlots, eq(dutySlots.id, dutyAssignments.slotId))
      .innerJoin(dutyPeriods, eq(dutyPeriods.id, dutySlots.periodId))
      .innerJoin(dutyRooms, eq(dutyRooms.id, dutySlots.roomId))
      .innerJoin(dutyShiftTypes, eq(dutyShiftTypes.id, dutySlots.shiftId))
      .innerJoin(dutyRoles, eq(dutyRoles.id, dutySlots.roleId))
      .innerJoin(users, eq(users.id, dutyAssignments.userId))
      .where(and(...where));
  }

  /**
   * Tra cứu nghỉ phép. Ca được coi là nghỉ nếu đơn nghỉ giao với khoảng từ ngày trực
   * đến ngày kết thúc ca (ca đêm kéo sang hôm sau). Làm theo hướng an toàn: nghi ngờ thì không mở.
   */
  private async leaveLookup(rows: DutyRow[]) {
    if (rows.length === 0) return () => false;
    const userIds = [...new Set(rows.map((r) => r.userId))];
    const dates = rows.map((r) => r.dutyDate);
    const first = dates.reduce((a, b) => (a < b ? a : b));
    const last = addDays(dates.reduce((a, b) => (a > b ? a : b)), 1);
    const absences = await this.db.db
      .select({ userId: dutyAbsences.userId, startDate: dutyAbsences.startDate, endDate: dutyAbsences.endDate })
      .from(dutyAbsences)
      .where(
        and(
          inArray(dutyAbsences.userId, userIds),
          lte(dutyAbsences.startDate, last),
          gte(dutyAbsences.endDate, first),
        ),
      );
    return (userId: number, from: string, to: string) =>
      absences.some((a) => a.userId === userId && a.startDate <= to && a.endDate >= from);
  }

  private toEntry(r: DutyRow, onLeave: boolean) {
    const { start, end } = shiftInterval(r.dutyDate, r.startTime, r.endTime, r.crossesMidnight);
    return {
      room: { code: r.roomCode, name: r.roomName },
      dutyDate: r.dutyDate,
      role: { code: r.roleCode, name: r.roleName },
      shift: {
        code: r.shiftCode,
        name: r.shiftName,
        startTime: r.startTime,
        endTime: r.endTime,
        crossesMidnight: r.crossesMidnight,
        startsAt: bangkokIso(start),
        endsAt: bangkokIso(end),
      },
      staff: { username: r.username, fullName: r.fullName, title: r.title },
      onLeave,
    };
  }
}
