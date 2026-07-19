#!/usr/bin/env python3
"""記事めし（GAS）から、指定記事フォルダの文脈を取り出す。

画像編集スキル（gazo-edit）が「いま記事めしで作業中の記事」を引き継ぐために使う。
PROMPT.md のメモ（画像の役割＋用途テンプレ＋fileId）と記事タイトルをまとめて返す。

使い方:
  # 記事フォルダIDを指定して文脈を取得
  python3 blog/scripts/meshi_context.py --folder-id 1j-5LN8wVPcJ1V-J9p24dDecJ3q9XqYH4

  # 記事一覧だけ見る（フォルダIDを探すとき）
  python3 blog/scripts/meshi_context.py --list

  # JSONで欲しいとき（スクリプト連携用）
  python3 blog/scripts/meshi_context.py --folder-id XXX --json

「いま作業中の記事」の特定方法（Claude向けメモ）:
  Drive MCP の search_files で、役割prefix付き画像を新しい順に1件取り、その parentId を使う。
  例: "(title contains 'eyecatch_' or title contains 'section_') and mimeType contains 'image/'"
"""
import argparse
import json
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path

CONFIG_JS = Path(__file__).resolve().parents[1] / "pwa-cloudflare" / "config.js"


def load_gas_config():
    if not CONFIG_JS.exists():
        sys.exit(f"設定ファイルが見つかりません: {CONFIG_JS}")
    text = CONFIG_JS.read_text(encoding="utf-8")
    url = re.search(r"GAS_URL\s*:\s*['\"]([^'\"]+)['\"]", text)
    token = re.search(r"SHARED_TOKEN\s*:\s*['\"]([^'\"]+)['\"]", text)
    if not url or not token:
        sys.exit("config.js から GAS_URL / SHARED_TOKEN を取得できませんでした")
    return url.group(1), token.group(1)


def gas_get(gas_url, token, action, **params):
    sep = "&" if "?" in gas_url else "?"
    q = f"{gas_url}{sep}action={action}&token={urllib.parse.quote(token)}"
    for k, v in params.items():
        q += f"&{k}={urllib.parse.quote(str(v))}"
    with urllib.request.urlopen(q, timeout=120) as res:
        return json.loads(res.read().decode("utf-8", errors="replace"))


# 役割メモ1行を分解: 「アイキャッチ: xxx.png ｜用途: 🖼️ ブログアイキャッチ (fileId: abc)」
MEMO_RE = re.compile(
    r"^(?P<role>[^:：]+)\s*[:：]\s*(?P<file>[^｜(]+?)\s*"
    r"(?:｜用途:\s*(?P<tpl>[^｜(]+?)\s*)?"
    r"(?:\(fileId:\s*(?P<fid>[A-Za-z0-9_\-]+)\))?\s*$"
)


def parse_memo(line):
    m = MEMO_RE.match(line.strip())
    if not m:
        return {"raw": line.strip()}
    return {
        "role": (m.group("role") or "").strip(),
        "fileName": (m.group("file") or "").strip(),
        "template": (m.group("tpl") or "").strip(),
        "fileId": m.group("fid") or "",
    }


def main():
    ap = argparse.ArgumentParser(description="記事めしの記事文脈を取得")
    ap.add_argument("--folder-id", help="記事フォルダID(Drive)")
    ap.add_argument("--list", action="store_true", help="記事一覧を表示")
    ap.add_argument("--json", action="store_true", help="JSONで出力")
    args = ap.parse_args()

    gas_url, token = load_gas_config()

    if args.list:
        d = gas_get(gas_url, token, "listArticles")
        items = d.get("articles") or d.get("items") or []
        if args.json:
            print(json.dumps(items, ensure_ascii=False, indent=2))
        else:
            print(f"記事フォルダ {len(items)} 件:")
            for a in items:
                print(f"  {a.get('id')}  {a.get('articleTitle') or a.get('name')}")
        return

    if not args.folder_id:
        sys.exit("--folder-id か --list を指定してください")

    # 記事タイトルを解決
    title = ""
    try:
        d = gas_get(gas_url, token, "listArticles")
        for a in (d.get("articles") or d.get("items") or []):
            if a.get("id") == args.folder_id:
                title = a.get("articleTitle") or a.get("name") or ""
                break
    except Exception:
        pass

    p = gas_get(gas_url, token, "getPrompt", articleFolderId=args.folder_id)
    if not p.get("ok"):
        sys.exit(f"取得失敗: {p}")

    memos = [parse_memo(m) for m in (p.get("memos") or [])]
    images = [m for m in memos if m.get("fileId")]
    notes = [m for m in memos if not m.get("fileId")]

    result = {
        "folderId": args.folder_id,
        "articleTitle": title,
        "articleType": p.get("articleType") or "",
        "hasPrompt": bool(p.get("exists")),
        "images": images,
        "notes": [n.get("raw") or n.get("role") for n in notes],
    }

    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return

    print(f"📝 記事: {title or '(タイトル不明)'}")
    print(f"   フォルダID: {args.folder_id}")
    if p.get("articleType"):
        print(f"   記事タイプ: {p['articleType']}")
    print(f"\n🖼 登録済み画像 {len(images)} 枚:")
    for im in images:
        tpl = f" ／用途: {im['template']}" if im.get("template") else ""
        print(f"  - [{im.get('role')}] {im.get('fileName')}{tpl}")
    if notes:
        print(f"\n🗒 その他メモ {len(notes)} 件:")
        for n in notes:
            print(f"  - {n}")


if __name__ == "__main__":
    main()
