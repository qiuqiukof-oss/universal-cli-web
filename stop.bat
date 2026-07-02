@echo off
chcp 65001 >nul 2>&1
title Q-CLI Hub - Stop
cd /d "%~dp0"

echo ============================================
echo    Stopping Q-CLI Hub Server...
echo ============================================
echo.

set FOUND=0

for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3001" ^| findstr "LISTENING"') do (
    taskkill /F /PID %%a >nul 2>&1
    if errorlevel 1 (
        echo [WARN] Found PID %%a on port 3001 but could not terminate.
    ) else (
        echo [OK] Process on port 3001 ^(PID %%a^) terminated.
        set FOUND=1
    )
)

echo.
if "%FOUND%"=="1" (
    echo [OK] Q-CLI Hub server stopped.
) else (
    echo [INFO] No running Q-CLI Hub server on port 3001.
)
echo.
pause
