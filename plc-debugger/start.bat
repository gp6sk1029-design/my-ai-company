@echo off
chcp 65001 > nul
title PLC Craft AI - 起動中

echo ========================================
echo   PLC Craft AI 起動スクリプト
echo ========================================
echo.

:: Node.js パスを設定
set PATH=C:\Program Files\nodejs;%PATH%

:: API キーを設定
set GEMINI_API_KEY=AIzaSyDEFsQcZI2mGqaz3an9aSUA9OudChtXh78

:: バックエンドサーバーを別ウィンドウで起動
echo [1/2] バックエンドサーバー起動中 (port 3001)...
start "PLC Craft AI - Backend" cmd /k "cd /d %~dp0server && set GEMINI_API_KEY=AIzaSyDEFsQcZI2mGqaz3an9aSUA9OudChtXh78 && set PATH=C:\Program Files\nodejs;%PATH% && npx tsx src/index.ts"

:: 少し待つ
timeout /t 3 /nobreak > nul

:: フロントエンドを別ウィンドウで起動
echo [2/2] フロントエンド起動中 (port 5173)...
start "PLC Craft AI - Frontend" cmd /k "cd /d %~dp0client && set PATH=C:\Program Files\nodejs;%PATH% && npx vite --host"

:: 少し待つ
timeout /t 5 /nobreak > nul

echo.
echo ========================================
echo   起動完了！
echo   ブラウザで以下にアクセスしてください:
echo   http://localhost:5173
echo ========================================
echo.
echo このウィンドウは閉じても構いません。
echo サーバーを止めるには Backend/Frontend の
echo ウィンドウを閉じてください。
echo.
pause
