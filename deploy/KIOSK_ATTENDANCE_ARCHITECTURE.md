# KIẾN TRÚC HỆ THỐNG ĐIỂM DANH SINH TRẮC HỌC VÀ MỞ KHOÁ PHÒNG KHÁM (2-VPS TOPOLOGY)

Hệ thống điểm danh bác sĩ và kiểm soát máy trạm phòng khám hoạt động theo mô hình phân tán 2 VPS:

```
┌────────────────────────────────────────────────────────┐         ┌───────────────────────────────────────────────────────┐
│                    VPS 1 (ỨNG DỤNG BỆNH VIỆN)          │         │                  VPS 2 (AI MICROSERVICE)              │
│                 pvminh94/qlbv (Port 3000 & 5000)       │         │           pvminh94/qlbs-attendance-web (Port 8001)   │
│                                                        │         │                                                       │
│  ┌───────────────────────┐   ┌───────────────────────┐ │         │  ┌──────────────────────────────────────────────────┐ │
│  │    Next.js 15 UI      │   │     NestJS API        │ │  HTTP   │  │              FastAPI AI Service                  │ │
│  │   /kiosk/[roomCode]   │   │  /api/kiosk/*         │─┼─────────┼─▶│  /detect-face       - Trích xuất khuôn mặt    │ │
│  │   /scan/[sessionId]   │   │  - QR Session Manager │ │  Port   │  │  /verify-liveness   - Thử thách ISO 30107     │ │
│  └───────────────────────┘   │  - SSE Real-time Sync │ │  8001   │  │  /compare-face      - So khớp ArcFace vector  │ │
│                              │  - Direct DB Duty Chk │ │         │  └──────────────────────────────────────────────────┘ │
│                              └───────────┬───────────┘ │         │                                                       │
│                                          │             │         │  - Tách biệt tải AI nặng (ArcFace, ONNX, OpenCV)     │
│                                          ▼             │         │  - Không ảnh hưởng đến CPU/RAM máy chủ bệnh viện      │
│                              ┌───────────────────────┐ │         └───────────────────────────────────────────────────────┘
│                              │   PostgreSQL (QLBV)   │ │
│                              │  - duty_assignments   │ │
│                              │  - user_biometrics    │ │
│                              │  - duty_attendance    │ │
│                              └───────────────────────┘ │
└────────────────────────────────────────────────────────┘
                       ▲                     ▲
            SSE Stream │                     │ HTTP Scan
                       │                     │
       ┌───────────────┴───────────────┐  ┌──┴────────────────────────┐
       │   Máy tính Windows phòng khám │  │ Smartphone Bác sĩ         │
       │   Edge / Chrome Kiosk (Full)  │  │ Quét QR -> Camera Liveness│
       │   Tự động mở khóa Desktop     │  │ WebRTC Canvas ISO 30107   │
       └───────────────────────────────┘  └───────────────────────────┘
```

---

## 1. PHÂN CÔNG TÀI NGUYÊN & MÔ HÌNH TRIỂN KHAI

### VPS 1: Máy chủ Hệ thống Bệnh viện (`pvminh94/qlbv`)
- **Vai trò:** Vận hành toàn bộ phần mềm QLBV (Quản lý bệnh nhân, viện phí, kho dược, lịch trực khám bệnh, Kiosk phòng khám).
- **Thành phần:**
  - **Backend (Port 5000):** NestJS + Drizzle ORM + PostgreSQL + Redis.
  - **Frontend (Port 3000):** Next.js 15.
    - Giao diện Kiosk máy trạm: `/kiosk/[roomCode]` (Ví dụ: `/kiosk/PK01`).
    - Giao diện Bác sĩ quét mặt: `/scan/[sessionId]`.
- **Cơ chế kiểm tra lịch trực:** Truy vấn trực tiếp các bảng `duty_assignments`, `duty_rooms`, `duty_slots`, `duty_shift_types` trong CSDL PostgreSQL. Độ trễ 0ms, không phụ thuộc API ngoài.
- **Lưu trữ sinh trắc học an toàn:** Vector đặc trưng khuôn mặt (512 chiều) được mã hóa bằng chuẩn AES-256-CBC trong bảng `user_biometrics`.

