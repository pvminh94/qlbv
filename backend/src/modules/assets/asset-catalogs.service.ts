/**
 * Danh mục phân hệ tài sản — một service CRUD dùng chung cho 4 danh mục:
 *   categories (loại tài sản, dạng cây) · locations (vị trí, dạng cây) · suppliers · funding (nguồn vốn).
 * Mỗi danh mục khai báo whitelist trường + kiểu để làm sạch dữ liệu vào.
 */
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, sql, type SQL } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import { DbService, type Executor } from '../../db/db.service';
import { assetCategories, assetFundingSources, assetLocations, assets, assetSuppliers, departments } from '../../db/schema';
import { ASSET_GROUP, ASSET_KIND, LOCATION_KIND, SUPPLIER_ROLE } from './asset-constants';
import { METHOD_LABEL } from './depreciation';

type FieldType = 'text' | 'int' | 'number' | 'bool' | 'textArray' | 'json' | 'intOrNull';
interface CatalogConfig {
  table: PgTable & Record<string, PgColumn>;
  label: string;
  tree: boolean;
  fields: Record<string, FieldType>;
  enums?: Record<string, Record<string, string>>;
  /** Cột trong bảng assets tham chiếu tới danh mục (để đếm sử dụng / chặn xoá) */
  usage: PgColumn[];
}

const COMMON: Record<string, FieldType> = { code: 'text', name: 'text', sortOrder: 'int', active: 'bool', note: 'text' };

const CATALOGS: Record<string, CatalogConfig> = {
  categories: {
    table: assetCategories as never,
    label: 'loại tài sản',
    tree: true,
    fields: {
      ...COMMON,
      parentId: 'intOrNull',
      kind: 'text',
      group: 'text',
      codePrefix: 'text',
      depreciationMethod: 'text',
      usefulLifeMonths: 'int',
      annualRate: 'number',
      requiresCalibration: 'bool',
      calibrationIntervalMonths: 'int',
      maintenanceIntervalMonths: 'int',
      customFields: 'json',
    },
    enums: { kind: ASSET_KIND, group: ASSET_GROUP, depreciationMethod: METHOD_LABEL },
    usage: [assets.categoryId],
  },
  locations: {
    table: assetLocations as never,
    label: 'vị trí',
    tree: true,
    fields: { ...COMMON, parentId: 'intOrNull', kind: 'text', departmentId: 'intOrNull' },
    enums: { kind: LOCATION_KIND },
    usage: [assets.locationId],
  },
  suppliers: {
    table: assetSuppliers as never,
    label: 'nhà cung cấp / hãng',
    tree: false,
    fields: {
      ...COMMON,
      roles: 'textArray',
      taxCode: 'text',
      address: 'text',
      phone: 'text',
      email: 'text',
      contactName: 'text',
      country: 'text',
    },
    usage: [assets.supplierId, assets.manufacturerId],
  },
  funding: {
    table: assetFundingSources as never,
    label: 'nguồn vốn',
    tree: false,
    fields: { ...COMMON },
    usage: [assets.fundingSourceId],
  },
};

@Injectable()
export class AssetCatalogsService {
  constructor(private readonly db: DbService) {}

  private cfg(kind: string): CatalogConfig {
    const c = CATALOGS[kind];
    if (!c) throw new NotFoundException('Danh mục không tồn tại');
    return c;
  }

  /** Nhãn các giá trị liệt kê (cho ô chọn ở giao diện) */
  meta() {
    return { kinds: ASSET_KIND, groups: ASSET_GROUP, methods: METHOD_LABEL, locationKinds: LOCATION_KIND, supplierRoles: SUPPLIER_ROLE };
  }

