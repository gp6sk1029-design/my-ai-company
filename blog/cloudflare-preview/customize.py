#!/usr/bin/env python3
"""
mirror.py 実行後にホームHTMLを加工してスクショ通りの見た目にする後処理。

- ホームの記事リストを「★注目の記事3件 + ★最新の記事5件」の2セクション構成に再構築
- 不足している5本のダミー記事を追加（Coming Soonスタブページにリンク）
- 既存の本物記事3件 + ダミー5件 = 計8件をスクショ通りに配置

スクショの記事一覧（順序通り）:

注目の記事:
  1. Garmin Venu 2S 4年使用レビュー｜1.2万円台でも高機能できるスマートウォッチ (2026.02.04)
  2. MX ERGO Sの新モデルが快適さを完全進化｜毎日使うマウスを最高ランクの3つの技をゲット (2026.02.08)
  3. PLC通信トラブルの原因と対策｜現場で即実践できるチェックリスト付き (2026.02.10) ← ダミー

最新の記事:
  1. 【実践】Keychron K1 Maxレビュー｜薄型キーボードが完成形 (2026.02.05)
  2. 生産ラインのタクト改善事例｜ボトルネック発見から改善までの手順 (2026.01.28) ← ダミー
  3. PLCプログラミング入門講座｜基礎を実例で学ぶ3日間完全まとめ (2026.01.20) ← ダミー
  4. 仕事がはかどるデスク環境の作り方｜ガジェットと工夫術で集中力UP (2026.01.15) ← ダミー
  5. スマートウォッチで睡眠の質を可視化｜Venu 2Sの睡眠トラッキング活用術 (2026.01.08) ← ダミー
"""
from __future__ import annotations
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
OUT_DIR = ROOT / "blog" / "cloudflare-preview"
INDEX = OUT_DIR / "index.html"

# ダミー画像（既存の実在画像から拝借・ファイル名は assets/img/*.jpg のもの）
GARMIN_THUMB = "/assets/img/76b6bf2745e2.jpg"
MX_ERGO_THUMB = "/assets/img/3d120c1d15e7.jpg"
PLC_TROUBLE_THUMB = "/assets/img/9944e53aba74.jpg"
KEYCHRON_THUMB = "/assets/img/3f01adf00587.jpg"
TAKT_THUMB = "/assets/img/458641e12789.jpg"
PLC_KOZA_THUMB = "/assets/img/4fd3156ac473.jpg"
DESK_THUMB = "/assets/img/543fe3bd28e0.jpg"
SLEEP_THUMB = "/assets/img/55eb8306b3aa.jpg"

# 既存記事（実在）の URL
URL_GARMIN = "/garmin-venu-2s-%e3%82%924%e5%b9%b4%e5%8d%8a%e4%bd%bf%e3%81%a3%e3%81%9f%e3%83%aa%e3%82%a2%e3%83%ab%e3%83%ac%e3%83%93%e3%83%a5%e3%83%bc%ef%bd%9c27%e5%86%86-%e6%97%a5%e3%81%a7%e5%81%a5%e5%ba%b7%e7%ae%a1/"
URL_MX_ERGO = "/mx-ergo-s-%e3%83%ac%e3%83%93%e3%83%a5%e3%83%bc%ef%bd%9c%e3%82%a8%e3%83%b3%e3%82%b8%e3%83%8b%e3%82%a2%e3%81%ae%e3%80%8c%e7%a8%bc%e5%83%8d%e7%8e%87%e3%80%8d%e3%82%92%e4%b8%8a%e3%81%92%e3%82%8b%e6%9c%80/"
URL_KEYCHRON = "/%e3%80%90%e5%ae%9f%e6%a9%9f%e3%80%91keychron-k1-max%e3%83%ac%e3%83%93%e3%83%a5%e3%83%bc%ef%bd%9c%e8%96%84%e5%9e%8b%e3%82%ad%e3%83%bc%e3%83%9c%e3%83%bc%e3%83%89%e3%81%ae%e5%ae%8c%e6%88%90%e5%bd%a2/"

# ダミー記事の URL（スタブページ作成）
URL_PLC_TROUBLE = "/coming-soon/plc-tsushin-trouble/"
URL_TAKT = "/coming-soon/takt-improvement/"
URL_PLC_KOZA = "/coming-soon/plc-programming-koza/"
URL_DESK = "/coming-soon/desk-environment/"
URL_SLEEP = "/coming-soon/sleep-tracking/"

