# 残りのセットアップ（手動作業が必要な部分）

以下の3ステップだけは**OAuth仕様上・OS仕様上**、スクリプトでは完全自動化できません。
各ステップの所要時間は合計**5〜10分**です。

---

## ✅ すでに自動化で完了している内容

| 項目 | 状態 | 値 |
|---|---|---|
| Drive「ブロブ関連」フォルダ ID | ✅ 取得済 | `1F6svjxNFWR9Ts1jVSNu8uxKTwK3T3mct` |
| ログ用スプレッドシート | ✅ 作成済 | `1XLeYodNGRaNCSG7U3zhUpxYnGLIq6Mrivqzhcv-Bogo` |
| `blog/config.json` | ✅ 更新済 | `material_uploader` セクション |
| `Config.gs` の setup() | ✅ ID書き込み済 | 直値に置換済 |
| Mac側シンボリックリンク | ✅ 作成済 | `blog/images/raw` → ブロブ関連 |

---

## ⏳ 残り3ステップ

### ステップA: Node.js と clasp の導入 + clasp login（約3分）

```bash
# ターミナルで実行
bash /Users/shoheikoda/Documents/my-ai-company/blog/apps-script/blog-capture/scripts/install.sh
```

このスクリプトは以下を順次やります：
1. Homebrew 自動インストール（未導入の場合・**sudoパスワード入力あり**）
2. Node.js 自動インストール
3. clasp 自動インストール
4. Python bootstrap は再実行だけ（既に成功してるのでスキップに近い）
5. **`clasp login`**：ブラウザが開く → Google アカウント（`gp6sk1029@gmail.com`）でログイン → 承認

### ステップB: Google Apps Script API を有効化（約1分）

1. ブラウザで https://script.google.com/home/usersettings を開く
2. 「Google Apps Script API」のトグルを **オン** にする

### ステップC: GAS に権限承認 + Web App デプロイ（約5分）

上の `install.sh` は Step B 以降も続行します：

1. **`clasp create`** → プロジェクト自動生成
2. **`clasp push`** → コード自動アップロード
3. **エディタが開く** → 以下を手動実行:
   - 関数ドロップダウンから `setup` を選び ▶ 実行
   - 権限の承認ダイアログを許可（Drive・Sheets）
   - 関数ドロップダウンから `runTest` を選び ▶ 実行
   - 実行ログで既存記事フォルダが取得できていることを確認
4. **ターミナルに戻って Enter** → スクリプトがデプロイを自動実行
5. **Web App URL が自動で `config.json` に記録される**

---

## 完了後

自動化スクリプトの最後に Web App URL が表示されます。
スマホ（iPhone Safari / Android Chrome）でその URL を開き、「ホーム画面に追加」して完了です。

---

## なぜこの3ステップだけ自動化できないか

| 手動作業 | 理由 |
|---|---|
| Homebrew インストール | sudo パスワードは人間が入力する必要がある |
| clasp login | OAuth 2.0 の仕様上、ブラウザでの認証が必須 |
| Apps Script API 有効化 | Google の設定 UI 上のみで変更可能 |
| setup() 初回実行の権限承認 | Google OAuth の仕様上、初回はブラウザ確認が必須 |
| スマホでのホーム画面追加 | iOS/Android の OS 仕様上、ユーザー操作が必須 |

これらは Google・Apple・OS の**セキュリティポリシー上の必須**なので、どのツールを使っても同じです。
