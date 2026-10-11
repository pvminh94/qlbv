@echo off
chcp 65001 >nul
:: ============================================================================
::  QLBS KIOSK — GỠ BỎ TỰ KHỞI ĐỘNG KIOSK (DÀNH RIÊNG CHO IT QUẢN TRỊ)
:: ============================================================================

net session >nul 2>&1
if %errorlevel% neq 0 (
    echo [CẢNH BÁO] Vui lòng chạy file này bằng chuột phải -> 'Run as administrator'!
    pause
    exit /b 1
)

set SECURE_DIR=C:\ProgramData\QLBS_Kiosk

echo Đang gỡ bỏ tác vụ Task Scheduler...
schtasks /delete /tn "QLBS_Attendance_Kiosk" /f >nul 2>&1

echo Đang xoá khoá HKLM Run...
reg delete "HKLM\Software\Microsoft\Windows\CurrentVersion\Run" /v "QLBS_Attendance_Kiosk" /f >nul 2>&1

echo Đang mở quyền thư mục và dọn dẹp...
icacls "%SECURE_DIR%" /reset /t >nul 2>&1
rd /s /q "%SECURE_DIR%" >nul 2>&1

echo.
echo [THÀNH CÔNG] Đã gỡ bỏ toàn bộ cơ chế tự khởi chạy Kiosk khỏi hệ thống!
pause
