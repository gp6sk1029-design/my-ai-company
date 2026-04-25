"""
Google Apps Script 自動デプロイスクリプト
3ファイルを自動でApps Scriptにアップロードし、ウェブアプリとしてデプロイする

実行方法:
    cd ec/scripts
    python3 deploy_apps_script.py
"""

import os
import sys
import json
import pickle

from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from google.auth.transport.requests import Request
from googleapiclient.discovery import build

# ── パス設定 ──
BASE_DIR       = os.path.dirname(os.path.dirname(__file__))
CREDENTIALS    = os.path.join(os.path.dirname(BASE_DIR), "blog", "google_credentials.json")
TOKEN_PATH     = os.path.join(BASE_DIR, "google_token_apps_script.pickle")
APPS_SCRIPT_DIR = os.path.join(BASE_DIR, "apps_script")

# Apps Script API に必要なスコープ
SCOPES = [
    "https://www.googleapis.com/auth/script.projects",
    "https://www.googleapis.com/auth/script.deployments",
    "https://www.googleapis.com/auth/drive.file",
]


def get_service():
    """Apps Script API サービスを取得する"""
    creds = None
    if os.path.exists(TOKEN_PATH):
        with open(TOKEN_PATH, "rb") as f:
            creds = pickle.load(f)

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            flow = InstalledAppFlow.from_client_secrets_file(CREDENTIALS, SCOPES)
            creds = flow.run_local_server(port=0)
        with open(TOKEN_PATH, "wb") as f:
            pickle.dump(creds, f)

    return build("script", "v1", credentials=creds)


def read_file(filename):
    path = os.path.join(APPS_SCRIPT_DIR, filename)
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


def deploy():
    print("=" * 50)
    print("📦 Apps Script 自動デプロイ開始")
    print("=" * 50)

    service = get_service()

    # ── Step 1: プロジェクト作成 ──
    print("\n① Apps Script プロジェクトを作成中...")
    project = service.projects().create(
        body={"title": "メルカリ出品管理"}
    ).execute()
    script_id = project["scriptId"]
    print(f"   ✅ 作成完了 (scriptId: {script_id})")

    # ── Step 2: ファイルをアップロード ──
    print("\n② ファイルをアップロード中...")
    manifest = json.dumps({
        "timeZone": "Asia/Tokyo",
        "dependencies": {},
        "exceptionLogging": "STACKDRIVER",
        "runtimeVersion": "V8",
        "webapp": {
            "executeAs": "USER_DEPLOYING",
            "access": "ANYONE"
        }
    }, ensure_ascii=False)

    files = [
        {
            "name": "appsscript",
            "type": "JSON",
            "source": manifest
        },
        {
            "name": "コード",
            "type": "SERVER_JS",
            "source": read_file("mercari_uploader.gs")
        },
        {
            "name": "index",
            "type": "HTML",
            "source": read_file("index.html")
        },
        {
            "name": "test_input",
            "type": "HTML",
            "source": read_file("test_input.html")
        },
    ]

    service.projects().updateContent(
        scriptId=script_id,
        body={"files": files}
    ).execute()
    print("   ✅ 2ファイルをアップロード完了")
    print("      - コード.gs（サーバー処理）")
    print("      - index.html（アップロード＋ダッシュボード統合）")

    # ── Step 3: バージョンを作成 ──
    print("\n③ バージョンを作成中...")
    version = service.projects().versions().create(
        scriptId=script_id,
        body={"description": "v1.0 初回リリース"}
    ).execute()
    version_number = version["versionNumber"]
    print(f"   ✅ バージョン {version_number} を作成")

    # ── Step 4: ウェブアプリとしてデプロイ ──
    print("\n④ ウェブアプリとしてデプロイ中...")
    deployment = service.projects().deployments().create(
        scriptId=script_id,
        body={
            "versionNumber": version_number,
            "manifestFileName": "appsscript",
            "description": "メルカリ出品管理アプリ v1.0",
        }
    ).execute()

    # デプロイIDからウェブアプリURLを生成
    deployment_id = deployment.get("deploymentId", "")
    web_app_url = (
        f"https://script.google.com/macros/s/{deployment_id}/exec"
    )

    # ── 結果表示 ──
    print("\n" + "=" * 50)
    print("🎉 デプロイ完了！")
    print("=" * 50)
    print(f"\n📱 スマホ用URL:")
    print(f"   アップロード画面: {web_app_url}")
    print(f"   ダッシュボード:   {web_app_url}?page=dashboard")
    print(f"\n🔗 Apps Script 管理画面:")
    print(f"   https://script.google.com/home/projects/{script_id}/edit")
    print("\n💡 このURLをスマホのホーム画面に追加してください")

    # URLをファイルに保存
    url_file = os.path.join(BASE_DIR, "web_app_url.txt")
    with open(url_file, "w") as f:
        f.write(f"アップロード画面: {web_app_url}\n")
        f.write(f"ダッシュボード:   {web_app_url}?page=dashboard\n")
        f.write(f"Apps Script ID: {script_id}\n")
        f.write(f"デプロイID: {deployment_id}\n")
    print(f"\n📄 URLを保存しました: ec/web_app_url.txt")

    return web_app_url


if __name__ == "__main__":
    try:
        deploy()
    except Exception as e:
        print(f"\n❌ エラーが発生しました: {e}")
        print("\n💡 ヒント: Apps Script API が有効になっていない可能性があります")
        print("   以下のURLで有効化してください:")
        print("   https://console.developers.google.com/apis/api/script.googleapis.com")
        sys.exit(1)
