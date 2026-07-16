#!/usr/bin/env python3
"""
publish_article.py ── 新規記事をWordPressへ公開する正式ツール
========================================================================
記事めしPWA素材から書いた記事（blog/articles/<slug>.md）を、
「画像アップロード → wp:image ブロック化 → markdown_to_blocks → 検証 → 投稿」
まで一括で行う。安全のため **デフォルトはドライラン**（投稿しない）。
実投稿は `--publish` を付けたときだけ。

前提となる記事の書式（記事めしの標準フローに準拠）
------------------------------------------------------------------------
- 1行目に `# タイトル`（H1）＝ WordPress の投稿タイトルになる（本文からは除去）
- 本文画像は `![代替テキスト](任意のパス/ファイル名.jpg)` で記述
  （パスは /assets/<slug>/x.jpg でも x.jpg でもよい。**ファイル名**が
   --images-dir 内の実ファイルと一致すればアップ対象になる）
- アイキャッチは images-dir 内の `eyecatch*` 画像（または --eyecatch で指定）。
  featured_media に設定し、本文からは自動で除去する（テーマが上部に自動表示）
- キャラ吹き出しは `**タナカ[驚き]：** 「…」` / `**オオタニ所長[ドヤ顔]：** 「…」`

使い方
------------------------------------------------------------------------
  # ドライラン（検証だけ・投稿しない）
  python3 blog/scripts/publish_article.py --slug magdget-shoulder-strap-review \
      --categories 1,5

  # 実際に公開（下書きにするなら --status draft）
  python3 blog/scripts/publish_article.py --slug xxx --categories 1,5 \
      --excerpt "メタ説明…" --publish --status publish

  # 既存記事の本文を更新（新規作成でなく上書き）
  python3 blog/scripts/publish_article.py --slug xxx --update 945 --publish

  # 公開後、記事mdの画像URLをWPのURLに書き換える（任意）
  #   --rewrite-md を付けると本文の ![..](local) を ![..](WP-URL) に更新
========================================================================
"""
import argparse
import json
import re
import sys
from base64 import b64encode
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError
from urllib.parse import quote

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "blog" / "scripts"))
from wp_block_builder import markdown_to_blocks, validate_blocks, block_image  # noqa: E402

CONFIG_PATH = ROOT / "blog" / "config.json"
IMG_EXT = {".jpg", ".jpeg", ".png", ".webp", ".gif"}
CTYPE = {".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
         ".webp": "image/webp", ".gif": "image/gif"}
IMG_MD_RE = re.compile(r"!\[(.*?)\]\(([^)]+)\)")
FACE_RE = re.compile(r"\[(通常|ドヤ顔|驚き|ニヤ顔|絶望|怪しげ|悩む|焦り|恥ずかしい)\]")


# ---- WP 接続 ---------------------------------------------------------
def load_cfg():
    c = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    base = (c.get("wordpress_url") or "").rstrip("/")
    a = c.get("wp_auth", {})
    u, p = a.get("username"), a.get("application_password")
    if not (base and u and p):
        sys.exit("❌ blog/config.json に wordpress_url と wp_auth.username / application_password が必要です")
    return base, u, p


def _auth(u, p):
    return "Basic " + b64encode(f"{u}:{p}".encode()).decode()


def upload_media(base, u, p, path: Path, alt: str):
    """WP REST /media へバイナリPOSTして {id, source_url} を返す。"""
    ext = path.suffix.lower()
    url = f"{base}/wp-json/wp/v2/media"
    headers = {
        "Authorization": _auth(u, p),
        "Content-Type": CTYPE.get(ext, "image/jpeg"),
        "Content-Disposition": f'attachment; filename="{quote(path.name)}"',
    }
    req = Request(url, data=path.read_bytes(), headers=headers, method="POST")
    with urlopen(req, timeout=180) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    mid = data.get("id")
    if not mid:
        sys.exit(f"❌ 画像アップ失敗（idなし）: {path.name} -> {str(data)[:200]}")
    # title / alt_text を更新（POST時は反映されないため別リクエスト）
    up = Request(f"{url}/{mid}",
                 data=json.dumps({"title": alt or path.stem, "alt_text": alt}).encode(),
                 headers={"Authorization": _auth(u, p), "Content-Type": "application/json"},
                 method="POST")
    try:
        with urlopen(up, timeout=30) as r2:
            data = json.loads(r2.read().decode("utf-8"))
    except (HTTPError, URLError):
        pass
    return mid, data.get("source_url")


