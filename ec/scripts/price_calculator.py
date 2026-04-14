"""
EC販売部門 - 価格計算・利益率判定ロジック
仕入れGO/NO-GO判断、出品価格算出、値下げスケジュールを管理する
"""

import json
import os
from dataclasses import dataclass
from typing import Optional


# 設定ファイル読み込み
CONFIG_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "config.json")


def load_config() -> dict:
    """EC部門の設定を読み込む"""
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


@dataclass
class PriceResult:
    """価格計算の結果"""
    selling_price: int        # 販売価格
    platform_fee: int         # プラットフォーム手数料
    shipping_cost: int        # 送料
    cost_price: int           # 仕入れ価格
    profit: int               # 利益
    profit_margin_pct: float  # 利益率（%）
    go_decision: bool         # 仕入れGO判断
    reason: str               # 判断理由


@dataclass
class ShippingOption:
    """発送方法の選択結果"""
    method: str           # 発送方法名
    cost: int             # 送料
    max_size: str         # 最大サイズ
    packing: str = ""     # 推奨梱包材
    packing_note: str = ""  # 梱包の注意点


# ── 商品カテゴリ別のサイズ・重量推定テーブル ──
# 写真だけでは正確なサイズはわからないため、
# 商品カテゴリから推定するルックアップテーブルを用意する。
# Claudeが写真を見て商品を特定した後、このテーブルで推定する。

PRODUCT_SIZE_ESTIMATES = {
    # カテゴリ: (3辺合計cm, 推定重量kg, 厚さcm)
    # ── スマホ・イヤホン・小物 ──
    "イヤホン": (15, 0.3, 5),
    "ワイヤレスイヤホン": (15, 0.3, 5),
    "スマホ": (30, 0.4, 3),
    "スマホケース": (25, 0.1, 2),
    "モバイルバッテリー": (25, 0.3, 3),
    "充電器": (20, 0.2, 3),
    "USBケーブル": (15, 0.1, 1),
    "SDカード": (10, 0.05, 0.5),
    "メモリーカード": (10, 0.05, 0.5),
    # ── ゲーム ──
    "ゲームソフト": (20, 0.1, 1.5),
    "ゲーム機": (60, 1.5, 10),
    "コントローラー": (40, 0.4, 8),
    # ── PC・タブレット ──
    "ノートPC": (80, 2.5, 5),
    "タブレット": (55, 0.8, 3),
    "キーボード": (70, 1.0, 5),
    "マウス": (20, 0.2, 5),
    "モニター": (120, 5.0, 15),
    # ── オーディオ・映像 ──
    "ヘッドホン": (40, 0.5, 10),
    "スピーカー": (60, 2.0, 15),
    "カメラ": (50, 1.0, 12),
    "レンズ": (30, 0.8, 12),
    # ── ウェアラブル ──
    "スマートウォッチ": (15, 0.3, 5),
    "腕時計": (15, 0.3, 5),
    # ── 生活家電 ──
    "ドライヤー": (50, 0.8, 10),
    "アイロン": (50, 1.2, 12),
    "掃除機": (100, 4.0, 25),
    "電気ケトル": (55, 1.0, 20),
    "コーヒーメーカー": (70, 2.5, 25),
    # ── 衣類・靴 ──
    "Tシャツ": (30, 0.2, 2),
    "パーカー": (40, 0.5, 3),
    "ジャケット": (50, 1.0, 5),
    "コート": (60, 1.5, 8),
    "スニーカー": (60, 1.0, 15),
    "ブーツ": (70, 1.5, 20),
    "バッグ": (60, 0.8, 15),
    # ── 本・メディア ──
    "本": (25, 0.4, 2),
    "漫画セット": (50, 3.0, 15),
    "DVD": (20, 0.1, 1.5),
    "Blu-ray": (20, 0.1, 1.5),
    # ── デフォルト ──
    "その他_小": (30, 0.5, 5),
    "その他_中": (60, 2.0, 15),
    "その他_大": (100, 5.0, 25),
}


@dataclass
class PackingRecommendation:
    """梱包材の推奨"""
    material: str         # 梱包材の種類
    detail: str           # 詳細（サイズ等）
    estimated_cost: int   # 梱包材コスト（円）
    packed_size_cm: int   # 梱包後の3辺合計（cm）
    packed_weight_kg: float  # 梱包後の推定重量（kg）
    notes: str            # 梱包時の注意点


