"""
EC販売部門 - Google Drive連携
「メルカリ出品」フォルダ内の商品フォルダから写真を自動取得する。

フォルダ構造:
  メルカリ出品/
  ├── AirPods Pro/
  │   ├── 写真1.jpg
  │   ├── 写真2.jpg
  │   └── 写真3.jpg
  ├── ニンテンドースイッチ/
  │   ├── 本体.jpg
  │   └── 箱.jpg
  └── ...

ブログ部門で使っている認証情報(google_credentials.json)を共有して使用する。
"""

import io
import os
import pickle
from typing import Optional

from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from google.auth.transport.requests import Request
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload


# ── 設定 ──

# 認証情報のパス（ブログ部門と共有）
CREDENTIALS_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(__file__))),
    "blog", "google_credentials.json"
)
# EC部門用のトークン（ブログとは別にDriveスコープで認証）
TOKEN_PATH = os.path.join(
    os.path.dirname(os.path.dirname(__file__)),
    "google_token_drive.pickle"
)
# 写真をダウンロードするローカルディレクトリ
DOWNLOAD_DIR = os.path.join(
    os.path.dirname(os.path.dirname(__file__)),
    "data", "photos"
)
# Google Drive APIのスコープ（読み書き）
SCOPES = ["https://www.googleapis.com/auth/drive"]

# 親フォルダ名
ROOT_FOLDER_NAME = "メルカリ"


def get_drive_service():
    """Google Drive APIのサービスオブジェクトを取得する"""
    creds = None

    # 保存済みトークンがあれば読み込み
    if os.path.exists(TOKEN_PATH):
        with open(TOKEN_PATH, "rb") as f:
            creds = pickle.load(f)

    # トークンがない or 期限切れの場合
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            flow = InstalledAppFlow.from_client_secrets_file(
                CREDENTIALS_PATH, SCOPES
            )
            creds = flow.run_local_server(port=0)

        # トークンを保存
        with open(TOKEN_PATH, "wb") as f:
            pickle.dump(creds, f)

    return build("drive", "v3", credentials=creds)


# ── フォルダ操作 ──

def find_folder_by_name(service, name: str, parent_id: str = None) -> Optional[str]:
    """フォルダ名からフォルダIDを検索する"""
    query = f"name = '{name}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false"
    if parent_id:
        query += f" and '{parent_id}' in parents"

    results = service.files().list(
        q=query,
        spaces="drive",
        fields="files(id, name)",
        pageSize=10
    ).execute()

    files = results.get("files", [])
    return files[0]["id"] if files else None


def get_root_folder_id(service) -> Optional[str]:
    """「メルカリ出品」親フォルダのIDを取得する"""
    return find_folder_by_name(service, ROOT_FOLDER_NAME)


def list_product_folders(service, root_folder_id: str = None) -> list:
    """
    「メルカリ出品」フォルダ内の商品フォルダ一覧を取得する

    Returns: [{"id": "xxx", "name": "AirPods Pro"}, ...]
    """
    if not root_folder_id:
        root_folder_id = get_root_folder_id(service)
        if not root_folder_id:
            print(f"エラー: 「{ROOT_FOLDER_NAME}」フォルダが見つかりません")
            return []

    query = f"'{root_folder_id}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false"
    results = service.files().list(
        q=query,
        spaces="drive",
        fields="files(id, name, createdTime, modifiedTime)",
        orderBy="modifiedTime desc",
        pageSize=100
    ).execute()

    return results.get("files", [])


def list_photos_in_folder(service, folder_id: str) -> list:
    """
    指定フォルダ内の画像ファイル一覧を取得する

    Returns: [{"id": "xxx", "name": "写真1.jpg", "size": "1234567", "thumbnailLink": "..."}, ...]
    """
    query = (
        f"'{folder_id}' in parents and trashed = false and "
        f"(mimeType contains 'image/')"
    )
    results = service.files().list(
        q=query,
        spaces="drive",
        fields="files(id, name, mimeType, size, thumbnailLink, imageMediaMetadata)",
        orderBy="name",
        pageSize=20
    ).execute()

    return results.get("files", [])


# ── 写真ダウンロード ──

