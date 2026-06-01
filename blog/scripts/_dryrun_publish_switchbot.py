#!/usr/bin/env python3
"""SwitchBot記事の本番反映ドライラン。ブロック生成して点検のみ（本番更新はしない）。"""
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from wp_block_builder import markdown_to_blocks, validate_blocks  # type: ignore

ART = Path(__file__).parent.parent / "articles" / "switchbot-lock-lite-review.md"
md = ART.read_text(encoding="utf-8")

# 1行目の # 見出し = 記事タイトルとして分離
lines = md.split("\n")
title = ""
if lines and lines[0].startswith("# "):
    title = lines[0][2:].strip()
    body_md = "\n".join(lines[1:])
else:
    body_md = md

content = markdown_to_blocks(body_md)

print("=" * 60)
print("【タイトル】", title)
print("=" * 60)

# --- 点検項目 ---
issues = validate_blocks(content)
print("\n[validate_blocks の指摘]:", issues if issues else "なし ✅")

checks = {
    "残存 [ニヤ顔] 等の表情記法 (露出NG)": re.findall(r"\[(通常|驚き|絶望|怪しげ|ニヤ顔|ドヤ顔|悩む|焦り|恥ずかしい)\]", content),
    "残存 markdown見出し ## (変換漏れNG)": re.findall(r"(?m)^## ", content),
    "残存 **bold** markdown (変換漏れNG)": re.findall(r"\*\*[^*]+\*\*", content),
    "タナカ slot9 ふきだし (ニヤ顔)": re.findall(r"jinr_fukidashi9", content),
    "Amazonアフィリリンク (tag付き)": re.findall(r'href="https://www\.amazon\.co\.jp/[^"]*tag=gp6sk1029-22"', content),
    "リンク a タグ総数": re.findall(r"<a href=", content),
    "wp:image ブロック数": re.findall(r"<!-- wp:image", content),
    "ふきだしブロック総数": re.findall(r"wp:jinr-blocks/fukidashi", content),
}
print("\n[内容チェック]")
for k, v in checks.items():
    print(f"  - {k}: {len(v)}件  {v[:3] if v else ''}")

# 文字数
print(f"\n[生成ブロック総文字数] {len(content):,} 文字")
print(f"[本番反映先] WP記事 ID=908 (公開中)")
