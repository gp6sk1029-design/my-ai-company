# 引き継ぎ書 - 2026-04-27-0206

- **トピック**: 献立くんPWA 構築（Gemini + D1同期 + Google連携 + 1週間献立）
- **本番URL**: https://kondate-kun.pages.dev/
- **リポジトリ**: `/Users/shoheikoda/Documents/my-ai-company/tools/cooking-recipe/`
- **セッションID**: `e065c587-b56c-43a2-8916-a9ba04eb889a`

---

## 🚀 復帰用プロンプト（新セッションでコピペ）

```
前セッションの引き継ぎを行います。以下を必ず読んでから作業再開してください。

1. handover/2026-04-27-0206-献立くんPWA構築（Gemini+D1同期+Google連携+1週間献立）.md ← 引き継ぎ書（必読）
2. CLAUDE.md ← 全体ルール
3. tools/cooking-recipe/SKILL.md ← 部門ルール
4. tools/cooking-recipe/MEMORY.md ← 過去の学び

確認後、引き継ぎ書「未完了タスク」「既知の問題」を踏まえて作業再開してください。
不明点があれば必ず先に質問してください。
```

---

## 📋 プロジェクト概要

「家族の好み・季節・在庫を踏まえて時短・簡単・ため買いの1週間献立を自動生成するPWA」

### 主な機能（実装済み）

- 🍳 **1週間献立自動生成**（Gemini 2.5 Flash・JSONスキーマ強制出力）
- 📷 **冷蔵庫カメラ認識**（Gemini Vision で複数枚総合判定）
- 👪 **家族メンバー個別管理**（嫌い/好き/アレルギー）
- 🍱 **食事別の詳細設定**（朝/昼/夜ごとに 時間・難易度・量）
- 🥡 **ジャンル選択**（和/中/洋/伊/韓/エス/丼・麺/日替わりミックス）
- 🏷️ **市販調味料活用**（Cook Do / うちのごはん等を製品名明記で時短）
- 🛒 **買い物リスト自動集約**（保存別グループ化🔴🟡🔵🟢）
- ⭐ **学習機能**（評価⭐/🙂/👎・直近14日マンネリ回避）
- ❄️ **冷蔵庫在庫管理**（カメラ認識＋手動）
- ☁️ **Cloudflare D1 同期**（世帯IDで複数端末・家族間共有）
- 📄 **PDF印刷・テキスト共有・.icsカレンダー出力**
- 🔗 **Google OAuth連携**（Calendar / Tasks に選択方式で同期）

---

## 🏗️ アーキテクチャ

```
[ブラウザ IndexedDB（端末側・主保管庫）]
  household / members / recipes / cookHistory /
  shopping / stock / generations / syncMeta
            ↕  3秒デバウンス自動同期
[Cloudflare Pages Functions（APIプロキシ）]
  /api/sync               → Cloudflare D1（世帯IDで分離）
  /api/generate           → Gemini 2.5 Flash
  /api/detect-ingredients → Gemini Vision
            ↕
[Google APIs（OAuth Token Client）]
  Calendar API / Tasks API（選択方式UI）
```

---

## 📁 重要なファイル（全て絶対パス）

### クライアント
- `/Users/shoheikoda/Documents/my-ai-company/tools/cooking-recipe/public/index.html` - 5タブ構成
- `/Users/shoheikoda/Documents/my-ai-company/tools/cooking-recipe/public/app.js` - 約2100行の単一ファイル
- `/Users/shoheikoda/Documents/my-ai-company/tools/cooking-recipe/public/styles.css`
- `/Users/shoheikoda/Documents/my-ai-company/tools/cooking-recipe/public/config.js` - DEFAULTS, GENERATE_URL等
- `/Users/shoheikoda/Documents/my-ai-company/tools/cooking-recipe/public/manifest.webmanifest`
- `/Users/shoheikoda/Documents/my-ai-company/tools/cooking-recipe/public/data/seasonal.json` - 月別旬食材

### サーバー（Cloudflare Pages Functions）
- `/Users/shoheikoda/Documents/my-ai-company/tools/cooking-recipe/functions/api/generate.js`
- `/Users/shoheikoda/Documents/my-ai-company/tools/cooking-recipe/functions/api/detect-ingredients.js`
- `/Users/shoheikoda/Documents/my-ai-company/tools/cooking-recipe/functions/api/sync.js`

