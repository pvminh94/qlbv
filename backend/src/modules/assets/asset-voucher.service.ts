/**
 * In biên bản chứng từ tài sản (bàn giao, điều chuyển, thu hồi, sửa chữa, thanh lý…) ra PDF
 * từ mẫu in BIEN_BAN_TAI_SAN (sửa được trong Trình thiết kế bản in), mặc định dùng mẫu dựng sẵn.
 */
import { Injectable } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import type { AccessContext } from '../../common/types/access-context';
import { DbService } from '../../db/db.service';
import { printTemplates, type PrintDocument } from '../../db/schema';
import { renderPrintDocument } from '../../infra/rendering/pdf-renderer';
import { SettingsService } from '../settings/settings.service';
import { ASSET_CONDITION } from './asset-constants';
import { AssetTransactionsService } from './asset-transactions.service';
import { defaultAssetVoucherDocument, VOUCHER_TEMPLATE_CODE, VOUCHER_TITLE } from './asset-voucher-template';

const fmt = (n: unknown) => Number(n ?? 0).toLocaleString('vi-VN', { maximumFractionDigits: 0 });

@Injectable()
export class AssetVoucherService {
  constructor(
    private readonly db: DbService,
    private readonly settings: SettingsService,
    private readonly txService: AssetTransactionsService,
  ) {}

  private async template(): Promise<PrintDocument> {
    const list = await this.db.db
      .select({ document: printTemplates.document, isDefault: printTemplates.isDefault })
      .from(printTemplates)
      .where(and(eq(printTemplates.docType, VOUCHER_TEMPLATE_CODE), eq(printTemplates.active, true)))
      .orderBy(asc(printTemplates.name));
    const t = list.find((x) => x.isDefault) ?? list[0];
    return (t?.document as PrintDocument) ?? defaultAssetVoucherDocument();
  }

  async render(id: number, user: AccessContext) {
    const t = await this.txService.detail(id, user);
    const [hospitalName, parentOrgName, place, director] = await Promise.all([
      this.settings.get('hospital.name', ''),
      this.settings.get('hospital.parentName', ''),
      this.settings.get('hospital.place', ''),
      this.settings.get('hospital.director', ''),
    ]).then((r) => r.map((x) => String(x ?? '')));
    const [y, m, d] = String(t.txDate).split('-');
    const amountLabel = t.typeMeta?.amountLabel;
    const totalAmount = t.items.reduce((s, i) => s + Number(i.amount ?? 0), 0);
    const totalCost = t.items.reduce((s, i) => s + Number(i.originalCost ?? 0), 0);
    const to = [t.toDepartmentName, t.toLocationName, t.toCustodianFullName || t.toCustodianName].filter(Boolean).join(' — ');
    const data = {
      hospitalName,
      parentOrgName,
      code: t.code,
      title: VOUCHER_TITLE[t.type] ?? `BIÊN BẢN ${String(t.typeLabel).toUpperCase()}`,
      typeLabel: t.typeLabel,
      placeDateText: `${place ? `${place}, ngày` : 'Ngày'} ${d} tháng ${m} năm ${y}`,
      decisionText: t.decisionNo || '………………………………………………',
      fromText: t.fromDepartmentName || (t.type === 'CAP_PHAT' ? 'Kho tài sản' : 'Nhiều khoa/phòng (chi tiết theo bảng)'),
      toText: to || (t.type === 'THU_HOI' ? 'Kho tài sản' : t.supplierName || '………………………………………………'),
      reason: t.reason || t.note || t.typeLabel,
      itemCount: t.items.length,
      totalCostText: fmt(totalCost),
      amountTotalText: amountLabel && totalAmount ? `; ${amountLabel.toLowerCase()} ${fmt(totalAmount)} đồng` : '',
      approvalText: t.status === 'DA_DUYET' && t.approvedAt ? `Đã duyệt trên phần mềm bởi ${t.approvedByName ?? ''} lúc ${new Date(t.approvedAt).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}` : '',
      delivererName: t.delivererName,
      receiverName: t.receiverName,
      creatorName: t.createdByName ?? '',
      approverName: t.approvedByName || director,
      items: t.items.map((i) => ({
        ...i,
        nameText: [i.name, i.model && `Model: ${i.model}`, i.serialNumber && `S/N: ${i.serialNumber}`].filter(Boolean).join('\n'),
        amountText: Number(i.amount) ? fmt(i.amount) : '',
        conditionText: [i.condition ? ASSET_CONDITION[i.condition] ?? i.condition : '', i.note].filter(Boolean).join('; '),
      })),
    };
    const { buffer } = await renderPrintDocument(await this.template(), { data, fileName: `${t.code}.pdf` });
    return { buffer, fileName: `bien-ban-${t.code}.pdf` };
  }
}
