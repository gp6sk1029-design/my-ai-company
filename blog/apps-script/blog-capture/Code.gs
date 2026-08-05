/**
 * Code.gs
 * ─────────────────────────────────────────────
 * blog-capture API（Cloudflare PWA から呼ばれるバックエンド）
 * - 認可は共有トークン方式（値はScript Propertiesで管理）
 * - CORS: x-www-form-urlencoded / GET でのみ呼ばれる前提（preflight不要）
 * - GAS Web App の access: ANYONE_ANONYMOUS
 */

function doGet(e) {
  const p = (e && e.parameter) || {};
  if (!verifyToken_(p.token)) return jsonResponse_({ ok: false, message: 'unauthorized' });

  switch (p.action) {
    case 'listArticles':
      return jsonResponse_({ ok: true, articles: listArticleFolders() });
    case 'resumableUrl':
      return handleResumableUrl_(p);
    case 'getPrompt':
      return handleGetPrompt_(p);
    case 'listArticleFiles':
      return handleListArticleFiles_(p);
    case 'downloadFile':
      return handleDownloadFile_(p);
    case 'getProductInfo':
      return handleGetProductInfo_(p);
    case 'getAIConnections':
      return handleGetAIConnections_();
    case 'ping':
      return jsonResponse_({ ok: true, time: new Date().toISOString() });
    default:
      return jsonResponse_({ ok: false, message: 'unknown action: ' + p.action });
  }
}

function doPost(e) {
  const p = (e && e.parameter) || {};
  if (!verifyToken_(p.token)) return jsonResponse_({ ok: false, message: 'unauthorized' });

  if (p.action === 'uploadSmall') return handleUploadSmall_(p);
  if (p.action === 'savePrompt') return handleSavePrompt_(p);
  if (p.action === 'replaceFile') return handleReplaceFile_(p);
  if (p.action === 'renameArticle') return handleRenameArticle_(p);
  if (p.action === 'createArticle') return handleCreateArticle_(p);
  if (p.action === 'renameFile') return handleRenameFile_(p);
  if (p.action === 'transferFile') return handleTransferFile_(p);
  if (p.action === 'deleteFile') return handleDeleteFile_(p);
  if (p.action === 'saveProductInfo') return handleSaveProductInfo_(p);
  if (p.action === 'saveAIConnections') return handleSaveAIConnections_(p);
  return jsonResponse_({ ok: false, message: 'unknown action: ' + p.action });
}

// ─── 端末共通のAI接続先設定（Google Drive） ─────────────────────
// 保存対象はChatGPT/GeminiのURLとCodexのSNS統括PDMタスクIDだけ。PC固有の
// Codexパス、フォルダ権限、トークンなどは端末内またはScript Propertiesに残す。
function normalizeAIConnections_(value) {
  const source = value && typeof value === 'object' ? value : {};
  const chatgptUrl = String(source.chatgptUrl || '').trim();
  const geminiUrl = String(source.geminiUrl || '').trim();
  const codexSnsThreadId = String(source.codexSnsThreadId || '').trim();
  if (chatgptUrl && !/^https?:\/\/(?:chat\.openai\.com|chatgpt\.com)\//i.test(chatgptUrl)) {
    throw new Error('ChatGPT URLの形式が不正です');
  }
  if (geminiUrl && !/^https?:\/\/(?:gemini\.google\.com|aistudio\.google\.com)\//i.test(geminiUrl)) {
    throw new Error('Gemini URLの形式が不正です');
  }
  if (chatgptUrl.length > 2048 || geminiUrl.length > 2048) {
    throw new Error('URLが長すぎます');
  }
  if (codexSnsThreadId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(codexSnsThreadId)) {
    throw new Error('CodexのSNS統括PDMタスクIDの形式が不正です');
  }
  return { chatgptUrl: chatgptUrl, geminiUrl: geminiUrl, codexSnsThreadId: codexSnsThreadId };
}

function getAIConnectionsFile_() {
  const root = DriveApp.getFolderById(CONFIG.ROOT_FOLDER_ID);
  const files = root.getFilesByName(CONFIG.AI_CONNECTIONS_FILE_NAME);
  return files.hasNext() ? files.next() : null;
}

