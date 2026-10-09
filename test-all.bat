@echo off
chcp 65001 >nul
echo.
echo =========================================================================
echo    ĐANG KHỞI CHẠY KIỂM THỬ TOÀN BỘ FRONTEND, BACKEND VÀ DATABASE MYSQL...
echo =========================================================================
echo.
cd /d "%~dp0frontend"
npm test
pause
