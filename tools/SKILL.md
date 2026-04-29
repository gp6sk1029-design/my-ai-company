---
name: ツール・アプリ作成部門
description: PWA・自動化ツール・SaaS連携を作るときに使うスキル。Cloudflare Workers + D1 + Cloudflare Access の固定構成で、APIキーを環境変数化し、安全かつ再現性高くツールを開発する。EC（メルカリ自動化）、献立くん、ライフプランくん、新規ツール全般を担当。
type: skill
---

# ツール・アプリ作成部門 SKILL.md

## このスキルの役割
ユーザーから「PWAを作って」「ツール作って」「自動化したい」という依頼が来たときに起動する。
個別ツールの開発（EC・献立・ライフプラン・新規）はすべてこの部門が担当する。

---

## 担当範囲

### 既存ツール
| ツール | 場所 | 概要 |
|--------|------|------|
| メルカリ自動化（EC） | `tools/ec/` | 出品・価格計算・在庫管理 |
| 献立くん | `tools/cooking-recipe/` | 料理レシピ献立PWA |
| ライフプランくん | `tools/life-plan/` | 生涯資産管理PWA |

### 新規ツール（今後の対応領域）
- 業務自動化ツール
- 個人向けPWA
- API連携・データ集約ツール
- 各種SaaS連携

---

## 【最重要】開発時の固定構成（変更不可）

インターネットに公開するアプリを作る場合、以下の構成以外は提案しない。
別の構成を使いたい時はユーザーに「エンジニアに相談してから」と答える。

| 領域 | 採用技術 |
|------|---------|
| フレームワーク | Next.js（または静的HTML+Cloudflare Pages） |
| ホスティング | Cloudflare Workers / Pages（フロント・バック両方） |
| DB | Cloudflare D1 データベース |
| 認証 | Cloudflare Access（特定メールアドレスのみ許可） |
| AIモデル | Claude Opus（Sonnet等には切り替えない） |

---

## 絶対にやってはいけないこと

### セキュリティ
- APIキー・パスワード・トークンをソースコードに直接書かない
  → 必ず環境変数（Cloudflare Secrets）に入れる
- 個人情報・会員情報・未公開情報をリポジトリにコミットしない
- 独自のパスワード認証やメール認証を実装しない
  → 認証は Cloudflare Access に任せる
- パスワードやPINのハッシュ値をブラウザに送られるJSコードに埋め込まない

### Cloudflareの設定
- Cloudflare Workers の `preview_urls` を有効のままにしない
  → `wrangler.jsonc` に `"preview_urls": false` を必ず指定
  → Access認証をバイパスされるため
- 認証なしでアクセスできる状態で社外公開しない

### Git管理
- GitHub リポジトリを Public にしない（必ず Private）
- config.json などの機密ファイルは `.gitignore` で除外する
- `.example.json` テンプレートを別途用意する

---

## 困ったときは

以下のケースは無理せず、ユーザーに「エンジニアに相談してから」と答える：
- 上記の固定構成では実現できない要件
- 決済情報・患者情報・会員の個人情報を扱う必要がある
- 既存システムの大規模リファクタが必要
- 法的・コンプライアンス上の判断が必要

---

## ツール開発のフロー

### 新規ツール作成時
1. **要件ヒアリング** ── ユーザーの目的・対象ユーザー・必須機能を確認
2. **ROI判定** ── 投じる時間と得られるリターンを概算
3. **構成提案** ── 上記固定構成で実現可能かチェック
4. **MVP実装** ── 最小機能でまず動くものを作る
5. **検証** ── ユーザー自身が使ってみて評価
6. **改善ループ** ── MEMORY.mdに学びを蓄積しながら改善

### 既存ツール改善時
1. **対象ツールのSKILL.mdとMEMORY.md読み込み**（`tools/<ツール名>/`配下）
2. **現状把握** ── どこを変えるか・なぜ変えるか
3. **影響範囲の確認** ── 他機能を壊さないか
4. **実装** ── 段階的に変更
5. **検証** ── ローカル動作確認
6. **MEMORY.md更新** ── 学びを記録

---

## ローカル起動コマンド集

### EC（メルカリ自動化）
```bash
python3 tools/ec/scripts/web_server.py
# → http://localhost:8080
```

### 献立くん
```bash
cd tools/cooking-recipe
export GEMINI_API_KEY='your-key'
npx wrangler pages dev public --compatibility-date=2024-11-01
# → http://localhost:8788
```

### ライフプランくん
```bash
cd tools/life-plan
npx wrangler pages dev public --compatibility-date=2024-11-01
# → http://localhost:8788
```