function handleGetAIConnections_() {
  try {
    const file = getAIConnectionsFile_();
    if (!file) return jsonResponse_({ ok: true, exists: false, settings: {} });
    const parsed = JSON.parse(file.getBlob().getDataAsString('UTF-8'));
    return jsonResponse_({ ok: true, exists: true, settings: normalizeAIConnections_(parsed) });
  } catch (err) {
    Logger.log('handleGetAIConnections_ error: ' + err.message);
    return jsonResponse_({ ok: false, message: err.message });
  }
}

function handleSaveAIConnections_(p) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    let parsed = {};
    try { parsed = JSON.parse(p.settingsJson || '{}'); } catch (_) {
      return jsonResponse_({ ok: false, message: '設定データの形式が不正です' });
    }
    const settings = normalizeAIConnections_(parsed);
    const content = JSON.stringify({
      schemaVersion: 1,
      updatedAt: new Date().toISOString(),
      chatgptUrl: settings.chatgptUrl,
      geminiUrl: settings.geminiUrl,
      codexSnsThreadId: settings.codexSnsThreadId,
    }, null, 2);
    const root = DriveApp.getFolderById(CONFIG.ROOT_FOLDER_ID);
    let file = getAIConnectionsFile_();
    if (file) {
      file.setContent(content);
    } else {
      file = root.createFile(Utilities.newBlob(content, 'application/json', CONFIG.AI_CONNECTIONS_FILE_NAME));
    }
    return jsonResponse_({ ok: true, settings: settings, updatedAt: new Date().toISOString() });
  } catch (err) {
    Logger.log('handleSaveAIConnections_ error: ' + err.message);
    return jsonResponse_({ ok: false, message: err.message });
  } finally {
    lock.releaseLock();
  }
}

// ─── ファイル削除（ゴミ箱へ移動・2026-07-11） ─────────────────────
// 完全削除はしない（setTrashed＝Driveのゴミ箱行き。30日以内なら復元可能）。
// 誤削除防止のため「指定した記事フォルダ内のファイル」しか消せない。
function handleDeleteFile_(p) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    if (!p.fileId || !p.articleFolderId) {
      return jsonResponse_({ ok: false, message: 'fileId/articleFolderId required' });
    }
    const folder = getArticleFolderById(p.articleFolderId);
    const file = DriveApp.getFileById(p.fileId);
    let inFolder = false;
    const parents = file.getParents();
    while (parents.hasNext()) {
      if (parents.next().getId() === folder.getId()) { inFolder = true; break; }
    }
    if (!inFolder) return jsonResponse_({ ok: false, message: '対象ファイルが指定の記事フォルダにありません（誤削除防止のため中止）' });
    const name = file.getName();
    file.setTrashed(true);
    appendLog({
      articleTitle: folder.getName(),
      fileName: name,
      sizeBytes: 0,
      result: '削除（ゴミ箱へ）',
      note: 'fileId=' + p.fileId,
    });
    return jsonResponse_({ ok: true, result: 'trashed', fileId: p.fileId, fileName: name });
  } catch (err) {
    Logger.log('handleDeleteFile_ error: ' + err.message);
    return jsonResponse_({ ok: false, message: err.message });
  } finally {
    lock.releaseLock();
  }
}

