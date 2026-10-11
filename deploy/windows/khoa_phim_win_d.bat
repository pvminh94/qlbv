@echo off
chcp 65001 >nul
:: ============================================================================
::  QLBS — KHOÁ PHÍM WINDOWS (CHẶN TRIỆT ĐỂ PHÍM WIN + D, WIN + M RA DESKTOP)
:: ============================================================================
::  Chính sách Registry có sẵn của Windows (Không cần cài bất kỳ phần mềm nào)
::  Khi kích hoạt: Phím Windows, Win+D, Win+M, Win+R, Win+E sẽ bị vô hiệu hoá.

echo ============================================================
echo   ĐANG KÍCH HOẠT CHÍNH SÁCH KHOÁ PHÍM WIN + D TRÊN WINDOWS
echo ============================================================

:: 1. Thêm khoá NoWinKeys vào Registry người dùng hiện tại
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\Explorer" /v "NoWinKeys" /t REG_DWORD /d 1 /f >nul 2>&1

:: 2. Khởi động lại Windows Explorer để áp dụng ngay lập tức
echo Đang nạp lại Windows Explorer...
taskkill /f /im explorer.exe >nul 2>&1
start explorer.exe >nul 2>&1

echo.
echo [THÀNH CÔNG] Đã vô hiệu hoá phím Win + D và phím Windows trên máy tính này!
echo Người dùng thông thường không thể dùng Win+D để thoát ra màn hình Desktop.
echo.
echo Khi cần khôi phục lại, hãy chạy file: mo_khoa_phim_win.bat
pause