  private clean(c: CatalogConfig, body: Record<string, unknown>, partial: boolean) {
    const out: Record<string, unknown> = {};
    for (const [key, type] of Object.entries(c.fields)) {
      if (!(key in body)) continue;
      const v = body[key];
      switch (type) {
        case 'text':
          out[key] = String(v ?? '').trim();
          break;
        case 'int':
          out[key] = Math.max(0, Math.trunc(Number(v) || 0));
          break;
        case 'intOrNull':
          out[key] = v === null || v === '' || v === undefined || Number(v) <= 0 ? null : Math.trunc(Number(v));
          break;
        case 'number':
          out[key] = Math.max(0, Number(v) || 0);
          break;
        case 'bool':
          out[key] = v === true || v === 'true' || v === 1;
          break;
        case 'textArray':
          out[key] = (Array.isArray(v) ? v : String(v ?? '').split(',')).map((x) => String(x).trim()).filter(Boolean);
          break;
        case 'json':
          out[key] = Array.isArray(v) || (v && typeof v === 'object') ? v : [];
          break;
      }
    }
    for (const [key, labels] of Object.entries(c.enums ?? {})) {
      if (key in out && !(String(out[key]) in labels)) throw new BadRequestException(`Giá trị "${String(out[key])}" không hợp lệ`);
    }
    if (!partial) {
      if (!out.code) throw new BadRequestException('Chưa nhập mã');
      if (!out.name) throw new BadRequestException('Chưa nhập tên');
    } else {
      if ('code' in out && !out.code) throw new BadRequestException('Mã không được để trống');
      if ('name' in out && !out.name) throw new BadRequestException('Tên không được để trống');
    }
    if (typeof out.code === 'string') out.code = out.code.toUpperCase().replace(/\s+/g, '_');
    if ('annualRate' in out && Number(out.annualRate) > 100) throw new BadRequestException('Tỉ lệ hao mòn tối đa 100%/năm');
    return out;
  }

  async list(kind: string, opts: { activeOnly?: boolean } = {}) {
    const c = this.cfg(kind);
    const t = c.table;
    const usageExpr = c.usage.length
      ? sql<number>`(select count(*)::int from ${assets} a where a.deleted_at is null and (${sql.join(
          c.usage.map((col) => sql`a.${sql.identifier(col.name)} = ${t.id}`),
          sql` or `,
        )}))`
      : sql<number>`0`;
    const where: SQL[] = [];
    if (opts.activeOnly) where.push(eq(t.active, true));
    const rows = await this.db.db
      .select({ row: sql<Record<string, unknown>>`to_jsonb(${t})`, usage: usageExpr })
      .from(t)
      .where(where.length ? and(...where) : undefined)
      .orderBy(...(c.tree ? [asc(t.path)] : []), asc(t.sortOrder), asc(t.name));
    // to_jsonb trả về tên cột snake_case → đổi sang camelCase theo khai báo schema
    const colMap = Object.fromEntries(Object.entries(t).filter(([, v]) => v && typeof v === 'object' && 'name' in (v as object)).map(([k, v]) => [(v as PgColumn).name, k]));
    let items = rows.map((r) => {
      const o: Record<string, unknown> = { usage: r.usage };
      for (const [k, v] of Object.entries(r.row)) o[colMap[k] ?? k] = v;
      return o;
    });
    if (kind === 'locations') {
      const depts = await this.db.db.select({ id: departments.id, name: departments.name }).from(departments);
      const dm = new Map(depts.map((d) => [d.id, d.name]));
      items = items.map((i) => ({ ...i, departmentName: i.departmentId ? (dm.get(Number(i.departmentId)) ?? '') : '' }));
    }
    if (c.tree) {
      // Cây: sắp theo path nhưng anh em theo sortOrder/tên → dựng lại thứ tự duyệt cây
      const byParent = new Map<number | null, Record<string, unknown>[]>();
      for (const i of items) {
        const p = (i.parentId as number | null) ?? null;
        if (!byParent.has(p)) byParent.set(p, []);
        byParent.get(p)!.push(i);
      }
      for (const arr of byParent.values()) arr.sort((a, b) => Number(a.sortOrder) - Number(b.sortOrder) || String(a.name).localeCompare(String(b.name), 'vi'));
      const ordered: Record<string, unknown>[] = [];
      const ids = new Set(items.map((i) => i.id));
      const walk = (p: number | null) => {
        for (const i of byParent.get(p) ?? []) {
          ordered.push({ ...i, hasChildren: (byParent.get(i.id as number) ?? []).length > 0 });
          walk(i.id as number);
        }
      };
      walk(null);
      // Nút mồ côi (cha đã xoá) → đưa lên gốc
      for (const i of items) if (i.parentId && !ids.has(i.parentId)) { ordered.push(i); walk(i.id as number); }
      items = ordered;
    }
    return items;
  }