def download_photo(service, file_id: str, file_name: str,
                   product_folder: str) -> str:
    """
    Google Driveから写真をダウンロードする

    Returns: ダウンロードしたファイルのローカルパス
    """
    # 商品ごとのダウンロードフォルダを作成
    local_dir = os.path.join(DOWNLOAD_DIR, product_folder)
    os.makedirs(local_dir, exist_ok=True)

    local_path = os.path.join(local_dir, file_name)

    # 既にダウンロード済みならスキップ
    if os.path.exists(local_path):
        return local_path

    request = service.files().get_media(fileId=file_id)
    fh = io.BytesIO()
    downloader = MediaIoBaseDownload(fh, request)

    done = False
    while not done:
        _, done = downloader.next_chunk()

    with open(local_path, "wb") as f:
        f.write(fh.getvalue())

    return local_path


def download_all_photos(service, folder_id: str,
                        product_name: str) -> list:
    """
    商品フォルダの全写真をダウンロードする

    Returns: ダウンロードしたファイルパスのリスト
    """
    photos = list_photos_in_folder(service, folder_id)
    local_paths = []

    for photo in photos:
        path = download_photo(
            service,
            file_id=photo["id"],
            file_name=photo["name"],
            product_folder=product_name
        )
        local_paths.append(path)

    return local_paths


# ── 一括取得（メイン関数） ──

def get_all_products_with_photos() -> list:
    """
    「メルカリ出品」フォルダ内の全商品と写真を取得する

    Returns: [
        {
            "product_name": "AirPods Pro",
            "folder_id": "xxx",
            "photos": [
                {"id": "xxx", "name": "写真1.jpg", "size": "1234567"},
                ...
            ],
            "photo_count": 3
        },
        ...
    ]
    """
    service = get_drive_service()
    root_id = get_root_folder_id(service)

    if not root_id:
        print(f"エラー: 「{ROOT_FOLDER_NAME}」フォルダが見つかりません。")
        print("Google Driveに「メルカリ出品」フォルダを作成してください。")
        return []

    folders = list_product_folders(service, root_id)
    products = []

    for folder in folders:
        photos = list_photos_in_folder(service, folder["id"])
        products.append({
            "product_name": folder["name"],
            "folder_id": folder["id"],
            "photos": photos,
            "photo_count": len(photos),
            "modified_time": folder.get("modifiedTime", "")
        })

    return products


def get_product_photos(product_name: str) -> dict:
    """
    特定の商品フォルダから写真を取得・ダウンロードする

    Returns: {
        "product_name": "AirPods Pro",
        "folder_id": "xxx",
        "photos": [...],
        "local_paths": ["/path/to/photo1.jpg", ...],
        "photo_count": 3
    }
    """
    service = get_drive_service()
    root_id = get_root_folder_id(service)

    if not root_id:
        return {"error": f"「{ROOT_FOLDER_NAME}」フォルダが見つかりません"}

    folder_id = find_folder_by_name(service, product_name, root_id)
    if not folder_id:
        return {"error": f"「{product_name}」フォルダが見つかりません"}

    photos = list_photos_in_folder(service, folder_id)
    local_paths = download_all_photos(service, folder_id, product_name)

    return {
        "product_name": product_name,
        "folder_id": folder_id,
        "photos": photos,
        "local_paths": local_paths,
        "photo_count": len(photos)
    }


# ── レポート ──

def print_inventory_report():
    """Google Drive上の出品候補一覧をレポート表示する"""
    products = get_all_products_with_photos()

    if not products:
        print("出品候補がありません。")
        return

    print(f"【Google Drive出品候補一覧】")
    print(f"フォルダ: {ROOT_FOLDER_NAME}/")
    print(f"商品数: {len(products)}件\n")

    for i, p in enumerate(products, 1):
        print(f"{i}. {p['product_name']}")
        print(f"   写真: {p['photo_count']}枚")
        if p['photos']:
            for photo in p['photos']:
                size_kb = int(photo.get('size', 0)) // 1024
                print(f"   - {photo['name']} ({size_kb}KB)")
        print()


# ── テスト実行 ──

if __name__ == "__main__":
    print("Google Drive連携テスト\n")
    print("「メルカリ出品」フォルダの商品一覧を取得します...\n")
    print_inventory_report()
