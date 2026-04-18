/**
 * Deduper.gs
 * ─────────────────────────────────────────────
 * SHA-256ハッシュでファイルの重複を検出する。
 * ハッシュ台帳はスプレッドシートのシート「ハッシュ台帳」に保存。
 * 構造: [hash, fileId, fileName, articleFolderId, uploadedAt]
 */

/**
 * Blobのハッシュを計算
 * @param {GoogleAppsScript.Base.Blob} blob
 * @return {string} hex形式のSHA-256
 */
function computeHash(blob) {
  const bytes = blob.getBytes();
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes);
  return digest
    .map((b) => ((b & 0xff) + 0x100).toString(16).slice(1))
    .join('');
}

/**
 * ハッシュ台帳で既存チェック
 * @param {string} hash
 * @return {Object|null} 見つかればレコード、無ければnull
 */
function findByHash(hash) {
  const sheet = getHashSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  const values = sheet.getRange(2, 1, lastRow - 1, 5).getValues();
  for (let i = 0; i < values.length; i++) {
    if (values[i][0] === hash) {
      return {
        hash: values[i][0],
        fileId: values[i][1],
        fileName: values[i][2],
        articleFolderId: values[i][3],
        uploadedAt: values[i][4],
      };
    }
  }
  return null;
}

/**
 * ハッシュ台帳に追加
 */
function addHashRecord(hash, fileId, fileName, articleFolderId) {
  const sheet = getHashSheet_();
  sheet.appendRow([hash, fileId, fileName, articleFolderId, new Date()]);
}

function getHashSheet_() {
  const ss = SpreadsheetApp.openById(CONFIG.LOG_SPREADSHEET_ID);
  let sheet = ss.getSheetByName(CONFIG.HASH_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.HASH_SHEET_NAME);
    sheet.appendRow(['hash', 'fileId', 'fileName', 'articleFolderId', 'uploadedAt']);
    sheet.setFrozenRows(1);
  }
  return sheet;
}