# 注目の記事 3件
FEATURED = [
    {
        "url": URL_GARMIN,
        "thumb": GARMIN_THUMB,
        "tag": "ガジェットレビュー",
        "tag_color": "#2563eb",
        "title": "Garmin Venu 2S 4年使用レビュー｜1.2万円台でも高機能できるスマートウォッチ",
        "date": "2026.02.04",
        "is_dummy": False,
    },
    {
        "url": URL_MX_ERGO,
        "thumb": MX_ERGO_THUMB,
        "tag": "ガジェットレビュー",
        "tag_color": "#2563eb",
        "title": "MX ERGO Sの新モデルが快適さを完全進化｜毎日使うマウスを最高ランクの3つの技をゲット",
        "date": "2026.02.08",
        "is_dummy": False,
    },
    {
        "url": URL_PLC_TROUBLE,
        "thumb": PLC_TROUBLE_THUMB,
        "tag": "生産技術",
        "tag_color": "#1e3a8a",
        "title": "PLC通信トラブルの原因と対策｜現場で即実践できるチェックリスト付き",
        "date": "2026.02.10",
        "is_dummy": True,
    },
]

# 最新の記事 5件
LATEST = [
    {
        "url": URL_KEYCHRON,
        "thumb": KEYCHRON_THUMB,
        "tag": "ガジェットレビュー",
        "tag_color": "#2563eb",
        "title": "【実践】Keychron K1 Maxレビュー｜薄型キーボードが完成形",
        "date": "2026.02.05",
        "is_dummy": False,
    },
    {
        "url": URL_TAKT,
        "thumb": TAKT_THUMB,
        "tag": "生産技術",
        "tag_color": "#1e3a8a",
        "title": "生産ラインのタクト改善事例｜ボトルネック発見から改善までの手順",
        "date": "2026.01.28",
        "is_dummy": True,
    },
    {
        "url": URL_PLC_KOZA,
        "thumb": PLC_KOZA_THUMB,
        "tag": "生産技術",
        "tag_color": "#1e3a8a",
        "title": "PLCプログラミング入門講座｜基礎を実例で学ぶ3日間完全まとめ",
        "date": "2026.01.20",
        "is_dummy": True,
    },
    {
        "url": URL_DESK,
        "thumb": DESK_THUMB,
        "tag": "暮らしハック",
        "tag_color": "#f97316",
        "title": "仕事がはかどるデスク環境の作り方｜ガジェットと工夫術で集中力UP",
        "date": "2026.01.15",
        "is_dummy": True,
    },
    {
        "url": URL_SLEEP,
        "thumb": SLEEP_THUMB,
        "tag": "ガジェットレビュー",
        "tag_color": "#2563eb",
        "title": "スマートウォッチで睡眠の質を可視化｜Venu 2Sの睡眠トラッキング活用術",
        "date": "2026.01.08",
        "is_dummy": True,
    },
]


# ============================================================
# カスタムCSS（注目／最新セクション用）
# ============================================================

