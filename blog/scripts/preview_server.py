#!/usr/bin/env python3
"""
ローカル記事プレビューサーバー（本番JIN:R風・即反映）

blog/articles/{slug}.md を JIN:R 風 HTML でオンザフライ描画する。
markdown を直してブラウザをリロード（or 自動リロード）すると即反映 ── WP往復なし。

使い方:
  python3 blog/scripts/preview_server.py            # port 8794 で起動
  python3 blog/scripts/preview_server.py --port 9000

ルーティング:
  /                      記事一覧（articles/*.md。_context.md 等は除外）
  /preview/{slug}        articles/{slug}.md をオンザフライ描画
  /assets/...            cloudflare-preview/assets/ を静的配信（preview.css 等）
  /chara/{filename}      blog/images/characters/ のキャラ画像を配信
  /_mtime/{slug}         該当mdの最終更新時刻（自動リロード用・JSON）

標準ライブラリのみ。build.py の md_inline を流用（装飾ロジックの二重管理を避ける）。
"""
from __future__ import annotations
import argparse
import json
import re
import sys
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

# --- パス ---
ROOT = Path(__file__).resolve().parent.parent.parent
ARTICLES_DIR = ROOT / "blog" / "articles"
ASSETS_DIR = ROOT / "blog" / "cloudflare-preview" / "assets"
CHARA_DIR = ROOT / "blog" / "images" / "characters"

# build.py の md_inline を流用（水色アンダーライン等の装飾ロジック）
sys.path.insert(0, str(ROOT / "blog" / "cloudflare-preview"))
try:
    from build import md_inline  # type: ignore
except Exception:
    # フォールバック（build.py が読めない場合の簡易版）
    _UL = re.compile(r'[0-9０-９¥円％%日分時間週月年]')
    def md_inline(text: str) -> str:
        text = re.sub(r'\*\*\*(.+?)\*\*\*', r'<strong class="jinr-emph">\1</strong>', text)
        def _b(m):
            inner = m.group(1)
            cls = "jinr-emph" if _UL.search(inner) else ""
            return f'<strong class="{cls}">{inner}</strong>' if cls else f'<strong>{inner}</strong>'
        text = re.sub(r'\*\*(.+?)\*\*', _b, text)
        text = re.sub(r'(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)', r'<em>\1</em>', text)
        return text

# ============================================================
# 表情 slot → キャラ画像ファイル名 マッピング
#   wp_block_builder.py の slot 定義（L160-169）に対応
#   実ファイル名は blog/images/characters/ に合わせる
# ============================================================
OOTANI_IMG = {
    1: "オオタニ所長 通常.png",
    2: "オオタニ所長 ドヤ顔 (1).png",
    3: "オオタニ所長 悩む.png",
    4: "オオタニ所長 焦り.png",
    5: "オオタニ所長 悲しい.png",   # 「恥ずかしい」の実ファイルが無いため悲しいで代用
}
TANAKA_IMG = {
    6: "新人タナカ 正常.png",       # 末尾スペース除去（ブラウザがトリムして404になるバグ修正）
    7: "新人タナカ 驚き.png",
    8: "新人タナカ 絶望顔.png",
    9: "新人タナカ ニヤ顔.png",       # 怪しげ＝ニヤ顔で代用
    10: "新人タナカ ドヤ顔.png",
}
OOTANI_EXPR = {'通常': 1, 'ドヤ顔': 2, '悩む': 3, '焦り': 4, '恥ずかしい': 5}
TANAKA_EXPR = {'通常': 6, '驚き': 7, '絶望': 8, '怪しげ': 9, 'ニヤ顔': 9, 'ドヤ顔': 10}


def choose_ootani_expression(text: str) -> int:
    if any(k in text for k in ['断言', '一目瞭然', '最大の差', '実績のある', '安い買い物', '証明してくれた', '間違いない', 'これに尽きる', '損していた']):
        return 2
    if any(k in text for k in ['正直に言います', 'すまん', '反省', '申し訳', '言い訳']):
        return 5
    if any(k in text for k in ['ヤバい', 'まずい', '焦', 'パニック']):
        return 4
    if any(k in text for k in ['悩', 'どうしよう', '迷う', '困った']):
        return 3
    return 1


