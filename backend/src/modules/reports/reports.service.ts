/**
 * Phân hệ BÁO CÁO CÔNG TÁC CỦA KHOA.
 *
 * Mô hình dữ liệu (hoàn toàn cấu hình được từ giao diện):
 *   Khoa → Mẫu báo cáo → Mục (section) → Nhóm (block) → Dòng chỉ tiêu (row)
 *   Mẫu báo cáo → Danh sách cột (INPUT nhập tay | CALC tính theo công thức)
 *   Số liệu = (mẫu × dòng × cột × ngày) — duy nhất theo ô, có nhật ký thay đổi
 *
 * Bộ máy tính báo cáo gom số liệu theo kỳ với 6 cách cộng dồn cho từng dòng
 * (SUM/FIRST/LAST/AVG/MIN/MAX), sau đó tính các cột CALC bằng bộ phân tích
 * biểu thức an toàn (không dùng eval).
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import { DbService, type Executor } from '../../db/db.service';
import {
  departments,
  reportBlocks,
  reportColumns,
  reportEntries,
  reportEntryAudits,
  reportRows,
  reportSections,
  reportSnapshots,
  reportTemplates,
  type ColumnKind,
  type AggMode,
} from '../../db/schema';
import { buildPage, type Paginated, parseFilters } from '../../common/dto/query.dto';
import { pushFilters, type FilterTarget } from '../../common/filters/apply-filter';
import { evaluateFormula, formulaRefs } from '../../common/utils/formula.util';
import { resolvePeriod, eachDay, today } from '../../common/utils/date.util';
import type { AccessContext } from '../../common/types/access-context';
import { CacheService } from '../../infra/cache/cache.service';
import { RealtimeService } from '../realtime/realtime.service';
import { AuditService } from '../audit/audit.service';
import type {
  ColumnInputDto,
  CreateReportTemplateDto,
  EntryGridQueryDto,
  ReportQueryDto,
  RowInputDto,
  SaveStructureDto,
  SectionInputDto,
  UpdateReportTemplateDto,
  UpsertEntriesDto,
} from './dto/reports.dto';

/* ------------------------------------------------------------- Kiểu dữ liệu */

export interface ReportCell {
  colKey: string;
  value: number;
  formatted: string;
  /** Số ngày có số liệu góp vào ô này (với SUM là số bản ghi) */
  samples: number;
}

export interface ReportRowResult {
  rowId: number;
  blockId: number | null;
  groupLabel: string;
  rowLabel: string;
  unit: string;
  agg: AggMode;
  isBold: boolean;
  isTotal: boolean;
  note: string;
  cells: ReportCell[];
}

export interface ReportBuildResult {
  template: {
    id: number;
    code: string;
    name: string;
    title: string;
    subtitle: string;
    footerNote: string;
    departmentId: number;
    departmentName: string;
    printTemplateId: number | null;
  };
  period: ReturnType<typeof resolvePeriod>;
  columns: {
    id: number;
    colKey: string;
    label: string;
    groupLabel: string;
    kind: ColumnKind;
    formula: string;
    format: string;
    unit: string;
    align: string;
    width: number;
  }[];
  sections: {
    id: number;
    title: string;
    note: string;
    blocks: { id: number | null; label: string; note: string; rows: ReportRowResult[] }[];
  }[];
  totals: Record<string, number>;
  completeness: { days: number; daysWithData: number; ratio: number };
  entryCount: number;
}

const SUMMARY_INDICATORS = [
  { key: 'kham', label: 'Khám bệnh' },
  { key: 'vao', label: 'Vào viện' },
  { key: 'ra', label: 'Ra viện' },
  { key: 'tu_vong', label: 'Tử vong' },
  { key: 'hien_con', label: 'Hiện còn' },
] as const;

function formatCell(value: number, format: string | undefined): string {
  if (!Number.isFinite(value)) return '';
  switch (format) {
    case 'integer':
      return Math.round(value).toLocaleString('vi-VN');
    case 'percent':
      return `${(value * 100).toFixed(1)}%`;
    case 'text':
      return String(value);
    default:
      return value.toLocaleString('vi-VN', { maximumFractionDigits: 2 });
  }
}

/** Trường lọc nâng cao của nhật ký sửa số liệu báo cáo. */
const ENTRY_AUDIT_FILTERS: Record<string, FilterTarget> = {
  rowId: { expr: reportEntryAudits.rowId, type: 'number' },
  colKey: { expr: reportEntryAudits.colKey, type: 'text' },
  action: { expr: reportEntryAudits.action, type: 'text' },
  userId: { expr: reportEntryAudits.userId, type: 'number' },
};

@Injectable()
export class ReportsService {
  constructor(
    private readonly db: DbService,
    private readonly cache: CacheService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
  ) {}

  /* ============================================================ MẪU BÁO CÁO */

  async listTemplates(query: EntryGridQueryDto, user?: AccessContext): Promise<Paginated<Record<string, unknown>>> {
    const where: SQL[] = [];
    if (query.q?.trim()) {
      const like = `%${query.q.trim()}%`;
      where.push(sql`(${reportTemplates.name} ILIKE ${like} OR ${reportTemplates.code} ILIKE ${like})`);
    }
    if (query.templateId) where.push(eq(reportTemplates.id, query.templateId));
    if (query.departmentId) where.push(eq(reportTemplates.departmentId, query.departmentId));
    if (query.activeOnly) where.push(eq(reportTemplates.active, true));
    if (!this.canSeeAll(user)) {
      const allowed = user?.departmentIds ?? [];
      where.push(
        allowed.length > 0
          ? inArray(reportTemplates.departmentId, allowed)
          : eq(reportTemplates.departmentId, user?.departmentId ?? -1),
      );
    }
    const condition = where.length ? and(...where) : undefined;

    const [countRow] = await this.db.db
      .select({ total: sql<number>`count(*)::int` })
      .from(reportTemplates)
      .where(condition);

    const rows = await this.db.db
      .select({
        id: reportTemplates.id,
        departmentId: reportTemplates.departmentId,
        departmentName: departments.name,
        code: reportTemplates.code,
        name: reportTemplates.name,
        title: reportTemplates.title,
        defaultPeriod: reportTemplates.defaultPeriod,
        printTemplateId: reportTemplates.printTemplateId,
        version: reportTemplates.version,
        isDefault: reportTemplates.isDefault,
        active: reportTemplates.active,
        sortOrder: reportTemplates.sortOrder,
        createdAt: reportTemplates.createdAt,
        updatedAt: reportTemplates.updatedAt,
        columnCount: sql<number>`(select count(*)::int from ${reportColumns} c where c.template_id = ${reportTemplates.id} and c.archived = false)`,
        rowCount: sql<number>`(select count(*)::int from ${reportRows} r join ${reportSections} s on s.id = r.section_id where s.template_id = ${reportTemplates.id} and r.archived = false)`,
      })
      .from(reportTemplates)
      .leftJoin(departments, eq(departments.id, reportTemplates.departmentId))
      .where(condition)
      .orderBy(asc(reportTemplates.departmentId), asc(reportTemplates.sortOrder), asc(reportTemplates.name))
      .limit(query.limit)
      .offset(query.offset);

    return buildPage(rows, countRow?.total ?? 0, query.page, query.limit);
  }

