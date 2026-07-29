# -*- coding: utf-8 -*-
"""「急いでいる人へ（3行まとめ）」の直後に商品カードを複製設置する（全記事一括）。

背景：カードが記事の平均76%地点にしかなく、最後まで読まない読者には導線がなかった。
安全策：まとめ直後に既にカードがある記事はスキップ（二重設置を防ぐ）。
使い方: python3 add_top_card_all.py [--apply]
"""
import sys, re, time
sys.path.insert(0, "/Users/shoheikoda/Documents/my-ai-company/blog/scripts")
from wp_api import WPClient

LEAD = ('<!-- wp:paragraph -->\n<p>詳しい理由は本文で書きますが、'
        '<strong>先に商品だけ確認したい方はこちらからどうぞ</strong>。</p>\n<!-- /wp:paragraph -->\n\n')

def main(apply=False):
    c = WPClient.from_config()
    posts = c._request("GET","/posts",params={"per_page":100,"status":"publish","context":"edit"})
    done = skip = 0
    for p in sorted(posts, key=lambda x:-int(x["id"])):
        pid, ct = p["id"], p["content"]["raw"]
        title = re.sub("<[^>]+>","",p["title"]["raw"])[:26]
        if ct.count("ptgl-product-box") == 0:
            print(f"  – {pid} {title}: カードなし"); skip += 1; continue
        h = re.search(r'<!-- wp:heading[^>]*-->\s*<h2[^>]*>[^<]*急いでいる人へ.*?</h2>\s*<!-- /wp:heading -->', ct, re.S)
        if not h:
            print(f"  – {pid} {title}: 見出しなし"); skip += 1; continue
        lst = ct.find("<!-- /wp:list -->", h.end())
        if lst < 0:
            print(f"  – {pid} {title}: まとめリストなし"); skip += 1; continue
        ins = lst + len("<!-- /wp:list -->")
        # すでに直後（1,200字以内）にカードがあれば二重設置しない
        if "ptgl-product-box" in ct[ins:ins+1200]:
            print(f"  – {pid} {title}: すでに冒頭にカードあり"); skip += 1; continue
        m = re.search(r'<!-- wp:html -->\s*<div class="ptgl-product-box".*?<!-- /wp:html -->', ct, re.S)
        before = ct.find("ptgl-product-box")/len(ct)
        new = ct[:ins] + "\n\n" + LEAD + m.group(0) + ct[ins:]
        assert new.count("ptgl-product-box") == ct.count("ptgl-product-box") + 1
        print(f"  ✔ {pid} {title}: {before:.0%} → {new.find('ptgl-product-box')/len(new):.0%}")
        if apply:
            c._request("POST", f"/posts/{pid}", data={"content": new})
            time.sleep(1.0)   # WAF対策：連続POSTを避ける
        done += 1
    print(f"\n{'反映' if apply else 'ドライラン'}: {done}件 / スキップ {skip}件")

if __name__ == "__main__":
    main("--apply" in sys.argv)
