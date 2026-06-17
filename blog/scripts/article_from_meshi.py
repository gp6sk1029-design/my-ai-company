#!/usr/bin/env python3
"""記事めし(PWA)で蓄積したフォルダから、記事執筆コンテキストを抽出するスクリプト。

主な機能：
  1. GAS API でメモ(PROMPT.md)を取得
  2. Drive フォルダ内画像を役割タグ(eyecatch_ hero_ section_ product_ diagram_ compare_ ngsummary_)で分類
  3. 既存記事 markdown(articles/*.md) との対応有無を判定
  4. 記事執筆コンテキストを 1 ファイルに集約 → `articles/{slug}_context.md` に出力
  5. Claude/AI はこの context.md だけを読めば 記事の事実情報・役割画像・メモポイント を一気に把握できる

使い方:
  python3 blog/scripts/article_from_meshi.py --folder-id 16vY7GK9Dp1HNOtPA4CUn2TvYEpohzLPA
  python3 blog/scripts/article_from_meshi.py --folder-id <fid> --slug switchbot-lock-lite-review

出力例:
  blog/articles/switchbot-lock-lite-review_context.md
"""

import argparse
import base64
import json
import sys
import re
import urllib.request
import urllib.parse
from pathlib import Path
from typing import Optional


# ─── GAS 設定 ─────────────────────
# blog/config.json から読み込み（PWA と同じ設定を流用）
def load_gas_config() -> tuple[str, str]:
    cfg_path = Path(__file__).resolve().parent.parent / 'pwa-cloudflare' / 'config.js'
    if not cfg_path.exists():
        # フォールバック: ハードコード（緊急時のみ）
        return (
            'https://script.google.com/macros/s/AKfycby9BSLfRFE_oxx3xi0wez1qD_crpTu6xc6gd5MI0OYa9dwycX2LuIoRD9NklcgOjTSm9g/exec',
            'NP99L5IGacCx9N8JO7V0769HOVckd-tF',
        )
    text = cfg_path.read_text(encoding='utf-8')
    gas_url_m = re.search(r"GAS_URL\s*:\s*'([^']+)'", text)
    token_m = re.search(r"SHARED_TOKEN\s*:\s*'([^']+)'", text)
    if not gas_url_m or not token_m:
        raise RuntimeError('GAS_URL / SHARED_TOKEN を pwa-cloudflare/config.js から取得できませんでした')
    return gas_url_m.group(1), token_m.group(1)


GAS_URL, TOKEN = load_gas_config()


# ─── 役割タグ定義（PWA app.js の ROLE_DEFS と同期） ─────────
ROLE_DEFS = [
    ('eyecatch_',  '⭐ アイキャッチ',   'featured_media に紐付け。記事のメインビジュアル'),
    ('hero_',      '🎯 ヒーローバナー',  '冒頭の大型ビジュアル'),
    ('section_',   '📑 セクション画像',  '各 H2 の冒頭に配置可'),
    ('product_',   '📸 商品/実機写真',  '「とは」セクション・スペック表近辺'),
    ('diagram_',   '📐 図解/フロー図',   '概念図・フロー図・ROI流れ図'),
    ('comparetable_', '📊 比較表(完成)',  'AIで生成した比較表の完成版。比較セクションのメインビジュアル'),
    ('compare_',   '⚖️ 比較/Before-After', '比較セクションで使用（製品ごとの素材写真）'),
    ('ngsummary_', '⚠️ NG集サマリ',     'やってはいけない設定のサマリ図'),
]


def gas_get(action: str, **params) -> dict:
    """GAS GET 呼び出し（リダイレクト追従）"""
    params['action'] = action
    params['token'] = TOKEN
    url = GAS_URL + '?' + urllib.parse.urlencode(params)
    req = urllib.request.Request(url)
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read().decode('utf-8'))


def download_image_to_local(file_id: str, local_path: Path) -> bool:
    """GAS downloadFile で画像本体を取得してローカルに保存"""
    try:
        res = gas_get('downloadFile', fileId=file_id)
        if not res.get('ok'):
            print(f'⚠️ downloadFile 失敗: fileId={file_id} {res.get("message")}', file=sys.stderr)
            return False
        b64 = res.get('dataBase64', '')
        if not b64:
            return False
        local_path.parent.mkdir(parents=True, exist_ok=True)
        local_path.write_bytes(base64.b64decode(b64))
        return True
    except Exception as e:
        print(f'⚠️ 画像DL例外: {e}', file=sys.stderr)
        return False


