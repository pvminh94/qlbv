@echo off
chcp 65001 >nul
:: ============================================================================
::  QLBS KIOSK — TỰ ĐỘNG CÀI ĐẶT KHỞI ĐỘNG CÙNG WINDOWS (1 CLICK)
:: ============================================================================

set SCRIPT_DIR=%~dp0
set TARGET_BAT=%SCRIPT_DIR%chay_kiosk_phong_kham.bat
set STARTUP_FOLDER=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup

if not exist "%TARGET_BAT%" (
    echo [LỖI] Không tìm thấy file chay_kiosk_phong_kham.bat trong cung thu muc!
    pause
    exit /b 1
)

echo Đang cài đặt Kiosk tự động chạy khi mở máy...
copy /Y "%TARGET_BAT%" "%STARTUP_FOLDER%\chay_kiosk_phong_kham.bat" >nul

if %errorlevel% equ 0 (
    echo.
    echo ============================================================================
    echo   [THÀNH CÔNG] ĐÃ CÀI ĐẶT TỰ ĐỘNG KHỞI CHẠY KIOSK!
    echo ============================================================================
    echo  Kể từ bây giờ:
    echo  - Mỗi khi bật máy tính lên, Kiosk sẽ TỰ ĐỘNG bung toàn màn hình.
    echo  - Không cần tạo shortcut ngoài Desktop.
    echo  - Không cần bấm chuột bất kỳ nút nào.
    echo ============================================================================
) else (
    echo [LỖI] Không thể chép file vào thư mục Startup. Vui lòng thử lại.
)

pause
