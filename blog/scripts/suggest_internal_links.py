# -*- coding: utf-8 -*-
"""suggest_internal_links.py ── 新記事に貼るべき内部リンクを既存記事から提案する
========================================================================
blog/posts/ のローカルミラー（sync_posts_to_local.py が生成）を横断して、
対象記事と共通の話題（商品名・技術用語）が多い既存記事を提案する。
内部リンクはSEOの基本だが、これまで「記憶頼み」で貼っていて漏れが多かった。

使い方
------------------------------------------------------------------------
  python3 blog/scripts/suggest_internal_links.py --slug <slug>   # ローカル原稿に対して
  python3 blog/scripts/suggest_internal_links.py --post 605      # 公開記事に対して
========================================================================
"""
import argparse
import math
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
POSTS = ROOT / "blog" / "posts"

# 商品名・技術用語らしいトークン：英数字の連なり ＋ カタカナ3文字以上
TOKEN_RE = re.compile(r"[A-Za-z][A-Za-z0-9\-\+\.]{2,}|[ァ-ヴー]{3,}")
# 一般語すぎて内部リンクの根拠にならない語
STOP = {"Amazon", "amazon", "http", "https", "www", "com", "jpg", "png", "wp-content",
        "uploads", "media-amazon", "images", "the", "and", "class", "ootanisatan",
        "レビュー", "ブログ", "ガジェット", "コスト", "ポイント", "タナカ", "オオタニ",
        "サイズ", "デザイン", "シンプル", "スマホ", "パソコン", "ページ", "リンク",
        "メリット", "デメリット", "おすすめ", "まとめ", "チェック", "サポート"}


def tokens(text):
    return {t for t in TOKEN_RE.findall(text) if t not in STOP and len(t) <= 40}


def load_corpus():
    corpus = []
    for f in sorted(POSTS.glob("*.md")):
        text = f.read_text(encoding="utf-8")
        m_id = re.search(r"post_id: (\d+)", text)
        m_title = re.search(r'title: "(.*)"', text)
        m_url = re.search(r"url: (\S+)", text)
        corpus.append({
            "id": int(m_id.group(1)) if m_id else 0,
            "title": m_title.group(1) if m_title else f.name,
            "url": m_url.group(1) if m_url else "",
            "tokens": tokens(text),
        })
    return corpus


def main():
    ap = argparse.ArgumentParser(description="内部リンク候補を既存記事から提案")
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--slug", help="ローカル原稿 blog/articles/<slug>.md")
    g.add_argument("--post", type=int, help="公開記事ID（blog/posts/ミラーから読む）")
    ap.add_argument("--top", type=int, default=5)
    args = ap.parse_args()

    corpus = load_corpus()
    if not corpus:
        sys.exit("❌ blog/posts/ が空です。先に sync_posts_to_local.py を実行してください")

    if args.slug:
        md = ROOT / "blog" / "articles" / f"{args.slug}.md"
        if not md.exists():
            sys.exit(f"❌ 見つかりません: {md}")
        target_tokens, self_id = tokens(md.read_text(encoding="utf-8")), None
        label = args.slug
    else:
        hit = [d for d in corpus if d["id"] == args.post]
        if not hit:
            sys.exit(f"❌ ミラーに記事 {args.post} がありません（sync_posts_to_local.py を実行）")
        target_tokens, self_id = hit[0]["tokens"], args.post
        label = f"[{args.post}] {hit[0]['title'][:30]}"

    n = len(corpus)
    df = {}
    for d in corpus:
        for t in d["tokens"]:
            df[t] = df.get(t, 0) + 1

    scored = []
    for d in corpus:
        if d["id"] == self_id:
            continue
        shared = target_tokens & d["tokens"]
        # 珍しい語（少数の記事にしか出ない語）ほど高得点＝本当に関連が深い記事が上に来る
        score = sum(math.log(n / df[t]) for t in shared)
        if score > 0:
            top_terms = sorted(shared, key=lambda t: -math.log(n / df[t]))[:6]
            scored.append((score, d, top_terms))
    scored.sort(key=lambda x: -x[0])

    print(f"=== 内部リンク候補: {label} ===")
    for score, d, terms in scored[:args.top]:
        print(f"  {score:5.1f}  [{d['id']}] {d['title'][:40]}")
        print(f"         共通語: {'、'.join(terms)}")
    if not scored:
        print("  （共通の話題を持つ記事が見つかりませんでした）")


if __name__ == "__main__":
    main()
