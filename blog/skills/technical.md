# ブログ 技術運用ルール
# PROMPT.md連携・JIN:R装飾・WP API・画像処理・UI実装

> ⚠️ このファイルは **技術運用・スクリプト・実装ノウハウ** です。
> 全体像・クイックリファレンスは [blog/SKILL.md](../SKILL.md) を参照。
> 執筆ルール（構成・キャラ・金額換算）は [blog/skills/writing.md](writing.md) を参照。
> リサーチ・SEO・校正・公開フローは [blog/skills/research-publish.md](research-publish.md) を参照。

---

## §0. PROMPT.md 優先ルール（最重要）

記事めしPWA（`blog/pwa-cloudflare/`）で写真をアップロードする際、フォルダ内に `PROMPT.md` が生成されることがある。これはユーザーが事前に「記事タイプ」と「読者に伝えたいポイント（優先度順）」を指定したメモであり、**記事執筆の方針を最上位で規定する**。

### 実行フロー（記事執筆前に必ず）
1. 画像フォルダ（Drive上の `【記事】〇〇` フォルダ、またはローカル `blog/images/〇〇/`）で `PROMPT.md` の有無を確認
2. **存在する場合**：
   - 「記事タイプ」に応じた構成を優先（レビュー / 商品比較 / ツール紹介 / ユーザー追加型）
   - 「読者に伝えたいポイント」を**優先度順に**記事へ反映：
     - 1番目（最優先）：記事の結論・導入文・タイトル・最重要装飾（`***xxx***`）で必ず言及
     - 2番目：H2見出しの一つとして章立て
     - 3番目以降：本文で触れる
   - writing.md §2の標準構成は**骨格としては維持**するが、章の重み・強調箇所はPROMPT.md優先
3. **存在しない／空の場合**：writing.md §2の標準構成で従来通り執筆

### PROMPT.mdの書式例
```markdown
# 記事作成メモ（AIへの指示）
生成日時: 2026-04-25 12:34
記事フォルダ: 【記事】HUAWEI GT Runner 2

## 記事タイプ
**レビュー**

## 読者に伝えたいポイント（優先度順）
1. ランナー特化機能がGarminより優秀という点
2. Suica非対応は実はマラソン用途では問題ない
3. 価格が3.9万円で競合の半額
```

### 注意点
- PROMPT.mdはユーザーの意図をそのまま反映したメモ。**勝手に解釈を広げない**
- 優先度1番目を忘れるとメモ作成の意味がなくなる → 記事の冒頭200文字以内で必ず触れる
- 記事タイプが「商品比較」なら比較表を必ず含める等、タイプ固有の構成要素を機械的に付与

### 関連エンドポイント（GAS／PWAから利用）
- `POST action=savePrompt` — articleType と memosJson(JSON配列) を渡して PROMPT.md を生成（既存は上書き）
- `GET  action=getPrompt&articleFolderId=xxx` — 既存 PROMPT.md をパースして articleType と memos を返却（再撮影時にPWAが自動復元）

---

## JIN:R装飾の使い分けガイド

| 書き方（Markdown） | 出力 | 用途 |
|---|---|---|
| `***キーワード***` | 水色下線付き太字 | 最重要：結論・パンチライン |
| `**54,780円**` | 水色下線付き太字（自動） | 数値・金額・日付・単位（自動検出） |
| `**ただの強調**` | 普通の太字 | 一般的な太字 |
| `*イタリック*` | 斜体 | 控えめな強調 |

**自動検出トリガー**（**xxx** 内にこれらがあると水色下線化）: `0-9` `０-９` `¥ 円 ％ % 日 分 時間 週 月 年 kg g mm cm km nit bpm ms 回 MB GB`

**アンダーライン仕様**：色 `#56CCF2` / 太さ `3px`（2026/05/11に2px→3pxへ強化、視認性向上）

### 🔴【絶対遵守】Markdown 装飾は wp_block_builder 経由必須

固定ページ・投稿の content を直接 HTML で WP API に POST するときも、**`***xxx***` `**xxx**` `*xxx*` の Markdown 記法は使わない**。生のアスタリスクが画面に表示される事故が起きる。

#### 必須運用
- **記事執筆**：Markdown ファイル → `markdown_to_blocks()` で変換 → POST（既存フロー、安全）
- **固定ページ作成・更新**：Markdown を含めるなら必ず `markdown_to_blocks()` を経由するか、`md_to_html_inline()` で前処理
- **HTML 直書き時**：`<strong><span style="text-decoration:underline;text-decoration-color:#56CCF2;text-decoration-thickness:3px;">xxx</span></strong>` を使用

#### 公開前必須チェック（自動化推奨）
```python
# 公開前にコンテンツに `*` が残っていないか検証
import re
assert not re.search(r'\*\*\*[^*]+\*\*\*', content), 'Markdown残骸: ***xxx*** が未変換'
assert not re.search(r'\*\*[^*<>]+\*\*', content), 'Markdown残骸: **xxx** が未変換'
```

---

