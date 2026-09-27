/** Mẫu biên bản kiểm kê tài sản mặc định (A4 ngang, Times New Roman) — sửa được trong Trình thiết kế bản in */
import type { ElementStyle, PrintDocument, PrintElement } from '../../db/schema';

export const INVENTORY_TEMPLATE_CODE = 'BIEN_BAN_KIEM_KE';

export function defaultInventoryDocument(): PrintDocument {
  const base: ElementStyle = { fontFamily: 'Times New Roman', color: '#000000', fontSize: 12 };
  const el = (e: Partial<PrintElement> & Pick<PrintElement, 'id' | 'type' | 'x' | 'y' | 'w' | 'h'>): PrintElement => e as PrintElement;
  const txt = (id: string, x: number, y: number, w: number, h: number, text: string, style: ElementStyle = {}) =>
    el({ id, type: 'text', x, y, w, h, text, style: { ...base, ...style } });
  const L = 15;
  const W = 267;
  const sigW = W / 4;
  const sigY = 150;
  const sig = (i: number, key: string, title: string) => [
    txt(`sig-${key}-t`, L + i * sigW, sigY, sigW, 5, title, { bold: true, align: 'center', fontSize: 11 }),
    txt(`sig-${key}-s`, L + i * sigW, sigY + 5, sigW, 4.5, '(Ký, ghi rõ họ tên)', { italic: true, align: 'center', fontSize: 10 }),
    txt(`sig-${key}-n`, L + i * sigW, sigY + 28, sigW, 5, key ? `{${key}}` : '', { bold: true, align: 'center', fontSize: 11 }),
  ];
  const col = (id: string, title: string, width: number, path: string, align: 'left' | 'center' | 'right' = 'left') => ({ id, title, width, align, binding: { source: 'row', path } });
  return {
    paperSize: 'A4',
    orientation: 'landscape',
    margins: { top: 10, right: 15, bottom: 12, left: 15 },
    grid: { size: 1, show: true, snap: true },
    defaultStyle: base,
    pages: [
      {
        id: 'page-1',
        name: 'Biên bản kiểm kê',
        elements: [
          txt('org-parent', L, 10, 100, 5, '{parentOrgName}', { align: 'center', fontSize: 11, textTransform: 'uppercase', autoShrink: true }),
          txt('org', L, 15, 100, 5, '{hospitalName}', { bold: true, align: 'center', fontSize: 11, textTransform: 'uppercase', autoShrink: true }),
          txt('code', L, 21, 100, 5, 'Số: {code}', { align: 'center', fontSize: 11 }),
          txt('nation', 162, 10, 120, 5, 'CỘNG HOÀ XÃ HỘI CHỦ NGHĨA VIỆT NAM', { bold: true, align: 'center', fontSize: 11 }),
          txt('motto', 162, 15, 120, 5, 'Độc lập - Tự do - Hạnh phúc', { bold: true, align: 'center', fontSize: 12 }),
          el({ id: 'motto-line', type: 'line', x: 199.5, y: 20.6, w: 45, h: 0, style: { border: { top: { width: 0.3, style: 'solid', color: '#000000' } } } }),
          txt('date', 162, 22, 120, 5, '{placeDateText}', { italic: true, align: 'center', fontSize: 12 }),
          txt('title', L, 30, W, 8, '{title}', { bold: true, align: 'center', fontSize: 15 }),
          txt('name', L, 38, W, 6, '{inventoryName}', { italic: true, align: 'center', fontSize: 12 }),
          txt('snap', L, 46, W, 6, '{snapshotText}'),
          txt('decision', L, 52, W, 6, 'Căn cứ: {decisionText}', { wrap: true, autoShrink: true }),
          txt('scope', L, 58, W, 6, 'Phạm vi kiểm kê: {scopeText}', { wrap: true, autoShrink: true }),
          txt('committee-t', L, 64, W, 6, 'Hội đồng / Ban kiểm kê gồm:', { bold: true }),
          txt('committee', L + 5, 70, W - 5, 16, '{committeeText}', { wrap: true, autoShrink: true, lineHeight: 1.25 }),
          txt('summary-t', L, 87, W, 6, 'Kết quả kiểm kê:', { bold: true }),
          txt('summary', L + 5, 93, W - 5, 11, '{summaryText}', { wrap: true, autoShrink: true, lineHeight: 1.25 }),
          txt('detail-t', L, 105, W, 6, '{detailNote}', { italic: true }),
          el({
            id: 'items',
            type: 'table',
            x: L,
            y: 111,
            w: W,
            h: 12,
            style: { ...base, fontSize: 9.5 },
            table: {
              dataSource: 'items',
              repeatHeader: true,
              columns: [
                col('stt', 'STT', 9, 'stt', 'center'),
                col('code', 'Mã tài sản', 27, 'code'),
                col('name', 'Tên tài sản', 50, 'nameText'),
                col('place', 'Nơi sử dụng (sổ sách)', 36, 'placeText'),
                col('bq', 'Sổ sách SL', 11, 'bookQty', 'center'),
                col('bc', 'Sổ sách nguyên giá', 23, 'bookCost', 'right'),
                col('rq', 'Kiểm kê SL', 11, 'realQty', 'center'),
                col('rc', 'Kiểm kê nguyên giá', 23, 'realCost', 'right'),
                col('dq', 'Chênh lệch SL', 12, 'diffQty', 'center'),
                col('dc', 'Chênh lệch nguyên giá', 23, 'diffCost', 'right'),
                col('res', 'Kết quả / ghi chú', 42, 'resultText'),
              ],
            },
          } as PrintElement),
          txt('conclusion-t', L, 127, W, 6, 'Kết luận và kiến nghị của Hội đồng kiểm kê:', { bold: true }),
          txt('conclusion', L + 5, 133, W - 5, 14, '{conclusion}', { wrap: true, autoShrink: true, lineHeight: 1.25 }),
          ...sig(0, 'creatorName', 'NGƯỜI LẬP'),
          ...sig(1, '', 'KẾ TOÁN'),
          ...sig(2, 'chairName', 'TRƯỞNG BAN KIỂM KÊ'),
          ...sig(3, 'approverName', 'THỦ TRƯỞNG ĐƠN VỊ'),
        ],
      },
    ],
    variables: [
      { key: 'hospitalName', label: 'Tên đơn vị', type: 'text', group: 'Đơn vị' },
      { key: 'parentOrgName', label: 'Cơ quan cấp trên', type: 'text', group: 'Đơn vị' },
      { key: 'code', label: 'Mã đợt kiểm kê', type: 'text', group: 'Kiểm kê' },
      { key: 'title', label: 'Tiêu đề', type: 'text', group: 'Kiểm kê' },
      { key: 'inventoryName', label: 'Tên đợt kiểm kê', type: 'text', group: 'Kiểm kê' },
      { key: 'placeDateText', label: 'Địa danh, ngày … tháng … năm …', type: 'text', group: 'Kiểm kê' },
      { key: 'snapshotText', label: 'Thời điểm kiểm kê', type: 'text', group: 'Kiểm kê' },
      { key: 'decisionText', label: 'Căn cứ (quyết định)', type: 'text', group: 'Kiểm kê' },
      { key: 'scopeText', label: 'Phạm vi', type: 'text', group: 'Kiểm kê' },
      { key: 'committeeText', label: 'Thành phần hội đồng', type: 'text', group: 'Kiểm kê' },
      { key: 'summaryText', label: 'Tóm tắt kết quả', type: 'text', group: 'Kiểm kê' },
      { key: 'detailNote', label: 'Tiêu đề bảng chi tiết', type: 'text', group: 'Kiểm kê' },
      { key: 'conclusion', label: 'Kết luận, kiến nghị', type: 'text', group: 'Kiểm kê' },
      { key: 'creatorName', label: 'Người lập', type: 'text', group: 'Ký tên' },
      { key: 'chairName', label: 'Trưởng ban kiểm kê', type: 'text', group: 'Ký tên' },
      { key: 'approverName', label: 'Thủ trưởng / người duyệt', type: 'text', group: 'Ký tên' },
    ],
  } as PrintDocument;
}
