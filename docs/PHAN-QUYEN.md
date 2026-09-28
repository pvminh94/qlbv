# Phân quyền — QLBS

Hệ thống dùng **PBAC**: mỗi endpoint yêu cầu mã quyền cụ thể, vai trò chỉ là tập hợp quyền.
Tất cả quyền, vai trò và phạm vi dữ liệu đều sửa được trong *Quản trị → Vai trò* (và gán lại cho người dùng),
không có phần nào bị cứng trong mã nguồn.

## 1. Danh mục quyền (100 quyền)

| Mã quyền | Ý nghĩa |
|---|---|
| `dashboard.view` | Xem trang tổng quan |
| `dashboard.view-all` | Xem tổng quan toàn viện |
| `department.view` | Xem đơn vị / khoa phòng |
| `department.create` | Thêm đơn vị / khoa phòng |
| `department.update` | Sửa đơn vị / khoa phòng |
| `department.delete` | Xoá đơn vị / khoa phòng |
| `job_title.view` | Xem danh mục chức danh |
| `job_title.create` | Thêm chức danh |
| `job_title.update` | Sửa chức danh |
| `job_title.delete` | Xoá chức danh |
| `user.view` | Xem danh sách người dùng |
| `user.create` | Thêm người dùng |
| `user.update` | Sửa người dùng |
| `user.delete` | Xoá người dùng |
| `user.reset-password` | Đặt lại mật khẩu người dùng |
| `user.assign-role` | Gán vai trò cho người dùng |
| `user.import` | Nhập danh sách người dùng |
| `user.export` | Kết xuất danh sách người dùng |
| `role.view` | Xem vai trò và quyền |
| `role.create` | Thêm vai trò |
| `role.update` | Sửa vai trò và gán quyền |
| `role.delete` | Xoá vai trò |
| `hsba.workflow.view` | Xem quy trình ký |
| `hsba.workflow.create` | Thêm quy trình ký |
| `hsba.workflow.update` | Sửa quy trình ký |
| `hsba.workflow.delete` | Xoá quy trình ký |
| `hsba.request.view` | Xem phiếu đề nghị sửa HSBA |
| `hsba.request.view-all` | Xem phiếu của mọi khoa |
| `hsba.request.create` | Tạo phiếu đề nghị sửa HSBA |
| `hsba.request.update` | Sửa nội dung phiếu |
| `hsba.request.delete` | Xoá phiếu |
| `hsba.request.sign-requester` | Ký với tư cách người đề nghị |
| `hsba.request.sign-khtb` | Duyệt / ký TB.KHTH |
| `hsba.request.sign-finance` | Xác nhận tài chính đã hủy thanh toán |
| `hsba.request.return` | Trả lại phiếu kèm lý do |
| `hsba.request.cancel` | Huỷ phiếu đã tạo |
| `hsba.request.assign-requester` | Chỉ định người đề nghị trên phiếu |
| `hsba.request.export` | Kết xuất phiếu ra PDF/Word/Excel |
| `hsba.request.print` | In phiếu |
| `hsba.request.comment` | Ghi ý kiến trên phiếu |
| `report.template.view` | Xem mẫu báo cáo |
| `report.template.create` | Thêm mẫu báo cáo |
| `report.template.update` | Sửa cấu trúc mẫu báo cáo |
| `report.template.delete` | Xoá mẫu báo cáo |
| `report.entry.view` | Xem số liệu báo cáo |
| `report.entry.update` | Nhập / sửa số liệu báo cáo |
| `report.entry.delete` | Xoá số liệu báo cáo |
| `report.entry.import` | Nhập số liệu từ Excel |
| `report.entry.view-audit` | Xem lịch sử sửa số liệu |
| `report.view.view` | Xem báo cáo công tác |
| `report.view.all-departments` | Xem báo cáo của mọi khoa |
| `report.export.excel` | Kết xuất báo cáo ra Excel |
| `report.export.word` | Kết xuất báo cáo ra Word |
| `report.export.pdf` | Kết xuất báo cáo ra PDF |
| `report.summary.view` | Xem bảng tổng hợp toàn viện |
| `report.snapshot.create` | Chốt số liệu kỳ báo cáo |
| `report.snapshot.approve` | Duyệt báo cáo đã chốt |
| `report.snapshot.lock` | Khoá báo cáo đã duyệt |
| `print.template.view` | Xem mẫu in |
| `print.template.create` | Thêm mẫu in |
| `print.template.update` | Thiết kế / sửa mẫu in |
| `print.template.delete` | Xoá mẫu in |
| `print.template.publish` | Ban hành mẫu in |
| `print.render.view` | Xem trước bản in |
| `print.render.export` | Kết xuất bản in ra PDF |
| `utility.view` | Xem tiện ích |
| `utility.create` | Thêm tiện ích |
| `utility.update` | Sửa tiện ích |
| `utility.delete` | Xoá tiện ích |
| `job.view` | Xem tác vụ định kỳ |
| `job.create` | Thêm tác vụ định kỳ |
| `job.update` | Sửa tác vụ định kỳ |
| `job.delete` | Xoá tác vụ định kỳ |
| `job.run` | Chạy tác vụ ngay |
| `audit.log.view` | Xem nhật ký kiểm toán |
| `setting.view` | Xem cấu hình hệ thống |
| `setting.update` | Sửa cấu hình hệ thống |
| `data.import` | Nhập dữ liệu từ tệp |
| `data.export` | Kết xuất dữ liệu ra tệp |
| `backup.view` | Xem lịch sử sao lưu |
| `backup.create` | Tạo bản sao lưu |
| `backup.restore` | Phục hồi từ bản sao lưu |
| `file.upload` | Tải tệp lên |
| `file.delete` | Xoá tệp đã tải lên |
| `studio.dashboard.view` | Xem & tự tạo bảng điều khiển của riêng mình, nhân bản trang hệ thống |
| `studio.dashboard.manage` | Tạo/sửa/xoá bảng điều khiển **phạm vi hệ thống/vai trò** (cho cả viện xem) |
| `studio.report.view` | Vào trang Báo cáo tuỳ biến, tự tạo báo cáo cá nhân, xuất Excel theo quyền nguồn |
| `studio.report.manage` | Tạo/sửa báo cáo tuỳ biến **phạm vi hệ thống/vai trò** |
| `asset.view` | Xem tài sản (danh sách, hồ sơ, dòng thời gian — theo phạm vi khoa) |
| `asset.view-all` | Xem tài sản toàn viện (bỏ qua giới hạn khoa) |
| `asset.create` | Thêm tài sản (kể cả thêm cả lô nhiều chiếc) |
| `asset.update` | Sửa hồ sơ tài sản (trường nhạy cảm bị khoá sau khi phát sinh nghiệp vụ) |
| `asset.delete` | Xoá tài sản chưa phát sinh chứng từ đã duyệt / chưa chốt khấu hao |
| `asset.import` | Nhập tài sản từ Excel/CSV |
| `asset.export` | Xuất danh sách tài sản ra Excel |
| `asset.dashboard` | Xem tổng quan tài sản |
| `asset.label.print` | In tem QR / mã vạch |
| `asset.catalog.view` | Xem danh mục loại tài sản, vị trí, nhà cung cấp, nguồn vốn |
| `asset.catalog.manage` | Quản lý các danh mục trên |
| `asset.transaction.view` | Xem chứng từ nghiệp vụ tài sản, in biên bản |
| `asset.transaction.create` | Lập / sửa / gửi duyệt / huỷ chứng từ của mình |
| `asset.transaction.approve` | Duyệt, từ chối chứng từ (duyệt mới áp dụng vào tài sản) |
| `asset.depreciation.view` | Xem khấu hao / hao mòn, xuất sổ theo dõi |
| `asset.depreciation.run` | Tính, chốt và huỷ kỳ khấu hao / hao mòn |
| `asset.inventory.view` | Xem đợt kiểm kê (danh sách, tiến độ, kết quả, biên bản, Excel) |
| `asset.inventory.manage` | Lập & điều hành kiểm kê: chốt sổ sách, khoá số liệu, xử lý chênh lệch, huỷ |
| `asset.inventory.scan` | Tham gia quét mã / xác nhận trong đợt được phân công hoặc thuộc khoa |
| `asset.inventory.approve` | Duyệt kết quả kiểm kê (hoàn tất, cập nhật hồ sơ) |
| `asset.report.view` | Xem báo cáo tài sản chuẩn (sổ TSCĐ, tăng giảm, theo khoa, chi phí, đến hạn, thanh lý, kiểm kê) |