### 設定・ドキュメント
- `/Users/shoheikoda/Documents/my-ai-company/tools/cooking-recipe/wrangler.toml`
- `/Users/shoheikoda/Documents/my-ai-company/tools/cooking-recipe/schema.sql` - D1テーブル定義
- `/Users/shoheikoda/Documents/my-ai-company/tools/cooking-recipe/SKILL.md`
- `/Users/shoheikoda/Documents/my-ai-company/tools/cooking-recipe/MEMORY.md`
- `/Users/shoheikoda/Documents/my-ai-company/tools/cooking-recipe/README.md`
- `/Users/shoheikoda/Documents/my-ai-company/tools/cooking-recipe/tools/generate_icons.py` - アイコン生成

### 設計プラン
- `/Users/shoheikoda/.claude/plans/quirky-baking-kernighan.md` - 初期設計プラン

---

## 🔑 環境・認証情報

### Cloudflare
- アカウント: gp6sk1029@gmail.com
- プロジェクト: `kondate-kun`
- Account ID: `08c5fa3f2590c3275a592aba77b3df06`
- D1 データベース: `kondate-kun-db` (id: `c2ce6e9d-f35b-48be-af30-9405926d5ff1`)
- ダッシュボード: https://dash.cloudflare.com/08c5fa3f2590c3275a592aba77b3df06/pages/view/kondate-kun

### Gemini API
- キー設定済み（Cloudflare Secrets `GEMINI_API_KEY`）
- ユーザーが直接チャットに貼ったキー: `AIzaSyDrTDbVUhYww8-rbm_o5XjM1W_vNbrG6t4`
- ⚠️ **要注意**: チャット履歴に残っているので、実運用前にローテーション推奨

### Google OAuth
- **未セットアップ**（次セッションで実機で確認・設定が必要）
- 必要な作業: Google Cloud Console で OAuth Client ID 作成 → アプリ「家族」タブで保存
- 詳細手順は SKILL.md / アプリ内のセットアップガイドに記載

---

## 🛠️ 開発コマンド

### ローカル起動
```bash
cd /Users/shoheikoda/Documents/my-ai-company/tools/cooking-recipe
export GEMINI_API_KEY='AIzaSyDrTDbVUhYww8-rbm_o5XjM1W_vNbrG6t4'
npx wrangler pages dev public --compatibility-date=2024-11-01 --port 8788
# → http://localhost:8788
```

### デプロイ
```bash
cd /Users/shoheikoda/Documents/my-ai-company/tools/cooking-recipe
npx wrangler pages deploy public --project-name=kondate-kun --commit-dirty=true --branch=main
```

### D1 直接操作
```bash
# スキーマ反映（初回・変更時）
npx wrangler d1 execute kondate-kun-db --remote --file=schema.sql

# データ確認
npx wrangler d1 execute kondate-kun-db --remote --command="SELECT householdId, id FROM members;"

# 特定世帯の全データ削除
npx wrangler d1 execute kondate-kun-db --remote \
  --command="DELETE FROM members WHERE householdId='xxx'; DELETE FROM recipes WHERE householdId='xxx';"
```

### アイコン再生成
```bash
cd /Users/shoheikoda/Documents/my-ai-company/tools/cooking-recipe
python3 tools/generate_icons.py
```

---

## ✅ 動作確認済み

| テスト | 結果 |
|---|---|
| Gemini 献立生成（中華＋市販調味料） | ✅ Cook Do製品名明記で出力 |
| Gemini 献立生成（和食＋市販OFF） | ✅ 基本調味料のみ |
| 1週間プラン生成 | ✅ 鶏2/豚2/牛1/魚2 のバランス自動調整 |
| 食事別設定の差分反映 | ✅ 朝3分/夜25分と明確に差別化 |
| D1 同期エンドポイント | ✅ 4テストすべてパス |
| 世帯ID形式バリデーション | ✅ 短すぎるIDは拒否 |
| デプロイ反映 | ✅ 本番URLで動作確認 |

---

## ⚠️ 既知の問題・要確認事項

### 1. カメラ機能の実機確認未完
- 当セッション中にユーザーから「カメラ動作させるところないけど」というフィードバックあり
- HTMLとJSのコードレベルでは正しく実装されているが、ブラウザキャッシュ・操作導線の問題と推測
- **次セッションで実機確認が必要**

### 2. Google OAuth の実機セットアップ未完
- コードは完全実装済み
- ユーザーが Google Cloud Console でクライアントID作成→アプリで保存する手順を実機で行う必要あり
- 設定ガイドはアプリ内に記載済み（家族タブ → 「📖 初回セットアップ手順」 details要素）

