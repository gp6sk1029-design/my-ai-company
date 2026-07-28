# -*- coding: utf-8 -*-
"""sync_posts_to_local.py ── WordPressの公開記事を blog/posts/ に .md でミラーする。

なぜ必要か:
  記事の正本はWordPress側にあり、公開後の修正もWP上で直接おこなっている。
  そのため手元の執筆原稿（blog/articles/）はすぐ古くなり、
  「全記事を横断して点検する」たびにAPIから13記事を取り直すことになっていた。
  このスクリプトで手元に最新のミラーを置けば、点検も文体の参照も grep 一発で済む。

使い方:
  python3 blog/scripts/sync_posts_to_local.py            # 差分のあった記事だけ書き出す
  python3 blog/scripts/sync_posts_to_local.py --check    # 書き出さず、差分の有無だけ表示
  python3 blog/scripts/sync_posts_to_local.py --all      # 全記事を強制的に書き直す

出力: blog/posts/<記事ID>-<英字スラッグ>.md
  先頭にYAML形式のメタ情報（id・URL・公開日・最終更新日・カテゴリ）を付ける。
  本文はWordPressのブロックHTMLを読みやすいMarkdownへ変換したもの。

⚠️ このミラーは「読む・探す」ための写しであり、ここを編集してもWordPressには反映されない。
   記事を直すときは従来どおりWP側（REST API）を正本として更新すること。
"""
import argparse
import html as html_mod
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "blog" / "scripts"))
from wp_api import WPClient  # noqa: E402

OUT_DIR = ROOT / "blog" / "posts"

# 日本語スラッグの記事はURLがパーセントエンコードされていて機械処理しづらいので、
# 手元の執筆原稿（blog/articles/）のファイル名を英字スラッグとして流用する。
SLUG_MAP = {
    703: "huawei-gt-runner2-review",
    992: "doribiru-coin-case-review",
    963: "braun-ccr2-vs-ccr4",
    945: "magdget-shoulder-strap-review",
    927: "braun-clean-renew-compatible-review",
    908: "switchbot-lock-lite-review",
    873: "mx-ergo-s-settings-guide",
    836: "keychron-k1max-jis-setup-guide",
    605: "garmin-venu2s-review",
    552: "mx-ergo-s-carry-set",
    526: "mx-ergo-s-review",
    450: "keychron-k1max-review",
    12: "gadget-and-production-tech",
}


def slug_for(post):
    """記事IDから英字スラッグを決める。未登録の記事はURL末尾が英字ならそれを使う。"""
    pid = post["id"]
    if pid in SLUG_MAP:
        return SLUG_MAP[pid]
    slug = post.get("slug", "")
    if re.fullmatch(r"[a-z0-9\-]+", slug):
        return slug
    return f"post{pid}"


def _table_to_md(html):
    """<table>をMarkdownの表に変換する。列数が揃わない表はHTMLのまま残す。"""
    rows = re.findall(r"<tr[^>]*>(.*?)</tr>", html, re.S)
    out = []
    for i, row in enumerate(rows):
        cells = [_inline(c).strip().replace("|", "\\|")
                 for c in re.findall(r"<t[hd][^>]*>(.*?)</t[hd]>", row, re.S)]
        if not cells:
            continue
        out.append("| " + " | ".join(cells) + " |")
        if i == 0:
            out.append("|" + "---|" * len(cells))
    return "\n".join(out) if out else ""


def _inline(s):
    """インライン要素（リンク・強調・画像）をMarkdownに落とす。"""
    s = re.sub(r"<br\s*/?>", "  \n", s)
    s = re.sub(r'<img[^>]*?src="([^"]+)"[^>]*?alt="([^"]*)"[^>]*?>', r"![\2](\1)", s)
    s = re.sub(r'<img[^>]*?src="([^"]+)"[^>]*?>', r"![](\1)", s)
    s = re.sub(r'<a[^>]*?href="([^"]+)"[^>]*?>(.*?)</a>', r"[\2](\1)", s, flags=re.S)
    s = re.sub(r"</?(strong|b)>", "**", s)
    s = re.sub(r"</?(em|i)>", "*", s)
    s = re.sub(r"<code>(.*?)</code>", r"`\1`", s, flags=re.S)
    s = re.sub(r"<[^>]+>", "", s)
    return html_mod.unescape(s)