def choose_tanaka_expression(text: str) -> int:
    if any(k in text for k in ['！？', '!?', 'えっ', 'えー', 'うわ', 'まじ', 'マジ', 'びっくり', '本当ですか', 'んですか']):
        return 7
    if any(k in text for k in ['ですよね', 'やっぱり', 'すごい', '天才', 'さすが', 'ちゃんと']):
        return 10
    if any(k in text for k in ['絶望', '泣', '無理', '深刻']):
        return 8
    if any(k in text for k in ['信用されません', '怪しい', '隠してる', '本当に？']):
        return 9
    return 6


def chara_url(filename: str) -> str:
    return "/chara/" + urllib.parse.quote(filename)


# ============================================================
# 強化レンダラ（表情slot + 画像 ![]() / wp:image 両対応）
# ============================================================
def render_body(md: str) -> tuple[str, str]:
    lines = md.split('\n')
    h1_title = ""
    out: list[str] = []
    i = 0
    in_list = in_check = False
    list_buf: list[str] = []
    check_buf: list[str] = []

    def flush_list():
        nonlocal in_list, list_buf
        if in_list and list_buf:
            out.append('<ul class="jinr-list">')
            for it in list_buf:
                out.append(f'  <li>{md_inline(it)}</li>')
            out.append('</ul>')
        list_buf = []
        in_list = False

    def flush_check():
        nonlocal in_check, check_buf
        if in_check and check_buf:
            out.append('<ul class="jinr-check">')
            for it in check_buf:
                out.append(f'  <li>{md_inline(it)}</li>')
            out.append('</ul>')
        check_buf = []
        in_check = False

    def ootani_bubble(slot: int, text: str) -> str:
        return (
            '<div class="jinr-fukidashi jinr-fukidashi-left">'
            f'<div class="jinr-chara"><img src="{chara_url(OOTANI_IMG[slot])}" alt="オオタニ所長"><span>オオタニ所長</span></div>'
            f'<div class="jinr-bubble">{md_inline(text)}</div>'
            '</div>'
        )

    def tanaka_bubble(slot: int, text: str) -> str:
        return (
            '<div class="jinr-fukidashi jinr-fukidashi-right">'
            f'<div class="jinr-bubble">{md_inline(text)}</div>'
            f'<div class="jinr-chara"><img src="{chara_url(TANAKA_IMG[slot])}" alt="新人タナカ"><span>新人タナカ</span></div>'
            '</div>'
        )

    while i < len(lines):
        line = lines[i]
        stripped = line.strip()

        # H1（記事タイトル）
        if stripped.startswith('# ') and not h1_title:
            h1_title = stripped[2:].strip()
            i += 1; continue

        # --- 商品リンクボックス（:::product ... ::: ）本番と同じ見た目で描画 ---
        if stripped == ':::product':
            flush_list(); flush_check()
            i += 1
            fields = {}
            while i < len(lines) and lines[i].strip() != ':::':
                mkv = re.match(r'^\s*(name|image|amazon|rakuten|yahoo)\s*:\s*(.+?)\s*$', lines[i])
                if mkv:
                    fields[mkv.group(1)] = mkv.group(2)
                i += 1
            if i < len(lines):
                i += 1  # 閉じ :::
            img = fields.get('image', '')
            img_html = (
                f'<div style="flex:0 0 96px;display:flex;align-items:center;justify-content:center;">'
                f'<img src="{img}" alt="" style="max-width:96px;max-height:96px;object-fit:contain;border-radius:6px;"></div>'
            ) if img else ''
            btn_specs = [
                ('amazon', 'Amazonで購入', 'linear-gradient(180deg,#ff9b45,#f97316)'),
                ('rakuten', '楽天市場で購入', 'linear-gradient(180deg,#e2467a,#bf0043)'),
                ('yahoo', 'Yahoo!で購入', 'linear-gradient(180deg,#5b8def,#2f5fd0)'),
            ]
            btns = ''.join(
                f'<a href="{fields[k]}" target="_blank" rel="sponsored nofollow noopener" '
                f'style="display:block;flex:1 1 160px;text-align:center;text-decoration:none;'
                f'background:{bg};color:#fff;font-weight:700;font-size:15px;padding:12px 16px;'
                f'border-radius:8px;box-shadow:0 2px 4px rgba(0,0,0,.12);">{lbl}</a>'
                for k, lbl, bg in btn_specs if fields.get(k)
            )
            out.append(
                '<div class="ptgl-product-box" style="border:1px solid #e5e7eb;border-radius:12px;'
                'padding:16px 18px;margin:20px 0;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.06);">'
                '<div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap;">' + img_html +
                '<div style="flex:1 1 220px;min-width:200px;">'
                f'<div style="font-weight:700;font-size:16px;color:#111827;margin-bottom:10px;">'
                f'{md_inline(fields.get("name", "商品"))}</div>'
                '<div style="display:flex;flex-wrap:wrap;gap:10px;">' + btns + '</div>'
                '</div></div></div>'
            )
            continue

        # --- 既存 Gutenberg ブロック（wp:image など）→ src抽出して<img> ---
        mblk = re.match(r'^<!--\s*wp:(\w+)', stripped)
        if mblk:
            block_type = mblk.group(1)
            end = f'<!-- /wp:{block_type} -->'
            buf = [line]
            i += 1
            while i < len(lines):
                buf.append(lines[i])
                if end in lines[i]:
                    i += 1
                    break
                i += 1
            raw = '\n'.join(buf)
            if block_type == 'image':
                msrc = re.search(r'<img[^>]*src="([^"]+)"', raw)
                malt = re.search(r'<img[^>]*alt="([^"]*)"', raw)
                mcap = re.search(r'<figcaption[^>]*>(.*?)</figcaption>', raw, re.S)
                if msrc:
                    flush_list(); flush_check()
                    cap = f'<figcaption>{mcap.group(1)}</figcaption>' if mcap else ''
                    alt = malt.group(1) if malt else ''
                    out.append(f'<figure class="jinr-image"><img src="{msrc.group(1)}" alt="{alt}">{cap}</figure>')
            continue

        # --- markdown 画像 ![alt](url) ---
        mimg = re.match(r'^!\[([^\]]*)\]\(([^)]+)\)\s*$', stripped)
        if mimg:
            flush_list(); flush_check()
            alt = mimg.group(1)
            cap = f'<figcaption>{alt}</figcaption>' if alt else ''
            out.append(f'<figure class="jinr-image"><img src="{mimg.group(2)}" alt="{alt}">{cap}</figure>')
            i += 1; continue

        # --- 吹き出し：表情明示記法 **オオタニ所長[ドヤ顔]：** ---
        m = re.match(r'\*\*オオタニ所長\[(通常|ドヤ顔|悩む|焦り|恥ずかしい)\][：:]\*\*\s*[「\s]*(.*?)[」]?\s*$', line)
        if m:
            flush_list(); flush_check()
            out.append(ootani_bubble(OOTANI_EXPR[m.group(1)], m.group(2)))
            i += 1; continue
        m = re.match(r'\*\*タナカ\[(通常|驚き|絶望|怪しげ|ニヤ顔|ドヤ顔)\][：:]\*\*\s*[「\s]*(.*?)[」]?\s*$', line)
        if m:
            flush_list(); flush_check()
            out.append(tanaka_bubble(TANAKA_EXPR[m.group(1)], m.group(2)))
            i += 1; continue

        # --- 吹き出し：表情なし **オオタニ所長：**（内容から自動推定）---
        m = re.match(r'\*\*オオタニ所長[：:]\*\*\s*[「\s]*(.*?)[」]?\s*$', line)
        if m:
            flush_list(); flush_check()
            out.append(ootani_bubble(choose_ootani_expression(m.group(1)), m.group(1)))
            i += 1; continue
        m = re.match(r'\*\*タナカ[：:]\*\*\s*[「\s]*(.*?)[」]?\s*$', line)
        if m:
            flush_list(); flush_check()
            out.append(tanaka_bubble(choose_tanaka_expression(m.group(1)), m.group(1)))
            i += 1; continue

        # --- 見出し ---
        if stripped.startswith('## '):
            flush_list(); flush_check()
            out.append(f'<h2 class="jinr-h2">{md_inline(stripped[3:])}</h2>')
            i += 1; continue
        if stripped.startswith('### '):
            flush_list(); flush_check()
            out.append(f'<h3 class="jinr-h3">{md_inline(stripped[4:])}</h3>')
            i += 1; continue

        # --- 区切り ---
        if stripped == '---':
            flush_list(); flush_check()
            out.append('<hr class="jinr-sep">')
            i += 1; continue

        # --- テーブル ---
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

        # --- 引用 ---
        if stripped.startswith('> '):
            flush_list(); flush_check()
            buf = []
            while i < len(lines) and lines[i].strip().startswith('> '):
                buf.append(lines[i].strip()[2:])
                i += 1
            out.append(f'<blockquote class="jinr-quote">{md_inline("<br>".join(buf))}</blockquote>')
            continue

        # --- コードブロック ---
        if stripped.startswith('```'):
            flush_list(); flush_check()
            i += 1
            buf = []
            while i < len(lines) and not lines[i].strip().startswith('```'):
                buf.append(lines[i]); i += 1
            i += 1
            code = '\n'.join(buf).replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
            out.append(f'<pre class="jinr-code"><code>{code}</code></pre>')
            continue

        # --- チェックリスト ---
        if re.match(r'^- \[ \]', stripped) or stripped.startswith('✅') or stripped.startswith('❌'):
            flush_list()
            in_check = True
            item = re.sub(r'^- \[ \] |^✅\s*|^❌\s*', '', stripped)
            check_buf.append(item)
            i += 1; continue

        # --- 箇条書き ---
        if re.match(r'^[-*]\s+', stripped):
            flush_check()
            in_list = True
            list_buf.append(re.sub(r'^[-*]\s+', '', stripped))
            i += 1; continue

        # --- 空行・コメント ---
        if stripped.startswith('<!--') or not stripped:
            flush_list(); flush_check()
            i += 1; continue

        # --- 通常段落 ---
        flush_list(); flush_check()
        out.append(f'<p>{md_inline(stripped)}</p>')
        i += 1

    flush_list(); flush_check()
    return h1_title, '\n'.join(out)


