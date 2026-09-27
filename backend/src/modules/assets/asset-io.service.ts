/**
 * Nhập / xuất danh sách tài sản (Excel).
 * Nhập: nhận diện cột theo tiêu đề (có dấu/không dấu), khớp danh mục theo mã hoặc tên,
 * chạy thử (dryRun) để xem lỗi từng dòng trước khi ghi; tuỳ chọn cập nhật tài sản đã có (theo mã).
 */
import { BadRequestException, Injectable } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Request } from 'express';
import * as ExcelJS from 'exceljs';
import type { AccessContext } from '../../common/types/access-context';
import { DbService } from '../../db/db.service';
import { assetCategories, assetFundingSources, assetLocations, assets, assetSuppliers, departments, users } from '../../db/schema';
import { normalizeKey, readTabularGrid } from '../users/user-import.parser';
import { ASSET_CONDITION, ASSET_STATUS } from './asset-constants';
import { AssetsService, type AssetListQuery } from './assets.service';
import { METHOD_LABEL } from './depreciation';

const MAX_BYTES = 15 * 1024 * 1024;

/** Cột nhập: khoá nội bộ → các tiêu đề chấp nhận (so khớp sau normalizeKey) */
const COLUMNS: { key: string; title: string; aliases: string[]; required?: boolean; example: string }[] = [
  { key: 'code', title: 'Mã tài sản', aliases: ['ma', 'mats', 'matai san', 'code'], example: 'Bỏ trống = tự sinh' },
  { key: 'name', title: 'Tên tài sản', aliases: ['ten', 'tents', 'name'], required: true, example: 'Máy siêu âm màu 4D' },
  { key: 'category', title: 'Loại tài sản', aliases: ['loai', 'nhom', 'category'], example: 'TBYT-CDHA' },
  { key: 'model', title: 'Model', aliases: ['model', 'kieu', 'ky ma hieu', 'kymahieu'], example: 'LOGIQ P9' },
  { key: 'serialNumber', title: 'Số serial', aliases: ['serial', 'soserial', 'sn', 'so may', 'somay'], example: 'SN123456' },
  { key: 'manufacturer', title: 'Hãng sản xuất', aliases: ['hang', 'hangsx', 'hangsanxuat', 'nhasanxuat'], example: 'GE Healthcare' },
  { key: 'countryOfOrigin', title: 'Nước sản xuất', aliases: ['nuoc', 'nuocsx', 'xuatxu', 'nuocsanxuat'], example: 'Hàn Quốc' },
  { key: 'yearOfManufacture', title: 'Năm sản xuất', aliases: ['namsx', 'namsanxuat'], example: '2023' },
  { key: 'supplier', title: 'Nhà cung cấp', aliases: ['ncc', 'nhacungcap'], example: 'Công ty ABC' },
  { key: 'unit', title: 'Đơn vị tính', aliases: ['dvt', 'donvitinh'], example: 'Cái' },
  { key: 'originalCost', title: 'Nguyên giá', aliases: ['nguyengia', 'gia', 'thanhtien'], example: '1250000000' },
  { key: 'fundingSource', title: 'Nguồn vốn', aliases: ['nguonvon', 'nguonkinhphi'], example: 'NSNN' },
  { key: 'acquisitionDate', title: 'Ngày ghi tăng', aliases: ['ngayghitang', 'ngaymua', 'ngaytang', 'ngaynhap'], example: '15/03/2024' },
  { key: 'inUseDate', title: 'Ngày đưa vào sử dụng', aliases: ['ngaysudung', 'ngaydua vao su dung', 'ngayduavaosudung', 'ngaysd'], example: '20/03/2024' },
  { key: 'department', title: 'Khoa/phòng sử dụng', aliases: ['khoa', 'phong', 'khoaphong', 'donvisudung', 'khoaphongsudung'], example: 'Khoa Chẩn đoán hình ảnh' },
  { key: 'location', title: 'Vị trí', aliases: ['vitri', 'noidat'], example: 'P.101' },
  { key: 'custodian', title: 'Người giữ', aliases: ['nguoigiu', 'nguoiquanly', 'nguoisudung'], example: 'Nguyễn Văn A' },
  { key: 'status', title: 'Trạng thái', aliases: ['trangthai'], example: 'Đang sử dụng' },
  { key: 'condition', title: 'Tình trạng', aliases: ['tinhtrang', 'chatluong'], example: 'Tốt' },
  { key: 'usefulLifeMonths', title: 'Thời gian sử dụng (tháng)', aliases: ['thoigiansudung', 'sothang', 'thoigiansudungthang'], example: '96' },
  { key: 'annualRate', title: 'Tỉ lệ hao mòn (%/năm)', aliases: ['tylehaomon', 'tilehaomon', 'tlhm', 'tylehaomonnam', 'tilehaomonnam'], example: '12.5' },
  { key: 'openingAccumulated', title: 'Hao mòn luỹ kế đầu kỳ', aliases: ['haomonluyke', 'luyke', 'haomonluykedauky', 'khauhaoluyke'], example: '150000000' },
  { key: 'openingDate', title: 'Ngày số dư đầu kỳ', aliases: ['ngaysodu', 'ngaysodudauky'], example: '31/12/2025' },
  { key: 'warrantyUntil', title: 'Bảo hành đến', aliases: ['baohanh', 'baohanhden', 'hanbaohanh'], example: '15/03/2027' },
  { key: 'invoiceNo', title: 'Số hoá đơn', aliases: ['sohoadon', 'hoadon'], example: '0001234' },
  { key: 'contractNo', title: 'Số hợp đồng', aliases: ['sohopdong', 'hopdong'], example: '12/2024/HĐ' },
  { key: 'registrationNo', title: 'Số lưu hành', aliases: ['soluuhanh', 'sodangky'], example: '' },
  { key: 'riskClass', title: 'Phân loại TBYT (A/B/C/D)', aliases: ['phanloai', 'loaitbyt', 'phanloaitbyt', 'phanloaitbytabcd'], example: 'C' },
  { key: 'lastCalibrationDate', title: 'Ngày kiểm định gần nhất', aliases: ['ngaykiemdinh', 'kiemdinh', 'ngaykiemdinhgannhat'], example: '' },
  { key: 'barcode', title: 'Mã vạch', aliases: ['mavach', 'barcode'], example: '' },
  { key: 'specifications', title: 'Thông số kỹ thuật', aliases: ['thongso', 'thongsokythuat', 'cauhinh'], example: '' },
  { key: 'note', title: 'Ghi chú', aliases: ['ghichu', 'note'], example: '' },
];
const ALIAS = new Map<string, string>();
for (const c of COLUMNS) for (const a of [c.title, ...c.aliases]) ALIAS.set(normalizeKey(a), c.key);

