# ライフプランくん

家族の年齢 × 収支 × 資産 × ライフイベント × 投資の複利を1画面で可視化するPWA。

## 特徴

- **新NISA（成長+つみたて、生涯1,800万円cap）／特定口座（譲渡益20.315%）／個別株・暗号資産（シナリオ別）** の3レイヤー複利シミュレーション
- **子供の年齢別教育費シミュ** — 幼→小→中→高→大まで公立/私立を切替、塾費用も加算（文科省・日本政策金融公庫のデータ準拠）
- **ライフイベントを単発支出として登録** — 車買替・家電更新・旅行・リフォームが該当年にCFへ反映
- **MF連携の3方式**（⚠️ MFは資産残高CSVを出さないため独自実装）
  - 📸 **資産スクショOCR取込**：MFアプリの資産画面スクショを Tesseract.js でOCR→端末内処理→差分プレビュー→反映
  - 🔄 **一括棚卸しモード**：OCR失敗時の現実解。全口座を1画面で順入力、差分（±円/±%）を即時表示
  - 📥 **家計簿CSV取込**：MFの家計簿CSVを収支タブで取込→振替除外→大項目×月で集計→直近3ヶ月平均で「支出」を実績値に更新
- **オフライン動作** — IndexedDBに全データ保存、スマホにインストールすればネット無しで参照・更新可能

## 技術スタック

| レイヤ | 採用 |
|---|---|
| フロント | Vanilla JS + HTML + CSS |
| グラフ | Chart.js（CDN）|
| データ永続 | IndexedDB（端末）+ Cloudflare D1（将来の同期用、スキーマ準備済み）|
| バックエンド | Cloudflare Pages Functions |
| デプロイ | Cloudflare Pages |

## ディレクトリ

```
life-plan/
├── public/
│   ├── index.html         — 6タブ構成
│   ├── app.js             — アプリ本体
│   ├── calc.js            — 純粋関数の計算エンジン
│   ├── styles.css
│   ├── config.js
│   ├── manifest.webmanifest
│   └── data/
│       ├── education-costs.json
│       └── life-events.json
├── functions/api/
│   └── sync.js            — D1同期
├── wrangler.toml
└── schema.sql             — D1テーブル定義
```

## ローカル起動

```bash
cd tools/life-plan
npx wrangler pages dev public --compatibility-date=2024-11-01
# → http://localhost:8788
```

D1の同期APIを試す場合は先に `wrangler d1 create life-plan-db` してIDを `wrangler.toml` に貼り、`wrangler d1 execute life-plan-db --local --file=schema.sql` でスキーマ作成。

## 使い方

1. 「基本」タブで現在年齢・退職年齢・寿命・子供を登録
2. 「収支」タブで年収・月額支出を年齢区間で登録
3. 「教育」タブで子供ごとの進路（公立/私立）を設定
4. 「資産」タブで口座（新NISA・特定・株・暗号・現金）を登録、MFアプリ資産画面のスクショで残高更新／一括棚卸しモードで手入力も可
5. 「イベント」タブで車買替などの単発支出を追加
6. 「ホーム」タブでCF表とグラフを確認、資産枯渇年齢を把握

## 計算エンジン（calc.js）

純粋関数で以下を提供：

- `simulateAccount({initialBalance, monthlyContribution, annualReturn, years, taxable})` — 単一口座の複利推移
- `simulateNisaWithOverflow(...)` — 新NISAの生涯枠超過分を特定口座に流す
- `simulateDrawdown({portfolioTaxable, portfolioNontax, rate, years})` — 4%ルール取崩フェーズ
- `buildEducationByAge(child, dataset)` — 子供の進路から年齢別教育費
- `expandEventByAge(event, maxAge)` — ライフイベントを発生年にバラす
- `expandPeriodicByAge(item, baseAge)` — 月額×年齢区間を年次展開（インフレ込み）
- `buildCashflow(input)` — 全体統合

### 検証ポイント

- 年5%×10年複利：元本の1.629倍（教科書値）
- 月3万円×20年×5%：約1,234万円（FP試験定番値）
- 新NISA生涯上限1,800万円到達後、超過分は自動で特定口座に回る

## 自己改善ループ（CLAUDE.md準拠）

タスク完了のたびに振り返りを出力し、SKILL.md / MEMORY.md を更新する。詳細は各ファイル参照。