def categorize_file(name: str) -> tuple[str, str]:
    """ファイル名から役割を判定 → (役割ラベル, 接頭辞)"""
    low = name.lower()
    for prefix, label, _ in ROLE_DEFS:
        if low.startswith(prefix):
            return label, prefix
    return 'その他', ''


def slugify(name: str) -> str:
    """フォルダ名から推奨スラッグ生成（粗い：英数のみ・ハイフン）"""
    base = re.sub(r'^【記事】', '', name).strip()
    # 英字部分があれば抜き出す
    en_chunks = re.findall(r'[a-zA-Z0-9]+', base)
    if en_chunks:
        return '-'.join(en_chunks).lower()
    return 'article-' + re.sub(r'\W+', '-', base.lower())[:30].strip('-')


def build_context(folder_id: str, slug_override: Optional[str] = None,
                  download_images: bool = False) -> tuple[str, str]:
    """コンテキストMarkdown文字列とスラッグを返す"""
    prompt_res = gas_get('getPrompt', articleFolderId=folder_id)
    files_res = gas_get('listArticleFiles', articleFolderId=folder_id)

    if not prompt_res.get('ok'):
        raise RuntimeError(f'getPrompt 失敗: {prompt_res.get("message")}')
    if not files_res.get('ok'):
        raise RuntimeError(f'listArticleFiles 失敗: {files_res.get("message")}')

    article_type = prompt_res.get('articleType', '')
    memos = prompt_res.get('memos', [])
    raw_prompt = prompt_res.get('raw', '')
    files = files_res.get('files', [])

    # フォルダ名は raw_prompt から抜くか、無ければファイルメタから別途取得
    folder_name_m = re.search(r'記事フォルダ:\s*(.+)', raw_prompt)
    folder_name = folder_name_m.group(1).strip() if folder_name_m else '(不明)'

    # スラッグ
    slug = slug_override or slugify(folder_name)

    # 役割ごとに画像をグループ化
    by_role: dict[str, list] = {label: [] for _, label, _ in ROLE_DEFS}
    other = []
    for f in files:
        label, prefix = categorize_file(f['name'])
        if prefix:
            by_role[label].append(f)
        else:
            other.append(f)

    # 既存 articles/{slug}.md があるか
    articles_dir = Path(__file__).resolve().parent.parent / 'articles'
    existing_md = articles_dir / f'{slug}.md'
    existing_status = '✅ 既存 (上書き編集向き)' if existing_md.exists() else '🆕 未作成'

    # ─── Markdown 出力組立 ─────
    out = []
    out.append(f'# 記事執筆コンテキスト: {folder_name}\n')
    out.append('> このファイルは `blog/scripts/article_from_meshi.py` が生成した、')
    out.append('> 記事めし(PWA)に登録されたメモ・画像・役割タグを集約した執筆コンテキスト。')
    out.append('> Claude/AI はこの 1 ファイルを参照して記事を書く。\n')
    out.append(f'**Drive フォルダ ID**: `{folder_id}`')
    out.append(f'**フォルダ名**: {folder_name}')
    out.append(f'**推奨スラッグ**: `{slug}`')
    out.append(f'**既存記事の状態**: {existing_status}')
    if existing_md.exists():
        out.append(f'**既存記事ファイル**: `blog/articles/{slug}.md`')
    out.append('')
    out.append('---\n')

    # メモ
    out.append('## 📝 記事メモ（執筆指示・PROMPT.md より）\n')
    out.append(f'**記事タイプ**: {article_type or "(未設定)"}\n')
    if memos:
        out.append('**読者に伝えたいポイント（優先度順／1番目が最重要）**:\n')
        for i, m in enumerate(memos, 1):
            out.append(f'{i}. {m}')
        out.append('')
        out.append('### ⚠️ メモの扱い方（最重要）\n')
        out.append('上記メモは **筆者が読者に伝えたい「テーマ・種」** であって、**そのまま記事にしてはいけない**。')
        out.append('読者の納得を得るために、各ポイントを以下の角度から **深掘り** すること：\n')
        out.append('- **物理メカニズム／仕組み**：「なぜそうなるか」を構造レベルで説明（モーター駆動・センサー検知・規格寸法 等）')
        out.append('- **数値根拠**：実測値・統計・メーカー公称値・警察庁データ・心理学研究値 を必ず添える')
        out.append('- **心理学・人間工学・生産技術原則**：ツァイガルニク効果／注意リソース／確認工程の冗長性 等の理論で裏付け')
        out.append('- **反論への先回り**：読者が抱きそうな疑問（「重力で落ちない?」「電池切れたら?」「賃貸退去時は?」）を先取りで論破')
        out.append('- **実体験・失敗談**：筆者の試行錯誤・つまづきポイントを具体的に挿入（信頼性UP）')
        out.append('- **競合・代替案との比較**：他のスマートロック／物理鍵運用 との明確な差分')
        out.append('- **対象読者の解像度UP**：「賃貸4人家族」「在宅ワーカー」「子育て世代」 等、誰のどの悩みを解くか具体化\n')
        out.append('読者の反応が **「ふーん」→ ❌** ではなく **「なるほど、買おう」→ ✅** になるレベルを目指す。')
        out.append('メモの一文 → そのまま記事の一段落 とは絶対にしない。')
        out.append('メモの一文 → **800〜1500字相当のセクション（数値・理論・実体験・反論先回りを含む）** に展開する。\n')
    else:
        out.append('（メモなし）')
    out.append('')
    out.append('---\n')

    # 役割別画像（オプション：ローカルDLしてClaudeのReadで内容確認できるようにする）
    articles_dir_local = Path(__file__).resolve().parent.parent / 'articles'
    images_local_dir = articles_dir_local / f'{slug}_images'
    out.append('## 🖼 画像一覧（役割別）\n')
    out.append(f'**画像総数**: {len(files)} 枚\n')
    if download_images:
        out.append(f'**ローカルDL先**: `blog/articles/{slug}_images/`')
        out.append('> Claude は下記のローカルパスを `Read` ツールで読み込んで画像内容を確認すること。\n')
    has_role_image = False
    dl_count = 0
    for prefix, label, usage in ROLE_DEFS:
        items = by_role.get(label, [])
        if not items:
            continue
        has_role_image = True
        out.append(f'### {label}  （{len(items)}枚）')
        out.append(f'> 用途: {usage}')
        for f in items:
            local_rel = ''
            if download_images:
                local_path = images_local_dir / f['name']
                if not local_path.exists():
                    print(f'  📥 DL中: {f["name"]} ...', file=sys.stderr)
                    if download_image_to_local(f['id'], local_path):
                        dl_count += 1
                if local_path.exists():
                    local_rel = f'blog/articles/{slug}_images/{f["name"]}'
            out.append(f'- `{f["name"]}`  fileId: `{f["id"]}`  '
                       f'({round(f["size"] / 1024)}KB · {f["modifiedTime"][:10]})')
            if local_rel:
                out.append(f'  - **ローカル**: `{local_rel}`  ← Claude はこのパスを `Read` ツールで開いて内容確認')
            out.append(f'  - サムネ: <{f["thumbnailUrl"]}>')
        out.append('')
    if download_images and dl_count > 0:
        print(f'✅ 役割タグ付き画像 {dl_count}枚 をローカルにDL完了', file=sys.stderr)
    if not has_role_image:
        out.append('⚠️ 役割タグ付き画像なし。PWA で⭐/🎯/📑/📸/📐/⚖️/⚠️ ボタンで分類すると、ここに整理されて表示されます。\n')

    if other:
        out.append(f'### 未分類画像 ({len(other)}枚)')
        out.append('> 役割タグ未設定。記事内で使うなら役割を割り当ててください。')
        out.append('<details><summary>クリックで展開</summary>\n')
        for f in other[:50]:
            out.append(f'- `{f["name"]}` fileId: `{f["id"]}` ({round(f["size"] / 1024)}KB)')
            out.append(f'  - サムネ: <{f["thumbnailUrl"]}>')
        if len(other) > 50:
            out.append(f'... 他 {len(other) - 50} 件')
        out.append('\n</details>\n')

    out.append('---\n')

    # 執筆チェックリスト
    out.append('## ✅ 執筆チェックリスト\n')
    out.append('Claude/AI は以下を必ず満たして記事化すること：\n')
    out.append('- [ ] **タイトル**: 上記メモ ポイント1 を主訴求に組み込む（コピペではなく訴求力のある言い回しに）')
    out.append('- [ ] **冒頭サマリ**: 「🏆 急いでいる人へ」3行サマリ（メモ4ポイント抽出を **抽象度を落として** 具体的数値に変換）')
    out.append('- [ ] **本文構成**: メモのポイントを優先度順に H2 セクション化、**各セクション 800〜1500字** で深掘り')
    out.append('- [ ] **各セクションで必ず含める要素**：')
    out.append('    - 数値（実測 or メーカー公称 or 統計）')
    out.append('    - 物理メカニズム or 心理学/人間工学理論')
    out.append('    - 反論への先回り（読者の疑問1〜2個を予想して論破）')
    out.append('    - 筆者の実体験／失敗談／試行錯誤（信頼感UP）')
    out.append('- [ ] **キャラ対話 ×3**: オオタニ所長×タナカ（`**タナカ[表情]：** 「...」`形式 + 発話間に空行）')
    out.append('    - タナカ役：読者代表として疑問・誤解を発する')
    out.append('    - オオタニ所長役：生産技術の知見から構造的に答える')
    out.append('- [ ] **📐 ROI 計算**: 時給950円基準・1日コスト/節約価値/損益分岐/累計純利益のテーブル + 計算根拠の段落')
    out.append('- [ ] **デメリット・注意点 セクション**: 公平性確保のため必ず1セクション（対策付き）')
    out.append('- [ ] **アイキャッチ**: 上記 ⭐ アイキャッチ画像を featured_media に設定')
    out.append('- [ ] **画像配置**: 各セクションに役割マップ通り埋め込み')
    out.append('- [ ] **WP 公開**: カテゴリ複数 / 英字スラッグ / メタ説明\n')
    out.append('### ❌ やってはいけないこと\n')
    out.append('- メモの一文 → 記事の一段落（薄い記事になる）')
    out.append('- 数値・理論・実体験のいずれも書かない抽象的な美辞麗句のみ')
    out.append('- メモ4ポイントを列挙して終わる箇条書き記事')
    out.append('- 読後感が「ふーん」止まりの納得感の薄い構成')
    out.append('')
    out.append('---\n')

    # 参照リンク
    out.append('## 🔗 関連リンク\n')
    out.append('- ブログSKILL: `blog/SKILL.md`')
    out.append('- 過去記事例: `blog/articles/mx-ergo-s-settings-guide.md` / `keychron-k1max-jis-setup-guide.md`')
    out.append('- WP投稿スクリプト: `blog/scripts/wp_block_builder.py` + `wp_api.py`')
    out.append('')

    return '\n'.join(out), slug