def estimate_size_from_category(category: str) -> tuple:
    """
    商品カテゴリからサイズ・重量を推定する

    Returns: (3辺合計cm, 推定重量kg, 厚さcm)
    """
    # 完全一致を試みる
    if category in PRODUCT_SIZE_ESTIMATES:
        return PRODUCT_SIZE_ESTIMATES[category]

    # 部分一致を試みる
    for key, value in PRODUCT_SIZE_ESTIMATES.items():
        if key in category or category in key:
            return value

    # デフォルト（中サイズ）
    return PRODUCT_SIZE_ESTIMATES["その他_中"]


def recommend_packing(three_sides_cm: int, thickness_cm: float,
                      weight_kg: float, is_fragile: bool = False) -> PackingRecommendation:
    """
    商品サイズに基づいて最適な梱包材を推奨する

    判定ロジック:
    1. 薄くて軽い → 封筒・クッション封筒
    2. 小さいが厚みあり → 紙袋 + プチプチ
    3. 中〜大サイズ → 段ボール
    4. 壊れやすいもの → 段ボール + 緩衝材必須
    """

    # A4封筒・クッション封筒（薄くて軽いもの）
    if thickness_cm <= 3 and weight_kg <= 1.0 and three_sides_cm <= 60:
        packed_size = three_sides_cm + 2  # 封筒分の嵩増し
        packed_weight = weight_kg + 0.05
        if is_fragile:
            return PackingRecommendation(
                material="クッション封筒",
                detail="A4サイズ クッション封筒（プチプチ内蔵）",
                estimated_cost=50,
                packed_size_cm=packed_size,
                packed_weight_kg=packed_weight,
                notes="精密機器の場合は追加のプチプチで包む"
            )
        return PackingRecommendation(
            material="封筒",
            detail="A4サイズ 茶封筒 + OPP袋（防水）",
            estimated_cost=20,
            packed_size_cm=packed_size,
            packed_weight_kg=packed_weight,
            notes="OPP袋に入れてから封筒に。雨対策"
        )

    # 紙袋（小〜中サイズ、壊れにくいもの）
    if three_sides_cm <= 60 and not is_fragile and weight_kg <= 2.0:
        packed_size = three_sides_cm + 10  # 紙袋+プチプチ分
        packed_weight = weight_kg + 0.1
        return PackingRecommendation(
            material="紙袋",
            detail="紙袋 + プチプチ + OPP袋",
            estimated_cost=30,
            packed_size_cm=packed_size,
            packed_weight_kg=packed_weight,
            notes="プチプチで1周巻いてから紙袋に入れる。軽い衣類等はプチプチ不要"
        )

    # 段ボール60サイズ
    if three_sides_cm <= 55 and weight_kg <= 2.0:
        return PackingRecommendation(
            material="段ボール",
            detail="60サイズ段ボール + プチプチ + 緩衝材",
            estimated_cost=100,
            packed_size_cm=60,
            packed_weight_kg=weight_kg + 0.5,
            notes="プチプチで包み、隙間に新聞紙やエアクッションを詰める"
        )

    # 段ボール80サイズ
    if three_sides_cm <= 75 and weight_kg <= 5.0:
        return PackingRecommendation(
            material="段ボール",
            detail="80サイズ段ボール + プチプチ + 緩衝材",
            estimated_cost=150,
            packed_size_cm=80,
            packed_weight_kg=weight_kg + 0.7,
            notes="プチプチで包み、隙間に緩衝材。精密機器は二重プチプチ"
        )

    # 段ボール100サイズ
    if three_sides_cm <= 95 and weight_kg <= 10.0:
        return PackingRecommendation(
            material="段ボール",
            detail="100サイズ段ボール + プチプチ + 緩衝材",
            estimated_cost=200,
            packed_size_cm=100,
            packed_weight_kg=weight_kg + 1.0,
            notes="大きめの段ボールに緩衝材を十分に入れる"
        )

    # 段ボール120サイズ
    if three_sides_cm <= 115 and weight_kg <= 15.0:
        return PackingRecommendation(
            material="段ボール",
            detail="120サイズ段ボール + プチプチ + 緩衝材",
            estimated_cost=250,
            packed_size_cm=120,
            packed_weight_kg=weight_kg + 1.2,
            notes="大型商品。底面にも緩衝材を敷く"
        )

    # 段ボール140サイズ以上
    packed_size = min(three_sides_cm + 15, 160)
    return PackingRecommendation(
        material="段ボール",
        detail=f"{packed_size}サイズ段ボール + プチプチ + 緩衝材",
        estimated_cost=300,
        packed_size_cm=packed_size,
        packed_weight_kg=weight_kg + 1.5,
        notes="大型商品。十分な緩衝材と「取扱注意」シール推奨"
    )


