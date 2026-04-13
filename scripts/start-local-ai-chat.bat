@echo off
chcp 65001 >nul
setlocal

set "PROJECT_ROOT=%~dp0.."
cd /d "%PROJECT_ROOT%"
if not exist logs mkdir logs

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
  "$projectRoot = [System.IO.Path]::GetFullPath('%PROJECT_ROOT%');" ^
  "$logsDir = Join-Path $projectRoot 'logs';" ^
  "if (-not (Test-Path $logsDir)) { New-Item -ItemType Directory -Path $logsDir | Out-Null };" ^
  "$nodePath = $env:NVM_SYMLINK;" ^
  "if ([string]::IsNullOrWhiteSpace($nodePath) -or $nodePath -eq '%%NVM_SYMLINK%%') { $nodePath = 'node' } else { $nodePath = Join-Path $nodePath 'node.exe' };" ^
  "$process = Start-Process -FilePath $nodePath -ArgumentList 'server.js' -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru;" ^
  "Set-Content -Path (Join-Path $logsDir 'server.pid') -Value $process.Id;" ^
  "Add-Content -Path (Join-Path $logsDir 'server.log') -Value ((Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + ' started server pid=' + $process.Id);"
if errorlevel 1 (
  echo Background start failed.
  exit /b 1
)

echo Started server in background mode.
echo Access: http://127.0.0.1:8000
