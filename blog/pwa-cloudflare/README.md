# 記事めしPWA（Cloudflare Worker版）

## 構成

- 静的画面: Cloudflare Workers Static Assets
- GAS中継: `src/worker.js` の `/api/gas`
- 認証: Cloudflare Access
- 機密情報: Cloudflare Secret `GAS_SHARED_TOKEN`
- Preview URL: 無効（`preview_urls: false`）

## Codex画像の保存先

CodexとのジョブJSON・元画像・完成PNGの受け渡しには、ワークスペース内にPWAが初回だけ自動作成する`.article-meshi-codex`を使う。通常画面ではパス入力欄を表示しない。完成画像はPWAの「📥 Codex画像をDriveへ保存」で、ジョブ開始時に選択していたGoogle Drive記事フォルダへ直接保存する。一時フォルダを最終保存先として扱わない。

記事めしの「🧠 Codexで画像生成」は、画像生成専用の新しいCodexタスクを開き、ジョブの実行指示を入力済みにする。画像編集時は編集元PNGを画像データとしてクリップボードへ自動コピーするため、ユーザーは開いたCodexの入力欄で`⌘V`して画像が表示されたことを確認し、送信する。Codexのディープリンクは画像ファイル自体の添付に対応しないため、この1回の貼り付けだけは必要。自動コピーに失敗した場合は「🖼 編集元画像を再コピー」を使う。セッション宣言・役割定義・引き継ぎ指示は依頼文へ混ぜない。

## PC・スマホ間の設定同期

「AI 接続先設定」で保存したChatGPTプロジェクトURLとGemini Gem URLは、Google Driveの`記事めし_AI接続先設定.json`へ保存する。記事めしを開くたびにこのファイルを読み込むため、PCとスマホで同じ設定を共有できる。旧版のSNSタスクIDは互換性のため読み込めるが、画像生成には使用しない。

Codexワークスペースの絶対パス、一時フォルダの権限、画像取込フォルダの権限は端末固有のため同期しない。認証トークン・APIキー・パスワードもこの設定ファイルには保存しない。

ChatGPTプロジェクトURLを保存している場合、「🚀 ChatGPTを開く」はそのプロジェクトを優先して開く。ChatGPTのプロジェクトURLはプロンプトのURL自動入力に対応しないため、プロンプトはクリップボードへコピーされる。開いたプロジェクトで貼り付けて送信する。

## 初回設定

```bash
cd blog/pwa-cloudflare
wrangler secret put GAS_SHARED_TOKEN
wrangler deploy
```

Cloudflare Accessアプリを作成した後、`ACCESS_TEAM_DOMAIN` と `ACCESS_AUD` を `wrangler.jsonc` の `vars` に設定する。これらは公開識別子であり、秘密値ではない。設定がない間、Workerはすべてのアクセスを503で拒否する。

## ローカル確認

```bash
wrangler dev
```

## スマホへ追加

Cloudflare Accessでログインした状態で記事めしを開き、上部の`⇩`を押す。

- Android（Chrome）: 表示される確認画面、またはChromeのメニューから **「アプリをインストール」** を選ぶ。「ホーム画面に追加」はショートカットになるため選ばない。
- iPhone（Safari）: 共有ボタンから「ホーム画面に追加」→「追加」を選ぶ。

追加後はホーム画面の「記事めし」アイコンから、ブラウザのタブを開かずに起動できる。静的な画面だけはオフラインでも表示できるが、記事データ・Google Drive・認証が必要な通信はオンライン時だけ行う。カメラ・素材転送・ChatGPT/Gemini連携はスマホで利用できる。Codexでの画像編集はMac上のCodexと一時受け渡しフォルダを使うため、Macで行う。