## 画像リサイズ必須ルール
```bash
# 新しい画像を扱う前に必ず実行
python3 blog/scripts/image_resizer.py <画像パス or フォルダ>
```

- Claude API多数画像モードは**2000px以下必須**
- デフォルト上限1800px（200pxマージン）
- 長辺基準でアスペクト比保持

---

## 📚 曖昧復帰プロトコル（情報が不完全でも記事を特定できる）

過去記事を編集したいが、ファイル名・WP投稿ID・正確なタイトルを覚えていないケースへの対応。

### 復帰の入口：ユーザーは「覚えている断片」だけ伝えればOK
```
「HUAWEIの記事を修正したい」
「ガジェットレビューで最近書いたやつ」
「ランナー向けのスマートウォッチの記事」
```

### Claudeの動作フロー
```
1. article_status.py で曖昧検索
   python3 blog/scripts/article_status.py <キーワード>

2. 候補が1件 → 詳細取得 --detail で全情報表示
3. 候補が複数 → ユーザーに選択肢提示
4. 候補が0件 → 新規記事と判断、または別キーワードで再検索

5. 特定したら articles/xxx.md を Read（画像は読まない）
6. blog/MEMORY.md の記事台帳を参照（WP投稿ID・URL取得）
7. SKILL.mdルールに従って編集
```

### 必須ツール
- `blog/scripts/article_status.py` — 記事曖昧検索（ローカル + WP統合）
- `blog/scripts/wp_api.py` — WordPress REST APIクライアント
- 使い方：
  ```bash
  # ローカル検索のみ（認証不要）
  python3 blog/scripts/article_status.py              # 全記事一覧
  python3 blog/scripts/article_status.py huawei       # 部分一致検索
  python3 blog/scripts/article_status.py ガーミン     # 日本語OK
  python3 blog/scripts/article_status.py xxx --detail # 詳細+復帰コマンド

  # WP連携（認証設定後）
  python3 blog/scripts/article_status.py huawei --with-wp   # WP投稿ID・URL・状態を自動取得
  python3 blog/scripts/article_status.py --sync-registry    # MEMORY.md台帳を自動更新

  # WP単体操作
  python3 blog/scripts/wp_api.py list                 # WP全記事一覧
  python3 blog/scripts/wp_api.py find HUAWEI          # WPでタイトル検索
  python3 blog/scripts/wp_api.py get 703              # 投稿ID指定取得
  ```

### WP認証情報の設定（初回のみ）
`blog/config.json` に以下を追加（`.gitignore` 済みでGitに上がらない）：
```json
"wp_auth": {
  "username": "WordPressユーザー名",
  "application_password": "xxxx xxxx xxxx xxxx xxxx xxxx"
}
```
Application Password の生成：WP管理画面 → ユーザー → プロフィール → アプリケーションパスワード

### 記事台帳（MEMORY.md）のメンテナンス
- **自動メンテナンス推奨**：`python3 blog/scripts/article_status.py --sync-registry` を定期実行
  - WP上の公開状態・URL・投稿IDを一括取得 → 台帳に反映
  - 週次ルーチンに組み込むと常に最新状態
- 手動追記も可能：新規公開時に1行追加
- **ID忘れても大丈夫**：article_status.py が曖昧検索で特定できる

---

## 🚨 画像の会話蓄積を防ぐ運用ルール（2000pxエラー根本対策）

**Readツールで画像ファイル（.png/.jpg）を直接読まない**。読むと会話履歴に埋め込まれ蓄積する。

### 正しい画像の扱い方
| ケース | やり方 |
|---|---|
| 商品の外観を把握したい | サブエージェント（Explore/general-purpose）に分析を委譲し、**テキスト要約だけ**受け取る |
| 記事に画像を配置したい | パス文字列で指示（例：「blog/images/xxx.png をH2直後に」）。Claudeに画像を読ませない |
| どうしても確認が必要 | 1枚だけ Read → 確認後 `/compact` で履歴を圧縮 |
| 画像が大量にあるプロジェクト | **1記事＝1セッション**を徹底。記事終わったら新セッション |

### 会話内の画像枚数が10枚を超えたら即 `/compact`
- Readで読んだ画像 + 添付画像 = 10枚で危険ゾーン
- `/compact` で履歴要約され画像が除外される（セッションは継続可）

### サブエージェント活用パターン（推奨）
```
「blog/images/huawei/ 内の商品画像を分析して、
 記事に使える視覚的特徴をテキストで3つ挙げて。
 Explore エージェントに委譲してほしい」
```
→ 画像はサブエージェント内に閉じ、メインには文字情報だけ返る

---

## §17. 使用スクリプト

