#!/usr/bin/env python3
"""
本番サイト（https://www.ootanisatan.com）の全ページを
Cloudflare Pages 用にミラーリングするスクリプト（フル機能版）。

- sitemap.xml から全URLを取得
- 各ページのHTMLを取得・全アセットDL・内部リンクを相対化
- ホーム + 全記事 + 全固定ページ
- noindex / preview バナー / robots.txt / _headers を注入
- ナビゲーション・記事カード等のクリックは Cloudflare 内で完結

使い方:
  cd /Users/shoheikoda/Documents/my-ai-company
  python3 blog/cloudflare-preview/mirror.py
"""
from __future__ import annotations
import os
import re
import sys
import hashlib
from pathlib import Path
from urllib.parse import urlparse, urljoin, unquote, quote
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

ROOT = Path(__file__).resolve().parent.parent.parent
OUT_DIR = ROOT / "blog" / "cloudflare-preview"
ASSETS_DIR = OUT_DIR / "assets"
IMG_DIR = ASSETS_DIR / "img"
CSS_DIR = ASSETS_DIR / "css"
JS_DIR = ASSETS_DIR / "js"

ORIGIN = "https://www.ootanisatan.com"
HOME_URL = ORIGIN + "/"
SITEMAP_URL = ORIGIN + "/sitemap.xml"
USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"

ALLOWED_CDN_HOSTS = {"cdnjs.cloudflare.com"}

NOINDEX_TAG = '<meta name="robots" content="noindex,nofollow,noarchive">'
PREVIEW_BANNER_HTML = (
    '<div id="preview-banner" style="background:linear-gradient(90deg,#fef3c7,#fde68a);'
    'color:#78350f;text-align:center;padding:8px 16px;font-size:13px;'
    'font-family:sans-serif;position:relative;z-index:9999;border-bottom:1px solid #fcd34d;">'
    '🚧 Cloudflareプレビュー版（noindex設定済・本番は '
    '<a href="https://www.ootanisatan.com" style="color:#78350f;text-decoration:underline;">www.ootanisatan.com</a>）'
    '</div>'
)


# ============================================================
# ネットワーク
# ============================================================

def fetch_bytes(url: str) -> bytes | None:
    try:
        req = Request(url, headers={"User-Agent": USER_AGENT})
        with urlopen(req, timeout=30) as resp:
            return resp.read()
    except (HTTPError, URLError, TimeoutError) as e:
        print(f"  [WARN] failed: {url[:80]} ({e})")
        return None


# ============================================================
# サイトマップ解析
# ============================================================

def fetch_sitemap_urls() -> list[str]:
    """sitemap.xml からすべてのページURLを再帰的に取得"""
    print(f"[sitemap] Fetching {SITEMAP_URL}")
    data = fetch_bytes(SITEMAP_URL)
    if not data:
        return [HOME_URL]

    sitemaps = re.findall(r'<loc>([^<]+\.xml)</loc>', data.decode('utf-8'))
    urls = [HOME_URL]
    for sm in sitemaps:
        sm_data = fetch_bytes(sm)
        if not sm_data:
            continue
        page_urls = re.findall(r'<loc>([^<]+)</loc>', sm_data.decode('utf-8'))
        # XMLファイルパス自身は除外
        page_urls = [u for u in page_urls if not u.endswith('.xml')]
        urls.extend(page_urls)
        print(f"[sitemap] {sm} -> {len(page_urls)} URLs")

    # 重複除去・正規化（末尾スラッシュ統一）
    seen = set()
    cleaned = []
    for u in urls:
        if u not in seen:
            seen.add(u)
            cleaned.append(u)
    return cleaned


# ============================================================
# URL → ローカルパス変換
# ============================================================