// ─── ファイルを別の記事フォルダへコピー/移動（2026-07-09） ─────────────────────
// 安全ルール：
// - 移動元・移動先とも「ブロブ関連」直下の記事フォルダであること（getArticleFolderByIdで検証）
// - 対象ファイルが移動元フォルダ内にあることを確認してから実行（別記事の誤操作防止）
// - ユニーク役割（1記事1枚：eyecatch/hero/comparetable/ngsummary）が移動先に既にある場合は
//   プレフィックスを外して転送し、strippedRole で通知（移動先の既存を壊さない）
function handleTransferFile_(p) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    if (!p.fileId || !p.fromFolderId || !p.toFolderId) {
      return jsonResponse_({ ok: false, message: 'fileId/fromFolderId/toFolderId required' });
    }
    if (p.fromFolderId === p.toFolderId) {
      return jsonResponse_({ ok: false, message: '移動元と移動先が同じ記事です' });
    }
    const mode = p.mode === 'move' ? 'move' : 'copy';
    const fromFolder = getArticleFolderById(p.fromFolderId);
    const toFolder = getArticleFolderById(p.toFolderId);
    const file = DriveApp.getFileById(p.fileId);
    let inFrom = false;
    const parents = file.getParents();
    while (parents.hasNext()) {
      if (parents.next().getId() === fromFolder.getId()) { inFrom = true; break; }
    }
    if (!inFrom) return jsonResponse_({ ok: false, message: '対象ファイルが移動元の記事フォルダにありません' });

    let name = file.getName();
    let strippedRole = '';
    const um = /^(eyecatch_|hero_|comparetable_|ngsummary_)/i.exec(name);
    if (um) {
      const re = new RegExp('^' + um[1], 'i');
      const it = toFolder.getFiles();
      while (it.hasNext()) {
        if (re.test(it.next().getName())) { strippedRole = um[1]; name = name.replace(re, ''); break; }
      }
    }
    const finalName = resolveFilenameConflict(toFolder, name);

    let newFile;
    if (mode === 'move') {
      if (finalName !== file.getName()) file.setName(finalName);
      file.moveTo(toFolder);
      newFile = file;
      // ハッシュ台帳の紐づけも移動先へ更新（重複判定が記事単位のため）
      try { updateHashRecordFolder(file.getId(), toFolder.getId()); } catch (e) {
        Logger.log('updateHashRecordFolder failed: ' + e.message);
      }
    } else {
      newFile = file.makeCopy(finalName, toFolder);
      // コピー先でも重複判定が効くよう台帳に登録
      try { addHashRecord(computeHash(newFile.getBlob()), newFile.getId(), finalName, toFolder.getId()); } catch (e) {
        Logger.log('addHashRecord(copy) failed: ' + e.message);
      }
    }
    appendLog({
      articleTitle: toFolder.getName(),
      fileName: finalName,
      sizeBytes: 0,
      result: mode === 'move' ? '別記事へ移動' : '別記事へコピー',
      note: 'from=' + fromFolder.getName() + (strippedRole ? ' 役割解除=' + strippedRole : ''),
    });
    return jsonResponse_({
      ok: true,
      result: mode === 'move' ? 'moved' : 'copied',
      fileId: newFile.getId(),
      fileName: finalName,
      toFolderId: toFolder.getId(),
      toFolderName: toFolder.getName(),
      strippedRole: strippedRole,
    });
  } catch (err) {
    Logger.log('handleTransferFile_ error: ' + err.message + '\n' + err.stack);
    return jsonResponse_({ ok: false, message: err.message });
  } finally {
    lock.releaseLock();
  }
}

// ─── ファイル名変更（画像の役割変更用） ─────────────────────
// 安全のため「指定した記事フォルダ直下にあるファイル」しかリネームできない
function handleRenameFile_(p) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    if (!p.fileId || !p.newName || !p.articleFolderId) {
      return jsonResponse_({ ok: false, message: 'fileId/newName/articleFolderId required' });
    }
    const folder = getArticleFolderById(p.articleFolderId);
    const file = DriveApp.getFileById(p.fileId);
    // 親フォルダ検証（記事フォルダ外のファイルは触らせない）
    let inFolder = false;
    const parents = file.getParents();
    while (parents.hasNext()) {
      if (parents.next().getId() === folder.getId()) { inFolder = true; break; }
    }
    if (!inFolder) return jsonResponse_({ ok: false, message: 'file is not in the article folder' });
    let newName = String(p.newName).replace(/[\\/:*?"<>|]/g, '').trim();
    if (!newName) return jsonResponse_({ ok: false, message: 'invalid newName' });
    if (newName !== file.getName()) {
      newName = resolveFilenameConflict(folder, newName);
      file.setName(newName);
    }
    appendLog({
      articleTitle: folder.getName(),
      fileName: newName,
      sizeBytes: 0,
      result: 'リネーム（役割変更）',
      note: 'fileId=' + p.fileId,
    });
    return jsonResponse_({ ok: true, result: 'renamed', fileId: p.fileId, fileName: newName });
  } catch (err) {
    Logger.log('handleRenameFile_ error: ' + err.message);
    return jsonResponse_({ ok: false, message: err.message });
  } finally {
    lock.releaseLock();
  }
}

