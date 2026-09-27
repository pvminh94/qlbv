# Danh mục API — QLBS

Tổng **126** endpoint. Đường dẫn đầy đủ có tiền tố `/api`, ví dụ `GET /api/hsba/requests`. Cột **Quyền** là (các) mã quyền cần có — nhiều mã cách nhau bởi `|` nghĩa là chỉ cần một trong số đó; quản trị tối cao (`SUPER_ADMIN`) bỏ qua mọi kiểm tra. Xem [PHAN-QUYEN.md](PHAN-QUYEN.md).

> Tài liệu tương tác (Swagger UI): `http://<máy chủ>:4000/api/docs`

**Quy ước chung**

- Mọi phản hồi bọc trong `{"success": true, "data": …}`; lỗi trả `{"success": false, "message": …}`.
- Danh sách dùng chung tham số: `page`, `pageSize`, `q`, `sortBy`, `sortDir`, `filters`, `dateField`, `dateFrom`, `dateTo`, `all`.
- `filters` có dạng `field:op:value`, nhiều điều kiện cách nhau bởi dấu phẩy, `op ∈ eq,ne,gt,gte,lt,lte,like,in,nin,isnull,notnull` (ví dụ `status:eq:HOAN_TAT,priority:in:HIGH|NORMAL`).
- Tham số boolean trên URL nhận `true/false/1/0/on/yes`.
- Danh sách trường lọc hợp lệ của từng màn hình lấy từ `GET /api/meta/filters[/:resource]` — giao diện tự dựng bộ lọc nâng cao từ dữ liệu này.

## Nhật ký hệ thống

| Phương thức | Đường dẫn | Mô tả | Quyền |
|---|---|---|---|
| `GET` | `/audit` | Tra cứu nhật ký kiểm toán (lọc nâng cao + phân trang) | `audit.log.view` |
| `GET` | `/audit/stats` | Thống kê nhật ký theo phân hệ và thao tác | `audit.log.view` |
| `GET` | `/audit/top-users` | Người dùng thao tác nhiều nhất | `audit.log.view` |
| `GET` | `/audit/entity` | Nhật ký của một bản ghi cụ thể | `audit.log.view` |

## Xác thực & phiên đăng nhập

| Phương thức | Đường dẫn | Mô tả | Quyền |
|---|---|---|---|
| `POST` | `/auth/login` | Đăng nhập | — |
| `POST` | `/auth/refresh` | Làm mới token | — |
| `POST` | `/auth/logout` | Đăng xuất khỏi phiên hiện tại | — |
| `GET` | `/auth/me` | Thông tin người dùng đang đăng nhập kèm quyền hiệu lực | — |
| `GET` | `/auth/profile` | Hồ sơ cá nhân chi tiết | — |
| `PUT` | `/auth/profile` | Cập nhật hồ sơ cá nhân | — |
| `POST` | `/auth/change-password` | Đổi mật khẩu | — |
| `GET` | `/auth/permissions` | Danh mục toàn bộ quyền (nhóm theo phân hệ) | — |
| `GET` | `/auth/sessions` | Các phiên đăng nhập đang hoạt động | — |
| `DELETE` | `/auth/sessions/:id` | Thu hồi một phiên đăng nhập | — |
| `DELETE` | `/auth/sessions` | Đăng xuất khỏi toàn bộ thiết bị | — |

## Bảng điều khiển

| Phương thức | Đường dẫn | Mô tả | Quyền |
|---|---|---|---|
| `GET` | `/dashboard/summary` | Số liệu tổng quan: hồ sơ, báo cáo, người dùng, tác vụ, nhật ký | — |

## Khoa phòng (cây tổ chức)

