# -*- coding: utf-8 -*-
"""既存記事の :::product カード画像を軽量版に差し替える（96px表示なのに1500px読んでいた）。
使い方: python3 shrink_card_images.py [--publish]
"""
import re, sys
sys.path.insert(0, "/Users/shoheikoda/Documents/my-ai-company/blog/scripts")
from wp_api import WPClient

AMZ_IMG = re.compile(r'(https://m\.media-amazon\.com/images/I/[\w+\-]+)\._AC_S[LXY]\d+_(\.jpg)')

def fix(ct):
    n = 0
    def rep(m):
        nonlocal n; n += 1
        return m.group(1) + '._AC_SL320_' + m.group(2)
    ct = AMZ_IMG.sub(rep, ct)
    # カード画像に lazy/decoding/寸法を付ける（未付与のものだけ）
    lz = 0
    def rep2(m):
        nonlocal lz
        if 'loading=' in m.group(0): return m.group(0)
        lz += 1
        return m.group(0).replace('<img ', '<img width="96" height="96" loading="lazy" decoding="async" ', 1)
    ct = re.sub(r'<img src="https://m\.media-amazon\.com/images/I/[^"]+"[^>]*?/>', rep2, ct)
    return ct, n, lz

c = WPClient.from_config()
posts = c._request("GET", "/posts", params={"status": "any", "per_page": 100, "context": "edit"})
total_img = total_lz = 0
for p in posts:
    ct = p["content"]["raw"]
    if 'm.media-amazon.com/images' not in ct: continue
    new, n, lz = fix(ct)
    if new == ct:
        print(f"  = {p['id']} {p['title']['raw'][:34]} … 変更なし"); continue
    total_img += n; total_lz += lz
    print(f"  ↓ {p['id']} {p['title']['raw'][:34]} … 画像{n}枚を320px化 / lazy{lz}枚")
    if "--publish" in sys.argv:
        r = c._request("POST", f"/posts/{p['id']}", data={"content": new})
        print(f"     ✅ 反映 status={r['status']}")
print(f"\n合計: 画像{total_img}枚を軽量化 / lazy付与{total_lz}枚")
if "--publish" not in sys.argv: print("（ドライラン。反映するには --publish）")