// ─── 記事フォルダだけを作成（転送を待たずに先行作成） ─────────────────────
// 命名規則「【記事】◯◯」を必ず付与。既存があれば再利用してそのIDを返す。
function handleCreateArticle_(p) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    if (!p.articleTitle || !p.articleTitle.trim()) {
      return jsonResponse_({ ok: false, message: 'articleTitle required' });
    }
    // prefix を全て剥がしてから1個だけ付ける（重複防止）
    let base = p.articleTitle.trim();
    while (base.indexOf(CONFIG.ARTICLE_PREFIX) === 0) {
      base = base.substring(CONFIG.ARTICLE_PREFIX.length).trim();
    }
    if (!base) return jsonResponse_({ ok: false, message: 'prefix を除いた本体名が空です' });
    // getOrCreateArticleFolder は prefix なしの本体名を受け取って内部で prefix を付与する
    const folder = getOrCreateArticleFolder(base);
    appendLog({
      articleTitle: folder.getName(),
      fileName: '(create)',
      result: '記事フォルダ作成',
      note: 'folderId=' + folder.getId(),
    });
    return jsonResponse_({
      ok: true,
      result: 'created',
      articleFolderId: folder.getId(),
      articleFolderName: folder.getName(),
    });
  } catch (err) {
    Logger.log('handleCreateArticle_ error: ' + err.message + '\n' + err.stack);
    return jsonResponse_({ ok: false, message: err.message });
  } finally {
    lock.releaseLock();
  }
}

// ─── 記事フォルダ名の変更 ─────────────────────
// 命名規則「【記事】◯◯」を必ず維持する。ユーザーが prefix を付け忘れたり外したりしても自動補正
function handleRenameArticle_(p) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    if (!p.articleFolderId) return jsonResponse_({ ok: false, message: 'articleFolderId required' });
    if (!p.newName || !p.newName.trim()) return jsonResponse_({ ok: false, message: 'newName required' });
    const folder = getArticleFolderById(p.articleFolderId);
    const oldName = folder.getName();
    let newName = p.newName.trim();
    // 末尾の prefix が複数付くのを防ぐため、まず全ての prefix を剥がしてから1個だけ付ける
    while (newName.indexOf(CONFIG.ARTICLE_PREFIX) === 0) {
      newName = newName.substring(CONFIG.ARTICLE_PREFIX.length).trim();
    }
    if (!newName) return jsonResponse_({ ok: false, message: 'prefix を除いた本体名が空です' });
    newName = CONFIG.ARTICLE_PREFIX + newName;

    if (oldName === newName) {
      return jsonResponse_({ ok: true, result: 'unchanged', articleFolderId: folder.getId(), articleFolderName: oldName });
    }
    // 同一親フォルダ内に同名が既に存在するかチェック
    const parents = folder.getParents();
    if (parents.hasNext()) {
      const parent = parents.next();
      const it = parent.getFoldersByName(newName);
      if (it.hasNext()) {
        const dupe = it.next();
        if (dupe.getId() !== folder.getId()) {
          return jsonResponse_({ ok: false, message: '同名の記事フォルダが既に存在します: ' + newName });
        }
      }
    }
    folder.setName(newName);
    appendLog({
      articleTitle: newName,
      fileName: '(rename)',
      result: '記事名変更',
      note: 'from=' + oldName + ' to=' + newName + ' folderId=' + folder.getId(),
    });
    return jsonResponse_({
      ok: true,
      result: 'renamed',
      articleFolderId: folder.getId(),
      articleFolderName: newName,
      oldName: oldName,
    });
  } catch (err) {
    Logger.log('handleRenameArticle_ error: ' + err.message + '\n' + err.stack);
    return jsonResponse_({ ok: false, message: err.message });
  } finally {
    lock.releaseLock();
  }
}

