@echo off
chcp 65001 >nul
title IME 2026経営方針

REM ── このバッチがある場所へ移動（日本語パスでもOK）
cd /d "%~dp0"

set PORT=8090
set URL=http://localhost:%PORT%/

echo ============================================
echo   IME 2026経営方針 を起動します
echo ============================================
echo.

REM ── Python の存在確認
where python >nul 2>nul
if errorlevel 1 (
  echo [エラー] Python が見つかりません。
  echo Python をインストールしてから、もう一度このファイルを実行してください。
  pause
  exit /b 1
)

REM ── 既存サーバー（同ポート）を停止してから起動（再起動時の競合防止）
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%PORT%" ^| findstr "LISTENING"') do (
  taskkill /F /PID %%a >nul 2>nul
)

echo ローカルサーバーを起動中... (ポート %PORT%)
start "IME-policy-server" /min python -m http.server %PORT% --directory "%~dp0public"

REM ── サーバー起動を少し待ってからブラウザを開く
timeout /t 1 /nobreak >nul

echo ブラウザを開きます: %URL%
start "" "%URL%"

echo.
echo --------------------------------------------
echo  ブラウザが開かない場合は、手動で次を開いてください:
echo    %URL%
echo.
echo  終了するときは stop.bat を実行してください。
echo --------------------------------------------
echo.
pause