### Claude Code内蔵サーバー（.claude/launch.json経由）
- mercari-app : port 8080
- life-plan : port 8791
- kiji-meshi : port 8792

---

## アウトプット基準

すべてのツール開発で以下を守る：

- **数値で示す**：処理時間・削減効果・コストを必ず数値化
- **再現性を持たせる**：READMEに環境構築手順を必ず記載
- **段階的に作る**：MVP → 機能追加 → 仕上げの順
- **テスト可能にする**：ユーザーが「動いた／動いてない」を判断できるようにする

---

## Git Worktree運用ノウハウ（ツール部門共通）

### Worktreeとは何か（一言で）
**「同じリポジトリを別フォルダで同時に開ける機能」**。
1つのPCで複数のブランチを並行作業でき、ブランチ切替で他作業を巻き込まない。
ツール部門は複数ツール（EC・献立・ライフプラン・新規）を持つので相性が良い。

### 配置ルール（厳守）
すべてのworktreeは**この場所のみ**に作る：
```
my-ai-company/.claude/worktrees/<worktree名>/
```
**フラット構造**（ネスト禁止）。`.claude/worktrees/.claude/worktrees/...` のような二重パスは絶対に作らない。
過去にネスト事故で4つのworktreeが迷子になった（2026-04-29に解消）。

### `.gitignore` 必須設定
`.claude/worktrees/` は **GitHubに上げない**。`.gitignore` に必ず以下が入っていること：
```
.claude/worktrees/
```
worktreeは個人の作業領域。GitHubには各worktreeで作った**ブランチ**をpushする形で反映する（worktreeフォルダそのものではない）。

### 使うべき場面
| 場面 | Worktreeを使う？ |
|------|----------------|
| 1ツールを30分以内で改修 | ❌ 通常セッションでOK |
| 複数ツールを同時並行で改修 | ✅ ツールごとに別worktree |
| 大型開発（数時間〜半日） | ✅ 専用worktreeで隔離 |
| ブログ部門と同時並行で動く | ✅ ブログ用と別worktree |
| `main`を壊さず実験したい | ✅ 実験用worktreeで安全に |

### CLAUDE.mdとの整合性
CLAUDE.mdのマルチセッション運用ルールに従う：
- **1 worktree ＝ 1部門専属**（tools用worktreeは `tools/` 配下のみ編集）
- **同じファイルを複数worktreeで同時編集しない**（コンフリクトの元）
- **作業終了時はコミット & push**（SessionStop hookで自動化済み）

### 基本コマンド集
```bash
# 一覧
git worktree list

# 新規作成（新ブランチで）
git worktree add .claude/worktrees/<名前> -b claude/<ブランチ名>

# 不要になったworktreeを削除（フォルダごと安全に消える）
git worktree remove .claude/worktrees/<名前>

# 移動（パスを直したい時）
git worktree move <現在のパス> <新しいパス>

# 孤児（git管理外のworktreeフォルダ）の掃除
git worktree prune
```

### トラブルシューティング
| 症状 | 原因 | 対処 |
|------|------|------|
| `.claude/worktrees/.claude/worktrees/` ができている | worktree作成時のパス指定ミス | `git worktree move` で正しい場所へ |
| worktree内で `tools/` が無い | そのブランチがmainより古い | `git pull origin main` でmain取込 or 新規worktree作成 |
| `git worktree list` に出ないフォルダがある | 孤児（中身ありなら要救出） | 中身確認 → 必要ならコミット → `rmdir` で削除 |
| pushしようとするとworktreesごと上がりそう | `.gitignore` に `.claude/worktrees/` が無い | 即追加 |

### 命名のコツ
- Claude Codeが自動命名する `claude/<形容詞>-<人物名>` 形式に合わせる（例：`claude/upbeat-mestorf-fa903c`）
- 自分で作る場合は `claude/tools-<ツール名>-<目的>` のように部門と目的を含める（例：`claude/tools-ec-price-update`）

---

## 自己改善ループ（CLAUDE.mdに準拠）

このスキルはCLAUDE.mdの方針に従い、タスク完了のたびに：
- 振り返りレポートを出力する
- 失敗パターン → SKILL.mdの禁止事項に追加
- 成功パターン → MEMORY.mdに蓄積
- ROI評価を必ず行う

### 進化のトリガー
| トリガー | 対応 |
|---------|------|
| 同じ実装ミスを2回した | SKILL.mdの禁止事項に追加 |
| 新しい便利な技術を発見した | MEMORY.mdに追記＋次回から採用 |
| ROIが想定より低かった | 原因分析＋改善策をMEMORY.mdに |
| 新ジャンルのツールを担当した | SKILL.mdの「担当範囲」を更新 |
