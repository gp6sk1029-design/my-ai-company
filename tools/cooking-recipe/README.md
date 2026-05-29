# 献立くん（Cooking Recipe / Menu PWA）

家族構成・季節の旬食材・冷蔵庫の在庫を踏まえて、**時短・簡単・ため買い前提**の献立を自動生成するスマホPWA。Google Gemini 2.5 Flash（生成＋Vision）を利用。

---

## 主な機能

- 🍳 **献立自動生成** — 日数1〜7、朝/昼/夜の組み合わせ自由、デフォルト調理時間20分以内
- 📷 **冷蔵庫カメラ認識** — 複数枚の写真から Gemini Vision で食材を総合判断→在庫から作れる献立を提案
- 👪 **家族別プロフィール** — メンバー追加可・年齢別・アレルギー／嫌い／好きを個別設定
- 🛒 **買い物リスト自動集約** — 同食材を統合し、保存別（常温／冷蔵／冷凍／要早消費）でグループ化
- ⭐ **学習する献立** — 評価（美味しい／普通／いまいち）を蓄積し、好評レシピを状況判断で再登場
- 🔍 **レシピ保存・検索** — タイトル／食材でインクリメンタル検索
- ❄️ **冷蔵庫在庫管理** — カメラ認識＋手動追加で在庫を管理し、献立に反映

---

## 技術スタック

| レイヤ | 使用技術 |
|---|---|
| フロント | Vanilla JS + HTML + CSS（PWA） |
| 永続化 | IndexedDB（7ストア） |
| バックエンド | Cloudflare Pages Functions（APIプロキシ2本） |
| AI | Gemini 2.5 Flash（`responseMimeType: application/json` 構造化出力） |
| デプロイ | Cloudflare Pages |

---

## ディレクトリ構成

```
tools/cooking-recipe/
├── public/                    # 静的配信ルート
│   ├── index.html            # 5タブ構成（ホーム/レシピ/買物/冷蔵庫/家族）
│   ├── styles.css
│   ├── app.js                # 全画面ロジック
│   ├── config.js             # クライアント設定（APIキーなし）
│   ├── manifest.webmanifest
│   ├── data/seasonal.json    # 月別旬食材
│   └── icon-*.png / favicon*
├── functions/api/
│   ├── generate.js           # 献立生成プロキシ
│   └── detect-ingredients.js # Vision 食材認識プロキシ
├── wrangler.toml
├── SKILL.md                  # プロジェクト固有ルール
├── MEMORY.md                 # 学習蓄積
└── README.md                 # 本ファイル
```

---

## ローカル起動

```bash
# 1. Gemini API キーを取得
#    https://aistudio.google.com/apikey
#    → 環境変数にセット

export GEMINI_API_KEY='your-api-key-here'

# 2. プロジェクトディレクトリへ
cd /Users/shoheikoda/Documents/my-ai-company/tools/cooking-recipe

# 3. wrangler で Pages + Functions を同時起動
npx wrangler pages dev public --compatibility-date=2024-11-01

# → http://localhost:8788 でブラウザを開く
```

**注意**: `python -m http.server` では `/api/*` が動かない。必ず wrangler を使うこと。

### 疎通確認（curl）

```bash
curl -X POST http://localhost:8788/api/generate \
  -H 'Content-Type: application/json' \
  -d '{
    "month":4,
    "members":[{"name":"たろう","kind":"adult","age":35,"allergies":[],"dislikes":[],"likes":[]}],
    "householdAllergies":[],
    "avoidMode":"any",
    "budgetYen":1500,
    "maxCookTimeMin":20,
    "moodTag":"normal",
    "seasonalHint":["春キャベツ","新玉ねぎ","アスパラガス"],
    "days":1,
    "mealTypes":["dinner"],
    "basicIngredientsOnly":true,
    "batchShopping":false,
    "favorites":[],
    "recentlyCooked":[],
    "blocked":[],
    "stockIngredients":[]
  }'
```

---

## 本番デプロイ（Cloudflare Pages）

1. Cloudflare ダッシュボード → **Pages** → **Create a project**
2. GitHub リポジトリ `my-ai-company` と接続
3. ビルド設定:
   - Framework preset: `None`
   - Build command: （空）
   - Build output directory: `tools/cooking-recipe/public`
   - Root directory: `private/cooking-recipe`
4. **Environment variables** に `GEMINI_API_KEY` を設定（Production と Preview 両方）
5. Deploy

---

## 初回利用の流れ

1. 「家族」タブで家族メンバーを追加（最低1人）
   - 名前・年齢・アレルギー・嫌い食材・好き食材を入力
2. 「ホーム」タブで条件を設定し「献立を作る」
3. 生成された献立をレシピ保存 or 買い物リストへ追加
4. 調理後「📖 レシピ」タブから「🍳 今日 作った！」＋評価で学習

### カメラ機能（在庫から献立を作る）

1. 「ホーム」タブ → 「📷 冷蔵庫から」
2. カメラを起動し、冷蔵室・野菜室・冷凍室など3〜5枚撮影
3. 「🔍 食材を認識して献立生成」
4. 認識結果の確認画面で不要なものをチェック外す
5. 「この食材で献立を作る」

---

## ROI（費用対効果）

| 項目 | 値 |
|---|---|
| Gemini 2.5 Flash 単価 | 入力 $0.075/1M tokens、出力 $0.30/1M tokens |
| 1回の献立生成（3日×夜） | 約 0.3 円 |
| 月8回利用 + Vision 月4回 | **月額 約 2〜5 円** |
| 削減時間 | 月 約7時間（意思決定＋買い物回数削減） |
| **ROI** | **約 3,000〜5,000倍** |

Cloudflare Pages は無料枠内（月10万リクエスト）。

---

## 設計ドキュメント

- プロジェクトルール: `./SKILL.md`
- 学習記録: `./MEMORY.md`
- 社内全体ルール: `../../CLAUDE.md`
- 実装プラン: `~/.claude/plans/quirky-baking-kernighan.md`

---

## よくある問題

### 「カメラが起動しない」
- Safari は HTTPS が必須。`wrangler pages dev` は localhost なら OK。
- 本番は Cloudflare Pages が自動で HTTPS 対応。

### 「生成に失敗しました」
- Cloudflare の環境変数 `GEMINI_API_KEY` が未設定の可能性。
- ブラウザの開発者ツール → Network で `/api/generate` のレスポンスを確認。

### 「アレルギー食材が混入」
- クライアント側のダブルチェックで弾かれる。再生成される。
- 繰り返し発生する場合はプロンプトの `MUST_NOT_INCLUDE` を強化する必要あり（SKILL.md に記録）。
