@echo off
chcp 65001 >nul
:: ============================================================================
::  QLBS KIOSK — HUỶ TỰ ĐỘNG KHỞI ĐỘNG CÙNG WINDOWS
:: ============================================================================

set STARTUP_FOLDER=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup
set TARGET_FILE=%STARTUP_FOLDER%\chay_kiosk_phong_kham.bat

if exist "%TARGET_FILE%" (
    del /f /q "%TARGET_FILE%" >nul
    echo [THÀNH CÔNG] Đã huỷ chế độ tự động khởi chạy Kiosk khi mở máy!
) else (
    echo [THÔNG BÁO] Kiosk hiện chưa được cài đặt trong thư mục Startup.
)

pause