### VPS 2: Máy chủ Microservice Trí tuệ Nhân tạo (`pvminh94/qlbs-attendance-web`)
- **Vai trò:** Microservice AI chuyên trách nhận diện khuôn mặt và phát hiện giả mạo (Anti-Spoofing / PAD).
- **Thành phần:**
  - **FastAPI Container (Port 8001):** Kiến trúc stateless siêu nhẹ, tự khởi động lại qua Docker Compose.
  - **Mô hình AI:** ArcFace 512-dim embedding kết hợp thuật toán kiểm tra chuyển động mắt/khuôn mặt và tán xạ ánh sáng (Screen Flash Reflection) theo chuẩn ISO/IEC 30107-3 PAD.
- **Ưu điểm:** Tách tải tính toán ma trận AI ra khỏi VPS chính của bệnh viện; VPS chính luôn mượt mà phục vụ khám chữa bệnh.

---

## 2. QUY TRÌNH MỞ KHOÁ MÁY TRẠM PHÒNG KHÁM

1. **Khởi động máy tính phòng khám:**
   - Kịch bản Windows Kiosk tự động chạy trình duyệt toàn màn hình (`--kiosk --edge-kiosk-type=fullscreen`) mở trang `http://<IP_VPS_1>:3000/kiosk/PK01`.
   - Windows bị khoá các phím nguy hiểm (Win+D, Task Manager, Alt+Tab, cử chỉ vuốt mép màn hình).
   - Máy trạm hiển thị mã QR động (tự đổi sau mỗi 90 giây) và thiết lập kết nối Server-Sent Events (SSE) tới `/api/kiosk/events/PK01`.

2. **Bác sĩ đến nhận ca trực:**
   - Dùng Camera điện thoại quét mã QR trên màn hình máy tính.
   - Trình duyệt điện thoại mở trang quét khuôn mặt `/scan/<sessionId>`.
   - Bác sĩ thực hiện thử thách người thật (Chớp mắt tự nhiên / Giữ thẳng mặt).

3. **Xác thực và Đối soát:**
   - Điện thoại gửi ảnh chụp về VPS 1 (`/api/kiosk/verify-face`).
   - VPS 1 gọi sang VPS 2 (Port 8001) để lấy vector đặc trưng và kiểm tra PAD.
   - VPS 1 giải mã vector gốc của Bác sĩ trong PostgreSQL, tính khoảng cách Cosine Similarity.
   - Nếu độ tương đồng $\ge 0.60$ và Bác sĩ có lịch trực hợp lệ tại phòng khám này trong khung giờ hiện tại:
     - VPS 1 ghi nhật ký điểm danh vào bảng `duty_attendance`.
     - VPS 1 phát sự kiện SSE `UNLOCK_EVENT` tới máy trạm.

4. **Giải phóng Desktop máy trạm:**
   - Trình duyệt tại máy tính phòng khám nhận sự kiện mở khoá, tự động thoát chế độ toàn màn hình (`exitFullscreen()`).
   - Thanh công cụ Kiosk thu nhỏ thành Mini Dock ở góc màn hình.
   - Bác sĩ có toàn quyền thao tác trên màn hình Desktop Windows và các phần mềm chuyên môn.
   - Khi hết ca hoặc rời phòng, Bác sĩ chỉ cần bấm nút **"Khoá máy / Rời phòng"** trên Mini Dock để kích hoạt lại chế độ bảo vệ.

---

## 3. CƠ CHẾ BẢO VỆ CHỐNG XOÁ FILE VĨNH VIỄN TRÊN WINDOWS

Các tệp cấu hình tại thư mục `deploy/windows/`:
1. `khoa_toan_dien_kiosk.bat`: Khóa phím Windows, Win+D, Task Manager, thanh tác vụ Taskbar.
2. `cai_dat_chong_xoa_vinh_vien.bat`: Đưa file vào thư mục ẩn `C:\ProgramData\QLBS_Kiosk`, phân quyền NTFS `icacls` cấm người dùng xoá (`Deny Delete`), đồng thời đăng ký Windows Task Scheduler khởi động ngầm.
3. `chay_kiosk_phong_kham.bat`: Khởi chạy Edge/Chrome Kiosk kết nối tới VPS 1.
4. `go_bo_kiosk_it.bat` & `khoi_phuc_windows_mac_dinh.bat`: Kịch bản dành riêng cho IT bệnh viện khi cần bảo trì, khôi phục cài đặt mặc định của Windows.
