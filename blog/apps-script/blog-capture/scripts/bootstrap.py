#!/usr/bin/env python3
"""
bootstrap.py
─────────────────────────────────────────────
既存の Python Google OAuth（drive scope）を使って以下を自動化する：

1. token.pickle をリフレッシュ
2. Drive 上で「ブロブ関連」フォルダの ID を自動取得
3. Drive にログ用 Google スプレッドシートを作成（無ければ）
4. blog/config.json の material_uploader セクションを更新
5. Config.gs の setup() 関数内の ID を実値に書き換える

Usage:
  python3 bootstrap.py

前提:
  /Users/shoheikoda/Documents/my-ai-company/blog/google_credentials.json
  /Users/shoheikoda/Documents/my-ai-company/blog/google_token.pickle
"""

from __future__ import annotations
import json
import pickle
import re
import sys
from pathlib import Path

from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from googleapiclient.discovery import build

ROOT = Path(__file__).resolve().parents[4]  # my-ai-company/
BLOG_ROOT = ROOT / 'blog'
TOKEN_PATH = BLOG_ROOT / 'google_token.pickle'
CREDS_PATH = BLOG_ROOT / 'google_credentials.json'
CONFIG_PATH = BLOG_ROOT / 'config.json'
CONFIG_GS_PATH = BLOG_ROOT / 'apps-script' / 'blog-capture' / 'Config.gs'

TARGET_FOLDER_PATH = ['個人事業', '副業関連', 'ブロブ関連']
LOG_SPREADSHEET_NAME = 'blog-capture_ログ'


def load_creds() -> Credentials:
    """既存の token.pickle を読み込み、expired なら refresh"""
    if not TOKEN_PATH.exists():
        raise SystemExit(f'❌ {TOKEN_PATH} が見つかりません')
    with TOKEN_PATH.open('rb') as f:
        creds = pickle.load(f)
    if creds.expired and creds.refresh_token:
        print('🔄 トークンをリフレッシュ中...')
        creds.refresh(Request())
        with TOKEN_PATH.open('wb') as f:
            pickle.dump(creds, f)
        print('✅ トークン更新完了')
    if not creds.valid:
        raise SystemExit('❌ トークンが無効。google_token.pickle を再生成してください')
    return creds


def find_folder_id(drive, path_parts: list[str]) -> str:
    """Drive のマイドライブ配下でパスを辿ってフォルダ ID を返す"""
    parent = 'root'
    for name in path_parts:
        # 名前にスペースが入っていてもエスケープ
        safe = name.replace("'", "\\'")
        q = (
            f"name = '{safe}' and "
            f"mimeType = 'application/vnd.google-apps.folder' and "
            f"'{parent}' in parents and trashed = false"
        )
        res = drive.files().list(q=q, fields='files(id,name)', pageSize=5).execute()
        files = res.get('files', [])
        if not files:
            raise SystemExit(f"❌ フォルダが見つかりません: {'/'.join(path_parts)} (探索中: {name})")
        parent = files[0]['id']
        print(f'  📁 {name} → {parent}')
    return parent


def find_or_create_spreadsheet(drive, name: str) -> str:
    """Drive 上で指定名のスプレッドシートを検索、無ければ作成"""
    q = (
        f"name = '{name}' and "
        f"mimeType = 'application/vnd.google-apps.spreadsheet' and "
        f"trashed = false"
    )
    res = drive.files().list(q=q, fields='files(id,name)', pageSize=5).execute()
    files = res.get('files', [])
    if files:
        sid = files[0]['id']
        print(f'  📊 既存スプレッドシート検出: {name} → {sid}')
        return sid
    # 作成
    print(f'  📊 スプレッドシート作成中: {name}')
    body = {
        'name': name,
        'mimeType': 'application/vnd.google-apps.spreadsheet',
    }
    created = drive.files().create(body=body, fields='id').execute()
    sid = created['id']
    print(f'  ✅ 作成完了: {sid}')
    return sid


