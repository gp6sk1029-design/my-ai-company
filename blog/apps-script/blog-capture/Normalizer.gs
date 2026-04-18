/**
 * Normalizer.gs
 * ─────────────────────────────────────────────
 * ファイル名を既存ルール「YYYYMMDD_HHMMSS.{ext}」に正規化する。
 */

/**
 * ファイル名を正規化
 * @param {string} originalName - 元のファイル名
 * @param {Date} [capturedAt] - 撮影日時（指定なしなら現在時刻）
 * @return {string} 例: "20260419_023045.jpg"
 */
function normalizeFilename(originalName, capturedAt) {
  const ext = getExtension(originalName);
  const date = capturedAt || new Date();
  const timestamp = formatTimestamp(date);
  return timestamp + '.' + ext;
}

/**
 * 衝突した場合は枝番を付与
 * @param {GoogleAppsScript.Drive.Folder} folder
 * @param {string} baseName
 * @return {string} 衝突しないファイル名
 */
function resolveFilenameConflict(folder, baseName) {
  let candidate = baseName;
  let counter = 1;
  const dotIdx = baseName.lastIndexOf('.');
  const stem = dotIdx > 0 ? baseName.substring(0, dotIdx) : baseName;
  const ext = dotIdx > 0 ? baseName.substring(dotIdx) : '';

  while (folder.getFilesByName(candidate).hasNext()) {
    candidate = stem + '_' + String(counter).padStart(2, '0') + ext;
    counter++;
    if (counter > 99) {
      throw new Error('ファイル名衝突が多すぎます: ' + baseName);
    }
  }
  return candidate;
}

function getExtension(filename) {
  const idx = filename.lastIndexOf('.');
  if (idx <= 0) return 'bin';
  return filename.substring(idx + 1).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function formatTimestamp(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return (
    date.getFullYear() +
    pad(date.getMonth() + 1) +
    pad(date.getDate()) +
    '_' +
    pad(date.getHours()) +
    pad(date.getMinutes()) +
    pad(date.getSeconds())
  );
}
