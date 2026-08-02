#!/usr/bin/env python3
"""Canvaで仕上げた画像を記事めし（Drive記事フォルダ）へ取り込む。

Canva Connect API の export-design で得た「書き出し済みPNGのURL」を渡すと、
ダウンロード → base64 → 記事めしGASの uploadSmall へPOST して記事フォルダに保存する。

画像バイナリはこのスクリプト内で完結する（AIの会話コンテキストを通さない＝巨大化しない）。

使い方:
  python3 blog/scripts/canva_to_meshi.py \
      --url "https://export-download.canva.com/..." \
      --folder-id 1j-5LN8wVPcJ1V-J9p24dDecJ3q9XqYH4 \
      --role eyecatch

  # 接続確認だけ（アップロードしない）
  python3 blog/scripts/canva_to_meshi.py --ping

役割(--role)はファイル名prefixになり、記事めし側でそのまま役割として認識される:
  eyecatch / hero / section / product / diagram / compare / comparetable / ngsummary
"""
import argparse
import base64
import json
import sys
import urllib.parse
import urllib.request
from datetime import datetime

from gas_config import load_gas_config

VALID_ROLES = {
    "eyecatch", "hero", "section", "product",
    "diagram", "compare", "comparetable", "ngsummary",
}


def gas_post(gas_url, params):
    """GASへ application/x-www-form-urlencoded でPOST（リダイレクト追従）。"""
    data = urllib.parse.urlencode(params).encode("utf-8")
    req = urllib.request.Request(gas_url, data=data, method="POST")
    with urllib.request.urlopen(req, timeout=180) as res:
        body = res.read().decode("utf-8", errors="replace")
    try:
        return json.loads(body)
    except json.JSONDecodeError:
        return {"ok": False, "message": "GASの応答がJSONではありません", "raw": body[:500]}


def main():
    ap = argparse.ArgumentParser(description="Canva書き出し画像を記事めしへ取り込む")
    ap.add_argument("--url", help="Canvaで書き出したPNG等のダウンロードURL")
    ap.add_argument("--folder-id", help="記事めしの記事フォルダID(Drive)")
    ap.add_argument("--role", default="eyecatch", help="画像の役割（ファイル名prefixになる）")
    ap.add_argument("--name", help="ファイル名を明示指定（省略時は role_日時.png）")
    ap.add_argument("--ping", action="store_true", help="GAS疎通確認のみ")
    args = ap.parse_args()

    gas_url, token = load_gas_config()

    if args.ping:
        sep = "&" if "?" in gas_url else "?"
        with urllib.request.urlopen(
            f"{gas_url}{sep}action=ping&token={urllib.parse.quote(token)}", timeout=60
        ) as res:
            print(res.read().decode("utf-8", errors="replace")[:300])
        return

    if not args.url or not args.folder_id:
        sys.exit("--url と --folder-id は必須です（疎通確認は --ping）")
    if args.role not in VALID_ROLES:
        sys.exit(f"--role は次のいずれか: {', '.join(sorted(VALID_ROLES))}")

    print(f"⬇️  Canvaから画像を取得中…")
    with urllib.request.urlopen(args.url, timeout=180) as res:
        blob = res.read()
        ctype = res.headers.get("Content-Type", "image/png").split(";")[0].strip()
    size_mb = len(blob) / 1024 / 1024
    print(f"   取得完了: {size_mb:.2f} MB / {ctype}")
    if len(blob) > 20 * 1024 * 1024:
        sys.exit("20MBを超えるため uploadSmall では送れません（Canva側で書き出しサイズを下げてください）")

    ext = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"}.get(ctype, "png")
    name = args.name or f"{args.role}_{datetime.now():%Y%m%d_%H%M%S}.{ext}"

    print(f"⬆️  記事めしへアップロード中… ({name})")
    result = gas_post(gas_url, {
        "action": "uploadSmall",
        "token": token,
        "fileName": name,
        "fileDataBase64": base64.b64encode(blob).decode("ascii"),
        "mimeType": ctype,
        "articleFolderId": args.folder_id,
        "capturedAt": datetime.now().isoformat(),
    })

    if not result.get("ok"):
        sys.exit(f"❌ 失敗: {result.get('message') or result}")
    if result.get("result") == "skipped":
        print(f"⚠️  同じ画像が既にフォルダにあります（重複スキップ / 既存ID: {result.get('existingFileId')}）")
        print("   仕上げ内容を変えて書き出し直すか、--name で別名を指定してください")
        return
    print(f"✅ 取り込み完了: {result.get('fileName') or name}")
    if result.get("fileId"):
        print(f"   fileId: {result['fileId']}")


if __name__ == "__main__":
    main()
