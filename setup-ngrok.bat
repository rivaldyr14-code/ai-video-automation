@echo off
echo ========================================
echo   Setup Ngrok Authtoken
echo ========================================
echo.
echo   Buka: https://dashboard.ngrok.com/get-started/your-authtoken
echo   Copy token-nya lalu paste di bawah ini:
echo.
set /p TOKEN="Authtoken: "
ngrok config add-authtoken %TOKEN%
echo.
echo [✓] Authtoken berhasil disimpan!
echo.
pause