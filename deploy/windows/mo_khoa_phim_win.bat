@echo off
chcp 65001 >nul
:: ============================================================================
::  QLBS — KHÔI PHỤC LẠI PHÍM WINDOWS (DÀNH CHO IT KHI CẦN BẢO TRÌ)
:: ============================================================================

echo Đang khôi phục lại phím Windows và Win + D...

:: Xoá khoá NoWinKeys
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Policies\Explorer" /v "NoWinKeys" /f >nul 2>&1

:: Khởi động lại Windows Explorer
taskkill /f /im explorer.exe >nul 2>&1
start explorer.exe >nul 2>&1

echo.
echo [THÀNH CÔNG] Đã khôi phục lại phím Windows bình thường!
pause