def to_markdown(raw):
    """WordPressのブロックHTMLを、読みやすさ優先でMarkdownへ変換する。"""
    # 吹き出しは話者が分かるよう「> 💬」で引用にする（ショートコードは残さない）
    def fukidashi(m):
        body = _inline(re.sub(r"\[/?jinr_fukidashi\d*\]", "", m.group(0))).strip()
        body = re.sub(r"\n{2,}", "\n", body)
        return "\n".join(f"> 💬 {ln}" for ln in body.split("\n") if ln.strip())

    raw = re.sub(r"<!-- wp:jinr-blocks/fukidashi.*?<!-- /wp:jinr-blocks/fukidashi -->",
                 fukidashi, raw, flags=re.S)
    raw = re.sub(r"<table[^>]*>.*?</table>", lambda m: _table_to_md(m.group(0)), raw, flags=re.S)
    raw = re.sub(r"<!--.*?-->", "", raw, flags=re.S)          # ブロックコメントを除去
    # プロフィール等のショートコードは読む上で意味がないので目印だけ残す
    raw = re.sub(r"\[/?jinr_[^\]]*\]", "", raw)

    for lv in (6, 5, 4, 3, 2, 1):                              # 見出し
        raw = re.sub(rf"<h{lv}[^>]*>(.*?)</h{lv}>",
                     lambda m, lv=lv: "\n" + "#" * lv + " " + _inline(m.group(1)).strip() + "\n",
                     raw, flags=re.S)
    raw = re.sub(r"<li[^>]*>(.*?)</li>",
                 lambda m: "- " + _inline(m.group(1)).strip() + "\n", raw, flags=re.S)
    raw = re.sub(r"<blockquote[^>]*>(.*?)</blockquote>",
                 lambda m: "\n".join("> " + ln for ln in _inline(m.group(1)).strip().split("\n")) + "\n",
                 raw, flags=re.S)
    raw = re.sub(r"<hr[^>]*>", "\n---\n", raw)
    raw = re.sub(r"<p[^>]*>(.*?)</p>",
                 lambda m: "\n" + _inline(m.group(1)).strip() + "\n", raw, flags=re.S)
    raw = re.sub(r"</?(ul|ol|figure|figcaption|div|section|span)[^>]*>", "", raw)
    raw = _inline(raw)
    raw = re.sub(r"\n{3,}", "\n\n", raw)
    return raw.strip()


def build(post, cat_names):
    cats = "、".join(cat_names.get(c, str(c)) for c in post.get("categories", []))
    title = html_mod.unescape(post["title"]["raw"])
    fm = [
        "---",
        f"post_id: {post['id']}",
        f'title: "{title}"',
        f"url: {post['link']}",
        f"date: {post['date'][:10]}",
        f"modified: {post['modified'][:10]}",
        f"categories: {cats}",
        f"status: {post['status']}",
        "---",
        "",
        "<!-- WordPressの内容をそのまま写したものです。編集してもサイトには反映されません。 -->",
        "",
        f"# {title}",
        "",
    ]
    return "\n".join(fm) + to_markdown(post["content"]["raw"]) + "\n"


def body_of(text):
    """既存ファイルからメタ情報を除いた本文を取り出す（modifiedの差だけで書き換えないため）。"""
    parts = text.split("---\n", 2)
    return parts[2] if len(parts) >= 3 else text


def main():
    ap = argparse.ArgumentParser(description="WordPressの公開記事を blog/posts/ にミラーする")
    ap.add_argument("--check", action="store_true", help="書き出さず差分の有無だけ表示")
    ap.add_argument("--all", action="store_true", help="差分がなくても全件書き直す")
    args = ap.parse_args()

    c = WPClient.from_config()
    cats = {t["id"]: t["name"] for t in c._request("GET", "/categories", params={"per_page": 100})}
    posts = c._request("GET", "/posts",
                       params={"per_page": 100, "status": "publish", "context": "edit"})
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    changed, added, same = [], [], []
    for p in sorted(posts, key=lambda x: -int(x["id"])):
        path = OUT_DIR / f"{p['id']}-{slug_for(p)}.md"
        new = build(p, cats)
        if not path.exists():
            added.append(path.name)
        elif body_of(path.read_text()) != body_of(new):
            changed.append(path.name)
        else:
            same.append(path.name)
            if not args.all:
                continue
        if not args.check:
            path.write_text(new)

    head = "[確認のみ] " if args.check else ""
    print(f"{head}公開記事 {len(posts)} 件")
    for name in added:
        print(f"  🆕 新規  {name}")
    for name in changed:
        print(f"  ✏️  更新  {name}")
    print(f"  ✅ 変更なし {len(same)} 件")
    if args.check and (added or changed):
        print("\n→ 反映するには --check を外して実行してください")


if __name__ == "__main__":
    main()