def main():
    p = argparse.ArgumentParser(description='記事めしフォルダから執筆コンテキストを抽出')
    p.add_argument('--folder-id', '-f', required=True, help='Drive フォルダ ID（記事めしで使用中の記事フォルダ）')
    p.add_argument('--slug', '-s', help='出力スラッグ（省略時はフォルダ名から自動推定）')
    p.add_argument('--stdout', action='store_true', help='ファイルではなく標準出力へ')
    p.add_argument('--download-images', '--dl', action='store_true',
                   help='役割タグ付き画像をローカルDL（Claude が Read で内容確認可能に）')
    args = p.parse_args()

    md, slug = build_context(args.folder_id, args.slug, download_images=args.download_images)
    if args.stdout:
        print(md)
        return

    out_path = Path(__file__).resolve().parent.parent / 'articles' / f'{slug}_context.md'
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(md, encoding='utf-8')
    print(f'✅ 執筆コンテキスト出力: {out_path}')
    print(f'   推奨スラッグ: {slug}')
    print(f'   既存記事: {"あり (上書き編集)" if (out_path.parent / f"{slug}.md").exists() else "なし (新規作成)"}')
    print('')
    print('次の一手:')
    print(f'  Claude に「{out_path.name} を読んで記事を書いて」と依頼')


if __name__ == '__main__':
    main()
