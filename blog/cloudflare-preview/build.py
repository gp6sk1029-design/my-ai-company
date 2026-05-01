#!/usr/bin/env python3
"""
Cloudflare Pages 用プレビューサイト ビルダー

blog/articles/*.md を JIN:R 風の静的HTMLに変換し、
blog/cloudflare-preview/ 配下に出力する。

使い方:
  cd /Users/shoheikoda/Documents/my-ai-company
  python3 blog/cloudflare-preview/build.py

出力:
  blog/cloudflare-preview/index.html              (トップページ)
  blog/cloudflare-preview/<slug>/index.html       (各記事)
  blog/cloudflare-preview/assets/style.css        (JIN:R風CSS)
  blog/cloudflare-preview/assets/images/...       (画像)
  blog/cloudflare-preview/robots.txt              (noindex)
  blog/cloudflare-preview/_headers                (X-Robots-Tag)
"""
from __future__ import annotations
import re
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
ARTICLES_DIR = ROOT / "blog" / "articles"
IMAGES_DIR = ROOT / "blog" / "images"
OUT_DIR = ROOT / "blog" / "cloudflare-preview"
ASSETS_DIR = OUT_DIR / "assets"

SITE_TITLE = "生産技術ガジェット研究所"
SITE_TAGLINE = "ガジェット・時短ツールを生産技術視点で本気レビュー"

# --- 各記事のメタ情報（手動定義） ---
ARTICLES = [
    {
        "slug": "garmin-venu2s-review",
        "md": "garmin-venu2s-review.md",
        "title": "Garmin Venu 2S を4年半使ったリアルレビュー｜27円/日で健康管理できる最強スマートウォッチ",
        "excerpt": "Garmin Venu 2Sを4年半・1,600日以上使い込んだ超長期レビュー。1日27円のコスト・年間12万円分の生産性向上・損益分岐点135日。数字だけが証明できる本当の価値。",
        "date": "2026-03-29",
        "category": "ガジェット",
        "thumb": "garmin_venu2s_exterior.jpg",
    },
    {
        "slug": "huawei-gt-runner2-review",
        "md": "huawei-gt-runner2-review.md",
        "title": "【10km実走データ】HUAWEI GT Runner 2 を生産技術視点で本気レビュー",
        "excerpt": "HUAWEI GT Runner 2を3週間実走テスト。10kmマラソンでの実測データ・ランナー特化機能・Garmin比較。生産技術現場経験から見る本当の費用対効果。",
        "date": "2026-04-21",
        "category": "ガジェット",
        "thumb": "edited_20260420_011522.jpg",
    },
]


# ============================================================
# Markdown → HTML 変換
# ============================================================

_UL_TRIGGER = re.compile(r'[0-9]|[０-９]|¥|円|％|%|日|分|時間|週|月|年|kg|g|mm|cm|km|nit|bpm|ms|回|MB|GB')


def md_inline(text: str) -> str:
    """インライン装飾を JIN:R 風 HTML に変換"""
    # ***text*** → 水色アンダーライン強調（最優先）
    text = re.sub(
        r'\*\*\*(.+?)\*\*\*',
        lambda m: f'<strong class="jinr-emph">{m.group(1)}</strong>',
        text
    )
    # **text** → 数値含めば水色アンダーライン、それ以外は普通の bold
    def _bold(m):
        inner = m.group(1)
        cls = "jinr-emph" if _UL_TRIGGER.search(inner) else ""
        return f'<strong class="{cls}">{inner}</strong>' if cls else f'<strong>{inner}</strong>'
    text = re.sub(r'\*\*(.+?)\*\*', _bold, text)
    # *italic*
    text = re.sub(r'(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)', r'<em>\1</em>', text)
    return text


