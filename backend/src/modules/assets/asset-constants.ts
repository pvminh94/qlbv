/** Hằng số nghiệp vụ phân hệ Quản lý tài sản (dùng chung backend; frontend có bản sao trong lib/assets.ts) */

export const ASSET_STATUS: Record<string, { label: string; color: string }> = {
  TRONG_KHO: { label: 'Trong kho', color: '#64748b' },
  DANG_SU_DUNG: { label: 'Đang sử dụng', color: '#16a34a' },
  DANG_SUA_CHUA: { label: 'Đang sửa chữa', color: '#d97706' },
  HONG: { label: 'Hỏng', color: '#dc2626' },
  CHO_THANH_LY: { label: 'Chờ thanh lý', color: '#9333ea' },
  DA_THANH_LY: { label: 'Đã thanh lý', color: '#334155' },
  MAT: { label: 'Mất', color: '#991b1b' },
};
export const ACTIVE_STATUSES = ['TRONG_KHO', 'DANG_SU_DUNG', 'DANG_SUA_CHUA', 'HONG', 'CHO_THANH_LY'];

export const ASSET_CONDITION: Record<string, string> = {
  TOT: 'Tốt',
  KHA: 'Khá',
  TRUNG_BINH: 'Trung bình',
  KEM: 'Kém',
  HONG: 'Hỏng',
};

export const ASSET_KIND: Record<string, string> = {
  TSCD_HUU_HINH: 'TSCĐ hữu hình',
  TSCD_VO_HINH: 'TSCĐ vô hình',
  CCDC: 'Công cụ, dụng cụ',
};

export const ASSET_GROUP: Record<string, string> = {
  THIET_BI_Y_TE: 'Thiết bị y tế',
  CNTT: 'Công nghệ thông tin',
  MAY_MOC: 'Máy móc, thiết bị',
  NOI_THAT: 'Nội thất',
  PHUONG_TIEN: 'Phương tiện vận tải',
  NHA_CUA: 'Nhà cửa, vật kiến trúc',
  CCDC: 'Công cụ, dụng cụ',
  KHAC: 'Khác',
};

export const LOCATION_KIND: Record<string, string> = {
  KHU: 'Khu / cơ sở',
  TOA_NHA: 'Toà nhà',
  TANG: 'Tầng',
  PHONG: 'Phòng',
  KHO: 'Kho',
  KHAC: 'Khác',
};

export const SUPPLIER_ROLE: Record<string, string> = {
  NCC: 'Nhà cung cấp',
  HSX: 'Hãng sản xuất',
  BAO_TRI: 'Đơn vị bảo trì / sửa chữa',
  KIEM_DINH: 'Đơn vị kiểm định',
};

export interface TxTypeMeta {
  label: string;
  short: string; // tiền tố số chứng từ
  /** Trạng thái tài sản được phép đưa vào chứng từ */
  allowed: string[];
  /** Chứng từ có chọn khoa/vị trí/người nhận không */
  needsTarget?: boolean;
  /** Mỗi dòng có số tiền (chi phí sửa, giá thu thanh lý, nguyên giá mới…) */
  amountLabel?: string;
  description: string;
}