| Phương thức | Đường dẫn | Mô tả | Quyền |
|---|---|---|---|
| `GET` | `/departments` | Danh sách đơn vị (lọc nâng cao + phân trang) | `department.view` |
| `GET` | `/departments/tree` | Cây phân cấp đơn vị | `department.view` |
| `GET` | `/departments/options` | Danh sách gọn cho ô chọn | — |
| `GET` | `/departments/:id` | Chi tiết một đơn vị | `department.view` |
| `GET` | `/departments/:id/descendants` | Toàn bộ id trong nhánh (gồm chính nó) | `department.view` |
| `POST` | `/departments` | Thêm đơn vị/khoa mới | `department.create` |
| `PUT` | `/departments/:id` | Cập nhật đơn vị | `department.update` |
| `PATCH` | `/departments/reorder` | Sắp xếp lại thứ tự đơn vị | `department.update` |
| `DELETE` | `/departments/:id` | Xoá đơn vị (xoá mềm) | `department.delete` |
| `PATCH` | `/departments/:id/restore` | Khôi phục đơn vị đã xoá | `department.delete` |

## Hồ sơ bệnh án — phiếu đề nghị sửa

| Phương thức | Đường dẫn | Mô tả | Quyền |
|---|---|---|---|
| `GET` | `/hsba/workflows` | Danh sách quy trình ký | `hsba.workflow.view` |
| `GET` | `/hsba/workflows/:id` | Chi tiết quy trình ký (các bước cấu hình động) | `hsba.workflow.view` |
| `POST` | `/hsba/workflows` | Tạo quy trình ký mới (số bước tuỳ ý) | `hsba.workflow.create` |
| `PUT` | `/hsba/workflows/:id` | Cập nhật quy trình ký | `hsba.workflow.update` |
| `DELETE` | `/hsba/workflows/:id` | Xoá quy trình ký (chặn nếu đang có phiếu dùng) | `hsba.workflow.delete` |
| `GET` | `/hsba/requests` | Danh sách phiếu — tìm kiếm sâu, lọc nâng cao, phân trang | `hsba.request.view` |
| `GET` | `/hsba/requests/my-turn` | Phiếu đang chờ chính tôi xử lý | `hsba.request.view` |
| `GET` | `/hsba/requests/stats` | Thống kê phiếu theo trạng thái và theo khoa | `hsba.request.view` |
| `GET` | `/hsba/requests/verify/:id/:stepKey/:hash` | Xác thực chữ ký số của nội dung phiếu (dùng cho QR) | — |
| `GET` | `/hsba/requests/:id` | Chi tiết phiếu kèm dòng thời gian ký | `hsba.request.view` |
| `GET` | `/hsba/requests/:id/print-data` | Dữ liệu đổ vào mẫu in của phiếu (dùng khi xem trước với phiếu thật) | `hsba.request.print` |
| `GET` | `/hsba/requests/:id/pdf` | Kết xuất phiếu ra PDF theo mẫu in cấu hình được | `hsba.request.print` |
| `POST` | `/hsba/requests` | Tạo phiếu đề nghị sửa HSBA (tự chọn quy trình theo khoa) | `hsba.request.create` |
| `PUT` | `/hsba/requests/:id` | Cập nhật nội dung phiếu | `hsba.request.update` |
| `POST` | `/hsba/requests/:id/sign` | Ký ở bước đang chờ (kiểm tra theo cấu hình quy trình) | `hsba.request.sign-requester | hsba.request.sign-khtb | hsba.request.sign-finance` |
| `POST` | `/hsba/requests/bulk-sign` | Ký nhiều phiếu đang chờ tôi xử lý trong một lần | `hsba.request.sign-requester | hsba.request.sign-khtb | hsba.request.sign-finance` |
| `POST` | `/hsba/requests/:id/return` | Trả lại phiếu kèm lý do (huỷ chữ ký phía sau) | `hsba.request.return` |
| `POST` | `/hsba/requests/:id/cancel` | Huỷ phiếu | `hsba.request.cancel` |
| `PATCH` | `/hsba/requests/:id/restore` | Khôi phục phiếu đã xoá mềm | `hsba.request.delete` |
| `DELETE` | `/hsba/requests/:id` | Xoá mềm phiếu | `hsba.request.delete` |

## Thông báo