CUSTOM_CSS = """
<style id="preview-custom-css">
.preview-featured-section, .preview-latest-section {
  max-width: 1100px;
  margin: 32px auto 24px;
  padding: 0 16px;
  font-family: 'Noto Sans JP', -apple-system, BlinkMacSystemFont, sans-serif;
}
.preview-section-heading {
  font-size: 1.2rem;
  font-weight: 800;
  color: #1f2937;
  margin-bottom: 16px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.preview-section-heading::before { content: "★"; color: #f97316; }
.preview-featured-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 14px;
}
.preview-featured-card {
  background: #fff;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 2px 8px rgba(0,0,0,.07);
  text-decoration: none !important;
  color: inherit;
  transition: transform .2s, box-shadow .2s;
  display: block;
  position: relative;
}
.preview-featured-card:hover {
  transform: translateY(-3px);
  box-shadow: 0 8px 18px rgba(0,0,0,.12);
}
.preview-featured-thumb {
  width: 100%;
  height: 150px;
  background-size: cover;
  background-position: center;
  background-color: #f3f4f6;
  position: relative;
}
.preview-featured-tag {
  position: absolute;
  top: 8px; left: 8px;
  color: #fff;
  font-size: 0.7rem;
  padding: 3px 9px;
  border-radius: 4px;
  font-weight: 700;
}
.preview-featured-body {
  padding: 12px 14px;
}
.preview-featured-title {
  font-size: 0.92rem;
  font-weight: 700;
  line-height: 1.5;
  color: #1f2937 !important;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  margin-bottom: 8px;
  text-decoration: none !important;
}
.preview-featured-date {
  font-size: 0.75rem;
  color: #6b7280;
}
.preview-featured-date::before { content: "🕐 "; }

.preview-latest-list {
  background: #fff;
  border-radius: 12px;
  border: 1px solid #f3f4f6;
  overflow: hidden;
  box-shadow: 0 1px 3px rgba(0,0,0,.05);
}
.preview-latest-item {
  display: grid;
  grid-template-columns: 90px 1fr auto auto;
  gap: 14px;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid #f3f4f6;
  text-decoration: none !important;
  color: inherit;
  transition: background .15s;
}
.preview-latest-item:hover { background: #f9fafb; }
.preview-latest-item:last-child { border-bottom: none; }
.preview-latest-thumb {
  width: 90px; height: 60px;
  background-size: cover;
  background-position: center;
  background-color: #f3f4f6;
  border-radius: 6px;
  flex-shrink: 0;
}
.preview-latest-title {
  font-size: 0.88rem;
  font-weight: 600;
  line-height: 1.5;
  color: #1f2937 !important;
}
.preview-latest-tag {
  color: #fff;
  font-size: 0.7rem;
  padding: 3px 9px;
  border-radius: 4px;
  font-weight: 700;
  white-space: nowrap;
}
.preview-latest-date {
  font-size: 0.78rem;
  color: #6b7280;
  white-space: nowrap;
}
.preview-latest-more {
  text-align: right;
  padding: 12px 16px;
  font-size: 0.85rem;
  color: #2563eb;
  font-weight: 600;
}

.preview-dummy-note {
  background: #fef3c7;
  border-left: 4px solid #f59e0b;
  padding: 10px 16px;
  margin: 16px 0;
  font-size: 0.82rem;
  color: #78350f;
  border-radius: 4px;
}

@media (max-width: 1024px) {
  .preview-featured-grid { grid-template-columns: repeat(2, 1fr); }
}
@media (max-width: 640px) {
  .preview-featured-grid { grid-template-columns: 1fr; }
  .preview-latest-item { grid-template-columns: 70px 1fr; gap: 10px; }
  .preview-latest-item .preview-latest-tag, .preview-latest-item .preview-latest-date { display: none; }
}
</style>
"""


def render_featured_card(a: dict) -> str:
    return f"""<a href="{a['url']}" class="preview-featured-card">
  <div class="preview-featured-thumb" style="background-image:url('{a['thumb']}')">
    <span class="preview-featured-tag" style="background:{a['tag_color']}">{a['tag']}</span>
  </div>
  <div class="preview-featured-body">
    <div class="preview-featured-title">{a['title']}</div>
    <div class="preview-featured-date">{a['date']}</div>
  </div>
</a>"""


def render_latest_item(a: dict) -> str:
    return f"""<a href="{a['url']}" class="preview-latest-item">
  <div class="preview-latest-thumb" style="background-image:url('{a['thumb']}')"></div>
  <div class="preview-latest-title">{a['title']}</div>
  <span class="preview-latest-tag" style="background:{a['tag_color']}">{a['tag']}</span>
  <span class="preview-latest-date">{a['date']}</span>
</a>"""


def build_custom_section() -> str:
    featured_cards = '\n'.join(render_featured_card(a) for a in FEATURED)
    latest_items = '\n'.join(render_latest_item(a) for a in LATEST)
    return f"""
<section class="preview-featured-section">
  <h2 class="preview-section-heading">注目の記事</h2>
  <div class="preview-featured-grid">
    {featured_cards}
  </div>
</section>

<section class="preview-latest-section">
  <h2 class="preview-section-heading">最新の記事</h2>
  <div class="preview-latest-list">
    {latest_items}
    <div class="preview-latest-more">記事一覧をみる →</div>
  </div>
  <div class="preview-dummy-note">
    ※ ⚠️ プレビュー版。"PLC通信トラブル"・"タクト改善"・"PLC講座"・"デスク環境"・"睡眠トラッキング"の5記事は<strong>まだ書かれていないダミー</strong>です（クリックすると Coming Soon ページが表示されます）。
  </div>
</section>
"""


# ============================================================
# Coming Soon スタブページ
# ============================================================

