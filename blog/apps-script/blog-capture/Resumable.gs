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
