/**
 * Config.gs
 * ─────────────────────────────────────────────
 * blog-capture の設定値（全て非秘匿な ID のため直接ハードコード）
 * bootstrap.py 実行後に値が埋まる仕組み。
 */

const CONFIG = {
  // 「ブロブ関連」フォルダID（自動取得済）
  ROOT_FOLDER_ID: '1F6svjxNFWR9Ts1jVSNu8uxKTwK3T3mct',
  // 転送ログ用スプレッドシートID（自動作成済）
  LOG_SPREADSHEET_ID: '1XLeYodNGRaNCSG7U3zhUpxYnGLIq6Mrivqzhcv-Bogo',
  // 許可されたGoogleアカウント（これ以外はアクセス拒否）
  ALLOWED_EMAIL: 'gp6sk1029@gmail.com',
  // 記事フォルダ名プレフィックス（既存命名規則）
  ARTICLE_PREFIX: '【記事】',
  // 小ファイル上限（これ超えたらResumable扱い）
  SMALL_FILE_LIMIT_BYTES: 20 * 1024 * 1024, // 20MB
  // ログシート名
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
