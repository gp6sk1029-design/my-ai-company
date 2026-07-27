#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""記事の水色アンダーラインを間引く。

方針（2026-07-27制定）：
  水色アンダーライン ＝「数字・結論」専用にする。
  ・1段落につき最大1箇所
  ・残す条件：数値（数字／万・円・倍・日・分・時間・％）を含む
  ・条件に合わないものは span を外して **太字だけ** にする（文字は消さない）
  ・表・リスト内はそのまま（既に構造化されていて視線が留まるため）
使い方: python3 deemph.py <post_id> [--publish]
"""
import re, sys, html
sys.path.insert(0, "/Users/shoheikoda/Documents/my-ai-company/blog/scripts")
from wp_api import WPClient

UL_OPEN = ('<span style="text-decoration:underline;text-decoration-color:#56CCF2;'
           'text-decoration-thickness:3px;">')
UL_RE = re.compile(re.escape(UL_OPEN) + r'(.*?)</span>', re.S)
NUM_RE = re.compile(r'[0-9０-９]|万|円|倍|時間|分|秒|日|ヶ月|％|%')

def strip_tags(s):
    return html.unescape(re.sub('<[^>]+>', '', s))

def score(text):
    """残す優先度。金額・倍率＞時間＞ただの数字＞数字なし。
    日本語は結論が後ろに来るので、同点なら後ろを優先する（呼び出し側で <= 比較）。"""
    if re.search(r'[0-9０-９][0-9０-９,，]*\s*(円|万|億|倍)', text) or re.search(r'(円|万円|倍)', text):
        return 3
    if re.search(r'[0-9０-９].*(時間|分|秒|日|ヶ月|週間|年)', text):
        return 2
    if NUM_RE.search(text):
        return 1
    return 0

def thin_paragraph(block):
    """1段落内の水色ULを最大1個に絞る。残すのは『いちばん価値の高い数字』。"""
    hits = list(UL_RE.finditer(block))
    if len(hits) <= 1 and (not hits or score(strip_tags(hits[0].group(1))) > 0):
        return block, 0  # 1個以下かつ数値あり → そのまま
    keep_idx, best = None, 0
    for i, m in enumerate(hits):
        s = score(strip_tags(m.group(1)))
        if s > 0 and s >= best:   # 同点なら後ろ（＝結論側）を優先
            keep_idx, best = i, s
    out, removed, pos = [], 0, 0
    for i, m in enumerate(hits):
        out.append(block[pos:m.start()])
        if i == keep_idx:
            out.append(m.group(0))          # 残す
        else:
            out.append(m.group(1))          # span を外す＝太字だけになる
            removed += 1
        pos = m.end()
    out.append(block[pos:])
    return ''.join(out), removed

def process(ct):
    blocks = re.split(r'(?=<!-- wp:)', ct)
    total_removed = 0
    for i, b in enumerate(blocks):
        if b.startswith('<!-- wp:paragraph'):
            blocks[i], r = thin_paragraph(b)
            total_removed += r
    return ''.join(blocks), total_removed

def count_ul(s, kind=None):
    if kind is None:
        return len(UL_RE.findall(s))
    return sum(len(UL_RE.findall(b)) for b in re.split(r'(?=<!-- wp:)', s)
               if b.startswith('<!-- wp:' + kind))

if __name__ == '__main__':
    pid = int(sys.argv[1])
    c = WPClient.from_config()
    ct = c._request("GET", f"/posts/{pid}", params={"context": "edit"})["content"]["raw"]
    before_p, before_all = count_ul(ct, 'paragraph'), count_ul(ct)
    new, removed = process(ct)
    after_p, after_all = count_ul(new, 'paragraph'), count_ul(new)
    print(f"post {pid}")
    print(f"  水色UL 全体 : {before_all} → {after_all}")
    print(f"  うち段落内  : {before_p} → {after_p}（{removed}個を太字だけに変更）")
    print(f"  表・リスト  : {before_all - before_p}（変更なし）")
    # 文字が消えていないことを検証
    assert strip_tags(ct) == strip_tags(new), "本文テキストが変化している（バグ）"
    print("  ✅ 本文テキストは1文字も変わっていません")
    if "--publish" in sys.argv:
        r = c._request("POST", f"/posts/{pid}", data={"content": new})
        print(f"  ✅ 反映 post_id={r['id']} status={r['status']}")
    else:
        import pathlib
        pathlib.Path(f"/private/tmp/claude-501/-Users-shoheikoda-Documents-my-ai-company/"
                     f"6d0f3a75-f097-4847-bbe7-46e7af3986f2/scratchpad/{pid}_deemph.html").write_text(new)
        print("  （ドライラン。反映するには --publish）")
