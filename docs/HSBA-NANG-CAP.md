# Nâng cấp khu vực Hồ sơ bệnh án (HSBA) — phiên bản thương mại

Cập nhật: 28/09/2026. Tài liệu này mô tả các nâng cấp mới của khu vực
*Phiếu đề nghị sửa hồ sơ bệnh án* (`/ho-so-benh-an`) và cách vận hành.

## 1. Cấu trúc dữ liệu mới

| Bảng | Mục đích |
|---|---|
| `hsba_comments` | Trao đổi nội bộ trên từng phiếu (xoá mềm `deleted_at`) |
| `hsba_attachments` | Tệp minh chứng đính kèm (sổ BHYT, phiếu thanh toán, chứng từ…) |

- Migration: `backend/drizzle/0010_hsba_comments_attachments.sql` (FK `ON DELETE CASCADE` vào `hsba_requests`, khoá `UPPER` normalize cho cảnh báo trùng).
- Tệp vật lý: `${STORAGE_DIR:-backend/.data/storage}/hsba/<requestId>/<uuid>.<ext>` — tên tệp hệ thống là UUID chống xung đột & path-traversal.

## 2. Endpoint mới

| Method | URL | Quyền | Ghi chú |
|---|---|---|---|
| GET | `/api/hsba/requests/duplicates?maKcb=&maTheBhyt=&excludeId=` | `hsba.request.view` | Liệt kê tối đa 5 phiếu **đang mở** trùng mã — dùng cảnh báo trùng |
| GET | `/api/hsba/requests/:id/comments` | `hsba.request.view` | Danh sách trao đổi (kèm cờ `canDelete`) |
| POST | `/api/hsba/requests/:id/comments` | `hsba.request.comment` | Thêm trao đổi, tự thông báo cho ngườI tạo & ngườI đề nghị |
| DELETE | `/api/hsba/requests/:id/comments/:commentId` | `hsba.request.comment` | Xoá mềm — tác giả hoặc quản trị phiếu |
| GET | `/api/hsba/requests/:id/attachments` | `hsba.request.view` | Danh sách tệp minh chứng |
| POST | `/api/hsba/requests/:id/attachments` | `file.upload` | Tải tệp base64 — kiểm kiểu/kích thước/**chữ ký đầu tệp** |
| GET | `/api/hsba/requests/:id/attachments/:attachmentId` | `hsba.request.view` | Stream tệp về trình duyệt (`inline`, `nosniff`) |
| DELETE | `/api/hsba/requests/:id/attachments/:attachmentId` | `file.upload` | Xoá mềm kèm xoá file vật lý |

## 3. Quy tắc nghiệp vụ mới

1. **Chặn tạo trùng phiếu:** khi tạo, máy chủ tìm phiếu đang mở (`status NOT IN (HOAN_TAT, DA_HUY)`) trùng `ma_kcb` hoặc `ma_the_bhyt` (so khớp không phân biệt hoa-thường). Có kết quả → `409` kèm danh sách; giao diện hỏi xác nhận rồi gọi lại với `force: true`.
2. **Chặt sở hữu khi sửa:** `PUT /requests/:id` từ chối (403) ngườI không phải ngườI tạo/ngườI đề nghị nếu họ *không* có `hsba.request.view-all` (trước đây bỏ sót kiểu tra này).
3. **Tệp minh chứng an toàn:** chỉ nhận ảnh PNG/JPEG/WebP, PDF, Word, Excel ≤ 12MB; kiểm chữ ký đầu tệp (magic bytes) chống đổi đuôi tệp nguy hiểm; tải xuống luôn đi qua quyền xem phiếu và chặn thoát đường dẫn.
4. **Ký nhanh hàng loạt:** FE dùng `POST /requests/bulk-sign` (đã có sẵn ở BE) — giữ lại tick cho các phiếu ký thất bại để ngườI ký rà soát.

## 4. Trải nghiệm giao diện

- **Danh sách:** thẻ thống kê động theo quy trình thật; cột **Tuổi phiếu** với huy hiệu *Quá hạn* theo SLA ưu tiên (KHẨN 8h / Cao 24h / Thường 48h / Thấp 96h); hộp chọn + thanh **Ký nhanh**; cột thao tác dính phải; nút **Xoá lọc** khi có điều kiện.
- **Chi tiết:** **stepper ngang** toàn cảnh quy trình; panel **Trao đổi nội bộ** (tự tải lại 20s); panel **Tệp minh chứng** (tải lên/xem/xoá).
- **Tạo phiếu:** **gợi ý phiếu trùng** ngay khi nhập mã KCB / thẻ BHYT (debounce 450ms); **bản nháp tự lưu** vào trình duyệt (`localStorage`, khôi phục khi mở lại trang, nút xoá nháp); lỗi hiển thị ngay theo từng trường.
- Sửa các lỗi nền: thẻ thống kê đọc sai cấu trúc `/stats` (luôn 0), liên kết thông báo trỏ sai đường (`/ho-so-benh-an/phieu/…` → `/ho-so-benh-an/…`), query `?limit=` gây lỗi 500.

## 5. Vận hành

Không cần tác vụ bổ sung: migration chạy cùng `db:migrate`, quyền mới (`hsba.request.comment`) đã có trong seed phân quyền. Đổi ngưỡng SLA mặc định chỉnh tại `OVERDUE_HOURS_BY_PRIORITY` trong `hsba.service.ts`. Giới hạn tải tệp chung hệ thống vẫn theo `storage.uploadMaxMb` (mặc định 25MB body limit).