// ─── 破損した記事フォルダ（prefixが外れたフォルダ）を修復する管理用関数 ─────────────
// PWA からの過去の名前変更で prefix が外れたフォルダがあれば、ID指定で復元できる
// ※ GAS エディタから直接 fixOrphanedFolder('FOLDER_ID', 'MX ERGO S 設定') を呼ぶ用途
function fixOrphanedFolder(folderId, baseTitle) {
  const folder = DriveApp.getFolderById(folderId);
  const parents = folder.getParents();
  if (!parents.hasNext()) throw new Error('親フォルダがありません');
  const parent = parents.next();
  if (parent.getId() !== CONFIG.ROOT_FOLDER_ID) {
    throw new Error('ブロブ関連の直下にありません。手動で移動してから実行してください');
  }
  const newName = CONFIG.ARTICLE_PREFIX + (baseTitle || folder.getName()).trim();
  folder.setName(newName);
  Logger.log('✅ 修復完了: ' + folder.getName());
  return newName;
}

// ─── ファイル本体ダウンロード（PWAへbase64返却・再編集用） ─────────────────────
// Driveへ直接fetchするとCORSで失敗するので GAS を経由してbase64で受け渡す
function handleDownloadFile_(p) {
  try {
    if (!p.fileId) return jsonResponse_({ ok: false, message: 'fileId required' });
    const file = DriveApp.getFileById(p.fileId);
    const blob = file.getBlob();
    const bytes = blob.getBytes();
    // 10MB超は base64 化で重くなるので警告だけ出す（必要なら chunked download に変更）
    if (bytes.length > 10 * 1024 * 1024) {
      Logger.log('downloadFile warning: large file ' + bytes.length + ' bytes for ' + file.getName());
    }
    const b64 = Utilities.base64Encode(bytes);
    return jsonResponse_({
      ok: true,
      fileId: p.fileId,
      fileName: file.getName(),
      mimeType: blob.getContentType(),
      size: bytes.length,
      dataBase64: b64,
    });
  } catch (err) {
    Logger.log('handleDownloadFile_ error: ' + err.message);
    return jsonResponse_({ ok: false, message: err.message });
  }
}

// ─── フォルダ内ファイル一覧（既存画像の再編集用） ─────────────────────
function handleListArticleFiles_(p) {
  try {
    if (!p.articleFolderId) return jsonResponse_({ ok: false, message: 'articleFolderId required' });
    const folder = getArticleFolderById(p.articleFolderId);
    const out = [];
    const it = folder.getFiles();
    while (it.hasNext()) {
      const f = it.next();
      const mime = f.getMimeType();
      const name = f.getName();
      const isImg = mime && mime.indexOf('image/') === 0;
      // 画像のみ返す（PROMPT.md は別アクション getPrompt で扱う）
      if (!isImg) continue;
      out.push({
        id: f.getId(),
        name: name,
        mimeType: mime,
        size: f.getSize(),
        modifiedTime: f.getLastUpdated().toISOString(),
        // Drive サムネ（PWAから直接 <img src> で参照可能）
        thumbnailUrl: 'https://drive.google.com/thumbnail?id=' + f.getId() + '&sz=w400',
      });
    }
    // 更新日時の降順
    out.sort(function (a, b) { return a.modifiedTime < b.modifiedTime ? 1 : -1; });
    return jsonResponse_({ ok: true, files: out });
  } catch (err) {
    return jsonResponse_({ ok: false, message: err.message });
  }
}

