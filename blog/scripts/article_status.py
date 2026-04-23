#!/usr/bin/env python3
"""
記事ステータス管理・曖昧検索ツール

記事の断片情報（ファイル名の一部・商品名・キーワード等）から
該当記事を特定し、復帰に必要な全情報を1コマンドで取得する。

使い方：
  # 全記事一覧
  python3 article_status.py

  # 曖昧検索（キーワード・商品名・何でもOK）
  python3 article_status.py huawei
  python3 article_status.py "HUAWEI Watch"
  python3 article_status.py gt-runner
  python3 article_status.py ガーミン

  # 詳細表示
  python3 article_status.py huawei --detail

  # JSON出力（他スクリプトと連携用）
  python3 article_status.py huawei --json

  # WordPress連携（投稿ID・URL・状態を自動取得）
  python3 article_status.py huawei --with-wp
  python3 article_status.py --with-wp              # 全記事にWP情報を結合

  # MEMORY.md記事台帳を自動更新（WP情報をローカル台帳に反映）
  python3 article_status.py --sync-registry

出力情報：
- ファイルパス
- 記事タイトル（H1から抽出）
- 最終更新日
- 関連画像フォルダ
- 文字数
- 復帰コマンド例
- （--with-wp時）WP投稿ID、公開URL、公開状態
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime
from difflib import SequenceMatcher
from pathlib import Path

ARTICLES_DIR = Path(__file__).resolve().parent.parent.parent / "articles"
IMAGES_DIR = Path(__file__).resolve().parent.parent / "images"
MEMORY_PATH = Path(__file__).resolve().parent.parent / "MEMORY.md"

# 同ディレクトリの wp_api をオプショナル import
sys.path.insert(0, str(Path(__file__).resolve().parent))
try:
    from wp_api import WPClient, WPPost  # noqa: E402
    HAS_WP = True
except Exception:
    HAS_WP = False


def extract_title(md_path: Path) -> str:
    """markdownファイルから最初のH1を抽出。なければファイル名。"""
    try:
        with open(md_path, encoding="utf-8") as f:
            for line in f:
                m = re.match(r"^#\s+(.+)", line.strip())
                if m:
                    return m.group(1).strip()
    except Exception:
        pass
    return md_path.stem


def extract_keywords(md_path: Path) -> list[str]:
    """記事から商品名・固有名詞候補を抽出（簡易）。"""
    keywords = set()
    try:
        content = md_path.read_text(encoding="utf-8")
        # 英数字+ハイフンの固有名詞っぽいもの
        for m in re.findall(r"[A-Za-z][A-Za-z0-9\-]{2,}", content[:3000]):
            keywords.add(m)
        # カタカナ語
        for m in re.findall(r"[ァ-ヴー]{3,}", content[:3000]):
            keywords.add(m)
    except Exception:
        pass
    return list(keywords)


def count_chars(md_path: Path) -> int:
    """記事の文字数（Markdown記号除く概算）。"""
    try:
        content = md_path.read_text(encoding="utf-8")
        # Markdown記号を除去
        content = re.sub(r"[#*`\[\]()!_>-]", "", content)
        return len(content.strip())
    except Exception:
        return 0


def find_image_folder(md_path: Path) -> Path | None:
    """記事ファイル名に関連する画像フォルダを推測。"""
    stem = md_path.stem.lower()
    # 最初の単語（ハイフンで切る）を取る
    first_word = stem.split("-")[0]

    if not IMAGES_DIR.exists():
        return None

    candidates = []
    for folder in IMAGES_DIR.iterdir():
        if not folder.is_dir():
            continue
        folder_name = folder.name.lower()
        if first_word in folder_name or folder_name in stem:
            candidates.append(folder)

    return candidates[0] if candidates else None


def fuzzy_score(query: str, target: str) -> float:
    """曖昧マッチスコア（0〜1）。"""
    q = query.lower()
    t = target.lower()
    # 部分一致を最優先
    if q in t:
        return 1.0 + (len(q) / len(t) if t else 0)
    # SequenceMatcher による類似度
    return SequenceMatcher(None, q, t).ratio()


def search_articles(query: str | None) -> list[tuple[Path, float]]:
    """記事を検索し、スコア順でソートした候補リストを返す。"""
    if not ARTICLES_DIR.exists():
        return []

    articles = list(ARTICLES_DIR.glob("*.md"))

    if not query:
        # クエリなしなら全件（更新日順）
        return [(a, 0.0) for a in sorted(articles, key=lambda p: p.stat().st_mtime, reverse=True)]

    scored = []
    for art in articles:
        # ファイル名・タイトル・キーワード全部を検索対象に
        targets = [art.stem, extract_title(art)] + extract_keywords(art)
        best = max(fuzzy_score(query, t) for t in targets) if targets else 0
        if best > 0.3:  # 閾値
            scored.append((art, best))

    scored.sort(key=lambda x: x[1], reverse=True)
    return scored


def match_wp_post(local_title: str, wp_posts: list) -> object | None:
    """ローカル記事タイトルとWP記事を曖昧マッチ。最もスコアの高いものを返す。"""
    if not wp_posts:
        return None
    best = None
    best_score = 0.0
    q = local_title.lower()
    for p in wp_posts:
        t = p.title.lower()
        if not t:
            continue
        if q == t:
            return p
        # 部分一致優先
        if q in t or t in q:
            score = 0.9 + (min(len(q), len(t)) / max(len(q), len(t)) * 0.1)
        else:
            score = SequenceMatcher(None, q, t).ratio()
        if score > best_score:
            best_score = score
            best = p
    return best if best_score >= 0.5 else None


def fetch_wp_posts() -> list:
    """WP記事を全件取得。認証未設定や接続エラー時は空リスト。"""
    if not HAS_WP:
        return []
    try:
        client = WPClient.from_config()
        return client.list_posts(status="any")
    except Exception as e:
        print(f"⚠️  WP連携スキップ: {e}", file=sys.stderr)
        return []


def format_article(art: Path, detail: bool = False, wp_posts: list | None = None) -> dict:
    """記事情報を辞書で返す。"""
    stat = art.stat()
    img_folder = find_image_folder(art)

    info = {
        "file": str(art),
        "filename": art.name,
        "title": extract_title(art),
        "last_modified": datetime.fromtimestamp(stat.st_mtime).strftime("%Y-%m-%d %H:%M"),
        "char_count": count_chars(art),
        "size_kb": round(stat.st_size / 1024, 1),
        "image_folder": str(img_folder) if img_folder else None,
        "image_count": len(list(img_folder.glob("*"))) if img_folder and img_folder.is_dir() else 0,
    }

    if detail:
        info["keywords"] = extract_keywords(art)[:10]
        info["recover_command"] = (
            f"「{art.stem} を編集したい。articles/{art.name} を読んで、"
            f"blog/SKILL.md と blog/MEMORY.md に従って作業再開」"
        )

    # WP情報を結合
    if wp_posts is not None:
        title = info["title"]
        matched = match_wp_post(title, wp_posts)
        if matched:
            info["wp_id"] = matched.id
            info["wp_status"] = matched.status
            info["wp_url"] = matched.link
            info["wp_modified"] = matched.modified[:10]
        else:
            info["wp_id"] = None
            info["wp_status"] = "(未投稿)"
            info["wp_url"] = None
            info["wp_modified"] = None

    return info


def print_table(articles: list[dict]) -> None:
    """テーブル形式で表示。"""
    if not articles:
        print("該当する記事が見つかりません。")
        return

    print(f"\n📚 記事一覧（{len(articles)}件）\n")
    for i, a in enumerate(articles, 1):
        print(f"【{i}】 {a['title']}")
        print(f"     📄 {a['filename']}")
        print(f"     🕐 最終更新: {a['last_modified']}  |  📝 {a['char_count']}字  |  📦 {a['size_kb']}KB")
        if a.get("image_folder"):
            print(f"     🖼️  画像: {a['image_folder']} ({a['image_count']}枚)")
        if "wp_id" in a:
            if a["wp_id"]:
                print(f"     🌐 WP: [ID {a['wp_id']}] {a['wp_status']}  {a['wp_url'] or ''}")
            else:
                print(f"     🌐 WP: (未投稿)")
        print()


def print_detail(article: dict) -> None:
    """詳細表示。"""
    print(f"\n{'='*60}")
    print(f"📘 {article['title']}")
    print(f"{'='*60}")
    print(f"ファイル      : {article['file']}")
    print(f"最終更新      : {article['last_modified']}")
    print(f"文字数        : {article['char_count']}字")
    print(f"サイズ        : {article['size_kb']}KB")
    print(f"画像フォルダ  : {article.get('image_folder', '(なし)')}")
    print(f"画像枚数      : {article.get('image_count', 0)}枚")
    if article.get("keywords"):
        print(f"抽出KW        : {', '.join(article['keywords'][:10])}")
    if "wp_id" in article:
        print(f"WP投稿ID      : {article['wp_id'] or '(未投稿)'}")
        print(f"WP状態        : {article['wp_status']}")
        if article.get("wp_url"):
            print(f"WP URL        : {article['wp_url']}")
        if article.get("wp_modified"):
            print(f"WP最終更新    : {article['wp_modified']}")
    print(f"\n💡 復帰コマンド例:")
    print(f"   {article['recover_command']}")
    print()


REGISTRY_START = "## 記事台帳（復帰時の参照台帳）"
REGISTRY_END_MARKER = "> **台帳メンテナンスルール**"


def sync_registry_to_memory(articles: list[dict]) -> int:
    """全記事のWP情報を blog/MEMORY.md の記事台帳テーブルに反映。"""
    if not MEMORY_PATH.exists():
        print(f"❌ MEMORY.md が見つかりません: {MEMORY_PATH}", file=sys.stderr)
        return 1

    content = MEMORY_PATH.read_text(encoding="utf-8")
    if REGISTRY_START not in content:
        print("❌ MEMORY.md に「記事台帳」セクションが見つかりません。先に手動で作成してください。",
              file=sys.stderr)
        return 1

    # 新しいテーブル行を生成
    rows = []
    rows.append("| # | ファイル | タイトル | WP投稿ID | 公開URL | 公開日 | 状態 |")
    rows.append("|---|---|---|---|---|---|---|")
    for i, a in enumerate(articles, 1):
        wp_id = a.get("wp_id") or "-"
        wp_url = a.get("wp_url") or "-"
        wp_date = a.get("wp_modified") or "-"
        wp_status = a.get("wp_status") or "ローカルのみ"
        # タイトルが長すぎる場合は切り詰め
        title = a["title"][:40] + "…" if len(a["title"]) > 40 else a["title"]
        rows.append(f"| {i} | {a['filename']} | {title} | {wp_id} | {wp_url} | {wp_date} | {wp_status} |")

    new_table = "\n".join(rows)

    # 既存の台帳部分を置換
    # パターン: REGISTRY_START の次の行から REGISTRY_END_MARKER の直前までを新テーブルに差し替え
    import re
    pattern = re.compile(
        rf"({re.escape(REGISTRY_START)}\n\n)(.*?)(\n\n> \*\*台帳メンテナンスルール)",
        re.DOTALL,
    )
    if not pattern.search(content):
        print("❌ 台帳セクションのフォーマットが想定と異なります。", file=sys.stderr)
        return 1

    new_content = pattern.sub(rf"\1{new_table}\3", content)
    MEMORY_PATH.write_text(new_content, encoding="utf-8")
    print(f"✅ MEMORY.md の記事台帳を {len(articles)}件で更新しました。")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="記事ステータス管理・曖昧検索")
    parser.add_argument("query", nargs="?", help="検索クエリ（ファイル名・商品名・何でも）")
    parser.add_argument("--detail", action="store_true", help="詳細表示")
    parser.add_argument("--json", action="store_true", help="JSON出力")
    parser.add_argument("--with-wp", action="store_true",
                        help="WP REST APIから投稿情報を取得して結合")
    parser.add_argument("--sync-registry", action="store_true",
                        help="MEMORY.mdの記事台帳をWP情報で自動更新（全記事対象）")
    args = parser.parse_args()

    # --sync-registry は強制的に全記事+WP情報モード
    if args.sync_registry:
        args.with_wp = True
        args.query = None

    results = search_articles(args.query)

    if not results:
        print(f"❌ 「{args.query}」に一致する記事が見つかりません。", file=sys.stderr)
        print(f"   検索対象: {ARTICLES_DIR}", file=sys.stderr)
        return 1

    wp_posts = fetch_wp_posts() if args.with_wp else None
    articles = [format_article(art, detail=args.detail, wp_posts=wp_posts) for art, _ in results]

    # --sync-registry なら MEMORY.md を更新して終了
    if args.sync_registry:
        return sync_registry_to_memory(articles)

    if args.json:
        print(json.dumps(articles, ensure_ascii=False, indent=2))
    elif args.detail and len(articles) == 1:
        print_detail(articles[0])
    elif args.detail:
        print(f"🔍 候補 {len(articles)}件（スコア順）:\n")
        for a in articles:
            print_detail(a)
    else:
        print_table(articles)

    return 0


if __name__ == "__main__":
    sys.exit(main())
