#!/usr/bin/env python3
"""
Cloudflare Pages 用プレビューサイト ビルダー（本番デザイン準拠）

blog/articles/*.md を JIN:R 風の静的HTMLに変換。
本番ホーム（生産技術ガジェット研究所）のレイアウトを参考に、
ヒーロー＋カテゴリカード×4＋注目記事＋サイドバー＋ボトム特徴を実装。

使い方:
  cd /Users/shoheikoda/Documents/my-ai-company
  python3 blog/cloudflare-preview/build.py
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
SITE_TAGLINE = "現場の課題をガジェットで、仕事と生活をもっと良く。"
SITE_DESCRIPTION = "ガジェット・時短ツール・PLC・FA・効率ノウハウまで、生産技術視点で発信"

# --- 各記事のメタ情報 ---
ARTICLES = [
    {
        "slug": "garmin-venu2s-review",
        "md": "garmin-venu2s-review.md",
        "title": "Garmin Venu 2S を4年半使ったリアルレビュー｜27円/日で健康管理できる最強スマートウォッチ",
        "title_short": "Garmin Venu 2S 4年使用レビュー｜1.2万円台でも高機能できるスマートウォッチ",
        "excerpt": "Garmin Venu 2Sを4年半・1,600日以上使い込んだ超長期レビュー。1日27円のコスト・年間12万円分の生産性向上・損益分岐点135日。",
        "date": "2026-03-29",
        "category": "ガジェットレビュー",
        "category_class": "",
        "thumb": "garmin_venu2s_exterior.jpg",
    },
    {
        "slug": "huawei-gt-runner2-review",
        "md": "huawei-gt-runner2-review.md",
        "title": "【10km実走データ】HUAWEI GT Runner 2 を生産技術視点で本気レビュー",
        "title_short": "HUAWEI GT Runner 2 を生産技術視点で本気レビュー｜10km実走データ",
        "excerpt": "HUAWEI GT Runner 2を3週間実走テスト。10kmマラソンでの実測データ・ランナー特化機能・Garmin比較。",
        "date": "2026-04-21",
        "category": "ガジェットレビュー",
        "category_class": "",
        "thumb": "edited_20260420_011522.jpg",
    },
]

# 「Coming Soon」プレースホルダ（持っていない記事の枠を埋めるダミー）
PLACEHOLDER = {
    "slug": "#",
    "title_short": "Coming Soon｜近日公開予定",
    "category": "準備中",
    "category_class": "kurashi",
    "date": "----.--.--",
    "thumb": None,
    "is_placeholder": True,
}


# ============================================================
# Markdown → HTML 変換
# ============================================================

_UL_TRIGGER = re.compile(r'[0-9]|[０-９]|¥|円|％|%|日|分|時間|週|月|年|kg|g|mm|cm|km|nit|bpm|ms|回|MB|GB')


def md_inline(text: str) -> str:
    # [文字](URL) → リンク（画像 ![]() は除外するため ! の直後はマッチさせない）
    text = re.sub(
        r'(?<!\!)\[([^\]]+)\]\((https?://[^)]+)\)',
        r'<a href="\2" target="_blank" rel="noopener nofollow">\1</a>',
        text,
    )
    text = re.sub(r'\*\*\*(.+?)\*\*\*', lambda m: f'<strong class="jinr-emph">{m.group(1)}</strong>', text)
    def _bold(m):
        inner = m.group(1)
        cls = "jinr-emph" if _UL_TRIGGER.search(inner) else ""
        return f'<strong class="{cls}">{inner}</strong>' if cls else f'<strong>{inner}</strong>'
    text = re.sub(r'\*\*(.+?)\*\*', _bold, text)
    text = re.sub(r'(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)', r'<em>\1</em>', text)
    return text


def render_article_body(md: str) -> tuple[str, str]:
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

        if stripped.startswith('# ') and not h1_title:
            h1_title = stripped[2:].strip()
            i += 1; continue

        m = re.match(r'\*\*オオタニ所長[：:]\*\*\s*[「\s]*(.*?)[」]?\s*$', line)
        if m:
            flush_list(); flush_check()
            out.append(
                '<div class="jinr-fukidashi jinr-fukidashi-left">'
                '<div class="jinr-chara"><img src="../assets/images/character-ootani.png" alt="オオタニ所長"><span>オオタニ所長</span></div>'
                f'<div class="jinr-bubble">{md_inline(m.group(1))}</div>'
                '</div>'
            )
            i += 1; continue

        m = re.match(r'\*\*タナカ[：:]\*\*\s*[「\s]*(.*?)[」]?\s*$', line)
        if m:
            flush_list(); flush_check()
            out.append(
                '<div class="jinr-fukidashi jinr-fukidashi-right">'
                f'<div class="jinr-bubble">{md_inline(m.group(1))}</div>'
                '<div class="jinr-chara"><img src="../assets/images/character-tanaka.png" alt="タナカ"><span>新人タナカ</span></div>'
                '</div>'
            )
            i += 1; continue

        if stripped.startswith('## '):
            flush_list(); flush_check()
            out.append(f'<h2 class="jinr-h2">{md_inline(stripped[3:])}</h2>')
            i += 1; continue
        if stripped.startswith('### '):
            flush_list(); flush_check()
            out.append(f'<h3 class="jinr-h3">{md_inline(stripped[4:])}</h3>')
            i += 1; continue

        if stripped == '---':
            flush_list(); flush_check()
            out.append('<hr class="jinr-sep">')
            i += 1; continue

        if stripped.startswith('|'):
            flush_list(); flush_check()
            tbl = []
            while i < len(lines) and lines[i].strip().startswith('|'):
                cells = [c.strip() for c in lines[i].strip().split('|')[1:-1]]
                tbl.append(cells)
                i += 1
            if len(tbl) >= 2:
                headers = tbl[0]
                body = [r for r in tbl[2:] if any(c.strip() for c in r)]
                out.append('<table class="jinr-table"><thead><tr>')
                for h in headers:
                    out.append(f'<th>{md_inline(h)}</th>')
                out.append('</tr></thead><tbody>')
                for row in body:
                    out.append('<tr>')
                    for cell in row:
                        out.append(f'<td>{md_inline(cell)}</td>')
                    out.append('</tr>')
                out.append('</tbody></table>')
            continue

        if stripped.startswith('> '):
            flush_list(); flush_check()
            buf = []
            while i < len(lines) and lines[i].strip().startswith('> '):
                buf.append(lines[i].strip()[2:])
                i += 1
            out.append(f'<blockquote class="jinr-quote">{md_inline(" ".join(buf))}</blockquote>')
            continue

        if stripped.startswith('```'):
            flush_list(); flush_check()
            i += 1
            buf = []
            while i < len(lines) and not lines[i].strip().startswith('```'):
                buf.append(lines[i])
                i += 1
            i += 1
            code = '\n'.join(buf).replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
            out.append(f'<pre class="jinr-code"><code>{code}</code></pre>')
            continue

        if re.match(r'^- \[ \]', stripped) or re.match(r'^✅', stripped) or re.match(r'^❌', stripped):
            flush_list()
            in_check = True
            item = re.sub(r'^- \[ \] |^✅\s*|^❌\s*', '', stripped)
            check_buf.append(item)
            i += 1; continue

        if re.match(r'^[-*]\s+', stripped):
            flush_check()
            in_list = True
            item = re.sub(r'^[-*]\s+', '', stripped)
            list_buf.append(item)
            i += 1; continue

        if stripped.startswith('<!--') or not stripped:
            flush_list(); flush_check()
            i += 1; continue

        flush_list(); flush_check()
        out.append(f'<p>{md_inline(stripped)}</p>')
        i += 1

    flush_list(); flush_check()
    return h1_title, '\n'.join(out)


# ============================================================
# テンプレート部品
# ============================================================

NOINDEX_META = '<meta name="robots" content="noindex,nofollow">'

GOOGLE_FONTS = '''<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700;800&display=swap" rel="stylesheet">'''


def head(title: str, description: str, css_path: str) -> str:
    return f"""<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
{NOINDEX_META}
<meta name="description" content="{description}">
<title>{title}</title>
<link rel="stylesheet" href="{css_path}">
{GOOGLE_FONTS}
</head>
<body>
"""


def header_html(home: str, active: str = "home") -> str:
    nav_items = [
        ("home", home, "🏠 ホーム"),
        ("gadget", "#", "🛒 ガジェット"),
        ("gijutsu", "#", "⚙️ 生産技術"),
        ("shigoto", "#", "📋 仕事術"),
        ("profile", "#", "👤 プロフィール"),
        ("contact", "#", "✉️ お問い合わせ"),
    ]
    nav_html = ""
    for key, href, label in nav_items:
        cls = " class=\"active\"" if key == active else ""
        nav_html += f'<a href="{href}"{cls}>{label}</a>'

    return f"""<header class="site-header">
  <div class="header-container">
    <div class="brand">
      <div class="brand-logo">⚙</div>
      <div class="brand-text">
        <h1>{SITE_TITLE}</h1>
        <p>{SITE_TAGLINE}</p>
      </div>
    </div>
    <nav class="primary-nav">{nav_html}</nav>
    <button class="search-btn" aria-label="検索">🔍</button>
  </div>
