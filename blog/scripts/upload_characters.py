#!/usr/bin/env python3
"""
新キャラクター画像（13表情）を本番WordPressメディアライブラリへアップロードする。

前提条件:
  blog/config.json に wp_auth（username + application_password）が設定済み
  blog/images/characters/ に新キャラ画像（高解像度版）が配置済み

使い方:
  python3 blog/scripts/upload_characters.py             # 全キャラ画像をアップロード
  python3 blog/scripts/upload_characters.py --dry-run   # 確認のみ（実際にはアップロードしない）

出力:
  blog/migration/character-media-mapping.json
  blog/migration/jinr-fukidashi-update-manual.md
"""
from __future__ import annotations
import argparse
import io
import json
import sys
from base64 import b64encode
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
from urllib.parse import quote

ROOT = Path(__file__).resolve().parent.parent.parent
CONFIG_PATH = ROOT / "blog" / "config.json"
CHARACTERS_DIR = ROOT / "blog" / "images" / "characters"
OUT_DIR = ROOT / "blog" / "migration"

# 画像リサイズの長辺ピクセル（吹き出しアバターなので800pxで十分・ファイル軽量化）
RESIZE_MAX_PX = 800

# アップロード対象（既存JIN:R吹き出しスロット10枚 + 新カテゴリ3枚）
CHARACTERS = [
    # 既存JIN:R吹き出しスロット（slot 1-10）
    {"file": "オオタニ所長 通常.png",       "slot": 1,  "char": "オオタニ所長", "expr": "通常",     "title": "オオタニ所長-通常",     "alt": "PTGLキャップを被ったオオタニ所長の通常表情"},
    {"file": "オオタニ所長 ドヤ顔 (1).png", "slot": 2,  "char": "オオタニ所長", "expr": "ドヤ顔",   "title": "オオタニ所長-ドヤ顔",   "alt": "PTGLキャップを被ったオオタニ所長のドヤ顔"},
    {"file": "オオタニ所長 悩む.png",       "slot": 3,  "char": "オオタニ所長", "expr": "悩む",     "title": "オオタニ所長-悩む",     "alt": "PTGLキャップを被ったオオタニ所長の悩む表情"},
    {"file": "オオタニ所長 焦り.png",       "slot": 4,  "char": "オオタニ所長", "expr": "焦り",     "title": "オオタニ所長-焦り",     "alt": "PTGLキャップを被ったオオタニ所長の焦り表情"},
    {"file": "オオタニ所長 恥ずかしい.png", "slot": 5,  "char": "オオタニ所長", "expr": "恥ずかしい", "title": "オオタニ所長-恥ずかしい", "alt": "PTGLキャップを被ったオオタニ所長の恥ずかしい表情"},
    {"file": "新人タナカ 正常 .png",        "slot": 6,  "char": "新人タナカ",   "expr": "通常",     "title": "新人タナカ-通常",       "alt": "PTGLキャップを被った新人タナカの通常表情"},
    {"file": "新人タナカ 驚き.png",         "slot": 7,  "char": "新人タナカ",   "expr": "驚き",     "title": "新人タナカ-驚き",       "alt": "PTGLキャップを被った新人タナカの驚き表情"},
    {"file": "新人タナカ 絶望顔.png",       "slot": 8,  "char": "新人タナカ",   "expr": "絶望",     "title": "新人タナカ-絶望",       "alt": "PTGLキャップを被った新人タナカの絶望表情"},
    {"file": "新人タナカ ニヤ顔.png",       "slot": 9,  "char": "新人タナカ",   "expr": "怪しげ",   "title": "新人タナカ-怪しげ",     "alt": "PTGLキャップを被った新人タナカのニヤ顔（怪しげ）"},
    {"file": "新人タナカ ドヤ顔.png",       "slot": 10, "char": "新人タナカ",   "expr": "ドヤ顔",   "title": "新人タナカ-ドヤ顔",     "alt": "PTGLキャップを被った新人タナカのドヤ顔"},
    # 新カテゴリ（既存スロットに無い・将来追加用）
    {"file": "オオタニ所長 悲しい.png",     "slot": None, "char": "オオタニ所長", "expr": "悲しい",   "title": "オオタニ所長-悲しい",   "alt": "PTGLキャップを被ったオオタニ所長の悲しい表情"},
    {"file": "オオタニ所長 驚き.png",       "slot": None, "char": "オオタニ所長", "expr": "驚き",     "title": "オオタニ所長-驚き",     "alt": "PTGLキャップを被ったオオタニ所長の驚き表情"},
    {"file": "オオタニ所長 絶望.png",       "slot": None, "char": "オオタニ所長", "expr": "絶望",     "title": "オオタニ所長-絶望",     "alt": "PTGLキャップを被ったオオタニ所長の絶望表情"},
]


def load_config() -> dict:
    if not CONFIG_PATH.exists():
        print(f"[ERROR] config.json not found at {CONFIG_PATH}")
        sys.exit(1)
    with open(CONFIG_PATH, encoding='utf-8') as f:
        return json.load(f)


