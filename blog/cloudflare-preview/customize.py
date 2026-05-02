#!/usr/bin/env python3
"""
スクショ通りの見た目のホームページを完全リビルドする。

mirror.py が生成した本物ミラー版（live siteと同じ）を、
スクショの目標デザインに置き換える。

含まれる要素:
1. ヘッダー（ロゴ＋ナビ＋検索ボタン）
2. ヒーロー（キャッチコピー＋ボタン2つ＋PTGL青年キャラ＋吹き出し）
3. カテゴリ4カード（ガジェット研究室／生産技術研究室／時短ツール研究室／暮らしハック研究室）
4. ★ 注目の記事（3カード）
5. ★ 最新の記事（5項目リスト）
6. サイドバー（検索／プロフィール／人気記事ランキング／なにか知りたい?）
7. ボトム4特徴（実体験／知見共有／FA・PLC／実践ノウハウ）
8. フッター

スタイルは Noto Sans JP + 自前CSS（JIN:Rライクな水色アンダーライン等）。
"""
from __future__ import annotations
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
OUT_DIR = ROOT / "blog" / "cloudflare-preview"
INDEX = OUT_DIR / "index.html"

# ============================================================
# データ定義
# ============================================================

# 既存記事URL（ミラー済み・実在）
URL_GARMIN = "/garmin-venu-2s-%e3%82%924%e5%b9%b4%e5%8d%8a%e4%bd%bf%e3%81%a3%e3%81%9f%e3%83%aa%e3%82%a2%e3%83%ab%e3%83%ac%e3%83%93%e3%83%a5%e3%83%bc%ef%bd%9c27%e5%86%86-%e6%97%a5%e3%81%a7%e5%81%a5%e5%ba%b7%e7%ae%a1/"
URL_MX_ERGO = "/mx-ergo-s-%e3%83%ac%e3%83%93%e3%83%a5%e3%83%bc%ef%bd%9c%e3%82%a8%e3%83%b3%e3%82%b8%e3%83%8b%e3%82%a2%e3%81%ae%e3%80%8c%e7%a8%bc%e5%83%8d%e7%8e%87%e3%80%8d%e3%82%92%e4%b8%8a%e3%81%92%e3%82%8b%e6%9c%80/"
URL_KEYCHRON = "/%e3%80%90%e5%ae%9f%e6%a9%9f%e3%80%91keychron-k1-max%e3%83%ac%e3%83%93%e3%83%a5%e3%83%bc%ef%bd%9c%e8%96%84%e5%9e%8b%e3%82%ad%e3%83%bc%e3%83%9c%e3%83%bc%e3%83%89%e3%81%ae%e5%ae%8c%e6%88%90%e5%bd%a2/"

# ダミー記事URL（Coming Soonページ）
URL_PLC_TROUBLE = "/coming-soon/plc-tsushin-trouble/"
URL_TAKT = "/coming-soon/takt-improvement/"
URL_PLC_KOZA = "/coming-soon/plc-programming-koza/"
URL_DESK = "/coming-soon/desk-environment/"
URL_SLEEP = "/coming-soon/sleep-tracking/"

# 注目の記事（スクショ準拠・3件）
FEATURED = [
    {
        "url": URL_GARMIN,
        "thumb": "/assets/img/76b6bf2745e2.jpg",
        "tag": "ガジェットレビュー",
        "tag_color": "#2563eb",
        "title": "Garmin Venu 2S 4年使用レビュー｜1.2万円台でも高機能できるスマートウォッチ",
        "date": "2026.02.04",
    },
    {
        "url": URL_MX_ERGO,
        "thumb": "/assets/img/3d120c1d15e7.jpg",
        "tag": "ガジェットレビュー",
        "tag_color": "#2563eb",
        "title": "MX ERGO Sの新モデルが快適さを完全進化｜毎日使うマウスを最高ランクの3つの技をゲット",
        "date": "2026.02.08",
    },
    {
        "url": URL_PLC_TROUBLE,
        "thumb": "/assets/img/9944e53aba74.jpg",
        "tag": "生産技術",
        "tag_color": "#1e3a8a",
        "title": "PLC通信トラブルの原因と対策｜現場で即実践できるチェックリスト付き",
        "date": "2026.02.10",
    },
]