</header>
<div class="preview-banner">🚧 これは Cloudflare Pages 上のプレビュー版です（noindex設定済・検索結果には表示されません）</div>
"""


def footer_html() -> str:
    return f"""<footer class="site-footer">
  <p>&copy; 2026 {SITE_TITLE}｜本サイトはプレビュー版です</p>
  <p>本番サイト: <a href="https://www.ootanisatan.com">www.ootanisatan.com</a></p>
</footer>
</body>
</html>
"""


# ============================================================
# ホームページ専用セクション
# ============================================================

def hero_section() -> str:
    return f"""<section class="hero">
  <div class="hero-container">
    <div class="hero-text">
      <h2 class="hero-title">
        <span class="hl">ガジェット</span>と<span class="hl">生産技術</span>の力で、<br>
        現場の「ムダ」をなくし、仕事と生活をアップデート。
      </h2>
      <p class="hero-desc">
        スマートウォッチや便利なツールからPLC・センサ・FA・効率ノウハウまで。<br>
        エンジニアの毎日を効率化する実践的な情報を発信します。
      </p>
      <div class="hero-cta">
        <a href="#latest" class="btn btn-primary">📤 最新の記事を読む</a>
        <a href="#categories" class="btn btn-secondary">📁 カテゴリから探す</a>
      </div>
    </div>
    <div class="hero-character">
      <div class="hero-bubble">生産技術を、もっとスマートに、もっと楽しく。</div>
      <img src="assets/images/character-ootani.png" alt="所長キャラクター">
    </div>
  </div>