def resize_image(src_path: Path, max_px: int = RESIZE_MAX_PX) -> bytes:
    """PILで画像を長辺max_pxにリサイズしてbytesを返す。PNG形式で返す。"""
    try:
        from PIL import Image
    except ImportError:
        print("[ERROR] PIL/Pillow is not installed. Run: pip install Pillow")
        sys.exit(1)
    img = Image.open(src_path)
    # アルファチャネルがあるPNGはそのまま、なければRGB変換
    if img.mode not in ('RGBA', 'RGB'):
        img = img.convert('RGBA' if 'A' in img.mode else 'RGB')
    w, h = img.size
    if max(w, h) > max_px:
        if w >= h:
            new_w = max_px
            new_h = int(h * max_px / w)
        else:
            new_h = max_px
            new_w = int(w * max_px / h)
        img = img.resize((new_w, new_h), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format='PNG', optimize=True)
    return buf.getvalue()


def upload_media(base_url: str, username: str, app_password: str,
                 file_bytes: bytes, filename: str, title: str, alt: str) -> dict:
    """
    POST /wp-json/wp/v2/media にmultipartではなく直接バイナリでアップロードする。
    （WP REST APIはContent-Disposition + バイナリPOSTでmedia作成可能）
    """
    url = f"{base_url.rstrip('/')}/wp-json/wp/v2/media"
    auth = b64encode(f"{username}:{app_password}".encode()).decode()
    safe_filename = quote(filename)
    headers = {
        "Authorization": f"Basic {auth}",
        "Content-Type": "image/png",
        "Content-Disposition": f'attachment; filename="{safe_filename}"',
    }
    req = Request(url, data=file_bytes, headers=headers, method='POST')
    try:
        with urlopen(req, timeout=120) as resp:
            data = json.loads(resp.read().decode('utf-8'))
    except HTTPError as e:
        body = e.read().decode('utf-8', errors='replace')[:300]
        return {"_error": f"HTTP {e.code}: {body}"}
    except URLError as e:
        return {"_error": f"URL error: {e}"}

    media_id = data.get('id')
    if not media_id:
        return {"_error": f"no id in response: {str(data)[:200]}"}

    # title / alt_text を更新（POST時は反映されないため別リクエスト）
    update_url = f"{url}/{media_id}"
    payload = json.dumps({"title": title, "alt_text": alt}).encode()
    update_headers = {
        "Authorization": f"Basic {auth}",
        "Content-Type": "application/json",
    }
    req2 = Request(update_url, data=payload, headers=update_headers, method='POST')
    try:
        with urlopen(req2, timeout=30) as resp:
            updated = json.loads(resp.read().decode('utf-8'))
    except (HTTPError, URLError):
        updated = data  # 元データで返す

    return {
        "id": media_id,
        "source_url": updated.get("source_url") or data.get("source_url"),
        "title": updated.get("title", {}).get("rendered") if isinstance(updated.get("title"), dict) else title,
        "link": data.get("link"),
        "media_type": data.get("media_type"),
    }


