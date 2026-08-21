# sns/scripts/ — SNS下書き自動化基盤

> 投稿そのものは自動化せず、分析・原稿・画像・投稿画面への入力までを自動化する。

---

## Phase 1: X拡散セット生成（実装済み）

### ファイル
`build_x_campaign.py`

### 機能
- 入力：記事分析・投稿本文・返信・カード内容を記述したJSON
- 出力：1200×1200pxのPNG最大4枚＋`campaign.md`
- 自動検査：本文140字以内／本文URLなし／タグ1〜2個／返信URLあり／長辺1800px以内
- 安全策：既存画像は上書きしない

### コマンド例
```bash
python3 sns/scripts/build_x_campaign.py \
  --spec sns/campaigns/<campaign-name>/campaign.json
```

カード種別は `photo_hook`（実写フック）、`comparison`（比較）、`breakdown`（内訳）、`warning`（注意点）。出力後は必ず画像を目視し、文字切れ・数字・添付順を確認する。

---

## Phase 3: 分析スクリプト（後段実装）

### 想定ファイル名
`weekly_report.py`

### 必要な前提
| 項目 | 状態 |
|---|---|
| X Developer Portal アカウント | 未取得 |
| X API v2 認証情報 | 未取得 |
| Instagram Graph API | 未取得（要Business Account変換） |
| YouTube Data API | 未取得（要Google Cloud Project） |

### 機能
- 各SNSのインプレッション・エンゲージメントを週次取得
- マークダウンレポートを `sns/MEMORY.md` 末尾に追記
- ハイパフォーマンス投稿を自動検出してSKILL.md提案

---

## Phase 4: 自動投稿基盤（要エンジニア相談）

🚨 **本フェーズは CLAUDE.md「困ったら」項に該当。エンジニア相談必須。**

### 想定構成
- **Cloudflare Workers**：投稿スケジューラー
- **Cloudflare D1**：投稿履歴・メトリクス蓄積
- **Cloudflare Cron Triggers**：定例投稿の発火
- **Cloudflare Secrets**：APIキー・OAuthトークン保管（コード直書き厳禁）
- **Cloudflare Access**：管理画面の認証

### フロー
```
sns/calendar.md（リポジトリ）
   ↓ Workerが定期Pull or 手動トリガー
Worker: 当日投稿予定を抽出
   ↓ 各SNSのAPIへ投稿（または下書き保存）
D1: 投稿IDと結果を記録
   ↓ Slack/Email通知（任意）
ユーザー：手動承認 → 公開（半自動方式）
```

### セキュリティ要件
- APIキーは絶対にリポジトリへコミットしない（gitignore徹底）
- Cloudflare Workers の `preview_urls: false` を `wrangler.jsonc` で固定
- Cloudflare Access で `gp6sk1029@gmail.com` のみ許可

---

## 参考：既存ツールの構成（流用元）

| ツール | パス | 流用ポイント |
|---|---|---|
| 記事めしPWA | `blog/pwa-cloudflare/` + `blog/apps-script/blog-capture/` | Cloudflare Pages + GAS連携の構成パターン |
| 献立くん | `tools/cooking-recipe/` | Cloudflare Workers + D1の構成パターン |
| ライフプランくん | `tools/life-plan/` | OCR・データ同期の構成パターン |

---

## 関連ファイル

- `sns/SKILL.md` — 全体ルール
- `sns/MEMORY.md` — 学び・進化ログ
- `~/.claude/plans/cozy-wondering-alpaca.md` — 全体ロードマップ
