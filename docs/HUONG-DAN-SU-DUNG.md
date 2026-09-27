# Hướng dẫn sử dụng — QLBS

Tài liệu ngắn gọn theo từng vai trò. Mở giao diện bằng trình duyệt (máy tính, máy tính
bảng, điện thoại đều dùng được), đăng nhập bằng tài khoản được cấp.

---

## 1. Người đề nghị sửa hồ sơ bệnh án (vai trò `NHAP_LIEU`)

**Tạo phiếu**

1. Menu **Hồ sơ bệnh án → Tạo phiếu** (hoặc nút *Tạo phiếu* ở danh sách).
2. Điền thông tin người bệnh (họ tên, năm sinh, giới tính, mã KCB, mã thẻ BHYT,
   ngày vào/ra viện, đối tượng).
3. Ghi **lý do** và **nội dung cần sửa** trong HSBA điện tử; nhập số tiền cần huỷ
   thanh toán (nếu có).
4. Kiểm tra **quy trình ký** hiển thị bên phải (mấy bước, ai ký) rồi bấm
   **Tạo phiếu**. Bật *Ký xác nhận ngay* nếu muốn phiếu chuyển thẳng sang bước duyệt.

**Theo dõi & xử lý**

* Danh sách phiếu có các tab theo bước ký; bật *Chờ tôi xử lý* để chỉ xem việc của mình.
* Phiếu **bị trả lại** hiện màu vàng, kèm lý do. Bấm **Sửa & gửi lại** → sửa nội dung →
  bấm **Gửi lại phiếu** (hệ thống yêu cầu ký lại vì nội dung đã thay đổi).
* Bấm **In bản in** để kết xuất PDF khổ A4 theo mẫu in đang ban hành.

> Lưu ý: khi phiếu đã được ký ở bước tiếp theo thì không sửa được nội dung nữa —
> người duyệt phải trả lại phiếu trước.

## 2. Duyệt – TB.KHTH (vai trò `KHTB`)

1. Menu **Hồ sơ bệnh án**, bật *Chờ tôi xử lý*.
2. Mở phiếu → xem nội dung, nhật ký và các bước ký.
3. Chọn một trong hai:
   * **Duyệt**: bấm *Ký bước này*, có thể ghi ý kiến; phiếu chuyển sang Tài chính.
   * **Trả lại**: bấm *Trả lại*, ghi rõ lý do; phiếu quay về người đề nghị và mọi chữ
     ký cũ bị huỷ (ghi vào nhật ký).
4. Ký nhiều phiếu cùng lúc: chọn các phiếu ở danh sách → **Ký hàng loạt**.

## 3. Tài chính (vai trò `TAI_CHINH`)

1. Mở phiếu đang ở bước *Chờ TC xác nhận hủy thanh toán*.
2. Đối chiếu số tiền và giao dịch BHYT; sau khi đã hủy thanh toán trên phần mềm kế toán,
   bấm **Ký bước này** để xác nhận. Phiếu chuyển sang trạng thái **Hoàn tất**.

## 4. Nhập số liệu báo cáo của khoa (vai trò `TRUONG_KHOA`, `NHAP_BAO_CAO`)

1. Menu **Báo cáo → Nhập số liệu**; chọn **mẫu báo cáo** của khoa.
2. Chọn **kỳ** (ngày / tuần / tháng / quý / năm / khoảng ngày / toàn bộ) rồi bấm *Tải số liệu*.
3. Nhập trực tiếp vào từng ô; các cột **Công thức** tự tính theo cột được tham chiếu.
4. Bấm **Lưu số liệu**. Mọi thay đổi được lưu vết (ai sửa, giá trị cũ → mới) — xem
   *Nhật ký số liệu* trong cùng trang.
5. Có thể dán số liệu từ Excel theo hướng dẫn ở cột *Dán từ Excel* hoặc nhập một lần
   cho cả kỳ bằng tuỳ chọn *Nhập cho cả kỳ*.

## 5. Xem báo cáo & chốt số liệu

**Một khoa** — **Báo cáo**: chọn mẫu, kỳ, bấm *Xem báo cáo*; kết xuất
**Excel / Word / PDF** hoặc **In báo cáo**.

**Toàn viện** — **Báo cáo → Tổng hợp toàn viện**: bảng chỉ tiêu theo từng khoa, kèm
danh sách khoa chưa nhập số liệu trong kỳ.

**Chốt số liệu** (người có quyền `report.snapshot.create`):

1. Chọn đúng mẫu và kỳ cần chốt → bấm **Chốt số liệu kỳ này**.
2. Bản chốt lưu nguyên trạng số liệu tại thời điểm chốt và được đánh dấu *Bản nháp*.
3. Người có quyền duyệt bấm **Duyệt** rồi **Khoá** để chốt chính thức. Số liệu của bản
   chốt **không thay đổi** khi số liệu nhập về sau bị sửa.

### Xem lại và mở khoá bản chốt