</section>"""


def categories_section() -> str:
    cats = [
        ("⌚", "ガジェット研究室", "スマートウォッチ・PC周辺機器・便利グッズのレビューと活用術", "cat-blue", ""),
        ("⚙️", "生産技術研究室", "PLC・センサ・安全・改善・生産技術のノウハウと事例", "cat-blue", ""),
        ("⏱", "時短ツール研究室", "AIツール・アプリ・効率化ツールで時短につながる活用法を紹介", "cat-blue", ""),
        ("🏠", "暮らしハック研究室", "日常の効率化・健康・節約など暮らしに役立つ実践的なヒント", "cat-orange", "has-orange"),
    ]
    cards = []
    for icon, title, desc, icon_cls, card_cls in cats:
        cards.append(f"""<a href="#" class="cat-card {card_cls}">
      <div class="cat-icon {icon_cls}">{icon}</div>
      <h3>{title}</h3>
      <p>{desc}</p>
      <div class="cat-card-arrow">→</div>
    </a>""")
    return f"""<section class="cat-section" id="categories">
  <div class="cat-grid">
    {''.join(cards)}
  </div>
</section>"""


def featured_article_card(article: dict) -> str:
    if article.get("is_placeholder"):
        return f"""<div class="featured-card" style="opacity:0.5;cursor:default;pointer-events:none;">
      <div class="featured-thumb" style="background:#f3f4f6;display:flex;align-items:center;justify-content:center;color:#9ca3af;font-size:2rem;">📝</div>
      <div class="featured-body">
        <div class="featured-title">{article['title_short']}</div>
        <div class="featured-meta">🕐 {article['date']}</div>
      </div>
    </div>"""

    thumb_style = ""
    if article.get("thumb"):
        thumb_style = f"background-image:url('assets/images/{article['thumb']}')"

    cat_cls = article.get("category_class", "")
    return f"""<a href="{article['slug']}/" class="featured-card">
      <div class="featured-thumb" style="{thumb_style}">
        <span class="featured-tag {cat_cls}">{article['category']}</span>
      </div>
      <div class="featured-body">
        <div class="featured-title">{article['title_short']}</div>
        <div class="featured-meta">🕐 {article['date']}</div>
      </div>
    </a>"""


def latest_item_html(article: dict) -> str:
    if article.get("is_placeholder"):
        return f"""<div class="latest-item" style="opacity:0.5;">
      <div class="latest-thumb" style="background:#f3f4f6;display:flex;align-items:center;justify-content:center;color:#9ca3af;font-size:1.5rem;">📝</div>
      <div class="latest-title">{article['title_short']}</div>
      <span class="latest-tag {article.get('category_class','')}">{article['category']}</span>
      <span class="latest-date">{article['date']}</span>
    </div>"""

    thumb_style = ""
    if article.get("thumb"):
        thumb_style = f"background-image:url('assets/images/{article['thumb']}')"
    return f"""<a href="{article['slug']}/" class="latest-item">
      <div class="latest-thumb" style="{thumb_style}"></div>
      <div class="latest-title">{article['title_short']}</div>
      <span class="latest-tag {article.get('category_class','')}">{article['category']}</span>
      <span class="latest-date">{article['date'].replace('-', '.')}</span>
    </a>"""


def featured_section() -> str:
    cards = [featured_article_card(a) for a in ARTICLES]
    while len(cards) < 3:
        cards.append(featured_article_card(PLACEHOLDER))
    cards = cards[:3]

    latest_items = [latest_item_html(a) for a in ARTICLES]
    while len(latest_items) < 3:
        latest_items.append(latest_item_html(PLACEHOLDER))
    latest_items = latest_items[:5]

    return f"""<div class="main-column">
  <h2 class="section-heading" id="featured">注目の記事</h2>
  <div class="featured-grid">
    {''.join(cards)}
  </div>
  <h2 class="section-heading" id="latest">最新の記事</h2>
  <div class="latest-list">
    {''.join(latest_items)}
    <div class="latest-more">記事一覧をみる →</div>
  </div>