// ─── 既存ファイルの中身を上書き保存（fileId は同じファイル名でリネーム） ─────────────
// 実装: 元ファイルを trash → 同じフォルダに同じ名前で再作成
//   ※ Advanced Drive Service が不要、シンプルでロック耐性あり
function handleReplaceFile_(p) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    if (!p.fileId) return jsonResponse_({ ok: false, message: 'fileId required' });
    if (!p.fileDataBase64) return jsonResponse_({ ok: false, message: 'fileDataBase64 required' });
    const oldFile = DriveApp.getFileById(p.fileId);
    const oldName = oldFile.getName();
    const parents = oldFile.getParents();
    if (!parents.hasNext()) return jsonResponse_({ ok: false, message: 'file has no parent folder' });
    const parent = parents.next();
    // 🛡 誤上書き防止：クライアントが記事フォルダIDを添えてきた場合、
    // 対象ファイルがそのフォルダ内に無ければ拒否する（別記事のファイル破壊を防ぐ）
    if (p.articleFolderId && parent.getId() !== p.articleFolderId) {
      return jsonResponse_({
        ok: false,
        message: '上書き対象が指定の記事フォルダ内にありません（誤上書き防止のため中止）',
      });
    }
    const bytes = Utilities.base64Decode(p.fileDataBase64);
    const blob = Utilities.newBlob(bytes, p.mimeType || oldFile.getMimeType(), oldName);
    // 元ファイルをゴミ箱へ
    oldFile.setTrashed(true);
    // 同名で新規作成
    const newFile = parent.createFile(blob);
    appendLog({
      articleTitle: parent.getName(),
      fileName: oldName,
      sizeBytes: bytes.length,
      result: '上書き保存',
      note: 'old=' + p.fileId + ' new=' + newFile.getId(),
    });
    return jsonResponse_({
      ok: true,
      result: 'replaced',
      oldFileId: p.fileId,
      newFileId: newFile.getId(),
      fileName: oldName,
      articleFolderId: parent.getId(),
    });
  } catch (err) {
    Logger.log('handleReplaceFile_ error: ' + err.message + '\n' + err.stack);
    return jsonResponse_({ ok: false, message: err.message });
  } finally {
    lock.releaseLock();
  }
}

// ─── 小ファイルアップロード ─────────────────────
function handleUploadSmall_(p) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    if (!p.fileName) return jsonResponse_({ ok: false, message: 'fileName required' });
    if (!p.fileDataBase64) return jsonResponse_({ ok: false, message: 'fileDataBase64 required' });

    const bytes = Utilities.base64Decode(p.fileDataBase64);
    const blob = Utilities.newBlob(bytes, p.mimeType || 'application/octet-stream', p.fileName);

    const folder = resolveArticleFolder_(p);

    const hash = computeHash(blob);
    // 🛡 重複判定は「同じ記事フォルダ内」に限定する。
    // 旧実装は全記事横断でhash照合していたため、別記事で同じ画像を使うと
    // 「重複スキップ」でその記事に保存されず、最初の記事に永久固定されていた。
    const existing = findByHash(hash, folder.getId());
    if (existing) {
      appendLog({
        articleTitle: folder.getName(),
        fileName: p.fileName,
        sizeBytes: bytes.length,
        hash: hash,
        result: '重複スキップ',
        note: '既存: ' + existing.fileId,
      });
      return jsonResponse_({ ok: true, result: 'skipped', existingFileId: existing.fileId, hash });
    }

    const capturedAt = p.capturedAt ? new Date(p.capturedAt) : new Date();
    const normalizedName = normalizeFilename(p.fileName, capturedAt);
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

    return jsonResponse_({
      ok: true,
      result: 'success',
      fileId: file.getId(),
      fileName: finalName,
      articleFolderId: folder.getId(),
      articleFolderName: folder.getName(),
      hash: hash,
    });
  } catch (err) {
    Logger.log('handleUploadSmall_ error: ' + err.message + '\n' + err.stack);
    appendLog({
      fileName: p.fileName || '(unknown)',
      result: 'エラー',
      note: err.message,
    });
    return jsonResponse_({ ok: false, message: err.message });
  } finally {
    lock.releaseLock();
  }
}

// ─── 商品情報（PRODUCT_INFO.md）保存（2026-07-12） ─────────────────────
// 記事めしPWAの「商品情報を取得」で解析した項目を記事フォルダに保存する。
// itemsJson = [{label, value}, ...]。空なら既存を削除（クリア相当）。
function handleSaveProductInfo_(p) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const folder = resolveArticleFolder_(p);
    let items = [];
    try {
      const parsed = JSON.parse(p.itemsJson || '[]');
      if (Array.isArray(parsed)) items = parsed;
    } catch (_) {}
    const name = 'PRODUCT_INFO.md';
    const existing = folder.getFilesByName(name);
    if (items.length === 0) {
      while (existing.hasNext()) existing.next().setTrashed(true);
      return jsonResponse_({ ok: true, result: 'cleared', articleFolderId: folder.getId() });
    }
    let md = '# 商品情報（記事めしPWAで取得）\n\n';
    md += '> 「商品情報を取得」コーナーで取り込んだ商品データ。記事執筆の参考に。\n\n';
    for (var i = 0; i < items.length; i++) {
      const label = String((items[i] && items[i].label) || '').trim();
      const value = String((items[i] && items[i].value) || '').trim();
      if (!value) continue;
      md += label ? ('【' + label + '】' + value + '\n') : (value + '\n');
    }
    let file;
    if (existing.hasNext()) {
      file = existing.next();
      file.setContent(md);
      while (existing.hasNext()) existing.next().setTrashed(true);
    } else {
      file = folder.createFile(Utilities.newBlob(md, 'text/markdown', name));
    }
    appendLog({
      articleTitle: folder.getName(),
      fileName: name,
      sizeBytes: md.length,
      result: '商品情報保存',
      note: 'items=' + items.length,
    });
    return jsonResponse_({
      ok: true, result: 'success',
      fileId: file.getId(),
      articleFolderId: folder.getId(),
      articleFolderName: folder.getName(),
    });
  } catch (err) {
    Logger.log('handleSaveProductInfo_ error: ' + err.message + '\n' + err.stack);
    return jsonResponse_({ ok: false, message: err.message });
  } finally {
    lock.releaseLock();
  }
}