## 2. Vai trò mặc định

| Mã | Tên | Phạm vi dữ liệu | Mô tả |
|---|---|---|---|
| `SUPER_ADMIN` | Quản trị tối cao | `ALL` | Toàn quyền hệ thống, không thể bị giới hạn bởi bất kỳ cấu hình nào |
| `ADMIN` | Quản trị hệ thống | `ALL` | Quản lý người dùng, khoa phòng, cấu hình, mẫu báo cáo và mẫu in |
| `KHTB` | Duyệt – TB.KHTH | `ALL` | Duyệt hoặc trả lại phiếu đề nghị sửa hồ sơ bệnh án |
| `TAI_CHINH` | Tài chính (hủy thanh toán) | `ALL` | Xác nhận đã hủy thanh toán BHYT cho hồ sơ bệnh án |
| `NHAP_LIEU` | Nhập liệu / Người đề nghị | `OWN` | Tạo phiếu đề nghị sửa hồ sơ bệnh án và ký với tư cách người đề nghị |
| `TRUONG_KHOA` | Trưởng khoa | `DEPT` | Nhập và chịu trách nhiệm số liệu báo cáo của khoa mình |
| `NHAP_BAO_CAO` | Nhập báo cáo khoa | `DEPT` | Chỉ nhập số liệu báo cáo công tác của khoa được gán |
| `XEM_BAO_CAO` | Xem báo cáo | `DEPT` | Chỉ xem và kết xuất báo cáo, không sửa số liệu |
| `QL_TAI_SAN` | Quản lý tài sản | `ALL` | Phòng Vật tư – TBYT / Tài chính: toàn bộ quyền `asset.*` (hồ sơ, chứng từ, duyệt, khấu hao, in tem) |

