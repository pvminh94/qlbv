/**
 * Đơn vị / Khoa phòng — phân cấp không giới hạn cấp.
 *
 * `path` lưu đường dẫn tổ tiên (vd /1/4/17/) để truy vấn cả nhánh bằng LIKE,
 * `level` để biết cấp. Khi đổi cấp trên, toàn bộ nhánh con được cập nhật lại.
 */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, eq, ilike, inArray, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import { DbService } from '../../db/db.service';
import { departments } from '../../db/schema';
import { buildPage, type Paginated, parseFilters } from '../../common/dto/query.dto';
import { CacheService } from '../../infra/cache/cache.service';
import type {
  CreateDepartmentDto,
  DepartmentQueryDto,
  ReorderDepartmentsDto,
  UpdateDepartmentDto,
} from './dto/department.dto';

export interface DepartmentNode {
  id: number;
  code: string;
  name: string;
  shortName: string;
  parentId: number | null;
  level: number;
  path: string;
  kind: string;
  active: boolean;
  reportEnabled: boolean;
  sortOrder: number;
  children: DepartmentNode[];
}

const CACHE_KEY = 'dept:all';

import { pushFilters, type FilterTarget } from '../../common/filters/apply-filter';
/** Trường lọc nâng cao của danh sách khoa/phòng. */
const DEPARTMENT_FILTERS: Record<string, FilterTarget> = {
  code: { expr: departments.code, type: 'text' },
  name: { expr: departments.name, type: 'text' },
  kind: { expr: departments.kind, type: 'text' },
  active: { expr: departments.active, type: 'bool' },
};

@Injectable()
export class DepartmentsService {
  constructor(
    private readonly db: DbService,
    private readonly cache: CacheService,
  ) {}

  private async invalidate(): Promise<void> {
    await this.cache.delByPrefix('dept:');
  }

  /** Danh sách phẳng có phân trang + lọc nâng cao */
  async list(query: DepartmentQueryDto): Promise<Paginated<Record<string, unknown>>> {
    const where: SQL[] = [];
    if (!query.includeDeleted) where.push(isNull(departments.deletedAt));
    if (query.q?.trim()) {
      const like = `%${query.q.trim()}%`;
      where.push(
        or(
          ilike(departments.name, like),
          ilike(departments.code, like),
          ilike(departments.shortName, like),
          ilike(departments.headName, like),
        ) as SQL,
      );
    }
    if (query.activeOnly) where.push(eq(departments.active, true));
    if (query.parentId !== undefined) where.push(eq(departments.parentId, query.parentId));
    if (query.level !== undefined) where.push(eq(departments.level, query.level));
    if (query.reportEnabled !== undefined) where.push(eq(departments.reportEnabled, query.reportEnabled));
    if (query.departmentIds?.length) {
      where.push(inArray(departments.id, query.departmentIds.map(Number)));
    }
    pushFilters(where, parseFilters(query.filters), DEPARTMENT_FILTERS);
    const condition = where.length ? and(...where) : undefined;

    const [countRow] = await this.db.db
      .select({ total: sql<number>`count(*)::int` })
      .from(departments)
      .where(condition);

    const parent = departments;
    const rows = await this.db.db
      .select({
        id: departments.id,
        code: departments.code,
        name: departments.name,
        shortName: departments.shortName,
        hospital: departments.hospital,
        reportCode: departments.reportCode,
        parentId: departments.parentId,
        level: departments.level,
        path: departments.path,
        kind: departments.kind,
        phone: departments.phone,
        email: departments.email,
        headName: departments.headName,
        note: departments.note,
        reportEnabled: departments.reportEnabled,
        sortOrder: departments.sortOrder,
        active: departments.active,
        createdAt: departments.createdAt,
        updatedAt: departments.updatedAt,
      })
      .from(departments)
      .where(condition)
      .orderBy(asc(departments.level), asc(departments.sortOrder), asc(departments.name))
      .limit(query.limit)
      .offset(query.offset);

    // Tra tên cấp trên cho từng dòng
    const parentIds = [...new Set(rows.map((r) => r.parentId).filter((v): v is number => v !== null))];
    let parentNames = new Map<number, string>();
    if (parentIds.length > 0) {
      const parents = await this.db.db
        .select({ id: parent.id, name: parent.name })
        .from(parent)
        .where(inArray(parent.id, parentIds));
      parentNames = new Map(parents.map((p) => [p.id, p.name]));
    }

    const items = rows.map((r) => ({
      ...r,
      parentName: r.parentId ? (parentNames.get(r.parentId) ?? '') : '',
    }));

    return buildPage(items, countRow?.total ?? 0, query.page, query.pageSize);
  }