function validDate(y: string, m: string, d: string): string {
  const iso = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  const t = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(t.getTime()) || t.toISOString().slice(0, 10) !== iso) throw new Error(`ngày "${d}/${m}/${y}" không tồn tại`);
  return iso;
}
function parseDate(v: string): string | null {
  const s = v.trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return validDate(m[1], m[2], m[3]);
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m) return validDate(m[3], m[2], m[1]);
  m = s.match(/^(\d{4})$/);
  if (m) return `${m[1]}-01-01`;
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    // số seri ngày Excel
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(s)) * 86400000);
    return d.toISOString().slice(0, 10);
  }
  const d = new Date(s);
  if (!Number.isNaN(d.getTime()) && /[a-z]/i.test(s)) return d.toISOString().slice(0, 10);
  throw new Error(`ngày "${s}" không hợp lệ (dùng dd/mm/yyyy)`);
}
const parseMoney = (v: string) => {
  const s = v.trim().replace(/\s|đ|vnd/gi, '');
  if (!s) return 0;
  // 1.250.000.000 hoặc 1,250,000,000 hoặc 1250000000.5
  const norm = /^\d{1,3}([.,]\d{3})+$/.test(s) ? s.replace(/[.,]/g, '') : s.replace(/,/g, '.');
  const n = Number(norm);
  if (!Number.isFinite(n) || n < 0) throw new Error(`số tiền "${v}" không hợp lệ`);
  return n;
};

