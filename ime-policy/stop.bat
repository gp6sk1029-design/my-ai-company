@echo off
chcp 65001 >nul
title IME 2026経営方針 - 停止

set PORT=8090

echo ポート %PORT% のサーバーを停止します...

set FOUND=0
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%PORT%" ^| findstr "LISTENING"') do (
  taskkill /F /PID %%a >nul 2>nul
  set FOUND=1
)

if "%FOUND%"=="1" (
  echo 停止しました。
) else (
  echo 起動中のサーバーは見つかりませんでした。
)

timeout /t 2 /nobreak >nul
exit /b 0