  async findOne(kind: string, id: number) {
    const row = (await this.list(kind)).find((r) => r.id === id);
    if (!row) throw new NotFoundException(`Không tìm thấy ${this.cfg(kind).label}`);
    return row;
  }

  private async ensureUniqueCode(c: CatalogConfig, code: string, exceptId?: number) {
    const t = c.table;
    const [dup] = await this.db.db
      .select({ id: t.id })
      .from(t)
      .where(and(sql`lower(${t.code}) = lower(${code})`, exceptId ? sql`${t.id} <> ${exceptId}` : undefined));
    if (dup) throw new ConflictException(`Mã "${code}" đã tồn tại`);
  }

  /** Tính path/level theo cha; chặn chọn chính nó hoặc con cháu làm cha */
  private async treeFields(executor: Executor, c: CatalogConfig, id: number, parentId: number | null) {
    const t = c.table;
    if (!parentId) return { path: `/${id}/`, level: 1 };
    const [p] = await executor.select({ path: t.path, level: t.level }).from(t).where(eq(t.id, parentId));
    if (!p) throw new BadRequestException('Mục cha không tồn tại');
    if (String(p.path).includes(`/${id}/`)) throw new BadRequestException('Không thể chọn chính nó hoặc mục con làm mục cha');
    return { path: `${p.path}${id}/`, level: Number(p.level) + 1 };
  }

  async create(kind: string, body: Record<string, unknown>) {
    const c = this.cfg(kind);
    const data = this.clean(c, body, false);
    await this.ensureUniqueCode(c, data.code as string);
    const t = c.table;
    return this.db.db.transaction(async (tx) => {
      const [row] = await tx.insert(t).values(data as never).returning({ id: t.id });
      if (c.tree) {
        const tf = await this.treeFields(tx, c, row.id as number, (data.parentId as number) ?? null);
        await tx.update(t).set(tf as never).where(eq(t.id, row.id as number));
      }
      return { id: row.id };
    }).then(async (r) => this.findOne(kind, r.id as number));
  }

  async update(kind: string, id: number, body: Record<string, unknown>) {
    const c = this.cfg(kind);
    const t = c.table;
    const [cur] = await this.db.db.select({ id: t.id, path: c.tree ? t.path : t.id }).from(t).where(eq(t.id, id));
    if (!cur) throw new NotFoundException(`Không tìm thấy ${c.label}`);
    const data = this.clean(c, body, true);
    if (data.code) await this.ensureUniqueCode(c, data.code as string, id);
    await this.db.db.transaction(async (tx) => {
      if (Object.keys(data).length) await tx.update(t).set({ ...data, updatedAt: new Date() } as never).where(eq(t.id, id));
      if (c.tree && 'parentId' in data) {
        const oldPath = String(cur.path);
        const tf = await this.treeFields(tx, c, id, (data.parentId as number) ?? null);
        await tx.update(t).set(tf as never).where(eq(t.id, id));
        // Cập nhật path/level toàn bộ nhánh con
        const delta = tf.level - (oldPath.split('/').filter(Boolean).length || 1);
        await tx.execute(
          sql`update ${t} set path = ${tf.path} || substr(path, ${oldPath.length + 1}), level = level + ${delta} where path like ${oldPath + '%'} and id <> ${id}`,
        );
      }
    });
    return this.findOne(kind, id);
  }

  async remove(kind: string, id: number) {
    const c = this.cfg(kind);
    const t = c.table;
    const row = await this.findOne(kind, id);
    if (Number(row.usage) > 0) {
      throw new ConflictException(`Đang có ${row.usage} tài sản dùng ${c.label} này — hãy chuyển tài sản sang mục khác hoặc ngừng sử dụng thay vì xoá`);
    }
    if (c.tree) {
      const [child] = await this.db.db.select({ id: t.id }).from(t).where(eq(t.parentId, id)).limit(1);
      if (child) throw new ConflictException('Còn mục con bên trong — hãy xoá hoặc chuyển mục con trước');
    }
    await this.db.db.delete(t).where(eq(t.id, id));
    return { id };
  }
}