@Injectable()
export class AssetIoService {
  constructor(
    private readonly db: DbService,
    private readonly assetsService: AssetsService,
  ) {}

  async readUpload(req: Request): Promise<Buffer> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req as AsyncIterable<Buffer>) {
      size += chunk.length;
      if (size > MAX_BYTES) throw new BadRequestException('Tệp quá lớn (tối đa 15 MB)');
      chunks.push(chunk);
    }
    if (!size) throw new BadRequestException('Chưa chọn tệp hoặc tệp rỗng');
    return Buffer.concat(chunks);
  }

  private styleHeader(row: ExcelJS.Row) {
    row.font = { bold: true, color: { argb: 'FF0F172A' } };
    row.height = 30;
    row.eachCell((c) => {
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFCCFBF1' } };
      c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      c.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } };
    });
  }

  /* ------------------------------------------------------------ Xuất */
  async export(query: AssetListQuery, user: AccessContext) {
    const { items, summary } = await this.assetsService.list({ ...query, all: true }, user);
    const wb = new ExcelJS.Workbook();
    wb.creator = 'QLBS';
    const ws = wb.addWorksheet('Danh sách tài sản');
    ws.addRow(['DANH SÁCH TÀI SẢN']).font = { bold: true, size: 14 };
    ws.addRow([`Xuất lúc ${new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })} · ${items.length} tài sản`]).font = { italic: true, color: { argb: 'FF475569' } };
    ws.addRow([]);
    const cols: [string, number, (r: Record<string, unknown>) => unknown, string?][] = [
      ['STT', 6, () => ''],
      ['Mã tài sản', 18, (r) => r.code],
      ['Tên tài sản', 36, (r) => r.name],
      ['Loại', 24, (r) => r.categoryName ?? ''],
      ['Model', 16, (r) => r.model],
      ['Số serial', 16, (r) => r.serialNumber],
      ['Hãng SX', 18, (r) => r.manufacturerName ?? ''],
      ['Nước SX', 12, (r) => r.countryOfOrigin],
      ['Năm SX', 8, (r) => r.yearOfManufacture ?? ''],
      ['Nhà cung cấp', 22, (r) => r.supplierName ?? ''],
      ['ĐVT', 8, (r) => r.unit],
      ['Nguồn vốn', 18, (r) => r.fundingSourceName ?? ''],
      ['Ngày ghi tăng', 12, (r) => r.acquisitionDate ? new Date(String(r.acquisitionDate)) : '', 'dd/mm/yyyy'],
      ['Ngày sử dụng', 12, (r) => r.inUseDate ? new Date(String(r.inUseDate)) : '', 'dd/mm/yyyy'],
      ['Khoa/phòng', 24, (r) => r.departmentName ?? 'Kho'],
      ['Vị trí', 16, (r) => r.locationName ?? ''],
      ['Người giữ', 18, (r) => r.custodianName],
      ['Trạng thái', 14, (r) => ASSET_STATUS[String(r.status)]?.label ?? r.status],
      ['Tình trạng', 11, (r) => ASSET_CONDITION[String(r.condition)] ?? r.condition],
      ['Phương pháp', 22, (r) => METHOD_LABEL[String(r.depreciationMethod)] ?? r.depreciationMethod],
      ['Tỉ lệ %/năm', 9, (r) => Number(r.annualRate ?? 0), '0.###'],
      ['Nguyên giá', 16, (r) => Number(r.originalCost ?? 0), '#,##0'],
      ['Hao mòn luỹ kế', 16, (r) => Number(r.accumulatedDepreciation ?? 0), '#,##0'],
      ['Giá trị còn lại', 16, (r) => Number(r.bookValue ?? 0), '#,##0'],
      ['Kỳ KH gần nhất', 10, (r) => r.lastDepreciationPeriod],
      ['Bảo hành đến', 12, (r) => r.warrantyUntil ? new Date(String(r.warrantyUntil)) : '', 'dd/mm/yyyy'],
      ['Hạn kiểm định', 12, (r) => r.nextCalibrationDate ? new Date(String(r.nextCalibrationDate)) : '', 'dd/mm/yyyy'],
      ['Hạn bảo dưỡng', 12, (r) => r.nextMaintenanceDate ? new Date(String(r.nextMaintenanceDate)) : '', 'dd/mm/yyyy'],
    ];
    this.styleHeader(ws.addRow(cols.map((c) => c[0])));
    (items as Record<string, unknown>[]).forEach((r, i) => {
      const row = ws.addRow(cols.map((c, ci) => (ci === 0 ? i + 1 : c[2](r))));
      row.eachCell((cell) => (cell.border = { bottom: { style: 'hair', color: { argb: 'FFCBD5E1' } } }));
    });
    const tr = ws.addRow(cols.map((c) => (c[0] === 'Tên tài sản' ? 'TỔNG CỘNG' : c[0] === 'Nguyên giá' ? summary.cost : c[0] === 'Hao mòn luỹ kế' ? summary.accumulated : c[0] === 'Giá trị còn lại' ? summary.bookValue : '')));
    tr.font = { bold: true };
    cols.forEach((c, i) => {
      const col = ws.getColumn(i + 1);
      col.width = c[1];
      if (c[3]) col.numFmt = c[3];
    });
    ws.views = [{ state: 'frozen', ySplit: 4, xSplit: 3 }];
    ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4 + items.length, column: cols.length } };
    return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), fileName: `danh-sach-tai-san-${new Date().toISOString().slice(0, 10)}.xlsx` };
  }

  /* ------------------------------------------------------------ Tệp mẫu */
  async template() {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Tài sản');
    this.styleHeader(ws.addRow(COLUMNS.map((c) => (c.required ? `${c.title} *` : c.title))));
    ws.addRow(COLUMNS.map((c) => c.example));
    COLUMNS.forEach((c, i) => (ws.getColumn(i + 1).width = Math.max(14, c.title.length + 4)));
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    const [cats, funds, depts] = await Promise.all([
      this.db.db.select({ code: assetCategories.code, name: assetCategories.name }).from(assetCategories).where(eq(assetCategories.active, true)).orderBy(assetCategories.path),
      this.db.db.select({ code: assetFundingSources.code, name: assetFundingSources.name }).from(assetFundingSources).where(eq(assetFundingSources.active, true)),
      this.db.db.select({ code: departments.code, name: departments.name }).from(departments).where(isNull(departments.deletedAt)),
    ]);
    const guide = wb.addWorksheet('Hướng dẫn');
    guide.addRow(['HƯỚNG DẪN NHẬP TÀI SẢN']).font = { bold: true, size: 13 };
    for (const line of [
      '• Dòng 1 là tiêu đề — giữ nguyên tên cột (thứ tự cột tuỳ ý, có thể bỏ bớt cột không dùng). Dòng 2 là ví dụ — xoá trước khi nhập.',
      '• Chỉ "Tên tài sản" là bắt buộc. Mã tài sản bỏ trống → tự sinh theo tiền tố của loại (vd TBYT.2024.0001).',
      '• Loại / Khoa / Nguồn vốn / Nhà cung cấp / Vị trí: nhập MÃ hoặc TÊN đúng như danh mục (xem bảng bên dưới). Hãng/NCC chưa có sẽ tự thêm.',
      '• Ngày: dd/mm/yyyy. Số tiền: 1250000000 hoặc 1.250.000.000.',
      '• Tài sản đang dùng trước khi triển khai: nhập "Hao mòn luỹ kế đầu kỳ" + "Ngày số dư đầu kỳ" (vd 31/12/2025) — hệ thống tính tiếp từ kỳ sau.',
      '• Trạng thái: Trong kho | Đang sử dụng | Hỏng | Chờ thanh lý … (bỏ trống: có khoa → Đang sử dụng, không → Trong kho).',
    ]) guide.addRow([line]);
    guide.addRow([]);
    guide.addRow(['LOẠI TÀI SẢN', '', 'NGUỒN VỐN', '', 'KHOA/PHÒNG']).font = { bold: true };
    guide.addRow(['Mã', 'Tên', 'Mã', 'Tên', 'Mã', 'Tên']).font = { bold: true };
    const n = Math.max(cats.length, funds.length, depts.length);
    for (let i = 0; i < n; i++) guide.addRow([cats[i]?.code ?? '', cats[i]?.name ?? '', funds[i]?.code ?? '', funds[i]?.name ?? '', depts[i]?.code ?? '', depts[i]?.name ?? '']);
    guide.getColumn(1).width = 16;
    guide.getColumn(2).width = 40;
    guide.getColumn(3).width = 12;
    guide.getColumn(4).width = 34;
    guide.getColumn(5).width = 12;
    guide.getColumn(6).width = 36;
    return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), fileName: 'mau-nhap-tai-san.xlsx' };
  }

  /* ------------------------------------------------------------ Nhập */
  async import(buf: Buffer, fileName: string, opts: { dryRun: boolean; updateExisting: boolean }, user: AccessContext) {
    const grid = await readTabularGrid(buf, fileName || 'tai-san.xlsx');
    let headerIdx = -1;
    let map: (string | null)[] = [];
    for (let i = 0; i < Math.min(grid.length, 15); i++) {
      const m = (grid[i] ?? []).map((h) => ALIAS.get(normalizeKey(String(h).replace(/\*/g, '').normalize('NFC'))) ?? null);
      if (m.includes('name') && m.filter(Boolean).length >= 2) {
        headerIdx = i;
        map = m;
        break;
      }
    }
    if (headerIdx < 0) throw new BadRequestException('Không tìm thấy dòng tiêu đề — tệp cần có cột "Tên tài sản" và ít nhất một cột khác. Hãy tải tệp mẫu.');
    const body = grid.slice(headerIdx + 1).map((cells, i) => ({ line: headerIdx + i + 2, cells })).filter((r) => r.cells.some((c) => String(c ?? '').trim()));
    if (!body.length) throw new BadRequestException('Tệp không có dòng dữ liệu');
    if (body.length > 5000) throw new BadRequestException('Tối đa 5000 dòng mỗi lần nhập');

    // Danh mục để khớp theo mã hoặc tên (không phân biệt hoa thường, dấu)
    const [cats, locs, sups, funds, depts, people] = await Promise.all([
      this.db.db.select().from(assetCategories),
      this.db.db.select().from(assetLocations),
      this.db.db.select().from(assetSuppliers),
      this.db.db.select().from(assetFundingSources),
      this.db.db.select({ id: departments.id, code: departments.code, name: departments.name, shortName: departments.shortName }).from(departments).where(isNull(departments.deletedAt)),
      this.db.db.select({ id: users.id, fullName: users.fullName, username: users.username }).from(users).where(isNull(users.deletedAt)),
    ]);
    const idx = <T extends { id: number }>(list: T[], keys: (t: T) => (string | null | undefined)[]) => {
      const m = new Map<string, T>();
      for (const t of list) for (const k of keys(t)) if (k) m.set(normalizeKey(k), t);
      return (v: string) => (v ? m.get(normalizeKey(v)) : undefined);
    };
    const findCat = idx(cats, (c) => [c.code, c.name]);
    const findLoc = idx(locs, (c) => [c.code, c.name]);
    const findSup = idx(sups, (c) => [c.code, c.name]);
    const findFund = idx(funds, (c) => [c.code, c.name]);
    const findDept = idx(depts, (c) => [c.code, c.name, c.shortName]);
    const findUser = idx(people, (c) => [c.username, c.fullName]);
    const statusByLabel = new Map(Object.entries(ASSET_STATUS).flatMap(([k, v]) => [[normalizeKey(k), k], [normalizeKey(v.label), k]]));
    const condByLabel = new Map(Object.entries(ASSET_CONDITION).flatMap(([k, v]) => [[normalizeKey(k), k], [normalizeKey(v), k]]));
    const existingCodes = new Map(
      (await this.db.db.select({ id: assets.id, code: assets.code }).from(assets).where(isNull(assets.deletedAt))).map((a) => [a.code.toLowerCase(), a.id]),
    );
    const newSuppliers = new Map<string, string>(); // tên → vai trò

    const results: { line: number; code: string; name: string; action: 'create' | 'update' | 'error'; errors: string[]; data?: Record<string, unknown> }[] = [];
    const seenCodes = new Set<string>();
    for (const r of body) {
      const raw: Record<string, string> = {};
      map.forEach((k, ci) => k && (raw[k] = String(r.cells[ci] ?? '').trim()));
      const errors: string[] = [];
      const d: Record<string, unknown> = {};
      const set = (k: string, fn: () => unknown) => {
        try {
          const v = fn();
          if (v !== undefined) d[k] = v;
        } catch (e) {
          errors.push(`${COLUMNS.find((c) => c.key === k)?.title ?? k}: ${(e as Error).message}`);
        }
      };
      if (!raw.name) errors.push('Thiếu tên tài sản');
      d.name = raw.name;
      if (raw.code) {
        d.code = raw.code.toUpperCase();
        const lc = raw.code.toLowerCase();
        if (seenCodes.has(lc)) errors.push(`Mã ${raw.code} bị trùng trong tệp`);
        seenCodes.add(lc);
      }
      for (const k of ['model', 'serialNumber', 'countryOfOrigin', 'unit', 'invoiceNo', 'contractNo', 'registrationNo', 'barcode', 'specifications', 'note', 'riskClass']) if (raw[k]) d[k] = raw[k];
      if (raw.riskClass && !/^[ABCD]$/i.test(raw.riskClass)) errors.push('Phân loại TBYT phải là A, B, C hoặc D');
      if (raw.riskClass) d.riskClass = raw.riskClass.toUpperCase();
      if (raw.yearOfManufacture) set('yearOfManufacture', () => {
        const y = Number(raw.yearOfManufacture);
        if (!(y > 1900 && y < 2100)) throw new Error('năm không hợp lệ');
        return y;
      });
      for (const k of ['acquisitionDate', 'inUseDate', 'openingDate', 'warrantyUntil', 'lastCalibrationDate']) if (raw[k]) set(k, () => parseDate(raw[k]));
      for (const k of ['originalCost', 'openingAccumulated']) if (raw[k]) set(k, () => parseMoney(raw[k]));
      if (raw.usefulLifeMonths) set('usefulLifeMonths', () => Math.max(1, Math.trunc(Number(raw.usefulLifeMonths)) || 0) || undefined);
      if (raw.annualRate) set('annualRate', () => {
        const n = Number(raw.annualRate.replace('%', '').replace(',', '.'));
        if (!(n >= 0 && n <= 100)) throw new Error('phải từ 0 đến 100');
        return n;
      });
      if (raw.category) {
        const c = findCat(raw.category);
        if (c) d.categoryId = c.id;
        else errors.push(`Loại "${raw.category}" không có trong danh mục`);
      }
      if (raw.location) {
        const c = findLoc(raw.location);
        if (c) d.locationId = c.id;
        else errors.push(`Vị trí "${raw.location}" không có trong danh mục`);
      }
      if (raw.fundingSource) {
        const c = findFund(raw.fundingSource);
        if (c) d.fundingSourceId = c.id;
        else errors.push(`Nguồn vốn "${raw.fundingSource}" không có trong danh mục`);
      }
      if (raw.department) {
        const c = findDept(raw.department);
        if (c) d.departmentId = c.id;
        else errors.push(`Khoa/phòng "${raw.department}" không có trong hệ thống`);
      }
      for (const [k, role] of [['manufacturer', 'HSX'], ['supplier', 'NCC']] as const) {
        if (!raw[k]) continue;
        const c = findSup(raw[k]);
        if (c) d[`${k}Id`] = c.id;
        else {
          newSuppliers.set(raw[k], role);
          d[`_${k}`] = raw[k];
        }
      }
      if (raw.custodian) {
        const u = findUser(raw.custodian);
        if (u) d.custodianId = u.id;
        d.custodianName = u?.fullName ?? raw.custodian;
      }
      if (raw.status) {
        const s = statusByLabel.get(normalizeKey(raw.status));
        if (s) d.status = s;
        else errors.push(`Trạng thái "${raw.status}" không hợp lệ`);
      }
      if (raw.condition) {
        const s = condByLabel.get(normalizeKey(raw.condition));
        if (s) d.condition = s;
        else errors.push(`Tình trạng "${raw.condition}" không hợp lệ`);
      }
      if (Number(d.openingAccumulated ?? 0) > Number(d.originalCost ?? 0)) errors.push('Hao mòn luỹ kế lớn hơn nguyên giá');
      if (!this.assetsService.canSeeAll(user) && (!d.departmentId || !this.assetsService.scopeDeptIds(user).includes(Number(d.departmentId)))) {
        errors.push('Khoa/phòng ngoài phạm vi của bạn');
      }
      const existingId = d.code ? existingCodes.get(String(d.code).toLowerCase()) : undefined;
      let action: 'create' | 'update' | 'error' = existingId ? 'update' : 'create';
      if (existingId && !opts.updateExisting) errors.push(`Mã ${d.code} đã tồn tại (bật "Cập nhật tài sản đã có" để ghi đè)`);
      if (errors.length) action = 'error';
      results.push({ line: r.line, code: String(d.code ?? ''), name: raw.name ?? '', action, errors, data: { ...d, _id: existingId } });
    }

    const summary = {
      total: results.length,
      create: results.filter((r) => r.action === 'create').length,
      update: results.filter((r) => r.action === 'update').length,
      error: results.filter((r) => r.action === 'error').length,
      newSuppliers: [...newSuppliers.keys()],
      columns: map.filter(Boolean),
    };
    if (opts.dryRun || summary.error > 0) {
      return { dryRun: true, blocked: !opts.dryRun && summary.error > 0, summary, rows: results.map(({ data: _d, ...r }) => r) };
    }

    // Ghi thật: thêm hãng/NCC mới → tạo/cập nhật từng dòng
    const supIds = new Map<string, number>();
    for (const [name, role] of newSuppliers) {
      const code = normalizeKey(name).toUpperCase().slice(0, 20) || `NCC${Date.now()}`;
      const [dup] = await this.db.db.select({ id: assetSuppliers.id }).from(assetSuppliers).where(sql`lower(${assetSuppliers.code}) = lower(${code})`);
      const id = dup?.id ?? (await this.db.db.insert(assetSuppliers).values({ code, name, roles: [role] }).returning({ id: assetSuppliers.id }))[0].id;
      supIds.set(name, id);
    }
    let created = 0;
    let updated = 0;
    const failures: { line: number; error: string }[] = [];
    for (const r of results) {
      const d = { ...r.data! };
      const id = d._id as number | undefined;
      for (const k of ['manufacturer', 'supplier']) if (d[`_${k}`]) d[`${k}Id`] = supIds.get(String(d[`_${k}`]));
      for (const k of Object.keys(d)) if (k.startsWith('_')) delete d[k];
      try {
        if (id) {
          await this.assetsService.update(id, d, user);
          updated++;
        } else {
          await this.assetsService.create(d, user);
          created++;
        }
      } catch (e) {
        failures.push({ line: r.line, error: (e as Error).message });
      }
    }
    return { dryRun: false, summary: { ...summary, created, updated, failed: failures.length }, failures };
  }
}
