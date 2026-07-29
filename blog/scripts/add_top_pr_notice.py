# -*- coding: utf-8 -*-
"""冒頭カードの直前にPR表記を置く（景表法・ステマ規制対応）。

背景：商品カードを冒頭に移したことで、PR表記（記事末尾・88〜95%地点）よりも
     広告リンクが先に現れる状態になった。広告表示は「広告に触れる前に分かる」
     位置に置く必要があるため、冒頭カードの直前にも簡潔なPR表記を入れる。
     末尾の詳細版（価格変動の注記つき）はそのまま残す。
使い方: python3 add_top_pr.py [--apply]
"""
import sys, re, time
sys.path.insert(0, "/Users/shoheikoda/Documents/my-ai-company/blog/scripts")
from wp_api import WPClient

MARK = "ptgl-pr-top"

def pr_block(has_rakuten):
    src = "Amazonアソシエイト・楽天アフィリエイト" if has_rakuten else "Amazonアソシエイト"
    return ('<!-- wp:paragraph -->\n'
            f'<p class="{MARK}" style="font-size:.86em;color:#6b7280;">'
            f'※本記事には広告（{src}）を含みます。リンク経由でご購入いただくと、'
            'サイト運営者に紹介料が入る場合があります（価格は変わりません）。</p>\n'
            '<!-- /wp:paragraph -->\n\n')

def main(apply=False):
    c = WPClient.from_config()
    posts = c._request("GET","/posts",params={"per_page":100,"status":"publish","context":"edit"})
    done = skip = 0
    for p in sorted(posts, key=lambda x:-int(x["id"])):
        pid, ct = p["id"], p["content"]["raw"]
        title = re.sub("<[^>]+>","",p["title"]["raw"])[:26]
        if ct.count("ptgl-product-box") == 0:
            skip += 1; continue
        if MARK in ct:
            print(f"  – {pid} {title}: すでに冒頭PR表記あり"); skip += 1; continue
        # 冒頭カードのブロック開始位置（リード文があればその前）を探す
        cpos = ct.find('<!-- wp:html -->\n<div class="ptgl-product-box"')
        if cpos < 0:
            cpos = ct.find("ptgl-product-box")
            cpos = ct.rfind("<!-- wp:", 0, cpos)
        lead = ct.rfind("<!-- wp:paragraph -->\n<p>詳しい理由は本文で書きますが", 0, cpos)
        ins = lead if lead > 0 else cpos
        blk = pr_block("a.r10.to" in ct or "hb.afl" in ct)
        new = ct[:ins] + blk + ct[ins:]
        assert new.count(MARK) == 1 and new.count("ptgl-product-box") == ct.count("ptgl-product-box")
        print(f"  ✔ {pid} {title}: PR表記を {ins/len(ct):.0%}地点に挿入（カードの直前）")
        if apply:
            c._request("POST", f"/posts/{pid}", data={"content": new}); time.sleep(1.0)
        done += 1
    print(f"\n{'反映' if apply else 'ドライラン'}: {done}件 / スキップ {skip}件")

if __name__ == "__main__":
    main("--apply" in sys.argv)
