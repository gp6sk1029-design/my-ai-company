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