### 3. APIキーのチャット流出
- ユーザーが Gemini API キーをチャットで送ってしまった
- 実運用前にローテーション推奨
- 手順: AI Studio で旧キー削除 → 新キー発行 → `wrangler pages secret put GEMINI_API_KEY --project-name=kondate-kun`

### 4. app.js が約2100行
- SKILL.md の「500行で分割」ルールを大幅超過
- 機能が一段落したらモジュール分割を検討（候補: db.js / sync.js / google.js / camera.js / ui-render.js）

### 5. Service Worker 未実装
- 完全オフライン動作はできない
- 一覧表示はIndexedDBから出るので閲覧は可、生成は要オンライン

---

## 📝 直近のユーザー対話の流れ（このセッション）

1. 「料理レシピ献立アプリを作成したい」 → 設計＋実装
2. 「家族メンバーごとに嫌いものをカスタマイズ」
3. 「時短・簡単材料・ため買い考慮」
4. 「学習機能（美味しかったレシピ再登場）」
5. 「カメラで食材を判断してレシピ作成」
6. 「アクセスできない」→ ローカル起動→Cloudflare Pages本番デプロイ
7. 「アイコン最適化」→ Pillow でお椀+湯気+箸 のオリジナルアイコン生成
8. 「データはどこに保存？」→ アーキテクチャ説明
9. 「Cloudflare D1 同期で」→ D1 + sync.js 実装
10. 「ジャンル選択 + 市販調味料（Cook Do等の製品名）」
11. 「1週間で献立を立てる」→ デフォルトを1週間に
12. 「PDF出力 + 食事別設定 + Google連携」
13. 「Google連携を本格的に（OAuth・選択方式）」
14. 「引き継ぎ準備して」 ← イマココ

---

## 🚀 次セッションで進めるべき作業（優先順）

### 高優先度
1. **カメラ機能の実機確認・トラブルシュート**
   - スマホ実機 (iPhone Safari) でカメラ起動確認
   - 「📷 冷蔵庫から」モード切替が動作するか
   - 撮影→Gemini Vision認識→在庫保存→献立生成 の一連を確認

2. **Google OAuth の実機セットアップ支援**
   - Google Cloud Console で Client ID 作成手順をガイド
   - アプリで接続→カレンダー追加→Tasks追加 の動作確認

### 中優先度
3. **APIキーローテーション**（セキュリティ）
4. **MEMORY.md 更新**: 当セッションの成功パターン・失敗パターンを記録
5. **Service Worker 実装**: 完全オフライン動作（買い物リスト・レシピ閲覧）

### 低優先度（将来）
6. **app.js モジュール分割**（DRY＋500行ルール遵守）
7. **献立履歴の月次レポート**（学習データの可視化）
8. **Phase 2 拡張**: Gemini Visionで写真→レシピ化、音声入力、ベクトル検索

---

## 💰 月額コスト（実測ベース）

| 項目 | コスト |
|---|---|
| Cloudflare Pages | 無料枠（月10万リクエスト） |
| Cloudflare D1 | 無料枠（5GB） |
| Cloudflare Workers Functions | 無料枠 |
| Gemini 2.5 Flash | 月2〜5円（週1回・1週間献立生成想定） |
| Google Calendar/Tasks API | 無料枠 |
| **合計** | **月額 約2〜5円** |

---

## 🧠 設計の重要決定事項（ADR）

| 決定 | 理由 |
|---|---|
| バックエンドは Cloudflare Pages Functions | APIキー秘匿のため |
| IndexedDB をプライマリ、D1 をセカンダリ | オフライン動作・端末間同期両立 |
| 旬食材は静的 JSON | Gemini呼び出しコスト削減 |
| 出力は responseSchema で構造化強制 | パースエラー激減 |
| 世帯ID = 32文字ランダム（共有シークレット） | OAuth不要・家族で共有可 |
| Last-Write-Wins（updatedAt） | コンフリクト処理シンプル |
| 論理削除（deletedAt） | 削除の伝播確実 |
| Google OAuth は GIS Token Client | implicit flow で安全＆シンプル |
| Client ID はユーザー所有 | プライバシー＆所有権を明確に |
| Keep は API 無し → クリップボード方式 | API公開待ち |

---

## 関連リソース

- 全体ルール: `/Users/shoheikoda/Documents/my-ai-company/CLAUDE.md`
- プロジェクトルール: `/Users/shoheikoda/Documents/my-ai-company/tools/cooking-recipe/SKILL.md`
- 学習記録: `/Users/shoheikoda/Documents/my-ai-company/tools/cooking-recipe/MEMORY.md`
- 初期設計プラン: `/Users/shoheikoda/.claude/plans/quirky-baking-kernighan.md`