def wp_post(base, u, p, payload, post_id=None):
    """post_id 指定で更新、無ければ新規作成。"""
    path = f"/posts/{post_id}" if post_id else "/posts"
    req = Request(f"{base}/wp-json/wp/v2{path}", data=json.dumps(payload).encode(),
                  headers={"Authorization": _auth(u, p), "Content-Type": "application/json"},
                  method="POST")
    try:
        with urlopen(req, timeout=60) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except HTTPError as e:
        sys.exit(f"❌ WP API HTTP {e.code}: {e.read().decode('utf-8', 'ignore')[:300]}")


# ---- 本文組み立て ----------------------------------------------------
def build(md_text, images_dir: Path, eyecatch_name, media, dry):
    """H1→タイトル抽出、eyecatch本文除去、他画像をwp:image化。
    media[filename] = (id, url)。dry=True のときURLはダミー。"""
    lines = md_text.split("\n")
    title = None
    body = []
    for ln in lines:
        mh = re.match(r"^# (.+)$", ln)
        if mh and title is None:
            title = mh.group(1).strip()
            continue
        mi = IMG_MD_RE.match(ln.strip())
        if mi:
            alt, path = mi.group(1), mi.group(2)
            fn = Path(path).name
            if fn == eyecatch_name:
                continue  # featured_media にするので本文からは除去
            if fn in media:
                mid, url = media[fn]
                body.append(block_image(mid, url, alt))
                continue
            # images-dir に無い画像URL → そのまま wp:image で通す（外部URL想定）
            body.append(block_image(0, path, alt))
            continue
        body.append(ln)
    content = markdown_to_blocks("\n".join(body))
    return title, content


def collect_images(md_text, images_dir: Path):
    """本文で参照され、かつ images-dir に実在する画像ファイル名→altの辞書。"""
    found = {}
    for alt, path in IMG_MD_RE.findall(md_text):
        fn = Path(path).name
        if (images_dir / fn).exists() and Path(fn).suffix.lower() in IMG_EXT:
            found.setdefault(fn, alt)
    return found


def pick_eyecatch(images, explicit):
    if explicit:
        return explicit
    for fn in images:
        if fn.lower().startswith("eyecatch"):
            return fn
    return None


