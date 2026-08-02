// Cloudflare PWA 設定ファイル
// GASの接続先と認証トークンはCloudflare Workerだけが保持する。
window.BLOG_CAPTURE_CONFIG = {
  GAS_URL: '/api/gas',
  SMALL_FILE_LIMIT: 20 * 1024 * 1024,
};
