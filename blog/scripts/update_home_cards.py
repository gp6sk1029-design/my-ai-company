# -*- coding: utf-8 -*-
"""
update_home_cards.py ── ホーム（固定ページ756）の「注目の記事」「最新の記事」を
WordPressの最新公開記事から自動生成して差し替える。

ホームは手組みHTMLの静的カードで、新記事を投稿しても自動では出ないため、
公開のたびにこのスクリプトで最新状態へ同期する（publish_article.py から自動呼出）。

使い方:
  python3 blog/scripts/update_home_cards.py            # 実更新
  python3 blog/scripts/update_home_cards.py --dry-run  # 差し替え内容の確認のみ
  # モジュールとして:  from update_home_cards import update_home; update_home()

カード内容は「最新の公開記事」から取得（タイトル/URL/公開日/アイキャッチ/カテゴリ）。
注目=先頭3件・最新=先頭5件（件数は引数で変更可）。カテゴリ→タグ名/色は下表で対応。
"""
import argparse
import html
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "blog" / "scripts"))
from wp_api import WPClient  # noqa: E402

PAGE_ID = 756

# カテゴリID → (ホームカードのタグ表示名, 色)。ページの既存デザインに合わせる。
CATEGORY_TAG = {
    1: ("ガジェットレビュー", "#2563eb"),  # ガジェット研究室
    6: ("時短ツール", "#7c3aed"),          # 時短ツール研究室
    4: ("生産技術", "#059669"),            # 生産技術研究室
    5: ("暮らしハック", "#ea580c"),        # 暮らしハック研究室
}
# 複数カテゴリのときタグに使う優先順位（ガジェット＞時短＞生産技術＞暮らし）
CATEGORY_PRIORITY = [1, 6, 4, 5]


def _tag_for(cats):
    for cid in CATEGORY_PRIORITY:
        if cid in cats:
            return CATEGORY_TAG[cid]
    return ("レビュー", "#2563eb")


def _card_data(post):
    """WP投稿(JSON,_embed付き)→カード用データdict。"""
    title = html.unescape(post["title"]["rendered"]).strip()
    url = post["link"]
    date = post["date"][:10].replace("-", ".")
    tag, color = _tag_for(post.get("categories", []))
    thumb = ""
    media = post.get("_embedded", {}).get("wp:featuredmedia", [])
    if media and isinstance(media, list) and isinstance(media[0], dict):
        thumb = media[0].get("source_url", "") or ""
    return dict(url=url, thumb=thumb, tag=tag, color=color, title=title, date=date)


def fetch_recent(client, n):
    posts = client._request("GET", "/posts",
                            params={"per_page": n, "status": "publish", "_embed": 1})
    return [_card_data(p) for p in posts]


def feat(d):
    return (f'<a href="{d["url"]}" class="ot-featured-card">\n'
            f'  <div class="ot-featured-thumb" style="background-image:url(\'{d["thumb"]}\');">\n'
            f'    <span class="ot-featured-tag" style="background:{d["color"]}">{d["tag"]}</span>\n'
            f'  </div>\n'
            f'  <div class="ot-featured-body">\n'
            f'    <div class="ot-featured-title">{d["title"]}</div>\n'
            # 🕐 の絵文字は入れない：WordPressが絵文字を <img class="emoji"> に変換するが、
            # このカードには .emoji のサイズ指定がなく 110x88px の巨大画像として描画されるため
            # （2026-07-28修正）。日付はテキストだけで十分伝わる。
            f'    <div class="ot-featured-date">{d["date"]}</div>\n'
            f'  </div>\n'
            f'</a>')


def latest(d):
    return (f'<a href="{d["url"]}" class="ot-latest-item">\n'
            f'  <div class="ot-latest-thumb" style="background-image:url(\'{d["thumb"]}\');"></div>\n'
            f'  <div class="ot-latest-title">{d["title"]}</div>\n'
            f'  <span class="ot-latest-tag" style="background:{d["color"]}">{d["tag"]}</span>\n'
            f'  <span class="ot-latest-date">{d["date"]}</span>\n'
            f'</a>')


def _splice(raw, open_marker, end_text, cards_html):
    """open_marker直後〜(end_textの手前の最後の</a>)までを cards_html で置換。"""
    g = raw.index(open_marker)
    g_end = g + len(open_marker)
    nxt = raw.index(end_text, g_end)
    last_a = raw.rindex("</a>", g_end, nxt) + len("</a>")
    return raw[:g_end] + "\n          " + cards_html + "\n        " + raw[last_a:]


def update_home(client=None, featured_n=3, latest_n=5, dry_run=False):
    """ホームの注目/最新カードを最新公開記事で差し替える。戻り値=(recentリスト, 新raw)。"""
    client = client or WPClient.from_config()
    recent = fetch_recent(client, max(featured_n, latest_n))
    if not recent:
        raise RuntimeError("公開記事が取得できませんでした")
    featured_cards = "\n          ".join(feat(d) for d in recent[:featured_n])
    latest_cards = "\n          ".join(latest(d) for d in recent[:latest_n])

    p = client._request("GET", f"/pages/{PAGE_ID}", params={"context": "edit"})
    raw = p["content"]["raw"]
    raw = _splice(raw, '<div class="ot-featured-grid">', "最新の記事", featured_cards)
    raw = _splice(raw, '<div class="ot-latest-list">', "記事一覧をみる", latest_cards)

    exp_feat = len(recent[:featured_n])
    exp_latest = len(recent[:latest_n])
    assert raw.count("ot-featured-card") == exp_feat, f"注目カード数不一致: {raw.count('ot-featured-card')}"
    assert raw.count("ot-latest-item") == exp_latest, f"最新カード数不一致: {raw.count('ot-latest-item')}"

    if not dry_run:
        client._request("POST", f"/pages/{PAGE_ID}", data={"content": raw})
    return recent, raw


def main():
    ap = argparse.ArgumentParser(description="ホームの注目/最新カードを最新記事で同期")
    ap.add_argument("--dry-run", action="store_true", help="更新せず内容確認のみ")
    ap.add_argument("--featured", type=int, default=3)
    ap.add_argument("--latest", type=int, default=5)
    args = ap.parse_args()
    recent, _ = update_home(featured_n=args.featured, latest_n=args.latest, dry_run=args.dry_run)
    head = "[DRY-RUN] " if args.dry_run else "✅ "
    print(f"{head}ホーム更新: 注目{args.featured}件 / 最新{args.latest}件")
    for i, d in enumerate(recent[:max(args.featured, args.latest)], 1):
        mark = "★注目" if i <= args.featured else "  最新"
        print(f"  {mark} {i}. {d['date']} [{d['tag']}] {d['title'][:38]}")


if __name__ == "__main__":
    main()