def generate_manual(mapping: list[dict], wp_url: str) -> str:
    """JIN:R吹き出しスロット切替手順書をMarkdownで生成"""
    lines = [
        "# 🎨 JIN:R 吹き出しスロット 画像差し替え手順書",
        "",
        f"作成日: 2026-05-03",
        "",
        "## 概要",
        "",
        "新しいキャラクター画像（高解像度版）が WordPress メディアライブラリに",
        "アップロード済みです。次に **JIN:R カスタマイザー** で各吹き出しスロットの",
        "キャラクター画像を新画像に切り替える作業をお願いします。",
        "",
        "**所要時間: 約15分（10スロット分）**",
        "",
        "---",
        "",
        "## 事前準備",
        "",
        f"1. ブラウザで `{wp_url}/wp-admin` を開いてログイン",
        "2. 左メニュー **「外観」 → 「カスタマイズ」** をクリック",
        "3. カスタマイザー画面の左サイドバーから **「JIN:R 吹き出し設定」**（または同等の項目）を探す",
        "",
        "---",
        "",
        "## スロット別 差し替え対応表",
        "",
        "下記の通り、各スロットの「キャラクター画像」を新しい画像に差し替えてください。",
        "",
        "| Slot | キャラ・表情 | 新画像（メディアライブラリで選択）| メディアID |",
        "|---|---|---|---|",
    ]

    for entry in mapping:
        if entry.get('slot') is None:
            continue
        title = entry['title']
        media_id = entry.get('media_id', '?')
        source_url = entry.get('source_url', '?')
        slot = entry['slot']
        char_expr = f"{entry['char']} {entry['expr']}"
        lines.append(f"| {slot} | {char_expr} | `{title}` | {media_id} |")

    lines.extend([
        "",
        "---",
        "",
        "## 操作手順（各スロット共通）",
        "",
        "1. カスタマイザーで対象スロットを開く（例: 「Slot 1: オオタニ所長 通常」）",
        "2. 「**キャラクター画像**」設定の **「画像を変更」** または **「画像を選択」** をクリック",
        "3. メディアライブラリから対応する新画像を選択（上の表の「新画像」列のタイトル）",
        "4. 「**選択**」または「**選んで挿入**」をクリック",
        "5. 上の表のすべてのスロットで同じ操作",
        "6. **すべて完了したら必ず一番上の「公開」または「保存して公開」をクリック**",
        "",
        "---",
        "",
        "## 完了後の確認",
        "",
        "- [ ] カスタマイザー左ペインのプレビューで、各スロットのアバターが新画像になっている",
        "- [ ] 公開ボタンを押した（カスタマイザーは公開しないと反映されない）",
        "- [ ] 既存記事ページ（例: Garmin Venu 2S レビュー）を開いて吹き出しが新画像で表示される",
        "",
        "---",
        "",
        "## 新カテゴリ（追加スロット候補）",
        "",
        "下記3表情はJIN:R吹き出しスロットには未登録ですが、メディアライブラリには",
        "アップロード済みです。今後新しい表情を吹き出しで使いたくなった場合は、",
        "JIN:Rカスタマイザーで新スロットを追加してこれらを設定してください。",
        "",
        "| キャラ・表情 | メディアID | タイトル |",
        "|---|---|---|",
    ])

    for entry in mapping:
        if entry.get('slot') is not None:
            continue
        media_id = entry.get('media_id', '?')
        title = entry['title']
        char_expr = f"{entry['char']} {entry['expr']}"
        lines.append(f"| {char_expr} | {media_id} | `{title}` |")

    lines.extend([
        "",
        "---",
        "",
        "## 切り戻し方法（万一問題があったとき）",
        "",
        "もし新画像で問題が発生した場合：",
        "",
        "1. カスタマイザーで該当スロットを開く",
        "2. メディアライブラリから**旧画像**（タイトルに「-2024」等の古いもの）を再選択",
        "3. 公開で元に戻る",
        "",
        "→ 旧画像は削除していないので、いつでも戻せます。",
        "",
    ])

    return '\n'.join(lines)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--dry-run', action='store_true', help='アップロードせず確認のみ')
    args = parser.parse_args()

    config = load_config()
    wp_url = config.get('wordpress_url')
    auth = config.get('wp_auth') or {}
    username = auth.get('username')
    app_password = auth.get('application_password')

    if not (wp_url and username and app_password):
        print("[ERROR] config.json に wp_auth が設定されていません。")
        print("        次の形式で blog/config.json に追加してください：")
        print("        \"wp_auth\": {")
        print("          \"username\": \"WordPressユーザー名\",")
        print("          \"application_password\": \"xxxx xxxx xxxx xxxx xxxx xxxx\"")
        print("        }")
        sys.exit(1)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    mapping = []

    print(f"[upload] target: {wp_url}")
    print(f"[upload] user: {username}")
    print(f"[upload] images: {len(CHARACTERS)}")
    print()

    for i, c in enumerate(CHARACTERS, 1):
        src = CHARACTERS_DIR / c['file']
        if not src.exists():
            print(f"  [SKIP] {i:2d}. {c['file']} (not found)")
            continue
        print(f"  [{i:2d}/{len(CHARACTERS)}] {c['title']} (slot={c['slot']})")
        if args.dry_run:
            mapping.append({**c, "media_id": None, "source_url": None, "_dry_run": True})
            continue
        # リサイズ
        img_bytes = resize_image(src)
        # アップロード
        ascii_filename = f"{c['title']}.png"  # 日本語タイトルだがJSONエンコードで対応
        result = upload_media(wp_url, username, app_password,
                             img_bytes, ascii_filename, c['title'], c['alt'])
        if "_error" in result:
            print(f"      ERROR: {result['_error']}")
            mapping.append({**c, "media_id": None, "_error": result['_error']})
            continue
        print(f"      ✓ media_id={result['id']}  url={result.get('source_url', '')[:80]}")
        mapping.append({**c, "media_id": result['id'], "source_url": result.get('source_url')})

    # 結果保存
    mapping_path = OUT_DIR / "character-media-mapping.json"
    with open(mapping_path, 'w', encoding='utf-8') as f:
        json.dump(mapping, f, ensure_ascii=False, indent=2)
    print(f"\n[done] mapping saved: {mapping_path}")

    # 手順書生成
    if not args.dry_run:
        manual = generate_manual(mapping, wp_url)
        manual_path = OUT_DIR / "jinr-fukidashi-update-manual.md"
        manual_path.write_text(manual, encoding='utf-8')
        print(f"[done] manual generated: {manual_path}")

    success_count = sum(1 for m in mapping if m.get('media_id'))
    print(f"\n[summary] uploaded: {success_count}/{len(CHARACTERS)}")


if __name__ == "__main__":
    main()
