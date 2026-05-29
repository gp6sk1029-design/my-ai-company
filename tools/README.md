# ツール作成部門 README

## 部門概要
PWA・自動化ツール・SaaS連携を作る部門。
個別ツールの開発・改善はすべてこの部門が担当する。

**固定構成（変更不可）：**
- フロントエンド：Cloudflare Pages（または Cloudflare Workers）
- バックエンド：Cloudflare Workers Functions
- DB：Cloudflare D1
- 認証：Cloudflare Access
- AIモデル：Claude Opus

---

## フォルダ構成

```
tools/
├── SKILL.md                # 部門共通スキル（必読）
├── MEMORY.md               # 部門共通の学び
├── README.md               # 本ファイル
│
├── ec/                     # メルカリ自動化（EC物販）
│   ├── SKILL.md
│   ├── MEMORY.md
│   ├── scripts/            # Python自動化（13ファイル・5,229行）
│   ├── apps_script/        # Google Apps Script
│   ├── data/               # 在庫DB・出品履歴
│   ├── config.json         # 設定（GitHub除外）
│   └── config.example.json # テンプレート
│
├── cooking-recipe/         # 献立くん（料理レシピ献立PWA）
│   ├── SKILL.md
│   ├── MEMORY.md
│   ├── README.md
│   ├── public/             # PWAフロントエンド
│   ├── functions/          # API（Cloudflare Functions）
│   ├── tools/              # AIツール
│   ├── schema.sql          # D1スキーマ
│   └── wrangler.toml
│
└── life-plan/              # ライフプランくん（生涯資産管理PWA）
    ├── SKILL.md
    ├── MEMORY.md
    ├── README.md
    ├── public/             # PWAフロントエンド
    ├── functions/          # API
    ├── reference/          # 設計リファレンス
    ├── server.py           # ローカル開発サーバー
    ├── schema.sql          # D1スキーマ
    └── wrangler.toml
```

---

## 各ツールの起動方法

### EC（メルカリ自動化）
```bash
# Webサーバー（.claude/launch.json経由：mercari-app port 8080）
python3 tools/ec/scripts/web_server.py

# 出品パイプライン
python3 tools/ec/scripts/run_ec_pipeline.py
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

# または .claude/launch.json経由：life-plan port 8791
```

---

## 新規ツールを作るときの流れ

1. **要件ヒアリング** ── ユーザーの目的・対象・必須機能
2. **ROI判定** ── 投じる時間 vs 得られるリターン
3. **構成提案** ── 固定構成（Cloudflare）で実現可能か確認
4. **フォルダ作成** ── `tools/<新ツール名>/` を作る
5. **必須3点セット作成** ── SKILL.md / MEMORY.md / README.md
6. **MVP実装** ── 最小機能で動くものを先に作る
7. **検証** ── ローカルで動作確認 → ユーザーが使ってみる
8. **CLAUDE.md更新** ── プロジェクト一覧に追記

---

## セキュリティルール

❌ やってはいけないこと：
- APIキー・パスワードをソースコードに直書き
- 個人情報・機密情報のコミット
- `preview_urls` を有効にしたままデプロイ
- 認証なしの公開
- GitHubリポジトリのPublic化

✅ 守ること：
- APIキーは環境変数（Cloudflare Secrets）
- 機密ファイルは `.gitignore` で除外
- `.example.json` テンプレートを別途用意
- 認証は Cloudflare Access に任せる

---

## 関連ドキュメント
- [SKILL.md](SKILL.md) ── 部門のルール（必読）
- [MEMORY.md](MEMORY.md) ── 学習データ
- ルートの[CLAUDE.md](../CLAUDE.md) ── 全社共通ルール