</div>"""


def sidebar_section() -> str:
    rank_items = []
    medals = ["🥇", "🥈", "🥉"]
    rank_articles = ARTICLES + [PLACEHOLDER]
    for i, a in enumerate(rank_articles[:3]):
        thumb_style = ""
        if a.get("thumb"):
            thumb_style = f"background-image:url('assets/images/{a['thumb']}')"
        elif a.get("is_placeholder"):
            thumb_style = "background:#f3f4f6;display:flex;align-items:center;justify-content:center;color:#9ca3af;font-size:1.2rem;"

        rank_items.append(f"""<li class="rank-list-item">
        <span class="rank-icon">{medals[i]}</span>
        <div class="rank-thumb" style="{thumb_style}">{('📝' if a.get('is_placeholder') else '')}</div>
        <div class="rank-title">{a['title_short']}</div>
      </li>""")

    return f"""<aside class="sidebar">

  <div class="search-widget">
    <input type="text" placeholder="検索キーワードを入力" disabled>
    <button>🔍</button>
  </div>

  <div class="widget profile-widget">
    <h3 class="widget-title">運営者プロフィール</h3>
    <div class="profile-body">
      <img class="profile-avatar" src="assets/images/character-ootani.png" alt="所長">
      <div>
        <p class="profile-text">生産技術エンジニア。<br>工場の安全・効率化に取り組むエンジニア。ガジェットと生産技術で、日々の仕事を強化する情報を発信しています。</p>
        <a class="profile-link" href="#">プロフィールをみる →</a>
      </div>
    </div>
  </div>

  <div class="widget popular-widget">
    <h3 class="widget-title">人気記事ランキング</h3>
    <ol class="ranking-list">
      {''.join(rank_items)}
    </ol>
  </div>

  <div class="learn-widget">
    <div class="learn-text">なにか知りたいこと？<br>一緒に学んでいきましょう！</div>
    <img src="assets/images/character-tanaka.png" alt="新人タナカ">
  </div>