* Danh sách bản chốt nằm ngay dưới nút **Chốt số liệu kỳ này** ở **Báo cáo**.
* Bấm **Xem** để mở lại đúng số liệu tại thời điểm chốt (bảng thu gọn, tô màu trạng thái).
* Bấm **Mở khoá** để đưa bản chốt về *Đã duyệt* và cho phép nhập tiếp. Việc mở khoá cần
  quyền `report.snapshot.lock` (hoặc quản trị tối cao) và luôn được ghi vào nhật ký hệ
  thống với thao tác `UNLOCK`. Khi bản chốt còn *Đã khoá*, ô nhập số liệu của kỳ đó bị
  chặn kèm cảnh báo màu vàng — tránh sửa nhầm số đã báo cáo.

## 6. Trưởng khoa / Ban giám đốc

* **Bảng điều khiển**: số phiếu theo trạng thái, số phiếu bị trả lại, tình hình nhập
  số liệu của các khoa, tác vụ sắp chạy và nhật ký gần nhất — phạm vi dữ liệu theo
  vai trò được gán.
* Duyệt số liệu: theo dõi bảng *Tổng hợp toàn viện* để biết khoa nào chưa nhập.

## 7. Quản trị hệ thống (vai trò `ADMIN`)

| Việc | Đường dẫn |
|---|---|
| Người dùng: thêm, sửa, gán vai trò, đặt lại mật khẩu, khoá tài khoản (thư điện tử, điện thoại, ghi chú không bắt buộc) | **Quản trị → Người dùng** |
| Nhập danh sách nhân viên từ Excel (.xlsx) / CSV / TXT: tải tệp mẫu → chọn tệp → xem trước từng dòng → xác nhận | **Quản trị → Người dùng → Nhập từ Excel/CSV** |
| Vai trò & quyền: tạo vai trò, tích chọn từng quyền, đặt phạm vi dữ liệu | **Quản trị → Vai trò** |
| Cây khoa phòng: thêm/sửa/xoá nhiều cấp, bật nhập báo cáo, gán mẫu báo cáo | **Quản trị → Danh mục → Khoa phòng** |
| Chức danh (Bác sĩ, Điều dưỡng…): dùng cho ô chọn chức danh; đổi tên sẽ cập nhật cho mọi người đang mang chức danh đó | **Quản trị → Danh mục → Chức danh** |
| Quy trình ký phiếu HSBA: số bước, loại người ký, cho trả lại, bắt buộc ý kiến | **Hồ sơ bệnh án → Quy trình ký** |
| Mẫu báo cáo: mục, nhóm, dòng, cột nhập/công thức, chỉ tiêu tổng hợp | **Báo cáo → Mẫu báo cáo** |
| Mẫu in: khổ giấy, lề, font, ảnh, chữ ký, phiên bản đang ban hành | **Quản trị → Mẫu in** |
| Tiện ích (menu): thêm/sửa/xoá, sắp xếp, đặt vị trí, giới hạn theo quyền | **Quản trị → Tiện ích** |
| Tác vụ định kỳ: cron, chạy tay, xem lịch sử chạy | **Quản trị → Tác vụ** |
| Cấu hình: thông tin bệnh viện, tuỳ chọn hệ thống, khôi phục mặc định | **Quản trị → Cấu hình** |
| Nhật ký toàn hệ thống (lọc theo người dùng, phân hệ, thao tác, thời gian) | **Quản trị → Nhật ký** |

### Nhập danh sách nhân viên

- Chỉ bắt buộc cột **Họ và tên**. Các cột khác (Tên đăng nhập, Chức danh, Mã khoa hoặc tên khoa, Thư điện tử, Điện thoại, Vai trò, Ghi chú, Mật khẩu, Mã nhân viên) có thể có hoặc không, thứ tự tuỳ ý, tên cột không phân biệt dấu/hoa thường.
- Tên đăng nhập để trống → tự tạo từ họ tên: “Nguyễn Văn An” → `annv` (trùng thì `annv2`…). Nhập lại cùng tệp không tạo trùng.
- Thư điện tử/điện thoại sai định dạng chỉ bị bỏ qua (cảnh báo), khoa không tìm thấy thì để trống khoa.
- Tài khoản mới dùng mật khẩu `Qlbs@123456`, bắt buộc đổi khi đăng nhập lần đầu. Chọn “Ghi đè” để cập nhật tài khoản đã có (không đổi mật khẩu, ô trống không xoá dữ liệu cũ).
- Tệp CSV/TXT: UTF-8, UTF-16 (Excel “Unicode Text”) hoặc Windows-1258; phân cách bằng `,` `;` Tab hoặc `|`. Tệp `.xls` cũ cần lưu lại thành `.xlsx`. Tối đa 5000 dòng / 10 MB mỗi lần.

## 8. Câu hỏi thường gặp

**Tôi không thấy menu nào?** Menu được cấp theo quyền — liên hệ quản trị để được gán
vai trò phù hợp. Menu **Tiện ích** hiển thị theo cấu hình *Quản trị → Tiện ích*.