| Phương thức | Đường dẫn | Mô tả | Quyền |
|---|---|---|---|
| `GET` | `/notifications` | Thông báo của tôi | — |
| `PATCH` | `/notifications/:id/read` | Đánh dấu đã đọc | — |
| `PATCH` | `/notifications/read-all` | Đánh dấu đã đọc tất cả | — |
| `DELETE` | `/notifications/:id` | Xoá thông báo | — |

## Bản in & mẫu in

| Phương thức | Đường dẫn | Mô tả | Quyền |
|---|---|---|---|
| `GET` | `/print/templates` | Danh sách mẫu in | `print.template.view` |
| `GET` | `/print/templates/:id` | Chi tiết mẫu in (kèm toàn bộ thiết kế JSON) | `print.template.view` |
| `GET` | `/print/templates/:id/versions` | Lịch sử phiên bản thiết kế | `print.template.view` |
| `POST` | `/print/templates` | Tạo mẫu in mới | `print.template.create` |
| `PUT` | `/print/templates/:id` | Cập nhật thiết kế (tự tăng phiên bản) | `print.template.update` |
| `POST` | `/print/templates/:id/duplicate` | Sao chép mẫu in | `print.template.create` |
| `POST` | `/print/templates/:id/restore/:version` | Khôi phục thiết kế về phiên bản cũ | `print.template.update` |
| `PATCH` | `/print/templates/:id/publish` | Ban hành / ngừng sử dụng mẫu in | `print.template.publish` |
| `DELETE` | `/print/templates/:id` | Xoá mẫu in | `print.template.delete` |
| `POST` | `/print/preview` | Xem trước bản in từ thiết kế đang chỉnh (trả về PDF) | `print.render.view` |
| `POST` | `/print/templates/:id/render` | Kết xuất mẫu in ra PDF với dữ liệu truyền vào | `print.render.export` |
| `GET` | `/print/resolve/:docType` | Tìm mẫu in đang áp dụng theo loại chứng từ | `print.render.view` |
| `GET` | `/print/fonts` | Danh sách font bản in (mặc định Times New Roman) và trạng thái từng kiểu chữ | `print.template.view` |
| `GET` | `/print/fonts/file?family=&variant=` | Tải tệp font (để khung thiết kế hiển thị đúng như PDF) | `print.template.view` |
| `POST` | `/print/fonts?name=` | Tải tệp TTF/OTF lên (body octet-stream) — tự nhận họ font và kiểu chữ | `print.template.update` |
| `DELETE` | `/print/fonts?family=&variant=` | Xoá font đã tải lên | `print.template.update` |

## Báo cáo khoa