def update_config_json(folder_id: str, spreadsheet_id: str, allowed_email: str) -> None:
    with CONFIG_PATH.open('r', encoding='utf-8') as f:
        config = json.load(f)
    mu = config.setdefault('material_uploader', {})
    mu['drive_root_folder_id'] = folder_id
    mu['log_spreadsheet_id'] = spreadsheet_id
    mu['allowed_email'] = allowed_email
    # gas_web_app_url は clasp deploy 後に別途埋める
    with CONFIG_PATH.open('w', encoding='utf-8') as f:
        json.dump(config, f, ensure_ascii=False, indent=2)
    print(f'  ✅ {CONFIG_PATH.relative_to(ROOT)} 更新完了')


def update_config_gs(folder_id: str, spreadsheet_id: str, allowed_email: str) -> None:
    """Config.gs の setup() 関数内の ID を実値に書き換える"""
    content = CONFIG_GS_PATH.read_text(encoding='utf-8')
    replacements = [
        ('YOUR_BROG_KANREN_FOLDER_ID_HERE', folder_id),
        ('YOUR_LOG_SPREADSHEET_ID_HERE', spreadsheet_id),
    ]
    for old, new in replacements:
        if old in content:
            content = content.replace(old, new)
            print(f'  ✅ 置換: {old[:30]}... → {new[:20]}...')
        else:
            # すでに置換済みかも
            print(f'  ℹ️ {old[:30]}... は既に置換済み')
    # allowed_email も更新
    content = re.sub(
        r"ALLOWED_EMAIL: '[^']*'",
        f"ALLOWED_EMAIL: '{allowed_email}'",
        content,
    )
    CONFIG_GS_PATH.write_text(content, encoding='utf-8')
    print(f'  ✅ {CONFIG_GS_PATH.relative_to(ROOT)} 更新完了')


def get_allowed_email(creds) -> str:
    """トークンから現在の Google アカウントを取得"""
    oauth2 = build('oauth2', 'v2', credentials=creds, cache_discovery=False)
    try:
        info = oauth2.userinfo().get().execute()
        return info.get('email', '')
    except Exception:
        # scopes に userinfo.email が無い場合は config.json のデフォルト
        with CONFIG_PATH.open('r', encoding='utf-8') as f:
            return json.load(f).get('material_uploader', {}).get('allowed_email', '')


def main() -> int:
    print('🚀 blog-capture 自動セットアップ開始\n')

    print('[1/4] OAuth トークン確認')
    creds = load_creds()
    email = get_allowed_email(creds) or 'gp6sk1029@gmail.com'
    print(f'  👤 使用アカウント: {email}\n')

    print('[2/4] Drive フォルダ ID 取得')
    drive = build('drive', 'v3', credentials=creds, cache_discovery=False)
    folder_id = find_folder_id(drive, TARGET_FOLDER_PATH)
    print(f'  🎯 ブロブ関連フォルダ ID: {folder_id}\n')

    print('[3/4] ログ用スプレッドシート準備')
    spreadsheet_id = find_or_create_spreadsheet(drive, LOG_SPREADSHEET_NAME)
    print()

    print('[4/4] 設定ファイル更新')
    update_config_json(folder_id, spreadsheet_id, email)
    update_config_gs(folder_id, spreadsheet_id, email)
    print()

    print('✅ 自動セットアップ完了')
    print()
    print('─── 次に実行するコマンド ───')
    print('  cd blog/apps-script/blog-capture')
    print('  clasp login           # ← 初回のみ、ブラウザでGoogle認証')
    print('  clasp create --title blog-capture --type webapp --rootDir .')
    print('  clasp push -f')
    print('  clasp run setup       # ← Config.gs の setup() を実行')
    print('  clasp deploy --description "v1"')
    print()
    return 0


if __name__ == '__main__':
    sys.exit(main())