def render_article_body(md: str) -> tuple[str, str]:
    """Markdown本文をHTMLに変換し (h1タイトル, body_html) を返す"""
    lines = md.split('\n')
    h1_title = ""
    out: list[str] = []
    i = 0
    in_list = False
    in_check = False
    list_buf: list[str] = []
    check_buf: list[str] = []

    def flush_list():
        nonlocal in_list, list_buf
        if in_list and list_buf:
            out.append('<ul class="jinr-list">')
            for item in list_buf:
                out.append(f'  <li>{md_inline(item)}</li>')
            out.append('</ul>')
        list_buf = []
        in_list = False

    def flush_check():
        nonlocal in_check, check_buf
        if in_check and check_buf:
            out.append('<ul class="jinr-check">')
            for item in check_buf:
                out.append(f'  <li>{md_inline(item)}</li>')
            out.append('</ul>')
        check_buf = []
        in_check = False

    while i < len(lines):
        line = lines[i]
        stripped = line.strip()

        # H1 タイトル抽出
        if stripped.startswith('# ') and not h1_title:
            h1_title = stripped[2:].strip()
            i += 1
            continue

        # オオタニ所長 ふきだし
        m = re.match(r'\*\*オオタニ所長[：:]\*\*\s*[「\s]*(.*?)[」]?\s*$', line)
        if m:
            flush_list(); flush_check()
            out.append(
                f'<div class="jinr-fukidashi jinr-fukidashi-left">'
                f'  <div class="jinr-chara"><img src="../assets/images/character-ootani.png" alt="オオタニ所長"><span>オオタニ所長</span></div>'
                f'  <div class="jinr-bubble">{md_inline(m.group(1))}</div>'
                f'</div>'
            )
            i += 1; continue

        # タナカ ふきだし
        m = re.match(r'\*\*タナカ[：:]\*\*\s*[「\s]*(.*?)[」]?\s*$', line)
        if m:
            flush_list(); flush_check()
            out.append(
                f'<div class="jinr-fukidashi jinr-fukidashi-right">'
                f'  <div class="jinr-bubble">{md_inline(m.group(1))}</div>'
                f'  <div class="jinr-chara"><img src="../assets/images/character-tanaka.png" alt="タナカ"><span>新人タナカ</span></div>'
                f'</div>'
            )
            i += 1; continue

        # 見出し
        if stripped.startswith('## '):
            flush_list(); flush_check()
            out.append(f'<h2 class="jinr-h2">{md_inline(stripped[3:])}</h2>')
            i += 1; continue
        if stripped.startswith('### '):
            flush_list(); flush_check()
            out.append(f'<h3 class="jinr-h3">{md_inline(stripped[4:])}</h3>')
            i += 1; continue

        # 区切り線
        if stripped == '---':
            flush_list(); flush_check()
            out.append('<hr class="jinr-sep">')
            i += 1; continue

        # テーブル
        if stripped.startswith('|'):
            flush_list(); flush_check()
            tbl = []
            while i < len(lines) and lines[i].strip().startswith('|'):
                cells = [c.strip() for c in lines[i].strip().split('|')[1:-1]]
                tbl.append(cells)
                i += 1
            if len(tbl) >= 2:
                headers = tbl[0]
                # tbl[1] is separator row
                body = [r for r in tbl[2:] if any(c.strip() for c in r)]
                out.append('<table class="jinr-table"><thead><tr>')
                for h in headers:
                    out.append(f'  <th>{md_inline(h)}</th>')
                out.append('</tr></thead><tbody>')
                for row in body:
                    out.append('<tr>')
                    for cell in row:
                        out.append(f'  <td>{md_inline(cell)}</td>')
                    out.append('</tr>')
                out.append('</tbody></table>')
            continue

        # 引用
        if stripped.startswith('> '):
            flush_list(); flush_check()
            buf = []
            while i < len(lines) and lines[i].strip().startswith('> '):
                buf.append(lines[i].strip()[2:])
                i += 1
            out.append(f'<blockquote class="jinr-quote">{md_inline(" ".join(buf))}</blockquote>')
            continue

        # コードブロック
        if stripped.startswith('```'):
            flush_list(); flush_check()
            i += 1
            buf = []
            while i < len(lines) and not lines[i].strip().startswith('```'):
                buf.append(lines[i])
                i += 1
            i += 1
            code = '\n'.join(buf)
            # HTMLエスケープ
            code = code.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
            out.append(f'<pre class="jinr-code"><code>{code}</code></pre>')
            continue

        # チェックリスト
        if re.match(r'^- \[ \]', stripped) or re.match(r'^✅', stripped) or re.match(r'^❌', stripped):
            flush_list()
            in_check = True
            item = re.sub(r'^- \[ \] |^✅\s*|^❌\s*', '', stripped)
            check_buf.append(item)
            i += 1; continue

        # リスト
        if re.match(r'^[-*]\s+', stripped):
            flush_check()
            in_list = True
            item = re.sub(r'^[-*]\s+', '', stripped)
            list_buf.append(item)
            i += 1; continue

        # コメントスキップ
        if stripped.startswith('<!--'):
            i += 1; continue

        # 空行
        if not stripped:
            flush_list(); flush_check()
            i += 1; continue

        # 通常段落
        flush_list(); flush_check()
        out.append(f'<p>{md_inline(stripped)}</p>')
        i += 1

    flush_list(); flush_check()
    return h1_title, '\n'.join(out)


# ============================================================
# テンプレート
# ============================================================

NOINDEX_META = '<meta name="robots" content="noindex,nofollow">'

HEAD_TEMPLATE = """<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
{noindex}
<meta name="description" content="{description}">
<title>{title}</title>
<link rel="stylesheet" href="{css_path}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700&display=swap" rel="stylesheet">
</head>
<body>
"""

HEADER_TEMPLATE = """<header class="site-header">
  <div class="header-inner">
    <a href="{home}" class="site-title">
      <span class="title-main">生産技術ガジェット研究所</span>
      <span class="title-sub">PREVIEW</span>
    </a>
    <nav class="site-nav"><a href="{home}">記事一覧</a></nav>
  </div>
  <div class="preview-banner">
    🚧 これは Cloudflare Pages 上のプレビューサイトです（noindex設定済・検索結果には表示されません）
  </div>
</header>
"""

FOOTER_TEMPLATE = """<footer class="site-footer">
  <p>&copy; 2026 生産技術ガジェット研究所｜本サイトはプレビュー版です</p>
  <p class="footer-note">本番サイト: <a href="https://www.ootanisatan.com">www.ootanisatan.com</a></p>
</footer>
</body>
</html>
"""