def get_platform_fee_rate(platform: str = "mercari") -> float:
    """プラットフォームの手数料率を取得する"""
    config = load_config()
    return config["platforms"].get(platform, {}).get("fee_rate", 0.10)


def calculate_shipping(packed_size_cm: int = 0, packed_weight_kg: float = 0.0,
                       thickness_cm: float = 0, platform: str = "mercari") -> ShippingOption:
    """
    梱包後のサイズ・重量から最安の発送方法を選定する

    packed_size_cm: 梱包後の3辺合計サイズ
    packed_weight_kg: 梱包後の重量
    thickness_cm: 梱包後の厚さ（ネコポス/ゆうパケット判定用）
    """
    config = load_config()
    shipping = config["shipping_costs"]

    # ネコポス: A4サイズ × 厚さ3cm以内 × 1kg以内（最安¥210）
    if thickness_cm <= 3 and packed_weight_kg <= 1.0 and packed_size_cm <= 60:
        return ShippingOption(
            "ネコポス", shipping["nekopos"]["cost"],
            shipping["nekopos"]["max_size_cm"],
            packing="封筒 or クッション封筒",
            packing_note="厚さ3cm厳守。ポスト投函なので不在でもOK"
        )

    # ゆうパケット: 3辺60cm × 厚さ3cm以内 × 1kg以内（¥250）
    # ネコポスより大きいがA4より大きい場合
    if thickness_cm <= 3 and packed_weight_kg <= 1.0 and packed_size_cm <= 60:
        return ShippingOption(
            "ゆうパケット", shipping["yu_packet"]["cost"],
            shipping["yu_packet"]["max_size_cm"],
            packing="封筒 or クッション封筒",
            packing_note="ポスト投函。ゆうゆうメルカリ便で匿名配送可"
        )

    # ゆうパック/宅急便（サイズ別）
    size_options = [
        (60, "yu_pack_60", "60サイズ段ボール"),
        (80, "yu_pack_80", "80サイズ段ボール"),
        (100, "yu_pack_100", "100サイズ段ボール"),
        (120, "yu_pack_120", "120サイズ段ボール"),
        (140, "yu_pack_140", "140サイズ段ボール"),
        (160, "yu_pack_160", "160サイズ段ボール"),
    ]

    for max_size, key, packing in size_options:
        if packed_size_cm <= max_size:
            weight_limit = 25.0  # ゆうパックは全サイズ25kgまで
            if packed_weight_kg <= weight_limit:
                return ShippingOption(
                    f"ゆうパック{max_size}", shipping[key]["cost"],
                    shipping[key]["max_size_cm"],
                    packing=packing,
                    packing_note=f"コンビニ持ち込み可。{max_size}サイズ以内に収める"
                )

    # 160サイズ超過
    return ShippingOption(
        "ゆうパック160（超過）", shipping["yu_pack_160"]["cost"],
        "160サイズ超過",
        packing="大型段ボール",
        packing_note="160サイズ超過。大型らくらくメルカリ便（¥4,320〜）or 直接配送を検討"
    )


def calculate_profit(selling_price: int, cost_price: int,
                     shipping_cost: int = 0,
                     platform: str = "mercari") -> PriceResult:
    """
    販売価格から利益を計算する

    利益 = 販売価格 - 手数料 - 送料 - 仕入れ価格
    """
    fee_rate = get_platform_fee_rate(platform)
    platform_fee = int(selling_price * fee_rate)
    profit = selling_price - platform_fee - shipping_cost - cost_price
    margin = (profit / cost_price * 100) if cost_price > 0 else 100.0

    return PriceResult(
        selling_price=selling_price,
        platform_fee=platform_fee,
        shipping_cost=shipping_cost,
        cost_price=cost_price,
        profit=profit,
        profit_margin_pct=round(margin, 1),
        go_decision=False,
        reason=""
    )


