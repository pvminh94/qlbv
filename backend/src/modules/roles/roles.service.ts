/**
 * Vai trò & phân quyền (RBAC).
 *
 * - Vai trò hệ thống (isSystem) không cho xoá, chỉ sửa mô tả và tập quyền.
 * - Gán quyền cho vai trò bằng danh sách mã quyền; gán vai trò cho người dùng hàng loạt.
 * - Mọi thay đổi đều xoá cache ngữ cảnh để có hiệu lực ngay.
 */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, desc, eq, ilike, inArray, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import { DbService } from '../../db/db.service';
import { permissions, rolePermissions, roles, userRoles, users } from '../../db/schema';
import { buildPage, type AdvancedQueryDto, type Paginated, parseFilters } from '../../common/dto/query.dto';
import { SUPER_ADMIN_ROLE } from '../../common/types/access-context';
import { pushFilters, type FilterTarget } from '../../common/filters/apply-filter';
import { CacheService } from '../../infra/cache/cache.service';
import { AuthService } from '../auth/auth.service';

export interface CreateRoleDto {
  code: string;
  name: string;
  description?: string;
  dataScope?: 'OWN' | 'DEPT' | 'ALL';
  priority?: number;
  color?: string;
  sortOrder?: number;
  active?: boolean;
  /** Mã các quyền gán kèm */
  permissionCodes?: string[];
}

export type UpdateRoleDto = Partial<CreateRoleDto>;

/** Trường lọc nâng cao của danh sách vai trò. */
const ROLE_FILTERS: Record<string, FilterTarget> = {
  dataScope: { expr: roles.dataScope, type: 'text' },
  isSystem: { expr: roles.isSystem, type: 'bool' },
  active: { expr: roles.active, type: 'bool' },
};

@Injectable()
export class RolesService {
  constructor(
    private readonly db: DbService,
    private readonly cache: CacheService,
    private readonly auth: AuthService,
  ) {}

  async list(query: AdvancedQueryDto): Promise<Paginated<Record<string, unknown>>> {
    const where: SQL[] = [];
    if (query.q?.trim()) {
      const like = `%${query.q.trim()}%`;
      where.push(or(ilike(roles.name, like), ilike(roles.code, like), ilike(roles.description, like)) as SQL);
    }
    if (query.activeOnly) where.push(eq(roles.active, true));
    pushFilters(where, parseFilters(query.filters), ROLE_FILTERS);
    const condition = where.length ? and(...where) : undefined;

    const [countRow] = await this.db.db
      .select({ total: sql<number>`count(*)::int` })
      .from(roles)
      .where(condition);

    const rows = await this.db.db
      .select({
        id: roles.id,
        code: roles.code,
        name: roles.name,
        description: roles.description,
        dataScope: roles.dataScope,
        isSystem: roles.isSystem,
        priority: roles.priority,
        color: roles.color,
        sortOrder: roles.sortOrder,
        active: roles.active,
        createdAt: roles.createdAt,
        permissionCount: sql<number>`(
          select count(*)::int from role_permissions rp where rp.role_id = ${roles.id}
        )`,
        userCount: sql<number>`(
          select count(*)::int from user_roles ur where ur.role_id = ${roles.id}
        )`,
      })
      .from(roles)
      .where(condition)
      .orderBy(asc(roles.priority), asc(roles.sortOrder), asc(roles.name))
      .limit(query.limit)
      .offset(query.offset);

    // Với vai trò SUPER_ADMIN: số quyền = toàn bộ danh mục (ngầm định toàn quyền)
    const totalPerms = (await this.db.db.select({ total: sql<number>`count(*)::int` }).from(permissions))[0]?.total ?? 0;
    const items = rows.map((r) =>
      r.code === SUPER_ADMIN_ROLE ? { ...r, permissionCount: totalPerms } : r,
    );

    return buildPage(items, countRow?.total ?? 0, query.page, query.pageSize);
  }

  async all() {
    return this.db.db
      .select({
        id: roles.id,
        code: roles.code,
        name: roles.name,
        color: roles.color,
        dataScope: roles.dataScope,
        active: roles.active,
      })
      .from(roles)
      .where(eq(roles.active, true))
      .orderBy(asc(roles.priority), asc(roles.name));
  }

  async findOne(id: number) {
    const [role] = await this.db.db.select().from(roles).where(eq(roles.id, id)).limit(1);
    if (!role) throw new NotFoundException('Không tìm thấy vai trò');
    const perms = await this.db.db
      .select({ id: permissions.id, code: permissions.code, name: permissions.name, module: permissions.module, action: permissions.action })
      .from(rolePermissions)
      .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
      .where(eq(rolePermissions.roleId, id))
      .orderBy(asc(permissions.module), asc(permissions.code));
    // Chỉ tính tài khoản đang dùng: tài khoản đã xoá mềm không còn chặn việc xoá vai trò
    const members = await this.db.db
      .select({ id: users.id, username: users.username, fullName: users.fullName, title: users.title })
      .from(userRoles)
      .innerJoin(users, eq(users.id, userRoles.userId))
      .where(and(eq(userRoles.roleId, id), isNull(users.deletedAt)))
      .orderBy(asc(users.fullName));
    return { ...role, permissions: perms, members };
  }

