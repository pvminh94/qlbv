/** Mẫu biên bản chứng từ tài sản mặc định (A4 dọc, Times New Roman) — dùng chung cho mọi loại nghiệp vụ */
import type { ElementStyle, PrintDocument, PrintElement } from '../../db/schema';

export const VOUCHER_TEMPLATE_CODE = 'BIEN_BAN_TAI_SAN';

/** Tiêu đề biên bản theo loại chứng từ */
export const VOUCHER_TITLE: Record<string, string> = {
  GHI_TANG: 'BIÊN BẢN GIAO NHẬN TÀI SẢN (GHI TĂNG)',
  CAP_PHAT: 'BIÊN BẢN BÀN GIAO TÀI SẢN',
  DIEU_CHUYEN: 'BIÊN BẢN ĐIỀU CHUYỂN TÀI SẢN',
  THU_HOI: 'BIÊN BẢN THU HỒI TÀI SẢN',
  BAO_HONG: 'BIÊN BẢN XÁC NHẬN TÀI SẢN HỎNG',
  SUA_CHUA: 'BIÊN BẢN GIAO TÀI SẢN ĐI SỬA CHỮA',
  HOAN_THANH_SUA: 'BIÊN BẢN NGHIỆM THU SỬA CHỮA TÀI SẢN',
  BAO_DUONG: 'BIÊN BẢN BẢO DƯỠNG TÀI SẢN',
  KIEM_DINH: 'BIÊN BẢN KIỂM ĐỊNH / HIỆU CHUẨN THIẾT BỊ',
  DANH_GIA_LAI: 'BIÊN BẢN ĐÁNH GIÁ LẠI TÀI SẢN',
  DE_NGHI_THANH_LY: 'BIÊN BẢN ĐỀ NGHỊ THANH LÝ TÀI SẢN',
  THANH_LY: 'BIÊN BẢN THANH LÝ TÀI SẢN',
  BAO_MAT: 'BIÊN BẢN XÁC NHẬN MẤT TÀI SẢN',
};

