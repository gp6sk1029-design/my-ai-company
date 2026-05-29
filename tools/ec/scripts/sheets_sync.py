"""
EC販売部門 - Googleスプレッドシート同期
SQLiteのデータをスプレッドシート「メルカリ出品管理」に同期する。
Apps Script ダッシュボードがこのシートを読み取ってスマホに表示する。

シート列:
  商品名 | 出品日 | 出品価格 | 仕入原価 | 送料 | 手数料 | 利益 | 利益率 | 発送方法 | ステータス

セットアップ:
  1. Google Drive に「メルカリ出品管理」スプレッドシートを新規作成
  2. URLから ID をコピーして ec/config.json の spreadsheet_id に設定
  3. 初回実行時に OAuth 認証ブラウザが開く
"""

import os
import pickle
import json
from datetime import datetime
from typing import Optional

from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from google.auth.transport.requests import Request
from googleapiclient.discovery import build


# ── 設定 ──

CREDENTIALS_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(__file__))),
    "blog", "google_credentials.json"
)
TOKEN_PATH = os.path.join(
    os.path.dirname(os.path.dirname(__file__)),
    "google_token_sheets.pickle"
)
CONFIG_PATH = os.path.join(
    os.path.dirname(os.path.dirname(__file__)),
    "config.json"
)

# Sheets API スコープ
SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]

SHEET_NAME = "出品管理"
HEADERS = ["商品名", "出品日", "出品価格", "仕入原価", "送料",
           "手数料", "利益", "利益率", "発送方法", "ステータス"]


def _load_spreadsheet_id() -> Optional[str]:
    """config.json から スプレッドシートID を読み込む"""
    try:
        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            config = json.load(f)
        return config.get("spreadsheet_id")
    except Exception:
        return None


def get_sheets_service():
    """Sheets API のサービスオブジェクトを取得する"""
    creds = None

    if os.path.exists(TOKEN_PATH):
        with open(TOKEN_PATH, "rb") as f:
            creds = pickle.load(f)

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            flow = InstalledAppFlow.from_client_secrets_file(
                CREDENTIALS_PATH, SCOPES
            )
            creds = flow.run_local_server(port=0)

        with open(TOKEN_PATH, "wb") as f:
            pickle.dump(creds, f)

    return build("sheets", "v4", credentials=creds)


def _get_or_create_sheet(service, spreadsheet_id: str) -> str:
    """
    「出品管理」シートを取得または作成し、ヘッダーが無ければ追加する
    Returns: シート名
    """
    meta = service.spreadsheets().get(spreadsheetId=spreadsheet_id).execute()
    existing = [s["properties"]["title"] for s in meta["sheets"]]

    if SHEET_NAME not in existing:
        # シートを新規追加
        service.spreadsheets().batchUpdate(
            spreadsheetId=spreadsheet_id,
            body={"requests": [{"addSheet": {"properties": {"title": SHEET_NAME}}}]}
        ).execute()
        # ヘッダー行を挿入
        service.spreadsheets().values().update(
            spreadsheetId=spreadsheet_id,
            range=f"{SHEET_NAME}!A1",
            valueInputOption="RAW",
            body={"values": [HEADERS]}
        ).execute()
    else:
        # ヘッダー確認（空なら追加）
        result = service.spreadsheets().values().get(
            spreadsheetId=spreadsheet_id,
            range=f"{SHEET_NAME}!A1:J1"
        ).execute()
        if not result.get("values"):
            service.spreadsheets().values().update(
                spreadsheetId=spreadsheet_id,
                range=f"{SHEET_NAME}!A1",
                valueInputOption="RAW",
                body={"values": [HEADERS]}
            ).execute()

    return SHEET_NAME


def _find_row_by_product(service, spreadsheet_id: str,
                          product_name: str) -> Optional[int]:
    """
    商品名で行番号を検索する（1始まり、見つからなければ None）
    """
    result = service.spreadsheets().values().get(
        spreadsheetId=spreadsheet_id,
        range=f"{SHEET_NAME}!A:A"
    ).execute()
    values = result.get("values", [])
    for i, row in enumerate(values):
        if row and row[0] == product_name:
            return i + 1  # 1始まり
    return None


