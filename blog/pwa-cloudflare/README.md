# 記事めしPWA（Cloudflare Worker版）

## 構成

- 静的画面: Cloudflare Workers Static Assets
- GAS中継: `src/worker.js` の `/api/gas`
- 認証: Cloudflare Access
- 機密情報: Cloudflare Secret `GAS_SHARED_TOKEN`
- Preview URL: 無効（`preview_urls: false`）

## Codex画像の保存先

CodexとのジョブJSON・元画像・完成PNGの受け渡しには、ワークスペース内にPWAが初回だけ自動作成する`.article-meshi-codex`を使う。通常画面ではパス入力欄を表示しない。完成画像はPWAの「📥 Codex画像をDriveへ保存」で、ジョブ開始時に選択していたGoogle Drive記事フォルダへ直接保存する。一時フォルダを最終保存先として扱わない。

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
