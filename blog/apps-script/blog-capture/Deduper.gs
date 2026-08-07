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
 * 高速一括転送用：同一記事内の複数ハッシュを、台帳1回の読み込みでまとめて照合する。
 * 見つかった候補だけDriveの存在確認を行うため、画像ごとのスプレッドシート往復を避けられる。
 * @param {Array<string>} hashes
 * @param {string} articleFolderId
 * @return {Object<string, Object>} hashをキーにした既存レコード
 */
function findByHashesInFolder_(hashes, articleFolderId) {
  const wanted = {};
  (hashes || []).forEach(function (hash) {
    if (hash) wanted[String(hash)] = true;
  });
  if (Object.keys(wanted).length === 0) return {};

  const sheet = getHashSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return {};
  const values = sheet.getRange(2, 1, lastRow - 1, 5).getValues();
  const found = {};
  for (let i = 0; i < values.length; i++) {
    const hash = values[i][0];
    if (!wanted[hash] || found[hash]) continue;
    if (articleFolderId && values[i][3] !== articleFolderId) continue;
    try {
      const file = DriveApp.getFileById(values[i][1]);
      if (file.isTrashed()) continue;
      found[hash] = {
        hash: hash,
        fileId: values[i][1],
        fileName: values[i][2],
        articleFolderId: values[i][3],
        uploadedAt: values[i][4],
      };
    } catch (_) {
      // 削除済みの台帳行は重複扱いしない。
    }
  }
  return found;
}

/**
 * ハッシュ台帳に追加
 */
function addHashRecord(hash, fileId, fileName, articleFolderId) {
  const sheet = getHashSheet_();
  sheet.appendRow([hash, fileId, fileName, articleFolderId, new Date()]);
}

/**
 * ハッシュ台帳の記事フォルダ紐づけを更新（ファイルを別記事へ移動した時に使う）
 * 台帳が古いままだと、移動先での重複判定が効かず・移動元で誤スキップが起きる。
 */
function updateHashRecordFolder(fileId, newFolderId) {
  const sheet = getHashSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  const values = sheet.getRange(2, 2, lastRow - 1, 1).getValues(); // fileId列
  for (let i = 0; i < values.length; i++) {
    if (values[i][0] === fileId) {
      sheet.getRange(i + 2, 4).setValue(newFolderId); // articleFolderId列
    }
  }
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
