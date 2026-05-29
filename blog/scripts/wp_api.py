#!/usr/bin/env python3
"""
WordPress REST API クライアント

blog/config.json の wordpress_url と wp_auth を使って WP と通信する。

認証情報の設定（blog/config.json に追加、.gitignore 済み）：
  {
    "wordpress_url": "https://www.ootanisatan.com",
    "wp_auth": {
      "username": "your_username",
      "application_password": "xxxx xxxx xxxx xxxx xxxx xxxx"
    }
  }

※ Application Password は WP管理画面 → ユーザー → プロフィール → アプリケーションパスワード から生成

使い方（CLI）：
  python3 wp_api.py list                  # 全記事一覧（下書き含む）
  python3 wp_api.py list --status publish # 公開記事のみ
  python3 wp_api.py get 703               # 投稿ID指定で取得
  python3 wp_api.py find HUAWEI           # タイトルで検索

使い方（Python import）：
  from wp_api import WPClient
  wp = WPClient.from_config()
  posts = wp.list_posts(status='any')
  post = wp.find_by_title('HUAWEI')
"""
from __future__ import annotations

import argparse
import json
import sys
from base64 import b64encode
from dataclasses import dataclass
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

CONFIG_PATH = Path(__file__).resolve().parent.parent / "config.json"


@dataclass
class WPPost:
    id: int
    title: str
    slug: str
    status: str  # publish/draft/pending/private
    link: str
    date: str
    modified: str

    @classmethod
    def from_api(cls, d: dict) -> "WPPost":
        return cls(
            id=d.get("id", 0),
            title=(d.get("title", {}) or {}).get("rendered", ""),
            slug=d.get("slug", ""),
            status=d.get("status", ""),
            link=d.get("link", ""),
            date=d.get("date", ""),
            modified=d.get("modified", ""),
        )

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "title": self.title,
            "slug": self.slug,
            "status": self.status,
            "link": self.link,
            "date": self.date,
            "modified": self.modified,
        }


class WPClient:
    """WordPress REST API 軽量クライアント（urllib のみ使用、依存なし）。"""

    def __init__(self, base_url: str, username: str, app_password: str) -> None:
        self.base_url = base_url.rstrip("/")
        credentials = f"{username}:{app_password}".encode("utf-8")
        self.auth_header = b"Basic " + b64encode(credentials)

    @classmethod
    def from_config(cls, config_path: Path = CONFIG_PATH) -> "WPClient":
        if not config_path.exists():
            raise FileNotFoundError(f"config.json が見つかりません: {config_path}")
        config = json.loads(config_path.read_text(encoding="utf-8"))
        wp_url = config.get("wordpress_url")
        auth = config.get("wp_auth", {})
        username = auth.get("username")
        password = auth.get("application_password")
        if not (wp_url and username and password):
            raise ValueError(
                "blog/config.json に wp_auth.username と wp_auth.application_password を設定してください。\n"
                "例:\n"
                '  "wp_auth": {\n'
                '    "username": "your_username",\n'
                '    "application_password": "xxxx xxxx xxxx xxxx xxxx xxxx"\n'
                "  }"
            )
        return cls(wp_url, username, password)

    def _request(self, method: str, path: str, params: dict | None = None,
                 data: dict | None = None) -> Any:
        url = f"{self.base_url}/wp-json/wp/v2{path}"
        if params:
            url += "?" + urlencode(params)
        body = json.dumps(data).encode("utf-8") if data else None
        req = Request(url, data=body, method=method)
        req.add_header("Authorization", self.auth_header.decode("ascii"))
        req.add_header("Content-Type", "application/json")
        try:
            with urlopen(req, timeout=15) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except HTTPError as e:
            body = e.read().decode("utf-8", errors="ignore")
            raise RuntimeError(f"WP API HTTP {e.code}: {body[:300]}") from e
        except URLError as e:
            raise RuntimeError(f"WP API 接続失敗: {e.reason}") from e

    # --- 公開メソッド ---

    def list_posts(self, status: str = "any", per_page: int = 100) -> list[WPPost]:
        """全記事取得。status='any' で公開・下書き両方。"""
        results = []
        page = 1
        while True:
            items = self._request("GET", "/posts", params={
                "status": status,
                "per_page": per_page,
                "page": page,
                "orderby": "modified",
                "order": "desc",
            })
            if not items:
                break
            results.extend(WPPost.from_api(x) for x in items)
            if len(items) < per_page:
                break
            page += 1
            if page > 10:  # 安全ストッパー
                break
        return results

    def get_post(self, post_id: int) -> WPPost:
        """投稿ID指定で取得。"""
        data = self._request("GET", f"/posts/{post_id}", params={"context": "edit"})
        return WPPost.from_api(data)

    def find_by_title(self, query: str, threshold: float = 0.4) -> list[tuple[WPPost, float]]:
        """タイトル曖昧検索。スコア順で返す。"""
        posts = self.list_posts(status="any")
        scored = []
        q = query.lower()
        for p in posts:
            t = p.title.lower()
            if q in t:
                score = 1.0 + (len(q) / len(t) if t else 0)
            else:
                score = SequenceMatcher(None, q, t).ratio()
            if score >= threshold:
                scored.append((p, score))
        scored.sort(key=lambda x: x[1], reverse=True)
        return scored


def cmd_list(client: WPClient, args: argparse.Namespace) -> int:
    posts = client.list_posts(status=args.status)
    if args.json:
        print(json.dumps([p.to_dict() for p in posts], ensure_ascii=False, indent=2))
    else:
        print(f"\n📚 WP記事一覧（{len(posts)}件, status={args.status}）\n")
        for p in posts:
            print(f"[{p.id}] {p.status:8s} | {p.title}")
            print(f"       🔗 {p.link}")
            print(f"       📅 更新: {p.modified[:10]}")
            print()
    return 0


def cmd_get(client: WPClient, args: argparse.Namespace) -> int:
    p = client.get_post(args.post_id)
    print(json.dumps(p.to_dict(), ensure_ascii=False, indent=2))
    return 0


def cmd_find(client: WPClient, args: argparse.Namespace) -> int:
    results = client.find_by_title(args.query)
    if not results:
        print(f"❌ 「{args.query}」に一致するWP記事が見つかりません。", file=sys.stderr)
        return 1
    if args.json:
        print(json.dumps(
            [{**p.to_dict(), "score": round(s, 3)} for p, s in results],
            ensure_ascii=False, indent=2,
        ))
    else:
        print(f"\n🔍 WP記事検索結果（{len(results)}件）\n")
        for p, s in results:
            print(f"[{p.id}] score={s:.2f} {p.status:8s} | {p.title}")
            print(f"       🔗 {p.link}")
            print()
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="WordPress REST API CLI")
    parser.add_argument("--json", action="store_true", help="JSON出力")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_list = sub.add_parser("list", help="記事一覧")
    p_list.add_argument("--status", default="any",
                        choices=["any", "publish", "draft", "pending", "private"])

    p_get = sub.add_parser("get", help="投稿ID指定取得")
    p_get.add_argument("post_id", type=int)

    p_find = sub.add_parser("find", help="タイトル曖昧検索")
    p_find.add_argument("query")

    args = parser.parse_args()

    try:
        client = WPClient.from_config()
    except (FileNotFoundError, ValueError) as e:
        print(f"❌ {e}", file=sys.stderr)
        return 2

    dispatch = {"list": cmd_list, "get": cmd_get, "find": cmd_find}
    return dispatch[args.cmd](client, args)


if __name__ == "__main__":
    sys.exit(main())
