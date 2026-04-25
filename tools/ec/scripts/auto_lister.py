"""
EC販売部門 - 自動出品スクリプト
ダッシュボードから送られた出品キューを処理し、
Claude in Chrome MCP でメルカリに自動出品する。

このスクリプトは Claude Code から実行される想定:
    python3 ec/scripts/auto_lister.py

Claude Code が Chrome MCP を使ってブラウザ操作を行う際に、
このスクリプトの出力（手順書）を参照する。

安全対策:
  - 1日の出品上限: 10件（config.jsonで変更可能）
  - 各操作間にランダム遅延: 3〜8秒
  - 出品ログを記録
"""

import os
import sys
import json
from datetime import datetime

sys.path.insert(0, os.path.dirname(__file__))

from mercari_browser import (
    ListingData,
    get_listing_procedure,
    format_procedure_for_claude,
    can_list_today,
    record_listing,
    get_random_delay,
)

BASE_DIR = os.path.dirname(os.path.dirname(__file__))
QUEUE_PATH = os.path.join(BASE_DIR, "data", "listing_queue.json")


def load_queue():
    """出品キューを読み込む"""
    try:
        with open(QUEUE_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return []


def save_queue(queue):
    """出品キューを保存する"""
    os.makedirs(os.path.dirname(QUEUE_PATH), exist_ok=True)
    with open(QUEUE_PATH, "w", encoding="utf-8") as f:
        json.dump(queue, f, ensure_ascii=False, indent=2)


def process_queue():
    """キュー内の出品リクエストを処理する"""
    queue = load_queue()
    pending = [q for q in queue if q.get("status") == "pending"]

    if not pending:
        print("📭 出品キューに未処理の商品はありません")
        return

    can_list, count, limit = can_list_today()
    print(f"\n📦 出品キュー: {len(pending)}件の未処理商品")
    print(f"📊 本日の出品状況: {count}/{limit}件\n")

    if not can_list:
        print(f"⚠️ 本日の出品上限（{limit}件）に達しています。明日再実行してください。")
        return

    for i, item in enumerate(pending):
        if not can_list_today()[0]:
            print(f"\n⚠️ 出品上限に達しました。残り{len(pending) - i}件は明日処理されます。")
            break

        product_name = item.get("product_name", "")
        price = item.get("price", 0)
        description = item.get("description", "")
        shipping_method = item.get("shipping_method", "")

        print(f"\n{'='*50}")
        print(f"📦 商品 {i+1}/{len(pending)}: {product_name}")
        print(f"💰 価格: ¥{price:,}")
        print(f"📦 発送: {shipping_method}")
        print(f"{'='*50}")

        # 出品データを構築
        listing_data = ListingData(
            title=product_name[:40],
            description=description,
            category="",  # Claudeが画像を見て判断
            condition="目立った傷や汚れなし",
            price=price,
            shipping_method=shipping_method or "らくらくメルカリ便",
            photo_paths=[],  # Driveの写真をClaude が取得
        )

        # Claude用の手順書を出力
        procedure = get_listing_procedure(listing_data)
        print(f"\n{format_procedure_for_claude(procedure)}")

        # キューのステータスを更新
        item["status"] = "processing"
        item["processed_at"] = datetime.now().isoformat()
        save_queue(queue)

        # 出品をログに記録
        record_listing()

        print(f"\n✅ 出品手順を出力しました。Claude in Chrome MCP で実行してください。")
        print(f"   遅延: {get_random_delay():.1f}秒後に次の商品へ\n")

    # 処理済みに更新
    for item in queue:
        if item.get("status") == "processing":
            item["status"] = "completed"
    save_queue(queue)

    print(f"\n🎉 出品キューの処理が完了しました！")


if __name__ == "__main__":
    process_queue()
