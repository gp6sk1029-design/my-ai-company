# EC物販部門 MEMORY.md
# 学習・経験の蓄積

> タスク完了のたびに追記する。効果がなかったパターンは削除する。月1回整理する。

---

## 成功パターン（効果があったもの）

### システム構築
- Google Drive連携（google_drive.py）で写真取得の自動化が実現
- スプレッドシート同期（sheets_sync.py）で在庫管理を可視化
- GAS（mercari_uploader.gs）+ Webアプリ（index.html）で管理画面を構築
- price_calculator.pyにGO/NO-GO判定・送料計算・値下げスケジュールを集約

### 出品ノウハウ
（実際の出品経験が溜まったら追記）

---

## 失敗パターン（二度と繰り返さないこと）

（失敗が起きたら追記）

---

## 販売実績の記録

（出品・販売のたびに追記）

---

## EC部門の開発履歴

### システム構築（2026/04〜）
- 2026/04/14: MacBookからEC部門コード統合（agents/9名 + scripts/13本 + apps_script/）
- 構成: 出品自動化パイプライン（Google Drive → 相場調査 → 価格設定 → 出品）
- 管理画面: GAS Webアプリ（index.html + mercari_uploader.gs）
- 在庫管理: SQLite DB（inventory_db.py）
- 価格計算: price_calculator.py（送料・手数料・利益率・GO/NO-GO判定）
- ブラウザ自動化: mercari_browser.py / mercari_selenium.py

### 実装済みスクリプト一覧
| スクリプト | 機能 | 状態 |
|---|---|---|
| run_ec_pipeline.py | パイプライン実行 | 実装済み |
| price_calculator.py | 価格計算・GO/NO-GO | 実装済み |
| mercari_browser.py | Chrome MCP経由操作 | 実装済み |
| mercari_selenium.py | Selenium経由操作 | 実装済み |
| inventory_db.py | 在庫DB操作 | 実装済み |
| google_drive.py | Google Drive連携 | 実装済み |
| sheets_sync.py | スプレッドシート同期 | 実装済み |
| auto_lister.py | 自動出品 | 実装済み |
| web_server.py | 管理画面サーバー | 実装済み |
| deploy_apps_script.py | GASデプロイ | 実装済み |
| platform_adapter.py | プラットフォーム抽象化 | 実装済み |
| drive_watcher.py | Drive監視 | 実装済み |
| mercari_app.py | メルカリアプリ連携 | 実装済み |

---

## 進化ログ

| 出品# | 日付 | SKILL.md改善点 | 学んだこと |
|---|---|---|---|
| 1 | - | - | - |
| 2 | - | - | - |
| 3 | - | - | - |
| ... | | | |
| 20 | - | Phase 2検討（月20件×3ヶ月達成時） | - |

---

## カテゴリ別の傾向

（販売データが溜まったら追記：どのカテゴリが売れやすいか等）

---

## 更新履歴

| 日付 | 更新者 | 内容 |
|---|---|---|
| 2026-04-14 | 初期作成 | テンプレート作成 |
| 2026-04-14 | Claude | EC部門の開発履歴・スクリプト一覧を遡及記録 |