**Tìm phiếu nhanh thế nào?** Ô tìm kiếm nhận cả chữ có dấu và không dấu (`hồng ánh`,
`hong anh`), tìm được theo số phiếu, mã KCB, mã thẻ BHYT, tên người bệnh, khoa.
Bấm **Bộ lọc nâng cao** để lọc theo khoa, mức ưu tiên, đối tượng, khoảng số tiền,
phiếu đã bị trả lại và chọn kiểu sắp xếp.

**Lọc sâu theo từng trường thế nào?** Trong bảng *Bộ lọc nâng cao* còn có mục **Bộ lọc
nâng cao** (dạng điều kiện): chọn *trường* → *điều kiện* (bằng, khác, chứa, từ … trở lên,
thuộc danh sách, rỗng/có giá trị…) → *giá trị*, rồi bấm **Áp dụng**. Danh sách trường,
kiểu dữ liệu và danh mục giá trị do hệ thống tự cung cấp (API `/api/meta/filters`), nên
mọi màn hình đều có cùng cách lọc. Bấm **Lưu bộ lọc** để đặt tên và dùng lại bộ điều kiện
này về sau. Các màn *Người dùng*, *Tiện ích*, *Mẫu in*, *Nhật ký* cũng có thanh lọc này.

**Thiết kế bản in ở đâu?** Vào **Quản trị → Mẫu in**, bấm **Thiết kế** ở một mẫu. Trình
thiết kế mở **toàn màn hình** theo kiểu phần mềm thương mại:

* **Ribbon** phía trên: *Trang chủ* (hoàn tác, cắt/sao chép/dán, font – cỡ chữ – đậm/nghiêng/
  gạch chân – màu chữ/nền – căn lề – giãn dòng – khung viền), *Chèn* (chữ, trường dữ liệu,
  bảng, đường kẻ, khung, ảnh/logo, mã QR, mã vạch, ô chữ ký, ngày giờ, số trang), *Bố trí*
  (căn thẳng hàng, giãn đều, cùng kích thước, thứ tự lớp, khoá, ẩn khi in, lặp mọi trang),
  *Trang in* (khổ giấy, hướng, lề, số trang tự động, chữ mờ, thêm/nhân bản/xoá trang),
  *Xem* (thu phóng, lưới, hít lưới, đường gióng thông minh, thước đo, hiện dữ liệu mẫu).
* **Cột trái**: Hộp công cụ, danh sách **Trường dữ liệu** (kéo thả thẳng vào trang), danh
  sách **Đối tượng** (ẩn/khoá từng đối tượng), **Trang** và **JSON** (tải/nạp thiết kế).
* **Khung vẽ** có thước milimét, lưới, khung chọn nhiều đối tượng, đường gióng khi kéo,
  nhấp đúp để sửa chữ trực tiếp, chuột phải để mở menu nhanh, Ctrl + lăn chuột để thu phóng.
* **Cột phải**: toàn bộ thuộc tính của đối tượng đang chọn (hoặc của cả bản in).
* **Thanh trạng thái**: khổ giấy, toạ độ con trỏ, vị trí/kích thước đối tượng, thu phóng.

Phím tắt chính: Ctrl+Z/Y, Ctrl+C/X/V/D, Ctrl+A, Delete, mũi tên (Shift ×10 mm, Alt ×0,1 mm),
Ctrl+B/I/U, Ctrl+L (khoá), Ctrl+S (lưu), Ctrl+P (xem trước PDF), F1 (bảng phím tắt đầy đủ).
Nút **Thông tin mẫu** để sửa mã/tên/loại chứng từ/khoa áp dụng; đóng trình thiết kế khi còn
thay đổi chưa lưu, hệ thống sẽ hỏi lại.

**Xem trước PDF** kết xuất đúng bằng bộ máy in của máy chủ, cho phép chọn *Dữ liệu mẫu*, *Để
trống*, lấy dữ liệu của **một phiếu HSBA thật** (tìm theo mã/tên) hoặc sửa JSON trực tiếp.

**Font chữ bản in:** mọi bản in mặc định **Times New Roman**, kể cả khi xem trước và tải PDF.
Nút **Font chữ** trong trình thiết kế cho biết máy chủ đang dùng Times New Roman gốc hay font
tương thích (Tinos — cùng kích thước ký tự), cho phép tải thêm font TTF/OTF khác. Để dùng
Times New Roman gốc của Microsoft trên máy chủ, chạy `sudo bash deploy/install-times-font.sh`
(lệnh cập nhật `deploy/update.sh` đã tự chạy bước này).

**Bản in bị lệch/thiếu chữ?** Kiểm tra *Quản trị → Mẫu in*: khổ giấy, lề và font. Bản in
được kết xuất theo đúng mẫu đang ban hành.

**Quên mật khẩu?** Liên hệ quản trị để *Đặt lại mật khẩu*; lần đăng nhập kế tiếp hệ
thống có thể yêu cầu đổi mật khẩu.