def asset_path(abs_url: str) -> tuple[str, Path] | None:
    """アセット（画像・CSS・JS・フォント）のローカルパス決定"""
    p = urlparse(abs_url)
    host = p.netloc
    path_clean = p.path
    ext = path_clean.rsplit('.', 1)[-1].lower() if '.' in path_clean else ''

    if host == "www.ootanisatan.com":
        if path_clean.startswith("/wp-content/") or path_clean.startswith("/wp-includes/"):
            if ext in ('jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'ico'):
                fname = hashlib.md5(abs_url.encode()).hexdigest()[:12] + '.' + ext
                return ('assets/img/' + fname, IMG_DIR / fname)
            if ext == 'css':
                fname = hashlib.md5(abs_url.encode()).hexdigest()[:12] + '.css'
                return ('assets/css/' + fname, CSS_DIR / fname)
            if ext == 'js':
                fname = hashlib.md5(abs_url.encode()).hexdigest()[:12] + '.js'
                return ('assets/js/' + fname, JS_DIR / fname)
            if ext in ('woff', 'woff2', 'ttf', 'eot', 'otf'):
                fname = hashlib.md5(abs_url.encode()).hexdigest()[:12] + '.' + ext
                return ('assets/css/' + fname, CSS_DIR / fname)
        return None
    elif host in ALLOWED_CDN_HOSTS:
        if ext == 'css':
            fname = 'cdn_' + hashlib.md5(abs_url.encode()).hexdigest()[:12] + '.css'
            return ('assets/css/' + fname, CSS_DIR / fname)
        if ext == 'js':
            fname = 'cdn_' + hashlib.md5(abs_url.encode()).hexdigest()[:12] + '.js'
            return ('assets/js/' + fname, JS_DIR / fname)
        if ext in ('woff', 'woff2', 'ttf', 'eot', 'otf'):
            fname = 'cdn_' + hashlib.md5(abs_url.encode()).hexdigest()[:12] + '.' + ext
            return ('assets/css/' + fname, CSS_DIR / fname)
    return None


def page_local_path(page_url: str) -> Path:
    """ページURL → ローカル保存先（slug/index.html）"""
    p = urlparse(page_url)
    path = p.path.rstrip('/')
    if not path:
        return OUT_DIR / "index.html"
    # パーセントデコードして可読パスに（ただしファイルシステムの制限はあり）
    # URL構造を維持するためにそのままディレクトリ化
    decoded = unquote(path).lstrip('/')
    # ファイル名に使えない文字を排除
    safe_path = decoded.replace('\\', '_').replace(':', '_').replace('?', '_').replace('*', '_')
    return OUT_DIR / safe_path / "index.html"


def page_local_url(page_url: str) -> str:
    """ページURL → サイト内相対URL（href用）"""
    p = urlparse(page_url)
    path = p.path
    if path == '/' or not path:
        return '/'
    # WordPress permalinkを保持（パーセントエンコードのまま）
    return path


# ============================================================
# アセット登録・ダウンロード
# ============================================================

asset_registry: dict[str, str] = {}  # abs_url -> relative path (assets/...)


def register_asset(abs_url: str) -> str | None:
    if abs_url in asset_registry:
        return asset_registry[abs_url]
    mapped = asset_path(abs_url)
    if not mapped:
        return None
    rel_path, local_path = mapped
    local_path.parent.mkdir(parents=True, exist_ok=True)
    if not local_path.exists():
        data = fetch_bytes(abs_url)
        if data is None:
            return None
        local_path.write_bytes(data)
    asset_registry[abs_url] = rel_path
    return rel_path


# ============================================================
# CSS書き換え
# ============================================================

def rewrite_css(css_text: str, css_url: str) -> str:
    def replace_url(m):
        url = m.group(1).strip(' \'"')
        if url.startswith('data:') or url.startswith('../') or url.startswith('/assets/'):
            return m.group(0)
        abs_url = urljoin(css_url, url)
        rel = register_asset(abs_url)
        if rel:
            if rel.startswith('assets/css/'):
                adjusted = rel.removeprefix('assets/css/')
            else:
                adjusted = '../' + rel.removeprefix('assets/')
            return f"url({adjusted})"
        return m.group(0)
    return re.sub(r'url\(([^)]+)\)', replace_url, css_text)


# ============================================================
# HTML書き換え（個別ページ）
# ============================================================

def rewrite_page_html(html: str, page_url: str, all_page_urls: set[str]) -> str:
    """ページHTMLを書き換え:
    - link/img/srcset → ローカルアセットへ
    - inline style url() → ローカル化
    - <a href="https://www.ootanisatan.com/..."> → 相対パス（サイト内ページのみ）
    - 外部リンク（他サイト）はそのまま維持
    - noindex メタ + プレビューバナー注入
    """

    # 1) link rel=stylesheet
    def replace_css_link(m):
        full = m.group(0)
        href = m.group(1)
        abs_url = urljoin(page_url, href)
        rel = register_asset(abs_url)
        if rel:
            return full.replace(href, '/' + rel)
        return full
    html = re.sub(
        r'<link[^>]+rel=["\']stylesheet["\'][^>]+href=["\']([^"\']+)["\'][^>]*/?>',
        replace_css_link, html
    )
    html = re.sub(
        r'<link[^>]+href=["\']([^"\']+)["\'][^>]+rel=["\']stylesheet["\'][^>]*/?>',
        replace_css_link, html
    )

    # 2) <img src> + srcset
    def replace_img_src(m):
        full = m.group(0)
        src = m.group(1)
        if src.startswith('data:'):
            return full
        abs_url = urljoin(page_url, src)
        rel = register_asset(abs_url)
        if rel:
            return full.replace(src, '/' + rel)
        return full
    html = re.sub(r'<img[^>]+src=["\']([^"\']+)["\']', replace_img_src, html)

    def replace_srcset(m):
        full = m.group(0)
        srcset = m.group(1)
        new_parts = []
        for part in srcset.split(','):
            part = part.strip()
            if not part:
                continue
            tokens = part.split()
            url = tokens[0]
            descriptor = ' '.join(tokens[1:]) if len(tokens) > 1 else ''
            if url.startswith('data:'):
                new_parts.append(part)
                continue
            abs_url = urljoin(page_url, url)
            rel = register_asset(abs_url)
            new_url = ('/' + rel) if rel else url
            new_parts.append(f'{new_url} {descriptor}'.strip())
        return full.replace(srcset, ', '.join(new_parts))
    html = re.sub(r'srcset=["\']([^"\']+)["\']', replace_srcset, html)

    # 3) inline style url(...)
    def replace_inline_url(m):
        url = m.group(1).strip(' \'"')
        if url.startswith('data:') or url.startswith('/assets/'):
            return m.group(0)
        abs_url = urljoin(page_url, url)
        rel = register_asset(abs_url)
        if rel:
            return f'url("/{rel}")'
        return m.group(0)
    html = re.sub(r'url\(([^)]+)\)', replace_inline_url, html)

    # 4) <a href="https://www.ootanisatan.com/..."> → 相対パス
    # ただし管理画面・WP-JSON・外部リンクは保持
    def replace_internal_link(m):
        full = m.group(0)
        href = m.group(1)
        if not href.startswith('https://www.ootanisatan.com'):
            return full
        if '/wp-admin' in href or '/wp-json' in href or '/feed' in href:
            return full
        # ページURLとして該当があれば相対パスに
        # アセット系（画像・PDF等）はアセット登録を試行
        p = urlparse(href)
        if any(p.path.lower().endswith(ext) for ext in ['.jpg', '.jpeg', '.png', '.gif', '.pdf', '.zip']):
            rel = register_asset(href)
            if rel:
                return full.replace(href, '/' + rel)
            return full
        # ページとして相対化
        new_href = page_local_url(href)
        return full.replace(href, new_href)
    html = re.sub(r'<a[^>]+href=["\']([^"\']+)["\']', replace_internal_link, html)

    # 5) noindex メタタグ注入
    if 'noindex' not in html:
        html = re.sub(
            r'(<head[^>]*>)',
            r'\1\n' + NOINDEX_TAG,
            html, count=1
        )

    # 6) プレビューバナー注入
    html = re.sub(
        r'(<body[^>]*>)',
        r'\1\n' + PREVIEW_BANNER_HTML,
        html, count=1
    )

    # 7) canonical を本番から自分（noindex）にしておく
    html = re.sub(
        r'<link[^>]+rel=["\']canonical["\'][^>]+/?>',
        '',
        html
    )

    return html


# ============================================================
# CSSのurl()再帰書き換え
# ============================================================

def download_and_rewrite_all_css():
    print("\n[mirror] CSS url() 再帰解決")
    css_files_processed = set()

    while True:
        # まだ未処理のCSSファイルを集める
        to_process = []
        for abs_url, rel_path in list(asset_registry.items()):
            if not rel_path.endswith('.css'):
                continue
            if abs_url in css_files_processed:
                continue
            to_process.append((abs_url, rel_path))

        if not to_process:
            break

        for abs_url, rel_path in to_process:
            local_path = OUT_DIR / rel_path
            if not local_path.exists():
                css_files_processed.add(abs_url)
                continue
            try:
                css = local_path.read_text(encoding='utf-8', errors='ignore')
            except Exception:
                css_files_processed.add(abs_url)
                continue
            new_css = rewrite_css(css, abs_url)
            if new_css != css:
                local_path.write_text(new_css, encoding='utf-8')
            css_files_processed.add(abs_url)


# ============================================================
# メイン
# ============================================================

def main():
    print(f"[mirror] Output: {OUT_DIR}")
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    IMG_DIR.mkdir(parents=True, exist_ok=True)
    CSS_DIR.mkdir(parents=True, exist_ok=True)
    JS_DIR.mkdir(parents=True, exist_ok=True)

    # 1) サイトマップから全URL取得
    page_urls = fetch_sitemap_urls()
    page_url_set = set(page_urls)
    print(f"\n[mirror] Pages to mirror: {len(page_urls)}")
    for u in page_urls:
        print(f"  - {u}")

    # 2) 各ページを取得・書き換え・保存
    print("\n[mirror] Mirroring pages...")
    success = 0
    for url in page_urls:
        data = fetch_bytes(url)
        if not data:
            print(f"  [SKIP] {url}")
            continue
        html = data.decode('utf-8', errors='replace')
        new_html = rewrite_page_html(html, url, page_url_set)
        local = page_local_path(url)
        local.parent.mkdir(parents=True, exist_ok=True)
        local.write_text(new_html, encoding='utf-8')
        success += 1
        print(f"  [OK]   {url[:60]} -> {local.relative_to(OUT_DIR)}")

    # 3) CSS url() 再帰書き換え
    download_and_rewrite_all_css()

    # 4) robots / _headers
    (OUT_DIR / "robots.txt").write_text("User-agent: *\nDisallow: /\n", encoding='utf-8')
    (OUT_DIR / "_headers").write_text(
        "/*\n  X-Robots-Tag: noindex, nofollow, noarchive\n  Cache-Control: public, max-age=300\n",
        encoding='utf-8'
    )

    # 5) 統計
    img_count = len(list(IMG_DIR.glob('*'))) if IMG_DIR.exists() else 0
    css_count = len(list(CSS_DIR.glob('*'))) if CSS_DIR.exists() else 0
    page_count = success
    print(f"\n[mirror] DONE")
    print(f"  pages mirrored: {page_count}/{len(page_urls)}")
    print(f"  images: {img_count}")
    print(f"  css/fonts: {css_count}")
    print(f"  total assets: {len(asset_registry)}")


if __name__ == "__main__":
    main()