// ─── 商品情報（PRODUCT_INFO.md）取得 ─────────────────────
function handleGetProductInfo_(p) {
  try {
    if (!p.articleFolderId) return jsonResponse_({ ok: true, exists: false });
    const folder = getArticleFolderById(p.articleFolderId);
    const files = folder.getFilesByName('PRODUCT_INFO.md');
    if (!files.hasNext()) return jsonResponse_({ ok: true, exists: false });
    const text = files.next().getBlob().getDataAsString('UTF-8');
    return jsonResponse_({ ok: true, exists: true, raw: text });
  } catch (err) {
    return jsonResponse_({ ok: false, message: err.message });
  }
}

// ─── 記事作成メモ（PROMPT.md）保存 ─────────────────────
function handleSavePrompt_(p) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const folder = resolveArticleFolder_(p);

    const articleType = (p.articleType || '').trim();
    let memos = [];
    try {
      const parsed = JSON.parse(p.memosJson || '[]');
      if (Array.isArray(parsed)) {
        memos = parsed.map(function (m) { return String(m || '').trim(); })
                     .filter(function (m) { return m.length > 0; });
      }
    } catch (_) {}

    // 何も指示がなければファイルは作らない（既存は保持）
    if (!articleType && memos.length === 0) {
      return jsonResponse_({
        ok: true, result: 'no-prompt',
        articleFolderId: folder.getId(),
        articleFolderName: folder.getName(),
      });
    }

    const now = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm');
    let md = '# 記事作成メモ（AIへの指示）\n\n';
    md += '> このファイルは「記事めし」PWAから生成された。\n';
    md += '> 記事執筆時は下記の指示を**必ず優先度順に反映**すること。\n';
    md += '> このファイルが存在する場合、SKILL.mdの標準構成より本メモを上位とする。\n\n';
    md += '生成日時: ' + now + '\n';
    md += '記事フォルダ: ' + folder.getName() + '\n\n';

    if (articleType) {
      md += '## 記事タイプ\n';
      md += '**' + articleType + '**\n\n';
    }
    if (memos.length > 0) {
      md += '## 読者に伝えたいポイント（優先度順）\n';
      for (var i = 0; i < memos.length; i++) {
        md += (i + 1) + '. ' + memos[i] + '\n';
      }
      md += '\n';
    }
    md += '---\n';
    md += '※1番目が最重要。記事の結論・導入・強調装飾は優先度上位のポイントに寄せる。\n';
    md += '🔴 画像の最優先ルール：上記メモの「🖼使う画像」や、すでに役割が割り当て済みの画像（アイキャッチ・比較表(完成)・図解 等）が既にある場合は、それを最優先でそのまま使用すること。同じ役割の画像を新規生成・作り直ししない（無い役割のみ新規生成を検討する）。\n';

    // 🛡 既存 PROMPT.md は「その場で上書き」（setContent）する。
    // 旧実装の「ゴミ箱→新規作成」は、作成が失敗した瞬間にメモが丸ごと消える窓があった。
    // setContent なら失敗しても旧内容が残り、fileId も変わらない。
    const existing = folder.getFilesByName('PROMPT.md');
    let file;
    if (existing.hasNext()) {
      file = existing.next();
      file.setContent(md);
      // 万一 PROMPT.md が複数あれば余分を掃除（正本を書き終えた後に実施）
      while (existing.hasNext()) existing.next().setTrashed(true);
    } else {
      const blob = Utilities.newBlob(md, 'text/markdown', 'PROMPT.md');
      file = folder.createFile(blob);
    }

    appendLog({
      articleTitle: folder.getName(),
      fileName: 'PROMPT.md',
      sizeBytes: md.length,
      result: 'メモ保存',
      note: 'type=' + articleType + ' memos=' + memos.length,
    });

    return jsonResponse_({
      ok: true, result: 'success',
      fileId: file.getId(),
      articleFolderId: folder.getId(),
      articleFolderName: folder.getName(),
    });
  } catch (err) {
    Logger.log('handleSavePrompt_ error: ' + err.message + '\n' + err.stack);
    return jsonResponse_({ ok: false, message: err.message });
  } finally {
    lock.releaseLock();
  }
}

