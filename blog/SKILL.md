# ブログ部門 SKILL.md
# 「生産技術ガジェット研究所」運営スキル

## 自己改善ループ（CLAUDE.mdに準拠）
タスク完了のたびに振り返りレポートを出力し、SKILL.mdとMEMORY.mdを更新し続ける。

### 記事修正からの学習（3段昇格・2026-05-31新設）
記事を修正したら **必ず `edit_logger.py` で生ログを残す**（git diff だけでは「なぜ直したか」が残らないため）。
```
python3 blog/scripts/edit_logger.py --slug <slug> --reason "<理由>" --learning "<学び>" --tag <種別>
```
- ① 生ログ = `blog/edits/_log.md`（粒度細かい）
- ② 同じ種別タグが2回以上 → `blog/MEMORY.md`「失敗パターン」表 or「進化ログ」へ昇格（edit_logger が警告を出す）
- ③ 全社普遍ルール → `CLAUDE.md` / 本SKILL.md へ昇格
- 昇格済みルールは `~/.claude/projects/.../memory/feedback_blog.md`（執筆前に参照）

### ローカルプレビュー（実物を見ながら修正・2026-05-31新設）
記事の見た目（吹き出し・水色下線・ROIテーブル・画像）を本番JIN:R風に即確認できる。
```
python3 blog/scripts/preview_server.py   # → http://localhost:8794/preview/<slug>
```
mdを直してブラウザ自動リロード（WP往復なし）。装飾修正・画像配置の確認に使う。

---

## 🔁 記事推敲→公開の標準ルーチン（2026-06-02 確立・公開前必須）

「素材集めから本番公開まで」一気通貫の標準フロー。新記事・既存記事の改稿どちらにも適用する。

```
《準備フェーズ：記事めし》
⓪-a 素材収集(撮影/スクショ) → ⓪-b PROMPT.md生成 → ⓪-c context.md化
《制作フェーズ》
①執筆 → ②プレビュー起動 → ③画面を見ながら推敲 → ④事実確認 → ⑤修正ログ
→ ⑥アフィリリンク → ⑦ドライラン点検 → ⑧本番反映 → ⑨本番検証 → ⑩仕上げ
```

| # | 工程 | 具体アクション |
|---|---|---|
| ⓪-a | レビュー画像づくり（記事の土台＝素材） | 記事の土台となる**編集済みレビュー画像**（撮影写真をトリミング/背景クリーンアップ/注釈したもの・スクショ等）を用意し、記事めしPWA（`blog-capture.pages.dev`）でGoogle Driveフォルダにアップロード。クリップボード貼付/ドラッグ&ドロップ対応。**ユーザーがブラウザで行う作業**（Claude in Chrome領域）。この画像群が記事の「画像の土台」になる |
| ⓪-b | 伝えたいこと＝記事の骨子・流れ（PROMPT.md） | PWAで「記事タイプ」＋「読者に伝えたいポイント（＝記事でポイントになること・話の流れ／優先度順）」を入力 → Driveの画像フォルダに `PROMPT.md` が自動生成される。これが**記事の骨子（伝えたいこと・流れ）の土台**になる |
| ⓪-c | context.md化（執筆セッション） | `python3 blog/scripts/article_from_meshi.py --folder-id <Driveフォルダid> --slug <slug>` → PROMPT.md取得＋画像を役割タグ(eyecatch/hero/section/product/diagram/compare/ngsummary)で分類し `articles/{slug}_context.md` を生成。**Claudeはこの context.md を最初に読む** |
| ① | 執筆 | context.md を基にmdを `blog/articles/` に作成。**記事めしメモは「種」、本文は深掘り**（MEMORY「記事めしメモは種」原則：各ポイントを仕組み/数値/理論/反論先回り/実体験で800〜1500字に展開）。前回記事スタイル踏襲・ROI table/キャラ対話/金額換算は必須 |
| ② | プレビュー起動 | `python3 blog/scripts/preview_server.py` → Chrome MCPで `http://localhost:8794/preview/<slug>` を開く（Claudeも同画面を見る） |
| ③ | 推敲ループ | ユーザーが画面を見て指示 → Claudeがmd修正 → 1.5秒で自動リロード。気が済むまで往復 |
| ④ | 事実確認 | スペック・価格・設定範囲・対応規格は**公式 or 実機アプリで裏取り**。シリーズ品はモデルごと確認（例：ロックLiteはセンサー非搭載・タイマー式）。実機所有ユーザーの入力は正とする |
| ⑤ | 修正ログ | 修正のたびに `edit_logger.py --slug --reason --learning --tag`。同タグ2回で MEMORY/`feedback_blog.md` へ昇格 |
| ⑥ | アフィリリンク | ASINを商品ページで特定→URLに `?tag=gp6sk1029-22`（アソシエイトID）→**PR表記（広告を含む旨）必須**。WP公開版は `rel="sponsored nofollow"` 自動付与。純正がAmazonに無い消耗品は信頼ブランドで代替（ユーザー選択） |
| ⑦ | ドライラン点検（**公開前必須**） | `markdown_to_blocks()` で生成し `validate_blocks()`＋grep点検：**表情記法[ニヤ顔]等の露出=0／markdown残骸 `**` =0／`##`残骸=0／アフィリタグ数一致／低画質素材slot不使用**（例：低画質の`新人タナカ ドヤ顔.png`=slot10は使わずニヤ顔=slot9/驚き=slot7を使う） |
| ⑧ | 本番反映 | `WPClient._request("POST", f"/posts/{id}", data={"title","content"})`。**WAFはPOST許可・PUT/DELETE は403**。status は変えない（公開のまま） |
| ⑨ | 本番検証 | `curl https://www.ootanisatan.com/<slug>/` を grep：新タイトル有/旧残骸0/アフィリタグ有/事実修正反映/記法露出0/markdown残骸0 |
| ⑩ | 仕上げ | 記事台帳（MEMORY.md）を ID・URL・公開日・要点で更新 ＋ 振り返りレポート ＋ 完了URLを `🔗` 付きで提示 |