def main():
    ap = argparse.ArgumentParser(description="新規記事をWordPressへ公開（デフォルト=ドライラン）")
    ap.add_argument("--slug", required=True, help="記事スラッグ（blog/articles/<slug>.md）")
    ap.add_argument("--images-dir", default=None, help="画像フォルダ（既定 blog/articles/<slug>_images）")
    ap.add_argument("--categories", default="", help="カテゴリID カンマ区切り（例 1,5）")
    ap.add_argument("--excerpt", default="", help="メタ説明（抜粋）")
    ap.add_argument("--eyecatch", default=None, help="アイキャッチのファイル名（既定 eyecatch* を自動検出）")
    ap.add_argument("--status", default="draft", choices=["publish", "draft"])
    ap.add_argument("--update", type=int, default=None, help="既存投稿IDを更新（新規作成しない）")
    ap.add_argument("--publish", action="store_true", help="実際に投稿する（付けないとドライラン）")
    ap.add_argument("--rewrite-md", action="store_true", help="公開後、mdの画像URLをWP URLへ書換")
    args = ap.parse_args()

    md_path = ROOT / "blog" / "articles" / f"{args.slug}.md"
    if not md_path.exists():
        sys.exit(f"❌ 記事が見つかりません: {md_path}")
    images_dir = Path(args.images_dir) if args.images_dir else ROOT / "blog" / "articles" / f"{args.slug}_images"
    md_text = md_path.read_text(encoding="utf-8")

    cats = [int(x) for x in args.categories.split(",") if x.strip()]
    images = collect_images(md_text, images_dir)
    eyecatch = pick_eyecatch(images, args.eyecatch)

    print(f"=== 記事: {args.slug} ===")
    print(f"画像フォルダ: {images_dir}")
    print(f"参照画像({len(images)}): " + ", ".join(images.keys()))
    print(f"アイキャッチ: {eyecatch or '(なし)'}")
    print(f"カテゴリ: {cats or '(未指定)'}  status: {args.status}  "
          f"{'更新 id='+str(args.update) if args.update else '新規作成'}")

    if not images:
        print("⚠️ images-dir に一致する画像がありません（画像なし記事として続行）")
    if eyecatch is None and images:
        print("⚠️ アイキャッチ未検出。--eyecatch で指定するか eyecatch* 命名にしてください")

    base, u, p = load_cfg()

    # 画像アップロード（ドライランはダミーURL）
    media = {}
    if args.publish:
        for fn, alt in images.items():
            mid, src = upload_media(base, u, p, images_dir / fn, alt)
            media[fn] = (mid, src)
            print(f"  ⬆ {fn} -> id={mid}")
    else:
        for fn in images:
            media[fn] = (0, f"https://www.ootanisatan.com/DRYRUN/{fn}")

    title, content = build(md_text, images_dir, eyecatch, media, dry=not args.publish)

    # 検証
    issues = validate_blocks(content)
    extra = []
    if "![" in content:
        extra.append("未変換のmarkdown画像 ![ が残存")
    if FACE_RE.search(content):
        extra.append("表情記法 [xx] が本文に露出")
    if re.search(r"\*\*\*[^*]+\*\*\*", content):
        extra.append("*** が未変換")
    if title is None:
        extra.append("H1タイトルが見つからない（1行目を # タイトル に）")

    print("\n=== 検証 ===")
    print("validate_blocks:", issues or "OK")
    print("追加チェック  :", extra or "OK")
    print(f"タイトル: {title}")
    print(f"画像ブロック: {content.count('<!-- wp:image')}  表  : {content.count('<!-- wp:table')}  "
          f"見出し: {content.count('wp:heading')//2}  本文長: {len(content)}字")

    eyecatch_id = media.get(eyecatch, (0, None))[0] if eyecatch else 0

    if not args.publish:
        out = md_path.parent / f"{args.slug}_blocks_preview.html"
        out.write_text(content, encoding="utf-8")
        print(f"\n[DRY-RUN] 投稿しません。ブロックHTMLを {out.name} に出力。実投稿は --publish を付与。")
        return

    if issues or extra:
        sys.exit("\n❌ 検証エラーがあるため投稿中止。")

    payload = {"title": title, "content": content, "status": args.status}
    if not args.update:
        payload["slug"] = args.slug
    if cats:
        payload["categories"] = cats
    if eyecatch_id:
        payload["featured_media"] = eyecatch_id
    if args.excerpt:
        payload["excerpt"] = args.excerpt

    res = wp_post(base, u, p, payload, post_id=args.update)
    print(f"\n✅ {'更新' if args.update else '投稿'}完了: post_id={res['id']}  status={res.get('status')}")
    print(f"   URL: {res.get('link')}")

    # md の画像URLをWP URLへ書換（任意）
    if args.rewrite_md and args.publish:
        new = md_text
        for fn, (mid, src) in media.items():
            if src:
                new = re.sub(r"(!\[[^\]]*\]\()([^)]*" + re.escape(fn) + r")(\))",
                             lambda m: m.group(1) + src + m.group(3), new)
        md_path.write_text(new, encoding="utf-8")
        print("   ✍ 記事mdの画像URLをWP URLへ更新しました")


if __name__ == "__main__":
    main()
