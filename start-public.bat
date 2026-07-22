@echo off
echo ========================================
echo   AI Video Automation - Public Server
echo ========================================
echo.

REM Check ngrok authtoken
ngrok config check 2>nul
if %errorlevel% neq 0 (
    echo [!] Ngrok authtoken belum di-setup
    echo     Jalankan: ngrok config add-authtoken YOUR_TOKEN
    echo.
    pause
    exit /b 1
)

echo [1/3] Starting local server on port 3001...
start "AI Video Server" cmd /k "cd /d D:\project portofolio\ai-video-automation && node server.js"
timeout /t 3 /nobreak >nul

echo [2/3] Starting ngrok tunnel on port 3001...
start "ngrok" cmd /k "ngrok http 3001 --log=stdout"
timeout /t 5 /nobreak >nul

echo [3/3] Getting public URL...
echo.
echo ========================================
echo   SERVER RUNNING!
echo ========================================
echo.
echo   Local:  http://localhost:3001
echo   Public: Check ngrok window for URL
echo.
echo   URL format: https://xxxx-xxx-xxx.ngrok-free.app
echo.
echo   Copy URL ini dan paste ke Vercel dashboard
echo   untuk connect ke server lokal kamu.
echo.
echo ========================================
echo.
pause