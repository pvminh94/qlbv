@echo off
chcp 65001 >nul
:: ============================================================================
::  QLBS KIOSK — KHÔI PHỤC LẠI WINDOWS MẶC ĐỊNH (DÀNH CHO IT BẢO TRÌ)
:: ============================================================================

echo ============================================================================
echo   ĐANG KHÔI PHỤC LẠI BÀN PHÍM, TASK MANAGER VÀ WINDOWS VỀ MẶC ĐỊNH...
echo ============================================================================

:: 1. Khôi phục phím Windows
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\Explorer" /v "NoWinKeys" /f >nul 2>&1
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\Explorer" /v "NoRun" /f >nul 2>&1

:: 2. Khôi phục Task Manager
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\System" /v "DisableTaskMgr" /f >nul 2>&1

:: 3. Khôi phục vuốt màn hình cảm ứng
reg delete "HKCU\Software\Policies\Microsoft\Windows\EdgeUI" /v "AllowEdgeSwipe" /f >nul 2>&1
reg delete "HKLM\SOFTWARE\Policies\Microsoft\Windows\EdgeUI" /v "AllowEdgeSwipe" /f >nul 2>&1

:: 4. Khôi phục phím trợ năng
reg add "HKCU\Control Panel\Accessibility\StickyKeys" /v "Flags" /t REG_SZ /d "510" /f >nul 2>&1
reg add "HKCU\Control Panel\Accessibility\Keyboard Response" /v "Flags" /t REG_SZ /d "126" /f >nul 2>&1
reg add "HKCU\Control Panel\Accessibility\ToggleKeys" /v "Flags" /t REG_SZ /d "62" /f >nul 2>&1

:: 5. Khôi phục AutoPlay
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\AutoplayHandlers" /v "DisableAutoplay" /f >nul 2>&1
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\Explorer" /v "NoDriveTypeAutoRun" /f >nul 2>&1

:: 6. Khôi phục thông báo
reg delete "HKCU\Software\Policies\Microsoft\Windows\CurrentVersion\PushNotifications" /v "NoToastApplicationNotification" /f >nul 2>&1

:: Nạp lại Windows Explorer
taskkill /f /im explorer.exe >nul 2>&1
start explorer.exe >nul 2>&1

echo.
echo [THÀNH CÔNG] Đã khôi phục toàn bộ cài đặt Windows về bình thường!
echo Bàn phím Windows, phím Win+D, Task Manager đã hoạt động lại.
pause
