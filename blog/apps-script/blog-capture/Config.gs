/**
 * Config.gs
 * ─────────────────────────────────────────────
 * blog-capture の設定値を一元管理する。
 * 初期設定は setup() を Apps Script エディタから1回だけ実行する。
 * シークレット値は PropertiesService に保存し、コードには含めない。
 */

const CONFIG = {
  // ブロブ関連フォルダのID（Property "BLOG_ROOT_FOLDER_ID" から取得）
  get ROOT_FOLDER_ID() {
    return PropertiesService.getScriptProperties().getProperty('BLOG_ROOT_FOLDER_ID');
  },
  // 転送ログ用スプレッドシートID（Property "LOG_SPREADSHEET_ID" から取得）
  get LOG_SPREADSHEET_ID() {
    return PropertiesService.getScriptProperties().getProperty('LOG_SPREADSHEET_ID');
  },
  // 許可されたGoogleアカウント（Property "ALLOWED_EMAIL" から取得）
  get ALLOWED_EMAIL() {
    return PropertiesService.getScriptProperties().getProperty('ALLOWED_EMAIL');
  },
  // 記事フォルダ名プレフィックス（既存命名規則）
  ARTICLE_PREFIX: '【記事】',
  // 小ファイル上限（これ超えたらResumable扱い）
  SMALL_FILE_LIMIT_BYTES: 20 * 1024 * 1024, // 20MB
  // ログシート名
  LOG_SHEET_NAME: '転送ログ',
  HASH_SHEET_NAME: 'ハッシュ台帳',
};

/**
 * 初期セットアップ（エディタから1回だけ手動実行）
 * ScriptProperty に以下を設定：
 *  - BLOG_ROOT_FOLDER_ID: 「ブロブ関連」フォルダのID
 *  - LOG_SPREADSHEET_ID : ログスプレッドシートID
 *  - ALLOWED_EMAIL      : 使用する自分のGoogleアカウント
 */
function setup() {
  const props = PropertiesService.getScriptProperties();
  // ↓ここを自分の環境に合わせて書き換えて実行する
  const configs = {
    BLOG_ROOT_FOLDER_ID: 'YOUR_BROG_KANREN_FOLDER_ID_HERE',
    LOG_SPREADSHEET_ID: 'YOUR_LOG_SPREADSHEET_ID_HERE',
    ALLOWED_EMAIL: 'gp6sk1029@gmail.com',
  };
  props.setProperties(configs);
  Logger.log('✅ Properties設定完了: ' + JSON.stringify(Object.keys(configs)));
}

/**
 * 現在の設定を表示（デバッグ用）
 */
function showConfig() {
  const props = PropertiesService.getScriptProperties().getProperties();
  Logger.log(JSON.stringify(props, null, 2));
}