# 最新の記事（スクショ準拠・5件）
LATEST = [
    {
        "url": URL_KEYCHRON,
        "thumb": "/assets/img/3f01adf00587.jpg",
        "tag": "ガジェットレビュー",
        "tag_color": "#2563eb",
        "title": "【実践】Keychron K1 Maxレビュー｜薄型キーボードが完成形",
        "date": "2026.02.05",
    },
    {
        "url": URL_TAKT,
        "thumb": "/assets/img/458641e12789.jpg",
        "tag": "生産技術",
        "tag_color": "#1e3a8a",
        "title": "生産ラインのタクト改善事例｜ボトルネック発見から改善までの手順",
        "date": "2026.01.28",
    },
    {
        "url": URL_PLC_KOZA,
        "thumb": "/assets/img/4fd3156ac473.jpg",
        "tag": "生産技術",
        "tag_color": "#1e3a8a",
        "title": "PLCプログラミング入門講座｜基礎を実例で学ぶ3日間完全まとめ",
        "date": "2026.01.20",
    },
    {
        "url": URL_DESK,
        "thumb": "/assets/img/543fe3bd28e0.jpg",
        "tag": "暮らしハック",
        "tag_color": "#f97316",
        "title": "仕事がはかどるデスク環境の作り方｜ガジェットと工夫術で集中力UP",
        "date": "2026.01.15",
    },
    {
        "url": URL_SLEEP,
        "thumb": "/assets/img/55eb8306b3aa.jpg",
        "tag": "ガジェットレビュー",
        "tag_color": "#2563eb",
        "title": "スマートウォッチで睡眠の質を可視化｜Venu 2Sの睡眠トラッキング活用術",
        "date": "2026.01.08",
    },
]

# 人気記事ランキング（3件）
RANKING = [
    {"url": URL_GARMIN, "thumb": "/assets/img/76b6bf2745e2.jpg",
     "title": "Garmin Venu 2S 4年使用レビュー｜1.2万円台でも高機能できるスマートウォッチ"},
    {"url": URL_MX_ERGO, "thumb": "/assets/img/3d120c1d15e7.jpg",
     "title": "MX ERGO Sの新モデルが快適さを解説｜毎日使うマウスの完成形とは？"},
    {"url": URL_KEYCHRON, "thumb": "/assets/img/3f01adf00587.jpg",
     "title": "【実践】Keychron K1 Maxレビュー｜薄型キーボードが完成形"},
]


# ============================================================
# CSS（インライン）
# ============================================================