# ============================================================
# HTML テンプレート
# ============================================================
AUTORELOAD_JS = """
<script>
(function(){
  var slug = location.pathname.split('/preview/')[1];
  if(!slug) return;
  var last = null;
  setInterval(function(){
    fetch('/_mtime/'+slug).then(r=>r.json()).then(function(d){
      if(last===null){ last = d.mtime; return; }
      if(d.mtime !== last){ location.reload(); }
    }).catch(function(){});
  }, 1500);
})();
</script>
"""


def page_html(title: str, body: str, with_reload: bool = True) -> str:
    reload_js = AUTORELOAD_JS if with_reload else ""
    return f"""<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>{title}｜プレビュー</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/assets/preview.css">
</head>
<body>
<div class="jinr-preview-bar">📝 ローカルプレビュー（本番風・自動リロード）— <a href="/">記事一覧</a></div>
<article class="jinr-article">
<h1 class="jinr-h1">{title}</h1>
{body}
</article>
{reload_js}
</body>
</html>"""


def list_articles() -> list[tuple[str, str]]:
    """(slug, title) のリスト。_context.md 等は除外。"""
    result = []
    for p in sorted(ARTICLES_DIR.glob("*.md")):
        slug = p.stem
        if slug.endswith("_context") or slug.startswith("_"):
            continue
        title = slug
        try:
            for line in p.read_text(encoding="utf-8").split('\n'):
                if line.strip().startswith('# '):
                    title = line.strip()[2:].strip()
                    break
        except Exception:
            pass
        result.append((slug, title))
    return result


