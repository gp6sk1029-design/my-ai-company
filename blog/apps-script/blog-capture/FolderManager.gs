/**
 * FolderManager.gs
 * ─────────────────────────────────────────────
 * 「ブロブ関連」配下の記事フォルダを管理する。
 * 既存命名規則「【記事】◯◯」を保ち、無い場合のみ新規作成。
 */

/**
 * 既存の記事フォルダ一覧を返す（ドロップダウン用）
 * @return {Array<{id: string, name: string, articleTitle: string}>}
 */
function listArticleFolders() {
  const root = DriveApp.getFolderById(CONFIG.ROOT_FOLDER_ID);
  const folders = root.getFolders();
  const result = [];
  while (folders.hasNext()) {
    const folder = folders.next();
    const name = folder.getName();
    if (name.startsWith(CONFIG.ARTICLE_PREFIX)) {
      result.push({
        id: folder.getId(),
        name: name,
        articleTitle: name.substring(CONFIG.ARTICLE_PREFIX.length),
      });
    }
  }
  // 名前順ソート
  result.sort((a, b) => a.name.localeCompare(b.name, 'ja'));
  return result;
}

/**
 * 記事タイトルから記事フォルダを取得（無ければ作成）
 * @param {string} articleTitle - 「Venu2s」や「Garmin Venu 2S レビュー」等（プレフィックスなし）
 * @return {GoogleAppsScript.Drive.Folder}
 */
function getOrCreateArticleFolder(articleTitle) {
  if (!articleTitle || typeof articleTitle !== 'string') {
    throw new Error('articleTitleが不正です: ' + articleTitle);
  }
  const normalizedTitle = articleTitle.trim();
  const folderName = CONFIG.ARTICLE_PREFIX + normalizedTitle;
  const root = DriveApp.getFolderById(CONFIG.ROOT_FOLDER_ID);

  // 既存検索
  const existing = root.getFoldersByName(folderName);
  if (existing.hasNext()) {
    return existing.next();
  }
  // 新規作成
  const folder = root.createFolder(folderName);
  Logger.log('📁 新規フォルダ作成: ' + folderName);
  return folder;
}

/**
 * 記事フォルダIDを直接指定して取得（ドロップダウン選択時）
 * @param {string} folderId
 * @return {GoogleAppsScript.Drive.Folder}
 */
function getArticleFolderById(folderId) {
  const folder = DriveApp.getFolderById(folderId);
  // ブロブ関連の配下であることを念のため検証
  const parents = folder.getParents();
  if (!parents.hasNext() || parents.next().getId() !== CONFIG.ROOT_FOLDER_ID) {
    throw new Error('指定フォルダはブロブ関連の直下にありません');
  }
  return folder;
}
