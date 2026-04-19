/**
 * Code.gs
 * ─────────────────────────────────────────────
 * blog-capture メインエントリポイント
 * - doGet(): PWAの配信 + APIエンドポイント（action=list, action=resumable-url）
 * - doPost(): 小ファイル（multipart）のアップロード受信
 */

/**
 * PWAの配信 or APIハンドラ
 */
function doGet(e) {
  // 認可は appsscript.json の webapp.access = "MYSELF" に一任
  // （Google側で自分のアカウント以外を実行不可にしている）
  const action = (e && e.parameter && e.parameter.action) || '';

  // ① APIアクション
  if (action === 'list-articles') {
    return jsonResponse_({ articles: listArticleFolders() });
  }
  if (action === 'resumable-url') {
    return handleResumableUrlRequest_(e);
  }

  // ② PWA配信（デフォルト）
  const template = HtmlService.createTemplateFromFile('index');
  template.gasWebAppUrl = ScriptApp.getService().getUrl();
  template.smallFileLimit = CONFIG.SMALL_FILE_LIMIT_BYTES;
  return template.evaluate()
    .setTitle('blog-capture')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .addMetaTag('theme-color', '#1a1a1a');
}

/**
 * 別のHTMLファイルをインラインで取り込むヘルパー
 * 使い方: <?!= include('styles'); ?>
 */
function include(fileName) {
  return HtmlService.createHtmlOutputFromFile(fileName).getContent();
}

/**
 * 小ファイル（multipart）のアップロード受信
 * 期待するパラメータ（application/x-www-form-urlencoded or multipart/form-data）:
 *  - articleTitle: string（記事タイトル。プレフィックス「【記事】」なし）
 *  - articleFolderId: string (optional, 既存選択時)
 *  - fileName: string
 *  - mimeType: string
 *  - capturedAt: ISO文字列 (optional)
 *  - fileData: base64エンコードされたファイル内容
 */
function doPost(e) {
  // 認可は appsscript.json の webapp.access = "MYSELF" に一任
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const payload = parsePayload_(e);
    if (!payload.fileName) {
      return jsonResponse_({ result: 'error', message: 'fileNameが必要です' });
    }
    if (!payload.fileData) {
      return jsonResponse_({ result: 'error', message: 'fileDataが必要です' });
    }

    // Blob生成
    const bytes = Utilities.base64Decode(payload.fileData);
    const blob = Utilities.newBlob(bytes, payload.mimeType || 'application/octet-stream', payload.fileName);

    // 記事フォルダ取得
    const folder = payload.articleFolderId
      ? getArticleFolderById(payload.articleFolderId)
      : getOrCreateArticleFolder(payload.articleTitle);

    // ハッシュチェック
    const hash = computeHash(blob);
    const existing = findByHash(hash);
    if (existing) {
      appendLog({
        articleTitle: payload.articleTitle || folder.getName(),
        fileName: payload.fileName,
        sizeBytes: bytes.length,
        hash: hash,
        result: '重複スキップ',
        note: '既存ファイルID: ' + existing.fileId,
      });
      return jsonResponse_({
        result: 'skipped',
        reason: 'duplicate',
        existingFileId: existing.fileId,
        hash: hash,
      });
    }

    // ファイル名正規化
    const capturedAt = payload.capturedAt ? new Date(payload.capturedAt) : new Date();
    const normalizedName = normalizeFilename(payload.fileName, capturedAt);
    const finalName = resolveFilenameConflict(folder, normalizedName);
    blob.setName(finalName);

    // Drive保存
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

    return jsonResponse_({
      result: 'success',
      fileId: file.getId(),
      fileName: finalName,
      articleFolderId: folder.getId(),
      articleFolderName: folder.getName(),
      hash: hash,
    });
  } catch (err) {
    Logger.log('doPost error: ' + err.message + '\n' + err.stack);
    appendLog({
      fileName: (e && e.parameter && e.parameter.fileName) || '(unknown)',
      result: 'エラー',
      note: err.message,
    });
    return jsonResponse_({ result: 'error', message: err.message });
  } finally {
    lock.releaseLock();
  }
}

// ─── Resumable URL発行ハンドラ ─────────────────────
function handleResumableUrlRequest_(e) {
  const p = e.parameter || {};
  if (!p.fileName || !p.totalBytes) {
    return jsonResponse_({ result: 'error', message: 'fileNameとtotalBytesが必要です' });
  }
  const folder = p.articleFolderId
    ? getArticleFolderById(p.articleFolderId)
    : getOrCreateArticleFolder(p.articleTitle);

  const capturedAt = p.capturedAt ? new Date(p.capturedAt) : new Date();
  const normalizedName = normalizeFilename(p.fileName, capturedAt);
  const finalName = resolveFilenameConflict(folder, normalizedName);

  try {
    const uploadUrl = startResumableUpload({
      articleFolderId: folder.getId(),
      fileName: finalName,
      mimeType: p.mimeType,
      totalBytes: Number(p.totalBytes),
    });
    return jsonResponse_({
      result: 'success',
      uploadUrl: uploadUrl,
      fileName: finalName,
      articleFolderId: folder.getId(),
      articleFolderName: folder.getName(),
    });
  } catch (err) {
    return jsonResponse_({ result: 'error', message: err.message });
  }
}

// ─── ペイロード解析 ─────────────────────
function parsePayload_(e) {
  // パラメータ優先（multipart/form-data 解析済みの値）
  if (e.parameter && Object.keys(e.parameter).length > 0) {
    return e.parameter;
  }
  // JSONの場合
  if (e.postData && e.postData.type === 'application/json') {
    return JSON.parse(e.postData.contents);
  }
  return {};
}

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}
