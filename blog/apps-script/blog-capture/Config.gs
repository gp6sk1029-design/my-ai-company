/**
 * Config.gs
 * ─────────────────────────────────────────────
 * blog-capture の非秘匿設定値
 * bootstrap.py 実行後に値が埋まる仕組み。
 */

const CONFIG = {
  ROOT_FOLDER_ID: '1F6svjxNFWR9Ts1jVSNu8uxKTwK3T3mct',
  LOG_SPREADSHEET_ID: '1XLeYodNGRaNCSG7U3zhUpxYnGLIq6Mrivqzhcv-Bogo',
  ALLOWED_EMAIL: 'gp6sk1029@gmail.com',
  // 秘密値そのものはScript Propertiesへ保存する。
  SHARED_TOKEN_PROPERTY: 'BLOG_CAPTURE_SHARED_TOKEN',
  LOCAL_SHARED_TOKEN_PROPERTY: 'BLOG_CAPTURE_LOCAL_SHARED_TOKEN_V2',
  ARTICLE_PREFIX: '【記事】',
  // PC・スマホで共通に使うAI接続先URLだけを保存する（認証情報は保存しない）。
  AI_CONNECTIONS_FILE_NAME: '記事めし_AI接続先設定.json',
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