def judge_sourcing(selling_price: int, cost_price: int,
                   source: str, shipping_cost: int = 0,
                   platform: str = "mercari") -> PriceResult:
    """
    仕入れGO/NO-GO判断を行う

    判断基準:
    - 不用品: 利益 > 0 なら GO
    - せどり: 利益率 > 30% かつ 利益 > ¥500 なら GO
    - オリジナル: 利益率 > 50% なら GO
    """
    result = calculate_profit(selling_price, cost_price, shipping_cost, platform)
    config = load_config()
    criteria = config["pricing"]

    if source == "不用品":
        c = criteria["used_items"]
        if result.profit > c["min_profit"]:
            result.go_decision = True
            result.reason = f"不用品のため利益¥{result.profit:,}でGO"
        else:
            result.go_decision = False
            result.reason = f"赤字¥{result.profit:,}のためNG（送料・手数料負け）"

    elif source == "せどり":
        c = criteria["resale"]
        if result.profit >= c["min_profit"] and result.profit_margin_pct >= c["min_margin_pct"]:
            result.go_decision = True
            result.reason = f"利益¥{result.profit:,}（利益率{result.profit_margin_pct}%）でGO"
        else:
            reasons = []
            if result.profit < c["min_profit"]:
                reasons.append(f"利益¥{result.profit:,} < 最低¥{c['min_profit']:,}")
            if result.profit_margin_pct < c["min_margin_pct"]:
                reasons.append(f"利益率{result.profit_margin_pct}% < 最低{c['min_margin_pct']}%")
            result.go_decision = False
            result.reason = f"NG: {', '.join(reasons)}"

    elif source == "オリジナル":
        c = criteria["original"]
        if result.profit >= c["min_profit"] and result.profit_margin_pct >= c["min_margin_pct"]:
            result.go_decision = True
            result.reason = f"利益¥{result.profit:,}（利益率{result.profit_margin_pct}%）でGO"
        else:
            result.go_decision = False
            result.reason = f"NG: 利益率{result.profit_margin_pct}% < 最低{c['min_margin_pct']}%"

    return result


def suggest_listing_price(market_avg: int, market_min: int,
                          cost_price: int, source: str,
                          shipping_cost: int = 0,
                          platform: str = "mercari") -> dict:
    """
    相場データから最適な出品価格を提案する

    戦略:
    - 相場平均の90〜95%で設定（早期売却を狙う）
    - ただし利益基準を下回らない価格を最低ラインとする
    """
    config = load_config()
    fee_rate = get_platform_fee_rate(platform)

    # 戦略価格: 相場平均の93%
    strategy_price = int(market_avg * 0.93)

    # 最低価格: 利益基準を満たす最低ライン
    criteria = config["pricing"].get(
        {"不用品": "used_items", "せどり": "resale", "オリジナル": "original"}.get(source, "used_items")
    )
    min_profit = criteria["min_profit"]
    # 最低販売価格 = (仕入れ + 送料 + 最低利益) ÷ (1 - 手数料率)
    min_price = int((cost_price + shipping_cost + min_profit) / (1 - fee_rate)) + 1

    # 推奨価格: 戦略価格と最低価格の大きい方
    recommended_price = max(strategy_price, min_price)

    # 判定
    result = judge_sourcing(recommended_price, cost_price, source, shipping_cost, platform)

    return {
        "recommended_price": recommended_price,
        "strategy_price": strategy_price,
        "min_price": min_price,
        "market_avg": market_avg,
        "market_min": market_min,
        "profit": result.profit,
        "profit_margin_pct": result.profit_margin_pct,
        "go_decision": result.go_decision,
        "reason": result.reason
    }


def get_price_reduction_schedule(current_price: int) -> list:
    """値下げスケジュールを生成する"""
    config = load_config()
    schedule = config["price_reduction_schedule"]
    result = []
    for step in schedule:
        reduced_price = int(current_price * (1 - step["reduce_pct"] / 100))
        result.append({
            "days_after_listing": step["days"],
            "reduce_pct": step["reduce_pct"],
            "new_price": reduced_price,
            "price_drop": current_price - reduced_price,
            "reason": step["reason"]
        })
    return result


