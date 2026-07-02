@echo off
chcp 65001 >nul 2>&1
title Q-CLI Hub
cd /d "%~dp0"

echo ============================================
echo    Q-CLI Hub - Starting Server...
echo ============================================
echo.

:: 1) Check Node.js
where node >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js not found. Please install Node.js >= 18 from https://nodejs.org
    pause
    exit /b 1
)
echo [OK] Node.js found

:: 2) Install dependencies if missing
if not exist "node_modules\" (
    echo [INFO] Installing dependencies...
    call npm install
    if errorlevel 1 (
        echo [ERROR] npm install failed
        pause
        exit /b 1
    )
    echo [OK] Dependencies installed
)

:: 3) Pre-build the bundle
if exist "public\main.js" (
    echo [INFO] Building frontend bundle...
    call npm run build >nul 2>&1
    if errorlevel 1 (
        echo [WARN] Build had issues, continuing anyway...
    ) else (
        echo [OK] Bundle built
    )
)

:: 4) Check if already running
netstat -ano | findstr ":3001 " | findstr LISTENING >nul 2>&1
if not errorlevel 1 (
    echo [WARN] Port 3001 is already in use - server may already be running
    echo        Opening browser...
    start http://localhost:3001
    pause
    exit /b 0
)

:: 5) Start server minimized
echo [INFO] Starting node server.js...
start "Q-CLI Hub" /MIN cmd /c "node server.js > server.log 2>&1"

:: 6) Wait for port 3001 (max 15 seconds)
echo [INFO] Waiting for server on port 3001...
set WAIT=0
:WAIT_LOOP
ping -n 2 127.0.0.1 >nul
netstat -ano | findstr ":3001 " | findstr LISTENING >nul 2>&1
if not errorlevel 1 goto SERVER_UP
set /a WAIT+=2
if %WAIT% geq 15 (
    echo [ERROR] Server did not start within 15 seconds. Check server.log
    type server.log 2>nul
    pause
    exit /b 1
)
goto WAIT_LOOP

:SERVER_UP
echo [OK] Server running at http://localhost:3001

:: 7) Open browser
start http://localhost:3001
echo [OK] Browser opened

echo.
echo ============================================
echo    Q-CLI Hub is running.
echo    Close this window or run stop.bat to shutdown.
echo ============================================
echo.
pause

:: 8) On close: kill server
echo [INFO] Stopping server...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3001" ^| findstr "LISTENING"') do (
    taskkill /F /PID %%a >nul 2>&1
)
echo [OK] Server stopped.
