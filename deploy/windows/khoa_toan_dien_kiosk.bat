@echo off
chcp 65001 >nul
:: ============================================================================
::  QLBS KIOSK — KHOÁ TOÀN DIỆN BẢO VỆ MÁY TRẠM PHÒNG KHÁM TRÊN WINDOWS 10/11
:: ============================================================================
::  Kịch bản chuẩn hoá cho máy trạm y tế:
::   1. Vô hiệu hoá phím Windows & tất cả tổ hợp Win (Win+D, Win+M, Win+R, Win+X...)
::   2. Vô hiệu hoá Trình quản lý tác vụ Task Manager (Ctrl+Shift+Esc, Ctrl+Alt+Del)
::   3. Vô hiệu hoá vuốt cảm ứng từ mép màn hình (Edge Swipe trên màn All-in-One)
::   4. Vô hiệu hoá phím dính Sticky Keys (bấm Shift 5 lần không còn hiện bảng phụ)
::   5. Vô hiệu hoá tự động mở ổ đĩa USB (Chặn cắm USB hiện cửa sổ đè lên màn hình)
::   6. Vô hiệu hoá thông báo bong bóng hệ thống (Chặn thông báo Windows đè lên Kiosk)
:: ============================================================================

echo ============================================================================
echo   QLBS ATTENDANCE — ĐANG KÍCH HOẠT CHÍNH SÁCH BẢO VỆ KIOSK TOÀN DIỆN
echo ============================================================================
echo.

:: Kiểm tra quyền Administrator
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo [LƯU Ý] Khuyến nghị chạy bằng chuột phải -> 'Run as administrator' để khoá sâu vào hệ thống.
)

:: 1. Vô hiệu hoá phím Windows & Win + D, Win + M, Win + R, Win + E, Win + X, Win + S
echo [1/6] Đang khoá phím Windows và Win + D...
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\Explorer" /v "NoWinKeys" /t REG_DWORD /d 1 /f >nul 2>&1
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\Explorer" /v "NoRun" /t REG_DWORD /d 1 /f >nul 2>&1

:: 2. Vô hiệu hoá Task Manager (Chặn Ctrl+Shift+Esc & menu Ctrl+Alt+Del)
echo [2/6] Đang vô hiệu hoá Task Manager...
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\System" /v "DisableTaskMgr" /t REG_DWORD /d 1 /f >nul 2>&1

:: 3. Vô hiệu hoá cử chỉ vuốt mép màn hình cảm ứng (Edge Swipe trên AIO PC)
echo [3/6] Đang khoá cử chỉ vuốt màn hình cảm ứng...
reg add "HKCU\Software\Policies\Microsoft\Windows\EdgeUI" /v "AllowEdgeSwipe" /t REG_DWORD /d 0 /f >nul 2>&1
reg add "HKLM\SOFTWARE\Policies\Microsoft\Windows\EdgeUI" /v "AllowEdgeSwipe" /t REG_DWORD /d 0 /f >nul 2>&1

:: 4. Vô hiệu hoá phím Sticky Keys, Filter Keys, Toggle Keys (Chặn bấm Shift 5 lần)
echo [4/6] Đang khoá phím trợ năng (Shift 5 lần Sticky Keys)...
reg add "HKCU\Control Panel\Accessibility\StickyKeys" /v "Flags" /t REG_SZ /d "506" /f >nul 2>&1
reg add "HKCU\Control Panel\Accessibility\Keyboard Response" /v "Flags" /t REG_SZ /d "122" /f >nul 2>&1
reg add "HKCU\Control Panel\Accessibility\ToggleKeys" /v "Flags" /t REG_SZ /d "58" /f >nul 2>&1

:: 5. Vô hiệu hoá AutoPlay USB (Chặn cắm USB hiện bảng đè lên Kiosk)
echo [5/6] Đang vô hiệu hoá AutoPlay khi cắm USB...
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\AutoplayHandlers" /v "DisableAutoplay" /t REG_DWORD /d 1 /f >nul 2>&1
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\Explorer" /v "NoDriveTypeAutoRun" /t REG_DWORD /d 255 /f >nul 2>&1

:: 6. Vô hiệu hoá thông báo Toast Notifications của Windows đè lên màn hình
echo [6/6] Đang chặn thông báo bong bóng hệ thống...
reg add "HKCU\Software\Policies\Microsoft\Windows\CurrentVersion\PushNotifications" /v "NoToastApplicationNotification" /t REG_DWORD /d 1 /f >nul 2>&1

:: Tái khởi động Explorer để áp dụng hiệu lực ngay lập tức
echo.
echo Đang nạp lại Windows Explorer để áp dụng các chính sách...
taskkill /f /im explorer.exe >nul 2>&1
start explorer.exe >nul 2>&1

echo.
echo ============================================================================
echo   [HOÀN TẤT] MÁY TRẠM PHÒNG KHÁM ĐÃ ĐƯỢC BẢO VỆ 100%!
echo ============================================================================
echo  - Người dùng KHÔNG THỂ dùng Win + D, Win + M, Win + R.
echo  - KHÔNG THỂ mở Task Manager bằng Ctrl + Shift + Esc.
echo  - KHÔNG THỂ bấm Shift 5 lần để hiện hộp thoại trợ năng.
echo  - KHÔNG THỂ vuốt từ mép màn hình cảm ứng để đổi ứng dụng.
echo  - KHÔNG THỂ cắm USB để kích hoạt cửa sổ AutoPlay.
echo.
echo  Khi IT cần bảo trì máy tính, chạy file: khoi_phuc_windows_mac_dinh.bat
echo ============================================================================
pause
