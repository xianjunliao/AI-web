@echo off
chcp 65001 >nul
setlocal

cd /d "%~dp0"
if not exist logs mkdir logs

wscript.exe "%~dp0start-local-ai-chat.vbs"
if errorlevel 1 (
  echo Background start failed.
  timeout /t 3 /nobreak >nul
  exit /b 1
)

echo Started in fully hidden background mode.
echo Access: http://127.0.0.1:8000
timeout /t 2 /nobreak >nul
