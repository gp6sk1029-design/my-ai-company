"""
EC販売部門 - Google Drive 新着フォルダ検知
「メルカリ」DriveフォルダのうちSQLiteに未登録のものを検出する。
Claude Code のスケジュールタスクから定期的に呼ばれ、
新商品フォルダが見つかれば出品パイプラインを起動する合図を返す。

使い方:
    python drive_watcher.py          # 未処理フォルダを表示
    python drive_watcher.py --json   # JSON形式で出力（パイプライン連携用）
"""

import sys
import json
import os

# 同一パッケージのモジュール
sys.path.insert(0, os.path.dirname(__file__))
from google_drive import get_drive_service, get_root_folder_id, list_product_folders
from inventory_db import init_db, get_connection


def get_registered_folder_ids() -> set:
    """
    inventory テーブルに登録済みの drive_folder_id を取得する。
    drive_folder_id が NULL のものは除外。
    """
    conn = get_connection()
    rows = conn.execute(
        "SELECT drive_folder_id FROM inventory WHERE drive_folder_id IS NOT NULL"
    ).fetchall()
    conn.close()
    return {row["drive_folder_id"] for row in rows}


def get_unprocessed_folders() -> list:
    """
    Google Drive「メルカリ」フォルダのうち、SQLiteに未登録のものを返す。

    Returns:
        [
            {
                "product_name": "AirPods Pro",
                "folder_id": "1abc...",
                "photo_count": 3,
                "modified_time": "2026-04-09T12:34:56.000Z"
            },
            ...
        ]
    """
    service = get_drive_service()
    root_id = get_root_folder_id(service)

    if not root_id:
        print(f"エラー: 「メルカリ」フォルダがDriveに見つかりません")
        return []

    # Drive上の全フォルダ
    drive_folders = list_product_folders(service, root_id)

    # 登録済みフォルダIDのセット
    registered_ids = get_registered_folder_ids()

    # 未登録のみ抽出
    unprocessed = []
    for folder in drive_folders:
        if folder["id"] not in registered_ids:
            # 写真枚数を取得（Drive APIを使わず件数のみ）
            from google_drive import list_photos_in_folder
            photos = list_photos_in_folder(service, folder["id"])
            unprocessed.append({
                "product_name": folder["name"],
                "folder_id": folder["id"],
                "photo_count": len(photos),
                "modified_time": folder.get("modifiedTime", "")
            })

    return unprocessed


def mark_as_registered(product_name: str, folder_id: str):
    """
    在庫テーブルの drive_folder_id を更新して「処理済み」にする。
    出品パイプライン完了後に呼び出す。
    """
    conn = get_connection()
    conn.execute("""
        UPDATE inventory
        SET drive_folder_id = ?, updated_at = datetime('now', 'localtime')
        WHERE name = ? AND drive_folder_id IS NULL
        ORDER BY created_at DESC
        LIMIT 1
    """, (folder_id, product_name))
    conn.commit()
    conn.close()
    print(f"処理済みマーク: {product_name} (folder_id={folder_id})")


def print_report(folders: list):
    """未処理フォルダのレポートを表示する"""
    if not folders:
        print("✅ 未処理の商品フォルダはありません（全て出品済みまたは未アップロード）")
        return

    print(f"【未処理フォルダ一覧】{len(folders)}件\n")
    for i, f in enumerate(folders, 1):
        date_str = f["modified_time"][:10] if f["modified_time"] else "不明"
        print(f"{i}. {f['product_name']}")
        print(f"   写真: {f['photo_count']}枚")
        print(f"   最終更新: {date_str}")
        print(f"   フォルダID: {f['folder_id']}")
        print()

    print("▶ 出品パイプラインを実行するには:")
    print("  各商品について run_ec_pipeline.get_listing_pipeline() を実行してください")


# ── メイン実行 ──

if __name__ == "__main__":
    init_db()

    folders = get_unprocessed_folders()

    if "--json" in sys.argv:
        print(json.dumps(folders, ensure_ascii=False, indent=2))
    else:
        print_report(folders)
