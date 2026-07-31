# -*- coding: utf-8 -*-
"""article_lint.py ── 記事の公開前・公開後の検品を1コマンドに統合したゲート
========================================================================
これまでバラバラだった点検（冒頭構造 check_article_head / 偉そう表現スキャン /
PR表記の位置 / カード位置 / 価格の整合 / markdown残骸 / 体験創作ワード）を
1本にまとめたもの。publish_article.py が公開前に自動で呼ぶほか、
公開済み記事の一括点検にも使える。

「同じ失敗が2回起きたらこのlintにチェックを昇格する」が運用ルール
（blog/SKILL.md エスカレーション参照）。ルールを人（AI）の記憶に頼らず、
仕組みで再発を止めるためのファイル。

使い方
------------------------------------------------------------------------
  python3 blog/scripts/article_lint.py --all          # 全公開記事を点検（API経由）
  python3 blog/scripts/article_lint.py --post 605     # 記事IDを指定して点検
  python3 blog/scripts/article_lint.py --slug xxx     # ローカル原稿（公開前）を点検
  python3 blog/scripts/article_lint.py --post 605 --unowned  # 未所有商品の記事（体験創作を検出）

判定レベル
------------------------------------------------------------------------
  🚫 ERROR … 公開をブロックする（publish_article.py が投稿を中止）
  ⚠️ WARN  … 公開は通るが目視確認が必要
  ℹ️ INFO  … 判断材料の表示（価格の出現一覧など）
========================================================================
"""
import argparse
import html as html_mod
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "blog" / "scripts"))

# ---- 検出パターン ----------------------------------------------------
# 偉そう表現（2026-07-29 制定・writing.md §16）。ヒット＝ERROR。
# 「べきだった」（自省）は除外する。
TONE_RE = re.compile(
    r"(してみろ|やってみろ|覚えろ|回収していけ|数えろ|甘いな|分からんようだな"
    r"|損してたんだ|知らないと損|結論から言う。|言っておくが|教えてやる"
    r"|べきだ(?!った)|素人は)"
)
# 体験創作ワード（未所有商品の記事のみ検査・writing.md 体験創作禁止）
EXPERIENCE_RE = re.compile(
    r"(使ってみた|使ってみる|届いた|開封し|装着してみ|着け心地|触ってみ"
    r"|試してみた|手に取ってみ|実際に使う?と)"
)
# アフィリエイトリンク（この位置より前にPR表記が必要）
AFFILIATE_RE = re.compile(r"(a\.r10\.to|amzn\.to|amazon\.co\.jp/dp|ptgl-product-box)")
PRICE_RE = re.compile(r"([0-9][0-9,]{2,})円")
FACE_RE = re.compile(r"\[(通常|ドヤ顔|驚き|ニヤ顔|絶望|怪しげ|悩む|焦り|恥ずかしい)\]")


def _text_of(content: str) -> str:
    """ブロックHTMLからタグ・コメントを除いた本文テキストを取り出す。"""
    t = re.sub(r"<!--.*?-->", "", content, flags=re.S)
    t = re.sub(r"<[^>]+>", "", t)
    return html_mod.unescape(t)


def _ctx(text: str, pos: int, span: int = 18) -> str:
    """ヒット位置の前後の文脈（目視確認用）。"""
    s = max(0, pos - span)
    return text[s:pos + span].replace("\n", " ")


# ---- 各チェック ------------------------------------------------------
def check_head(content):
    """冒頭構造：最初のh2より前に導入文（段落/引用40字以上）があるか。
    冒頭がいきなり吹き出しで始まっていないか。"""
    errs = []
    h2 = re.search(r"<!-- wp:heading", content)
    head = content[:h2.start()] if h2 else content
    intro = re.findall(r"<!-- wp:(paragraph|quote)", head)
    chars = len(re.sub(r"\s+", "", _text_of(head)))
    if not intro or chars < 40:
        errs.append(("head", f"最初のh2前に導入文がない（段落{len(intro)}個/{chars}字。40字以上必要）"))
    first_block = re.search(r"<!-- wp:([a-z0-9\-/]+)", content)
    if first_block and "fukidashi" in first_block.group(1):
        errs.append(("head", "記事の冒頭が吹き出しで始まっている（順序：導入文→3行まとめ→吹き出し）"))
    return errs


