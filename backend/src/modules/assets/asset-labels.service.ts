/**
 * In tem tài sản (QR + mã vạch) từ mẫu in TEM_TAI_SAN (sửa được trong Trình thiết kế bản in).
 *
 * Cách làm: nhân bản các phần tử của mẫu tem cho mỗi tài sản i, đổi {x} → {ri.x} và binding.path → ri.path,
 * rồi render một lần với data { r0, r1, … } — không cần sửa bộ render.
 *   THERMAL: máy in tem nhiệt — mỗi tem một trang, khổ = khổ mẫu tem.
 *   SHEET  : giấy decal A4 — lưới cols × rows, có lề/khoảng cách, bỏ qua N ô đầu (tận dụng tờ decal dùng dở).
 */
import { BadRequestException, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { AccessContext } from '../../common/types/access-context';
import { DbService } from '../../db/db.service';
import { assetEvents, printTemplates, type PrintDocument, type PrintElement } from '../../db/schema';
import { renderPrintDocument } from '../../infra/rendering/pdf-renderer';
import { SettingsService } from '../settings/settings.service';
import { AssetsService, type AssetListQuery } from './assets.service';

export { LABEL_TEMPLATE_CODE, defaultAssetLabelDocument } from './asset-label-template';
import { LABEL_TEMPLATE_CODE, defaultAssetLabelDocument } from './asset-label-template';

export interface LabelRequest {
  ids?: number[];
  filter?: AssetListQuery;
  templateId?: number;
  layout?: 'THERMAL' | 'SHEET';
  copies?: number;
  origin?: string;
  sheet?: { cols?: number; rows?: number; marginTop?: number; marginLeft?: number; gapX?: number; gapY?: number; skip?: number };
}

const GLOBAL_KEYS = /^(system|today|now|hospitalName)\b/;

function prefixText(text: string | undefined, p: string) {
  if (!text) return text;
  return text.replace(/\{([a-zA-Z0-9_.[\]]+)\}/g, (m, expr: string) => (GLOBAL_KEYS.test(expr) ? m : `{${p}.${expr}}`));
}

@Injectable()
export class AssetLabelsService {
  constructor(
    private readonly db: DbService,
    private readonly assetsService: AssetsService,
    private readonly settings: SettingsService,
  ) {}

  async templates() {
    return this.db.db
      .select({ id: printTemplates.id, code: printTemplates.code, name: printTemplates.name, document: printTemplates.document, isDefault: printTemplates.isDefault })
      .from(printTemplates)
      .where(and(eq(printTemplates.docType, LABEL_TEMPLATE_CODE), eq(printTemplates.active, true)))
      .orderBy(asc(printTemplates.name));
  }

  private async template(id?: number): Promise<PrintDocument> {
    const list = await this.templates();
    const t = (id ? list.find((x) => x.id === id) : null) ?? list.find((x) => x.isDefault) ?? list[0];
    return (t?.document as PrintDocument) ?? defaultAssetLabelDocument();
  }

  async render(req: LabelRequest, user: AccessContext) {
    let rows: Record<string, unknown>[];
    if (req.ids?.length) {
      const res = await this.assetsService.list({ ids: req.ids.join(','), all: true, sortBy: 'code', sortDir: 'asc' }, user);
      rows = res.items as Record<string, unknown>[];
      // giữ thứ tự người dùng chọn
      const order = new Map(req.ids.map((id, i) => [id, i]));
      rows.sort((a, b) => (order.get(a.id as number) ?? 0) - (order.get(b.id as number) ?? 0));
    } else if (req.filter) {
      rows = (await this.assetsService.list({ ...req.filter, all: true, sortBy: req.filter.sortBy || 'code', sortDir: req.filter.sortDir || 'asc' }, user)).items as Record<string, unknown>[];
    } else throw new BadRequestException('Chưa chọn tài sản cần in tem');
    if (!rows.length) throw new BadRequestException('Không có tài sản nào để in tem');
    const copies = Math.min(10, Math.max(1, Math.trunc(Number(req.copies) || 1)));
    if (rows.length * copies > 3000) throw new BadRequestException('Tối đa 3000 tem mỗi lần in');

    const tpl = await this.template(req.templateId);
    const sourceEls: PrintElement[] = (tpl.pages?.[0]?.elements ?? (tpl as { elements?: PrintElement[] }).elements ?? []) as PrintElement[];
    if (!sourceEls.length) throw new BadRequestException('Mẫu tem chưa có phần tử nào');
    const size = tpl.paperSize === 'Custom' && tpl.customSize ? tpl.customSize : { width: 50, height: 30 };
    const hospitalName = String((await this.settings.get('hospital.name', '')) ?? '');
    const origin = String(req.origin ?? '').replace(/\/+$/, '');

    const data: Record<string, unknown> = { hospitalName };
    const labels: string[] = [];
    rows.forEach((a) => {
      for (let c = 0; c < copies; c++) labels.push(String(a.id));
    });
    const byId = new Map(rows.map((a) => [String(a.id), a]));
    labels.forEach((id, i) => {
      const a = byId.get(id)!;
      const inUse = (a.inUseDate ?? a.acquisitionDate ?? '') as string;
      data[`r${i}`] = {
        ...a,
        barcode: (a.barcode as string) || (a.code as string),
        qrUrl: origin ? `${origin}/ts/${encodeURIComponent(String(a.code))}` : String(a.code),
        inUseYear: inUse ? inUse.slice(0, 4) : '',
        serialText: a.serialNumber ? `S/N: ${a.serialNumber}` : '',
        originalCostText: Number(a.originalCost ?? 0).toLocaleString('vi-VN'),
        departmentName: a.departmentName ?? 'Kho',
      };
    });

    const cloneFor = (i: number, dx: number, dy: number): PrintElement[] =>
      sourceEls.map((e) => ({
        ...e,
        id: `${e.id}_${i}`,
        x: e.x + dx,
        y: e.y + dy,
        anchor: undefined,
        repeatOnEveryPage: false,
        text: prefixText(e.text, `r${i}`),
        binding: e.binding?.path && e.binding.source !== 'system' && !GLOBAL_KEYS.test(e.binding.path) ? { ...e.binding, path: `r${i}.${e.binding.path}` } : e.binding,
        visibleWhen: e.visibleWhen ? e.visibleWhen.replace(/\b([a-zA-Z_][a-zA-Z0-9_.]*)\s*(==|!=|>|<)/g, `r${i}.$1 $2`) : undefined,
      }));

    let doc: PrintDocument;
    if ((req.layout ?? 'THERMAL') === 'THERMAL') {
      doc = {
        ...tpl,
        paperSize: 'Custom',
        customSize: size,
        margins: { top: 0, right: 0, bottom: 0, left: 0 },
        header: undefined,
        footer: undefined,
        pageNumbering: undefined,
        watermark: undefined,
        pages: labels.map((_, i) => ({ id: `p${i}`, elements: cloneFor(i, 0, 0) })),
      };
    } else {
      const s = req.sheet ?? {};
      const mt = Math.max(0, Number(s.marginTop ?? 10));
      const ml = Math.max(0, Number(s.marginLeft ?? 5));
      const gx = Math.max(0, Number(s.gapX ?? 2));
      const gy = Math.max(0, Number(s.gapY ?? 2));
      const cols = Math.max(1, Math.trunc(Number(s.cols) || Math.floor((210 - 2 * ml + gx) / (size.width + gx))));
      const rowsPer = Math.max(1, Math.trunc(Number(s.rows) || Math.floor((297 - 2 * mt + gy) / (size.height + gy))));
      if (ml + cols * size.width + (cols - 1) * gx > 210.5 || mt + rowsPer * size.height + (rowsPer - 1) * gy > 297.5) {
        throw new BadRequestException(`Lưới ${cols} × ${rowsPer} tem ${size.width}×${size.height} mm vượt khổ A4 — giảm số cột/hàng hoặc lề`);
      }
      const perPage = cols * rowsPer;
      const skip = Math.min(perPage - 1, Math.max(0, Math.trunc(Number(s.skip) || 0)));
      const pages: { id: string; elements: PrintElement[] }[] = [];
      labels.forEach((_, i) => {
        const slot = i + skip;
        const pi = Math.floor(slot / perPage);
        const within = slot % perPage;
        const col = within % cols;
        const row = Math.floor(within / cols);
        pages[pi] ??= { id: `p${pi}`, elements: [] };
        pages[pi].elements.push(...cloneFor(i, ml + col * (size.width + gx), mt + row * (size.height + gy)));
      });
      doc = {
        ...tpl,
        paperSize: 'A4',
        orientation: 'portrait',
        customSize: undefined,
        margins: { top: 0, right: 0, bottom: 0, left: 0 },
        header: undefined,
        footer: undefined,
        pageNumbering: undefined,
        watermark: undefined,
        pages,
      };
    }
    delete (doc as { elements?: unknown }).elements;
    const { buffer } = await renderPrintDocument(doc, { data, fileName: 'tem-tai-san.pdf' });
    // Dòng thời gian: ghi nhận đã in tem (một sự kiện / tài sản)
    const ids = rows.map((r) => Number(r.id));
    await this.db.db.insert(assetEvents).values(
      ids.map((assetId) => ({ assetId, eventType: 'LABEL_PRINTED', title: `In tem (${copies} bản, ${req.layout === 'SHEET' ? 'giấy decal A4' : 'máy in tem'})`, detail: {}, userId: user.id, userName: user.fullName })),
    );
    return { buffer, count: labels.length, fileName: `tem-tai-san-${new Date().toISOString().slice(0, 10)}.pdf` };
  }

  /** Dùng khi seed: đảm bảo có mẫu TEM_TAI_SAN */
  async ensureTemplate() {
    const [t] = await this.db.db.select({ id: printTemplates.id }).from(printTemplates).where(inArray(printTemplates.code, [LABEL_TEMPLATE_CODE]));
    if (t) return t.id;
    const [r] = await this.db.db
      .insert(printTemplates)
      .values({ code: LABEL_TEMPLATE_CODE, name: 'Tem tài sản 50 × 30 mm (QR + mã vạch)', description: 'Tem dán tài sản: QR tra cứu, mã vạch Code128, tên, khoa, năm sử dụng.', module: 'ASSET', docType: LABEL_TEMPLATE_CODE, paperSize: 'Custom', orientation: 'portrait', document: defaultAssetLabelDocument() as never, isDefault: true, active: true })
      .returning({ id: printTemplates.id });
    return r.id;
  }
}
