"""
EC販売部門 - パイプライン実行
全業務フローの統括スクリプト。
Claudeが各フェーズを順番に実行するための手順書として機能する。

※ 実際の実行はClaude（エージェント）が行う。
   このスクリプトは業務フローの定義と、
   各フェーズで呼び出すべき関数・手順のマッピングを提供する。
"""

import json
import os
from dataclasses import dataclass, field
from typing import Optional

# 同一パッケージのモジュール
from inventory_db import (
    init_db, add_inventory, add_listing, update_listing_status,
    update_listing_price, record_sale, get_sales_summary,
    list_inventory, list_listings, save_market_data, get_market_data
)
from price_calculator import (
    judge_sourcing, suggest_listing_price, calculate_shipping,
    get_price_reduction_schedule, estimate_size_from_category,
    recommend_packing
)
from mercari_browser import (
    get_market_research_procedure, get_listing_procedure,
    get_price_update_procedure, get_check_messages_procedure,
    ListingData, format_procedure_for_claude
)
from google_drive import (
    get_all_products_with_photos, get_product_photos
)


# ── パイプライン定義 ──

@dataclass
class PipelinePhase:
    """パイプラインの1フェーズ"""
    name: str
    description: str
    agent: str                    # 担当エージェント名
    requires_approval: bool       # 人間承認が必要か
    steps: list = field(default_factory=list)


# ── 出品パイプライン ──

def get_listing_pipeline(product_name: str, category: str, condition: str,
                         source: str, cost_price: int = 0,
                         size_cm: str = "", weight_kg: float = 0.0) -> list:
    """
    商品出品の全フローを定義する

    Returns: PipelinePhaseのリスト
    """
    return [
        PipelinePhase(
            name="Phase 0: 写真取得（Google Drive）",
            description=f"「{product_name}」の写真をGoogle Driveから取得する",
            agent="EC統括マネージャー",
            requires_approval=False,
            steps=[
                f"1. get_product_photos('{product_name}') でDriveから写真取得",
                "2. 写真をダウンロード → tools/ec/data/photos/{商品名}/ に保存",
                "3. 写真を分析 → 商品の特定（ブランド・型番・状態）",
                "4. 写真からサイズカテゴリを推定",
                f"5. estimate_size_from_category(カテゴリ) → サイズ・重量推定",
                "6. recommend_packing(サイズ, 厚さ, 重量) → 梱包材選定",
                "7. calculate_shipping(梱包後サイズ, 梱包後重量) → 送料計算"
            ]
        ),
        PipelinePhase(
            name="Phase 1: 市場調査",
            description=f"「{product_name}」のメルカリ相場を調査する",
            agent="市場調査エージェント",
            requires_approval=False,
            steps=[
                "1. メルカリでキーワード検索（SOLD品）",
                "2. 価格データ収集（平均・中央値・最安・最高）",
                "3. 出品中の競合数を確認",
                "4. 相場データをDBに保存",
                f"使用関数: get_market_research_procedure('{product_name}')",
                "使用関数: save_market_data()"
            ]
        ),
        PipelinePhase(
            name="Phase 2: 仕入れ判断（送料・梱包材コスト込み）",
            description="送料・梱包材コストを含めた利益率で判断する",
            agent="仕入れ判断エージェント",
            requires_approval=(cost_price >= 5000),
            steps=[
                "1. Phase 0の梱包結果から送料を取得",
                "2. 梱包材コストも仕入れ原価に加算",
                f"3. judge_sourcing(selling_price=相場×0.93, cost_price={cost_price}+梱包材コスト, source='{source}', shipping_cost=送料)",
                "4. GO/NO-GO判定結果をレポート",
                "5. NGの場合はここで終了"
            ]
        ),
        PipelinePhase(
            name="Phase 3: 出品作成",
            description="売れるタイトル・説明文・カテゴリを設定する",
            agent="出品作成エージェント",
            requires_approval=False,
            steps=[
                "1. タイトル作成（40文字以内、ブランド名+型番+特徴）",
                "2. 説明文作成（テンプレートベース）",
                "3. カテゴリ選定（SOLD品で最も多いカテゴリ）",
                "4. ハッシュタグ付与（5〜10個）"
            ]
        ),
        PipelinePhase(
            name="Phase 4: 価格設定",
            description="最適な出品価格を決定する",
            agent="価格設定エージェント",
            requires_approval=False,
            steps=[
                "1. suggest_listing_price(相場データ, 仕入れ価格, source)",
                "2. 値下げスケジュール生成: get_price_reduction_schedule(price)",
                "3. 推奨価格と値下げ計画をレポート"
            ]
        ),
        PipelinePhase(
            name="Phase 5: 発送方法選定",
            description="最もコストの低い発送方法を選ぶ",
            agent="発送管理エージェント",
            requires_approval=False,
            steps=[
                f"1. calculate_shipping('{size_cm}', {weight_kg})",
                "2. 推奨発送方法と送料をレポート"
            ]
        ),
        PipelinePhase(
            name="Phase 6: 出品承認",
            description="全ての情報を統合し、ユーザーの最終承認を得る",
            agent="EC統括マネージャー",
            requires_approval=True,
            steps=[
                "1. 全フェーズの結果を統合レポートとして提示",
                "  - 商品情報・タイトル・説明文",
                "  - 出品価格・利益計算",
                "  - 発送方法・送料",
                "  - 値下げスケジュール",
                "2. ユーザー承認を待つ",
                "3. 承認後 → Phase 7へ"
            ]
        ),
        PipelinePhase(
            name="Phase 7: メルカリ出品",
            description="メルカリにブラウザ経由で出品する",
            agent="EC統括マネージャー（ブラウザ操作）",
            requires_approval=True,  # 出品ボタンのクリック前に承認
            steps=[
                "1. get_listing_procedure(data) で手順生成",
                "2. Chrome MCP経由でメルカリ出品ページを操作",
                "3. 写真アップロード → フォーム入力 → 確認",
                "4. 【承認ゲート】出品ボタンクリック前にユーザー確認",
                "5. 出品完了後、DBに登録: add_listing(), update_listing_status()"
            ]
        ),
        PipelinePhase(
            name="Phase 8: 在庫登録",
            description="在庫DBに商品を登録する",
            agent="在庫管理エージェント",
            requires_approval=False,
            steps=[
                f"1. add_inventory('{product_name}', '{category}', '{condition}', '{source}', {cost_price})",
                "2. 在庫ステータスを「出品中」に更新",
                "3. 登録完了レポート"
            ]
        ),
    ]