def coming_soon_html(title: str, slug_path: str) -> str:
    return f"""<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow,noarchive">
<title>Coming Soon: {title}｜生産技術ガジェット研究所 PREVIEW</title>
<style>
  body {{
    margin: 0;
    font-family: 'Noto Sans JP', -apple-system, sans-serif;
    background: linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%);
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    color: #1f2937;
  }}
  .card {{
    background: #fff;
    padding: 48px 40px;
    border-radius: 20px;
    box-shadow: 0 20px 50px rgba(0,0,0,.10);
    max-width: 600px;
    text-align: center;
  }}
  .icon {{ font-size: 4rem; margin-bottom: 16px; }}
  h1 {{
    font-size: 1.5rem;
    margin: 0 0 12px;
    line-height: 1.5;
    color: #1e3a8a;
  }}
  .badge {{
    display: inline-block;
    background: #fef3c7;
    color: #78350f;
    padding: 4px 12px;
    border-radius: 6px;
    font-size: 0.85rem;
    font-weight: 700;
    margin-bottom: 24px;
  }}
  .desc {{
    font-size: 0.95rem;
    line-height: 1.8;
    color: #4b5563;
    margin-bottom: 32px;
  }}
  .back {{
    display: inline-block;
    background: #2563eb;
    color: #fff;
    padding: 12px 28px;
    border-radius: 8px;
    text-decoration: none;
    font-weight: 700;
    font-size: 0.92rem;
  }}
  .back:hover {{ background: #1d4ed8; }}
  .footer {{
    margin-top: 32px;
    font-size: 0.78rem;
    color: #9ca3af;
  }}
</style>
</head>
<body>
<div class="card">
  <div class="icon">📝</div>
  <span class="badge">Coming Soon</span>
  <h1>{title}</h1>
  <p class="desc">この記事はまだ執筆されていません。<br>本物のブログ「生産技術ガジェット研究所」にもまだ存在しないダミーリンクです。</p>
  <a href="/" class="back">← ホームに戻る</a>
  <p class="footer">プレビュー版（noindex設定済）</p>
</div>
</body>
</html>"""


# ============================================================
# メイン処理
# ============================================================

def inject_custom_section_into_index():
    if not INDEX.exists():
        print(f"[customize] ERROR: {INDEX} not found. Run mirror.py first.")
        return False
    html = INDEX.read_text(encoding='utf-8')

    # 既に注入済みなら一旦削除（再実行時の冪等性）
    html = re.sub(
        r'<style id="preview-custom-css">.*?</style>',
        '', html, flags=re.S
    )
    html = re.sub(
        r'<section class="preview-featured-section">.*?</section>\s*<section class="preview-latest-section">.*?</section>',
        '', html, flags=re.S
    )

    # CSSを<head>末尾に追加
    html = html.replace('</head>', CUSTOM_CSS + '\n</head>', 1)

    # 既存の記事リスト（o--postlist-inner）の直前にカスタムセクションを挿入
    # 既存リストはそのまま残す（その下にスクショ準拠セクションが追加される）
    custom = build_custom_section()
    html = re.sub(
        r'(<div class="o--postlist-inner)',
        custom + r'\n\1',
        html, count=1
    )

    INDEX.write_text(html, encoding='utf-8')
    print(f"[customize] Updated {INDEX}")
    return True


def create_coming_soon_pages():
    pages = [
        (URL_PLC_TROUBLE, "PLC通信トラブルの原因と対策｜現場で即実践できるチェックリスト付き"),
        (URL_TAKT, "生産ラインのタクト改善事例｜ボトルネック発見から改善までの手順"),
        (URL_PLC_KOZA, "PLCプログラミング入門講座｜基礎を実例で学ぶ3日間完全まとめ"),
        (URL_DESK, "仕事がはかどるデスク環境の作り方｜ガジェットと工夫術で集中力UP"),
        (URL_SLEEP, "スマートウォッチで睡眠の質を可視化｜Venu 2Sの睡眠トラッキング活用術"),
    ]
    for url_path, title in pages:
        slug = url_path.strip('/')
        path = OUT_DIR / slug / "index.html"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(coming_soon_html(title, url_path), encoding='utf-8')
        print(f"[customize] {slug}/index.html (Coming Soon)")


def main():
    print("[customize] Starting post-processing...")
    if not inject_custom_section_into_index():
        return
    create_coming_soon_pages()
    print("[customize] DONE")


if __name__ == "__main__":
    main()