  /** Toàn bộ đơn vị dạng cây phân cấp (cache ngắn hạn — rất hay được gọi) */
  async tree(includeInactive = false): Promise<DepartmentNode[]> {
    const cacheKey = `${CACHE_KEY}:tree:${includeInactive ? 'all' : 'active'}`;
    return this.cache.remember(
      cacheKey,
      this.cacheTtl(),
      async () => {
        const where: SQL[] = [isNull(departments.deletedAt)];
        if (!includeInactive) where.push(eq(departments.active, true));
        const rows = await this.db.db
          .select({
            id: departments.id,
            code: departments.code,
            name: departments.name,
            shortName: departments.shortName,
            parentId: departments.parentId,
            level: departments.level,
            path: departments.path,
            kind: departments.kind,
            active: departments.active,
            reportEnabled: departments.reportEnabled,
            sortOrder: departments.sortOrder,
          })
          .from(departments)
          .where(and(...where))
          .orderBy(asc(departments.sortOrder), asc(departments.name));

        const map = new Map<number, DepartmentNode>();
        for (const r of rows) map.set(r.id, { ...r, children: [] });
        const roots: DepartmentNode[] = [];
        for (const node of map.values()) {
          if (node.parentId && map.has(node.parentId)) {
            map.get(node.parentId)!.children.push(node);
          } else {
            roots.push(node);
          }
        }
        return roots;
      },
      'dept',
    );
  }

  /** Danh sách gọn cho ô chọn (select) trên giao diện */
  async options(onlyReportable = false) {
    const where: SQL[] = [isNull(departments.deletedAt), eq(departments.active, true)];
    if (onlyReportable) where.push(eq(departments.reportEnabled, true));
    return this.db.db
      .select({
        id: departments.id,
        code: departments.code,
        name: departments.name,
        shortName: departments.shortName,
        level: departments.level,
        parentId: departments.parentId,
        reportEnabled: departments.reportEnabled,
      })
      .from(departments)
      .where(and(...where))
      .orderBy(asc(departments.level), asc(departments.sortOrder), asc(departments.name));
  }

  async findOne(id: number) {
    const [row] = await this.db.db
      .select()
      .from(departments)
      .where(and(eq(departments.id, id), isNull(departments.deletedAt)))
      .limit(1);
    if (!row) throw new NotFoundException('Không tìm thấy đơn vị');
    return row;
  }

  /** Tất cả id trong nhánh (gồm chính nó) — phục vụ lọc theo nhánh cây */
  async descendantIds(id: number): Promise<number[]> {
    const node = await this.findOne(id);
    const rows = await this.db.db
      .select({ id: departments.id })
      .from(departments)
      .where(or(eq(departments.id, id), ilike(departments.path, `${node.path}%`)));
    return rows.map((r) => r.id);
  }

  private computeLevel(parentId: number | null | undefined, parentLevel: number | null): number {
    if (!parentId) return 1;
    return (parentLevel ?? 0) + 1;
  }

  async create(dto: CreateDepartmentDto) {
    const existed = await this.db.db
      .select({ id: departments.id })
      .from(departments)
      .where(and(eq(departments.code, dto.code.trim()), isNull(departments.deletedAt)))
      .limit(1);
    if (existed.length > 0) throw new ConflictException(`Mã đơn vị "${dto.code}" đã tồn tại`);

    let parentLevel: number | null = null;
    if (dto.parentId) {
      const parent = await this.findOne(dto.parentId);
      parentLevel = parent.level;
    }
    const level = this.computeLevel(dto.parentId, parentLevel);

    const [created] = await this.db.db
      .insert(departments)
      .values({
        code: dto.code.trim(),
        name: dto.name.trim(),
        shortName: dto.shortName ?? '',
        parentId: dto.parentId ?? null,
        level,
        kind: dto.kind ?? 'KHOA',
        hospital: dto.hospital ?? 'BỆNH VIỆN QUÂN Y 4',
        reportCode: dto.reportCode ?? 'B4',
        phone: dto.phone ?? '',
        email: dto.email ?? '',
        headName: dto.headName ?? '',
        note: dto.note ?? '',
        reportEnabled: dto.reportEnabled ?? true,
        sortOrder: dto.sortOrder ?? 0,
        active: dto.active ?? true,
        path: '',
      })
      .returning();

    // `path` phải biết id nên cập nhật ngay sau khi chèn
    const path = dto.parentId
      ? `${(await this.findOne(dto.parentId)).path}${created.id}/`
      : `/${created.id}/`;
    await this.db.db.update(departments).set({ path }).where(eq(departments.id, created.id));

    await this.invalidate();
    return { ...created, path };
  }