# ── 日次運用パイプライン ──

def get_daily_operations_pipeline() -> list:
    """日次運用の全フローを定義する"""
    return [
        PipelinePhase(
            name="日次1: 値下げチェック",
            description="値下げスケジュールに基づく価格改定",
            agent="価格設定エージェント",
            requires_approval=False,  # 20%未満の値下げは自動
            steps=[
                "1. list_listings(status='出品中') で出品中商品を取得",
                "2. 各商品の出品日数を計算",
                "3. 値下げスケジュールに該当する商品を特定",
                "4. 20%未満: 自動値下げ実行",
                "5. 20%以上: ユーザー承認を要求"
            ]
        ),
        PipelinePhase(
            name="日次2: メッセージ確認",
            description="新着コメント・購入通知を確認し対応する",
            agent="顧客対応エージェント",
            requires_approval=False,
            steps=[
                "1. Chrome MCPでメルカリの通知を確認",
                "2. コメント → テンプレート返信を生成",
                "3. 値下げ交渉 → 利益基準と照合して対応",
                "4. 購入通知 → 購入後メッセージを送信",
                "5. クレーム → ユーザーにエスカレーション"
            ]
        ),
        PipelinePhase(
            name="日次3: 売上確認",
            description="本日の売上・利益を集計する",
            agent="売上分析エージェント",
            requires_approval=False,
            steps=[
                "1. get_sales_summary(days=1) で本日の売上取得",
                "2. 日次ダッシュボードを生成",
                "3. 異常値があれば報告"
            ]
        ),
    ]


# ── パイプライン表示 ──

def format_pipeline(phases: list) -> str:
    """パイプラインをテキスト形式で表示する"""
    lines = ["=" * 60]
    for phase in phases:
        approval = " 🔒要承認" if phase.requires_approval else ""
        lines.append(f"\n### {phase.name}{approval}")
        lines.append(f"担当: {phase.agent}")
        lines.append(f"内容: {phase.description}")
        lines.append("手順:")
        for step in phase.steps:
            lines.append(f"  {step}")
    lines.append("\n" + "=" * 60)
    return "\n".join(lines)


if __name__ == "__main__":
    # データベース初期化
    init_db()

    # 出品パイプラインの例
    print("【出品パイプライン例】")
    pipeline = get_listing_pipeline(
        product_name="Apple AirPods Pro 第2世代",
        category="イヤホン・ヘッドホン",
        condition="目立った傷や汚れなし",
        source="不用品",
        cost_price=0,
        size_cm="10",
        weight_kg=0.2
    )
    print(format_pipeline(pipeline))

    print("\n\n【日次運用パイプライン】")
    daily = get_daily_operations_pipeline()
    print(format_pipeline(daily))
