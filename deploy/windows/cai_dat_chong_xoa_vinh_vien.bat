@echo off
chcp 65001 >nul
:: ============================================================================
::  QLBS KIOSK — CÀI ĐẶT TỰ ĐỘNG CHỐNG XOÁ / CHỐNG GỠ VĨNH VIỄN TRÊN WINDOWS
:: ============================================================================
::  Cơ chế bảo mật cấp Enterprise:
::   1. Lưu tệp khởi chạy vào thư mục hệ thống ẩn: C:\ProgramData\QLBS_Kiosk
::   2. Phân quyền bảo mật NTFS (icacls): Người dùng thông thường BỊ CẤM XOÁ HOẶC SỬA.
::   3. Khởi chạy bằng Windows Task Scheduler & HKLM Run (Chạy ngầm ở cấp hệ thống).
::   4. Người dùng mở thư mục Startup (shell:startup) sẽ hoàn toàn KHÔNG THẤY file nào để xoá!
:: ============================================================================

echo ============================================================================
echo   QLBS ATTENDANCE — ĐANG CÀI ĐẶT CƠ CHẾ TỰ ĐỘNG KHỞI CHẠY CHỐNG XOÁ TỆP
echo ============================================================================
echo.

:: Kiểm tra quyền Quản trị viên Administrator
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo [CẢNH BÁO] Bắt buộc chạy bằng quyền Quản trị viên (Administrator)!
    echo Hãy nhấp chuột phải vào file này -> Chọn 'Run as administrator'.
    echo.
    pause
    exit /b 1
)

set SECURE_DIR=C:\ProgramData\QLBS_Kiosk
set SCRIPT_DIR=%~dp0

:: 1. Tạo thư mục hệ thống ẩn
if not exist "%SECURE_DIR%" mkdir "%SECURE_DIR%"

:: 2. Sao chép file khởi chạy vào thư mục hệ thống an toàn
echo [1/4] Đang sao chép kịch bản Kiosk vào thư mục bảo mật %SECURE_DIR%...
copy /Y "%SCRIPT_DIR%chay_kiosk_phong_kham.bat" "%SECURE_DIR%\chay_kiosk_phong_kham.bat" >nul
if exist "%SCRIPT_DIR%khoa_toan_dien_kiosk.bat" copy /Y "%SCRIPT_DIR%khoa_toan_dien_kiosk.bat" "%SECURE_DIR%\khoa_toan_dien_kiosk.bat" >nul

:: 3. Phân quyền NTFS (icacls): Chỉ cho phép Administrator & SYSTEM toàn quyền.
::    Người dùng thông thường (Users/Everyone) chỉ có quyền Đọc & Thực thi, BỊ CẤM XOÁ (Deny Delete).
echo [2/4] Đang phân quyền NTFS chống người dùng xoá hoặc sửa tệp...
icacls "%SECURE_DIR%" /inheritance:r /grant:r "SYSTEM":(OI)(CI)F /grant:r "Administrators":(OI)(CI)F /grant:r "Users":(OI)(CI)RX >nul 2>&1
icacls "%SECURE_DIR%\*.*" /inheritance:r /grant:r "SYSTEM":F /grant:r "Administrators":F /grant:r "Users":RX >nul 2>&1

:: 4. Đăng ký tác vụ hệ thống ngầm qua Windows Task Scheduler (Chạy ở quyền cao nhất khi Logon)
echo [3/4] Đang đăng ký tác vụ ngầm Task Scheduler (OnLogon)...
schtasks /create /tn "QLBS_Attendance_Kiosk" /tr "\"%SECURE_DIR%\chay_kiosk_phong_kham.bat\"" /sc onlogon /rl highest /f >nul 2>&1

:: 5. Đăng ký dự phòng vào HKLM Run (Khóa máy cấp hệ thống - User thường không có quyền truy cập)
echo [4/4] Đang đăng ký khóa HKLM Machine Run...
reg add "HKLM\Software\Microsoft\Windows\CurrentVersion\Run" /v "QLBS_Attendance_Kiosk" /t REG_SZ /d "\"%SECURE_DIR%\chay_kiosk_phong_kham.bat\"" /f >nul 2>&1

:: 6. Dọn dẹp thư mục Startup cá nhân nếu trước đó có file (Ẩn hoàn toàn khỏi tầm mắt người dùng)
set USER_STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup
if exist "%USER_STARTUP%\chay_kiosk_phong_kham.bat" del /f /q "%USER_STARTUP%\chay_kiosk_phong_kham.bat" >nul 2>&1

echo.
echo ============================================================================
echo   [HOÀN TẤT THÀNH CÔNG] HỆ THỐNG ĐÃ ĐƯỢC BẢO VỆ CHỐNG XOÁ 100%!
echo ============================================================================
echo  - Người dùng vào thư mục Startup (shell:startup) sẽ KHÔNG THẤY bất kỳ file nào.
echo  - File gốc được giấu trong C:\ProgramData\QLBS_Kiosk với quyền khoá NTFS.
echo  - Kể cả khi tìm thấy file, người dùng bấm Delete thì Windows cũng BÁO LỖI
echo    "You need permission from Administrators" và KHÔNG CHO XOÁ!
echo  - Máy tính bật lên là tự động kích hoạt Kiosk qua Task Scheduler hệ thống.
echo.
echo  Khi IT cần gỡ bỏ, chạy file: go_bo_kiosk_it.bat (Chạy với quyền Administrator).
echo ============================================================================
pause
