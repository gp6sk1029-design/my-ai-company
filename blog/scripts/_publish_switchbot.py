#!/usr/bin/env python3
"""SwitchBot記事(ID=908)を現在のmdで本番更新する。POSTで更新（WAFがPUT/DELETEを403のため）。"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from wp_block_builder import markdown_to_blocks  # type: ignore
from wp_api import WPClient  # type: ignore

POST_ID = 908
ART = Path(__file__).parent.parent / "articles" / "switchbot-lock-lite-review.md"

md = ART.read_text(encoding="utf-8")
lines = md.split("\n")
title = lines[0][2:].strip() if lines and lines[0].startswith("# ") else ""
body_md = "\n".join(lines[1:])
content = markdown_to_blocks(body_md)

client = WPClient.from_config()

# 現状の取得（バックアップ的に旧タイトル表示）
before = client.get_post(POST_ID)
print(f"[更新前] ID={POST_ID} / status={before.status} / title={before.title!r}")

# POST で更新（title + content）。status は変更しない（公開のまま）
result = client._request("POST", f"/posts/{POST_ID}", data={
    "title": title,
    "content": content,
})
print(f"[更新後] title={result.get('title',{}).get('rendered','')!r}")
print(f"[URL] {result.get('link','')}")
print(f"[status] {result.get('status','')}")
print("✅ 本番反映完了")
