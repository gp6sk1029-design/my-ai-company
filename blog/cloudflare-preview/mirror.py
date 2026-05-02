#!/usr/bin/env python3
"""
本番サイト（https://www.ootanisatan.com）のホームページを
Cloudflare Pages 用にミラーリングするスクリプト。

- index.html（ホーム）を取得
- 参照されている全CSS・画像をダウンロード
- CSSの中で url(...) で参照される画像も再帰的に取得
- 全URLを相対パスに書き換え
- noindex メタタグを注入
- 本物のJIN:Rが生成したHTMLそのままを Cloudflare に配置

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
from urllib.parse import urlparse, urljoin
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
USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"

# CDN系で取得すべきもの
ALLOWED_CDN_HOSTS = {"cdnjs.cloudflare.com"}

# noindex 注入用
NOINDEX_TAG = '<meta name="robots" content="noindex,nofollow,noarchive">'
PREVIEW_BANNER_HTML = (
    '<div id="preview-banner" style="background:linear-gradient(90deg,#fef3c7,#fde68a);'
    'color:#78350f;text-align:center;padding:8px 16px;font-size:13px;'
    'font-family:sans-serif;position:relative;z-index:9999;border-bottom:1px solid #fcd34d;">'
    '🚧 これは Cloudflare Pages 上のプレビュー版です（noindex 設定済・本番は '
    '<a href="https://www.ootanisatan.com" style="color:#78350f;text-decoration:underline;">www.ootanisatan.com</a>）'
    '</div>'
)


def fetch_bytes(url: str) -> bytes | None:
    try:
        req = Request(url, headers={"User-Agent": USER_AGENT})
        with urlopen(req, timeout=30) as resp:
            return resp.read()
    except (HTTPError, URLError, TimeoutError) as e:
        print(f"  [WARN] failed: {url} ({e})")
        return None


def url_to_local_path(url: str, base_url: str = HOME_URL) -> tuple[str, Path] | None:
    """URLを (相対パス, 保存先ローカルパス) に変換"""
    abs_url = urljoin(base_url, url)
    p = urlparse(abs_url)
    host = p.netloc

    # 拡張子はクエリ文字列を除いたパスから判定
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
                # フォントは CSSと同じディレクトリに置く（CSS→フォント相対参照のため）
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


# 全アセットの収集と書き換えを管理するレジストリ
asset_registry: dict[str, str] = {}  # abs_url -> relative path


def register_asset(abs_url: str, file_kind: str = "auto") -> str | None:
    """URLを登録してダウンロード、相対パスを返す。既登録ならそれを返す。"""
    if abs_url in asset_registry:
        return asset_registry[abs_url]
    mapped = url_to_local_path(abs_url)
    if not mapped:
        return None
    rel_path, local_path = mapped
    local_path.parent.mkdir(parents=True, exist_ok=True)
    if not local_path.exists():
        data = fetch_bytes(abs_url)
        if data is None:
            return None
        local_path.write_bytes(data)
        print(f"  [GET] {abs_url[:80]} -> {rel_path}")
    asset_registry[abs_url] = rel_path
    return rel_path


def rewrite_css(css_text: str, css_url: str) -> str:
    """CSS内の url(...) を全て解決してダウンロード、相対パスに書き換え"""
    def replace_url(m):
        url = m.group(1).strip(' \'"')
        # 既にローカル化済みのパスはスキップ
        if url.startswith('data:') or url.startswith('../') or url.startswith('/assets/'):
            return m.group(0)
        abs_url = urljoin(css_url, url)
        rel = register_asset(abs_url)
        if rel:
            # CSSは assets/css/xxx.css にあるので、画像への相対パスは ../img/yyy
            # フォントは同じ assets/css/ なのでファイル名のみで参照可能
            if rel.startswith('assets/css/'):
                adjusted = rel.removeprefix('assets/css/')
            else:
                adjusted = '../' + rel.removeprefix('assets/')
            return f"url({adjusted})"
        return m.group(0)
    return re.sub(r'url\(([^)]+)\)', replace_url, css_text)


def rewrite_html(html: str) -> str:
    """HTML内のリンクを書き換え：
       - CSS → ローカルにダウンロード、href書き換え
       - 画像 → ローカルにダウンロード、src書き換え
       - JS → スキップ（CDN系のみ取得）
       - aタグの記事リンク → 本物URLそのまま維持（Cloudflareでは記事ページは存在しない）
       - inline url(...) → ローカル化
       - noindex 注入
    """

    # 1) link rel=stylesheet
    def replace_css_link(m):
        full = m.group(0)
        href = m.group(1)
        abs_url = urljoin(HOME_URL, href)
        rel = register_asset(abs_url)
        if rel:
            return full.replace(href, '/' + rel)
        return full
    html = re.sub(
        r'<link[^>]+rel=["\']stylesheet["\'][^>]+href=["\']([^"\']+)["\'][^>]*/?>',
        replace_css_link, html
    )
    # 逆順 href before rel パターン
    html = re.sub(
        r'<link[^>]+href=["\']([^"\']+)["\'][^>]+rel=["\']stylesheet["\'][^>]*/?>',
        replace_css_link, html
    )

    # 2) <img src> および srcset
    def replace_img_src(m):
        full = m.group(0)
        src = m.group(1)
        if src.startswith('data:'):
            return full
        abs_url = urljoin(HOME_URL, src)
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
            abs_url = urljoin(HOME_URL, url)
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
        abs_url = urljoin(HOME_URL, url)
        rel = register_asset(abs_url)
        if rel:
            return f'url("/{rel}")'
        return m.group(0)
    html = re.sub(r'url\(([^)]+)\)', replace_inline_url, html)

    # 4) noindex メタタグ注入（<head>直後）
    if 'noindex' not in html:
        html = re.sub(
            r'(<head[^>]*>)',
            r'\1\n' + NOINDEX_TAG,
            html, count=1
        )

    # 5) プレビューバナー注入（<body>直後）
    html = re.sub(
        r'(<body[^>]*>)',
        r'\1\n' + PREVIEW_BANNER_HTML,
        html, count=1
    )

    # 6) JS は基本除去（解析・自動化系は不要、表示のみ目的）
    # ただし JIN:R / jQuery 系は残しても害は少ないので一旦保持
    # 必要に応じて後で除去調整

    return html


def download_and_rewrite_all_css():
    """登録されているCSSファイルを開き、url(...) を再帰的に解決して書き換え"""
    print("\n[mirror] Rewriting CSS files (url() resolution)")
    for abs_url, rel_path in list(asset_registry.items()):
        if not rel_path.endswith('.css'):
            continue
        local_path = OUT_DIR / rel_path
        if not local_path.exists():
            continue
        try:
            css = local_path.read_text(encoding='utf-8', errors='ignore')
        except Exception as e:
            print(f"  [WARN] cannot read {local_path}: {e}")
            continue
        new_css = rewrite_css(css, abs_url)
        if new_css != css:
            local_path.write_text(new_css, encoding='utf-8')


def main():
    print(f"[mirror] Output: {OUT_DIR}")
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    IMG_DIR.mkdir(parents=True, exist_ok=True)
    CSS_DIR.mkdir(parents=True, exist_ok=True)
    JS_DIR.mkdir(parents=True, exist_ok=True)

    # 1) ホームページ取得
    print(f"[mirror] Fetching {HOME_URL}")
    home_data = fetch_bytes(HOME_URL)
    if home_data is None:
        print("[mirror] FATAL: cannot fetch homepage")
        sys.exit(1)
    html = home_data.decode('utf-8', errors='replace')
    print(f"[mirror] HTML size: {len(html)} chars")

    # 2) HTML内のリンクを書き換え（同時にアセットDL）
    print("[mirror] Rewriting HTML and downloading referenced assets")
    new_html = rewrite_html(html)

    # 3) CSS内の url(...) を再帰的に解決
    download_and_rewrite_all_css()

    # 4) 結果保存
    (OUT_DIR / "index.html").write_text(new_html, encoding='utf-8')
    print(f"[mirror] index.html ({len(new_html)} chars)")

    # 5) robots / _headers
    (OUT_DIR / "robots.txt").write_text("User-agent: *\nDisallow: /\n", encoding='utf-8')
    (OUT_DIR / "_headers").write_text(
        "/*\n  X-Robots-Tag: noindex, nofollow, noarchive\n  Cache-Control: public, max-age=300\n",
        encoding='utf-8'
    )

    # 統計
    img_count = len(list(IMG_DIR.glob('*'))) if IMG_DIR.exists() else 0
    css_count = len(list(CSS_DIR.glob('*'))) if CSS_DIR.exists() else 0
    print(f"\n[mirror] DONE")
    print(f"  images: {img_count}")
    print(f"  css: {css_count}")
    print(f"  total assets registered: {len(asset_registry)}")


if __name__ == "__main__":
    main()
