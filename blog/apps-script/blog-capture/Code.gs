/**
 * Code.gs
 * ─────────────────────────────────────────────
 * blog-capture メインエントリポイント
 * - doGet(): PWA配信
 * - google.script.run経由のAPI:
 *    - listArticleFoldersApi()
 *    - uploadSmallFileApi(payload)
 *    - requestResumableUrlApi(params)
 */

function doGet(e) {
  const template = HtmlService.createTemplateFromFile('index');
  template.smallFileLimit = CONFIG.SMALL_FILE_LIMIT_BYTES;
  return template.evaluate()
    .setTitle('blog-capture')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * HTMLインクルードヘルパー
 */
function include(fileName) {
  return HtmlService.createHtmlOutputFromFile(fileName).getContent();
}

// ─── google.script.run 用 API ─────────────────────

/**
 * 記事フォルダ一覧を取得（PWAから呼び出し）
 */
function listArticleFoldersApi() {
  try {
    return { ok: true, articles: listArticleFolders() };
  } catch (err) {
    return { ok: false, message: err.message };
  }
}

/**
 * 小ファイルアップロード（〜20MB, base64で受信）
 * @param {Object} payload
 *   - articleTitle: string
 *   - articleFolderId: string (optional)
 *   - fileName: string
 *   - mimeType: string
 *   - capturedAt: ISO string (optional)
 *   - fileDataBase64: string
 */
function uploadSmallFileApi(payload) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    if (!payload || !payload.fileName) return { ok: false, message: 'fileNameが必要' };
    if (!payload.fileDataBase64) return { ok: false, message: 'fileDataBase64が必要' };

    const bytes = Utilities.base64Decode(payload.fileDataBase64);
    const blob = Utilities.newBlob(bytes, payload.mimeType || 'application/octet-stream', payload.fileName);

    const folder = payload.articleFolderId
      ? getArticleFolderById(payload.articleFolderId)
      : getOrCreateArticleFolder(payload.articleTitle);

    const hash = computeHash(blob);
    const existing = findByHash(hash);
    if (existing) {
      appendLog({
        articleTitle: folder.getName(),
        fileName: payload.fileName,
        sizeBytes: bytes.length,
        hash: hash,
        result: '重複スキップ',
        note: '既存ファイルID: ' + existing.fileId,
      });
      return { ok: true, result: 'skipped', existingFileId: existing.fileId, hash };
    }

    const capturedAt = payload.capturedAt ? new Date(payload.capturedAt) : new Date();
    const normalizedName = normalizeFilename(payload.fileName, capturedAt);
    const finalName = resolveFilenameConflict(folder, normalizedName);
    blob.setName(finalName);

    const file = folder.createFile(blob);
    addHashRecord(hash, file.getId(), finalName, folder.getId());
    appendLog({
      articleTitle: folder.getName(),
      fileName: finalName,
      sizeBytes: bytes.length,
      hash: hash,
      result: '成功',
      note: '',
    });

    return {
      ok: true,
      result: 'success',
      fileId: file.getId(),
      fileName: finalName,
      articleFolderId: folder.getId(),
      articleFolderName: folder.getName(),
      hash: hash,
    };
  } catch (err) {
    Logger.log('uploadSmallFileApi error: ' + err.message + '\n' + err.stack);
    appendLog({
      fileName: (payload && payload.fileName) || '(unknown)',
      result: 'エラー',
      note: err.message,
    });
    return { ok: false, message: err.message };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Resumable Upload URL を発行（大容量ファイル用）
 * @param {Object} params
 *   - articleTitle / articleFolderId
 *   - fileName
 *   - mimeType
 *   - totalBytes
 *   - capturedAt (optional)
 */
function requestResumableUrlApi(params) {
  try {
    if (!params || !params.fileName || !params.totalBytes) {
      return { ok: false, message: 'fileNameとtotalBytesが必要' };
    }
    const folder = params.articleFolderId
      ? getArticleFolderById(params.articleFolderId)
      : getOrCreateArticleFolder(params.articleTitle);

    const capturedAt = params.capturedAt ? new Date(params.capturedAt) : new Date();
    const normalizedName = normalizeFilename(params.fileName, capturedAt);
    const finalName = resolveFilenameConflict(folder, normalizedName);

    const uploadUrl = startResumableUpload({
      articleFolderId: folder.getId(),
      fileName: finalName,
      mimeType: params.mimeType,
      totalBytes: Number(params.totalBytes),
    });
    return {
      ok: true,
      uploadUrl: uploadUrl,
      fileName: finalName,
      articleFolderId: folder.getId(),
      articleFolderName: folder.getName(),
    };
  } catch (err) {
    return { ok: false, message: err.message };
  }
}