| Phương thức | Đường dẫn | Mô tả | Quyền |
|---|---|---|---|
| `GET` | `/reports/templates` | Danh sách mẫu báo cáo | `report.template.view` |
| `GET` | `/reports/templates/:id` | Chi tiết mẫu báo cáo (mục → nhóm → dòng, kèm danh sách cột) | `report.template.view` |
| `POST` | `/reports/templates` | Tạo mẫu báo cáo (kèm cột và cấu trúc bảng biểu) | `report.template.create` |
| `PUT` | `/reports/templates/:id` | Cập nhật thông tin mẫu báo cáo | `report.template.update` |
| `PUT` | `/reports/templates/:id/structure` | Lưu toàn bộ cấu trúc (cột, mục, nhóm, dòng) trong một lần | `report.template.update` |
| `POST` | `/reports/templates/:id/duplicate` | Sao chép mẫu báo cáo (có thể sang khoa khác) | `report.template.create` |
| `DELETE` | `/reports/templates/:id` | Xoá mẫu báo cáo (tự chuyển sang ngừng dùng nếu đã có số liệu) | `report.template.delete` |
| `POST` | `/reports/templates/validate-formula` | Kiểm tra công thức cột trước khi lưu | `report.template.view` |
| `GET` | `/reports/view` | Tính báo cáo theo kỳ (ngày/tuần/tháng/quý/năm/khoảng/toàn bộ) | `report.view.view` |
| `GET` | `/reports/summary` | Bảng tổng hợp toàn viện theo chỉ tiêu chuẩn | `report.summary.view` |
| `GET` | `/reports/stats` | Thống kê tình hình nhập liệu (dashboard) | `report.view.view` |
| `GET` | `/reports/export/:format` | Kết xuất báo cáo ra Excel / Word / PDF | `report.export.excel` |
| `GET` | `/reports/entries/grid` | Lưới nhập liệu: cấu trúc bảng + số liệu đã nhập theo kỳ | `report.entry.view` |
| `GET` | `/reports/entries/latest-date` | Ngày mới nhất đã có số liệu của một mẫu báo cáo | `report.entry.view` |
| `POST` | `/reports/entries` | Lưu số liệu hàng loạt (tự tạo/ghi đè theo ô, có nhật ký) | `report.entry.update` |
| `DELETE` | `/reports/entries` | Xoá một ô số liệu | `report.entry.delete` |
| `GET` | `/reports/entries/history` | Nhật ký thay đổi số liệu (ai sửa, giá trị cũ/mới) | `report.entry.view-audit` |
| `GET` | `/reports/snapshots` | Danh sách bản chốt số liệu | `report.view.view` |
| `GET` | `/reports/snapshots/:id` | Chi tiết bản chốt (kèm toàn bộ số liệu tại thời điểm chốt) | `report.view.view` |
| `POST` | `/reports/snapshots` | Chốt số liệu một kỳ báo cáo | `report.snapshot.create` |
| `PATCH` | `/reports/snapshots/:id/status` | Duyệt hoặc khoá bản chốt số liệu | `report.snapshot.approve | report.snapshot.lock` |

## Vai trò & phân quyền

| Phương thức | Đường dẫn | Mô tả | Quyền |
|---|---|---|---|
| `GET` | `/roles` | Danh sách vai trò | `role.view` |
| `GET` | `/roles/all` | Toàn bộ vai trò đang hoạt động (cho ô chọn) | — |
| `GET` | `/roles/matrix` | Ma trận vai trò × quyền phục vụ giao diện phân quyền | `role.view` |
| `GET` | `/roles/:id` | Chi tiết vai trò kèm quyền và thành viên | `role.view` |
| `POST` | `/roles` | Thêm vai trò mới | `role.create` |
| `PUT` | `/roles/:id` | Cập nhật vai trò | `role.update` |
| `PUT` | `/roles/:id/permissions` | Gán lại toàn bộ tập quyền của vai trò | `role.update` |
| `PATCH` | `/roles/:id/permissions` | Bật/tắt một quyền của vai trò | `role.update` |
| `POST` | `/roles/:id/users` | Gán vai trò cho nhiều người dùng | `user.assign-role` |
| `POST` | `/roles/:id/duplicate` | Nhân bản vai trò | `role.create` |
| `DELETE` | `/roles/:id` | Xoá vai trò | `role.delete` |

## Tác vụ định kỳ

| Phương thức | Đường dẫn | Mô tả | Quyền |
|---|---|---|---|
| `GET` | `/jobs` | Danh sách tác vụ định kỳ | `job.view` |
| `GET` | `/jobs/handlers` | Danh mục hàm xử lý có sẵn | `job.view` |
| `GET` | `/jobs/stats` | Thống kê tác vụ và lần chạy gần nhất | `job.view` |
| `GET` | `/jobs/runs` | Lịch sử chạy tác vụ | `job.view` |
| `GET` | `/jobs/:id` | Chi tiết tác vụ kèm lịch sử chạy | `job.view` |
| `POST` | `/jobs` | Thêm tác vụ định kỳ | `job.create` |
| `PUT` | `/jobs/:id` | Cập nhật tác vụ | `job.update` |
| `PATCH` | `/jobs/:id/toggle` | Bật/tắt tác vụ | `job.update` |
| `POST` | `/jobs/:id/run` | Chạy tác vụ ngay lập tức | `job.run` |
| `POST` | `/jobs/sync` | Nạp lại toàn bộ lịch định kỳ vào hàng đợi | `job.update` |
| `DELETE` | `/jobs/:id` | Xoá tác vụ | `job.delete` |

