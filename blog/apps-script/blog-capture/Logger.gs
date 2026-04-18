/**
 * Logger.gs
 * ─────────────────────────────────────────────
 * 転送ログをスプレッドシートに記録する。
 * シート: 転送ログ
 * 列: [時刻, 記事名, ファイル名, サイズ(KB), ハッシュ, 結果, メモ]
 */

function appendLog(entry) {
  const sheet = getLogSheet_();
  sheet.appendRow([
    new Date(),
    entry.articleTitle || '',
    entry.fileName || '',
    entry.sizeBytes ? Math.round(entry.sizeBytes / 1024) : 0,
    entry.hash || '',
    entry.result || '',
    entry.note || '',
  ]);
}

function getLogSheet_() {
  const ss = SpreadsheetApp.openById(CONFIG.LOG_SPREADSHEET_ID);
  let sheet = ss.getSheetByName(CONFIG.LOG_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.LOG_SHEET_NAME);
    sheet.appendRow(['時刻', '記事名', 'ファイル名', 'サイズ(KB)', 'ハッシュ', '結果', 'メモ']);
    sheet.setFrozenRows(1);
  }
  return sheet;
}
