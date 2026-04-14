"""
EC販売部門 - メルカリブラウザ自動化
Claude in Chrome MCP を使ったメルカリの操作手順を定義する。

※ このファイルは直接実行するスクリプトではなく、
   Claude がブラウザ操作を行う際の手順書・参照用モジュールとして機能する。
   実際の操作は Claude in Chrome MCP のツール経由で実行される。
"""

import json
import os
import random
import time
from dataclasses import dataclass, field
from typing import Optional


# 設定読み込み
CONFIG_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "config.json")


def load_config() -> dict:
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def get_random_delay() -> float:
    """ToSリスク軽減用のランダム遅延秒数を返す（3〜8秒）"""
    config = load_config()
    delay_range = config["platforms"]["mercari"].get("operation_delay_sec", [3, 8])
    return random.uniform(delay_range[0], delay_range[1])


# ── 安全対策：日次出品上限管理 ──

LISTING_LOG_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "listing_log.json")


def get_today_listing_count() -> int:
    """今日の出品回数を返す"""
    from datetime import datetime
    today = datetime.now().strftime("%Y-%m-%d")
    try:
        with open(LISTING_LOG_PATH, "r") as f:
            log = json.load(f)
        return log.get(today, 0)
    except (FileNotFoundError, json.JSONDecodeError):
        return 0


def record_listing():
    """出品を1件記録する"""
    from datetime import datetime
    today = datetime.now().strftime("%Y-%m-%d")
    try:
        with open(LISTING_LOG_PATH, "r") as f:
            log = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        log = {}

    log[today] = log.get(today, 0) + 1

    os.makedirs(os.path.dirname(LISTING_LOG_PATH), exist_ok=True)
    with open(LISTING_LOG_PATH, "w") as f:
        json.dump(log, f)


def can_list_today() -> tuple:
    """
    今日出品可能かチェックする。
    Returns: (可能かどうか, 今日の出品数, 上限)
    """
    config = load_config()
    limit = config["platforms"]["mercari"].get("daily_listing_limit", 10)
    count = get_today_listing_count()
    return (count < limit, count, limit)


# ── ブラウザ操作手順（Claude in Chrome MCPへの指示テンプレート） ──

@dataclass
class BrowserStep:
    """ブラウザ操作の1ステップ"""
    action: str           # 操作の種類
    description: str      # 操作の説明（日本語）
    selector: str = ""    # CSSセレクタまたは検索クエリ
    value: str = ""       # 入力値
    wait_sec: float = 0   # 操作後の待機時間


@dataclass
class BrowserProcedure:
    """ブラウザ操作の手順書"""
    name: str
    description: str
    steps: list = field(default_factory=list)


# ── セッション確認 ──

def get_session_check_procedure() -> BrowserProcedure:
    """メルカリへのログイン状態を確認する手順を生成する"""
    return BrowserProcedure(
        name="メルカリセッション確認",
        description="メルカリにログイン済みかどうかを確認する",
        steps=[
            BrowserStep(
                action="navigate",
                description="メルカリのマイページに移動",
                value="https://jp.mercari.com/mypage"
            ),
            BrowserStep(
                action="wait",
                description="ページ読み込み待機",
                wait_sec=3.0
            ),
            BrowserStep(
                action="check_login",
                description=(
                    "ページ内容を確認し、ログイン状態を判定する。\n"
                    "- マイページが表示されていれば → ログイン済み（続行OK）\n"
                    "- ログイン画面にリダイレクトされていれば → 未ログイン\n"
                    "  → ユーザーに手動ログインを依頼する\n"
                    "  ※ パスワードの自動入力は行わない（セキュリティ上禁止）"
                )
            ),
        ]
    )


# ── メルカリURL生成 ──

MERCARI_BASE = "https://jp.mercari.com"


def search_url(keyword: str, status: str = "sold") -> str:
    """
    メルカリ検索URLを生成する

    status:
      - "sold": 売り切れ（相場調査用）
      - "on_sale": 販売中
      - "all": すべて
    """
    import urllib.parse
    encoded = urllib.parse.quote(keyword)
    base = f"{MERCARI_BASE}/search/?keyword={encoded}"
    if status == "sold":
        base += "&status=sold"
    elif status == "on_sale":
        base += "&status=on_sale"
    return base


def listing_url() -> str:
    """出品ページのURLを返す"""
    return f"{MERCARI_BASE}/sell"


def mypage_url() -> str:
    """マイページのURLを返す"""
    return f"{MERCARI_BASE}/mypage"


def item_url(item_id: str) -> str:
    """商品ページのURLを返す"""
    return f"{MERCARI_BASE}/item/{item_id}"


# ── 相場調査手順 ──

def get_market_research_procedure(keyword: str) -> BrowserProcedure:
    """相場調査のブラウザ操作手順を生成する"""
    return BrowserProcedure(
        name="メルカリ相場調査",
        description=f"「{keyword}」の相場をメルカリで調査する",
        steps=[
            BrowserStep(
                action="navigate",
                description=f"メルカリの検索結果ページ（売り切れ品）に移動",
                value=search_url(keyword, "sold")
            ),
            BrowserStep(
                action="wait",
                description="ページ読み込み待機",
                wait_sec=get_random_delay()
            ),
            BrowserStep(
                action="read_page",
                description="SOLD品の価格一覧を読み取る（最大20件）"
            ),
            BrowserStep(
                action="extract_data",
                description="各商品の価格・状態・販売日を構造化データとして抽出"
            ),
            BrowserStep(
                action="navigate",
                description=f"出品中の商品ページに移動",
                value=search_url(keyword, "on_sale")
            ),
            BrowserStep(
                action="wait",
                description="ページ読み込み待機",
                wait_sec=get_random_delay()
            ),
            BrowserStep(
                action="read_page",
                description="出品中商品の価格一覧を読み取る（競合調査）"
            ),
        ]
    )


