# Hướng Dẫn Bảo Vệ Kiosk Toàn Diện & Cơ Chế Chống Xoá File Vĩnh Viễn

Tài liệu này hướng dẫn thiết lập Kiosk y tế phòng khám trên Windows 10/11, giải quyết triệt để 2 vấn đề:
1. **Ngăn chặn 100% các lỗ hổng thoát Kiosk ra Desktop khi chưa điểm danh.**
2. **Ngăn chặn người dùng/bác sĩ khi mở khoá vào được Desktop cố tình vào thư mục xoá file khởi động.**

---

## 1. CƠ CHẾ CHỐNG XOÁ FILE VĨNH VIỄN (CẤP ĐỘ DOANH NGHIỆP / ENTERPRISE)

Nếu chỉ đặt file `.bat` trong thư mục cá nhân `shell:startup`, người dùng khi mở khoá Desktop có thể tò mò bấm vào đó xoá đi.

Để chống lại tình huống này, chúng tôi đã tạo file:
👉 **`deploy/windows/cai_dat_chong_xoa_vinh_vien.bat`**

### Kịch bản này bảo vệ máy trạm bằng 4 lớp bảo mật của Windows:
1. **Giấu tệp vào thư mục hệ thống bảo mật:**
   Tệp không nằm trong thư mục người dùng nữa, mà được đưa vào: `C:\ProgramData\QLBS_Kiosk` (thư mục hệ thống ẩn của Windows).
2. **Khóa quyền bảo mật tệp NTFS (`icacls`):**
   Chỉ cấp quyền cho Quản trị viên (`Administrators`) và Hệ thống (`SYSTEM`). Người dùng thông thường (`Users/Everyone`) **BỊ CẤM XOÁ VÀ CẤM SỬA (Deny Delete & Modify)**.
   *Nếu người dùng có tìm thấy file và bấm phím Delete, Windows sẽ lập tức hiện cảnh báo:*
   > *"You need permission from Administrators to make changes to this file"* và từ chối xoá!
3. **Đăng ký tác vụ ngầm Task Scheduler của Windows:**
   Hệ thống khởi chạy Kiosk thông qua **Windows Task Scheduler** (`schtasks /sc onlogon /rl highest`). Người dùng mở thư mục Startup (`shell:startup`) ra sẽ **hoàn toàn trống trơn**, không nhìn thấy bất cứ file nào để mà xoá.
4. **Khóa máy cấp hệ điều hành (HKLM Run):**
   Đăng ký dự phòng vào `HKEY_LOCAL_MACHINE\Software\Microsoft\Windows\CurrentVersion\Run`. Người dùng thông thường không có quyền ghi hay xoá khoá Registry này.

---

## 2. QUY TRÌNH THIẾT LẬP 1 LẦN DUY NHẤT TRÊN MÁY TÍNH PHÒNG KHÁM

Trên máy tính Windows phòng khám:

### Bước 1: Chỉnh thông tin phòng khám
Mở file **`chay_kiosk_phong_kham.bat`** bằng Notepad, chỉnh 2 dòng:
- `SERVER_IP`: IP máy chủ chạy Docker (ví dụ: `192.168.1.50`).
- `ROOM_CODE`: Mã phòng khám (ví dụ: `PK01`, `PK02`).

### Bước 2: Kích hoạt bảo vệ & Chống xoá vĩnh viễn (Chuột phải -> Run as administrator)
1. Nhấp chuột phải vào file **`khoa_toan_dien_kiosk.bat`** ➔ Chọn **Run as administrator** (Khoá Win+D, Task Manager, cử chỉ cảm ứng).
2. Nhấp chuột phải vào file **`cai_dat_chong_xoa_vinh_vien.bat`** ➔ Chọn **Run as administrator** (Khoá quyền NTFS, bật Task Scheduler ngầm).

👉 **Kết quả đạt được:**
* Máy tính bật lên là tự động kích hoạt Kiosk toàn màn hình che kín Taskbar.
* Bàn phím bị khoá mọi tổ hợp nguy hiểm (`Win + D`, `Ctrl + Shift + Esc`, `Shift 5 lần`, `Alt + F4`...).
* Khi bác sĩ điểm danh thành công trên điện thoại, máy tính mở khoá Desktop để bác sĩ làm việc.
* Kể cả bác sĩ hay ai đó có tò mò mở thư mục Startup hay tìm đến file hệ thống thì **hoàn toàn KHÔNG THỂ XOÁ ĐƯỢC**!
* Khi bác sĩ xong ca bấm **`[ 🔒 Khoá máy / Rời phòng ]`**, Kiosk lại tự động phủ kín màn hình.

---

## 3. DÀNH CHO KỸ THUẬT VIÊN IT KHI CẦN BẢO TRÌ

Khi IT cần cài đặt lại phần mềm hoặc chuyển đổi mục đích sử dụng máy tính:
1. Nhấp chuột phải vào file **`khoi_phuc_windows_mac_dinh.bat`** ➔ Khôi phục lại phím Windows, Win + D và Task Manager.
2. Nhấp chuột phải vào file **`go_bo_kiosk_it.bat`** (Run as admin) ➔ Gỡ bỏ tác vụ Task Scheduler và dọn dẹp thư mục bảo vệ.
