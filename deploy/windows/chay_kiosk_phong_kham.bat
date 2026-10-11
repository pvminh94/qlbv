@echo off
chcp 65001 >nul
:: ============================================================================
::  QLBS KIOSK — LỆNH KHỞI CHẠY TOÀN MÀN HÌNH CHỐNG CAN THIỆP & CHE TASKBAR
:: ============================================================================
::  Thay đổi địa chỉ IP máy chủ và mã phòng khám dưới đây cho đúng với phòng bạn:
set SERVER_IP=192.168.1.50
set PORT=3000
set ROOM_CODE=PK01

set URL=http://%SERVER_IP%:%PORT%/kiosk/%ROOM_CODE%

echo Đang khởi chạy QLBS Kiosk cho phòng %ROOM_CODE%...
echo Địa chỉ máy chủ: %URL%

:: Tìm kiếm đường dẫn Microsoft Edge trên Windows 10/11
set EDGE_PATH="C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
if not exist %EDGE_PATH% set EDGE_PATH="C:\Program Files\Microsoft\Edge\Application\msedge.exe"

:: Giải thích các cờ chống can thiệp y tế:
::  --kiosk                                : Chế độ Kiosk toàn màn hình
::  --edge-kiosk-type=fullscreen           : CHE HOÀN TOÀN THANH TASKBAR WINDOWS
::  --no-first-run                         : Bỏ qua cửa sổ chào mừng
::  --disable-translate                    : TẮT HOÀN TOÀN THÔNG BÁO DỊCH TIẾNG ANH
::  --disable-features=Translate...        : Chặn tính năng dịch và cử chỉ cuộn đổi trang
::  --disable-infobars                     : Chặn thanh cảnh báo vàng của trình duyệt
::  --disable-session-crashed-bubble       : Không hiện bảng hỏi "Khôi phục tab" khi mất điện
::  --disable-notifications                : Chặn thông báo web làm phiền
::  --overscroll-history-navigation=0      : Chặn vuốt màn hình cảm ứng để lùi lại trang
::  --disable-pinch                        : Chặn chụm ngón tay thu phóng màn hình
::  --kiosk-printing                       : Tối ưu in ấn hoá đơn y tế
start "" %EDGE_PATH% --kiosk "%URL%" ^
  --edge-kiosk-type=fullscreen ^
  --no-first-run ^
  --disable-translate ^
  --disable-features=Translate,TranslateUI,TouchpadAndWheelScrollLatching,PreloadMediaEngagementData ^
  --disable-infobars ^
  --disable-session-crashed-bubble ^
  --disable-notifications ^
  --overscroll-history-navigation=0 ^
  --disable-pinch ^
  --kiosk-printing

exit