# ── 出品手順 ──

@dataclass
class ListingData:
    """出品データ"""
    title: str
    description: str
    category: str
    condition: str
    price: int
    shipping_payer: str = "出品者負担"
    shipping_method: str = "らくらくメルカリ便"
    photo_paths: list = field(default_factory=list)


def get_listing_procedure(data: ListingData) -> BrowserProcedure:
    """出品のブラウザ操作手順を生成する"""
    return BrowserProcedure(
        name="メルカリ出品",
        description=f"「{data.title}」をメルカリに出品する",
        steps=[
            BrowserStep(
                action="navigate",
                description="メルカリ出品ページに移動",
                value=listing_url()
            ),
            BrowserStep(
                action="wait",
                description="ページ読み込み待機",
                wait_sec=get_random_delay()
            ),
            # 写真アップロード
            BrowserStep(
                action="upload_photos",
                description="商品写真をアップロード",
                value=json.dumps(data.photo_paths)
            ),
            BrowserStep(
                action="wait",
                description="写真アップロード待機",
                wait_sec=get_random_delay()
            ),
            # タイトル入力
            BrowserStep(
                action="fill",
                description="商品名を入力",
                selector="商品名の入力フィールド",
                value=data.title
            ),
            # 説明文入力
            BrowserStep(
                action="fill",
                description="商品説明を入力",
                selector="商品説明の入力フィールド",
                value=data.description
            ),
            # カテゴリ選択
            BrowserStep(
                action="select",
                description=f"カテゴリ「{data.category}」を選択",
                selector="カテゴリ選択ボタン",
                value=data.category
            ),
            # 商品状態選択
            BrowserStep(
                action="select",
                description=f"商品の状態「{data.condition}」を選択",
                selector="商品の状態選択",
                value=data.condition
            ),
            # 配送料負担
            BrowserStep(
                action="select",
                description=f"配送料の負担「{data.shipping_payer}」を選択",
                selector="配送料の負担選択",
                value=data.shipping_payer
            ),
            # 配送方法
            BrowserStep(
                action="select",
                description=f"配送方法「{data.shipping_method}」を選択",
                selector="配送の方法選択",
                value=data.shipping_method
            ),
            # 価格入力
            BrowserStep(
                action="fill",
                description=f"販売価格「¥{data.price:,}」を入力",
                selector="販売価格の入力フィールド",
                value=str(data.price)
            ),
            BrowserStep(
                action="wait",
                description="入力内容確認のための待機",
                wait_sec=get_random_delay()
            ),
            # 出品実行
            BrowserStep(
                action="click",
                description="「出品する」ボタンをクリック",
                selector="出品するボタン"
            ),
            BrowserStep(
                action="wait",
                description="出品完了確認の待機",
                wait_sec=get_random_delay()
            ),
            BrowserStep(
                action="verify",
                description="出品完了画面が表示されていることを確認する"
            ),
        ]
    )


# ── 価格変更手順 ──

def get_price_update_procedure(item_id: str, new_price: int) -> BrowserProcedure:
    """価格変更のブラウザ操作手順を生成する"""
    return BrowserProcedure(
        name="メルカリ価格変更",
        description=f"商品{item_id}の価格を¥{new_price:,}に変更する",
        steps=[
            BrowserStep(
                action="navigate",
                description="商品ページに移動",
                value=item_url(item_id)
            ),
            BrowserStep(
                action="wait",
                description="ページ読み込み待機",
                wait_sec=get_random_delay()
            ),
            BrowserStep(
                action="click",
                description="「商品の編集」ボタンをクリック",
                selector="商品の編集ボタン"
            ),
            BrowserStep(
                action="wait",
                description="編集ページ読み込み待機",
                wait_sec=get_random_delay()
            ),
            BrowserStep(
                action="clear_and_fill",
                description=f"価格を¥{new_price:,}に変更",
                selector="販売価格の入力フィールド",
                value=str(new_price)
            ),
            BrowserStep(
                action="click",
                description="「変更する」ボタンをクリック",
                selector="変更するボタン"
            ),
        ]
    )


# ── メッセージ確認手順 ──

def get_check_messages_procedure() -> BrowserProcedure:
    """メッセージ確認のブラウザ操作手順を生成する"""
    return BrowserProcedure(
        name="メルカリメッセージ確認",
        description="新着メッセージ・コメントを確認する",
        steps=[
            BrowserStep(
                action="navigate",
                description="マイページに移動",
                value=mypage_url()
            ),
            BrowserStep(
                action="wait",
                description="ページ読み込み待機",
                wait_sec=get_random_delay()
            ),
            BrowserStep(
                action="read_page",
                description="お知らせ・新着通知を読み取る"
            ),
            BrowserStep(
                action="check_notifications",
                description="コメント・いいね・購入通知を確認"
            ),
        ]
    )


# ── ユーティリティ ──

def format_procedure_for_claude(procedure: BrowserProcedure) -> str:
    """手順書をClaude向けのテキストにフォーマットする"""
    lines = [
        f"## {procedure.name}",
        f"{procedure.description}\n",
        "### 操作手順"
    ]
    for i, step in enumerate(procedure.steps, 1):
        line = f"{i}. [{step.action}] {step.description}"
        if step.value:
            line += f"\n   値: {step.value}"
        if step.selector:
            line += f"\n   対象: {step.selector}"
        if step.wait_sec > 0:
            line += f"\n   待機: {step.wait_sec:.1f}秒"
        lines.append(line)
    return "\n".join(lines)
