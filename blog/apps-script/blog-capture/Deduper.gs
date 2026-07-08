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
 * 🛡 2026-07-09改定：重複判定は「同じ記事フォルダ内」に限定する。
 * 旧実装は全記事横断で照合していたため、別記事で同じ画像を使うと
 * 「重複スキップ」されて新しい記事に保存されない事故が起きていた。
 * さらに、台帳のファイルがDrive上で削除済みなら「重複ではない」として扱う
 * （削除→再アップロードができない問題への対策）。
 * @param {string} hash
 * @param {string} articleFolderId - この記事フォルダ内の重複だけを探す（省略時は従来通り全体）
 * @return {Object|null} 見つかればレコード、無ければnull
 */
function findByHash(hash, articleFolderId) {
  const sheet = getHashSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  const values = sheet.getRange(2, 1, lastRow - 1, 5).getValues();
  for (let i = 0; i < values.length; i++) {
    if (values[i][0] !== hash) continue;
    if (articleFolderId && values[i][3] !== articleFolderId) continue; // 別記事の同一画像は重複扱いしない
    const record = {
      hash: values[i][0],
      fileId: values[i][1],
      fileName: values[i][2],
      articleFolderId: values[i][3],
      uploadedAt: values[i][4],
    };
    // 🛡 台帳の残骸チェック：実ファイルが削除済み/ゴミ箱なら重複扱いしない
    try {
      const f = DriveApp.getFileById(record.fileId);
      if (f.isTrashed()) continue;
    } catch (e) {
      continue; // 取得できない＝削除済み → 重複ではない
    }
    return record;
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