**注意点（実証済み）**：
- 表情記法（`[ニヤ顔]`等）・リンク記法（`[文字](URL)`）は **preview_server.py と wp_block_builder.py の両方** に実装が要る（片方だけだと本番で崩れる）。
- 画質チェックは**サブエージェント＋Pillow/エッジ指標**で（画像をmainで直接Readしない＝2000pxエラー防止）。
- 公開記事の更新は不可逆的影響があるため、⑦ドライランを飛ばさない。

---

## クイックリファレンス（毎回必ず確認）
1. 金額換算セクション必須（全記事）
2. キャラ対話2〜3箇所（オオタニ所長 + タナカ）
3. WPブロックは wp_block_builder.py 経由（手書きHTML禁止）
4. 価格・スペックはメーカー公式で必ず裏取り
5. 投稿後URLを必ず出力（`🔗 https://...`）
6. **画像は必ず image_resizer.py で2000px以下に**（APIエラー防止）
7. **JIN:R装飾ルール**：最重要強調は `***xxx***`（水色アンダーライン自動付与）。`**xxx**` に数値・日付・単位を含むと自動で水色アンダーライン
8. **前回記事のスタイル踏襲**：執筆前に直前記事のHTMLを取得し、装飾パターン・文体・画像配置を確認（MEMORY.md「前回記事スタイル踏襲チェック」参照）
9. **画像フォルダの `PROMPT.md` を最優先で読む**（記事めしPWAから生成される記事方針メモ）

---

## 📂 ファイル構成（2026-05-24分離・A案）

このスキルは内容ごとに3ファイルに分かれています。タスクに応じて該当ファイルを読み込んでください。

| ファイル | 内容 | 行数 | 読むタイミング |
|---|---|---|---|
| **[blog/skills/writing.md](skills/writing.md)** | §1-6, §14-16（執筆ルール本体）<br>ジャンル・記事構成・評価4軸・**金額換算&ROI table**・導入文・キャラ対話・深み技術・承認フロー・禁止事項 | 約150行 | **記事を書くとき必ず** |
| **[blog/skills/research-publish.md](skills/research-publish.md)** | §7-13（リサーチ・SEO・校正・公開）<br>リサーチルール・SEO・校正チェック・ファクトチェック・WP投稿・SNS連携・アイキャッチ画像 | 約130行 | リサーチ・SEO設計・校正・公開時 |
| **[blog/skills/technical.md](skills/technical.md)** | §0 + §17 + §18（技術運用）<br>**PROMPT.md優先ルール**・JIN:R装飾・wp_block_builder・画像リサイズ・**曖昧復帰プロトコル**・画像蓄積防止・使用スクリプト・UI実装の鉄則 | 約180行 | PWA連携・WP API操作・画像処理・固定ページ更新時 |

### 推奨：作業タイプ別の読み込みパターン

| タスク | 読むファイル |
|---|---|
| 通常の記事執筆 | `writing.md` + `technical.md`（PROMPT.md確認のため） |
| 公開前チェック・校正 | `writing.md`（ROI table）+ `research-publish.md` |
| WP固定ページ作成・装飾修正 | `technical.md`（必須）|
| 過去記事を編集したい | `technical.md`（曖昧復帰プロトコル）|
| 新規企画・SEO設計 | `research-publish.md` |

---

## 工程フロー
```
1.リサーチ → 2.SEO設計 → 3.執筆 → 4.校正 → 5.事実検証 → 6.投稿 → 7.分析
```
各工程の「入力→出力→完了条件」は該当 skills/ ファイル冒頭に明記。

---

## 分離トリガー（定量ルール）
- 1ファイルが200行を超えた → 独立ファイルに分離検討
- 同じセクションの改善が月5回以上 → 分離検討
- 記事10本完了 → Phase 2移行（必要な工程をさらに独立ファイルに）

---

## 関連リソース

- **学習・記憶**: [blog/MEMORY.md](MEMORY.md) — 過去の成功・失敗パターン、記事台帳
- **記事原稿**: `blog/articles/`
- **画像素材**: `blog/images/`
- **スクリプト**: `blog/scripts/`（`image_resizer.py`, `wp_api.py`, `article_status.py` 等）
- **PWA**: `blog/pwa-cloudflare/`（記事めしPWA）
- **GAS連携**: `blog/apps-script/blog-capture/`

---

## ⚠️ スキルの正版宣言（CLAUDE.md準拠・2026-05-24）

このリポジトリ内の `blog/SKILL.md` および `blog/skills/*.md` が **生産技術ガジェット研究所スキルの唯一の正版**です。

過去に `~/.claude/skills/seisan-gijutsu-blog/` と Claude.ai Webの個人スキルにも同名スキルが存在しましたが、内容が古く時給設定（旧2,000円→新950円）等で矛盾を起こしていたため、両方とも廃止しました。

**再びWebやCLIグローバルにアップロードしないこと**。記事執筆時はこのリポジトリのファイルのみを参照してください。
