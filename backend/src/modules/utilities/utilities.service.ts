/**
 * Tiện ích mở rộng — quản trị tự tạo chức năng mới (biểu mẫu, liên kết, báo cáo…)
 * mà không cần sửa mã nguồn. Menu được dựng động từ bảng này.
 */
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, ilike, isNull, or, sql, type SQL } from 'drizzle-orm';
import { DbService } from '../../db/db.service';
import { utilities } from '../../db/schema';
import type { Utility } from '../../db/schema/ops';
import { buildPage, type AdvancedQueryDto, type Paginated, parseFilters } from '../../common/dto/query.dto';
import { pushFilters, type FilterTarget } from '../../common/filters/apply-filter';
import { CacheService } from '../../infra/cache/cache.service';
import type { AccessContext } from '../../common/types/access-context';

export interface CreateUtilityDto {
  code: string;
  name: string;
  description?: string;
  icon?: string;
  kind?: 'BUILTIN' | 'FORM' | 'REPORT' | 'LINK' | 'IFRAME';
  route?: string;
  config?: Record<string, unknown>;
  permissionCode?: string;
  departmentIds?: number[];
  placement?: 'sidebar' | 'dashboard' | 'both';
  badge?: string;
  color?: string;
  openInNewTab?: boolean;
  sortOrder?: number;
  active?: boolean;
}

export type UpdateUtilityDto = Partial<CreateUtilityDto>;

/** Trường lọc nâng cao của danh sách tiện ích. */
const UTILITY_FILTERS: Record<string, FilterTarget> = {
  kind: { expr: utilities.kind, type: 'text' },
  placement: { expr: utilities.placement, type: 'text' },
  active: { expr: utilities.active, type: 'bool' },
};

const UTILITY_SORTABLE = {
  code: utilities.code,
  name: utilities.name,
  sortOrder: utilities.sortOrder,
  active: utilities.active,
  createdAt: utilities.createdAt,
} as const;

function utilityOrderBy(query: { sortBy?: string; sortDir?: 'asc' | 'desc' }) {
  const col = UTILITY_SORTABLE[(query.sortBy ?? '') as keyof typeof UTILITY_SORTABLE];
  if (!col) return [asc(utilities.sortOrder), asc(utilities.name)];
  const dir = query.sortDir === 'desc' ? desc : asc;
  return [dir(col), asc(utilities.id)];
}

@Injectable()
export class UtilitiesService {
  constructor(
    private readonly db: DbService,
    private readonly cache: CacheService,
  ) {}

  private async invalidate(): Promise<void> {
    await this.cache.delByPrefix('utility:');
  }

  async list(query: AdvancedQueryDto): Promise<Paginated<Utility>> {
    const where: SQL[] = [];
    if (query.activeOnly) where.push(eq(utilities.active, true));
    if (query.q?.trim()) {
      const like = `%${query.q.trim()}%`;
      where.push(or(ilike(utilities.name, like), ilike(utilities.code, like), ilike(utilities.description, like)) as SQL);
    }
    pushFilters(where, parseFilters(query.filters), UTILITY_FILTERS);
    const condition = where.length ? and(...where) : undefined;

    const [countRow] = await this.db.db
      .select({ total: sql<number>`count(*)::int` })
      .from(utilities)
      .where(condition);

    const rows = await this.db.db
      .select()
      .from(utilities)
      .where(condition)
      .orderBy(...utilityOrderBy(query))
      .limit(query.limit)
      .offset(query.offset);

    return buildPage(rows, countRow?.total ?? 0, query.page, query.pageSize);
  }

  /**
   * Menu tiện ích hiển thị cho một người dùng — đã lọc theo quyền và theo khoa.
   */
  async menuFor(user: AccessContext, placement?: 'sidebar' | 'dashboard') {
    const cacheKey = `utility:menu:${user.id}:${user.roles.join(',')}:${placement ?? 'all'}`;
    return this.cache.remember(cacheKey, 120, async () => {
      const rows = await this.db.db
        .select()
        .from(utilities)
        .where(eq(utilities.active, true))
        .orderBy(asc(utilities.sortOrder), asc(utilities.name));

      const owned = new Set(user.permissions);
      return rows.filter((u) => {
        if (placement && u.placement !== placement && u.placement !== 'both') return false;
        if (u.permissionCode && !user.isSuperAdmin && !owned.has(u.permissionCode)) return false;
        const depts = u.departmentIds ?? [];
        if (depts.length > 0 && !user.isSuperAdmin) {
          const allowed = new Set(user.departmentIds);
          if (!depts.some((d) => allowed.has(d))) return false;
        }
        return true;
      });
    });
  }

