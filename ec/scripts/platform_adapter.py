"""
EC販売部門 - マルチプラットフォーム共通インターフェース
メルカリ・Amazon・楽天の操作を統一的に扱うためのアダプター層
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class MarketData:
    """相場データ"""
    keyword: str
    platform: str
    avg_price: int
    min_price: int
    max_price: int
    median_price: int
    sold_count: int
    active_count: int


@dataclass
class ListingItem:
    """出品データ"""
    title: str
    description: str
    price: int
    category: str
    condition: str
    shipping_method: str = ""
    photo_paths: list = field(default_factory=list)


@dataclass
class ListingResult:
    """出品結果"""
    success: bool
    platform_listing_id: str = ""
    url: str = ""
    message: str = ""


@dataclass
class Message:
    """メッセージ"""
    sender: str
    content: str
    listing_id: str = ""
    timestamp: str = ""
    message_type: str = "comment"  # comment / purchase / system


class PlatformAdapter(ABC):
    """プラットフォーム共通インターフェース"""

    @property
    @abstractmethod
    def platform_name(self) -> str:
        """プラットフォーム名を返す"""
        pass

    @property
    @abstractmethod
    def fee_rate(self) -> float:
        """手数料率を返す"""
        pass

    @abstractmethod
    def search_market(self, keyword: str, max_results: int = 20) -> MarketData:
        """相場を調査する"""
        pass

    @abstractmethod
    def create_listing(self, item: ListingItem) -> ListingResult:
        """商品を出品する"""
        pass

    @abstractmethod
    def update_price(self, listing_id: str, new_price: int) -> bool:
        """出品価格を変更する"""
        pass

    @abstractmethod
    def cancel_listing(self, listing_id: str) -> bool:
        """出品を取り下げる"""
        pass

    @abstractmethod
    def get_messages(self) -> list:
        """新着メッセージを取得する"""
        pass

    @abstractmethod
    def send_message(self, listing_id: str, text: str) -> bool:
        """メッセージを送信する"""
        pass


class MercariBrowserAdapter(PlatformAdapter):
    """
    メルカリアダプター（ブラウザ自動化版）
    Claude in Chrome MCP を使ってメルカリを操作する。

    ※ 実際のブラウザ操作はClaude in Chrome MCPツール経由で行われる。
       このクラスは操作手順の生成と結果の解析を担当する。
    """

    @property
    def platform_name(self) -> str:
        return "mercari"

    @property
    def fee_rate(self) -> float:
        return 0.10

    def search_market(self, keyword: str, max_results: int = 20) -> MarketData:
        """
        相場調査を実行する

        実装方針:
        1. mercari_browser.py の get_market_research_procedure() で手順生成
        2. Claude in Chrome MCP で実行
        3. 結果をパースしてMarketDataに変換
        """
        # Chrome MCP経由で実行されるため、ここではプレースホルダー
        raise NotImplementedError(
            "メルカリの相場調査はClaude in Chrome MCPで実行してください。\n"
            "手順: mercari_browser.get_market_research_procedure(keyword) を参照"
        )

    def create_listing(self, item: ListingItem) -> ListingResult:
        """
        商品を出品する

        実装方針:
        1. mercari_browser.py の get_listing_procedure() で手順生成
        2. Claude in Chrome MCP で実行
        3. 出品完了後のURLとIDを返却
        """
        raise NotImplementedError(
            "メルカリへの出品はClaude in Chrome MCPで実行してください。\n"
            "手順: mercari_browser.get_listing_procedure(data) を参照"
        )

    def update_price(self, listing_id: str, new_price: int) -> bool:
        """価格を変更する"""
        raise NotImplementedError(
            "メルカリの価格変更はClaude in Chrome MCPで実行してください。\n"
            "手順: mercari_browser.get_price_update_procedure(item_id, new_price) を参照"
        )

    def cancel_listing(self, listing_id: str) -> bool:
        """出品を取り下げる"""
        raise NotImplementedError(
            "メルカリの出品取り下げはClaude in Chrome MCPで実行してください。"
        )

    def get_messages(self) -> list:
        """メッセージを確認する"""
        raise NotImplementedError(
            "メルカリのメッセージ確認はClaude in Chrome MCPで実行してください。\n"
            "手順: mercari_browser.get_check_messages_procedure() を参照"
        )

    def send_message(self, listing_id: str, text: str) -> bool:
        """メッセージを送信する"""
        raise NotImplementedError(
            "メルカリのメッセージ送信はClaude in Chrome MCPで実行してください。"
        )


class AmazonSPAPIAdapter(PlatformAdapter):
    """
    AmazonアダプターSP-API版）
    Phase 2で実装予定（3ヶ月後）
    """

    @property
    def platform_name(self) -> str:
        return "amazon"

    @property
    def fee_rate(self) -> float:
        return 0.15

    def search_market(self, keyword: str, max_results: int = 20) -> MarketData:
        raise NotImplementedError("Amazon SP-API連携はPhase 2で実装予定です")

    def create_listing(self, item: ListingItem) -> ListingResult:
        raise NotImplementedError("Amazon SP-API連携はPhase 2で実装予定です")

    def update_price(self, listing_id: str, new_price: int) -> bool:
        raise NotImplementedError("Amazon SP-API連携はPhase 2で実装予定です")

    def cancel_listing(self, listing_id: str) -> bool:
        raise NotImplementedError("Amazon SP-API連携はPhase 2で実装予定です")

    def get_messages(self) -> list:
        raise NotImplementedError("Amazon SP-API連携はPhase 2で実装予定です")

    def send_message(self, listing_id: str, text: str) -> bool:
        raise NotImplementedError("Amazon SP-API連携はPhase 2で実装予定です")


class RakutenRMSAdapter(PlatformAdapter):
    """
    楽天アダプター（RMS API版）
    Phase 3で実装予定（6ヶ月後）
    """

    @property
    def platform_name(self) -> str:
        return "rakuten"

    @property
    def fee_rate(self) -> float:
        return 0.10

    def search_market(self, keyword: str, max_results: int = 20) -> MarketData:
        raise NotImplementedError("楽天RMS API連携はPhase 3で実装予定です")

    def create_listing(self, item: ListingItem) -> ListingResult:
        raise NotImplementedError("楽天RMS API連携はPhase 3で実装予定です")

    def update_price(self, listing_id: str, new_price: int) -> bool:
        raise NotImplementedError("楽天RMS API連携はPhase 3で実装予定です")

    def cancel_listing(self, listing_id: str) -> bool:
        raise NotImplementedError("楽天RMS API連携はPhase 3で実装予定です")

    def get_messages(self) -> list:
        raise NotImplementedError("楽天RMS API連携はPhase 3で実装予定です")

    def send_message(self, listing_id: str, text: str) -> bool:
        raise NotImplementedError("楽天RMS API連携はPhase 3で実装予定です")


# ── ファクトリー ──

def get_adapter(platform: str) -> PlatformAdapter:
    """プラットフォーム名からアダプターを取得する"""
    adapters = {
        "mercari": MercariBrowserAdapter,
        "amazon": AmazonSPAPIAdapter,
        "rakuten": RakutenRMSAdapter,
    }
    adapter_class = adapters.get(platform)
    if not adapter_class:
        raise ValueError(f"未対応のプラットフォーム: {platform}")
    return adapter_class()
