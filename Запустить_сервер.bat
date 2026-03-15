@echo off
cd /d "%~dp0"
echo ============================================
echo   Club Manager Web - Запуск...
echo ============================================
py -m pip install flask -q
echo.
echo   Открой на компьютере:  http://localhost:5000
echo.
for /f "tokens=2 delims=:" %%i in ('ipconfig ^| findstr /i "IPv4"') do (
  set IP=%%i
  goto :found
)
:found
set IP=%IP: =%
echo   На телефоне (Wi-Fi):   http://%IP%:5000
echo ============================================
echo.
py app.py
pause