> `TRUONG_KHOA` được thêm: `asset.view`, `asset.dashboard`, `asset.transaction.view/create`, `asset.catalog.view`, `asset.inventory.view/scan`, `asset.report.view` — xem tài sản của khoa, lập đề nghị cho phòng Vật tư duyệt, tham gia quét kiểm kê tại khoa, xem báo cáo trong phạm vi khoa.

> `SUPER_ADMIN` có toàn bộ quyền và bỏ qua mọi kiểm tra (kể cả phạm vi dữ liệu);
> các vai trò còn lại chỉ có đúng những quyền được gán trong *Quản trị → Vai trò*.

## 3. Phạm vi dữ liệu (data scope)

| Giá trị | Người dùng thấy được |
|---|---|
| `ALL` | Toàn bộ dữ liệu của bệnh viện |
| `DEPT` | Dữ liệu của (các) khoa được gán cho tài khoản |
| `OWN` | Chỉ phiếu/bản ghi do mình tạo hoặc mình là người đề nghị |

**Tài sản:** không có `asset.view-all` thì chỉ thấy tài sản thuộc các khoa được gán cho tài khoản, hoặc tài sản mình đang giữ (người giữ). Chứng từ: thấy chứng từ mình lập hoặc có khoa đi/đến trong phạm vi.

Quyền `*.view-all` cho phép xem toàn viện dù vai trò có phạm vi hẹp hơn (ví dụ `hsba.request.view-all`, `report.view.all-departments`).

## 4. Gợi ý phân vai

| Việc cần làm | Quyền tối thiểu |
|---|---|
| Tạo và ký phiếu sửa HSBA | `hsba.request.create`, `hsba.request.update`, `hsba.request.sign-requester` |
| Duyệt phiếu (TB.KHTH) | `hsba.request.view-all`, `hsba.request.sign-khtb`, `hsba.request.return` |
| Xác nhận huỷ thanh toán | `hsba.request.sign-finance`, `hsba.request.return` |
| Nhập số liệu báo cáo | `report.entry.view`, `report.entry.update` |
| Chốt số liệu kỳ báo cáo | `report.snapshot.create` |
| Duyệt / khoá bản chốt | `report.snapshot.approve`, `report.snapshot.lock` |
| Thiết kế mẫu báo cáo | `report.template.*` |
| Thiết kế mẫu in | `print.template.*`, `print.render.export` |
| Quản trị hệ thống | `user.*`, `role.*`, `department.*`, `setting.*` |

## 5. Kiểm tra nhanh

```bash
# Đăng nhập rồi xem quyền của chính mình
curl -s -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"Admin@123"}' | jq ".data.permissions | length"
```