- `blog/scripts/publish_article.py` — **新規記事の公開ツール（正式）**。画像アップ→wp:image化→`markdown_to_blocks`→`validate_blocks`→POST を一括。デフォルトはドライラン、実投稿は `--publish`。（`run_pipeline.py` は中身が空のため使わない）
- `blog/scripts/wp_api.py` — WordPress REST API（一覧/取得/検索・更新は `_request("POST", "/posts/<id>", …)`）
- `blog/scripts/wp_block_builder.py` — WordPress ブロックビルダー（`markdown_to_blocks` / `validate_blocks` / 吹き出し）
- `blog/scripts/image_resizer.py` — 画像リサイズ（公開前必須・長辺1800px以下）
- `blog/scripts/article_from_meshi.py` — 記事めしDriveフォルダ→執筆コンテキスト(context.md)＋役割画像DL
- `blog/scripts/article_status.py` — 記事曖昧検索（ローカル + WP統合）
- `blog/scripts/preview_server.py` — ローカルプレビュー（本番JIN:R風・自動リロード / 画像は `/assets/` 配信）
- `blog/scripts/update_home_cards.py` — **ホーム（固定ページ756）の「注目の記事」「最新の記事」カードを最新公開記事から自動生成して同期**。ホームは手組み静的HTMLで新記事が自動では出ないため、公開のたびに更新が必要。`publish_article.py` が公開成功時に自動で呼ぶ（`--skip-home` で抑止）。単体実行 `python3 blog/scripts/update_home_cards.py`（`--dry-run` で確認のみ）。注目=先頭3件・最新=先頭5件、カテゴリ→タグ名/色は同スクリプトの `CATEGORY_TAG` で対応

### publish_article.py の使い方（新規記事公開の標準）
```bash
# ① ドライラン（検証のみ・投稿しない）— 公開前必須
python3 blog/scripts/publish_article.py --slug <slug> --categories 1,5
# ② 実際に公開（アイキャッチは images-dir の eyecatch* を自動でfeatured化＆本文から除去）
python3 blog/scripts/publish_article.py --slug <slug> --categories 1,5 \
    --excerpt "メタ説明…" --publish --status publish --rewrite-md
# 既存記事の本文更新（新規作成でなく上書き）
python3 blog/scripts/publish_article.py --slug <slug> --update <post_id> --publish
```
- 記事の書式前提：1行目 `# タイトル`（H1→投稿タイトル・本文からは除去）／本文画像は `![alt](…/ファイル名.jpg)`（**ファイル名**が `blog/articles/<slug>_images/` の実ファイルと一致すればアップ対象）／アイキャッチは `eyecatch*` 命名 or `--eyecatch`。
- カテゴリID：ガジェット研究室=1／時短ツール研究室=6／暮らしハック研究室=5／生産技術研究室=4。
- `--rewrite-md`：公開後、記事mdの画像URLをWPのURLに書き換え（md＝本番と一致させる）。

---

## §18. 🔴【絶対遵守】UI機能追加・修正時の鉄則（2026/05/09 制定）

### モーダル・トグル等のインタラクション機能：CSSパターンの選択
- ❌ **`:target` 擬似クラスは使わない**（iOS Safari の既知バグで対象要素が `display:none` だとハッシュ更新されない／初回ペイントで反映遅延）
- ✅ **チェックボックスハック必須**：`<input type="checkbox" id="x" hidden>` + `<label for="x">` + `#x:checked ~ .target { display: flex }`
  - HTML標準動作なので全モバイルブラウザ100%動作
  - checkbox / トリガーlabel / 対象要素は **同一親の siblings として配置**

### CSS追加先のルール（出所を分散させない）
- ✅ **CSS は Customizer の `custom_css[jinr]` theme_mod に集約**（ConoHa WAFも通る）
- ❌ **sidebar widget に `<style>` を入れない**（POST が403で弾かれる + 出所が分散して「片方更新忘れ」事故が起きる）
- HTMLは widget または post_content に置き、CSSは絶対に theme_mod に集約

### 機能追加・修正後の必須検証工程（省略禁止）
1. **HTML到達確認**：`curl -A "Mozilla/5.0 (iPhone)" "<URL>" | grep <識別子>` でモバイルUAでも配信されているか確認
2. **CSS到達確認**：上記 curl 出力に新CSSルールが含まれるか
3. **`document.styleSheets` 全列挙**：同じセレクタが**複数のシートに存在しないか**を必ずチェック（古い widget の旧CSSが残って後勝ちで上書き、というバグを防ぐ）
4. **`getComputedStyle` で初期状態と動作後状態の両方を計測**：matches(':target')/'(:checked)' が true でも getComputedStyle が反映されていない場合は specificity 競合を疑う
5. **モバイルUA + モバイル幅でも動作確認**：PC幅で動いた = モバイルで動く ではない（iOS固有バグが頻発）

### 「動いた」と報告する前のチェックリスト
- [ ] 実機モバイル（or モバイルUA + モバイル幅）でgetComputedStyleが期待値と一致
- [ ] 同セレクタの重複ルールがないか document.styleSheets で確認
- [ ] HTML/CSS の出所が同じ Customizer または同じ widget に集約されているか
- [ ] curl で実際の配信HTMLに新CSSが含まれているか

**禁止：「PC幅で動いた」を「動いた」と報告すること**。スマホで動かなければ未完成。
