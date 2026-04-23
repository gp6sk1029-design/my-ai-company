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

出力情報：
- ファイルパス
- 記事タイトル（H1から抽出）
- 最終更新日
- 関連画像フォルダ
- 文字数
- 復帰コマンド例
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


def format_article(art: Path, detail: bool = False) -> dict:
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
    print(f"\n💡 復帰コマンド例:")
    print(f"   {article['recover_command']}")
    print()


def main() -> int:
    parser = argparse.ArgumentParser(description="記事ステータス管理・曖昧検索")
    parser.add_argument("query", nargs="?", help="検索クエリ（ファイル名・商品名・何でも）")
    parser.add_argument("--detail", action="store_true", help="詳細表示")
    parser.add_argument("--json", action="store_true", help="JSON出力")
    args = parser.parse_args()

    results = search_articles(args.query)

    if not results:
        print(f"❌ 「{args.query}」に一致する記事が見つかりません。", file=sys.stderr)
        print(f"   検索対象: {ARTICLES_DIR}", file=sys.stderr)
        return 1

    articles = [format_article(art, detail=args.detail) for art, _ in results]

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