export const TX_TYPES: Record<string, TxTypeMeta> = {
  GHI_TANG: {
    label: 'Ghi tăng',
    short: 'GT',
    allowed: ['TRONG_KHO'],
    description: 'Quyết định ghi tăng tài sản (mua sắm, tiếp nhận, được tặng). Có thể giao luôn cho khoa.',
  },
  CAP_PHAT: {
    label: 'Cấp phát / bàn giao',
    short: 'CP',
    allowed: ['TRONG_KHO'],
    needsTarget: true,
    description: 'Bàn giao tài sản từ kho cho khoa/phòng sử dụng — bắt đầu tính hao mòn nếu chưa có ngày.',
  },
  DIEU_CHUYEN: {
    label: 'Điều chuyển',
    short: 'DC',
    allowed: ['DANG_SU_DUNG', 'HONG', 'TRONG_KHO'],
    needsTarget: true,
    description: 'Chuyển tài sản giữa các khoa/phòng, vị trí hoặc người giữ.',
  },
  THU_HOI: {
    label: 'Thu hồi về kho',
    short: 'TH',
    allowed: ['DANG_SU_DUNG', 'HONG'],
    description: 'Thu hồi tài sản từ khoa/phòng về kho.',
  },
  BAO_HONG: {
    label: 'Báo hỏng',
    short: 'BH',
    allowed: ['DANG_SU_DUNG', 'TRONG_KHO'],
    description: 'Khoa/phòng báo tài sản hỏng, chờ sửa chữa hoặc thanh lý.',
  },
  SUA_CHUA: {
    label: 'Đưa đi sửa chữa',
    short: 'SC',
    allowed: ['HONG', 'DANG_SU_DUNG', 'TRONG_KHO'],
    amountLabel: 'Chi phí dự kiến',
    description: 'Đưa tài sản đi sửa chữa (nội bộ hoặc đơn vị ngoài).',
  },
  HOAN_THANH_SUA: {
    label: 'Hoàn thành sửa chữa',
    short: 'HS',
    allowed: ['DANG_SUA_CHUA'],
    amountLabel: 'Chi phí thực tế',
    description: 'Nhận lại tài sản sau sửa chữa, cập nhật tình trạng.',
  },
  BAO_DUONG: {
    label: 'Bảo dưỡng định kỳ',
    short: 'BD',
    allowed: ['DANG_SU_DUNG', 'TRONG_KHO', 'HONG', 'DANG_SUA_CHUA'],
    amountLabel: 'Chi phí',
    description: 'Ghi nhận bảo dưỡng — tự tính ngày bảo dưỡng kế tiếp theo chu kỳ.',
  },
  KIEM_DINH: {
    label: 'Kiểm định / hiệu chuẩn',
    short: 'KD',
    allowed: ['DANG_SU_DUNG', 'TRONG_KHO', 'HONG', 'DANG_SUA_CHUA'],
    amountLabel: 'Chi phí',
    description: 'Ghi nhận kiểm định, hiệu chuẩn thiết bị y tế — tự tính hạn kiểm định kế tiếp.',
  },
  DANH_GIA_LAI: {
    label: 'Đánh giá lại',
    short: 'DG',
    allowed: ['TRONG_KHO', 'DANG_SU_DUNG', 'DANG_SUA_CHUA', 'HONG', 'CHO_THANH_LY'],
    amountLabel: 'Nguyên giá mới',
    description: 'Điều chỉnh nguyên giá (nâng cấp, kiểm kê đánh giá lại) theo quyết định.',
  },
  DE_NGHI_THANH_LY: {
    label: 'Đề nghị thanh lý',
    short: 'DT',
    allowed: ['HONG', 'TRONG_KHO', 'DANG_SU_DUNG'],
    description: 'Đưa tài sản vào danh sách chờ thanh lý.',
  },
  THANH_LY: {
    label: 'Thanh lý',
    short: 'TL',
    allowed: ['CHO_THANH_LY', 'HONG', 'TRONG_KHO', 'MAT'],
    amountLabel: 'Giá trị thu hồi',
    description: 'Ghi giảm tài sản do thanh lý, tiêu huỷ, bán.',
  },
  BAO_MAT: {
    label: 'Báo mất',
    short: 'BM',
    allowed: ['TRONG_KHO', 'DANG_SU_DUNG', 'DANG_SUA_CHUA', 'HONG', 'CHO_THANH_LY'],
    description: 'Ghi nhận tài sản bị mất để xử lý trách nhiệm.',
  },
};

export const TX_STATUS: Record<string, { label: string; color: string }> = {
  NHAP: { label: 'Nháp', color: '#64748b' },
  CHO_DUYET: { label: 'Chờ duyệt', color: '#d97706' },
  DA_DUYET: { label: 'Đã duyệt', color: '#16a34a' },
  TU_CHOI: { label: 'Từ chối', color: '#dc2626' },
  DA_HUY: { label: 'Đã huỷ', color: '#334155' },
};
