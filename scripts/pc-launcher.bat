@echo off
setlocal
if not exist "%~dp0runtime\node.exe" (
  echo Runtime bulunamadi. ZIP dosyasinin tamamini bir klasore cikart.
  pause
  exit /b 1
)
set ATLAS_OPEN_BROWSER=1
start "Takip Atlasi PC" /min "%~dp0runtime\node.exe" "%~dp0scripts\serve.js"
echo Takip Atlasi PC baslatildi: http://127.0.0.1:4173
endlocal