  /** Toàn bộ cấu trúc bảng biểu của một mẫu báo cáo */
  async getTemplateFull(id: number, includeArchived = false) {
    const [template] = await this.db.db
      .select({
        id: reportTemplates.id,
        departmentId: reportTemplates.departmentId,
        departmentName: departments.name,
        code: reportTemplates.code,
        name: reportTemplates.name,
        title: reportTemplates.title,
        subtitle: reportTemplates.subtitle,
        footerNote: reportTemplates.footerNote,
        defaultPeriod: reportTemplates.defaultPeriod,
        printTemplateId: reportTemplates.printTemplateId,
        layout: reportTemplates.layout,
        version: reportTemplates.version,
        isDefault: reportTemplates.isDefault,
        active: reportTemplates.active,
        sortOrder: reportTemplates.sortOrder,
      })
      .from(reportTemplates)
      .leftJoin(departments, eq(departments.id, reportTemplates.departmentId))
      .where(eq(reportTemplates.id, id));
    if (!template) throw new NotFoundException('Không tìm thấy mẫu báo cáo');

    const columns = await this.db.db
      .select()
      .from(reportColumns)
      .where(
        includeArchived
          ? eq(reportColumns.templateId, id)
          : and(eq(reportColumns.templateId, id), eq(reportColumns.archived, false)),
      )
      .orderBy(asc(reportColumns.sortOrder), asc(reportColumns.id));

    const sections = await this.db.db
      .select()
      .from(reportSections)
      .where(
        includeArchived
          ? eq(reportSections.templateId, id)
          : and(eq(reportSections.templateId, id), eq(reportSections.archived, false)),
      )
      .orderBy(asc(reportSections.sortOrder), asc(reportSections.id));

    const sectionIds = sections.map((s) => s.id);
    const blocks = sectionIds.length
      ? await this.db.db
          .select()
          .from(reportBlocks)
          .where(inArray(reportBlocks.sectionId, sectionIds))
          .orderBy(asc(reportBlocks.sortOrder), asc(reportBlocks.id))
      : [];
    const blockIds = blocks.map((b) => b.id);
    const rows = sectionIds.length
      ? await this.db.db
          .select()
          .from(reportRows)
          .where(
            includeArchived
              ? inArray(reportRows.sectionId, sectionIds)
              : and(inArray(reportRows.sectionId, sectionIds), eq(reportRows.archived, false)),
          )
          .orderBy(asc(reportRows.sortOrder), asc(reportRows.id))
      : [];

    void blockIds;
    return {
      template,
      columns,
      sections: sections.map((s) => ({
        ...s,
        blocks: blocks
          .filter((b) => b.sectionId === s.id)
          .map((b) => ({
            ...b,
            rows: rows.filter((r) => r.blockId === b.id),
          })),
        rows: rows.filter((r) => r.sectionId === s.id && r.blockId === null),
      })),
    };
  }