// ─── 既存 PROMPT.md 取得（編集復元用） ─────────────────────
function handleGetPrompt_(p) {
  try {
    if (!p.articleFolderId) {
      return jsonResponse_({ ok: true, exists: false, message: 'no folderId' });
    }
    const folder = getArticleFolderById(p.articleFolderId);
    const files = folder.getFilesByName('PROMPT.md');
    if (!files.hasNext()) {
      return jsonResponse_({ ok: true, exists: false });
    }
    const file = files.next();
    const text = file.getBlob().getDataAsString('UTF-8');

    // パースして articleType と memos を抽出
    const parsed = parsePromptMd_(text);

    return jsonResponse_({
      ok: true, exists: true,
      articleType: parsed.articleType,
      memos: parsed.memos,
      raw: text,
    });
  } catch (err) {
    return jsonResponse_({ ok: false, message: err.message });
  }
}

function parsePromptMd_(text) {
  const result = { articleType: '', memos: [] };
  if (!text) return result;
  const lines = text.split(/\r?\n/);
  let section = '';
  for (var i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^##\s*記事タイプ/.test(line)) { section = 'type'; continue; }
    if (/^##\s*読者に伝えたいポイント/.test(line)) { section = 'memos'; continue; }
    if (/^##\s/.test(line)) { section = ''; continue; }
    if (section === 'type') {
      const m = line.match(/^\*\*(.+?)\*\*\s*$/) || line.match(/^([^\s*-].+?)\s*$/);
      if (m && m[1]) { result.articleType = m[1].trim(); section = ''; }
    } else if (section === 'memos') {
      const m = line.match(/^\d+\.\s+(.+?)\s*$/);
      if (m && m[1]) result.memos.push(m[1].trim());
    }
  }
  return result;
}

// ─── Resumable URL 発行 ─────────────────────
function handleResumableUrl_(p) {
  try {
    if (!p.fileName || !p.totalBytes) return jsonResponse_({ ok: false, message: 'fileName/totalBytes required' });
    const folder = resolveArticleFolder_(p);
    const capturedAt = p.capturedAt ? new Date(p.capturedAt) : new Date();
    const normalizedName = normalizeFilename(p.fileName, capturedAt);
    const finalName = resolveFilenameConflict(folder, normalizedName);

    const uploadUrl = startResumableUpload({
      articleFolderId: folder.getId(),
      fileName: finalName,
      mimeType: p.mimeType,
      totalBytes: Number(p.totalBytes),
    });
    return jsonResponse_({
      ok: true,
      uploadUrl: uploadUrl,
      fileName: finalName,
      articleFolderId: folder.getId(),
      articleFolderName: folder.getName(),
    });
  } catch (err) {
    return jsonResponse_({ ok: false, message: err.message });
  }
}

// ─── トークン検証 ─────────────────────
function verifyToken_(token) {
  if (!token) return false;
  const properties = PropertiesService.getScriptProperties();
  const workerToken = properties.getProperty(CONFIG.SHARED_TOKEN_PROPERTY);
  const localToken = properties.getProperty(CONFIG.LOCAL_SHARED_TOKEN_PROPERTY);
  return token === workerToken || token === localToken;
}

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