def index_html() -> str:
    items = list_articles()
    lis = "\n".join(
        f'<li><a href="/preview/{urllib.parse.quote(slug)}">{title}</a> '
        f'<span class="slug">{slug}</span></li>'
        for slug, title in items
    )
    body = f'<ul class="jinr-index">{lis}</ul>'
    return page_html("記事一覧", body, with_reload=False)


# ============================================================
# HTTP ハンドラ
# ============================================================
class PreviewHandler(BaseHTTPRequestHandler):
    def _send(self, code: int, body: bytes, ctype: str = "text/html; charset=utf-8"):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        # ローカルプレビューの画像を他オリジン（WP管理画面など）から読めるようにする。
        # 配信しているのは自分の記事素材だけなので開放して問題ない。
        self.send_header("Access-Control-Allow-Origin", "*")
        # Chrome の Private Network Access（公開サイト→localhost の遮断）を明示的に許可する
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        """PNA/CORS のプリフライトに応答する（画像を他オリジンから取得させるため）"""
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def log_message(self, fmt, *args):
        pass  # アクセスログ抑制

    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path
        path = urllib.parse.unquote(path)

        # 記事一覧
        if path == "/" or path == "":
            self._send(200, index_html().encode("utf-8"))
            return

        # mtime（自動リロード用）
        if path.startswith("/_mtime/"):
            slug = path[len("/_mtime/"):]
            md = ARTICLES_DIR / f"{slug}.md"
            mtime = md.stat().st_mtime if md.exists() else 0
            self._send(200, json.dumps({"mtime": mtime}).encode("utf-8"), "application/json")
            return

        # 記事プレビュー
        if path.startswith("/preview/"):
            slug = path[len("/preview/"):].strip("/")
            md = ARTICLES_DIR / f"{slug}.md"
            if not md.exists():
                self._send(404, f"<h1>404</h1><p>{slug}.md が見つかりません</p><p><a href='/'>一覧へ</a></p>".encode("utf-8"))
                return
            title, body = render_body(md.read_text(encoding="utf-8"))
            # 記事画像フォルダ（<slug>_images/）の相対パス画像を配信ルートへ差し替える。
            # 例: src="gtr2-metrics-10km.jpg" → src="/article-img/<slug>/gtr2-metrics-10km.jpg"
            # （http/https・/始まり・data: はそのまま）
            body = re.sub(
                r'src="(?!https?:|/|data:)([^"]+)"',
                lambda m: f'src="/article-img/{slug}/{Path(m.group(1)).name}"',
                body,
            )
            self._send(200, page_html(title or slug, body).encode("utf-8"))
            return

        # 記事画像（blog/articles/<slug>_images/ を配信）
        if path.startswith("/article-img/"):
            rel = path[len("/article-img/"):].split("/", 1)
            if len(rel) == 2:
                slug, fname = rel[0], Path(rel[1]).name
                f = ARTICLES_DIR / f"{slug}_images" / fname
                if f.exists() and f.is_file():
                    ctype = {
                        ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
                        ".webp": "image/webp", ".gif": "image/gif",
                    }.get(f.suffix.lower(), "application/octet-stream")
                    self._send(200, f.read_bytes(), ctype)
                    return
            self._send(404, b"article image not found")
            return

        # キャラ画像
        if path.startswith("/chara/"):
            fname = path[len("/chara/"):]
            f = CHARA_DIR / fname
            if f.exists() and f.is_file():
                self._send(200, f.read_bytes(), "image/png")
            else:
                self._send(404, b"chara not found")
            return

        # assets 静的配信（preview.css 等）
        if path.startswith("/assets/"):
            rel = path[len("/assets/"):]
            f = ASSETS_DIR / rel
            if f.exists() and f.is_file():
                ext = f.suffix.lower()
                ctype = {
                    ".css": "text/css; charset=utf-8",
                    ".js": "application/javascript",
                    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
                    ".woff": "font/woff", ".woff2": "font/woff2", ".svg": "image/svg+xml",
                }.get(ext, "application/octet-stream")
                self._send(200, f.read_bytes(), ctype)
            else:
                self._send(404, b"asset not found")
            return

        self._send(404, b"not found")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8794)
    args = ap.parse_args()
    server = ThreadingHTTPServer(("0.0.0.0", args.port), PreviewHandler)
    print(f"[blog-preview] http://localhost:{args.port}/")
    print(f"  記事一覧:    http://localhost:{args.port}/")
    print(f"  記事直接:    http://localhost:{args.port}/preview/<slug>")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n停止しました")


if __name__ == "__main__":
    main()