export function defaultAssetVoucherDocument(): PrintDocument {
  const base: ElementStyle = { fontFamily: 'Times New Roman', color: '#000000', fontSize: 12 };
  const el = (e: Partial<PrintElement> & Pick<PrintElement, 'id' | 'type' | 'x' | 'y' | 'w' | 'h'>): PrintElement => e as PrintElement;
  const txt = (id: string, x: number, y: number, w: number, h: number, text: string, style: ElementStyle = {}) =>
    el({ id, type: 'text', x, y, w, h, text, style: { ...base, ...style } });
  const L = 20;
  const W = 175;
  const sigW = W / 4;
  const sig = (i: number, key: string, title: string) => [
    txt(`sig-${key}-t`, L + i * sigW, 0, sigW, 5, title, { bold: true, align: 'center', fontSize: 11 }),
    txt(`sig-${key}-s`, L + i * sigW, 5, sigW, 4.5, '(Ký, ghi rõ họ tên)', { italic: true, align: 'center', fontSize: 10 }),
    txt(`sig-${key}-n`, L + i * sigW, 28, sigW, 5, `{${key}}`, { bold: true, align: 'center', fontSize: 11 }),
  ];
  const sigY = 124;
  const signatures = [...sig(0, 'delivererName', 'NGƯỜI GIAO'), ...sig(1, 'receiverName', 'NGƯỜI NHẬN'), ...sig(2, 'creatorName', 'NGƯỜI LẬP'), ...sig(3, 'approverName', 'THỦ TRƯỞNG ĐƠN VỊ')].map((e) => ({
    ...e,
    y: e.y + sigY,
  }));
  return {
    paperSize: 'A4',
    orientation: 'portrait',
    margins: { top: 12, right: 15, bottom: 15, left: 20 },
    grid: { size: 1, show: true, snap: true },
    defaultStyle: base,
    pages: [
      {
        id: 'page-1',
        name: 'Biên bản',
        elements: [
          txt('org-parent', L, 12, 80, 5, '{parentOrgName}', { align: 'center', fontSize: 11, textTransform: 'uppercase', autoShrink: true }),
          txt('org', L, 17, 80, 5, '{hospitalName}', { bold: true, align: 'center', fontSize: 11, textTransform: 'uppercase', autoShrink: true }),
          txt('code', L, 23, 80, 5, 'Số: {code}', { align: 'center', fontSize: 11 }),
          txt('nation', 100, 12, 95, 5, 'CỘNG HOÀ XÃ HỘI CHỦ NGHĨA VIỆT NAM', { bold: true, align: 'center', fontSize: 11 }),
          txt('motto', 100, 17, 95, 5, 'Độc lập - Tự do - Hạnh phúc', { bold: true, align: 'center', fontSize: 12 }),
          el({ id: 'motto-line', type: 'line', x: 125, y: 22.6, w: 45, h: 0, style: { border: { top: { width: 0.3, style: 'solid', color: '#000000' } } } }),
          txt('date', 100, 24, 95, 5, '{placeDateText}', { italic: true, align: 'center', fontSize: 12 }),
          txt('title', L, 34, W, 8, '{title}', { bold: true, align: 'center', fontSize: 14 }),
          txt('decision', L, 44, W, 6, 'Căn cứ: {decisionText}', { wrap: true, autoShrink: true }),
          txt('from', L, 50, W, 6, 'Bên giao: {fromText}', { wrap: true, autoShrink: true }),
          txt('to', L, 56, W, 6, 'Bên nhận: {toText}', { wrap: true, autoShrink: true }),
          txt('reason', L, 62, W, 11, 'Nội dung: {reason}', { wrap: true, autoShrink: true, lineHeight: 1.25 }),
          el({
            id: 'items',
            type: 'table',
            x: L,
            y: 75,
            w: W,
            h: 12,
            style: { ...base, fontSize: 9.5 },
            table: {
              dataSource: 'items',
              repeatHeader: true,
              showIndex: true,
              columns: [
                { id: 'code', title: 'Mã tài sản', width: 29, binding: { source: 'row', path: 'code' } },
                { id: 'name', title: 'Tên tài sản, quy cách', width: 43, binding: { source: 'row', path: 'nameText' } },
                { id: 'unit', title: 'ĐVT', width: 10, align: 'center', binding: { source: 'row', path: 'unit' } },
                { id: 'cost', title: 'Nguyên giá (đ)', width: 26, align: 'right', binding: { source: 'row', path: 'originalCost', format: { type: 'number', decimals: 0 } } },
                { id: 'book', title: 'Giá trị còn lại (đ)', width: 26, align: 'right', binding: { source: 'row', path: 'bookValue', format: { type: 'number', decimals: 0 } } },
                { id: 'amount', title: 'Số tiền (đ)', width: 23, align: 'right', binding: { source: 'row', path: 'amountText' } },
                { id: 'cond', title: 'Tình trạng / ghi chú', width: 21, binding: { source: 'row', path: 'conditionText' } },
              ],
            },
          } as PrintElement),
          txt('total', L, 90, W, 6, 'Tổng cộng: {itemCount} tài sản; tổng nguyên giá {totalCostText} đồng{amountTotalText}.', { italic: true, wrap: true }),
          txt('closing', L, 97, W, 12, 'Biên bản được lập thành 02 bản có giá trị pháp lý như nhau, mỗi bên giữ 01 bản. Các bên đã kiểm tra, thống nhất nội dung trên và cùng ký tên.', { wrap: true, lineHeight: 1.25 }),
          txt('approved', L, 110, W, 6, '{approvalText}', { italic: true, fontSize: 10, color: '#334155' }),
          ...signatures,
        ],
      },
    ],
    variables: [
      { key: 'hospitalName', label: 'Tên đơn vị', type: 'text', group: 'Đơn vị' },
      { key: 'parentOrgName', label: 'Cơ quan cấp trên', type: 'text', group: 'Đơn vị' },
      { key: 'code', label: 'Số chứng từ', type: 'text', group: 'Chứng từ' },
      { key: 'title', label: 'Tiêu đề biên bản', type: 'text', group: 'Chứng từ' },
      { key: 'typeLabel', label: 'Loại nghiệp vụ', type: 'text', group: 'Chứng từ' },
      { key: 'placeDateText', label: 'Địa danh, ngày … tháng … năm …', type: 'text', group: 'Chứng từ' },
      { key: 'decisionText', label: 'Căn cứ (số quyết định)', type: 'text', group: 'Chứng từ' },
      { key: 'fromText', label: 'Bên giao', type: 'text', group: 'Chứng từ' },
      { key: 'toText', label: 'Bên nhận', type: 'text', group: 'Chứng từ' },
      { key: 'reason', label: 'Lý do / nội dung', type: 'text', group: 'Chứng từ' },
      { key: 'itemCount', label: 'Số tài sản', type: 'number', group: 'Chứng từ' },
      { key: 'totalCostText', label: 'Tổng nguyên giá', type: 'text', group: 'Chứng từ' },
      { key: 'amountTotalText', label: 'Tổng số tiền (kèm nhãn)', type: 'text', group: 'Chứng từ' },
      { key: 'approvalText', label: 'Thông tin duyệt', type: 'text', group: 'Chứng từ' },
      { key: 'delivererName', label: 'Người giao', type: 'text', group: 'Ký tên' },
      { key: 'receiverName', label: 'Người nhận', type: 'text', group: 'Ký tên' },
      { key: 'creatorName', label: 'Người lập', type: 'text', group: 'Ký tên' },
      { key: 'approverName', label: 'Người duyệt', type: 'text', group: 'Ký tên' },
    ],
  } as PrintDocument;
}