def build_index_page(articles: list[dict]) -> str:
    cards = []
    for a in articles:
        thumb_html = ""
        if a.get("thumb"):
            thumb_html = f'<div class="card-thumb" style="background-image:url(\'assets/images/{a["thumb"]}\')"></div>'
        cards.append(f"""
<article class="article-card">
  <a href="{a['slug']}/" class="card-link">
    {thumb_html}
    <div class="card-body">
      <span class="card-cat">{a['category']}</span>
      <h2 class="card-title">{a['title']}</h2>
      <p class="card-excerpt">{a['excerpt']}</p>
      <div class="card-meta">
        <time>{a['date']}</time>
      </div>
    </div>
  </a>
</article>
""")

    head = HEAD_TEMPLATE.format(
        noindex=NOINDEX_META,
        description=SITE_TAGLINE,
        title=f"{SITE_TITLE}｜{SITE_TAGLINE}",
        css_path="assets/style.css",
    )
    header = HEADER_TEMPLATE.format(home="./")
    body = f"""
<main class="site-main">
  <section class="hero">
    <h1 class="hero-title">{SITE_TITLE}</h1>
    <p class="hero-tagline">{SITE_TAGLINE}</p>
  </section>
  <section class="article-grid">
    {''.join(cards)}
  </section>
</main>
"""
    return head + header + body + FOOTER_TEMPLATE


def build_article_page(article: dict, h1: str, body_html: str) -> str:
    head = HEAD_TEMPLATE.format(
        noindex=NOINDEX_META,
        description=article["excerpt"],
        title=f"{article['title']}｜{SITE_TITLE}",
        css_path="../assets/style.css",
    )
    header = HEADER_TEMPLATE.format(home="../")

    thumb_html = ""
    if article.get("thumb"):
        thumb_html = f'<img class="article-hero-img" src="../assets/images/{article["thumb"]}" alt="">'

    page = f"""
<main class="site-main">
  <article class="article-page">
    {thumb_html}
    <header class="article-header">
      <span class="article-cat">{article['category']}</span>
      <h1 class="article-title">{h1 or article['title']}</h1>
      <div class="article-meta">
        <time>{article['date']}</time>
      </div>
    </header>
    <div class="article-body">
      {body_html}
    </div>
    <div class="article-footer">
      <a href="../" class="back-link">← 記事一覧に戻る</a>
    </div>
  </article>
</main>
"""
    return head + header + page + FOOTER_TEMPLATE


# ============================================================
# 画像コピー
# ============================================================

def copy_images():
    """記事に必要な画像と キャラクター画像を assets/images へコピー"""
    images_out = ASSETS_DIR / "images"
    images_out.mkdir(parents=True, exist_ok=True)

    # キャラクター画像（オオタニ通常 / タナカ正常）
    char_map = [
        ("blog/images/characters/オオタニ所長 通常.png", "character-ootani.png"),
        ("blog/images/characters/新人タナカ 正常 .png", "character-tanaka.png"),
    ]
    for src, dst in char_map:
        s = ROOT / src
        d = images_out / dst
        if s.exists():
            shutil.copy2(s, d)

    # 各記事のサムネ
    for a in ARTICLES:
        thumb = a.get("thumb")
        if not thumb:
            continue
        # processed / huawei-edited 等から検索
        for sub in ["processed", "huawei-edited", "huawei-resized", "raw"]:
            s = ROOT / "blog" / "images" / sub / thumb
            if s.exists():
                shutil.copy2(s, images_out / thumb)
                break


# ============================================================
# メインビルド
# ============================================================

def main():
    print(f"[build] Output: {OUT_DIR}")
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    ASSETS_DIR.mkdir(parents=True, exist_ok=True)

    # 画像コピー
    copy_images()
    print("[build] Images copied")

    # 各記事
    for a in ARTICLES:
        md_path = ARTICLES_DIR / a["md"]
        if not md_path.exists():
            print(f"[build] WARNING: missing {md_path}")
            continue
        md = md_path.read_text(encoding="utf-8")
        h1, body = render_article_body(md)
        html = build_article_page(a, h1, body)
        out_path = OUT_DIR / a["slug"] / "index.html"
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(html, encoding="utf-8")
        print(f"[build] {a['slug']}/index.html ({len(html)} chars)")

    # トップページ
    index_html = build_index_page(ARTICLES)
    (OUT_DIR / "index.html").write_text(index_html, encoding="utf-8")
    print(f"[build] index.html ({len(index_html)} chars)")

    # robots.txt
    (OUT_DIR / "robots.txt").write_text("User-agent: *\nDisallow: /\n", encoding="utf-8")
    print("[build] robots.txt")

    # _headers (Cloudflare Pages headers)
    headers = "/*\n  X-Robots-Tag: noindex, nofollow\n  Cache-Control: public, max-age=300\n"
    (OUT_DIR / "_headers").write_text(headers, encoding="utf-8")
    print("[build] _headers")

    print("[build] DONE")


if __name__ == "__main__":
    main()