  async update(id: number, dto: UpdateDepartmentDto) {
    const current = await this.findOne(id);

    if (dto.code && dto.code !== current.code) {
      const dup = await this.db.db
        .select({ id: departments.id })
        .from(departments)
        .where(and(eq(departments.code, dto.code.trim()), ne(departments.id, id), isNull(departments.deletedAt)))
        .limit(1);
      if (dup.length > 0) throw new ConflictException(`Mã đơn vị "${dto.code}" đã tồn tại`);
    }

    let level = current.level;
    let path = current.path;
    const parentChanged = dto.parentId !== undefined && dto.parentId !== current.parentId;

    if (parentChanged) {
      if (dto.parentId === id) throw new BadRequestException('Không thể chọn chính nó làm cấp trên');
      if (dto.parentId) {
        const parent = await this.findOne(dto.parentId);
        if (parent.path.startsWith(current.path)) {
          throw new BadRequestException('Không thể chuyển đơn vị vào nhánh con của chính nó');
        }
        level = this.computeLevel(dto.parentId, parent.level);
        path = `${parent.path}${id}/`;
      } else {
        level = 1;
        path = `/${id}/`;
      }
    }

    const [updated] = await this.db.db
      .update(departments)
      .set({
        ...(dto.code !== undefined ? { code: dto.code.trim() } : {}),
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.shortName !== undefined ? { shortName: dto.shortName } : {}),
        ...(dto.parentId !== undefined ? { parentId: dto.parentId ?? null } : {}),
        ...(dto.kind !== undefined ? { kind: dto.kind } : {}),
        ...(dto.hospital !== undefined ? { hospital: dto.hospital } : {}),
        ...(dto.reportCode !== undefined ? { reportCode: dto.reportCode } : {}),
        ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
        ...(dto.email !== undefined ? { email: dto.email } : {}),
        ...(dto.headName !== undefined ? { headName: dto.headName } : {}),
        ...(dto.note !== undefined ? { note: dto.note } : {}),
        ...(dto.reportEnabled !== undefined ? { reportEnabled: dto.reportEnabled } : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
        ...(dto.active !== undefined ? { active: dto.active } : {}),
        level,
        path,
        updatedAt: new Date(),
      })
      .where(eq(departments.id, id))
      .returning();

    // Cập nhật lại đường dẫn của cả nhánh con
    if (parentChanged) await this.rebuildDescendantPaths(id);

    await this.invalidate();
    return updated;
  }

  private async rebuildDescendantPaths(rootId: number, level?: number): Promise<void> {
    const root = await this.findOne(rootId);
    const children = await this.db.db
      .select({ id: departments.id })
      .from(departments)
      .where(eq(departments.parentId, rootId))
      .orderBy(asc(departments.sortOrder));
    for (const child of children) {
      const childLevel = (level ?? root.level) + 1;
      await this.db.db
        .update(departments)
        .set({ level: childLevel, path: `${root.path}${child.id}/`, updatedAt: new Date() })
        .where(eq(departments.id, child.id));
      await this.rebuildDescendantPaths(child.id, childLevel);
    }
  }

  /** Xoá mềm — chặn nếu còn đơn vị con hoặc còn người dùng */
  async remove(id: number) {
    await this.findOne(id);
    const children = await this.db.db
      .select({ total: sql<number>`count(*)::int` })
      .from(departments)
      .where(and(eq(departments.parentId, id), isNull(departments.deletedAt)));
    if ((children[0]?.total ?? 0) > 0) {
      throw new BadRequestException('Đơn vị còn đơn vị trực thuộc — hãy chuyển hoặc xoá trước');
    }
    const [updated] = await this.db.db
      .update(departments)
      .set({ active: false, deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(departments.id, id))
      .returning();
    await this.invalidate();
    return updated;
  }

  async restore(id: number) {
    const [target] = await this.db.db
      .select({ code: departments.code })
      .from(departments)
      .where(eq(departments.id, id))
      .limit(1);
    const [clash] = await this.db.db
      .select({ id: departments.id })
      .from(departments)
      .where(and(eq(departments.code, target?.code ?? ''), ne(departments.id, id), isNull(departments.deletedAt)))
      .limit(1);
    if (clash) {
      throw new ConflictException(`Mã đơn vị "${target?.code ?? ''}" đang thuộc một đơn vị hoạt động khác — sửa mã trước khi phục hồi`);
    }
    const [updated] = await this.db.db
      .update(departments)
      .set({ active: true, deletedAt: null, updatedAt: new Date() })
      .where(eq(departments.id, id))
      .returning();
    if (!updated) throw new NotFoundException('Không tìm thấy đơn vị');
    await this.invalidate();
    return updated;
  }

  /** Sắp xếp lại thứ tự hiển thị */
  async reorder(dto: ReorderDepartmentsDto) {
    for (const item of dto.items) {
      await this.db.db
        .update(departments)
        .set({ sortOrder: item.sortOrder, updatedAt: new Date() })
        .where(eq(departments.id, item.id));
    }
    await this.invalidate();
    return { message: `Đã cập nhật thứ tự ${dto.items.length} đơn vị` };
  }

  private cacheTtl(): number {
    return 300;
  }
}
