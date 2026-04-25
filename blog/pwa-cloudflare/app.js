'use strict';
(() => {
  const CFG = window.BLOG_CAPTURE_CONFIG;
  const GAS_URL = CFG.GAS_URL;
  const TOKEN = CFG.SHARED_TOKEN;
  const SMALL_FILE_LIMIT = CFG.SMALL_FILE_LIMIT || 20 * 1024 * 1024;
  const CHUNK_SIZE = 8 * 1024 * 1024;

  // ─── DOM 参照 ─────────────────────
  const $ = (id) => document.getElementById(id);
  const articleSelect = $('article-select');
  const newArticleInput = $('new-article-title');
  const useNewArticleBtn = $('use-new-article');
  const articleTypeSelect = $('article-type-select');
  const addArticleTypeBtn = $('add-article-type');
  const removeArticleTypeBtn = $('remove-article-type');
  const memoList = $('memo-list');
  const addMemoBtn = $('add-memo');
  const memoSummaryStatus = $('memo-summary-status');
  const liveCamera = $('live-camera');
  const pickerGrid = $('picker-grid');
  const cameraPreview = $('camera-preview');
  const cameraFlip = $('camera-flip');
  const shutter = $('shutter');
  const recordTime = $('record-time');
  const inputPhoto = $('input-photo');
  const inputVideo = $('input-video');
  const inputFiles = $('input-files');
  const queueList = $('queue-list');
  const queueCount = $('queue-count');
  const queueEmpty = $('queue-empty');
  const pendingCount = $('pending-count');
  const uploadAllBtn = $('upload-all');
  const uploadAllCount = $('upload-all-count');
  const clearQueueBtn = $('clear-queue');
  const statusArea = $('status-area');
  const toast = $('toast');

  // ─── IndexedDB ─────────────────────
  const DB_NAME = 'blog-capture';
  const STORE = 'queue';
  let dbPromise = null;
  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const os = db.createObjectStore(STORE, { keyPath: 'id' });
          os.createIndex('createdAt', 'createdAt');
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }
  async function queuePut(r) {
    const db = await openDB();
    return new Promise((res, rej) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(r);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  }
  async function queueAll() {
    const db = await openDB();
    return new Promise((res, rej) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => res(req.result.sort((a, b) => a.createdAt - b.createdAt));
      req.onerror = () => rej(req.error);
    });
  }
  async function queueDelete(id) {
    const db = await openDB();
    return new Promise((res, rej) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  }
  async function queueClear() {
    const db = await openDB();
    return new Promise((res, rej) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  }

  // ─── ライブカメラ（getUserMedia 本体保存なし） ─────────────────────
  let currentStream = null;
  let currentFacing = 'environment';
  let currentKind = 'photo'; // photo | video
  let mediaRecorder = null;
  let recordChunks = [];
  let recordStartTs = 0;
  let recordTimerId = null;

  async function startCamera() {
    stopCamera();
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setStatus('⚠️ このブラウザはカメラ非対応。「選択」タブを使ってください');
      return;
    }
    try {
      const constraints = {
        video: { facingMode: currentFacing, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: currentKind === 'video',
      };
      currentStream = await navigator.mediaDevices.getUserMedia(constraints);
      cameraPreview.srcObject = currentStream;
      setStatus('📷 カメラ起動中');
    } catch (e) {
      let msg = e.message || String(e);
      if (e.name === 'NotAllowedError') msg = 'カメラ権限を許可してください（URLバーの🔒から）';
      if (e.name === 'NotFoundError') msg = 'カメラが見つかりません';
      if (e.name === 'NotReadableError') msg = '他のアプリがカメラ使用中';
      setStatus('⚠️ ' + msg);
      showToast('カメラ起動失敗: ' + msg, 'error');
    }
  }
  function stopCamera() {
    if (currentStream) {
      currentStream.getTracks().forEach((t) => t.stop());
      currentStream = null;
    }
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      try { mediaRecorder.stop(); } catch (_) {}
      mediaRecorder = null;
    }
  }
  async function capturePhoto() {
    if (!currentStream) return;
    const track = currentStream.getVideoTracks()[0];
    const s = track.getSettings();
    const canvas = document.createElement('canvas');
    canvas.width = s.width || cameraPreview.videoWidth;
    canvas.height = s.height || cameraPreview.videoHeight;
    canvas.getContext('2d').drawImage(cameraPreview, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.92));
    await addToQueue(blob, 'image/jpeg', 'jpg');
    flashEffect();
    navigator.vibrate && navigator.vibrate(30);
  }
  function flashEffect() {
    const flash = document.createElement('div');
    flash.style.cssText = 'position:fixed;inset:0;background:#fff;opacity:0.7;z-index:999;pointer-events:none;animation:flash 0.3s forwards;';
    document.body.appendChild(flash);
    setTimeout(() => flash.remove(), 300);
  }
  const flashStyle = document.createElement('style');
  flashStyle.textContent = '@keyframes flash{from{opacity:0.7}to{opacity:0}}';
  document.head.appendChild(flashStyle);

  async function toggleRecording() {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      mediaRecorder.stop();
      return;
    }
    if (!currentStream) await startCamera();
    if (!currentStream) return;
    recordChunks = [];
    const mime = MediaRecorder.isTypeSupported('video/mp4') ? 'video/mp4' : 'video/webm';
    mediaRecorder = new MediaRecorder(currentStream, { mimeType: mime });
    mediaRecorder.ondataavailable = (e) => { if (e.data.size) recordChunks.push(e.data); };
    mediaRecorder.onstop = async () => {
      const blob = new Blob(recordChunks, { type: mime });
      const ext = mime.includes('mp4') ? 'mp4' : 'webm';
      await addToQueue(blob, mime, ext);
      shutter.classList.remove('recording');
      recordTime.classList.remove('active');
      clearInterval(recordTimerId);
    };
    mediaRecorder.start();
    recordStartTs = Date.now();
    shutter.classList.add('recording');
    recordTime.classList.add('active');
    recordTimerId = setInterval(() => {
      const s = Math.floor((Date.now() - recordStartTs) / 1000);
      const mm = String(Math.floor(s / 60)).padStart(2, '0');
      const ss = String(s % 60).padStart(2, '0');
      recordTime.textContent = '● REC ' + mm + ':' + ss;
    }, 500);
  }

  // ─── キュー操作 ─────────────────────
  let itemCounter = 0;
  async function addToQueue(blob, mimeType, ext) {
    const id = Date.now() + '_' + (++itemCounter);
    const record = {
      id, createdAt: Date.now(),
      blob, mimeType, ext,
      size: blob.size,
      originalName: 'capture_' + id + '.' + ext,
      status: 'pending',
    };
    await queuePut(record);
    await renderQueue();
    showToast('追加（' + prettySize(blob.size) + '）', 'success');
  }
  async function renderQueue() {
    const items = await queueAll();
    queueList.innerHTML = '';
    queueCount.textContent = items.length;
    pendingCount.textContent = items.length;
    uploadAllBtn.disabled = items.length === 0;
    clearQueueBtn.disabled = items.length === 0;
    queueEmpty.style.display = items.length === 0 ? 'block' : 'none';
    uploadAllCount.textContent = items.length > 0 ? `${items.length}件を送信` : '';
    for (const item of items) {
      const div = document.createElement('div');
      div.className = 'queue-item';
      div.dataset.id = item.id;
      const url = URL.createObjectURL(item.blob);
      const isVideo = item.mimeType.startsWith('video/');
      const isPdf = item.mimeType === 'application/pdf';
      if (isVideo) div.innerHTML = '<video src="' + url + '" muted></video>';
      else if (isPdf) div.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;font-size:32px;">📄</div>';
      else div.innerHTML = '<img src="' + url + '" alt="">';
      div.insertAdjacentHTML('beforeend',
        '<span class="type-badge">' + (isVideo ? 'VID' : isPdf ? 'PDF' : 'IMG') + '</span>' +
        '<button class="delete-btn" type="button">✕</button>' +
        (item.status === 'uploading' ? '<div class="status-overlay">転送中…</div>' : '')
      );
      div.querySelector('.delete-btn').addEventListener('click', async (e) => {
        e.stopPropagation();
        await queueDelete(item.id);
        URL.revokeObjectURL(url);
        await renderQueue();
      });
      queueList.appendChild(div);
    }
  }
  function prettySize(b) {
    if (b < 1024) return b + 'B';
    if (b < 1024 * 1024) return (b / 1024).toFixed(1) + 'KB';
    return (b / 1024 / 1024).toFixed(1) + 'MB';
  }

  // ─── ファイル取り込み ─────────────────────
  async function handleInputChange(e) {
    const files = Array.from(e.target.files || []);
    for (const f of files) {
      const ext = (f.name.split('.').pop() || 'bin').toLowerCase();
      await addToQueue(f, f.type || 'application/octet-stream', ext);
    }
    e.target.value = '';
    navigator.vibrate && navigator.vibrate(30);
  }
  inputPhoto.addEventListener('change', handleInputChange);
  inputVideo.addEventListener('change', handleInputChange);
  inputFiles.addEventListener('change', handleInputChange);

  // ─── アップロード ─────────────────────
  async function uploadAll() {
    const articleTitle = getSelectedArticleTitle();
    let articleFolderId = getSelectedArticleFolderId();
    if (!articleTitle && !articleFolderId) {
      showToast('記事を選んでください', 'error');
      return;
    }
    const items = await queueAll();
    if (items.length === 0) return;
    uploadAllBtn.disabled = true;

    // 先に PROMPT.md を保存（フォルダが新規ならここで作成される）
    let promptSaved = false;
    if (hasPromptData()) {
      try {
        setStatus('📝 記事メモを保存中…');
        const pr = await savePromptToDrive(articleTitle, articleFolderId);
        if (pr.ok && pr.articleFolderId) {
          articleFolderId = pr.articleFolderId;
          promptSaved = true;
        } else if (!pr.ok) {
          showToast('メモ保存失敗（続行）: ' + (pr.message || ''), 'error');
        }
      } catch (e) {
        console.error('savePrompt error:', e);
        showToast('メモ保存失敗（続行）: ' + (e.message || e), 'error');
      }
    }

    let success = 0, skipped = 0, failed = 0;
    for (const item of items) {
      setStatus('転送中 ' + (success + skipped + failed + 1) + '/' + items.length);
      try {
        const result = item.size > SMALL_FILE_LIMIT
          ? await uploadLarge(item, articleTitle, articleFolderId)
          : await uploadSmall(item, articleTitle, articleFolderId);
        if (result.ok && result.result === 'success') success++;
        else if (result.ok && result.result === 'skipped') skipped++;
        else { failed++; continue; }
        await queueDelete(item.id);
      } catch (e) {
        failed++;
        console.error('upload error:', e);
      }
    }
    await renderQueue();
    uploadAllBtn.disabled = false;
    let msg = '✅成功 ' + success + ' / スキップ ' + skipped + ' / 失敗 ' + failed;
    if (promptSaved) msg = '📝メモ保存 / ' + msg;
    setStatus(msg);
    showToast(msg, failed > 0 ? 'error' : 'success');
    navigator.vibrate && navigator.vibrate([50, 30, 50]);

    // 成功時はメモをクリア（次の記事用）
    if (failed === 0 && promptSaved) clearMemoState();
  }

  async function uploadSmall(item, articleTitle, articleFolderId) {
    const base64 = await blobToBase64(item.blob);
    // x-www-form-urlencoded で送れば CORS preflight 不要
    const body = new URLSearchParams({
      token: TOKEN,
      action: 'uploadSmall',
      articleTitle: articleTitle || '',
      articleFolderId: articleFolderId || '',
      fileName: item.originalName,
      mimeType: item.mimeType,
      capturedAt: new Date(item.createdAt).toISOString(),
      fileDataBase64: base64,
    });
    const res = await fetch(GAS_URL, {
      method: 'POST',
      body: body.toString(),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    });
    return res.json();
  }

  async function uploadLarge(item, articleTitle, articleFolderId) {
    const qs = new URLSearchParams({
      token: TOKEN,
      action: 'resumableUrl',
      articleTitle: articleTitle || '',
      articleFolderId: articleFolderId || '',
      fileName: item.originalName,
      mimeType: item.mimeType,
      totalBytes: item.size,
      capturedAt: new Date(item.createdAt).toISOString(),
    });
    const initRes = await fetch(GAS_URL + '?' + qs.toString()).then((r) => r.json());
    if (!initRes.ok) throw new Error(initRes.message || 'Resumable URL 取得失敗');
    const uploadUrl = initRes.uploadUrl;
    const total = item.size;
    let offset = 0;
    while (offset < total) {
      const end = Math.min(offset + CHUNK_SIZE, total);
      const chunk = item.blob.slice(offset, end);
      const headers = { 'Content-Range': 'bytes ' + offset + '-' + (end - 1) + '/' + total };
      const resp = await fetch(uploadUrl, { method: 'PUT', headers, body: chunk });
      if (resp.status === 308) offset = end;
      else if (resp.status === 200 || resp.status === 201) return { ok: true, result: 'success' };
      else throw new Error('Resumable PUT 失敗: ' + resp.status);
      setStatus('転送中（大容量）: ' + Math.round((offset / total) * 100) + '%');
    }
    return { ok: true, result: 'success' };
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => {
        const result = r.result;
        resolve(result.substring(result.indexOf(',') + 1));
      };
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  }

  // ─── 記事セレクタ ─────────────────────
  let articleList = [];
  let selectedNewArticle = null;
  async function loadArticleList() {
    try {
      const url = GAS_URL + '?' + new URLSearchParams({ token: TOKEN, action: 'listArticles' }).toString();
      const res = await fetch(url).then((r) => r.json());
      if (!res.ok) throw new Error(res.message);
      articleList = res.articles || [];
      articleSelect.innerHTML = '<option value="">-- 記事を選ぶ --</option>';
      for (const a of articleList) {
        const opt = document.createElement('option');
        opt.value = a.id;
        opt.textContent = a.name;
        articleSelect.appendChild(opt);
      }
    } catch (e) {
      console.error('記事リスト取得失敗:', e);
      articleSelect.innerHTML = '<option value="">読み込み失敗</option>';
      showToast('記事リスト取得失敗: ' + (e.message || e), 'error');
    }
  }
  function getSelectedArticleTitle() { return selectedNewArticle || ''; }
  function getSelectedArticleFolderId() { return articleSelect.value || ''; }

  useNewArticleBtn.addEventListener('click', () => {
    const title = newArticleInput.value.trim();
    if (!title) { showToast('記事名を入力してください', 'error'); return; }
    selectedNewArticle = title;
    articleSelect.value = '';
    showToast('新規記事として使用: ' + title, 'success');
  });
  articleSelect.addEventListener('change', async () => {
    selectedNewArticle = null;
    newArticleInput.value = '';
    // 既存記事を選んだら PROMPT.md をDriveから復元
    const folderId = articleSelect.value;
    if (folderId) await loadExistingPrompt(folderId);
  });

  async function loadExistingPrompt(folderId) {
    try {
      const url = GAS_URL + '?' + new URLSearchParams({
        token: TOKEN, action: 'getPrompt', articleFolderId: folderId,
      }).toString();
      const res = await fetch(url).then((r) => r.json());
      if (!res.ok || !res.exists) return;
      // 既存メモを上書きして良いか軽く確認
      if (hasPromptData()) {
        if (!confirm('この記事に既存のメモが見つかりました。現在の入力を破棄して読み込みますか？')) return;
      }
      articleTypes = Array.from(new Set([
        ...articleTypes,
        ...(res.articleType ? [res.articleType] : []),
      ]));
      saveArticleTypes();
      renderArticleTypes();
      articleTypeSelect.value = res.articleType || '';
      memos = Array.isArray(res.memos) ? res.memos.slice() : [];
      persistMemoState();
      renderMemos();
      // メモセクションを開く
      const det = document.getElementById('memo-details');
      if (det && !det.open) det.open = true;
      showToast('既存メモを読み込みました', 'success');
    } catch (e) {
      console.error('loadExistingPrompt error:', e);
    }
  }

  // ─── 記事作成メモ（AIへの指示） ─────────────────────
  const LS_TYPES_KEY = 'kiji-meshi:article-types';
  const LS_MEMO_STATE_KEY = 'kiji-meshi:memo-state';
  const DEFAULT_TYPES = ['レビュー', '商品比較', 'ツール紹介'];
  let articleTypes = loadArticleTypes();
  let memos = []; // string[]

  function loadArticleTypes() {
    try {
      const raw = localStorage.getItem(LS_TYPES_KEY);
      if (!raw) return DEFAULT_TYPES.slice();
      const arr = JSON.parse(raw);
      if (Array.isArray(arr) && arr.length > 0) return arr;
    } catch (_) {}
    return DEFAULT_TYPES.slice();
  }
  function saveArticleTypes() {
    localStorage.setItem(LS_TYPES_KEY, JSON.stringify(articleTypes));
  }
  function renderArticleTypes() {
    const current = articleTypeSelect.value;
    articleTypeSelect.innerHTML = '<option value="">-- 指定なし（従来通り） --</option>';
    for (const t of articleTypes) {
      const opt = document.createElement('option');
      opt.value = t; opt.textContent = t;
      articleTypeSelect.appendChild(opt);
    }
    if (current && articleTypes.includes(current)) articleTypeSelect.value = current;
    updateMemoStatus();
  }

  function renderMemos() {
    memoList.innerHTML = '';
    memos.forEach((text, i) => {
      const row = document.createElement('div');
      row.className = 'memo-item';
      row.innerHTML =
        '<div class="memo-item-num">' + (i + 1) + '</div>' +
        '<textarea class="memo-item-text" rows="1" placeholder="例: バッテリー持続が競合比で1.5倍という点を推したい"></textarea>' +
        '<div class="memo-item-actions">' +
          '<button class="memo-item-btn up" type="button" aria-label="上へ"' + (i === 0 ? ' disabled' : '') + '>↑</button>' +
          '<button class="memo-item-btn down" type="button" aria-label="下へ"' + (i === memos.length - 1 ? ' disabled' : '') + '>↓</button>' +
          '<button class="memo-item-btn delete" type="button" aria-label="削除">✕</button>' +
        '</div>';
      const ta = row.querySelector('textarea');
      ta.value = text;
      ta.addEventListener('input', () => {
        memos[i] = ta.value;
        persistMemoState();
        updateMemoStatus();
      });
      row.querySelector('.up').addEventListener('click', () => {
        if (i === 0) return;
        [memos[i - 1], memos[i]] = [memos[i], memos[i - 1]];
        persistMemoState();
        renderMemos();
      });
      row.querySelector('.down').addEventListener('click', () => {
        if (i === memos.length - 1) return;
        [memos[i], memos[i + 1]] = [memos[i + 1], memos[i]];
        persistMemoState();
        renderMemos();
      });
      row.querySelector('.delete').addEventListener('click', () => {
        memos.splice(i, 1);
        persistMemoState();
        renderMemos();
      });
      memoList.appendChild(row);
    });
    updateMemoStatus();
  }

  function persistMemoState() {
    const state = {
      articleType: articleTypeSelect.value || '',
      memos: memos,
    };
    localStorage.setItem(LS_MEMO_STATE_KEY, JSON.stringify(state));
  }
  function loadMemoState() {
    try {
      const raw = localStorage.getItem(LS_MEMO_STATE_KEY);
      if (!raw) return;
      const state = JSON.parse(raw);
      if (state && Array.isArray(state.memos)) memos = state.memos;
      if (state && state.articleType) articleTypeSelect.value = state.articleType;
    } catch (_) {}
  }
  function clearMemoState() {
    memos = [];
    articleTypeSelect.value = '';
    localStorage.removeItem(LS_MEMO_STATE_KEY);
    renderMemos();
  }
  function getValidMemos() {
    return memos.map((m) => (m || '').trim()).filter((m) => m.length > 0);
  }
  function hasPromptData() {
    return !!articleTypeSelect.value || getValidMemos().length > 0;
  }
  function updateMemoStatus() {
    const valid = getValidMemos().length;
    const type = articleTypeSelect.value;
    if (!type && valid === 0) {
      memoSummaryStatus.textContent = '未設定';
      memoSummaryStatus.classList.remove('active');
    } else {
      const parts = [];
      if (type) parts.push(type);
      if (valid > 0) parts.push('メモ' + valid + '件');
      memoSummaryStatus.textContent = parts.join(' / ');
      memoSummaryStatus.classList.add('active');
    }
  }

  addArticleTypeBtn.addEventListener('click', () => {
    const name = (prompt('追加する記事タイプ名を入力してください（例: 裏話、実験レポート）') || '').trim();
    if (!name) return;
    if (articleTypes.includes(name)) { showToast('既に存在します: ' + name, 'error'); return; }
    articleTypes.push(name);
    saveArticleTypes();
    renderArticleTypes();
    articleTypeSelect.value = name;
    persistMemoState();
    showToast('追加: ' + name, 'success');
  });
  removeArticleTypeBtn.addEventListener('click', () => {
    const current = articleTypeSelect.value;
    if (!current) { showToast('削除するタイプを選んでください', 'error'); return; }
    if (!confirm('「' + current + '」をタイプ一覧から削除しますか？')) return;
    articleTypes = articleTypes.filter((t) => t !== current);
    if (articleTypes.length === 0) articleTypes = DEFAULT_TYPES.slice();
    saveArticleTypes();
    articleTypeSelect.value = '';
    renderArticleTypes();
    persistMemoState();
  });
  articleTypeSelect.addEventListener('change', () => {
    persistMemoState();
    updateMemoStatus();
  });
  addMemoBtn.addEventListener('click', () => {
    memos.push('');
    persistMemoState();
    renderMemos();
    const last = memoList.querySelector('.memo-item:last-child textarea');
    if (last) last.focus();
  });

  // ─── PROMPT.md 保存（GASへ送信） ─────────────────────
  async function savePromptToDrive(articleTitle, articleFolderId) {
    const articleType = articleTypeSelect.value || '';
    const validMemos = getValidMemos();
    if (!articleType && validMemos.length === 0) return { ok: true, skipped: true };

    const body = new URLSearchParams({
      token: TOKEN,
      action: 'savePrompt',
      articleTitle: articleTitle || '',
      articleFolderId: articleFolderId || '',
      articleType: articleType,
      memosJson: JSON.stringify(validMemos),
    });
    const res = await fetch(GAS_URL, {
      method: 'POST',
      body: body.toString(),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    });
    return res.json();
  }

  // ─── モードタブ切替 ─────────────────────
  document.querySelectorAll('.mode-tab').forEach((btn) => {
    btn.addEventListener('click', async () => {
      document.querySelectorAll('.mode-tab').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const mode = btn.dataset.mode;
      if (mode === 'live') {
        liveCamera.classList.remove('hidden');
        pickerGrid.classList.add('hidden');
        await startCamera();
      } else {
        stopCamera();
        liveCamera.classList.add('hidden');
        pickerGrid.classList.remove('hidden');
      }
    });
  });

  // 写真/動画の切替
  document.querySelectorAll('.kind-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      document.querySelectorAll('.kind-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      currentKind = btn.dataset.kind;
      // 動画モードでは音声が必要なのでストリーム再起動
      await startCamera();
    });
  });

  // シャッター
  shutter.addEventListener('click', () => {
    if (currentKind === 'photo') capturePhoto();
    else toggleRecording();
  });

  cameraFlip.addEventListener('click', async () => {
    currentFacing = currentFacing === 'environment' ? 'user' : 'environment';
    await startCamera();
  });

  uploadAllBtn.addEventListener('click', uploadAll);
  clearQueueBtn.addEventListener('click', async () => {
    if (!confirm('一時保存を全て破棄しますか？')) return;
    await queueClear();
    await renderQueue();
  });

  // ─── UI補助 ─────────────────────
  function setStatus(msg) { statusArea.textContent = msg; }
  let toastTimer = null;
  function showToast(msg, kind) {
    clearTimeout(toastTimer);
    toast.textContent = msg;
    toast.className = 'toast ' + (kind || '');
    toastTimer = setTimeout(() => toast.classList.add('hidden'), 3000);
  }

  // ─── 初期化 ─────────────────────
  (async () => {
    renderArticleTypes();
    loadMemoState();
    renderMemos();
    await renderQueue();
    await loadArticleList();
    // 初期はライブカメラ
    await startCamera();
    setStatus('準備完了');
  })();
})();