</aside>"""


def features_section() -> str:
    feats = [
        ("📋", "実体験ベースのレビュー", "実際に使って検証した情報だけを基準にレビューします。"),
        ("⚙️", "生産技術の知見を共有", "現場での改善提案・自動化のノウハウをわかりやすく解説。"),
        ("🤖", "FA・PLC・自動化に強い", "制御・センサ安全・ネットワークまで幅広くカバー。"),
        ("💡", "明日から使える実践ノウハウ", "すぐに現場で試せる、実践的な内容をお届けします。"),
    ]
    items = []
    for icon, title, desc in feats:
        items.append(f"""<div class="feature-item">
      <div class="feature-icon">{icon}</div>
      <h3>{title}</h3>
      <p>{desc}</p>
    </div>""")
    return f"""<section class="features-section">
  <div class="features-grid">
    {''.join(items)}
  </div>
</section>"""


# ============================================================
# ページ生成
# ============================================================

def build_index_page() -> str:
    title = f"{SITE_TITLE}｜{SITE_TAGLINE}"
    parts = [
        head(title, SITE_DESCRIPTION, "assets/style.css"),
        header_html("./", active="home"),
        hero_section(),
        categories_section(),
        '<section class="content-section">',
        '  <div class="content-grid">',
        featured_section(),
        sidebar_section(),
        '  </div>',
        '</section>',
        features_section(),
        footer_html(),
    ]
    return '\n'.join(parts)


def build_article_page(article: dict, h1: str, body_html: str) -> str:
    title = f"{article['title']}｜{SITE_TITLE}"
    thumb_html = ""
    if article.get("thumb"):
        thumb_html = f'<img class="article-hero-img" src="../assets/images/{article["thumb"]}" alt="">'

    parts = [
        head(title, article["excerpt"], "../assets/style.css"),
        header_html("../", active=""),
        '<main class="article-page">',
        '  <article class="article-page-inner">',
        f'    {thumb_html}',
        '    <header class="article-header">',
        f'      <span class="article-cat">{article["category"]}</span>',
        f'      <h1 class="article-title">{h1 or article["title"]}</h1>',
        f'      <div class="article-meta">🕐 {article["date"]}</div>',
        '    </header>',
        f'    <div class="article-body">{body_html}</div>',
        '    <footer class="article-footer">',
        '      <a href="../" class="back-link">← 記事一覧に戻る</a>',
        '    </footer>',
        '  </article>',
        '</main>',
        footer_html(),
    ]
    return '\n'.join(parts)


# ============================================================
# 画像コピー
# ============================================================

def copy_images():
    images_out = ASSETS_DIR / "images"
    images_out.mkdir(parents=True, exist_ok=True)

    char_map = [
        ("blog/images/characters/オオタニ所長 通常.png", "character-ootani.png"),
        ("blog/images/characters/新人タナカ 正常 .png", "character-tanaka.png"),
    ]
    for src, dst in char_map:
        s = ROOT / src
        d = images_out / dst
        if s.exists():
            shutil.copy2(s, d)

    for a in ARTICLES:
        thumb = a.get("thumb")
        if not thumb:
            continue
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

    copy_images()
    print("[build] Images copied")

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

    index_html = build_index_page()
    (OUT_DIR / "index.html").write_text(index_html, encoding="utf-8")
    print(f"[build] index.html ({len(index_html)} chars)")

    (OUT_DIR / "robots.txt").write_text("User-agent: *\nDisallow: /\n", encoding="utf-8")
    headers = "/*\n  X-Robots-Tag: noindex, nofollow\n  Cache-Control: public, max-age=300\n"
    (OUT_DIR / "_headers").write_text(headers, encoding="utf-8")
    print("[build] robots.txt + _headers")
    print("[build] DONE")


if __name__ == "__main__":
    main()