def check_tone(content):
    """偉そう表現：命令形・見下し・言い渡しをスキャン。"""
    errs = []
    text = _text_of(content)
    for m in TONE_RE.finditer(text):
        errs.append(("tone", f"偉そう表現「{m.group(1)}」…『{_ctx(text, m.start())}』"))
    return errs


def check_pr_order(content):
    """PR表記の位置：アフィリリンクを含む記事は、最初のリンクより前にPR表記が必要
    （ステマ規制対応・2026-07-31 の全記事事故から昇格）。"""
    aff = AFFILIATE_RE.search(content)
    if not aff:
        return []
    pr = content.find("ptgl-pr-top")
    if pr == -1:
        return [("pr", "アフィリリンクがあるのにPR表記（ptgl-pr-top）が見つからない")]
    if pr > aff.start():
        return [("pr", "PR表記が最初の広告リンクより後ろにある（必ず前に置く）")]
    return []


def check_card_position(content):
    """冒頭カード：最初の商品カードが本文の前半25%以内にあるか（WARN）。"""
    pos = content.find("ptgl-product-box")
    if pos == -1 or not content:
        return []
    pct = pos * 100 // len(content)
    if pct > 25:
        return [("card", f"最初の商品カードが本文の{pct}%地点（25%以内を推奨）")]
    return []


def check_md_residue(content):
    """markdown残骸：ブロックHTML内に未変換のmd記法が残っていないか。"""
    errs = []
    if "![" in content:
        errs.append(("md", "未変換のmarkdown画像 ![ が残存"))
    if "](http" in content:
        errs.append(("md", "未変換のmarkdownリンク ](http が残存"))
    text = _text_of(content)
    if "**" in text:
        errs.append(("md", "本文テキストに ** が露出（太字はstrongタグに変換する）"))
    for m in re.finditer(r"(?m)^#{1,6} ", text):
        errs.append(("md", f"本文に # 見出し記法が露出…『{_ctx(text, m.start())}』"))
        break
    for m in FACE_RE.finditer(text):
        errs.append(("md", f"表情記法 [{m.group(1)}] が本文に露出"))
        break
    return errs


# 価格に「注釈」が付いていれば別物と分かるので警告しない（定価/実売/年間換算など）
PRICE_ANNOT_RE = re.compile(r"(定価|実売|発売時|想定|希望小売|時点|差額|累計|おトク|節約|換算|相当|合計|総|/年|年間|セット|単品)")


def check_prices(content):
    """価格の整合：全出現を列挙し、近い金額の併存（価格割れの疑い）を警告。
    2026-07 に価格不一致事故が累計8回起きたため昇格（feedback_blog_price_consistency）。
    誤検知を抑えるため「両方2回以上出現」かつ「どちらにも注釈なし」の組だけ警告する。"""
    warns, infos = [], []
    text = _text_of(content)
    seen = {}
    for m in PRICE_RE.finditer(text):
        v = int(m.group(1).replace(",", ""))
        seen.setdefault(v, []).append(_ctx(text, m.start()))
    if seen:
        lst = "、".join(f"{v:,}円×{len(c)}" for v, c in sorted(seen.items()))
        infos.append(("price", f"価格の出現: {lst}"))

    def annotated(v):
        return any(PRICE_ANNOT_RE.search(c) for c in seen[v])

    vals = sorted(v for v in seen if v >= 3000 and len(seen[v]) >= 2)
    for a, b in zip(vals, vals[1:]):
        if b / a <= 1.3 and not (annotated(a) or annotated(b)):
            warns.append(("price", f"近い金額が併存: {a:,}円 と {b:,}円（同一商品の価格割れでないか目視確認）"
                          f" …『{seen[a][0]}』／『{seen[b][0]}』"))
    return warns, infos


