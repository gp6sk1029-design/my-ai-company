# -*- coding: utf-8 -*-
"""全公開記事：最初のh2より前に「導入文（段落/引用）」があるかを点検。
   無い記事は目次がアイキャッチ直下に出る＝いきなりメニュー状態。"""
import sys, re, html
sys.path.insert(0, "/Users/shoheikoda/Documents/my-ai-company/blog/scripts")
from wp_api import WPClient
c = WPClient.from_config()
posts = c._request("GET", "/posts", params={"per_page":100, "status":"publish", "context":"edit"})
ng = 0
for p in sorted(posts, key=lambda x: -int(x["id"])):
    ct = p["content"]["raw"]
    h2 = re.search(r"<!-- wp:heading", ct)
    head = ct[:h2.start()] if h2 else ct
    intro = re.findall(r"<!-- wp:(paragraph|quote)", head)
    chars = len(re.sub(r"\s+","", re.sub(r"<[^>]+>","", head)))
    ok = len(intro) > 0 and chars >= 40
    if not ok: ng += 1
    print(f"{'✅' if ok else '🚩'} [{p['id']}] 導入{len(intro)}ブロック/{chars}字  {html.unescape(p['title']['raw'])[:34]}")
print(f"\n要修正 {ng} 件")
