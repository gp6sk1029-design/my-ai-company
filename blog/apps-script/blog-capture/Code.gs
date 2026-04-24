/**
 * Code.gs
 * ─────────────────────────────────────────────
 * blog-capture API（Cloudflare PWA から呼ばれるバックエンド）
 * - 認可は共有トークン方式（Config.gs の SHARED_TOKEN）
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
  return jsonResponse_({ ok: false, message: 'unknown action: ' + p.action });
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

    const folder = p.articleFolderId
      ? getArticleFolderById(p.articleFolderId)
      : getOrCreateArticleFolder(p.articleTitle);

    const hash = computeHash(blob);
    const existing = findByHash(hash);
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

// ─── 記事作成メモ（PROMPT.md）保存 ─────────────────────
function handleSavePrompt_(p) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const folder = p.articleFolderId
      ? getArticleFolderById(p.articleFolderId)
      : getOrCreateArticleFolder(p.articleTitle);

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

    // 既存 PROMPT.md を削除して新規作成
    const existing = folder.getFilesByName('PROMPT.md');
    while (existing.hasNext()) existing.next().setTrashed(true);

    const blob = Utilities.newBlob(md, 'text/markdown', 'PROMPT.md');
    const file = folder.createFile(blob);

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

// ─── Resumable URL 発行 ─────────────────────
function handleResumableUrl_(p) {
  try {
    if (!p.fileName || !p.totalBytes) return jsonResponse_({ ok: false, message: 'fileName/totalBytes required' });
    const folder = p.articleFolderId
      ? getArticleFolderById(p.articleFolderId)
      : getOrCreateArticleFolder(p.articleTitle);
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
  return token && token === CONFIG.SHARED_TOKEN;
}

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