CSS = """
* { box-sizing: border-box; margin: 0; padding: 0; }

:root {
  --c-primary: #1d4ed8;
  --c-primary-dark: #1e3a8a;
  --c-primary-light: #3b82f6;
  --c-accent: #f97316;
  --c-text: #1f2937;
  --c-text-soft: #4b5563;
  --c-text-light: #6b7280;
  --c-bg: #fff;
  --c-bg-soft: #f9fafb;
  --c-bg-blue: #eff6ff;
  --c-bg-blue-2: #dbeafe;
  --c-border: #e5e7eb;
  --c-border-soft: #f3f4f6;
  --shadow-sm: 0 1px 3px rgba(0,0,0,.06);
  --shadow-md: 0 4px 12px rgba(0,0,0,.08);
  --shadow-lg: 0 10px 28px rgba(0,0,0,.10);
  --r-sm: 6px; --r-md: 10px; --r-lg: 16px;
  --container: 1200px;
}

html { font-size: 16px; }
body {
  font-family: 'Noto Sans JP', -apple-system, BlinkMacSystemFont, "Hiragino Kaku Gothic ProN", sans-serif;
  color: var(--c-text);
  background: #fff;
  line-height: 1.7;
  -webkit-font-smoothing: antialiased;
}

a { color: var(--c-primary); text-decoration: none; }
a:hover { text-decoration: underline; }
img { max-width: 100%; height: auto; display: block; }

/* プレビューバナー */
.preview-banner {
  background: linear-gradient(90deg,#fef3c7,#fde68a);
  color: #78350f;
  text-align: center;
  font-size: 13px;
  padding: 8px 16px;
  border-bottom: 1px solid #fcd34d;
  position: relative;
  z-index: 9999;
}
.preview-banner a { color: #78350f; text-decoration: underline; }

/* サイトヘッダー */
.site-header {
  background: #fff;
  border-bottom: 1px solid var(--c-border);
  position: sticky; top: 0; z-index: 100;
}
.header-inner {
  max-width: var(--container);
  margin: 0 auto;
  padding: 14px 24px;
  display: flex;
  align-items: center;
  gap: 24px;
}
.brand {
  display: flex; align-items: center; gap: 12px;
}
.brand-logo {
  width: 40px; height: 40px;
  border-radius: 50%;
  background: var(--c-primary);
  display: flex; align-items: center; justify-content: center;
  color: #fff; font-size: 22px;
}
.brand-text h1 {
  font-size: 1.05rem;
  font-weight: 800;
  color: var(--c-primary-dark);
  line-height: 1.2;
}
.brand-text p {
  font-size: 0.7rem;
  color: var(--c-text-light);
  line-height: 1.3;
}
.primary-nav {
  display: flex; align-items: center;
  flex: 1; justify-content: flex-end; gap: 4px;
  flex-wrap: wrap;
}
.primary-nav a {
  color: var(--c-text);
  font-size: 0.85rem;
  font-weight: 500;
  padding: 8px 14px;
  border-radius: var(--r-sm);
  display: inline-flex; align-items: center; gap: 6px;
  position: relative;
}
.primary-nav a:hover {
  color: var(--c-primary);
  text-decoration: none;
}
.primary-nav a.active {
  color: var(--c-primary);
  font-weight: 700;
}
.primary-nav a.active::after {
  content: "";
  position: absolute;
  left: 14px; right: 14px;
  bottom: 0;
  height: 3px;
  background: var(--c-primary);
  border-radius: 2px;
}
.search-btn {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 1.2rem;
  padding: 8px;
  color: var(--c-text);
}

/* ヒーロー */
.hero {
  background:
    radial-gradient(1000px 500px at 80% 50%, rgba(96,165,250,0.12) 0%, transparent 60%),
    linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 60%, #dbeafe 100%);
  padding: 56px 24px 72px;
  position: relative;
  overflow: hidden;
}
.hero::before {
  content: "";
  position: absolute; inset: 0;
  background-image:
    radial-gradient(circle at 75% 30%, rgba(59,130,246,0.06) 1px, transparent 1px),
    radial-gradient(circle at 85% 70%, rgba(59,130,246,0.06) 1px, transparent 1px);
  background-size: 50px 50px;
  pointer-events: none;
}
.hero-inner {
  max-width: var(--container);
  margin: 0 auto;
  display: grid;
  grid-template-columns: 1.4fr 1fr;
  gap: 48px;
  align-items: center;
  position: relative;
  z-index: 1;
}
.hero-title {
  font-size: 2.1rem;
  font-weight: 800;
  line-height: 1.5;
  color: var(--c-text);
  margin-bottom: 20px;
}
.hero-title .hl { color: var(--c-primary); }
.hero-desc {
  font-size: 0.95rem;
  color: var(--c-text-soft);
  line-height: 1.9;
  margin-bottom: 28px;
}
.hero-cta { display: flex; gap: 12px; flex-wrap: wrap; }
.btn {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 13px 26px;
  border-radius: var(--r-md);
  font-size: 0.92rem;
  font-weight: 700;
  text-decoration: none;
  transition: all .2s;
  border: 2px solid transparent;
}
.btn-primary {
  background: var(--c-primary);
  color: #fff;
  box-shadow: var(--shadow-md);
}
.btn-primary:hover {
  background: var(--c-primary-dark);
  transform: translateY(-1px);
  box-shadow: var(--shadow-lg);
  text-decoration: none;
  color: #fff;
}
.btn-secondary {
  background: #fff;
  color: var(--c-primary);
  border-color: var(--c-primary);
}
.btn-secondary:hover { background: var(--c-bg-blue); text-decoration: none; }

.hero-character {
  position: relative;
  text-align: center;
}
.hero-character img {
  max-width: 100%;
  width: 280px;
  margin: 0 auto;
  filter: drop-shadow(0 10px 20px rgba(0,0,0,0.10));
}
.hero-bubble {
  position: absolute;
  top: 24px; right: -10px;
  background: #fff;
  padding: 12px 18px;
  border-radius: var(--r-md);
  box-shadow: var(--shadow-md);
  font-size: 0.85rem;
  font-weight: 500;
  color: var(--c-text);
  max-width: 220px;
  line-height: 1.5;
}
.hero-bubble::after {
  content: "";
  position: absolute;
  bottom: -8px; left: 30px;
  width: 16px; height: 16px;
  background: #fff;
  transform: rotate(45deg);
  box-shadow: 4px 4px 8px -2px rgba(0,0,0,.08);
}

/* カテゴリカード4枚 */
.cat-section {
  max-width: var(--container);
  margin: -48px auto 0;
  padding: 0 24px;
  position: relative;
  z-index: 2;
}
.cat-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 20px;
}
.cat-card {
  background: #fff;
  border-radius: var(--r-lg);
  padding: 24px 20px;
  box-shadow: var(--shadow-md);
  text-decoration: none;
  color: inherit;
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  border: 1px solid var(--c-border-soft);
  transition: transform .2s, box-shadow .2s;
}
.cat-card:hover {
  transform: translateY(-4px);
  box-shadow: var(--shadow-lg);
  text-decoration: none;
}
.cat-icon {
  width: 64px; height: 64px;
  border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 28px;
  color: #fff;
  margin-bottom: 14px;
}
.cat-icon.blue { background: var(--c-primary); }
.cat-icon.orange { background: var(--c-accent); }
.cat-card h3 {
  font-size: 1.05rem;
  font-weight: 800;
  color: var(--c-text);
  margin-bottom: 8px;
}
.cat-card p {
  font-size: 0.8rem;
  color: var(--c-text-light);
  line-height: 1.7;
}
.cat-arrow {
  position: absolute;
  right: 16px; bottom: 16px;
  width: 26px; height: 26px;
  border-radius: 50%;
  background: var(--c-primary);
  color: #fff;
  display: flex; align-items: center; justify-content: center;
  font-size: 14px;
}
.cat-card.has-orange .cat-arrow { background: var(--c-accent); }

/* メインコンテンツ */
.content-section {
  max-width: var(--container);
  margin: 56px auto;
  padding: 0 24px;
}
.content-grid {
  display: grid;
  grid-template-columns: 1fr 320px;
  gap: 40px;
  align-items: start;
}
.section-heading {
  font-size: 1.25rem;
  font-weight: 800;
  color: var(--c-text);
  margin-bottom: 20px;
  display: flex; align-items: center; gap: 8px;
}
.section-heading::before { content: "★"; color: var(--c-accent); }

/* 注目の記事 */
.featured-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
  margin-bottom: 40px;
}
.featured-card {
  background: #fff;
  border-radius: var(--r-md);
  overflow: hidden;
  box-shadow: var(--shadow-sm);
  border: 1px solid var(--c-border-soft);
  text-decoration: none;
  color: inherit;
  transition: transform .2s, box-shadow .2s;
}
.featured-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-md);
  text-decoration: none;
}
.featured-thumb {
  width: 100%; height: 160px;
  background-size: cover; background-position: center;
  background-color: #f3f4f6;
  position: relative;
}
.featured-tag {
  position: absolute;
  top: 8px; left: 8px;
  color: #fff;
  font-size: 0.7rem;
  padding: 3px 10px;
  border-radius: var(--r-sm);
  font-weight: 700;
}
.featured-body { padding: 14px 16px; }
.featured-title {
  font-size: 0.92rem;
  font-weight: 700;
  line-height: 1.5;
  margin-bottom: 8px;
  color: var(--c-text);
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.featured-date {
  font-size: 0.75rem;
  color: var(--c-text-light);
}

/* 最新の記事 */
.latest-list {
  background: #fff;
  border-radius: var(--r-md);
  border: 1px solid var(--c-border-soft);
  overflow: hidden;
}
.latest-item {
  display: grid;
  grid-template-columns: 80px 1fr auto auto;
  gap: 14px;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid var(--c-border-soft);
  text-decoration: none;
  color: inherit;
  transition: background .15s;
}
.latest-item:hover { background: var(--c-bg-soft); text-decoration: none; }
.latest-item:last-child { border-bottom: none; }
.latest-thumb {
  width: 80px; height: 56px;
  background-size: cover; background-position: center;
  background-color: #f3f4f6;
  border-radius: var(--r-sm);
}
.latest-title {
  font-size: 0.88rem;
  font-weight: 600;
  line-height: 1.5;
  color: var(--c-text);
}
.latest-tag {
  color: #fff;
  font-size: 0.7rem;
  padding: 3px 8px;
  border-radius: var(--r-sm);
  font-weight: 700;
  white-space: nowrap;
}
.latest-date {
  font-size: 0.78rem;
  color: var(--c-text-light);
  white-space: nowrap;
}
.latest-more {
  text-align: right;
  padding: 12px 16px;
  font-size: 0.85rem;
  color: var(--c-primary);
  font-weight: 600;
}

/* サイドバー */
.sidebar {
  display: flex; flex-direction: column; gap: 24px;
}
.widget {
  background: #fff;
  border: 1px solid var(--c-border-soft);
  border-radius: var(--r-md);
  padding: 20px;
}
.widget-title {
  font-size: 0.95rem;
  font-weight: 800;
  color: var(--c-text);
  margin-bottom: 14px;
  padding-bottom: 8px;
  border-bottom: 2px solid var(--c-primary);
  display: inline-block;
}
.search-widget {
  display: flex;
  background: #fff;
  border: 1px solid var(--c-border);
  border-radius: var(--r-md);
  overflow: hidden;
}
.search-widget input {
  flex: 1;
  padding: 12px 14px;
  border: none;
  font-size: 0.85rem;
  outline: none;
  font-family: inherit;
}
.search-widget button {
  background: var(--c-primary);
  color: #fff;
  border: none;
  padding: 0 16px;
  cursor: pointer;
  font-size: 1rem;
}
.profile-body {
  display: flex; gap: 12px; align-items: flex-start;
}
.profile-avatar {
  width: 56px; height: 56px;
  border-radius: 50%;
  border: 3px solid var(--c-primary);
  object-fit: cover;
  flex-shrink: 0;
  background: #fff;
}
.profile-text {
  font-size: 0.8rem;
  color: var(--c-text-soft);
  line-height: 1.6;
}
.profile-link {
  display: inline-block;
  margin-top: 10px;
  font-size: 0.78rem;
  color: var(--c-primary);
  font-weight: 700;
}
.ranking-list { list-style: none; display: flex; flex-direction: column; gap: 12px; }
.ranking-list li {
  display: grid;
  grid-template-columns: 32px 60px 1fr;
  gap: 10px;
  align-items: center;
}
.ranking-list a { color: inherit; text-decoration: none; }
.rank-icon { font-size: 1.2rem; text-align: center; }
.rank-thumb {
  width: 60px; height: 44px;
  background-size: cover; background-position: center;
  background-color: #f3f4f6;
  border-radius: var(--r-sm);
}
.rank-title {
  font-size: 0.78rem;
  font-weight: 600;
  line-height: 1.5;
  color: var(--c-text);
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.learn-widget {
  display: grid;
  grid-template-columns: 1fr 100px;
  gap: 12px;
  align-items: center;
  background: var(--c-bg-blue);
  border-radius: var(--r-md);
  padding: 16px;
  border: 1px solid var(--c-bg-blue-2);
}
.learn-text {
  font-size: 0.85rem;
  font-weight: 700;
  color: var(--c-primary-dark);
  line-height: 1.5;
}
.learn-widget img { width: 100px; height: auto; }

/* ボトム特徴 */
.features-section {
  background: var(--c-bg-soft);
  padding: 56px 24px;
  border-top: 1px solid var(--c-border);
}
.features-grid {
  max-width: var(--container);
  margin: 0 auto;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 32px;
}
.feature-item { text-align: center; }
.feature-icon {
  width: 72px; height: 72px;
  margin: 0 auto 16px;
  border-radius: 50%;
  background: var(--c-bg-blue);
  display: flex; align-items: center; justify-content: center;
  font-size: 32px;
  color: var(--c-primary);
}
.feature-item h3 {
  font-size: 1rem;
  font-weight: 800;
  color: var(--c-text);
  margin-bottom: 10px;
}
.feature-item p {
  font-size: 0.83rem;
  color: var(--c-text-light);
  line-height: 1.7;
}

/* フッター */
.site-footer {
  background: var(--c-primary-dark);
  color: #fff;
  padding: 32px 24px;
  text-align: center;
}
.site-footer p {
  font-size: 0.85rem;
  margin-bottom: 8px;
  opacity: 0.9;
}
.site-footer a { color: #fff; text-decoration: underline; }

/* レスポンシブ */
@media (max-width: 1024px) {
  .hero-inner { grid-template-columns: 1fr; gap: 24px; text-align: center; }
  .hero-cta { justify-content: center; }
  .hero-bubble { position: static; margin: 0 auto 16px; max-width: 100%; }
  .hero-character img { width: 220px; }
  .cat-grid { grid-template-columns: repeat(2, 1fr); }
  .content-grid { grid-template-columns: 1fr; }
  .featured-grid { grid-template-columns: repeat(2, 1fr); }
  .features-grid { grid-template-columns: repeat(2, 1fr); }
}
@media (max-width: 640px) {
  .header-inner { flex-wrap: wrap; padding: 12px 16px; gap: 12px; }
  .primary-nav { width: 100%; flex-wrap: nowrap; overflow-x: auto; gap: 0; justify-content: flex-start; }
  .primary-nav a { font-size: 0.78rem; padding: 6px 10px; flex-shrink: 0; }
  .hero { padding: 32px 16px 56px; }
  .hero-title { font-size: 1.45rem; }
  .cat-section { margin-top: -32px; padding: 0 16px; }
  .cat-grid { grid-template-columns: 1fr; gap: 12px; }
  .content-section { margin: 32px auto; padding: 0 16px; }
  .featured-grid { grid-template-columns: 1fr; }
  .latest-item { grid-template-columns: 70px 1fr; gap: 10px; }
  .latest-tag, .latest-date { display: none; }
  .features-grid { grid-template-columns: 1fr; gap: 24px; }
  .features-section { padding: 32px 16px; }
}
"""


