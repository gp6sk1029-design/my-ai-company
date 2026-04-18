# blog-capture

ブログ記事用の素材（画像・動画・スクリーンショット・PDF）をスマホから Google Drive の既存フォルダに自動振り分けで転送する PWA ツール。

- **スマホ本体に残さない**：撮影画像は写真アプリ／ギャラリーに保存せず、IndexedDB に一時保存
- **オフライン対応**：電波が弱い場所で撮りためて、空いた時間にまとめて転送
- **自動振り分け**：Drive の `マイドライブ/個人事業/副業関連/ブロブ関連/【記事】◯◯/` に振り分け
- **Mac 即時同期**：Google Drive for Desktop 経由で `blog/images/raw/` にリアルタイム反映

---

## ディレクトリ構成

```
blog/apps-script/blog-capture/
├── appsscript.json   … マニフェスト（OAuth scope 等）
├── Code.gs           … メインエントリ（doGet・doPost）
├── Config.gs         … 設定値（PropertiesService から取得）
├── FolderManager.gs  … 記事フォルダ管理（【記事】◯◯ 命名規則）
├── Normalizer.gs     … ファイル名正規化（YYYYMMDD_HHMMSS.ext）
├── Deduper.gs        … SHA-256 ハッシュで重複排除
├── Logger.gs         … 転送ログをスプレッドシートに記録
├── Resumable.gs      … 20MB超の動画用 Resumable Upload
├── index.html        … PWA エントリ
├── styles.html       … 全 CSS
├── app.html          … 全 JavaScript（カメラ・IndexedDB・アップロード）
└── README.md         … このファイル
```

---

## セットアップ手順（初回のみ、約30分）

### ステップ1：Node.js と clasp のインストール

Homebrew が未導入の場合、まず Homebrew を入れる：

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

続けて Node.js と clasp：

```bash
brew install node
npm install -g @google/clasp
clasp login  # ブラウザ認証（gp6sk1029@gmail.com）
```

### ステップ2：Google Apps Script プロジェクトを作成

```bash
cd /Users/shoheikoda/Documents/my-ai-company/blog/apps-script/blog-capture
clasp create --title "blog-capture" --type webapp --rootDir .
```

実行後 `.clasp.json` が生成される（`.gitignore` 対象）。

### ステップ3：ログ用スプレッドシート作成

1. [Google スプレッドシート](https://sheets.google.com) を開く
2. 新規作成 → 名前を `blog-capture_ログ` にする
3. URL の `/d/...../` 部分（Spreadsheet ID）をメモ

### ステップ4：Drive の「ブロブ関連」フォルダ ID を取得

1. [Google Drive](https://drive.google.com) で `マイドライブ/個人事業/副業関連/ブロブ関連` を開く
2. URL の `/folders/......` 部分（Folder ID）をメモ

### ステップ5：GAS にコードをデプロイ

```bash
cd /Users/shoheikoda/Documents/my-ai-company/blog/apps-script/blog-capture
clasp push
```

続いて Apps Script エディタを開く：

```bash
clasp open
```

エディタで以下を実行：

1. `Config.gs` の `setup()` 関数を開く
2. `YOUR_BROG_KANREN_FOLDER_ID_HERE` をステップ4のID に置換
3. `YOUR_LOG_SPREADSHEET_ID_HERE` をステップ3のID に置換
4. `setup` 関数を実行（初回は権限承認が必要）
5. `runTest` 関数を実行してログで既存記事フォルダが取れるか確認

### ステップ6：Web App としてデプロイ

```bash
clasp deploy --description "v1"
```

実行結果の `Web App URL` をコピーする（`https://script.google.com/macros/s/.../exec`）。

このURLを `blog/config.json` の `material_uploader.gas_web_app_url` に記入：

```json
"material_uploader": {
  "gas_web_app_url": "https://script.google.com/macros/s/.../exec",
  "drive_root_folder_id": "（ステップ4のID）",
  "log_spreadsheet_id": "（ステップ3のID）",
  ...
}
```

### ステップ7：Google Drive for Desktop 設定

Drive for Desktop アプリを開き、`マイドライブ/個人事業/副業関連/ブロブ関連` を **ミラー同期** に設定（オンデマンドだと Mac 側で遅延する）。

### ステップ8：シンボリックリンクの確認

```bash
ls -la /Users/shoheikoda/Documents/my-ai-company/blog/images/raw
# → /Users/shoheikoda/Library/CloudStorage/GoogleDrive-.../ブロブ関連 への link が表示されればOK
```

※ このプロジェクトの初期セットアップで既に作成済み。

### ステップ9：スマホでアクセス

1. ステップ6 で取得した Web App URL を **iPhone Safari / Android Chrome** で開く
2. 「ホーム画面に追加」
3. ホーム画面のアイコンから起動 → 記事選択 → 撮影 → 転送

---

## 使い方

### 日常の撮影フロー

1. ホーム画面の「blog-capture」アイコンをタップ
2. 上部のドロップダウンで記事を選ぶ（新規なら「新規記事を作成」を開く）
3. **カメラ** タブ：シャッターボタンで撮影（本体写真アプリには保存されない）
4. **動画** タブ：録画開始／停止
5. **取り込み** タブ：端末のファイル選択、または Android なら他アプリの共有シート経由
6. 撮った分が一時保存に溜まる → 空いた時間に **すべて転送**

### 転送後

- Drive の `【記事】◯◯` フォルダに `YYYYMMDD_HHMMSS.jpg` 形式で配置
- Mac の `blog/images/raw/【記事】◯◯/` からすぐにアクセス可能
- PWA の一時保存は自動で空になる
- スプレッドシートの「転送ログ」シートに記録

---

## トラブルシュート

| 症状 | 対策 |
|---|---|
| スマホで URL を開くと「許可されていないユーザー」エラー | `Config.gs` の `ALLOWED_EMAIL` と実際のログイン Google アカウントが一致するか確認 |
| カメラが起動しない | iOS は HTTPS + ホーム画面追加が必須。普通の Safari タブでは権限が落ちやすい |
| Drive に反映されない | 1. GAS の実行ログを確認（`clasp open` → 実行結果）、 2. ブロブ関連 フォルダのID が合っているか確認 |
| Mac の `blog/images/raw/` が空 | Drive for Desktop で **ミラー同期** に設定されているか確認 |
| 重複スキップされる | 同じファイルが既に転送済み（スプレッドシートの「ハッシュ台帳」を確認） |
| 大容量動画で失敗 | `blog/config.json` の `SMALL_FILE_LIMIT_BYTES` 超は Resumable ルート。ネットワーク切断時は再送可能 |

---

## 開発・更新

```bash
cd /Users/shoheikoda/Documents/my-ai-company/blog/apps-script/blog-capture
# コード変更後
clasp push
# デプロイ版を更新
clasp deploy --deploymentId <既存のID> --description "v2"
```

`.claude/settings.json` の auto-sync hook により、PWA ソース変更時も自動で Git に記録される。

---

## セキュリティメモ

- OAuth クライアント情報は GAS 側で完結（PWA には秘密情報を持たない）
- `ALLOWED_EMAIL` によりアクセス制御（自分のGoogleアカウントのみ）
- `.clasp.json`・`.clasprc.json` は `.gitignore` 済み
- GAS の `webapp.access` を `MYSELF` に設定（自分以外から実行不可）