  async createTemplate(dto: CreateReportTemplateDto, user?: AccessContext) {
    const [dept] = await this.db.db
      .select({ id: departments.id })
      .from(departments)
      .where(eq(departments.id, dto.departmentId));
    if (!dept) throw new NotFoundException('Không tìm thấy khoa');

    const [dup] = await this.db.db
      .select({ id: reportTemplates.id })
      .from(reportTemplates)
      .where(and(eq(reportTemplates.departmentId, dto.departmentId), eq(reportTemplates.code, dto.code)));
    if (dup) throw new ConflictException(`Mã mẫu "${dto.code}" đã tồn tại trong khoa này`);

    const templateId = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(reportTemplates)
        .values({
          departmentId: dto.departmentId,
          code: dto.code,
          name: dto.name,
          title: dto.title ?? 'BÁO CÁO CÔNG TÁC CHUYÊN MÔN',
          subtitle: dto.subtitle ?? '',
          footerNote: dto.footerNote ?? '',
          defaultPeriod: dto.defaultPeriod ?? 'day',
          printTemplateId: dto.printTemplateId ?? null,
          isDefault: dto.isDefault ?? true,
          active: dto.active ?? true,
          sortOrder: dto.sortOrder ?? 0,
        })
        .returning({ id: reportTemplates.id });

      if (dto.columns?.length) {
        await this.writeColumns(tx, row.id, dto.columns);
      }
      if (dto.sections?.length) {
        await this.writeSections(tx, row.id, dto.sections, false);
      }
      this.assertFormulas(row.id, dto.columns ?? [], dto.sections ?? []);
      return row.id;
    });

    void user;
    return this.getTemplateFull(templateId);
  }

  async updateTemplate(id: number, dto: UpdateReportTemplateDto) {
    const current = await this.getTemplateFull(id, true);
    const [row] = await this.db.db
      .update(reportTemplates)
      .set({
        departmentId: dto.departmentId ?? current.template.departmentId,
        code: dto.code ?? current.template.code,
        name: dto.name ?? current.template.name,
        title: dto.title ?? current.template.title,
        subtitle: dto.subtitle ?? current.template.subtitle,
        footerNote: dto.footerNote ?? current.template.footerNote,
        defaultPeriod: dto.defaultPeriod ?? current.template.defaultPeriod,
        printTemplateId: dto.printTemplateId === undefined ? current.template.printTemplateId : dto.printTemplateId,
        isDefault: dto.isDefault ?? current.template.isDefault,
        active: dto.active ?? current.template.active,
        sortOrder: dto.sortOrder ?? current.template.sortOrder,
        version: sql`${reportTemplates.version} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(reportTemplates.id, id))
      .returning();
    await this.cache.delByPrefix(`report:${id}`);
    return row;
  }

  async removeTemplate(id: number) {
    const { template } = await this.getTemplateFull(id, true);
    const [used] = await this.db.db
      .select({ total: sql<number>`count(*)::int` })
      .from(reportEntries)
      .where(eq(reportEntries.templateId, id));
    if ((used?.total ?? 0) > 0) {
      // Còn số liệu → ngừng sử dụng để bảo toàn lịch sử
      await this.db.db
        .update(reportTemplates)
        .set({ active: false, isDefault: false, updatedAt: new Date() })
        .where(eq(reportTemplates.id, id));
      return {
        deleted: false,
        archived: true,
        message: `Mẫu "${template.name}" đã có ${used.total} ô số liệu — đã chuyển sang trạng thái ngừng sử dụng thay vì xoá`,
      };
    }
    await this.db.db.delete(reportTemplates).where(eq(reportTemplates.id, id));
    return { deleted: true, archived: false, message: 'Đã xoá mẫu báo cáo' };
  }

  async duplicateTemplate(id: number, newCode: string, newName?: string, departmentId?: number) {
    const full = await this.getTemplateFull(id, true);
    return this.createTemplate({
      departmentId: departmentId ?? full.template.departmentId,
      code: newCode,
      name: newName ?? `${full.template.name} (bản sao)`,
      title: full.template.title,
      subtitle: full.template.subtitle,
      footerNote: full.template.footerNote,
      defaultPeriod: full.template.defaultPeriod,
      printTemplateId: full.template.printTemplateId,
      isDefault: false,
      active: true,
      columns: full.columns.map((c) => ({
        colKey: c.colKey,
        label: c.label,
        groupLabel: c.groupLabel,
        kind: c.kind,
        formula: c.formula,
        format: c.format,
        summaryKey: c.summaryKey,
        unit: c.unit,
        width: c.width,
        align: c.align,
        sortOrder: c.sortOrder,
      })),
      sections: full.sections.map((s) => ({
        code: s.code,
        title: s.title,
        note: s.note,
        sortOrder: s.sortOrder,
        blocks: s.blocks.map((b) => ({
          label: b.label,
          note: b.note,
          sortOrder: b.sortOrder,
          rows: b.rows.map((r) => this.rowToInput(r)),
        })),
        rows: s.rows.map((r) => this.rowToInput(r)),
      })),
    });
  }

  /** Lưu toàn bộ cấu trúc (dùng cho trình thiết kế báo cáo) */
  async saveStructure(id: number, dto: SaveStructureDto) {
    await this.getTemplateFull(id, true);
    await this.db.transaction(async (tx) => {
      if (dto.columns) await this.writeColumns(tx, id, dto.columns);
      if (dto.sections) await this.writeSections(tx, id, dto.sections, dto.purge ?? false);
      this.assertFormulas(id, dto.columns ?? [], dto.sections ?? []);
      await tx
        .update(reportTemplates)
        .set({ version: sql`${reportTemplates.version} + 1`, updatedAt: new Date() })
        .where(eq(reportTemplates.id, id));
    });
    return this.getTemplateFull(id, true);
  }

  /** Kiểm tra công thức: chỉ tham chiếu cột có thật và không tham chiếu vòng */
  validateFormula(payload: { columns: ColumnInputDto[]; formula?: string }) {
    const keys = new Set(payload.columns.map((c) => c.colKey.trim()).filter(Boolean));
    const expr = payload.formula?.trim() ?? '';
    if (!expr) return { valid: true, refs: [] as string[], unknown: [] as string[], error: undefined as string | undefined };
    const result = evaluateFormula(expr, { values: Object.fromEntries([...keys].map((k) => [k, 1])) });
    const refs = formulaRefs(expr);
    const unknown = refs.filter((r) => !keys.has(r));
    return {
      valid: !result.error && unknown.length === 0,
      refs,
      unknown,
      error: result.error,
    };
  }

  private assertFormulas(
    _templateId: number,
    columns: ColumnInputDto[],
    sections: SectionInputDto[],
  ): void {
    const keys = new Set(columns.map((c) => c.colKey.trim()));
    const errors: string[] = [];

    for (const col of columns.filter((c) => c.kind === 'CALC')) {
      if (!col.formula?.trim()) {
        errors.push(`Cột "${col.label}": cột tính toán chưa có công thức`);
        continue;
      }
      const refs = formulaRefs(col.formula);
      const unknown = refs.filter((r) => !keys.has(r));
      if (unknown.length) {
        errors.push(`Cột "${col.label}": công thức tham chiếu cột không tồn tại (${unknown.join(', ')})`);
      }
    }

    // Phát hiện tham chiếu vòng giữa các cột CALC
    const calcCols = columns.filter((c) => c.kind === 'CALC' && c.formula?.trim());
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const byKey = new Map(calcCols.map((c) => [c.colKey.trim(), c]));
    const walk = (key: string): boolean => {
      if (visited.has(key)) return false;
      if (visiting.has(key)) return true;
      const col = byKey.get(key);
      if (!col) return false;
      visiting.add(key);
      for (const ref of formulaRefs(col.formula ?? '')) {
        if (walk(ref)) {
          errors.push(`Cột "${col.label}": công thức tham chiếu vòng qua "${ref}"`);
          return true;
        }
      }
      visiting.delete(key);
      visited.add(key);
      return false;
    };
    for (const col of calcCols) walk(col.colKey.trim());

    for (const row of this.flattenRows(sections)) {
      if (row.formula?.trim()) {
        const refs = formulaRefs(row.formula);
        const unknown = refs.filter((r) => !keys.has(r));
        if (unknown.length) {
          errors.push(`Dòng "${row.rowLabel}": công thức tham chiếu cột không tồn tại (${unknown.join(', ')})`);
        }
      }
    }

    if (errors.length) {
      throw new BadRequestException({ message: 'Công thức không hợp lệ', errors });
    }
  }

  private flattenRows(sections: SectionInputDto[]): RowInputDto[] {
    const out: RowInputDto[] = [];
    for (const s of sections) {
      out.push(...(s.rows ?? []));
      for (const b of s.blocks ?? []) out.push(...(b.rows ?? []));
    }
    return out;
  }

  private rowToInput(r: {
    groupLabel: string;
    rowLabel: string;
    agg: string;
    unit: string;
    isBold: boolean;
    isTotal: boolean;
    formula: string;
    note: string;
    sortOrder: number;
  }): RowInputDto {
    return {
      groupLabel: r.groupLabel,
      rowLabel: r.rowLabel,
      agg: r.agg as AggMode,
      unit: r.unit,
      isBold: r.isBold,
      isTotal: r.isTotal,
      formula: r.formula,
      note: r.note,
      sortOrder: r.sortOrder,
    };
  }

  /** Ghi danh sách cột: cập nhật theo id, thêm mới theo colKey, lưu trữ cột bị bỏ */
  private async writeColumns(tx: Executor, templateId: number, columns: ColumnInputDto[]): Promise<void> {
    const existing = await tx.select().from(reportColumns).where(eq(reportColumns.templateId, templateId));
    const byId = new Map(existing.map((c) => [c.id, c]));
    const byKey = new Map(existing.map((c) => [c.colKey, c]));
    const keptIds = new Set<number>();

    for (const [index, col] of columns.entries()) {
      const colKey = col.colKey.trim();
      const target = (col.id ? byId.get(col.id) : undefined) ?? byKey.get(colKey);
      const values = {
        templateId,
        colKey,
        label: col.label,
        groupLabel: col.groupLabel ?? '',
        kind: col.kind as ColumnKind,
        formula: col.formula ?? '',
        format: col.format ?? 'number',
        summaryKey: col.summaryKey ?? '',
        unit: col.unit ?? '',
        width: col.width ?? 70,
        align: col.align ?? 'center',
        sortOrder: col.sortOrder ?? index,
        archived: col.archived ?? false,
      };
      if (target) {
        await tx.update(reportColumns).set(values).where(eq(reportColumns.id, target.id));
        keptIds.add(target.id);
      } else {
        const [row] = await tx.insert(reportColumns).values(values).returning({ id: reportColumns.id });
        keptIds.add(row.id);
      }
    }

    // Cột không còn trong cấu trúc → lưu trữ (giữ nguyên số liệu lịch sử)
    for (const col of existing) {
      if (!keptIds.has(col.id) && !col.archived) {
        await tx.update(reportColumns).set({ archived: true }).where(eq(reportColumns.id, col.id));
      }
    }
  }

  /** Ghi cấu trúc mục → nhóm → dòng */
  private async writeSections(
    tx: Executor,
    templateId: number,
    sections: SectionInputDto[],
    purge: boolean,
  ): Promise<void> {
    const existingSections = await tx.select().from(reportSections).where(eq(reportSections.templateId, templateId));
    const sectionIds = existingSections.map((s) => s.id);
    const existingBlocks = sectionIds.length
      ? await tx.select().from(reportBlocks).where(inArray(reportBlocks.sectionId, sectionIds))
      : [];
    const existingRows = sectionIds.length
      ? await tx.select().from(reportRows).where(inArray(reportRows.sectionId, sectionIds))
      : [];
    const blockById = new Map(existingBlocks.map((b) => [b.id, b]));
    const rowById = new Map(existingRows.map((r) => [r.id, r]));
    const keptSectionIds = new Set<number>();
    const keptBlockIds = new Set<number>();
    const keptRowIds = new Set<number>();

    for (const [sIndex, section] of sections.entries()) {
      const sectionValues = {
        templateId,
        code: section.code ?? '',
        title: section.title,
        note: section.note ?? '',
        sortOrder: section.sortOrder ?? sIndex,
        archived: false,
      };
      let sectionId: number;
      if (section.id && existingSections.some((s) => s.id === section.id)) {
        await tx.update(reportSections).set(sectionValues).where(eq(reportSections.id, section.id));
        sectionId = section.id;
      } else {
        const [row] = await tx.insert(reportSections).values(sectionValues).returning({ id: reportSections.id });
        sectionId = row.id;
      }
      keptSectionIds.add(sectionId);

      const writeRow = async (r: RowInputDto, order: number, blockId: number | null): Promise<void> => {
        const values = {
          sectionId,
          blockId,
          groupLabel: r.groupLabel ?? '',
          rowLabel: r.rowLabel,
          agg: (r.agg ?? 'SUM') as AggMode,
          unit: r.unit ?? '',
          isBold: r.isBold ?? false,
          isTotal: r.isTotal ?? false,
          formula: r.formula ?? '',
          note: r.note ?? '',
          sortOrder: r.sortOrder ?? order,
          archived: false,
        };
        if (r.id && rowById.has(r.id)) {
          await tx.update(reportRows).set(values).where(eq(reportRows.id, r.id));
          keptRowIds.add(r.id);
        } else {
          const [row] = await tx.insert(reportRows).values(values).returning({ id: reportRows.id });
          keptRowIds.add(row.id);
        }
      };

      for (const [bIndex, block] of (section.blocks ?? []).entries()) {
        const blockValues = {
          sectionId,
          label: block.label,
          note: block.note ?? '',
          sortOrder: block.sortOrder ?? bIndex,
          archived: false,
        };
        let blockId: number;
        if (block.id && blockById.has(block.id)) {
          await tx.update(reportBlocks).set(blockValues).where(eq(reportBlocks.id, block.id));
          blockId = block.id;
        } else {
          const [row] = await tx.insert(reportBlocks).values(blockValues).returning({ id: reportBlocks.id });
          blockId = row.id;
        }
        keptBlockIds.add(blockId);
        for (const [rIndex, r] of (block.rows ?? []).entries()) await writeRow(r, rIndex, blockId);
      }

      for (const [rIndex, r] of (section.rows ?? []).entries()) await writeRow(r, rIndex, null);
    }

    // Lưu trữ (hoặc xoá hẳn nếu purge) phần tử không còn trong cấu trúc
    for (const r of existingRows) {
      if (keptRowIds.has(r.id)) continue;
      if (purge) {
        const [used] = await tx
          .select({ total: sql<number>`count(*)::int` })
          .from(reportEntries)
          .where(eq(reportEntries.rowId, r.id));
        if ((used?.total ?? 0) === 0) {
          await tx.delete(reportRows).where(eq(reportRows.id, r.id));
          continue;
        }
      }
      await tx.update(reportRows).set({ archived: true }).where(eq(reportRows.id, r.id));
    }
    for (const b of existingBlocks) {
      if (keptBlockIds.has(b.id)) continue;
      const [rowCount] = await tx
        .select({ total: sql<number>`count(*)::int` })
        .from(reportRows)
        .where(and(eq(reportRows.blockId, b.id), eq(reportRows.archived, false)));
      if ((rowCount?.total ?? 0) === 0) {
        await tx.delete(reportBlocks).where(eq(reportBlocks.id, b.id));
      }
    }
    for (const s of existingSections) {
      if (keptSectionIds.has(s.id)) continue;
      const [rowCount] = await tx
        .select({ total: sql<number>`count(*)::int` })
        .from(reportRows)
        .where(and(eq(reportRows.sectionId, s.id), eq(reportRows.archived, false)));
      if ((rowCount?.total ?? 0) === 0) {
        await tx.delete(reportSections).where(eq(reportSections.id, s.id));
      } else {
        await tx.update(reportSections).set({ archived: true }).where(eq(reportSections.id, s.id));
      }
    }
  }

  /* ================================================================ SỐ LIỆU */

  /** Lưới nhập liệu: cấu trúc + giá trị đã nhập theo ngày */
  async getEntryGrid(query: EntryGridQueryDto, user?: AccessContext) {
    const templateId = query.templateId ?? (await this.defaultTemplateId(query.departmentId, user));
    const full = await this.getTemplateFull(templateId, query.includeArchived ?? false);
    const period = resolvePeriod(query.period ?? 'day', query.date, query.dateFrom, query.dateTo);

    const entries = await this.db.db
      .select({
        rowId: reportEntries.rowId,
        colKey: reportEntries.colKey,
        entryDate: reportEntries.entryDate,
        value: reportEntries.value,
        note: reportEntries.note,
        updatedBy: reportEntries.updatedBy,
        updatedAt: reportEntries.updatedAt,
      })
      .from(reportEntries)
      .where(
        and(
          eq(reportEntries.templateId, templateId),
          sql`${reportEntries.entryDate} between ${period.from} and ${period.to}`,
        ),
      );

    const days = eachDay(period.from, period.to);
    const values: Record<string, number> = {};
    const notes: Record<string, string> = {};
    const filledCells = new Set<string>();
    const perDay: Record<string, number> = {};
    for (const e of entries) {
      const k = `${e.rowId}|${e.colKey}|${e.entryDate}`;
      values[k] = e.value;
      if (e.note) notes[k] = e.note;
      if (e.value !== 0) filledCells.add(k);
      perDay[e.entryDate] = (perDay[e.entryDate] ?? 0) + 1;
    }

    const rowIds = full.sections.flatMap((s) => [
      ...s.rows.map((r) => r.id),
      ...s.blocks.flatMap((b) => b.rows.map((r) => r.id)),
    ]);

    // Kỳ đã chốt & khoá thì giao diện hiển thị cảnh báo và không cho sửa
    const locked = await this.lockedSnapshotFor(templateId, period.to);

    return {
      template: full.template,
      columns: full.columns,
      sections: full.sections,
      period,
      days,
      values,
      notes,
      perDay,
      locked: locked ? { id: locked.id, title: locked.title } : null,
      stats: {
        totalCells: rowIds.length * full.columns.filter((c) => c.kind === 'INPUT').length * days.length,
        filledCells: filledCells.size,
        entryCount: entries.length,
      },
    };
  }

  /**
   * Kỳ báo cáo đã bị "khoá" bởi một bản chốt số liệu chưa?
   * Số liệu đã chốt chính thức thì không cho sửa tiếp để bảo đảm số đã báo cáo.
   */
  private async lockedSnapshotFor(templateId: number, entryDate: string) {
    const [locked] = await this.db.db
      .select({ id: reportSnapshots.id, title: reportSnapshots.title, status: reportSnapshots.status })
      .from(reportSnapshots)
      .where(
        and(
          eq(reportSnapshots.templateId, templateId),
          eq(reportSnapshots.status, 'LOCKED'),
          sql`${entryDate}::date between ${reportSnapshots.dateFrom} and ${reportSnapshots.dateTo}`,
        ),
      )
      .limit(1);
    return locked ?? null;
  }

  /** Chặn ghi số liệu vào kỳ đã khoá */
  private async assertNotLocked(templateId: number, entryDate: string): Promise<void> {
    const locked = await this.lockedSnapshotFor(templateId, entryDate);
    if (locked) {
      throw new BadRequestException(
        `Kỳ báo cáo này đã được chốt và khoá (${locked.title}) — không sửa được số liệu. ` +
          'Hãy mở khoá bản chốt hoặc liên hệ Ban KHTH.',
      );
    }
  }

  /** Ghi số liệu hàng loạt (upsert theo ô) + nhật ký thay đổi từng ô */
  async upsertEntries(dto: UpsertEntriesDto, user: AccessContext) {
    const full = await this.getTemplateFull(dto.templateId, true);
    const validRows = new Set<number>();
    for (const s of full.sections) {
      for (const r of s.rows) validRows.add(r.id);
      for (const b of s.blocks) for (const r of b.rows) validRows.add(r.id);
    }
    const inputCols = new Map(full.columns.filter((c) => c.kind === 'INPUT').map((c) => [c.colKey, c]));
    const invalid: string[] = [];
    for (const v of dto.values) {
      if (!validRows.has(v.rowId)) invalid.push(`Dòng #${v.rowId} không thuộc mẫu báo cáo`);
      if (!inputCols.has(v.colKey)) invalid.push(`Cột "${v.colKey}" không phải cột nhập liệu`);
    }
    if (invalid.length) {
      throw new BadRequestException({ message: 'Số liệu không hợp lệ', errors: [...new Set(invalid)] });
    }

    // Nhập theo kỳ → quy về ngày kết thúc kỳ (báo cáo kỳ lấy số tại ngày đó)
    let entryDate = dto.entryDate;
    if (dto.forPeriod || dto.period) {
      const period = resolvePeriod(dto.period ?? 'day', dto.entryDate, dto.entryDate, dto.dateTo);
      entryDate = period.to;
    }

    // Số liệu của kỳ đã chốt và khoá thì không sửa được nữa
    await this.assertNotLocked(dto.templateId, entryDate);

    // Khoá nhận biết một ô số liệu: dòng × cột × ngày (mọi bản ghi dưới đây cùng ngày)
    const cellKey = (rowId: number, colKey: string): string => `${rowId}|${colKey}|${entryDate}`;
    const existing = await this.db.db
      .select({
        id: reportEntries.id,
        rowId: reportEntries.rowId,
        colKey: reportEntries.colKey,
        value: reportEntries.value,
      })
      .from(reportEntries)
      .where(
        and(
          eq(reportEntries.templateId, dto.templateId),
          eq(reportEntries.entryDate, entryDate),
          inArray(reportEntries.rowId, [...new Set(dto.values.map((v) => v.rowId))]),
        ),
      );
    // Trước đây khoá thiếu ngày nên không bao giờ khớp → lần lưu thứ hai bị lỗi trùng khoá
    const existingMap = new Map(existing.map((e) => [cellKey(e.rowId, e.colKey), e]));

    let created = 0;
    let updated = 0;
    let skipped = 0;
    const audits: (typeof reportEntryAudits.$inferInsert)[] = [];

    await this.db.transaction(async (tx) => {
      for (const v of dto.values) {
        const before = existingMap.get(cellKey(v.rowId, v.colKey));
        if (dto.skipExisting && before && before.value !== 0 && before.value !== v.value) {
          skipped += 1;
          continue;
        }
        if (before) {
          if (before.value === v.value && !v.note) {
            continue;
          }
          await tx
            .update(reportEntries)
            .set({ value: v.value, note: v.note ?? '', updatedBy: user.id, updatedAt: new Date() })
            .where(eq(reportEntries.id, before.id));
          updated += 1;
          audits.push({
            templateId: dto.templateId,
            rowId: v.rowId,
            colKey: v.colKey,
            entryDate,
            oldValue: before.value,
            newValue: v.value,
            action: 'UPDATE',
            userId: user.id,
            username: user.username,
            fullName: user.fullName,
          });
        } else {
          await tx.insert(reportEntries).values({
            templateId: dto.templateId,
            rowId: v.rowId,
            colKey: v.colKey,
            entryDate,
            value: v.value,
            note: v.note ?? '',
            updatedBy: user.id,
          });
          created += 1;
          audits.push({
            templateId: dto.templateId,
            rowId: v.rowId,
            colKey: v.colKey,
            entryDate,
            oldValue: 0,
            newValue: v.value,
            action: 'CREATE',
            userId: user.id,
            username: user.username,
            fullName: user.fullName,
          });
        }
      }
      if (audits.length) await tx.insert(reportEntryAudits).values(audits);
    });

    await this.cache.delByPrefix(`report:${dto.templateId}`);
    // GĐ3: báo dashboard/báo cáo realtime biết số liệu vừa thay đổi
    this.realtime.publish({ topic: 'report', type: 'entries.changed', permission: 'report.view.view', data: { templateId: dto.templateId, entryDate } });
    return {
      templateId: dto.templateId,
      entryDate,
      created,
      updated,
      skipped,
      total: dto.values.length,
    };
  }

  async deleteEntry(templateId: number, rowId: number, colKey: string, entryDate: string, user: AccessContext) {
    const [before] = await this.db.db
      .select()
      .from(reportEntries)
      .where(
        and(
          eq(reportEntries.templateId, templateId),
          eq(reportEntries.rowId, rowId),
          eq(reportEntries.colKey, colKey),
          eq(reportEntries.entryDate, entryDate),
        ),
      );
    if (!before) throw new NotFoundException('Không tìm thấy ô số liệu');
    await this.assertNotLocked(templateId, entryDate);
    await this.db.transaction(async (tx) => {
      await tx.delete(reportEntries).where(eq(reportEntries.id, before.id));
      await tx.insert(reportEntryAudits).values({
        templateId,
        rowId,
        colKey,
        entryDate,
        oldValue: before.value,
        newValue: 0,
        action: 'DELETE',
        userId: user.id,
        username: user.username,
        fullName: user.fullName,
      });
    });
    await this.cache.delByPrefix(`report:${templateId}`);
    return { deleted: true };
  }

  /** Nhật ký thay đổi số liệu (ai sửa, sửa gì, khi nào) */
  async entryHistory(query: ReportQueryDto) {
    const where: SQL[] = [];
    if (query.templateId) where.push(eq(reportEntryAudits.templateId, query.templateId));
    if (query.dateFrom) where.push(sql`${reportEntryAudits.entryDate} >= ${query.dateFrom}`);
    if (query.dateTo) where.push(sql`${reportEntryAudits.entryDate} <= ${query.dateTo}`);
    pushFilters(where, parseFilters(query.filters), ENTRY_AUDIT_FILTERS);
    const condition = where.length ? and(...where) : undefined;

    const [countRow] = await this.db.db
      .select({ total: sql<number>`count(*)::int` })
      .from(reportEntryAudits)
      .where(condition);

    const rows = await this.db.db
      .select({
        id: reportEntryAudits.id,
        templateId: reportEntryAudits.templateId,
        rowId: reportEntryAudits.rowId,
        rowLabel: reportRows.rowLabel,
        colKey: reportEntryAudits.colKey,
        entryDate: reportEntryAudits.entryDate,
        oldValue: reportEntryAudits.oldValue,
        newValue: reportEntryAudits.newValue,
        action: reportEntryAudits.action,
        username: reportEntryAudits.username,
        fullName: reportEntryAudits.fullName,
        createdAt: reportEntryAudits.createdAt,
      })
      .from(reportEntryAudits)
      .leftJoin(reportRows, eq(reportRows.id, reportEntryAudits.rowId))
      .where(condition)
      .orderBy(desc(reportEntryAudits.createdAt))
      .limit(query.limit)
      .offset(query.offset);

    return buildPage(rows, countRow?.total ?? 0, query.page, query.limit);
  }

  /* ======================================================= BỘ MÁY BÁO CÁO */

  /** Tính báo cáo hoàn chỉnh theo kỳ — trái tim của phân hệ */
  async buildReport(query: ReportQueryDto, user?: AccessContext): Promise<ReportBuildResult> {
    const templateId = query.templateId ?? (await this.defaultTemplateId(query.departmentId, user));
    const full = await this.getTemplateFull(templateId, false);
    const period = resolvePeriod(query.period ?? full.template.defaultPeriod, query.date, query.dateFrom, query.dateTo);

    const entries = await this.db.db
      .select({
        rowId: reportEntries.rowId,
        colKey: reportEntries.colKey,
        entryDate: reportEntries.entryDate,
        value: reportEntries.value,
      })
      .from(reportEntries)
      .where(
        and(
          eq(reportEntries.templateId, templateId),
          sql`${reportEntries.entryDate} between ${period.from} and ${period.to}`,
        ),
      );

    // Gom số liệu theo dòng → cột (kèm ngày để xử lý FIRST/LAST)
    const byRow = new Map<number, Map<string, { value: number; date: string }[]>>();
    for (const e of entries) {
      const cols = byRow.get(e.rowId) ?? new Map();
      const list = cols.get(e.colKey) ?? [];
      list.push({ value: e.value, date: e.entryDate });
      cols.set(e.colKey, list);
      byRow.set(e.rowId, cols);
    }

    const rowResults = new Map<number, ReportRowResult>();

    const aggregate = (samples: { value: number; date: string }[], agg: AggMode): number => {
      if (samples.length === 0) return 0;
      const sorted = [...samples].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
      switch (agg) {
        case 'FIRST':
          return sorted[0]?.value ?? 0;
        case 'LAST':
          return sorted[sorted.length - 1]?.value ?? 0;
        case 'AVG':
          return sorted.reduce((s, x) => s + x.value, 0) / sorted.length;
        case 'MIN':
          return Math.min(...sorted.map((x) => x.value));
        case 'MAX':
          return Math.max(...sorted.map((x) => x.value));
        case 'SUM':
        default:
          return sorted.reduce((s, x) => s + x.value, 0);
      }
    };

    const computeRow = (row: typeof reportRows.$inferSelect): ReportRowResult => {
      const cached = rowResults.get(row.id);
      if (cached) return cached;
      const colSamples = byRow.get(row.id) ?? new Map<string, { value: number; date: string }[]>();
      const values: Record<string, number> = {};
      const cells: ReportCell[] = [];

      for (const col of full.columns) {
        if (col.kind === 'INPUT') {
          const samples = colSamples.get(col.colKey) ?? [];
          const value = aggregate(samples, row.agg as AggMode);
          values[col.colKey] = value;
          cells.push({
            colKey: col.colKey,
            value,
            formatted: formatCell(value, col.format),
            samples: samples.filter((s) => s.value !== 0).length,
          });
        } else {
          const expression = row.formula?.trim() || col.formula;
          const result = evaluateFormula(expression, { values });
          const value = result.value;
          values[col.colKey] = value;
          cells.push({
            colKey: col.colKey,
            value,
            formatted: formatCell(value, col.format),
            samples: 0,
          });
        }
      }

      const result: ReportRowResult = {
        rowId: row.id,
        blockId: row.blockId ?? null,
        groupLabel: row.groupLabel,
        rowLabel: row.rowLabel,
        unit: row.unit,
        agg: row.agg as AggMode,
        isBold: row.isBold,
        isTotal: row.isTotal,
        note: row.note,
        cells,
      };
      rowResults.set(row.id, result);
      return result;
    };

    const sections = full.sections.map((s) => ({
      id: s.id,
      title: s.title,
      note: s.note,
      blocks: [
        ...(s.rows.length
          ? [{ id: null as number | null, label: '', note: '', rows: s.rows.map(computeRow) }]
          : []),
        ...s.blocks.map((b) => ({
          id: b.id as number | null,
          label: b.label,
          note: b.note,
          rows: b.rows.map(computeRow),
        })),
      ],
    }));

    // Dòng tổng theo cột (bỏ qua các dòng đã là dòng tổng để không cộng trùng)
    const totals: Record<string, number> = {};
    for (const col of full.columns) {
      if (col.kind === 'CALC') continue;
      let sum = 0;
      for (const s of sections) {
        for (const b of s.blocks) {
          for (const r of b.rows) {
            if (r.isTotal) continue;
            sum += r.cells.find((c) => c.colKey === col.colKey)?.value ?? 0;
          }
        }
      }
      totals[col.colKey] = sum;
    }
    for (const col of full.columns.filter((c) => c.kind === 'CALC')) {
      totals[col.colKey] = evaluateFormula(col.formula, { values: totals }).value;
    }

    const daysInPeriod = period.days || 1;
    const daysWithData = new Set(entries.map((e) => e.entryDate)).size;
    const [deptName] = await this.db.db
      .select({ name: departments.name })
      .from(departments)
      .where(eq(departments.id, full.template.departmentId));

    void user;
    return {
      template: {
        id: full.template.id,
        code: full.template.code,
        name: full.template.name,
        title: full.template.title,
        subtitle: full.template.subtitle,
        footerNote: full.template.footerNote,
        departmentId: full.template.departmentId,
        departmentName: deptName?.name ?? '',
        printTemplateId: full.template.printTemplateId,
      },
      period,
      columns: full.columns.map((c) => ({
        id: c.id,
        colKey: c.colKey,
        label: c.label,
        groupLabel: c.groupLabel,
        kind: c.kind,
        formula: c.formula,
        format: c.format,
        unit: c.unit,
        align: c.align,
        width: c.width,
      })),
      sections,
      totals,
      completeness: {
        days: daysInPeriod,
        daysWithData,
        ratio: period.mode === 'all' ? 1 : Math.min(1, daysWithData / daysInPeriod),
      },
      entryCount: entries.length,
    };
  }

  /**
   * Bảng tổng hợp toàn viện.
   *
   * Số liệu được gom bằng SQL (sum theo mẫu báo cáo và cột) rồi ghép vào từng khoa,
   * không lọc mảng trong bộ nhớ — nhờ vậy chạy nhanh kể cả khi có hàng trăm nghìn ô.
   * Danh sách chỉ tiêu lấy từ cấu hình `summaryKey` của cột báo cáo, các chỉ tiêu
   * chuẩn của bệnh viện luôn được xếp trước để bảng tổng hợp ổn định.
   */
  async buildSummary(query: ReportQueryDto, user?: AccessContext) {
    const period = resolvePeriod(query.period ?? 'week', query.date, query.dateFrom, query.dateTo);

    const deptWhere: SQL[] = [eq(departments.active, true), isNull(departments.deletedAt)];
    if (query.departmentId) deptWhere.push(eq(departments.id, query.departmentId));
    if (!this.canSeeAll(user)) {
      const allowed = user?.departmentIds ?? [];
      deptWhere.push(
        allowed.length ? inArray(departments.id, allowed) : eq(departments.id, user?.departmentId ?? -1),
      );
    }
    const depts = await this.db.db
      .select({ id: departments.id, name: departments.name, code: departments.code, kind: departments.kind })
      .from(departments)
      .where(and(...deptWhere, eq(departments.reportEnabled, true)))
      .orderBy(asc(departments.sortOrder), asc(departments.name));

    const templates = await this.db.db
      .select()
      .from(reportTemplates)
      .where(
        and(
          inArray(reportTemplates.departmentId, depts.map((d) => d.id).concat([-1])),
          eq(reportTemplates.isDefault, true),
          eq(reportTemplates.active, true),
        ),
      );
    const columns = templates.length
      ? await this.db.db
          .select()
          .from(reportColumns)
          .where(inArray(reportColumns.templateId, templates.map((t) => t.id)))
          .orderBy(asc(reportColumns.sortOrder))
      : [];

    // Chỉ tiêu tổng hợp: chuẩn của bệnh viện trước, sau đó là các khoá do cột tự khai báo
    const indicatorCols = new Map<string, { label: string; colKey: string }>();
    for (const key of SUMMARY_INDICATORS) indicatorCols.set(key.key, { label: key.label, colKey: '' });
    for (const col of columns) {
      if (!col.summaryKey) continue;
      const existing = indicatorCols.get(col.summaryKey);
      if (!existing) indicatorCols.set(col.summaryKey, { label: col.label, colKey: col.colKey });
      else if (!existing.colKey) existing.colKey = col.colKey;
    }
    const indicatorKeys = [...indicatorCols.keys()];

    // Gom số liệu ngay trong CSDL: mỗi mẫu báo cáo × cột → tổng giá trị
    const templateIds = templates.map((t) => t.id);
    const sums = templateIds.length
      ? await this.db.db
          .select({
            templateId: reportEntries.templateId,
            colKey: reportEntries.colKey,
            total: sql<number>`coalesce(sum(${reportEntries.value}), 0)::float8`,
            cells: sql<number>`count(*)::int`,
          })
          .from(reportEntries)
          .where(
            and(
              inArray(reportEntries.templateId, templateIds),
              sql`${reportEntries.entryDate} between ${period.from} and ${period.to}`,
            ),
          )
          .groupBy(reportEntries.templateId, reportEntries.colKey)
      : [];

    const sumsByTemplate = new Map<number, Map<string, number>>();
    const filledTemplates = new Set<number>();
    for (const row of sums) {
      const map = sumsByTemplate.get(row.templateId) ?? new Map<string, number>();
      map.set(row.colKey, row.total);
      sumsByTemplate.set(row.templateId, map);
      filledTemplates.add(row.templateId);
    }

    const columnsByKey = new Map<string, string>(); // templateId|colKey → summaryKey
    for (const col of columns) {
      if (col.summaryKey) columnsByKey.set(`${col.templateId}|${col.colKey}`, col.summaryKey);
    }

    const rows = depts.map((dept) => {
      const template = templates.find((t) => t.departmentId === dept.id) ?? null;
      const indicators: Record<string, number> = {};
      for (const key of indicatorKeys) indicators[key] = 0;

      if (template) {
        for (const [colKey, total] of sumsByTemplate.get(template.id) ?? []) {
          const summaryKey = columnsByKey.get(`${template.id}|${colKey}`);
          if (!summaryKey) continue;
          indicators[summaryKey] = (indicators[summaryKey] ?? 0) + total;
        }
      }

      return {
        departmentId: dept.id,
        departmentCode: dept.code,
        departmentName: dept.name,
        kind: dept.kind,
        templateId: template?.id ?? null,
        templateName: template?.name ?? '',
        indicators,
        filled: template ? filledTemplates.has(template.id) : false,
      };
    });

    const totals: Record<string, number> = {};
    for (const key of indicatorKeys) {
      totals[key] = rows.reduce((s, r) => s + (r.indicators[key] ?? 0), 0);
    }

    return {
      period,
      departments: rows,
      indicators: indicatorKeys.map((key) => ({
        key,
        label: SUMMARY_INDICATORS.find((i) => i.key === key)?.label ?? indicatorCols.get(key)?.label ?? key,
        colKey: indicatorCols.get(key)?.colKey ?? '',
      })),
      totals,
      missing: rows.filter((r) => !r.filled).map((r) => ({ id: r.departmentId, name: r.departmentName })),
    };
  }

  /** Thống kê tình hình nhập liệu phục vụ dashboard */
  async stats(query: ReportQueryDto, user?: AccessContext) {
    const period = resolvePeriod(query.period ?? 'day', query.date, query.dateFrom, query.dateTo);

    const [counts] = await this.db.db
      .select({
        templates: sql<number>`(select count(*)::int from ${reportTemplates} where active = true)`,
        columns: sql<number>`(select count(*)::int from ${reportColumns} where archived = false)`,
        rows: sql<number>`(select count(*)::int from ${reportRows} where archived = false)`,
      })
      .from(reportTemplates)
      .limit(1);

    const byDay = await this.db.db
      .select({
        entryDate: reportEntries.entryDate,
        cells: sql<number>`count(*)::int`,
        value: sql<number>`coalesce(sum(${reportEntries.value}), 0)::float8`,
      })
      .from(reportEntries)
      .where(sql`${reportEntries.entryDate} between ${period.from} and ${period.to}`)
      .groupBy(reportEntries.entryDate)
      .orderBy(asc(reportEntries.entryDate));

    const summary = await this.buildSummary({ ...query, period: query.period ?? 'day' } as ReportQueryDto, user);

    return {
      period,
      templates: counts?.templates ?? 0,
      columns: counts?.columns ?? 0,
      rows: counts?.rows ?? 0,
      byDay,
      reportedDepartments: summary.departments.filter((d) => d.filled).length,
      totalDepartments: summary.departments.length,
      missing: summary.missing,
    };
  }

  /* ================================================================ TIỆN ÍCH */

  private canSeeAll(user?: AccessContext): boolean {
    return !user || user.isSuperAdmin || user.permissions.includes('report.view.all-departments');
  }

  private async defaultTemplateId(departmentId: number | undefined, user?: AccessContext): Promise<number> {
    const deptId = departmentId ?? user?.departmentId ?? null;
    const where: SQL[] = [eq(reportTemplates.isDefault, true), eq(reportTemplates.active, true)];
    if (deptId) where.push(eq(reportTemplates.departmentId, deptId));
    const [row] = await this.db.db
      .select({ id: reportTemplates.id })
      .from(reportTemplates)
      .where(and(...where))
      .orderBy(asc(reportTemplates.sortOrder))
      .limit(1);
    if (row) return row.id;

    const [any] = await this.db.db
      .select({ id: reportTemplates.id })
      .from(reportTemplates)
      .where(eq(reportTemplates.active, true))
      .orderBy(asc(reportTemplates.id))
      .limit(1);
    if (!any) throw new NotFoundException('Chưa có mẫu báo cáo nào — hãy tạo mẫu báo cáo trước');
    return any.id;
  }

  /* ============================================================== CHỐT KỲ */

  async snapshot(templateId: number, query: ReportQueryDto, user: AccessContext, title?: string) {
    const report = await this.buildReport({ ...query, templateId } as ReportQueryDto, user);
    const [row] = await this.db.db
      .insert(reportSnapshots)
      .values({
        templateId,
        departmentId: report.template.departmentId,
        title: title ?? `${report.template.name} — ${report.period.label}`,
        periodMode: report.period.mode,
        dateFrom: report.period.from,
        dateTo: report.period.to,
        periodLabel: report.period.label,
        payload: report as unknown as Record<string, unknown>,
        status: 'DRAFT',
        createdBy: user.id,
      })
      .returning();
    return row;
  }

  async listSnapshots(query: ReportQueryDto) {
    const where: SQL[] = [];
    if (query.templateId) where.push(eq(reportSnapshots.templateId, query.templateId));
    if (query.departmentId) where.push(eq(reportSnapshots.departmentId, query.departmentId));
    const condition = where.length ? and(...where) : undefined;
    const [countRow] = await this.db.db
      .select({ total: sql<number>`count(*)::int` })
      .from(reportSnapshots)
      .where(condition);
    const rows = await this.db.db
      .select({
        id: reportSnapshots.id,
        templateId: reportSnapshots.templateId,
        departmentId: reportSnapshots.departmentId,
        title: reportSnapshots.title,
        periodLabel: reportSnapshots.periodLabel,
        status: reportSnapshots.status,
        dateFrom: reportSnapshots.dateFrom,
        dateTo: reportSnapshots.dateTo,
        createdBy: reportSnapshots.createdBy,
        createdAt: reportSnapshots.createdAt,
      })
      .from(reportSnapshots)
      .where(condition)
      .orderBy(desc(reportSnapshots.createdAt))
      .limit(query.limit)
      .offset(query.offset);
    return buildPage(rows, countRow?.total ?? 0, query.page, query.limit);
  }

  /**
   * Đổi trạng thái bản chốt: DRAFT → APPROVED → LOCKED.
   *
   * Mở khoá (LOCKED → APPROVED/DRAFT) chỉ dành cho người có quyền quản trị bản chốt;
   * mọi thay đổi đều ghi nhật ký để biết ai đã mở khoá và khi nào.
   */
  async updateSnapshotStatus(id: number, status: 'DRAFT' | 'APPROVED' | 'LOCKED', user: AccessContext) {
    const [current] = await this.db.db
      .select()
      .from(reportSnapshots)
      .where(eq(reportSnapshots.id, id))
      .limit(1);
    if (!current) throw new NotFoundException('Không tìm thấy bản chốt số liệu');
    if (current.status === status) return current;

    const unlocking = current.status === 'LOCKED' && status !== 'LOCKED';
    if (unlocking && !user.isSuperAdmin && !user.permissions.includes('report.snapshot.lock')) {
      throw new ForbiddenException('Chỉ người có quyền khoá bản chốt mới được mở khoá');
    }

    const [row] = await this.db.db
      .update(reportSnapshots)
      .set({
        status,
        lockedAt: status === 'LOCKED' ? new Date() : null,
      })
      .where(eq(reportSnapshots.id, id))
      .returning();

    await this.audit.log({
      module: 'REPORT',
      action: unlocking ? 'UNLOCK' : 'UPDATE',
      entity: 'report_snapshot',
      entityId: id,
      description: unlocking
        ? `Mở khoá bản chốt số liệu "${current.title}" (${current.status} → ${status})`
        : `Chuyển bản chốt số liệu "${current.title}" sang ${status}`,
      userId: user.id,
      username: user.username,
      fullName: user.fullName,
    });
    await this.cache.delByPrefix(`report:${current.templateId}`);
    return row;
  }

  async getSnapshot(id: number) {
    const [row] = await this.db.db.select().from(reportSnapshots).where(eq(reportSnapshots.id, id));
    if (!row) throw new NotFoundException('Không tìm thấy bản chốt số liệu');
    return row;
  }

  /** Ngày mới nhất có số liệu của một mẫu (gợi ý khi mở màn nhập liệu) */
  async latestEntryDate(templateId: number): Promise<string> {
    const [row] = await this.db.db
      .select({ maxDate: sql<string | null>`max(${reportEntries.entryDate})::text` })
      .from(reportEntries)
      .where(eq(reportEntries.templateId, templateId));
    return row?.maxDate ?? today();
  }
}
