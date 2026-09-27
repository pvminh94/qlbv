/** Mẫu tem tài sản mặc định (không phụ thuộc Nest — dùng được trong script seed) */
import type { PrintDocument, PrintElement } from '../../db/schema';

export const LABEL_TEMPLATE_CODE = 'TEM_TAI_SAN';

/** Mẫu tem mặc định 50 × 30 mm: tên đơn vị · QR · mã · tên · khoa · năm sử dụng */
export function defaultAssetLabelDocument(): PrintDocument {
  const base = { fontFamily: 'Times New Roman', color: '#000000' };
  const el = (e: Partial<PrintElement> & Pick<PrintElement, 'id' | 'type' | 'x' | 'y' | 'w' | 'h'>): PrintElement => e as PrintElement;
  return {
    paperSize: 'Custom',
    orientation: 'portrait',
    customSize: { width: 50, height: 30 },
    margins: { top: 0, right: 0, bottom: 0, left: 0 },
    grid: { size: 0.5, show: true, snap: true },
    defaultStyle: { ...base, fontSize: 7 },
    pages: [
      {
        id: 'page-1',
        name: 'Tem',
        elements: [
      el({ id: 'frame', type: 'rect', x: 0.6, y: 0.6, w: 48.8, h: 28.8, style: { border: { top: { width: 0.25, style: 'solid', color: '#000000' }, right: { width: 0.25, style: 'solid', color: '#000000' }, bottom: { width: 0.25, style: 'solid', color: '#000000' }, left: { width: 0.25, style: 'solid', color: '#000000' } }, borderRadius: 1 } }),
      el({ id: 'org', type: 'text', x: 1.5, y: 1.3, w: 47, h: 3.6, text: '{hospitalName}', style: { ...base, fontSize: 6, bold: true, align: 'center', textTransform: 'uppercase', autoShrink: true } }),
      el({ id: 'sep', type: 'line', x: 1.5, y: 5.1, w: 47, h: 0, style: { color: '#000000', border: { top: { width: 0.2, style: 'solid', color: '#000000' } } } }),
      el({ id: 'qr', type: 'qrcode', x: 1.6, y: 6, w: 17, h: 17, binding: { source: 'field', path: 'qrUrl' }, meta: { ecLevel: 'M' } }),
      el({ id: 'code', type: 'field', x: 19.5, y: 5.8, w: 29, h: 4.4, text: '{code}', binding: { source: 'field', path: 'code' }, style: { ...base, fontSize: 8.5, bold: true, autoShrink: true } }),
      el({ id: 'name', type: 'text', x: 19.5, y: 10.4, w: 29, h: 7.6, text: '{name}', style: { ...base, fontSize: 6.8, wrap: true, autoShrink: true, lineHeight: 1.1 } }),
      el({ id: 'dept', type: 'text', x: 19.5, y: 18.2, w: 29, h: 3.2, text: '{departmentName}', style: { ...base, fontSize: 5.6, italic: true, autoShrink: true } }),
      el({ id: 'meta', type: 'text', x: 19.5, y: 21.3, w: 29, h: 3, text: 'Năm SD: {inUseYear}  {serialText}', style: { ...base, fontSize: 5.2, autoShrink: true } }),
      el({ id: 'bar', type: 'barcode', x: 1.6, y: 23.6, w: 46.8, h: 5.2, binding: { source: 'field', path: 'barcode' }, meta: { showText: false } }),
    ],
      },
    ],
    variables: [
      { key: 'code', label: 'Mã tài sản', type: 'text', group: 'Tài sản' },
      { key: 'barcode', label: 'Mã vạch (mặc định = mã tài sản)', type: 'text', group: 'Tài sản' },
      { key: 'qrUrl', label: 'Đường dẫn QR tra cứu', type: 'text', group: 'Tài sản' },
      { key: 'name', label: 'Tên tài sản', type: 'text', group: 'Tài sản' },
      { key: 'model', label: 'Model', type: 'text', group: 'Tài sản' },
      { key: 'serialNumber', label: 'Số serial', type: 'text', group: 'Tài sản' },
      { key: 'serialText', label: 'Serial (kèm tiền tố S/N)', type: 'text', group: 'Tài sản' },
      { key: 'categoryName', label: 'Loại tài sản', type: 'text', group: 'Tài sản' },
      { key: 'departmentName', label: 'Khoa/phòng sử dụng', type: 'text', group: 'Tài sản' },
      { key: 'locationName', label: 'Vị trí', type: 'text', group: 'Tài sản' },
      { key: 'custodianName', label: 'Người giữ', type: 'text', group: 'Tài sản' },
      { key: 'acquisitionDate', label: 'Ngày ghi tăng', type: 'date', group: 'Tài sản' },
      { key: 'inUseYear', label: 'Năm đưa vào sử dụng', type: 'text', group: 'Tài sản' },
      { key: 'originalCostText', label: 'Nguyên giá (đã định dạng)', type: 'text', group: 'Tài sản' },
      { key: 'fundingSourceName', label: 'Nguồn vốn', type: 'text', group: 'Tài sản' },
      { key: 'nextCalibrationDate', label: 'Hạn kiểm định', type: 'date', group: 'Tài sản' },
      { key: 'hospitalName', label: 'Tên đơn vị', type: 'text', group: 'Đơn vị' },
    ],
  } as PrintDocument;
}

