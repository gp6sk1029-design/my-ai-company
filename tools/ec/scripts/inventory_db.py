"""
EC販売部門 - 在庫データベース管理
SQLiteで在庫・出品・売上・価格履歴・相場キャッシュを一元管理する
"""

import sqlite3
import os
from datetime import datetime
from typing import Optional

# sheets_sync は任意依存（未設定でも動作する）
try:
    import sheets_sync as _sheets_sync
    _SHEETS_ENABLED = True
except ImportError:
    _SHEETS_ENABLED = False


# データベースファイルのパス
DB_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data")
DB_PATH = os.path.join(DB_DIR, "ec_inventory.db")


def get_connection() -> sqlite3.Connection:
    """データベース接続を取得する"""
    os.makedirs(DB_DIR, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db():
    """データベースの初期化（テーブル作成）"""
    conn = get_connection()
    cursor = conn.cursor()

    # 在庫テーブル
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS inventory (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            category TEXT NOT NULL,
            condition TEXT NOT NULL CHECK(condition IN ('新品', '未使用に近い', '目立った傷や汚れなし', 'やや傷や汚れあり', '傷や汚れあり', '全体的に状態が悪い')),
            cost_price INTEGER NOT NULL DEFAULT 0,
            source TEXT NOT NULL CHECK(source IN ('不用品', 'せどり', 'オリジナル')),
            status TEXT NOT NULL DEFAULT '在庫中' CHECK(status IN ('在庫中', '出品中', '売約済み', '発送済み', '完了', '取り下げ')),
            description TEXT,
            size_cm TEXT,
            weight_kg REAL,
            photo_paths TEXT,
            drive_folder_id TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
        )
    """)

    # 既存DBへのマイグレーション（drive_folder_id カラムが無ければ追加）
    try:
        cursor.execute("ALTER TABLE inventory ADD COLUMN drive_folder_id TEXT")
        conn.commit()
    except sqlite3.OperationalError:
        pass  # カラムが既に存在する場合は無視

    # 出品テーブル
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS listings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            inventory_id INTEGER NOT NULL,
            platform TEXT NOT NULL CHECK(platform IN ('mercari', 'amazon', 'rakuten')),
            platform_listing_id TEXT,
            title TEXT NOT NULL,
            description TEXT NOT NULL,
            listed_price INTEGER NOT NULL,
            current_price INTEGER NOT NULL,
            category_path TEXT,
            shipping_method TEXT,
            shipping_cost INTEGER DEFAULT 0,
            status TEXT NOT NULL DEFAULT '下書き' CHECK(status IN ('下書き', '出品中', '売約済み', '取り下げ', '期限切れ')),
            listed_at TEXT,
            updated_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
            FOREIGN KEY (inventory_id) REFERENCES inventory(id)
        )
    """)

    # 売上テーブル
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS sales (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            listing_id INTEGER NOT NULL,
            sold_price INTEGER NOT NULL,
            platform_fee INTEGER NOT NULL,
            shipping_cost INTEGER NOT NULL DEFAULT 0,
            profit INTEGER NOT NULL,
            profit_margin_pct REAL NOT NULL,
            sold_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
            FOREIGN KEY (listing_id) REFERENCES listings(id)
        )
    """)

    # 価格履歴テーブル
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS price_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            listing_id INTEGER NOT NULL,
            old_price INTEGER NOT NULL,
            new_price INTEGER NOT NULL,
            reason TEXT,
            changed_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
            FOREIGN KEY (listing_id) REFERENCES listings(id)
        )
    """)

    # 相場キャッシュテーブル
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS market_cache (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            keyword TEXT NOT NULL,
            platform TEXT NOT NULL DEFAULT 'mercari',
            avg_price INTEGER,
            min_price INTEGER,
            max_price INTEGER,
            median_price INTEGER,
            sold_count INTEGER,
            active_count INTEGER,
            fetched_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
        )
    """)

    conn.commit()
    conn.close()


# ── 在庫管理 ──

def add_inventory(name: str, category: str, condition: str, source: str,
                  cost_price: int = 0, description: str = "",
                  size_cm: str = "", weight_kg: float = 0.0,
                  photo_paths: str = "") -> int:
    """在庫に商品を追加し、IDを返す"""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        INSERT INTO inventory (name, category, condition, source, cost_price,
                               description, size_cm, weight_kg, photo_paths)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (name, category, condition, source, cost_price,
          description, size_cm, weight_kg, photo_paths))
    item_id = cursor.lastrowid
    conn.commit()
    conn.close()
    return item_id


def update_inventory_status(item_id: int, status: str):
    """在庫のステータスを更新する"""
    conn = get_connection()
    conn.execute("""
        UPDATE inventory SET status = ?, updated_at = datetime('now', 'localtime')
        WHERE id = ?
    """, (status, item_id))
    conn.commit()
    conn.close()


def get_inventory(item_id: int) -> Optional[dict]:
    """在庫情報を取得する"""
    conn = get_connection()
    row = conn.execute("SELECT * FROM inventory WHERE id = ?", (item_id,)).fetchone()
    conn.close()
    return dict(row) if row else None


def list_inventory(status: Optional[str] = None, source: Optional[str] = None) -> list:
    """在庫一覧を取得する（フィルタ可能）"""
    conn = get_connection()
    query = "SELECT * FROM inventory WHERE 1=1"
    params = []
    if status:
        query += " AND status = ?"
        params.append(status)
    if source:
        query += " AND source = ?"
        params.append(source)
    query += " ORDER BY created_at DESC"
    rows = conn.execute(query, params).fetchall()
    conn.close()
    return [dict(r) for r in rows]


# ── 出品管理 ──

def add_listing(inventory_id: int, platform: str, title: str, description: str,
                listed_price: int, category_path: str = "",
                shipping_method: str = "", shipping_cost: int = 0) -> int:
    """出品を追加し、IDを返す"""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        INSERT INTO listings (inventory_id, platform, title, description,
                              listed_price, current_price, category_path,
                              shipping_method, shipping_cost)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (inventory_id, platform, title, description,
          listed_price, listed_price, category_path,
          shipping_method, shipping_cost))
    listing_id = cursor.lastrowid
    # 在庫ステータスも更新
    conn.execute("""
        UPDATE inventory SET status = '出品中', updated_at = datetime('now', 'localtime')
        WHERE id = ?
    """, (inventory_id,))
    conn.commit()

    # スプレッドシートに同期（設定済みの場合のみ）
    if _SHEETS_ENABLED:
        inv_row = conn.execute(
            "SELECT name, cost_price FROM inventory WHERE id = ?", (inventory_id,)
        ).fetchone()
        if inv_row:
            fee = int(listed_price * 0.10)
            profit = listed_price - fee - shipping_cost - inv_row["cost_price"]
            margin = (profit / inv_row["cost_price"] * 100) if inv_row["cost_price"] > 0 else 100.0
            _sheets_sync.sync_to_sheets({
                "product_name":    inv_row["name"],
                "listed_at":       datetime.now().strftime("%Y-%m-%d"),
                "listed_price":    listed_price,
                "cost_price":      inv_row["cost_price"],
                "shipping_cost":   shipping_cost,
                "platform_fee":    fee,
                "profit":          profit,
                "profit_margin":   round(margin, 1),
                "shipping_method": shipping_method,
                "status":          "出品中",
            })

    conn.close()
    return listing_id


def update_listing_status(listing_id: int, status: str,
                          platform_listing_id: str = None):
    """出品ステータスを更新する"""
    conn = get_connection()
    if platform_listing_id:
        conn.execute("""
            UPDATE listings SET status = ?, platform_listing_id = ?,
                   listed_at = datetime('now', 'localtime'),
                   updated_at = datetime('now', 'localtime')
            WHERE id = ?
        """, (status, platform_listing_id, listing_id))
    else:
        conn.execute("""
            UPDATE listings SET status = ?, updated_at = datetime('now', 'localtime')
            WHERE id = ?
        """, (status, listing_id))
    conn.commit()
    conn.close()


def update_listing_price(listing_id: int, new_price: int, reason: str = ""):
    """出品価格を更新し、履歴を記録する"""
    conn = get_connection()
    row = conn.execute("SELECT current_price FROM listings WHERE id = ?",
                       (listing_id,)).fetchone()
    if row:
        old_price = row["current_price"]
        conn.execute("""
            UPDATE listings SET current_price = ?, updated_at = datetime('now', 'localtime')
            WHERE id = ?
        """, (new_price, listing_id))
        conn.execute("""
            INSERT INTO price_history (listing_id, old_price, new_price, reason)
            VALUES (?, ?, ?, ?)
        """, (listing_id, old_price, new_price, reason))
    conn.commit()
    conn.close()


def get_listing(listing_id: int) -> Optional[dict]:
    """出品情報を取得する"""
    conn = get_connection()
    row = conn.execute("SELECT * FROM listings WHERE id = ?", (listing_id,)).fetchone()
    conn.close()
    return dict(row) if row else None


def list_listings(platform: Optional[str] = None, status: Optional[str] = None) -> list:
    """出品一覧を取得する"""
    conn = get_connection()
    query = "SELECT l.*, i.name as item_name, i.cost_price FROM listings l JOIN inventory i ON l.inventory_id = i.id WHERE 1=1"
    params = []
    if platform:
        query += " AND l.platform = ?"
        params.append(platform)
    if status:
        query += " AND l.status = ?"
        params.append(status)
    query += " ORDER BY l.updated_at DESC"
    rows = conn.execute(query, params).fetchall()
    conn.close()
    return [dict(r) for r in rows]


# ── 売上管理 ──

def record_sale(listing_id: int, sold_price: int, platform_fee: int,
                shipping_cost: int = 0) -> int:
    """売上を記録する"""
    conn = get_connection()
    cursor = conn.cursor()

    # 仕入れ価格を取得
    row = conn.execute("""
        SELECT i.cost_price FROM listings l
        JOIN inventory i ON l.inventory_id = i.id
        WHERE l.id = ?
    """, (listing_id,)).fetchone()
    cost_price = row["cost_price"] if row else 0

    profit = sold_price - platform_fee - shipping_cost - cost_price
    margin = (profit / cost_price * 100) if cost_price > 0 else 100.0

    cursor.execute("""
        INSERT INTO sales (listing_id, sold_price, platform_fee,
                           shipping_cost, profit, profit_margin_pct)
        VALUES (?, ?, ?, ?, ?, ?)
    """, (listing_id, sold_price, platform_fee, shipping_cost, profit, round(margin, 1)))

    # 出品・在庫ステータスを更新
    conn.execute("UPDATE listings SET status = '売約済み' WHERE id = ?", (listing_id,))
    conn.execute("""
        UPDATE inventory SET status = '売約済み', updated_at = datetime('now', 'localtime')
        WHERE id = (SELECT inventory_id FROM listings WHERE id = ?)
    """, (listing_id,))

    sale_id = cursor.lastrowid
    conn.commit()

    # スプレッドシートのステータスを更新（設定済みの場合のみ）
    if _SHEETS_ENABLED:
        name_row = conn.execute("""
            SELECT i.name FROM listings l
            JOIN inventory i ON l.inventory_id = i.id
            WHERE l.id = ?
        """, (listing_id,)).fetchone()
        if name_row:
            _sheets_sync.update_status(name_row["name"], "売約済み")

    conn.close()
    return sale_id


def get_sales_summary(days: int = 30) -> dict:
    """売上サマリーを取得する（デフォルト直近30日）"""
    conn = get_connection()
    row = conn.execute("""
        SELECT
            COUNT(*) as total_sales,
            COALESCE(SUM(sold_price), 0) as total_revenue,
            COALESCE(SUM(profit), 0) as total_profit,
            COALESCE(AVG(profit_margin_pct), 0) as avg_margin,
            COALESCE(SUM(platform_fee), 0) as total_fees,
            COALESCE(SUM(shipping_cost), 0) as total_shipping
        FROM sales
        WHERE sold_at >= datetime('now', 'localtime', ? || ' days')
    """, (f"-{days}",)).fetchone()
    conn.close()
    return dict(row)


# ── 相場キャッシュ ──

def save_market_data(keyword: str, platform: str, avg_price: int,
                     min_price: int, max_price: int, median_price: int,
                     sold_count: int, active_count: int = 0):
    """相場データをキャッシュに保存する"""
    conn = get_connection()
    conn.execute("""
        INSERT INTO market_cache (keyword, platform, avg_price, min_price,
                                  max_price, median_price, sold_count, active_count)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    """, (keyword, platform, avg_price, min_price, max_price,
          median_price, sold_count, active_count))
    conn.commit()
    conn.close()


def get_market_data(keyword: str, platform: str = "mercari",
                    max_age_hours: int = 24) -> Optional[dict]:
    """キャッシュから相場データを取得する（有効期限内のもの）"""
    conn = get_connection()
    row = conn.execute("""
        SELECT * FROM market_cache
        WHERE keyword = ? AND platform = ?
          AND fetched_at >= datetime('now', 'localtime', ? || ' hours')
        ORDER BY fetched_at DESC LIMIT 1
    """, (keyword, platform, f"-{max_age_hours}")).fetchone()
    conn.close()
    return dict(row) if row else None


# 初回実行時にテーブルを作成
if __name__ == "__main__":
    init_db()
    print(f"データベースを初期化しました: {DB_PATH}")
