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
  const SETTINGS_STORE = 'settings'; // v2 追加：DirectoryHandle 等の設定保存
  let dbPromise = null;
  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 2);
      req.onupgradeneeded = (e) => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const os = db.createObjectStore(STORE, { keyPath: 'id' });
          os.createIndex('createdAt', 'createdAt');
        }
        if (!db.objectStoreNames.contains(SETTINGS_STORE)) {
          db.createObjectStore(SETTINGS_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }
  async function settingsGet(key) {
    const db = await openDB();
    return new Promise((res, rej) => {
      const tx = db.transaction(SETTINGS_STORE, 'readonly');
      const req = tx.objectStore(SETTINGS_STORE).get(key);
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
  }
  async function settingsPut(key, value) {
    const db = await openDB();
    return new Promise((res, rej) => {
      const tx = db.transaction(SETTINGS_STORE, 'readwrite');
      tx.objectStore(SETTINGS_STORE).put(value, key);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
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
      const editBtnHtml = (isVideo || isPdf) ? '' :
        '<button class="ai-edit-btn" type="button" title="ChatGPTで編集" data-action="ai-gpt">🤖</button>' +
        '<button class="ai-edit-btn ai-edit-gemini" type="button" title="Geminiで編集" data-action="ai-gem">🍌</button>' +
        '<button class="ai-edit-btn ai-edit-canva" type="button" title="Canvaで仕上げ" data-action="ai-canva">🎨</button>';
      const editingBadge = (item.editingWith ? '<div class="editing-badge">編集中…</div>' : '');
      div.insertAdjacentHTML('beforeend',
        '<span class="type-badge">' + (isVideo ? 'VID' : isPdf ? 'PDF' : 'IMG') + '</span>' +
        editBtnHtml +
        '<button class="delete-btn" type="button">✕</button>' +
        (item.status === 'uploading' ? '<div class="status-overlay">転送中…</div>' : '') +
        editingBadge
      );
      div.querySelector('.delete-btn').addEventListener('click', async (e) => {
        e.stopPropagation();
        await queueDelete(item.id);
        URL.revokeObjectURL(url);
        await renderQueue();
      });
      const gptBtn = div.querySelector('[data-action="ai-gpt"]');
      const gemBtn = div.querySelector('[data-action="ai-gem"]');
      const canvaBtn = div.querySelector('[data-action="ai-canva"]');
      if (gptBtn) gptBtn.addEventListener('click', async (e) => { e.stopPropagation(); await oneClickEdit(item, 'chatgpt'); });
      if (gemBtn) gemBtn.addEventListener('click', async (e) => { e.stopPropagation(); await oneClickEdit(item, 'gemini'); });
      if (canvaBtn) canvaBtn.addEventListener('click', async (e) => { e.stopPropagation(); await oneClickEdit(item, 'canva'); });
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

  // ─── AI 接続先設定（プロジェクト／Gem URL を localStorage に保存） ────────
  const CONN_KEY_GPT = 'pwa-meshi-conn-chatgpt';
  const CONN_KEY_GEM = 'pwa-meshi-conn-gemini';
  const DEFAULT_GPT_URL = 'https://chatgpt.com/?model=gpt-4o';
  const DEFAULT_GEM_URL = 'https://gemini.google.com/app';

  function getChatGPTUrl() {
    return (localStorage.getItem(CONN_KEY_GPT) || '').trim() || DEFAULT_GPT_URL;
  }
  function getGeminiUrl() {
    return (localStorage.getItem(CONN_KEY_GEM) || '').trim() || DEFAULT_GEM_URL;
  }

  // プロンプトを URL クエリに埋め込んで AI 起動 URL を構築
  // ユーザーが保存したプロジェクト/Gem URL を基底にし、その上に ?q= / ?prompt= を付加する。
  // ⚠️ プロジェクトURLでは ?q= が効かない可能性があるが、ユーザーは「プロジェクト文脈で開く」ことを優先
  function buildAIUrl(engine, prompt) {
    if (!prompt) {
      // プロンプトなし → ユーザー設定のプロジェクトURLを尊重
      return engine === 'gemini' ? getGeminiUrl() : getChatGPTUrl();
    }
    // プロンプトあり
    const MAX = 1500;
    let p = prompt;
    if (p.length > MAX) p = p.slice(0, MAX) + '\n…（プロンプト省略）';
    if (engine === 'gemini') {
      const saved = (localStorage.getItem(CONN_KEY_GEM) || '').trim();
      const base = saved || 'https://gemini.google.com/app';
      const sep = base.includes('?') ? '&' : '?';
      return base + sep + 'prompt=' + encodeURIComponent(p) + '&autosubmit=false';
    }
    if (engine === 'canva') {
      // Canva はURLプリフィル非対応。ホームページを開く（ログイン済みならダッシュボード）
      // 推奨：右上「デザインを作成」→ カスタムサイズ「1200×630」を入力 → ⌘Vで画像貼付
      return 'https://www.canva.com/';
    }
    // ChatGPT: 保存されたプロジェクトURL を基底にする（未設定なら chatgpt.com ルート）
    const saved = (localStorage.getItem(CONN_KEY_GPT) || '').trim();
    const base = saved || 'https://chatgpt.com/';
    const sep = base.includes('?') ? '&' : '?';
    return base + sep + 'q=' + encodeURIComponent(p);
  }

  // Engine ラベル取得（バナー表示用）
  function getEngineLabel(engine) {
    if (engine === 'gemini') return '🍌 Gemini';
    if (engine === 'canva')  return '🎨 Canva';
    return '🤖 ChatGPT';
  }

  // ─── URL検証＆ラベル抽出 ─────
  function isValidChatGPTUrl(u) {
    return /^https?:\/\/(?:chat\.openai\.com|chatgpt\.com)\//i.test(u);
  }
  function isValidGeminiUrl(u) {
    return /^https?:\/\/(?:gemini\.google\.com|aistudio\.google\.com)\//i.test(u);
  }
  function extractProjectLabel(url, engine) {
    if (!url) return '';
    if (engine === 'chatgpt') {
      // 例: https://chatgpt.com/g/g-xxx → GPT、 https://chatgpt.com/projects/xxx → Project
      if (/\/g\//.test(url)) return 'カスタムGPT';
      if (/\/projects?\//.test(url)) return 'プロジェクト';
      return '保存先';
    } else {
      if (/\/gem\//.test(url)) return 'Gem';
      if (/aistudio/i.test(url)) return 'AI Studio';
      return '保存先';
    }
  }

  // ─── 接続先バー更新 ─────
  function updateConnBar() {
    const bar = document.getElementById('ai-conn-bar');
    const engines = document.getElementById('ai-conn-bar-engines');
    const status = document.getElementById('ai-conn-status');
    if (!bar || !engines) return;
    const gpt = localStorage.getItem(CONN_KEY_GPT) || '';
    const gem = localStorage.getItem(CONN_KEY_GEM) || '';
    const parts = [];
    if (gpt) parts.push(`<span class="ai-conn-bar-engine"><span class="ai-conn-bar-icon">🤖</span> ${extractProjectLabel(gpt,'chatgpt')}</span>`);
    if (gem) parts.push(`<span class="ai-conn-bar-engine ai-conn-bar-gem"><span class="ai-conn-bar-icon">🍌</span> ${extractProjectLabel(gem,'gemini')}</span>`);
    if (parts.length === 0) {
      bar.hidden = true;
      if (status) { status.textContent = '未設定'; status.className = 'ai-conn-summary-status'; }
      return;
    }
    bar.hidden = false;
    engines.innerHTML = parts.join('');
    if (status) {
      status.textContent = '✅ 設定済';
      status.className = 'ai-conn-summary-status is-active';
    }
  }

  // 設定UIへのイベント紐付け
  setTimeout(() => {
    const inpGpt = document.getElementById('ai-conn-chatgpt');
    const inpGem = document.getElementById('ai-conn-gemini');
    const btnSave = document.getElementById('btn-conn-save');
    const btnReset = document.getElementById('btn-conn-reset');
    const btnPasteGpt = document.getElementById('btn-conn-paste-gpt');
    const btnPasteGem = document.getElementById('btn-conn-paste-gem');
    const btnOpenChatGPTFind = document.getElementById('btn-conn-open-chatgpt-find');
    const btnOpenGeminiFind = document.getElementById('btn-conn-open-gemini-find');
    if (!inpGpt || !inpGem) return;
    inpGpt.value = localStorage.getItem(CONN_KEY_GPT) || '';
    inpGem.value = localStorage.getItem(CONN_KEY_GEM) || '';
    updateConnBar();

    // 📋 クリップボードから貼付（ChatGPT）
    if (btnPasteGpt) btnPasteGpt.addEventListener('click', async () => {
      try {
        const text = (await navigator.clipboard.readText()).trim();
        if (!text) { showToast('クリップボードが空です', 'error'); return; }
        if (!isValidChatGPTUrl(text)) {
          showToast('ChatGPT のURLではありません: ' + text.slice(0, 50), 'error');
          return;
        }
        inpGpt.value = text;
        showToast('ChatGPT URL を貼付しました。「💾 保存」をお忘れなく', 'success');
      } catch (err) {
        showToast('クリップボード読取が拒否されました。手動でペーストしてください', 'error');
      }
    });

    // 📋 クリップボードから貼付（Gemini）
    if (btnPasteGem) btnPasteGem.addEventListener('click', async () => {
      try {
        const text = (await navigator.clipboard.readText()).trim();
        if (!text) { showToast('クリップボードが空です', 'error'); return; }
        if (!isValidGeminiUrl(text)) {
          showToast('Gemini のURLではありません: ' + text.slice(0, 50), 'error');
          return;
        }
        inpGem.value = text;
        showToast('Gemini URL を貼付しました。「💾 保存」をお忘れなく', 'success');
      } catch (err) {
        showToast('クリップボード読取が拒否されました。手動でペーストしてください', 'error');
      }
    });

    // 🔍 ChatGPT を「探す用」で開く
    if (btnOpenChatGPTFind) btnOpenChatGPTFind.addEventListener('click', () => {
      window.open('https://chatgpt.com/', '_blank');
      showToast('開いた ChatGPT でプロジェクトに移動 → URL をコピー → 戻って 📋 ボタン', 'success');
    });
    if (btnOpenGeminiFind) btnOpenGeminiFind.addEventListener('click', () => {
      window.open('https://gemini.google.com/', '_blank');
      showToast('開いた Gemini で Gem に移動 → URL をコピー → 戻って 📋 ボタン', 'success');
    });

    // 💾 保存
    if (btnSave) btnSave.addEventListener('click', () => {
      const v1 = inpGpt.value.trim();
      const v2 = inpGem.value.trim();
      if (v1 && !isValidChatGPTUrl(v1)) {
        showToast('ChatGPT URL の形式が不正です（chatgpt.com / chat.openai.com 必須）', 'error'); return;
      }
      if (v2 && !isValidGeminiUrl(v2)) {
        showToast('Gemini URL の形式が不正です（gemini.google.com 必須）', 'error'); return;
      }
      localStorage.setItem(CONN_KEY_GPT, v1);
      localStorage.setItem(CONN_KEY_GEM, v2);
      updateConnBar();
      const msg = (v1 ? '🤖 ChatGPT' : '') + (v1 && v2 ? ' + ' : '') + (v2 ? '🍌 Gemini' : '') + ' に接続設定完了';
      showToast(msg || '設定をクリア', 'success');
      navigator.vibrate && navigator.vibrate(20);
    });

    // デフォルトに戻す
    if (btnReset) btnReset.addEventListener('click', () => {
      localStorage.removeItem(CONN_KEY_GPT);
      localStorage.removeItem(CONN_KEY_GEM);
      inpGpt.value = '';
      inpGem.value = '';
      updateConnBar();
      showToast('デフォルトに戻しました', 'success');
    });
  }, 200);

  // ─── ワンクリック AI 編集（画像コピー＋プロンプト＋AI起動＋置換待機）──────────
  let pendingReplace = null; // {originalId, originalItem, aiEngine, startedAt}

  async function blobToPngBlob(blob) {
    if (blob.type === 'image/png') return blob;
    const img = new Image();
    img.src = URL.createObjectURL(blob);
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.getContext('2d').drawImage(img, 0, 0);
    URL.revokeObjectURL(img.src);
    return new Promise(res => canvas.toBlob(res, 'image/png'));
  }

  function defaultEditPrompt() {
    // 編集系のデフォルトプロンプト（カスタマイズせず使えるもの）
    return [
      '以下の画像を編集してください。',
      '',
      '【依頼】',
      '・背景を白に統一（または背景を除去して透過）',
      '・被写体を明るく鮮明に',
      '・ブログ記事用の清潔な仕上がりに',
      '',
      '【画像サイズ】',
      '元のアスペクト比を維持',
      '',
      '出力された画像は右クリックで保存・コピーできるようにしてください。',
    ].join('\n');
  }

  // ─── 取込元フォルダ（Google Drive ダウンロード等）の管理 ─────────────────
  const FOLDER_KEY = 'download-folder-handle';

  // File System Access API サポート判定
  function supportsFSAccess() {
    return typeof window.showDirectoryPicker === 'function';
  }

  // 保存済みのフォルダハンドルを取得（権限がなければ再要求）
  async function getSavedFolderHandle() {
    if (!supportsFSAccess()) return null;
    try {
      const handle = await settingsGet(FOLDER_KEY);
      if (!handle) return null;
      // 権限確認
      const opts = { mode: 'read' };
      let perm = await handle.queryPermission(opts);
      if (perm === 'prompt') perm = await handle.requestPermission(opts);
      if (perm !== 'granted') return null;
      return handle;
    } catch (e) {
      console.warn('saved folder handle invalid:', e);
      return null;
    }
  }

  // ユーザーにフォルダを選んでもらい IDB に保存
  async function chooseDownloadFolder() {
    if (!supportsFSAccess()) {
      showToast('このブラウザはフォルダ選択非対応（Chrome/Edge で開いてください）', 'warn');
      return null;
    }
    try {
      const handle = await window.showDirectoryPicker({ mode: 'read', startIn: 'downloads' });
      await settingsPut(FOLDER_KEY, handle);
      showToast(`📁 取込元フォルダを「${handle.name}」に設定しました`, 'success');
      return handle;
    } catch (e) {
      if (e && e.name === 'AbortError') return null; // キャンセル
      showToast('フォルダ選択に失敗: ' + (e.message || e), 'error');
      return null;
    }
  }

  // フォルダ内で「最新の画像ファイル」を取得
  //   sinceMs: この時刻以降に更新されたファイルのみ対象（編集開始時刻を渡す → 古いゴミを拾わない）
  //   excludeKey: 直前に取り込んだファイルのキー（name+lastModified）を渡せばそれは除外
  async function pickLatestImageFromFolder(dirHandle, sinceMs = 0, excludeKey = '') {
    const IMG_EXT = /\.(png|jpe?g|webp|gif|heic|heif|avif)$/i;
    const all = [];
    for await (const [name, entry] of dirHandle.entries()) {
      if (entry.kind !== 'file') continue;
      if (!IMG_EXT.test(name)) continue;
      try {
        const f = await entry.getFile();
        const key = `${name}|${f.lastModified}`;
        if (key === excludeKey) continue;
        if (f.lastModified < sinceMs) continue;
        all.push({ file: f, key, name });
      } catch (_) {}
    }
    if (!all.length) return null;
    all.sort((a, b) => b.file.lastModified - a.file.lastModified);
    return all[0]; // {file, key, name}
  }

  // 標準のファイル選択ダイアログ（フォルダ未設定／非対応ブラウザ用フォールバック）
  function openFilePickerForReceive() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async (e) => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      const ext = (f.name.split('.').pop() || 'png').toLowerCase();
      const ok = await tryReplaceWithEditedImage(f, f.type || 'image/png', ext);
      if (!ok) showToast('置換に失敗しました', 'error');
    };
    input.click();
  }

  // モバイル端末判定（スマホ／タブレット）
  function isMobileDevice() {
    if (navigator.userAgentData && navigator.userAgentData.mobile) return true;
    const ua = navigator.userAgent || '';
    return /iPhone|iPad|iPod|Android|Mobile/i.test(ua);
  }

  // モバイル：Web Share API で画像＋プロンプトをネイティブ共有
  // → 共有シートからChatGPT/Geminiアプリを選んで送る（拡張機能不要）
  async function mobileShareEdit(item, engine, prompt) {
    const aiName = engine === 'gemini' ? 'Gemini' : 'ChatGPT';
    try {
      const pngBlob = await blobToPngBlob(item.blob);
      const fileName = (item.originalName || ('edit_' + item.id)).replace(/\.[^.]+$/, '') + '.png';
      const file = new File([pngBlob], fileName, { type: 'image/png' });
      // ファイル共有がサポートされてるか確認
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          text: prompt,
          title: `${aiName}で画像編集`,
        });
        showToast(`📤 共有シートを開きました。${aiName}アプリを選択してください`, 'success');
        return true;
      }
      // ファイル共有不可 → テキストのみ共有（画像はクリップボード経由）
      if (navigator.share) {
        await navigator.share({ text: prompt, title: `${aiName}で画像編集` });
        return true;
      }
    } catch (err) {
      if (err && err.name === 'AbortError') {
        // ユーザーが共有シートを閉じただけ。エラー扱いしない
        return true;
      }
      console.warn('Web Share failed:', err);
    }
    return false;
  }

  async function oneClickEdit(item, engine) {
    const prompt = (aiPrompt && aiPrompt.value.trim()) || defaultEditPrompt();
    const aiName = getEngineLabel(engine);

    // === モバイル分岐：Web Share API で画像＋プロンプトを共有（Canva は対象外） ===
    if (isMobileDevice() && navigator.share && engine !== 'canva') {
      // 置換待機状態を先に作る（共有後に戻ってきた画像で置換するため）
      pendingReplace = {
        originalId: item.id,
        originalItem: item,
        aiEngine: engine,
        prompt: prompt,
        startedAt: Date.now(),
        aiWindow: null,
        aiUrl: buildAIUrl(engine, prompt),
      };
      item.editingWith = engine;
      await queuePut(item);
      await renderQueue();
      showEditingBanner();
      const shared = await mobileShareEdit(item, engine, prompt);
      if (!shared) {
        // 共有に失敗した → デスクトップフローへフォールバック
        showToast(`共有が使えないため、ブラウザで${aiName}を開きます`, 'warn');
      } else {
        return; // 共有完了
      }
    }

    // === PC：URLプリフィル＋クリップボード経由 ===
    let copyOK = false;
    try {
      if (navigator.clipboard && window.ClipboardItem) {
        const pngBlob = await blobToPngBlob(item.blob);
        await navigator.clipboard.write([new ClipboardItem({'image/png': pngBlob})]);
        copyOK = true;
        clipboardMode = 'image';
      }
    } catch (err) {
      console.warn('image clipboard copy failed:', err);
    }

    const url = buildAIUrl(engine, prompt);
    pendingReplace = {
      originalId: item.id,
      originalItem: item,
      aiEngine: engine,
      prompt: prompt,
      startedAt: Date.now(),
      aiWindow: null,
      aiUrl: url,
    };
    item.editingWith = engine;
    await queuePut(item);
    await renderQueue();
    showEditingBanner();

    // ChatGPT のプロジェクトURL（/g/g-p-）や、Gemini の Gem URL（/gem/）では ?q=/?prompt= のプリフィルが効かない
    // → プロンプトが入力欄に入らないので、ユーザーに「📋 プロンプト」ボタンで手動切替してもらう必要がある
    const savedGptUrl = (localStorage.getItem(CONN_KEY_GPT) || '').trim();
    const savedGemUrl = (localStorage.getItem(CONN_KEY_GEM) || '').trim();
    const isGptProject = engine === 'chatgpt' && /\/g\/g-p?-/.test(savedGptUrl);
    const isGemGem     = engine === 'gemini'  && /\/gem\//.test(savedGemUrl);
    pendingReplace.needsPromptPaste = isGptProject || isGemGem;

    if (engine === 'canva') {
      if (copyOK) {
        showToast(`🎨 画像をコピー完了。Canvaを開いて <kbd>⌘/Ctrl+V</kbd> でキャンバスに貼付→装飾→ダウンロード`, 'success');
      } else {
        showToast(`画像のクリップボード書込に失敗。Canva 側で「アップロード」から画像を追加してください`, 'warn');
      }
    } else if (pendingReplace.needsPromptPaste) {
      // プロジェクト/Gem URL → 2段階ペースト
      showToast(
        `⚠️ プロジェクトURLでは ?q= プリフィル不可。①AI で画像を <kbd>⌘V</kbd> ②PWA バナーの「📋 プロンプト」 ③AI で <kbd>⌘V</kbd>（プロンプト）`,
        'warn'
      );
    } else if (copyOK) {
      showToast(`✨ 画像をコピー＆プロンプトはURLに埋込済み。${aiName} を開いて <kbd>⌘/Ctrl+V</kbd> 一発で画像添付`, 'success');
    } else {
      showToast(`画像のクリップボード書込に失敗。${aiName} 側で右クリック→画像を貼付してください`, 'warn');
    }
  }

  // ─── 編集中バナー（フローティング）────
  let editingBanner = null;
  function showEditingBanner() {
    if (!pendingReplace) return;
    if (!editingBanner) {
      editingBanner = document.createElement('div');
      editingBanner.id = 'editing-banner';
      editingBanner.className = 'editing-banner';
      document.body.appendChild(editingBanner);
    }
    const engineLabel = getEngineLabel(pendingReplace.aiEngine);
    const isCanva = pendingReplace.aiEngine === 'canva';
    const promptPreview = (pendingReplace.prompt || '').slice(0, 200);
    editingBanner.innerHTML =
      '<button type="button" id="banner-close-x" class="banner-close-x" title="バナーを閉じる（置換待機もキャンセル）" aria-label="閉じる">✕</button>' +
      '<div class="editing-banner-inner">' +
      `<span class="editing-banner-icon">${engineLabel}</span>` +
      '<div class="editing-banner-text">' +
        (isCanva
          ? '<strong>仕上げ中：</strong> Canva の新規デザインに画像を貼付して仕上げ。<br>' +
            '<span class="step-chip is-active">①Canvaを開く</span><span class="arrow">→</span>' +
            '<span class="step-chip">②画像 <kbd>⌘V</kbd></span><span class="arrow">→</span>' +
            '<span class="step-chip">③テキスト等で装飾</span><span class="arrow">→</span>' +
            '<span class="step-chip submit-chip">④ダウンロード→取込</span>'
          : (pendingReplace.needsPromptPaste
            ? '<strong>編集中（プロジェクトURL）：</strong> プロンプトは2段階で貼付。<br>' +
              '<span class="step-chip is-active">①AIを開く</span><span class="arrow">→</span>' +
              '<span class="step-chip">②画像 <kbd>⌘V</kbd></span><span class="arrow">→</span>' +
              '<span class="step-chip">③PWAで📋プロンプト切替</span><span class="arrow">→</span>' +
              '<span class="step-chip">④AIで <kbd>⌘V</kbd>（プロンプト）</span><span class="arrow">→</span>' +
              '<span class="step-chip submit-chip">⑤送信→受取</span>'
          : (isMobileDevice() && navigator.share
            ? '<strong>編集中（スマホ）：</strong> 共有シートから AI アプリを選択。<br>' +
              '<span class="step-chip is-active">①共有</span><span class="arrow">→</span>' +
              '<span class="step-chip">②AIアプリ選択</span><span class="arrow">→</span>' +
              '<span class="step-chip">③送信</span><span class="arrow">→</span>' +
              '<span class="step-chip submit-chip">④受取</span>'
            : '<strong>編集中：</strong> プロンプトはURLにプリフィル済み。<br>' +
              '<span class="step-chip is-active">①AIを開く</span><span class="arrow">→</span>' +
              '<span class="step-chip">②画像 <kbd>⌘V</kbd></span><span class="arrow">→</span>' +
              '<span class="step-chip">③送信</span><span class="arrow">→</span>' +
              '<span class="step-chip submit-chip">④受取</span>'))) +
      '</div>' +
      // === ④受取の具体的な手順を強調表示 ===
      '<div class="banner-receive-guide">' +
        (isCanva
          ? '<strong>🎨 Canva 仕上げ手順</strong>' +
            '<ol style="margin:6px 0 0; padding-left:20px; font-size:0.85em;">' +
            '<li>「🚀 Canva を開く」 → Canva ホーム（ダッシュボード）が開く</li>' +
            '<li>右上「<strong>デザインを作成</strong>」→「カスタムサイズ」→ <strong>1200×630</strong> を入力</li>' +
            '<li>キャンバス上で <kbd>⌘V</kbd> → 画像が貼付される</li>' +
            '<li>テキスト・矢印・ブランドカラーを追加して装飾</li>' +
            '<li>右上「共有」→「ダウンロード」で PNG/JPG 保存</li>' +
            '<li>このPWA に戻り <strong>「📥 完成画像を取込」</strong> または <strong>ドラッグ＆ドロップ</strong> → 自動置換</li>' +
            '</ol>'
          : '<strong>📥 ④受取：AI画像が出たあと</strong>' +
            (isMobileDevice() && navigator.share
              ? '<ol style="margin:6px 0 0; padding-left:20px; font-size:0.85em;">' +
                '<li>AI画像を<strong>長押し→画像を保存</strong>（または共有→このPWAを選択）</li>' +
                '<li>このPWAに戻る → 下の <strong>「📥 完成画像を取込」</strong> ボタンを押す → 保存した画像を選択</li>' +
                '<li>または PWA画面でファイルをドラッグ＆ドロップ</li>' +
                '<li>→ 元画像が <strong>自動で置換</strong>されます</li>' +
                '</ol>'
              : '<ol style="margin:6px 0 0; padding-left:20px; font-size:0.85em;">' +
                '<li>AI画像を<strong>右クリック→画像をコピー</strong>（ChatGPTは「画像をコピー」、Geminiは「画像を保存」推奨）</li>' +
                '<li>このPWA画面に戻る（Cmd+Tab）</li>' +
                '<li><kbd>⌘V</kbd> でペースト → 元画像が <strong>自動で置換</strong>されます</li>' +
                '<li>または保存ファイルをこのPWA画面に <strong>ドラッグ＆ドロップ</strong></li>' +
                '</ol>')) +
      '</div>' +
      '<div class="editing-banner-actions">' +
        (isMobileDevice() && navigator.share
          ? `<button type="button" id="banner-share" class="banner-open-ai" title="画像＋プロンプトを共有">📤 ${engineLabel}アプリへ共有</button>`
          : `<button type="button" id="banner-open-ai" class="banner-open-ai" title="${engineLabel} を開き直す">🚀 ${engineLabel} を開く</button>`) +
        '<button type="button" id="banner-receive-file" title="設定フォルダから最新画像を自動取込（未設定なら標準ファイル選択）">📥 完成画像を取込</button>' +
        '<button type="button" id="banner-set-folder" title="取込元フォルダ（Google Drive ダウンロード等）を設定">📁 取込元設定</button>' +
        '<button type="button" id="banner-copy-image" title="画像をクリップボードへ">📋 画像をコピー</button>' +
        (pendingReplace.needsPromptPaste
          ? '<button type="button" id="banner-copy-prompt" class="banner-copy-prompt-strong" title="クリップボードを「プロンプト」に切替 → AI で⌘V">📋 プロンプトに切替（必須）</button>'
          : '<button type="button" id="banner-copy-prompt" title="プロンプトをクリップボードへ（保険）">📋 プロンプト</button>') +
        '<button type="button" id="banner-cancel">置換キャンセル</button>' +
      '</div>' +
      '<div id="banner-folder-status" class="banner-folder-status"></div>' +
      // ── プロンプトの編集UI（テンプレ・変数・本文） ──
      '<details class="banner-prompt-builder" id="banner-prompt-builder">' +
        '<summary>📝 プロンプトを編集（テンプレ・変数・本文）</summary>' +
        '<div class="banner-pb-body">' +
          '<div class="banner-pb-row">' +
            '<label for="banner-tpl">テンプレート：</label>' +
            '<select id="banner-tpl">' +
              '<option value="__keep__">— 変更しない（現在のプロンプト）—</option>' +
              '<option value="eyecatch">🖼️ ブログアイキャッチ（1200×630）</option>' +
              '<option value="concept">💡 概念図（フラット・白背景）</option>' +
              '<option value="flow">🔀 フロー図</option>' +
              '<option value="roi">📐 ROI 流れ図</option>' +
              '<option value="compare">⚖️ 比較表</option>' +
              '<option value="ngsummary">⚠️ NG集サマリ</option>' +
              '<option value="bgremove">🪄 背景除去</option>' +
              '<option value="colorfix">🎨 配色統一</option>' +
              '<option value="addtext">✏️ 画像にテキスト追加</option>' +
              '<option value="custom">📝 カスタム（自由入力）</option>' +
            '</select>' +
          '</div>' +
          '<div class="banner-pb-vars">' +
            '<label class="banner-pb-var"><span>記事タイトル</span>' +
              '<input type="text" id="banner-var-title" placeholder="例：MX ERGO S 設定編"></label>' +
            '<label class="banner-pb-var"><span>メイン訴求</span>' +
              '<input type="text" id="banner-var-main"  placeholder="例：年6万円の時短"></label>' +
            '<label class="banner-pb-var"><span>サブ訴求</span>' +
              '<input type="text" id="banner-var-sub"   placeholder="例：Logi Options+ で1個を5職務分の専用機に化かす"></label>' +
            '<label class="banner-pb-var"><span>配色／雰囲気</span>' +
              '<input type="text" id="banner-var-mood"  placeholder="例：青系（#1d4ed8）＋アクセントオレンジ #f97316"></label>' +
          '</div>' +
          '<textarea id="banner-prompt-edit" rows="8" class="banner-prompt-edit"></textarea>' +
          '<small style="opacity:.75">本文を直接編集してもOK。変更は自動で次回の「🚀 開く」に反映されます。</small>' +
        '</div>' +
      '</details>' +
      '</div>';
    editingBanner.style.display = 'block';
    // 取込元フォルダ名を非同期表示
    (async () => {
      const fs = document.getElementById('banner-folder-status');
      if (!fs) return;
      if (!supportsFSAccess()) {
        fs.innerHTML = '⚠️ このブラウザはフォルダ自動取込に未対応（Chrome/Edge推奨）';
        return;
      }
      const h = await settingsGet(FOLDER_KEY);
      fs.innerHTML = h
        ? `📁 取込元：<strong>${h.name}</strong>（「📥 完成画像を取込」で最新画像を自動取込）`
        : '📁 取込元フォルダ未設定 → <strong>「📁 取込元設定」</strong>で Google Drive のダウンロードフォルダを選択してください';
    })();
    // 編集中は新規生成ヘルパー(#ai-helper)とそのトリガー(#btn-open-ai-helper)を隠す（機能重複の解消）
    const ah = document.getElementById('ai-helper');
    if (ah) { ah.style.display = 'none'; if (ah.open) ah.open = false; }
    const ahBtn = document.getElementById('btn-open-ai-helper');
    if (ahBtn) ahBtn.style.display = 'none';

    // ── プロンプト編集UIの初期化＆イベント結線 ──
    (function setupPromptBuilder() {
      const tplSel = document.getElementById('banner-tpl');
      const inpT   = document.getElementById('banner-var-title');
      const inpM   = document.getElementById('banner-var-main');
      const inpS   = document.getElementById('banner-var-sub');
      const inpO   = document.getElementById('banner-var-mood');
      const taPrompt = document.getElementById('banner-prompt-edit');
      if (!tplSel || !taPrompt) return;
      // 既存変数値を上部AIヘルパー（#ai-helper側のinput）から引き継ぐ
      const aiTitle = document.getElementById('ai-var-title');
      const aiMain  = document.getElementById('ai-var-main');
      const aiSub   = document.getElementById('ai-var-sub');
      const aiMood  = document.getElementById('ai-var-mood');
      if (aiTitle && inpT) inpT.value = aiTitle.value || '';
      if (aiMain  && inpM) inpM.value = aiMain.value  || '';
      if (aiSub   && inpS) inpS.value = aiSub.value   || '';
      if (aiMood  && inpO) inpO.value = aiMood.value  || '';
      // 現在のプロンプトを反映
      taPrompt.value = pendingReplace.prompt || '';

      function regen() {
        const key = tplSel.value;
        if (key === '__keep__') return; // 何もしない
        const tpl = (typeof AI_TEMPLATES !== 'undefined') ? AI_TEMPLATES[key] : null;
        if (!tpl) return;
        const vars = {
          title: (inpT.value || '').trim(),
          main:  (inpM.value || '').trim(),
          sub:   (inpS.value || '').trim(),
          mood:  (inpO.value || '').trim(),
        };
        taPrompt.value = tpl(vars);
        pendingReplace.prompt = taPrompt.value;
      }
      tplSel.addEventListener('change', regen);
      [inpT, inpM, inpS, inpO].forEach(el => el && el.addEventListener('input', () => {
        if (tplSel.value !== '__keep__' && tplSel.value !== 'custom') regen();
      }));
      taPrompt.addEventListener('input', () => {
        pendingReplace.prompt = taPrompt.value;
      });
    })();

    document.getElementById('banner-cancel').onclick = cancelPendingReplace;
    const btnCloseX = document.getElementById('banner-close-x');
    if (btnCloseX) btnCloseX.onclick = cancelPendingReplace;
    const btnReceiveFile = document.getElementById('banner-receive-file');
    if (btnReceiveFile) {
      btnReceiveFile.onclick = async () => {
        if (!pendingReplace) return;
        const handle = await getSavedFolderHandle();
        if (handle) {
          // 編集開始時刻以降に追加されたファイルのみ対象。前回取り込んだファイルは除外
          const sinceMs = pendingReplace.startedAt || 0;
          const excludeKey = pendingReplace.lastImportedKey || '';
          let result = await pickLatestImageFromFolder(handle, sinceMs, excludeKey);
          if (!result) {
            // 編集開始後の新規ファイルが無い場合は、緩い条件（直近10分以内）で再検索
            const recent = Date.now() - 10 * 60 * 1000;
            result = await pickLatestImageFromFolder(handle, recent, excludeKey);
          }
          if (result) {
            const { file, key } = result;
            const ext = (file.name.split('.').pop() || 'png').toLowerCase();
            const ok = await tryReplaceWithEditedImage(file, file.type || 'image/png', ext);
            if (ok) {
              // 次回の重複取込を防ぐためのキーを保存（ただしpendingReplaceはこの後nullになるので意味薄）
              showToast(`✨ 「${file.name}」（${new Date(file.lastModified).toLocaleTimeString()}）で置換しました`, 'success');
            } else {
              showToast('置換に失敗しました', 'error');
            }
            return;
          }
          showToast(`「${handle.name}」フォルダに編集後の新しい画像が見つかりません。ダウンロードが完了しているか、または手動でファイル選択してください`, 'warn');
        }
        // 未設定 or 新規ファイルなし → 通常のファイル選択ダイアログ
        openFilePickerForReceive();
      };
    }
    const btnSetFolder = document.getElementById('banner-set-folder');
    if (btnSetFolder) {
      btnSetFolder.onclick = async () => {
        await chooseDownloadFolder();
        showEditingBanner(); // バナー再描画でフォルダ名を反映
      };
    }
    const btnShare = document.getElementById('banner-share');
    if (btnShare) {
      btnShare.onclick = async () => {
        if (!pendingReplace || !pendingReplace.originalItem) return;
        const ok = await mobileShareEdit(
          pendingReplace.originalItem,
          pendingReplace.aiEngine || 'chatgpt',
          pendingReplace.prompt || ''
        );
        if (!ok) showToast('共有に失敗しました。下の「📋 画像」「📋 プロンプト」で個別に渡してください', 'warn');
      };
    }
    const btnOpenAI = document.getElementById('banner-open-ai');
    if (btnOpenAI) {
      btnOpenAI.onclick = () => {
        if (!pendingReplace) return;
        const engine = pendingReplace.aiEngine || 'chatgpt';
        // URLは毎回再構築（保存Gem URL変更やプロンプト編集に追従）
        const url = buildAIUrl(engine, pendingReplace.prompt || '');
        pendingReplace.aiUrl = url; // キャッシュも更新

        // 既存窓があれば閉じて開き直す（古いプロンプトURLが残るのを防ぐ）
        const existing = pendingReplace.aiWindow;
        if (existing && !existing.closed) {
          try { existing.close(); } catch (_) {}
        }
        const w = window.open(url, '_blank', 'width=1000,height=900,scrollbars=yes,resizable=yes');
        if (w) {
          pendingReplace.aiWindow = w;
          try { w.focus(); } catch(_) {}
          showToast('🚀 AI 画面を最新プロンプトで開きました', 'success');
        }
      };
    }
    const btnCopyImage = document.getElementById('banner-copy-image');
    const btnCopyPrompt = document.getElementById('banner-copy-prompt');
    if (btnCopyImage) {
      btnCopyImage.onclick = async () => {
        if (!pendingReplace || !pendingReplace.originalItem) return;
        try {
          const pngBlob = await blobToPngBlob(pendingReplace.originalItem.blob);
          await navigator.clipboard.write([new ClipboardItem({'image/png': pngBlob})]);
          clipboardMode = 'image';
          showToast('📋 クリップボードを「画像」に切替', 'success');
          updateStepChips();
        } catch (e) {
          showToast('画像コピー失敗: ' + (e.message || e), 'error');
        }
      };
    }
    if (btnCopyPrompt) {
      btnCopyPrompt.onclick = async () => {
        if (!pendingReplace) return;
        try {
          await navigator.clipboard.writeText(pendingReplace.prompt || '');
          clipboardMode = 'prompt';
          showToast('📋 クリップボードを「プロンプト」に切替', 'success');
          updateStepChips();
        } catch (e) {
          showToast('プロンプトコピー失敗: ' + (e.message || e), 'error');
        }
      };
    }
    updateStepChips();
  }

  // ─── ステップチップの強調表示 + クリップボード状態追跡 ─────
  let clipboardMode = 'image'; // 'image' | 'prompt'
  function updateStepChips() {
    if (!editingBanner) return;
    const chips = editingBanner.querySelectorAll('.step-chip');
    if (!chips.length) return;
    // ①AIを開く ②画像 ③送信 の3チップ構成。クリップボード状態で②のラベルを切替
    const secondChip = chips[1];
    if (secondChip) {
      if (clipboardMode === 'prompt') {
        secondChip.innerHTML = '②プロンプト <kbd>⌘V</kbd>';
        secondChip.classList.add('is-active');
      } else {
        secondChip.innerHTML = '②画像 <kbd>⌘V</kbd>';
        secondChip.classList.add('is-active');
      }
    }
  }

  // 旧仕様の autoSwitchToPrompt は廃止
  // 理由：プロンプトはURLにプリフィルするようになったため、
  //       PWAに戻った瞬間にクリップボードを「画像→プロンプト」に切替えると
  //       画像が消えてしまい、AI画面で⌘Vしてもテキストしか貼れない不具合になる。
  //       明示的に「📋 プロンプト」ボタンを押した時だけクリップボードを切替える。

  async function cancelPendingReplace() {
    if (pendingReplace && pendingReplace.originalItem) {
      try {
        delete pendingReplace.originalItem.editingWith;
        await queuePut(pendingReplace.originalItem);
      } catch (e) {}
    }
    pendingReplace = null;
    if (editingBanner) editingBanner.style.display = 'none';
    // 隠していた新規生成ヘルパーを復活
    const ah = document.getElementById('ai-helper');
    if (ah) ah.style.display = '';
    const ahBtn = document.getElementById('btn-open-ai-helper');
    if (ahBtn) ahBtn.style.display = '';
    await renderQueue();
    showToast('置換待機をキャンセルしました', 'success');
  }

  // 編集後の画像が貼付された時、元と置き換える処理
  async function tryReplaceWithEditedImage(blob, mime, ext) {
    if (!pendingReplace) return false;
    const orig = pendingReplace.originalItem;
    // 元 item を編集後画像で更新
    orig.blob = blob;
    orig.mimeType = mime;
    orig.ext = ext;
    orig.size = blob.size;
    orig.editedAt = Date.now();
    orig.editedWith = pendingReplace.aiEngine;
    delete orig.editingWith;
    orig.originalName = (orig.originalName || ('edited_' + orig.id)).replace(/\.[^.]+$/, '') + '.' + ext;
    await queuePut(orig);
    pendingReplace = null;
    if (editingBanner) editingBanner.style.display = 'none';
    // 隠していた新規生成ヘルパーを復活
    const ah = document.getElementById('ai-helper');
    if (ah) ah.style.display = '';
    const ahBtn = document.getElementById('btn-open-ai-helper');
    if (ahBtn) ahBtn.style.display = '';
    await renderQueue();
    showToast(`✨ 編集後の画像で置換完了`, 'success');
    navigator.vibrate && navigator.vibrate([20, 30, 30]);
    return true;
  }

  // ─── クリップボード貼り付け（Cmd/Ctrl+V でスクショ追加 / 編集後置換）─────────
  async function handlePastedItems(items) {
    let added = 0;
    let replaced = 0;
    for (const item of items || []) {
      if (!item || !item.type || !item.type.startsWith('image/')) continue;
      const blob = (typeof item.getAsFile === 'function') ? item.getAsFile() : item;
      if (!blob) continue;
      const ext = (blob.type.split('/')[1] || 'png').toLowerCase().replace('jpeg', 'jpg');
      // 置換モード中なら、最初の1枚で元画像を置換
      if (pendingReplace && replaced === 0) {
        const ok = await tryReplaceWithEditedImage(blob, blob.type || 'image/png', ext);
        if (ok) { replaced++; continue; }
      }
      await addToQueue(blob, blob.type || 'image/png', ext);
      added++;
    }
    if (added > 0 && !replaced) {
      showToast(`スクショ${added}枚を貼付`, 'success');
      navigator.vibrate && navigator.vibrate(30);
    } else if (added > 0 && replaced) {
      showToast(`編集後画像で置換＋追加${added}枚`, 'success');
    }
    return added + replaced;
  }

  // ─── 🎨 ChatGPT 画像生成・編集ヘルパー ───────────────────────
  const aiHelperDetails = $('ai-helper');
  const btnOpenAIHelper = $('btn-open-chatgpt-helper');
  const aiTemplateSelect = $('ai-template-select');
  const aiVarTitle = $('ai-var-title');
  const aiVarMain = $('ai-var-main');
  const aiVarSub = $('ai-var-sub');
  const aiVarMood = $('ai-var-mood');
  const aiPrompt = $('ai-prompt');
  const btnAiCopy = $('btn-ai-copy');
  const btnAiOpen = $('btn-ai-open');

  const AI_TEMPLATES = {
    eyecatch: ({title, main, sub, mood}) => `ブログ記事のアイキャッチ画像を1枚作成してください。

【サイズ・比率】
横1200×縦630px（アスペクト比40:21 横長）

【雰囲気】
${mood || 'ガジェット×ビジネス、洗練されたプロフェッショナルな雰囲気'}

【配色】
${mood || 'メイン：深い青 #1d4ed8 〜 明るい青 #3b82f6 のグラデ背景／アクセント：オレンジ #f97316／テキストは白とオレンジ'}

【含めるテキスト（画像内に表記）】
- メインタイトル（大・太字・白色）：「${title || 'ブログ記事タイトル'}」
- サブタイトル（中・オレンジ色・強調）：「${main || 'メイン訴求'}」
- 補足：「${sub || 'サブ訴求テキスト'}」
- 右上に小さく「学ぶ・作る・生産技術」のタグ
- 日本語フォントは読みやすいゴシック体（Noto Sans JP 風）

【テキスト配置】
中央右寄り上部にメインタイトル、その下にサブタイトル、最下部に補足。読みやすさ最優先。

記事中にcropせずそのまま使える1枚として、誠実に作成してください。`,

    concept: ({title, main, sub, mood}) => `ブログ記事用のコンセプト図解を1枚作成してください。

【サイズ】横1200×縦630px
【スタイル】白背景・フラットデザイン・ブログイラスト風・読みやすさ最優先

【含めるコンテンツ】
- 上部にタイトル（青 #1d4ed8 太字）：「${title || '概念図タイトル'}」
- 中央に主役オブジェクト（${main || '主要素'} のイラスト）
- 関連要素を矢印で接続：${sub || '関連要素を矢印で接続'}
- 各要素には短いラベル（日本語ゴシック・読みやすさ最優先）

【配色】
${mood || '白背景 / タイトル青 #1d4ed8 / 強調オレンジ #f97316 / テキスト黒 #1f2937'}

記事中にそのまま使える品質で誠実に作成してください。`,

    flow: ({title, main, sub, mood}) => `ブログ記事用のフロー図（縦長）を1枚作成してください。

【サイズ】横1200×縦630px
【スタイル】白背景・フラットデザイン・矢印を強調

【内容】
- タイトル（青 #1d4ed8 太字）：「${title || 'フロー図タイトル'}」
- ステップを縦に並べる：${main || '各ステップの内容'}
- 各ステップ間を太い矢印（オレンジ #f97316）で接続
- 補足キャプション：${sub || '補足説明'}

【配色】${mood || '青系×オレンジアクセント'}

記事中にそのまま使える品質で誠実に作成してください。`,

    roi: ({title, main, sub, mood}) => `ROI（投資対効果）の計算式流れ図を1枚作成してください。

【サイズ】横1200×縦630px
【スタイル】白背景・インフォグラフィック風

【内容】
- タイトル（青 #1d4ed8）：「${title || 'ROI計算の流れ'}」
- 4つの矩形ボックスを左から右に配置し矢印で接続：
  1. 購入価格
  2. 1日あたり節約価値
  3. 損益分岐日数
  4. 3年累計純利益（オレンジで強調）
- 各ボックス内に「式 = 結果」を明記
- 主役数値：${main || '主要数値'}
- 注釈：${sub || '時給950円基準 など'}

【配色】${mood || '青系背景＋オレンジ結果ハイライト'}

記事中にそのまま使える品質で誠実に作成してください。`,

    compare: ({title, main, sub, mood}) => `比較表ビジュアルを1枚作成してください。

【サイズ】横1200×縦630px
【スタイル】白背景・3列の比較カード型

【内容】
- タイトル（青 #1d4ed8）：「${title || '比較タイトル'}」
- 3つのカード横並び：${main || '比較対象3つの名前'}
- 各カードに：項目1・項目2・項目3 を縦に並べ、優位な項目をオレンジでハイライト
- 補足：${sub || '比較の補足'}

【配色】${mood || '白背景＋青枠＋勝者はオレンジ強調'}

記事中にそのまま使える品質で誠実に作成してください。`,

    ngsummary: ({title, main, sub, mood}) => `ブログ記事用の「やってはいけない設定」NG集サマリ図を1枚作成してください。

【サイズ】横1200×縦630px
【スタイル】白背景・4つのNGをアイコン＋短文で並べる

【内容】
- タイトル（赤 #dc2626 太字）：「${title || 'やってはいけない設定 4つ'}」
- 4つのカードを2×2グリッドで配置：${main || 'NG項目1〜4'}
- 各カードに ❌アイコン＋簡潔な見出し＋1行説明
- 補足：${sub || ''}

【配色】${mood || '白背景＋赤アクセント＋警告イエロー'}

記事中にそのまま使える品質で誠実に作成してください。`,

    bgremove: ({title, main, sub, mood}) => `この画像の背景を除去（透過PNG化）してください。

【要件】
- 被写体：${main || '主役オブジェクト（自動判別でOK）'}
- 不要な背景要素は完全に削除し、透過PNGで出力
- 被写体のエッジを滑らかに（特に毛・布地・反射の細部）
- サイズ：オリジナル維持
- 補足：${sub || ''}`,

    colorfix: ({title, main, sub, mood}) => `この画像の配色を統一してブランドカラーに合わせてください。

【ブランドカラー】
${mood || 'メイン青 #1d4ed8 / アクセントオレンジ #f97316 / 白＆ライトグレー'}

【要件】
- 全体トーンをブランドカラーに寄せる
- 被写体は維持・背景や装飾色を統一
- 用途：${main || 'ブログ記事用'}
- 補足：${sub || ''}`,

    addtext: ({title, main, sub, mood}) => `この画像にテキストを追加してください。

【追加テキスト】
- メイン：「${title || 'メインテキスト'}」（${mood || '白色・太字・読みやすい位置に'}）
- サブ：「${main || 'サブテキスト'}」（オレンジ強調）
- 補足：「${sub || ''}」

【要件】
- 日本語ゴシック体（Noto Sans JP 風）
- 元画像の被写体を妨げない位置・サイズ
- ブログのアイキャッチとして読みやすさ最優先`,

    custom: () => '',
  };

  function regenerateAIPrompt() {
    const key = aiTemplateSelect.value;
    const tpl = AI_TEMPLATES[key];
    if (!tpl) return;
    const vars = {
      title: aiVarTitle.value.trim(),
      main: aiVarMain.value.trim(),
      sub: aiVarSub.value.trim(),
      mood: aiVarMood.value.trim(),
    };
    const generated = tpl(vars);
    // custom テンプレなら現在のテキストを尊重
    if (key !== 'custom' || !aiPrompt.value.trim()) {
      aiPrompt.value = generated;
    }
  }

  // 4つ目の丸ボタンクリックでヘルパーを開く（and 自動でプロンプト生成）
  if (btnOpenAIHelper) {
    btnOpenAIHelper.addEventListener('click', () => {
      aiHelperDetails.open = true;
      // 記事名を現在の選択から自動入力
      if (!aiVarTitle.value) {
        aiVarTitle.value = getCurrentArticleName() || '';
      }
      regenerateAIPrompt();
      aiHelperDetails.scrollIntoView({behavior: 'smooth', block: 'start'});
    });
  }

  // ─── 一時保存画像の AI 編集（キュー画像のセット）────────────
  const aiSourceImageBox = document.getElementById('ai-source-image');
  const aiSourceImg = document.getElementById('ai-source-img');
  const btnAIClearSource = document.getElementById('btn-ai-clear-source');
  const btnAICopyImage = document.getElementById('btn-ai-copy-image');
  let currentEditTarget = null; // {id, blob, mimeType}

  window.openAIHelperWithImage = async function(item) {
    currentEditTarget = item;
    // プレビュー画像セット
    if (aiSourceImg.src && aiSourceImg.src.startsWith('blob:')) {
      try { URL.revokeObjectURL(aiSourceImg.src); } catch (e) {}
    }
    aiSourceImg.src = URL.createObjectURL(item.blob);
    aiSourceImageBox.hidden = false;
    // 編集系テンプレを自動選択（最初の編集系）
    aiHelperDetails.open = true;
    aiTemplateSelect.value = 'bgremove';
    regenerateAIPrompt();
    // 記事名を自動入力
    if (!aiVarTitle.value) aiVarTitle.value = getCurrentArticleName() || '';
    aiHelperDetails.scrollIntoView({behavior: 'smooth', block: 'start'});
    showToast('AI編集モード：画像をセットしました', 'success');
  };

  // クリアボタン
  if (btnAIClearSource) {
    btnAIClearSource.addEventListener('click', () => {
      currentEditTarget = null;
      if (aiSourceImg.src && aiSourceImg.src.startsWith('blob:')) {
        try { URL.revokeObjectURL(aiSourceImg.src); } catch (e) {}
      }
      aiSourceImg.src = '';
      aiSourceImageBox.hidden = true;
      showToast('編集対象をクリアしました', 'success');
    });
  }

  // 「📋 画像をクリップボードにコピー」
  if (btnAICopyImage) {
    btnAICopyImage.addEventListener('click', async () => {
      if (!currentEditTarget) {
        showToast('編集対象の画像が選ばれていません', 'error');
        return;
      }
      try {
        if (!navigator.clipboard || !window.ClipboardItem) {
          showToast('このブラウザは画像クリップボードに未対応', 'error');
          return;
        }
        let blob = currentEditTarget.blob;
        // ClipboardItem は基本 image/png のみ確実。jpeg/webp は変換が必要
        if (blob.type !== 'image/png') {
          // canvas で PNG に変換
          const img = new Image();
          img.src = URL.createObjectURL(blob);
          await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          canvas.getContext('2d').drawImage(img, 0, 0);
          blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
          URL.revokeObjectURL(img.src);
        }
        await navigator.clipboard.write([new ClipboardItem({'image/png': blob})]);
        showToast('画像をクリップボードにコピー完了。ChatGPT/Geminiで Cmd/Ctrl+V で貼付してください', 'success');
        navigator.vibrate && navigator.vibrate(30);
      } catch (err) {
        console.error('image copy failed:', err);
        if (err && (err.name === 'NotAllowedError' || /denied|permission/i.test(err.message||''))) {
          showToast('クリップボード書き込みが拒否されました。ブラウザ設定で許可してください', 'error');
        } else {
          showToast('画像コピー失敗: ' + (err.message || err), 'error');
        }
      }
    });
  }

  // テンプレ変更・変数変更で再生成
  if (aiTemplateSelect) {
    aiTemplateSelect.addEventListener('change', regenerateAIPrompt);
    [aiVarTitle, aiVarMain, aiVarSub, aiVarMood].forEach(el => {
      el && el.addEventListener('input', () => {
        if (aiTemplateSelect.value !== 'custom') regenerateAIPrompt();
      });
    });
    // 初回ロード時、プロンプトが空ならデフォルトテンプレ（ブログアイキャッチ）で初期化
    if (aiPrompt && !aiPrompt.value.trim()) {
      regenerateAIPrompt();
    }
  }

  // 「📋 プロンプトをコピー」
  if (btnAiCopy) {
    btnAiCopy.addEventListener('click', async () => {
      const text = aiPrompt.value;
      if (!text.trim()) {
        showToast('プロンプトが空です', 'error');
        return;
      }
      try {
        await navigator.clipboard.writeText(text);
        showToast('プロンプトをコピーしました', 'success');
        navigator.vibrate && navigator.vibrate(20);
      } catch (e) {
        // フォールバック
        aiPrompt.select();
        document.execCommand('copy');
        showToast('プロンプトをコピーしました', 'success');
      }
    });
  }

  // 直近で開いたAI窓を engine 別に保持（プロンプト変更時に閉じて開き直す）
  const lastAIWindows = { chatgpt: null, gemini: null };
  function openFreshAI(engine, url, features) {
    // 既存窓があれば閉じる（古いプロンプトURLを残さないため）
    const prev = lastAIWindows[engine];
    if (prev && !prev.closed) {
      try { prev.close(); } catch (_) {}
    }
    const w = window.open(url, '_blank', features);
    if (w) lastAIWindows[engine] = w;
    return w;
  }

  // 「🚀 ChatGPTで開く」 → 新規ウィンドウで chatgpt.com を開く
  if (btnAiOpen) {
    btnAiOpen.addEventListener('click', async () => {
      const text = aiPrompt.value;
      if (!text.trim()) {
        showToast('プロンプトが空です', 'error');
        return;
      }
      try { await navigator.clipboard.writeText(text); } catch (e) {}
      const url = buildAIUrl('chatgpt', text);
      const w = openFreshAI('chatgpt', url, 'width=900,height=900,scrollbars=yes,resizable=yes');
      if (!w) window.open(url, '_blank');
      showToast('✨ ChatGPTを開きました。プロンプトは自動入力済み → 送信するだけ', 'success');
    });
  }

  // 「🍌 Geminiで開く（ナノバナナ2）」
  const btnAiOpenGemini = $('btn-ai-open-gemini');
  if (btnAiOpenGemini) {
    btnAiOpenGemini.addEventListener('click', async () => {
      const text = aiPrompt.value;
      if (!text.trim()) {
        showToast('プロンプトが空です', 'error');
        return;
      }
      try { await navigator.clipboard.writeText(text); } catch (e) {}
      const url = buildAIUrl('gemini', text);
      const w = openFreshAI('gemini', url, 'width=1000,height=900,scrollbars=yes,resizable=yes');
      if (!w) window.open(url, '_blank');
      showToast('✨ Geminiを開きました。プロンプトは自動入力済み → 送信するだけ（モデルで「ナノバナナ2」/画像生成を選択）', 'success');
    });
  }

  // ─── 「📋 クリップボードから貼付」ボタン（明示的トリガー）─────────────────
  const btnPasteClipboard = $('btn-paste-clipboard');
  if (btnPasteClipboard) {
    btnPasteClipboard.addEventListener('click', async () => {
      try {
        if (!navigator.clipboard || !navigator.clipboard.read) {
          showToast('このブラウザはクリップボード読取に未対応', 'error');
          return;
        }
        const clipItems = await navigator.clipboard.read();
        let added = 0;
        for (const ci of clipItems) {
          for (const type of ci.types) {
            if (!type.startsWith('image/')) continue;
            const blob = await ci.getType(type);
            const ext = (type.split('/')[1] || 'png').toLowerCase().replace('jpeg', 'jpg');
            await addToQueue(blob, type, ext);
            added++;
          }
        }
        if (added > 0) {
          showToast(`クリップボードから${added}枚追加`, 'success');
          navigator.vibrate && navigator.vibrate(30);
        } else {
          showToast('クリップボードに画像がありません', 'error');
        }
      } catch (err) {
        if (err && (err.name === 'NotAllowedError' || /denied/i.test(err.message||''))) {
          showToast('クリップボード読取が拒否されました。ブラウザ設定で許可してください', 'error');
        } else {
          showToast('読み込みに失敗: ' + (err.message || err), 'error');
        }
        console.error('clipboard.read failed:', err);
      }
    });
  }

  document.addEventListener('paste', async (e) => {
    const items = (e.clipboardData && e.clipboardData.items) ? Array.from(e.clipboardData.items) : [];
    const hasImage = items.some(it => it && it.type && it.type.startsWith('image/'));
    if (!hasImage) return;
    // 画像が含まれていれば、テキスト入力欄でも横取りして取り込む
    e.preventDefault();
    await handlePastedItems(items);
  });

  // 専用貼付ターゲットのフォーカス管理＋プレースホルダー復元
  const pasteTarget = document.getElementById('paste-target');
  if (pasteTarget) {
    // クリックで自動フォーカス
    pasteTarget.addEventListener('click', () => pasteTarget.focus());
    pasteTarget.addEventListener('focus', () => {
      pasteTarget.classList.add('is-focused');
    });
    pasteTarget.addEventListener('blur', () => {
      pasteTarget.classList.remove('is-focused');
      // 中身が空になったらプレースホルダー復元
      if (!pasteTarget.textContent.trim() && !pasteTarget.querySelector('img')) {
        pasteTarget.innerHTML = '<span class="paste-target-placeholder">⬇ ここをタップしてから Ctrl/⌘+V でスクショを貼付</span>';
      }
    });
    // フォーカス時はプレースホルダーを消す
    pasteTarget.addEventListener('focusin', () => {
      const ph = pasteTarget.querySelector('.paste-target-placeholder');
      if (ph) ph.remove();
    });
    // 貼付直後はテキストや画像がDOMに入ることがあるので、即クリア（addToQueue 側で処理済）
    pasteTarget.addEventListener('paste', () => {
      setTimeout(() => {
        pasteTarget.innerHTML = '<span class="paste-target-placeholder">✅ 貼付完了。続けて Ctrl/⌘+V で追加できます</span>';
        pasteTarget.focus();
      }, 100);
    });
  }

  // ─── ドラッグ&ドロップで画像ファイル取込（PC用） ─────────────────────
  const dropZone = document.body;
  let dragCounter = 0;
  function isFileDrag(e) {
    return e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
  }
  dropZone.addEventListener('dragenter', (e) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    dragCounter++;
    document.body.classList.add('is-dropping');
  });
  dropZone.addEventListener('dragover', (e) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
  });
  dropZone.addEventListener('dragleave', (e) => {
    if (!isFileDrag(e)) return;
    dragCounter = Math.max(0, dragCounter - 1);
    if (dragCounter === 0) document.body.classList.remove('is-dropping');
  });
  dropZone.addEventListener('drop', async (e) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    dragCounter = 0;
    document.body.classList.remove('is-dropping');
    const files = Array.from(e.dataTransfer.files || []);
    let added = 0;
    for (const f of files) {
      const ext = (f.name.split('.').pop() || 'bin').toLowerCase();
      await addToQueue(f, f.type || 'application/octet-stream', ext);
      added++;
    }
    if (added > 0) {
      showToast(`ファイル${added}件を追加`, 'success');
      navigator.vibrate && navigator.vibrate(30);
    }
  });

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
    updateCurrentArticleDisplay();
  });
  articleSelect.addEventListener('change', async () => {
    selectedNewArticle = null;
    newArticleInput.value = '';
    // 既存記事を選んだら PROMPT.md をDriveから復元
    const folderId = articleSelect.value;
    if (folderId) await loadExistingPrompt(folderId);
    updateCurrentArticleDisplay();
  });

  // ─── 現在使用中の記事 表示＆リネーム ────────────────
  const currentArticleBar = $('current-article-bar');
  const currentArticleNameEl = $('current-article-name');
  const currentArticleDisplay = $('current-article-display');
  const currentArticleEditForm = $('current-article-edit-form');
  const renameArticleInput = $('rename-article-input');
  const btnRenameArticle = $('btn-rename-article');
  const btnSaveRename = $('btn-save-rename');
  const btnCancelRename = $('btn-cancel-rename');

  function getCurrentArticleName() {
    if (selectedNewArticle) return selectedNewArticle;
    const folderId = articleSelect.value;
    if (folderId) {
      const opt = Array.from(articleSelect.options).find(o => o.value === folderId);
      return opt ? opt.textContent : '';
    }
    return '';
  }

  function updateCurrentArticleDisplay() {
    const name = getCurrentArticleName();
    if (!name) {
      currentArticleBar.hidden = true;
      return;
    }
    currentArticleBar.hidden = false;
    currentArticleNameEl.textContent = name;
    // 編集モードを閉じる
    currentArticleDisplay.hidden = false;
    currentArticleEditForm.hidden = true;
  }

  btnRenameArticle && btnRenameArticle.addEventListener('click', () => {
    const cur = getCurrentArticleName();
    if (!cur) { showToast('記事を選択してから変更してください', 'error'); return; }
    renameArticleInput.value = cur;
    currentArticleDisplay.hidden = true;
    currentArticleEditForm.hidden = false;
    setTimeout(() => { renameArticleInput.focus(); renameArticleInput.select(); }, 50);
  });

  btnCancelRename && btnCancelRename.addEventListener('click', () => {
    currentArticleDisplay.hidden = false;
    currentArticleEditForm.hidden = true;
  });

  btnSaveRename && btnSaveRename.addEventListener('click', async () => {
    const newName = renameArticleInput.value.trim();
    if (!newName) { showToast('記事名を入力してください', 'error'); return; }
    const folderId = articleSelect.value;

    // 新規記事（まだDrive上に作成されていない）の場合 → ローカル更新のみ
    if (selectedNewArticle && !folderId) {
      selectedNewArticle = newName;
      newArticleInput.value = newName;
      showToast('記事名を変更: ' + newName, 'success');
      updateCurrentArticleDisplay();
      return;
    }

    // 既存記事（Drive上に存在）の場合 → GAS で renameArticle 呼び出し
    if (folderId) {
      btnSaveRename.disabled = true;
      btnSaveRename.textContent = '変更中…';
      try {
        const res = await fetch(GAS_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            token: TOKEN,
            action: 'renameArticle',
            articleFolderId: folderId,
            newName: newName,
          }).toString(),
        }).then(r => r.json());

        if (!res || !res.ok) {
          throw new Error((res && res.message) || 'GAS側に renameArticle が未実装の可能性');
        }

        // 記事リストを再読み込みして反映
        await loadArticleList();
        articleSelect.value = folderId;
        showToast('記事名を変更: ' + newName, 'success');
      } catch (err) {
        console.error('rename failed:', err);
        showToast('変更失敗: ' + (err.message || err) + '\n（Drive側で手動変更してください）', 'error');
      } finally {
        btnSaveRename.disabled = false;
        btnSaveRename.textContent = '保存';
        updateCurrentArticleDisplay();
      }
      return;
    }

    showToast('記事を選択してから変更してください', 'error');
  });

  // Enter で保存
  renameArticleInput && renameArticleInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); btnSaveRename.click(); }
    if (e.key === 'Escape') { btnCancelRename.click(); }
  });

  // 初期表示時にも反映
  setTimeout(updateCurrentArticleDisplay, 100);

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
