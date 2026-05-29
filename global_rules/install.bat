@echo off
REM ~/.claude/CLAUDE.md に社内AI開発ルールをインストール／同期する（Windows版）
REM
REM 使い方: install.bat をダブルクリック、またはコマンドプロンプトで実行

setlocal

set SCRIPT_DIR=%~dp0
set SOURCE=%SCRIPT_DIR%CLAUDE_global.md
set TARGET_DIR=%USERPROFILE%\.claude
set TARGET=%TARGET_DIR%\CLAUDE.md

REM ソース確認
if not exist "%SOURCE%" (
    echo [ERROR] ソースファイルが見つかりません: %SOURCE%
    pause
    exit /b 1
)

REM ターゲットディレクトリ作成
if not exist "%TARGET_DIR%" mkdir "%TARGET_DIR%"

REM ターゲットが存在しない場合、新規コピー
if not exist "%TARGET%" (
    copy /Y "%SOURCE%" "%TARGET%" > nul
    echo [OK] 新規作成: %TARGET%
    pause
    exit /b 0
)

REM 差分チェック（fc を使用）
fc /b "%SOURCE%" "%TARGET%" > nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo [OK] 既に最新です。変更なし。
    pause
    exit /b 0
)

REM バックアップ（日時付き）
for /f "tokens=2 delims==" %%a in ('wmic OS Get localdatetime /value') do set dt=%%a
set BACKUP=%TARGET%.bak_%dt:~0,8%_%dt:~8,6%
copy /Y "%TARGET%" "%BACKUP%" > nul
copy /Y "%SOURCE%" "%TARGET%" > nul

echo [OK] 更新完了: %TARGET%
echo [OK] バックアップ: %BACKUP%
pause