# ============================================================
# HTML 生成
# ============================================================

def render_featured(a):
    return f'''<a href="{a['url']}" class="featured-card">
  <div class="featured-thumb" style="background-image:url('{a['thumb']}')">
    <span class="featured-tag" style="background:{a['tag_color']}">{a['tag']}</span>
  </div>
  <div class="featured-body">
    <div class="featured-title">{a['title']}</div>
    <div class="featured-date">🕐 {a['date']}</div>
  </div>
</a>'''


def render_latest(a):
    return f'''<a href="{a['url']}" class="latest-item">
  <div class="latest-thumb" style="background-image:url('{a['thumb']}')"></div>
  <div class="latest-title">{a['title']}</div>
  <span class="latest-tag" style="background:{a['tag_color']}">{a['tag']}</span>
  <span class="latest-date">{a['date']}</span>
</a>'''


def render_ranking(items):
    medals = ["🥇", "🥈", "🥉"]
    out = []
    for i, a in enumerate(items[:3]):
        out.append(f'''<li><a href="{a['url']}">
        <span class="rank-icon">{medals[i]}</span>
        <div class="rank-thumb" style="background-image:url('{a['thumb']}')"></div>
        <div class="rank-title">{a['title']}</div>
        </a></li>''')
    return '\n'.join(out)


