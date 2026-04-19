/**
 * Config.gs
 * ─────────────────────────────────────────────
 * blog-capture の設定値（全て非秘匿な ID のため直接ハードコード）
 * bootstrap.py 実行後に値が埋まる仕組み。
 */

const CONFIG = {
  ROOT_FOLDER_ID: '1F6svjxNFWR9Ts1jVSNu8uxKTwK3T3mct',
  LOG_SPREADSHEET_ID: '1XLeYodNGRaNCSG7U3zhUpxYnGLIq6Mrivqzhcv-Bogo',
  ALLOWED_EMAIL: 'gp6sk1029@gmail.com',
  // Cloudflare PWA から呼ぶ際の共有トークン（PWAコードと一致させる）
  SHARED_TOKEN: 'NP99L5IGacCx9N8JO7V0769HOVckd-tF',
  ARTICLE_PREFIX: '【記事】',
  SMALL_FILE_LIMIT_BYTES: 20 * 1024 * 1024,
  LOG_SHEET_NAME: '転送ログ',
  HASH_SHEET_NAME: 'ハッシュ台帳',
};

/**
 * 設定表示（動作確認用）
 */
function showConfig() {
  Logger.log(JSON.stringify({
    ROOT_FOLDER_ID: CONFIG.ROOT_FOLDER_ID,
    LOG_SPREADSHEET_ID: CONFIG.LOG_SPREADSHEET_ID,
    ALLOWED_EMAIL: CONFIG.ALLOWED_EMAIL,
  }, null, 2));
}

/**
 * 疎通テスト（Apps Script エディタから手動実行）
 */
function runTest() {
  Logger.log('--- Config ---');
  showConfig();
  Logger.log('--- Articles ---');
  Logger.log('既存記事数: ' + listArticleFolders().length);
  Logger.log(JSON.stringify(listArticleFolders(), null, 2));
}