## Người dùng

| Phương thức | Đường dẫn | Mô tả | Quyền |
|---|---|---|---|
| `GET` | `/users` | Danh sách người dùng (lọc nâng cao + phân trang) | `user.view` |
| `GET` | `/users/stats` | Thống kê người dùng | `user.view` |
| `GET` | `/users/:id` | Chi tiết người dùng (vai trò, phạm vi khoa, lịch sử đăng nhập) | `user.view` |
| `POST` | `/users` | Thêm người dùng mới | `user.create` |
| `PUT` | `/users/:id` | Cập nhật người dùng | `user.update` |
| `DELETE` | `/users/:id` | Xoá người dùng (xoá mềm) | `user.delete` |
| `PATCH` | `/users/:id/restore` | Khôi phục người dùng đã xoá | `user.delete` |
| `PATCH` | `/users/:id/active` | Kích hoạt / vô hiệu hoá tài khoản | `user.update` |
| `POST` | `/users/:id/reset-password` | Đặt lại mật khẩu cho người dùng | `user.reset-password` |
| `POST` | `/users/:id/unlock` | Mở khoá tài khoản bị tạm khoá | `user.update` |
| `PUT` | `/users/:id/roles` | Gán vai trò cho người dùng | `user.assign-role` |
| `PUT` | `/users/:id/department-scopes` | Gán phạm vi khoa được phép truy cập | `user.assign-role` |
| `GET` | `/users/import/template` | Tải tệp Excel mẫu nhập nhân viên | `user.import` |
| `POST` | `/users/import/file?name=&dryRun=&overwrite=&addTitles=` | Nhập nhân viên từ tệp .xlsx/.csv/.txt (thân yêu cầu là nội dung tệp, `application/octet-stream`); `dryRun=true` để xem trước | `user.import` |
| `POST` | `/users/import` | Nhập danh sách người dùng từ JSON (dòng đã đọc sẵn) | `user.import` |
| `GET` | `/job-titles` | Danh mục chức danh (tìm kiếm, phân trang) | `job_title.view` |
| `GET` | `/job-titles/options` | Danh sách gọn cho ô chọn | (đăng nhập) |
| `POST` / `PUT` / `DELETE` | `/job-titles[/:id]` | Thêm / sửa (đổi tên cập nhật `users.title`) / xoá (chặn khi đang dùng) | `job_title.create/update/delete` |

## Tiện ích (menu động)

| Phương thức | Đường dẫn | Mô tả | Quyền |
|---|---|---|---|
| `GET` | `/utilities` | Danh sách tiện ích | `utility.view` |
| `GET` | `/utilities/menu` | Menu tiện ích của người dùng hiện tại (đã lọc theo quyền) | — |
| `GET` | `/utilities/:id` | Chi tiết tiện ích | `utility.view` |
| `POST` | `/utilities` | Thêm tiện ích mới | `utility.create` |
| `PUT` | `/utilities/:id` | Cập nhật tiện ích | `utility.update` |
| `PATCH` | `/utilities/reorder` | Sắp xếp thứ tự tiện ích | `utility.update` |
| `DELETE` | `/utilities/:id` | Xoá tiện ích | `utility.delete` |

## Siêu dữ liệu bộ lọc nâng cao

| Phương thức | Đường dẫn | Mô tả | Quyền |
|---|---|---|---|
| `GET` | `/meta/filters` | Danh sách tài nguyên hỗ trợ lọc nâng cao và toán tử kèm nhãn tiếng Việt | — |
| `GET` | `/meta/filters/:resource` | Trường lọc, kiểu dữ liệu, toán tử và nguồn giá trị của một tài nguyên | — |

Tài nguyên hỗ trợ: `hsba`, `report-entries`, `print-templates`, `users`, `roles`, `departments`, `utilities`, `audit`.