  async findOne(id: number) {
    const [row] = await this.db.db.select().from(utilities).where(eq(utilities.id, id)).limit(1);
    if (!row) throw new NotFoundException('Không tìm thấy tiện ích');
    return row;
  }

  async findByCode(code: string) {
    const [row] = await this.db.db.select().from(utilities).where(eq(utilities.code, code)).limit(1);
    if (!row) throw new NotFoundException('Không tìm thấy tiện ích');
    return row;
  }

  async create(dto: CreateUtilityDto) {
    const code = dto.code.trim().toUpperCase().replace(/\s+/g, '_');
    const dup = await this.db.db.select({ id: utilities.id }).from(utilities).where(eq(utilities.code, code)).limit(1);
    if (dup.length > 0) throw new ConflictException(`Mã tiện ích "${code}" đã tồn tại`);
    if ((dto.kind === 'LINK' || dto.kind === 'IFRAME') && !dto.route) {
      throw new BadRequestException('Tiện ích dạng liên kết/nhúng cần có đường dẫn');
    }

    const [created] = await this.db.db
      .insert(utilities)
      .values({
        code,
        name: dto.name.trim(),
        description: dto.description ?? '',
        icon: dto.icon ?? 'Puzzle',
        kind: dto.kind ?? 'BUILTIN',
        route: dto.route ?? '',
        config: (dto.config ?? {}) as never,
        permissionCode: dto.permissionCode ?? '',
        departmentIds: (dto.departmentIds ?? []) as never,
        placement: dto.placement ?? 'sidebar',
        badge: dto.badge ?? '',
        color: dto.color ?? '#0ea5e9',
        openInNewTab: dto.openInNewTab ?? false,
        sortOrder: dto.sortOrder ?? 0,
        active: dto.active ?? true,
      })
      .returning();
    await this.invalidate();
    return created;
  }

  async update(id: number, dto: UpdateUtilityDto) {
    await this.findOne(id);
    const [updated] = await this.db.db
      .update(utilities)
      .set({
        ...(dto.code ? { code: dto.code.trim().toUpperCase().replace(/\s+/g, '_') } : {}),
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.icon !== undefined ? { icon: dto.icon } : {}),
        ...(dto.kind !== undefined ? { kind: dto.kind } : {}),
        ...(dto.route !== undefined ? { route: dto.route } : {}),
        ...(dto.config !== undefined ? { config: dto.config as never } : {}),
        ...(dto.permissionCode !== undefined ? { permissionCode: dto.permissionCode } : {}),
        ...(dto.departmentIds !== undefined ? { departmentIds: dto.departmentIds as never } : {}),
        ...(dto.placement !== undefined ? { placement: dto.placement } : {}),
        ...(dto.badge !== undefined ? { badge: dto.badge } : {}),
        ...(dto.color !== undefined ? { color: dto.color } : {}),
        ...(dto.openInNewTab !== undefined ? { openInNewTab: dto.openInNewTab } : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
        ...(dto.active !== undefined ? { active: dto.active } : {}),
        updatedAt: new Date(),
      })
      .where(eq(utilities.id, id))
      .returning();
    await this.invalidate();
    return updated;
  }

  async remove(id: number) {
    const item = await this.findOne(id);
    if (item.kind === 'BUILTIN') {
      throw new BadRequestException('Đây là tiện ích hệ thống — chỉ có thể tắt thay vì xoá');
    }
    await this.db.db.delete(utilities).where(eq(utilities.id, id));
    await this.invalidate();
    return { message: `Đã xoá tiện ích ${item.name}` };
  }

  async reorder(items: { id: number; sortOrder: number }[]) {
    for (const item of items) {
      await this.db.db
        .update(utilities)
        .set({ sortOrder: item.sortOrder })
        .where(eq(utilities.id, item.id));
    }
    await this.invalidate();
    return { message: `Đã cập nhật thứ tự ${items.length} tiện ích` };
  }
}
