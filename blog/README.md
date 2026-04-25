# ブログ部門 README

## 部門概要
ブログ「**生産技術ガジェット研究所**」の運営部門。
記事執筆・SEO最適化・WordPress投稿・SNS配信までを一貫して担当する。

- WordPressテーマ：JIN:R
- メインキャラ：オオタニ所長
- サブキャラ：タナカ
- ターゲット：ガジェット・時短術・効率化に興味がある社会人

---

## フォルダ構成

```
blog/
├── SKILL.md                # ブログ部門のルール（必読）
├── MEMORY.md               # 学び・失敗パターン
├── README.md               # 本ファイル
│
├── agents/                 # サブエージェント定義
│   ├── manager.md          # 統括マネージャー
│   ├── researcher.md       # リサーチ
│   ├── seo.md              # SEO戦略
│   ├── writer.md           # 記事執筆
│   ├── image.md            # 画像生成・配置
│   ├── publisher.md        # WordPress投稿・SNS
│   └── analyst.md          # データ分析・PDCA
│
├── scripts/                # 自動化スクリプト
│   ├── article_status.py   # 記事ステータス管理
│   ├── wp_api.py           # WordPress REST API
│   ├── wp_block_builder.py # JIN:Rブロック生成
│   ├── image_resizer.py    # 画像リサイズ
│   └── run_pipeline.py     # パイプライン実行
│
├── articles/               # 記事Markdownファイル（成果物）
├── images/                 # 記事画像（処理済みは.gitignore除外）
├── pwa-cloudflare/         # 記事めしPWA（記事管理用）
├── apps-script/            # Google Apps Script（素材転送）
│
├── config.json             # ブログ設定（GitHub除外）
├── google_credentials.json # Google認証（GitHub除外）
└── google_token.pickle     # 認証トークン（GitHub除外）
```

---

## 起動方法

### Claude Codeで記事執筆を依頼
```
「Garminの新作レビュー記事書いて」
→ blog/SKILL.md が自動起動して記事執筆モードに入る
```

### 記事ステータス確認
```bash
python3 blog/scripts/article_status.py
```

### 記事めしPWA（記事管理）
```bash
# .claude/launch.json経由：kiji-meshi (port 8792)
# または手動で：
cd blog/pwa-cloudflare
python3 -m http.server 8792
```

---

## 記事の作成フロー

1. **企画レビュー** ── テーマ・KW・構成案をユーザー確認
2. **リサーチ** ── 競合・口コミ・トレンド収集
3. **執筆** ── PREP法・4軸評価・キャラ対話・金額換算
4. **記事レビュー** ── ユーザー確認・修正
5. **画像生成・配置** ── アイキャッチ・図解
6. **WordPress投稿** ── デフォルト下書き保存
7. **公開承認** ── ユーザー最終承認後に公開
8. **SNS配信** ── X・関連プラットフォーム
9. **分析・改善** ── アクセス・順位・CVRをPDCAで改善

---

## 関連ドキュメント
- [SKILL.md](SKILL.md) ── 部門のルール（必読）
- [MEMORY.md](MEMORY.md) ── 学習データ
- ルートの[CLAUDE.md](../CLAUDE.md) ── 全社共通ルール
