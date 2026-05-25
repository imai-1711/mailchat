@echo off
echo MailChat Local Server
echo =====================
echo Open in browser: http://localhost:8080
echo Press Ctrl+C to stop.
echo.
cd /d "%~dp0"
python -m http.server 8080
pause