def check_experience(content):
    """体験創作：未所有商品の記事で使用感の捏造ワードを検出（--unowned 時のみERROR）。"""
    errs = []
    text = _text_of(content)
    for m in EXPERIENCE_RE.finditer(text):
        errs.append(("exp", f"体験創作の疑い「{m.group(1)}」…『{_ctx(text, m.start())}』"))
    return errs


# ---- まとめ ----------------------------------------------------------
def lint_content(content, unowned=False):
    """ブロックHTMLを検査して (errors, warns, infos) を返す。publish_article.py から呼ばれる。"""
    errors, warns, infos = [], [], []
    errors += check_head(content)
    errors += check_tone(content)
    errors += check_pr_order(content)
    errors += check_md_residue(content)
    warns += check_card_position(content)
    pw, pi = check_prices(content)
    warns += pw
    infos += pi
    if unowned:
        errors += check_experience(content)
    return errors, warns, infos


def print_findings(label, errors, warns, infos, verbose=True):
    mark = "🚫" if errors else ("⚠️" if warns else "✅")
    print(f"{mark} {label}")
    for code, msg in errors:
        print(f"   🚫 [{code}] {msg}")
    for code, msg in warns:
        print(f"   ⚠️ [{code}] {msg}")
    if verbose:
        for code, msg in infos:
            print(f"   ℹ️ [{code}] {msg}")


def main():
    ap = argparse.ArgumentParser(description="記事の統合検品（公開前ゲート／公開後の一括点検）")
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--all", action="store_true", help="全公開記事をAPI経由で点検")
    g.add_argument("--post", type=int, help="記事IDを指定して点検")
    g.add_argument("--slug", help="ローカル原稿 blog/articles/<slug>.md を点検（公開前）")
    ap.add_argument("--unowned", action="store_true", help="未所有商品の記事として体験創作ワードも検査")
    ap.add_argument("--quiet", action="store_true", help="INFO（価格一覧など）を表示しない")
    args = ap.parse_args()

    targets = []  # (label, content)
    if args.slug:
        md_path = ROOT / "blog" / "articles" / f"{args.slug}.md"
        if not md_path.exists():
            sys.exit(f"❌ 記事が見つかりません: {md_path}")
        from wp_block_builder import markdown_to_blocks
        md = md_path.read_text(encoding="utf-8")
        # 画像行とH1は publish_article が変換するので、ここでは除いて検査する
        md = "\n".join(ln for ln in md.split("\n")
                       if not re.match(r"^!\[.*\]\(.*\)$", ln.strip())
                       and not re.match(r"^# ", ln))
        targets.append((f"[原稿] {args.slug}", markdown_to_blocks(md)))
    else:
        from wp_api import WPClient
        c = WPClient.from_config()
        if args.post:
            p = c._request("GET", f"/posts/{args.post}", params={"context": "edit"})
            posts = [p]
        else:
            posts = c._request("GET", "/posts",
                               params={"per_page": 100, "status": "publish", "context": "edit"})
        for p in sorted(posts, key=lambda x: -int(x["id"])):
            title = html_mod.unescape(p["title"]["raw"])[:34]
            targets.append((f"[{p['id']}] {title}", p["content"]["raw"]))

    total_err = total_warn = 0
    for label, content in targets:
        errors, warns, infos = lint_content(content, unowned=args.unowned)
        total_err += len(errors)
        total_warn += len(warns)
        print_findings(label, errors, warns, infos, verbose=not args.quiet)

    print(f"\n合計: 🚫 {total_err} 件 / ⚠️ {total_warn} 件（{len(targets)}記事）")
    if total_err:
        sys.exit(1)


if __name__ == "__main__":
    main()