def sync_to_sheets(listing_data: dict) -> bool:
    """
    出品データをスプレッドシートに追加または更新する。
    既存行があれば上書き、なければ末尾に追加。

    listing_data のキー:
        product_name (str)  : 商品名
        listed_at    (str)  : 出品日（ISO形式 or 日付文字列）
        listed_price (int)  : 出品価格
        cost_price   (int)  : 仕入原価
        shipping_cost(int)  : 送料
        platform_fee (int)  : 手数料
        profit       (int)  : 利益
        profit_margin(float): 利益率(%)
        shipping_method(str): 発送方法
        status       (str)  : ステータス
    """
    spreadsheet_id = _load_spreadsheet_id()
    if not spreadsheet_id:
        print("警告: config.json に spreadsheet_id が設定されていません。スキップします。")
        return False

    try:
        service = get_sheets_service()
        _get_or_create_sheet(service, spreadsheet_id)

        listed_at = listing_data.get("listed_at", "")
        if listed_at:
            listed_at = str(listed_at)[:10]  # YYYY-MM-DD のみ

        row_data = [
            listing_data.get("product_name", ""),
            listed_at or datetime.now().strftime("%Y-%m-%d"),
            listing_data.get("listed_price", 0),
            listing_data.get("cost_price", 0),
            listing_data.get("shipping_cost", 0),
            listing_data.get("platform_fee", 0),
            listing_data.get("profit", 0),
            round(listing_data.get("profit_margin", 0.0), 1),
            listing_data.get("shipping_method", ""),
            listing_data.get("status", "出品中"),
        ]

        product_name = listing_data.get("product_name", "")
        existing_row = _find_row_by_product(service, spreadsheet_id, product_name)

        if existing_row:
            # 既存行を上書き
            range_str = f"{SHEET_NAME}!A{existing_row}:J{existing_row}"
            service.spreadsheets().values().update(
                spreadsheetId=spreadsheet_id,
                range=range_str,
                valueInputOption="RAW",
                body={"values": [row_data]}
            ).execute()
            print(f"スプレッドシート更新: {product_name}（行 {existing_row}）")
        else:
            # 末尾に追加
            service.spreadsheets().values().append(
                spreadsheetId=spreadsheet_id,
                range=f"{SHEET_NAME}!A:J",
                valueInputOption="RAW",
                insertDataOption="INSERT_ROWS",
                body={"values": [row_data]}
            ).execute()
            print(f"スプレッドシート追加: {product_name}")

        return True

    except Exception as e:
        print(f"スプレッドシート同期エラー: {e}")
        return False


def update_status(product_name: str, new_status: str) -> bool:
    """
    商品のステータス列（J列）のみを更新する。
    record_sale() や update_listing_status() から呼ばれる。
    """
    spreadsheet_id = _load_spreadsheet_id()
    if not spreadsheet_id:
        return False

    try:
        service = get_sheets_service()
        _get_or_create_sheet(service, spreadsheet_id)

        row_num = _find_row_by_product(service, spreadsheet_id, product_name)
        if not row_num:
            print(f"スプレッドシート: 「{product_name}」の行が見つかりません")
            return False

        # J列（ステータス）のみ更新
        service.spreadsheets().values().update(
            spreadsheetId=spreadsheet_id,
            range=f"{SHEET_NAME}!J{row_num}",
            valueInputOption="RAW",
            body={"values": [[new_status]]}
        ).execute()
        print(f"ステータス更新: {product_name} → {new_status}")
        return True

    except Exception as e:
        print(f"ステータス更新エラー: {e}")
        return False


# ── テスト実行 ──

if __name__ == "__main__":
    print("スプレッドシート同期テスト\n")
    spreadsheet_id = _load_spreadsheet_id()
    if not spreadsheet_id:
        print("❌ config.json に spreadsheet_id が設定されていません")
        print("   Google Driveでスプレッドシートを作成し、IDを config.json に追加してください")
    else:
        print(f"✅ スプレッドシートID: {spreadsheet_id}")
        result = sync_to_sheets({
            "product_name": "テスト商品",
            "listed_at": datetime.now().strftime("%Y-%m-%d"),
            "listed_price": 5000,
            "cost_price": 0,
            "shipping_cost": 210,
            "platform_fee": 500,
            "profit": 4290,
            "profit_margin": 85.8,
            "shipping_method": "ネコポス",
            "status": "出品中"
        })
        print("✅ 同期成功" if result else "❌ 同期失敗")