  private async resolvePermissionIds(codes: string[]): Promise<number[]> {
    if (codes.length === 0) return [];
    const rows = await this.db.db
      .select({ id: permissions.id, code: permissions.code })
      .from(permissions)
      .where(inArray(permissions.code, codes));
    const found = new Set(rows.map((r) => r.code));
    const missing = codes.filter((c) => !found.has(c));
    if (missing.length > 0) {
      throw new BadRequestException(`Quyền không tồn tại: ${missing.join(', ')}`);
    }
    return rows.map((r) => r.id);
  }

  async create(dto: CreateRoleDto) {
    const code = dto.code.trim().toUpperCase().replace(/\s+/g, '_');
    const dup = await this.db.db.select({ id: roles.id }).from(roles).where(eq(roles.code, code)).limit(1);
    if (dup.length > 0) throw new ConflictException(`Mã vai trò "${code}" đã tồn tại`);

    const [role] = await this.db.db
      .insert(roles)
      .values({
        code,
        name: dto.name.trim(),
        description: dto.description ?? '',
        dataScope: dto.dataScope ?? 'OWN',
        priority: dto.priority ?? 100,
        color: dto.color ?? '#0ea5e9',
        sortOrder: dto.sortOrder ?? 0,
        active: dto.active ?? true,
        isSystem: false,
      })
      .returning();

    if (dto.permissionCodes?.length) {
      const ids = await this.resolvePermissionIds(dto.permissionCodes);
      if (ids.length > 0) {
        await this.db.db
          .insert(rolePermissions)
          .values(ids.map((permissionId) => ({ roleId: role.id, permissionId })))
          .onConflictDoNothing();
      }
    }
    await this.auth.invalidateUserCache();
    return this.findOne(role.id);
  }

  async update(id: number, dto: UpdateRoleDto) {
    const role = await this.findOne(id);
    if (role.code === SUPER_ADMIN_ROLE) {
      // Vai trò tối cao bất biến về mặt an ninh: chỉ cho chỉnh mô tả/màu hiển thị
      await this.db.db
        .update(roles)
        .set({
          ...(dto.description !== undefined ? { description: dto.description } : {}),
          ...(dto.color !== undefined ? { color: dto.color } : {}),
          updatedAt: new Date(),
        })
        .where(eq(roles.id, id));
      await this.auth.invalidateUserCache();
      return this.findOne(id);
    }
    if (role.isSystem && dto.code && dto.code.toUpperCase() !== role.code) {
      throw new BadRequestException('Không thể đổi mã của vai trò hệ thống');
    }
    if (role.isSystem && dto.active === false) {
      throw new BadRequestException('Không thể vô hiệu hoá vai trò hệ thống');
    }
    await this.db.db
      .update(roles)
      .set({
        ...(dto.code ? { code: dto.code.trim().toUpperCase().replace(/\s+/g, '_') } : {}),
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.dataScope !== undefined ? { dataScope: dto.dataScope } : {}),
        ...(dto.priority !== undefined ? { priority: dto.priority } : {}),
        ...(dto.color !== undefined ? { color: dto.color } : {}),
        ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
        ...(dto.active !== undefined ? { active: dto.active } : {}),
        updatedAt: new Date(),
      })
      .where(eq(roles.id, id));