def full_profit_estimate(product_category: str, selling_price: int,
                         cost_price: int, source: str,
                         is_fragile: bool = False,
                         platform: str = "mercari") -> dict:
    """
    商品カテゴリから一気通貫で利益を計算する
    写真分析 → サイズ推定 → 梱包材選定 → 送料計算 → 利益計算

    Returns: 全計算結果をまとめた辞書
    """
    # 1. サイズ推定
    three_sides, weight, thickness = estimate_size_from_category(product_category)

    # 2. 梱包材選定
    packing = recommend_packing(three_sides, thickness, weight, is_fragile)

    # 3. 送料計算（梱包後サイズで計算）
    shipping = calculate_shipping(
        packed_size_cm=packing.packed_size_cm,
        packed_weight_kg=packing.packed_weight_kg,
        thickness_cm=thickness if thickness <= 3 else packing.packed_size_cm,
        platform=platform
    )

    # 4. 利益計算（梱包材コストも原価に加算）
    total_cost = cost_price + packing.estimated_cost
    result = judge_sourcing(
        selling_price=selling_price,
        cost_price=total_cost,
        source=source,
        shipping_cost=shipping.cost,
        platform=platform
    )

    return {
        "product_category": product_category,
        "estimated_size": {"three_sides_cm": three_sides, "weight_kg": weight, "thickness_cm": thickness},
        "packing": {
            "material": packing.material,
            "detail": packing.detail,
            "cost": packing.estimated_cost,
            "packed_size_cm": packing.packed_size_cm,
            "packed_weight_kg": packing.packed_weight_kg,
            "notes": packing.notes
        },
        "shipping": {
            "method": shipping.method,
            "cost": shipping.cost,
            "packing_suggestion": shipping.packing,
            "note": shipping.packing_note
        },
        "profit": {
            "selling_price": selling_price,
            "cost_price": cost_price,
            "packing_cost": packing.estimated_cost,
            "total_cost": total_cost,
            "platform_fee": result.platform_fee,
            "shipping_cost": shipping.cost,
            "profit": result.profit,
            "profit_margin_pct": result.profit_margin_pct,
            "go_decision": result.go_decision,
            "reason": result.reason
        }
    }


# テスト実行
if __name__ == "__main__":
    print("=" * 60)
    print("  写真→サイズ推定→梱包→送料→利益 一気通貫テスト")
    print("=" * 60)

    test_cases = [
        ("ワイヤレスイヤホン", 8000, 0, "不用品", True),
        ("ゲーム機", 35000, 0, "不用品", True),
        ("Tシャツ", 2000, 0, "不用品", False),
        ("スニーカー", 5000, 2000, "せどり", False),
        ("ノートPC", 50000, 20000, "せどり", True),
    ]

    for category, price, cost, source, fragile in test_cases:
        print(f"\n--- {category}（{source}）---")
        r = full_profit_estimate(category, price, cost, source, fragile)

        est = r["estimated_size"]
        print(f"  📏 推定サイズ: 3辺{est['three_sides_cm']}cm / {est['weight_kg']}kg / 厚さ{est['thickness_cm']}cm")

        pk = r["packing"]
        print(f"  📦 梱包: {pk['detail']}（¥{pk['cost']}）")
        print(f"     梱包後: {pk['packed_size_cm']}サイズ / {pk['packed_weight_kg']}kg")

        sh = r["shipping"]
        print(f"  🚚 発送: {sh['method']}（¥{sh['cost']:,}）")

        pr = r["profit"]
        print(f"  💰 販売¥{pr['selling_price']:,} - 手数料¥{pr['platform_fee']:,} - 送料¥{pr['shipping_cost']:,} - 原価¥{pr['cost_price']:,} - 梱包¥{pr['packing_cost']:,}")
        print(f"     = 利益¥{pr['profit']:,}（利益率{pr['profit_margin_pct']}%）")
        print(f"  {'✅ GO' if pr['go_decision'] else '❌ NG'}: {pr['reason']}")
