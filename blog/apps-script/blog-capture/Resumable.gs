/**
 * Resumable.gs
 * ─────────────────────────────────────────────
 * 大容量ファイル（20MB超）用のResumable Upload URLを発行する。
 * PWAはこのURLに直接 PUT で8MBチャンク送信する。
 * 参考: https://developers.google.com/drive/api/guides/manage-uploads#resumable
 */

/**
 * Resumable Upload セッションを開始してURLを返す
 * @param {Object} params
 *  - articleFolderId: string
 *  - fileName: string (正規化済み)
 *  - mimeType: string
 *  - totalBytes: number
 * @return {string} resumable upload URL
 */
function startResumableUpload(params) {
  if (!params.articleFolderId || !params.fileName) {
    throw new Error('articleFolderIdとfileNameは必須');
  }
  const metadata = {
    name: params.fileName,
    parents: [params.articleFolderId],
    mimeType: params.mimeType || 'application/octet-stream',
  };
  const response = UrlFetchApp.fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable',
    {
      method: 'post',
      contentType: 'application/json; charset=UTF-8',
      headers: {
        Authorization: 'Bearer ' + ScriptApp.getOAuthToken(),
        'X-Upload-Content-Type': params.mimeType || 'application/octet-stream',
        'X-Upload-Content-Length': String(params.totalBytes || 0),
      },
      payload: JSON.stringify(metadata),
      muteHttpExceptions: true,
    }
  );
  if (response.getResponseCode() !== 200) {
    throw new Error('Resumable URL発行失敗: ' + response.getResponseCode() + ' ' + response.getContentText());
  }
  const headers = response.getHeaders();
  // GoogleはLocationヘッダでupload URLを返す
  const uploadUrl = headers['Location'] || headers['location'];
  if (!uploadUrl) {
    throw new Error('Location header not found');
  }
  return uploadUrl;
}

/**
 * 複数ファイル分のResumable UploadセッションをGoogleへ並列発行する。
 * 画像本体は含めず、軽いメタデータだけを送る。
 * @param {Array<Object>} paramsList
 * @return {Array<{ok:boolean, uploadUrl?:string, message?:string}>}
 */
function startResumableUploadsBatch(paramsList) {
  if (!Array.isArray(paramsList) || paramsList.length === 0 || paramsList.length > 6) {
    throw new Error('一括セッション数は1〜6件です');
  }
  const token = ScriptApp.getOAuthToken();
  const endpoint = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,mimeType,size';
  const requests = paramsList.map(function (params) {
    if (!params.articleFolderId || !params.fileName) throw new Error('articleFolderIdとfileNameは必須');
    return {
      url: endpoint,
      method: 'post',
      contentType: 'application/json; charset=UTF-8',
      headers: {
        Authorization: 'Bearer ' + token,
        'X-Upload-Content-Type': params.mimeType || 'application/octet-stream',
        'X-Upload-Content-Length': String(params.totalBytes || 0),
      },
      payload: JSON.stringify({
        name: params.fileName,
        parents: [params.articleFolderId],
        mimeType: params.mimeType || 'application/octet-stream',
      }),
      muteHttpExceptions: true,
    };
  });
  return UrlFetchApp.fetchAll(requests).map(function (response) {
    if (response.getResponseCode() !== 200) {
      return { ok: false, message: 'セッション発行失敗: ' + response.getResponseCode() };
    }
    const headers = response.getHeaders();
    const uploadUrl = headers['Location'] || headers['location'];
    return uploadUrl ? { ok: true, uploadUrl: uploadUrl } : { ok: false, message: 'Location header not found' };
  });
}