    if (dto.permissionCodes) await this.setPermissions(id, dto.permissionCodes);
    await this.auth.invalidateUserCache();
    return this.findOne(id);
  }

  /** Gán lại toàn bộ tập quyền của vai trò */
  async setPermissions(roleId: number, permissionCodes: string[]) {
    const role = await this.findOne(roleId);
    if (role.code === SUPER_ADMIN_ROLE) {
      throw new BadRequestException('Vai trò Quản trị tối cao mặc định toàn quyền — không thể điều chỉnh');
    }
    const ids = await this.resolvePermissionIds(permissionCodes);
    await this.db.transaction(async (tx) => {
      await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, roleId));
      if (ids.length > 0) {
        await tx
          .insert(rolePermissions)
          .values(ids.map((permissionId) => ({ roleId, permissionId })))
          .onConflictDoNothing();
      }
    });
    await this.auth.invalidateUserCache();
    return { message: `Đã cập nhật ${ids.length} quyền cho vai trò`, permissionCount: ids.length };
  }

  /** Thêm/bớt một quyền (dùng cho checkbox trên giao diện) */
  async togglePermission(roleId: number, permissionCode: string, granted: boolean) {
    const [roleRow] = await this.db.db
      .select({ code: roles.code })
      .from(roles)
      .where(eq(roles.id, roleId))
      .limit(1);
    if (roleRow?.code === SUPER_ADMIN_ROLE) {
      throw new BadRequestException('Vai trò Quản trị tối cao mặc định toàn quyền — không thể điều chỉnh');
    }
    const [perm] = await this.db.db
      .select({ id: permissions.id })
      .from(permissions)
      .where(eq(permissions.code, permissionCode))
      .limit(1);
    if (!perm) throw new NotFoundException(`Quyền "${permissionCode}" không tồn tại`);
    if (granted) {
      await this.db.db
        .insert(rolePermissions)
        .values({ roleId, permissionId: perm.id })
        .onConflictDoNothing();
    } else {
      await this.db.db
        .delete(rolePermissions)
        .where(and(eq(rolePermissions.roleId, roleId), eq(rolePermissions.permissionId, perm.id)));
    }
    await this.auth.invalidateUserCache();
    return { message: granted ? 'Đã thêm quyền' : 'Đã bỏ quyền' };
  }

  async remove(id: number) {
    const role = await this.findOne(id);
    if (role.isSystem) throw new BadRequestException('Không thể xoá vai trò hệ thống');
    if (role.members.length > 0) {
      throw new BadRequestException(
        `Vai trò đang gán cho ${role.members.length} người dùng — hãy gỡ trước khi xoá`,
      );
    }
    await this.db.db.delete(roles).where(eq(roles.id, id));
    await this.auth.invalidateUserCache();
    return { message: `Đã xoá vai trò ${role.name}` };
  }

  /** Gán vai trò cho danh sách người dùng */
  async assignToUsers(roleId: number, userIds: number[], granted: boolean) {
    await this.findOne(roleId);
    if (userIds.length === 0) return { message: 'Không có người dùng nào được chọn' };
    const existing = await this.db.db
      .select({ id: users.id })
      .from(users)
      .where(and(inArray(users.id, userIds), isNull(users.deletedAt)));
    const ids = existing.map((u) => u.id);
    if (ids.length === 0) throw new BadRequestException('Không tìm thấy người dùng hợp lệ');

    if (granted) {
      await this.db.db
        .insert(userRoles)
        .values(ids.map((userId) => ({ userId, roleId })))
        .onConflictDoNothing();
    } else {
      await this.db.db
        .delete(userRoles)
        .where(and(eq(userRoles.roleId, roleId), inArray(userRoles.userId, ids)));
    }
    await this.auth.invalidateUserCache();
    return {
      message: granted ? `Đã gán vai trò cho ${ids.length} người dùng` : `Đã gỡ vai trò khỏi ${ids.length} người dùng`,
      affected: ids.length,
    };
  }

  /** Ma trận vai trò × quyền phục vụ giao diện phân quyền */
  async matrix() {
    const allRoles = await this.db.db
      .select({ id: roles.id, code: roles.code, name: roles.name, color: roles.color, dataScope: roles.dataScope })
      .from(roles)
      .where(eq(roles.active, true))
      .orderBy(asc(roles.priority));
    const links = await this.db.db
      .select({ roleCode: roles.code, permissionCode: permissions.code })
      .from(rolePermissions)
      .innerJoin(roles, eq(roles.id, rolePermissions.roleId))
      .innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId));
    const catalog = await this.db.db
      .select()
      .from(permissions)
      .orderBy(asc(permissions.module), asc(permissions.sortOrder), asc(permissions.code));

    const granted = new Map<string, Set<string>>();
    for (const l of links) {
      const set = granted.get(l.roleCode) ?? new Set<string>();
      set.add(l.permissionCode);
      granted.set(l.roleCode, set);
    }
    return {
      roles: allRoles,
      permissions: catalog,
      granted: Object.fromEntries([...granted.entries()].map(([k, v]) => [k, [...v]])),
    };
  }

  /** Nhân bản vai trò (tiện tạo vai trò mới giống vai trò có sẵn) */
  async duplicate(id: number, newCode: string, newName?: string) {
    const source = await this.findOne(id);
    return this.create({
      code: newCode,
      name: newName ?? `${source.name} (bản sao)`,
      description: source.description,
      dataScope: source.dataScope,
      priority: source.priority,
      color: source.color,
      permissionCodes: source.permissions.map((p) => p.code),
    });
  }

  async deleteMany(ids: number[]) {
    let removed = 0;
    const errors: { id: number; message: string }[] = [];
    for (const id of ids) {
      try {
        await this.remove(id);
        removed++;
      } catch (err) {
        errors.push({ id, message: (err as Error).message });
      }
    }
    return { removed, errors };
  }

  async countUsersByRole() {
    return this.db.db
      .select({ roleId: userRoles.roleId, total: sql<number>`count(*)::int` })
      .from(userRoles)
      .where(and(ne(userRoles.roleId, 0), sql`1=1`))
      .groupBy(userRoles.roleId)
      .orderBy(desc(sql`count(*)`));
  }
}
