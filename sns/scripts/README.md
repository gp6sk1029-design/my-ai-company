# sns/scripts/ — 自動化基盤の実装計画

> 本ディレクトリはSNS関連の自動化スクリプトを格納する。**Phase 0時点ではコード未実装、計画書のみ**。

---

## Phase 1: 原稿一括生成スクリプト（次に実装）

### 想定ファイル名
`sns_draft_generator.py`

### 機能
- 入力：ブログ記事のWP投稿ID または ローカル `articles/xxx.md` パス
- 出力：X / Instagram / YouTube の投稿原稿セット（コピペ可能形式）

### 実装方針（既存資産の再利用）
- `blog/scripts/wp_api.py` — WP記事取得
- `blog/scripts/wp_block_builder.py` — テキスト変換ロジック参考
- 各チャネルのSKILL.mdをパースしてテンプレート適用

### コマンド例
```bash
python3 sns/scripts/sns_draft_generator.py --post-id 703
python3 sns/scripts/sns_draft_generator.py --post-id 703 --channels x,instagram
python3 sns/scripts/sns_draft_generator.py --file blog/articles/huawei-gt-runner2-review.md
```

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
