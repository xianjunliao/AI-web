@echo off

echo 正在启动 NapCat...
start "NapCat" cmd /k "cd /d ""E:\NapCat.Shell.Windows.OneKey\NapCat.44498.Shell"" && .\NapCatWinBootMain.exe"

echo 正在启动 AstrBot...
start "AstrBot" cmd /k "cd /d ""E:\astrbot"" && astrbot run"

echo 正在启动本地 AI 聊天服务...
start "Local AI Chat" cmd /k "cd /d ""E:\AI文件\AI web"" && node server.js"

echo 全部启动命令已发出。
