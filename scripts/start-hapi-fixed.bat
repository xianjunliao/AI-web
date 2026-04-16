@echo off
echo Starting HAPI full stack...

cd /d E:\works\project\AI-web

REM 1. daemon
start cmd /k "hapi daemon start"

timeout /t 2 >nul

REM 2. relay
start cmd /k "hapi hub --relay"

timeout /t 2 >nul

REM 3. codex
start cmd /k "cd /d E:\works\project\AI-web && hapi codex"

echo All services started.
pause