def build_index():
    featured_html = '\n'.join(render_featured(a) for a in FEATURED)
    latest_html = '\n'.join(render_latest(a) for a in LATEST)
    ranking_html = render_ranking(RANKING)

    return f'''<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow,noarchive">
<meta name="description" content="ガジェット・時短ツール・PLC・FA・効率ノウハウまで、生産技術視点で発信">
<title>生産技術ガジェット研究所｜現場の課題をガジェットで、仕事と生活をもっと良く。</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700;800&display=swap" rel="stylesheet">
<style>{CSS}</style>
</head>
<body>

<div class="preview-banner">
  🚧 これは Cloudflare Pages 上のスクショ準拠プレビュー版（noindex・本番は <a href="https://www.ootanisatan.com">www.ootanisatan.com</a>）
</div>

<header class="site-header">
  <div class="header-inner">
    <div class="brand">
      <div class="brand-logo">⚙</div>
      <div class="brand-text">
        <h1>生産技術ガジェット研究所</h1>
        <p>現場の課題をガジェットで、仕事と生活をもっと良く。</p>
      </div>
    </div>
    <nav class="primary-nav">
      <a href="/" class="active">🏠 ホーム</a>
      <a href="/gadget-lab/">🛒 ガジェット</a>
      <a href="#seigi">⚙️ 生産技術</a>
      <a href="#shigoto">📋 仕事術</a>
      <a href="/%e3%83%97%e3%83%ad%e3%83%95%e3%82%a3%e3%83%bc%e3%83%ab/">👤 プロフィール</a>
      <a href="/contact/">✉️ お問い合わせ</a>
    </nav>
    <button class="search-btn" aria-label="検索">🔍</button>
  </div>
</header>

<section class="hero">
  <div class="hero-inner">
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
      <img src="/assets/img/character-ptgl.png" alt="PTGL">
    </div>
  </div>
</section>

<section class="cat-section" id="categories">
  <div class="cat-grid">
    <a href="/gadget-lab/" class="cat-card">
      <div class="cat-icon blue">⌚</div>
      <h3>ガジェット研究室</h3>
      <p>スマートウォッチ・PC周辺機器・<br>便利グッズのレビューと活用術</p>
      <div class="cat-arrow">→</div>
    </a>
    <a href="#seigi" class="cat-card">
      <div class="cat-icon blue">⚙️</div>
      <h3>生産技術研究室</h3>
      <p>PLC・センサ・安全・改善・<br>生産技術のノウハウと事例</p>
      <div class="cat-arrow">→</div>
    </a>
    <a href="/jitan-tool-lab/" class="cat-card">
      <div class="cat-icon blue">⏱</div>
      <h3>時短ツール研究室</h3>
      <p>AIツール・アプリ・効率化ツールで<br>時短につながる活用法を紹介</p>
      <div class="cat-arrow">→</div>
    </a>
    <a href="/%e6%9a%ae%e3%82%89%e3%81%97%e3%83%8f%e3%83%83%e3%82%af%e7%a0%94%e7%a9%b6%e5%ae%a4/" class="cat-card has-orange">
      <div class="cat-icon orange">🏠</div>
      <h3>暮らしハック研究室</h3>
      <p>日常の効率化・健康・節約など<br>暮らしに役立つ実践的なヒント</p>
      <div class="cat-arrow">→</div>
    </a>
  </div>
</section>

<section class="content-section">
  <div class="content-grid">
    <div class="main-column">

      <h2 class="section-heading" id="featured">注目の記事</h2>
      <div class="featured-grid">
        {featured_html}
      </div>

      <h2 class="section-heading" id="latest">最新の記事</h2>
      <div class="latest-list">
        {latest_html}
        <div class="latest-more">記事一覧をみる →</div>
      </div>

    </div>

    <aside class="sidebar">

      <div class="search-widget">
        <input type="text" placeholder="検索キーワードを入力" disabled>
        <button>🔍</button>
      </div>

      <div class="widget">
        <h3 class="widget-title">運営者プロフィール</h3>
        <div class="profile-body">
          <img class="profile-avatar" src="/assets/img/character-ptgl.png" alt="所長">
          <div>
            <p class="profile-text">生産技術エンジニア。<br>工場の安全・効率化に取り組むエンジニア。ガジェットと生産技術で、日々の仕事を強化する情報を発信しています。</p>
            <a class="profile-link" href="/%e3%83%97%e3%83%ad%e3%83%95%e3%82%a3%e3%83%bc%e3%83%ab/">プロフィールをみる →</a>
          </div>
        </div>
      </div>

      <div class="widget">
        <h3 class="widget-title">人気記事ランキング</h3>
        <ol class="ranking-list">
          {ranking_html}
        </ol>
      </div>

      <div class="learn-widget">
        <div class="learn-text">なにか知りたいこと？<br>一緒に学んでいきましょう！</div>
        <img src="/assets/img/character-tanaka.png" alt="新人タナカ">
      </div>

    </aside>
  </div>
</section>

<section class="features-section">
  <div class="features-grid">
    <div class="feature-item">
      <div class="feature-icon">📋</div>
      <h3>実体験ベースのレビュー</h3>
      <p>実際に使って検証した情報だけを<br>基準にレビューします。</p>
    </div>
    <div class="feature-item">
      <div class="feature-icon">⚙️</div>
      <h3>生産技術の知見を共有</h3>
      <p>現場での改善提案・自動化の<br>ノウハウをわかりやすく解説。</p>
    </div>
    <div class="feature-item">
      <div class="feature-icon">🤖</div>
      <h3>FA・PLC・自動化に強い</h3>
      <p>制御・センサ安全・ネットワークまで<br>幅広くカバー。</p>
    </div>
    <div class="feature-item">
      <div class="feature-icon">💡</div>
      <h3>明日から使える実践ノウハウ</h3>
      <p>すぐに現場で試せる、実践的な<br>内容をお届けします。</p>
    </div>
  </div>
</section>

<footer class="site-footer">
  <p>&copy; 2026 生産技術ガジェット研究所｜本サイトはプレビュー版です</p>
  <p>本番サイト: <a href="https://www.ootanisatan.com">www.ootanisatan.com</a></p>
</footer>

</body>
</html>
'''


def main():
    INDEX.write_text(build_index(), encoding='utf-8')
    print(f"[customize] Wrote {INDEX} ({INDEX.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
