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
  // 🛡 古いスナップショットの丸ごと書き戻し（compareIndex等の消失）を防ぐ安全な部分更新。
  // 最新レコードを取得→mutateで変更→保存。レコードが削除済みなら null（書き戻さない）。
  async function queueUpdate(id, mutate) {
    const db = await openDB();
    return new Promise((res, rej) => {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const getReq = store.get(id);
      getReq.onsuccess = () => {
        const latest = getReq.result;
        if (!latest) { res(null); return; }
        try { mutate(latest); } catch (e) { rej(e); return; }
        store.put(latest);
        tx.oncomplete = () => res(latest);
      };
      getReq.onerror = () => rej(getReq.error);
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

  // カメラ ON/OFF 状態（localStorage 永続化、デフォルト ON）
  const CAM_ENABLED_KEY = 'kiji-meshi:camera-enabled';
  function isCameraEnabled() {
    const v = localStorage.getItem(CAM_ENABLED_KEY);
    return v === null ? true : v === '1';
  }
  function setCameraEnabled(on) {
    localStorage.setItem(CAM_ENABLED_KEY, on ? '1' : '0');
  }
  function applyCameraPowerUI() {
    const on = isCameraEnabled();
    const mask = document.getElementById('camera-off-mask');
    const power = document.getElementById('camera-power');
    if (mask) mask.hidden = on;
    if (power) {
      power.classList.toggle('off', !on);
      power.title = on ? 'カメラ停止（OFF）' : 'カメラ起動（ON）';
    }
  }

  async function startCamera() {
    stopCamera();
    // OFF 状態なら起動しない（待機）
    if (!isCameraEnabled()) {
      applyCameraPowerUI();
      setStatus('📷 カメラ OFF（タップで起動）');
      return;
    }
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
      applyCameraPowerUI();
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
  let issuedObjectURLs = [];   // 🛡 リーク防止：発行済みObjectURLを再描画ごとに一括解放
  let isUploading = false;     // 🛡 転送中はキュー操作（削除・役割変更・編集）をロック
  async function renderQueue() {
    issuedObjectURLs.forEach((u) => { try { URL.revokeObjectURL(u); } catch (_) {} });
    issuedObjectURLs = [];
    const items = await queueAll();
    queueList.innerHTML = '';
    queueCount.textContent = items.length;
    pendingCount.textContent = items.length;
    uploadAllBtn.disabled = items.length === 0 || isUploading;
    clearQueueBtn.disabled = items.length === 0 || isUploading;
    queueEmpty.style.display = items.length === 0 ? 'block' : 'none';
    uploadAllCount.textContent = items.length > 0 ? `${items.length}件を送信` : '';
    for (const item of items) {
      const div = document.createElement('div');
      div.className = 'queue-item';
      div.dataset.id = item.id;
      const url = URL.createObjectURL(item.blob);
      issuedObjectURLs.push(url);
      const isVideo = item.mimeType.startsWith('video/');
      const isPdf = item.mimeType === 'application/pdf';
      if (isVideo) div.innerHTML = '<video src="' + url + '" muted></video>';
      else if (isPdf) div.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;font-size:32px;">📄</div>';
      else div.innerHTML = '<img src="' + url + '" alt="">';
      const editBtnHtml = (isVideo || isPdf) ? '' :
        '<button class="ai-edit-btn" type="button" title="ChatGPTで編集" data-action="ai-gpt">🤖</button>' +
        '<button class="ai-edit-btn ai-edit-gemini" type="button" title="Geminiで編集" data-action="ai-gem">🍌</button>' +
        '<button class="ai-edit-btn ai-edit-canva" type="button" title="Canvaで仕上げ" data-action="ai-canva">🎨</button>';
      const curRoleKey = (item.role || (item.isEyecatch ? 'eyecatch' : 'none'));
      const roleDef = getRoleDef(curRoleKey);
      const roleBtnHtml = (isVideo || isPdf) ? '' :
        '<button class="role-btn' + (curRoleKey !== 'none' ? ' active' : '') + '" type="button" ' +
        'style="' + (curRoleKey !== 'none' ? `background:${roleDef.color};color:#fff;border-color:${roleDef.color};` : '') + '" ' +
        'title="' + (curRoleKey === 'none' ? 'タップして用途を選ぶ' : `${roleDef.label}（タップで用途を選び直す）`) + '" ' +
        'data-action="cycle-role">' + roleDef.emoji + '</button>';
      const editingBadge = (item.editingWith ? '<div class="editing-badge">編集中…</div>' : '');
      const replaceBadge = (item.replaceDriveFileId ? '<div class="replace-badge" title="転送時に既存ファイルを上書き">↻ 上書き</div>' : '');
      const roleBadge = (curRoleKey !== 'none'
        ? `<div class="role-badge" style="background:${roleDef.color}" title="${roleDef.label}">${roleDef.emoji} ${roleDef.label}</div>`
        : '');
      // 比較ロールのときだけ「どの製品の写真か」を選ぶセレクタを表示（製品1〜4）
      // 位置は右下の役割ボタンの上（左下のAI編集ボタン🤖🍌🎨と重ならないように）
      const cmpNames = (curRoleKey === 'compare') ? getCompareProductNames() : [];
      const compareSelHtml = (curRoleKey === 'compare')
        ? '<select class="compare-idx-sel" title="どの製品の写真か" ' +
          'style="position:absolute;right:4px;bottom:38px;z-index:6;font-size:11px;padding:2px 5px;' +
          'max-width:calc(100% - 8px);border-radius:6px;border:1px solid #ec4899;background:#fff;color:#111;">' +
          '<option value="">製品?</option>' +
          [1, 2, 3, 4].map(i =>
            `<option value="${i}"${String(item.compareIndex) === String(i) ? ' selected' : ''}>製品${i}${cmpNames[i - 1] ? '＝' + cmpNames[i - 1].slice(0, 8) : ''}</option>`
          ).join('') +
          '</select>'
        : '';
      div.insertAdjacentHTML('beforeend',
        '<span class="type-badge">' + (isVideo ? 'VID' : isPdf ? 'PDF' : 'IMG') + '</span>' +
        editBtnHtml + roleBtnHtml +
        '<button class="delete-btn" type="button">✕</button>' +
        (item.status === 'uploading' ? '<div class="status-overlay">転送中…</div>' : '') +
        editingBadge + replaceBadge + roleBadge + compareSelHtml
      );
      // 🛡 転送中は全操作ボタンを無効化（✕削除した画像が送信される事故防止）
      if (isUploading) {
        div.querySelectorAll('button, select').forEach((b) => { b.disabled = true; });
      }
      div.querySelector('.delete-btn').addEventListener('click', async (e) => {
        e.stopPropagation();
        if (isUploading) return;
        await queueDelete(item.id);
        URL.revokeObjectURL(url);
        await renderQueue();
      });
      const gptBtn = div.querySelector('[data-action="ai-gpt"]');
      const gemBtn = div.querySelector('[data-action="ai-gem"]');
      const canvaBtn = div.querySelector('[data-action="ai-canva"]');
      const roleBtn = div.querySelector('[data-action="cycle-role"]');
      if (gptBtn) gptBtn.addEventListener('click', async (e) => { e.stopPropagation(); await confirmThenEdit(item, 'chatgpt'); });
      if (gemBtn) gemBtn.addEventListener('click', async (e) => { e.stopPropagation(); await confirmThenEdit(item, 'gemini'); });
      if (canvaBtn) canvaBtn.addEventListener('click', async (e) => { e.stopPropagation(); await confirmThenEdit(item, 'canva'); });
      if (roleBtn) roleBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await openRolePickerForItem(item.id);
      });
      const cmpSel = div.querySelector('.compare-idx-sel');
      if (cmpSel) {
        cmpSel.addEventListener('click', (e) => e.stopPropagation());
        cmpSel.addEventListener('change', async (e) => {
          e.stopPropagation();
          const v = e.target.value;
          const all = await queueAll();
          const t = all.find(x => x.id === item.id);
          if (t) {
            t.compareIndex = v ? Number(v) : null;
            await queuePut(t);
            showToast(v ? `この写真を「製品${v}」に割り当て` : '製品割当を解除', 'success');
            refreshCompareGallery(); // 比較ギャラリーを即更新
            if (v) await warnIfCompareDuplicates(); // 同じ番号が複数あれば警告
          }
        });
      }
      queueList.appendChild(div);
    }
    // キュー内容が変わるたびに、編集バナーの比較ギャラリーも更新する（都度更新）
    refreshCompareGallery();
  }
  // 編集バナーの比較ギャラリーを今のキュー状態で再描画（表示中のときだけ）
  function refreshCompareGallery() {
    if (!editingBanner || editingBanner.style.display === 'none') return;
    const gal = document.getElementById('bps-cmp-gallery');
    if (gal) renderCompareGalleryInto(gal);
  }
  // ─── 画像役割（用途別タグ）──────────────────
  // 1記事につきユニーク（アイキャッチ）／複数可（他）でルールが異なる
  const ROLE_DEFS = [
    { key: 'none',      emoji: '☆',  label: '役割なし',           prefix: '',          unique: false, color: '#9ca3af' },
    { key: 'eyecatch',  emoji: '⭐', label: 'アイキャッチ',       prefix: 'eyecatch_', unique: true,  color: '#f59e0b' },
    { key: 'hero',      emoji: '🎯', label: 'ヒーローバナー',     prefix: 'hero_',     unique: true,  color: '#ef4444' },
    { key: 'section',   emoji: '📑', label: 'セクション画像',     prefix: 'section_',  unique: false, color: '#3b82f6' },
    { key: 'product',   emoji: '📸', label: '商品/実機写真',      prefix: 'product_',  unique: false, color: '#10b981' },
    { key: 'diagram',   emoji: '📐', label: '図解/フロー図',       prefix: 'diagram_',  unique: false, color: '#8b5cf6' },
    { key: 'compare',   emoji: '⚖️', label: '比較/Before-After',  prefix: 'compare_',  unique: false, color: '#ec4899' },
    { key: 'comparetable', emoji: '📊', label: '比較表(完成)',     prefix: 'comparetable_', unique: true, color: '#0ea5e9' },
    { key: 'ngsummary', emoji: '⚠️', label: 'NG集サマリ',         prefix: 'ngsummary_', unique: true, color: '#dc2626' },
  ];
  function getRoleDef(key) {
    return ROLE_DEFS.find(r => r.key === key) || ROLE_DEFS[0];
  }
  // 旧 isEyecatch との後方互換
  function normalizeItemRole(item) {
    if (item.role) return item.role;
    if (item.isEyecatch) return 'eyecatch';
    return 'none';
  }
  // 🛡 PROMPT.md の「画像役割行」を判定する正規表現（全箇所でこれを使う）。
  // ROLE_DEFS の label と完全一致させること（旧表記「アイキャッチ画像」も後方互換で残す）。
  // 比較行は「比較/Before-After 製品1（名前）:」形式（1行＝1製品）にも一致する。
  const ROLE_NOTE_RE = /^(画像役割|アイキャッチ画像|アイキャッチ|ヒーローバナー|セクション画像|商品\/実機写真|図解\/フロー図|比較表\(完成\)|比較\/Before-After(?:\s*製品\d+（[^）]*）|\s*製品\d+)?|NG集サマリ)\s*[:：]/;
  // 比較表テンプレの「比較対象」欄から製品名リストを取得。
  // 🛡 テンプレ選択が compare の入力欄だけを信用する（別テンプレの値を製品名と誤認しない）
  function getCompareProductNames() {
    let v = '';
    try {
      const helperTpl = (document.getElementById('ai-template-select') || {}).value;
      const bannerTpl = (document.getElementById('banner-tpl') || {}).value;
      if (helperTpl === 'compare') v = (document.getElementById('ai-var-main') || {}).value || '';
      if (!v && bannerTpl === 'compare') v = (document.getElementById('banner-var-main') || {}).value || '';
    } catch (_) {}
    return v.split('/').map(s => s.trim()).filter(Boolean).slice(0, 4);
  }
  async function cycleRole(targetId) {
    const all = await queueAll();
    const target = all.find(x => x.id === targetId);
    if (!target) return;
    const cur = normalizeItemRole(target);
    const idx = ROLE_DEFS.findIndex(r => r.key === cur);
    const next = ROLE_DEFS[(idx + 1) % ROLE_DEFS.length];
    // ユニーク役割なら他を解除
    if (next.unique) {
      for (const it of all) {
        if (it.id !== targetId && normalizeItemRole(it) === next.key) {
          it.role = 'none';
          it.isEyecatch = false;
          await queuePut(it);
        }
      }
    }
    target.role = next.key;
    // 互換: eyecatch のみ isEyecatch も維持
    target.isEyecatch = (next.key === 'eyecatch');
    // 「比較」以外になったら製品割当をクリア
    if (next.key !== 'compare') target.compareIndex = null;
    await queuePut(target);
    await renderQueue();
    if (next.key === 'none') {
      showToast('役割をクリアしました', 'success');
    } else {
      showToast(`${next.emoji} ${next.label}に指定 → 転送時 \`${next.prefix}xxx\` で保存`, 'success');
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
    // ChatGPTサーバーは長いURLで HTTP 431 を返す。安全圏は raw 日本語 300文字以内（≈ URL 2700バイト）
    // ※ 完全版プロンプトはクリップボード経由で渡す（btnOpenAIのonclick内で navigator.clipboard.writeText）
    const MAX = 300;
    let p = prompt;
    if (p.length > MAX) {
      // URL用は冒頭サマリだけ。詳細はクリップボードからペーストする旨を末尾に
      p = p.slice(0, MAX) + '\n…（詳細はPWAの📋プロンプトボタン経由でペーストしてください）';
    }
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
    // ChatGPT: プロンプトがある場合は chatgpt.com ルートを強制（プロジェクトURLは ?q= を無視するため）
    // → プロンプト自動入力を最優先。プロジェクト文脈を使いたい場合はChatGPT側で手動切替
    return 'https://chatgpt.com/?q=' + encodeURIComponent(p);
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

  // ─── 汎用モーダル（ポップアップ）─────────────────────────
  // openModal({title, bodyHTML, buttons:[{label, value?, primary?, danger?, onClick?(root)}], onRender?})
  // → クリックしたボタンの value（または onClick の戻り値）で解決。背景クリック/✕ は null。
  function openModal(opts) {
    return new Promise((resolve) => {
      const root = document.createElement('div');
      root.className = 'km-modal-backdrop';
      const btns = (opts.buttons || []).map((b, i) =>
        '<button type="button" data-i="' + i + '" class="km-modal-btn' +
        (b.primary ? ' km-primary' : '') + (b.danger ? ' km-danger' : '') + '">' +
        escHtml(b.label) + '</button>').join('');
      root.innerHTML =
        '<div class="km-modal" role="dialog" aria-modal="true">' +
          '<button type="button" class="km-modal-x" aria-label="閉じる">✕</button>' +
          '<div class="km-modal-title">' + escHtml(opts.title || '') + '</div>' +
          '<div class="km-modal-body">' + (opts.bodyHTML || '') + '</div>' +
          '<div class="km-modal-actions">' + btns + '</div>' +
        '</div>';
      document.body.appendChild(root);
      const close = (val) => { try { root.remove(); } catch (_) {} resolve(val); };
      root.addEventListener('click', (e) => { if (e.target === root) close(null); });
      root.querySelector('.km-modal-x').addEventListener('click', () => close(null));
      root.querySelectorAll('.km-modal-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const b = (opts.buttons || [])[Number(btn.dataset.i)];
          if (b.onClick) {
            const r = b.onClick(root);
            if (r === false) return;           // バリデーション失敗 → 閉じない
            close(r === undefined ? (b.value !== undefined ? b.value : true) : r);
          } else {
            close(b.value !== undefined ? b.value : true);
          }
        });
      });
      if (typeof opts.onRender === 'function') opts.onRender(root, close);
    });
  }

  // ─── サーバ（Google Drive）通信中の操作ロック ─────────────
  // 通信中に画面を触ると再描画とぶつかって操作しづらいため、全画面オーバーレイで一時的に操作を止める。
  let serverBusy = false;
  function lockUI(msg) {
    serverBusy = true;
    let ov = document.getElementById('server-lock-overlay');
    if (!ov) {
      ov = document.createElement('div');
      ov.id = 'server-lock-overlay';
      ov.className = 'server-lock-overlay';
      document.body.appendChild(ov);
    }
    ov.innerHTML =
      '<div class="slo-box">' +
        '<div class="slo-spin"></div>' +
        '<div class="slo-msg">' + escHtml(msg || '処理中…') + '</div>' +
        '<div class="slo-sub">📡 サーバ通信中は操作できません（終わるまでお待ちください）</div>' +
      '</div>';
    ov.style.display = 'flex';
  }
  function unlockUI() {
    serverBusy = false;
    const ov = document.getElementById('server-lock-overlay');
    if (ov) ov.style.display = 'none';
  }
  // 通信処理を必ずロック付きで実行する。多重起動は弾く。
  async function withServerLock(msg, fn) {
    if (serverBusy) { showToast('いまサーバ通信中です。終わるまでお待ちください', 'warn'); return undefined; }
    lockUI(msg);
    try { return await fn(); }
    finally { unlockUI(); }
  }

  // テンプレ（プロンプト種別）→ 画像の役割（ファイル名プレフィックス用）への対応表。
  // 役割は記事生成スクリプトの分類キー（eyecatch_/hero_/section_/diagram_/compare_/ngsummary_/product_）。
  const TEMPLATE_TO_ROLE = {
    eyecatch: 'eyecatch', big_number: 'hero',
    specs_card: 'section', icon_grid: 'section', pros_cons: 'section',
    concept: 'diagram', flow: 'diagram', roi: 'diagram', decision_tree: 'diagram',
    compare: 'compare', ranking: 'section', target_buyer: 'section', ngsummary: 'ngsummary',
    bgremove: 'product', colorfix: 'product', addtext: 'none', custom: 'none',
  };

  // 役割→代表テンプレ（ピッカーの初期選択用。templateKey 未記録の旧アイテム向け）
  const ROLE_TO_TEMPLATE = {
    eyecatch: 'eyecatch', hero: 'big_number', section: 'specs_card',
    diagram: 'concept', compare: 'compare', comparetable: 'compare', ngsummary: 'ngsummary', product: 'colorfix',
  };

  // ─── 役割を与える選択（16テンプレ一覧のポップアップ）─────────────
  // 役割ボタンのタップで開く。編集確認ポップアップと同じ選択肢に統一。
  async function openRolePickerForItem(targetId) {
    if (serverBusy) { showToast('いまサーバ通信中です。終わるまでお待ちください', 'warn'); return; }
    const all = await queueAll();
    const item = all.find(x => x.id === targetId);
    if (!item) { showToast('この画像はすでに削除されています', 'warn'); return; }
    const tplSrc = document.getElementById('ai-template-select');
    const curRole = normalizeItemRole(item);
    const curTpl = item.templateKey || ROLE_TO_TEMPLATE[curRole] || '';
    const cmpVal = String(item.compareIndex || '');
    const cmpOptsHtml = ['', '1', '2', '3', '4'].map(v =>
      '<option value="' + v + '"' + (cmpVal === v ? ' selected' : '') + '>' + (v ? '製品' + v : '未割当') + '</option>'
    ).join('');
    const body =
      '<label class="km-edit-field"><span>この画像の用途（つくるもの）</span>' +
        '<select id="km-role-tpl"><option value="">☆ 役割なし</option>' + (tplSrc ? tplSrc.innerHTML : '') + '</select></label>' +
      '<label class="km-edit-field" id="km-rp-cmp-wrap"' + (curTpl === 'compare' ? '' : ' style="display:none"') + '>' +
        '<span>比較の製品番号</span><select id="km-rp-cmp">' + cmpOptsHtml + '</select></label>';
    const res = await openModal({
      title: '🏷 この画像の用途を選ぶ',
      bodyHTML: body,
      buttons: [
        { label: 'キャンセル', value: null },
        { label: '✅ 決定', primary: true, onClick: (rootEl) => {
            const ts = rootEl.querySelector('#km-role-tpl');
            const cs = rootEl.querySelector('#km-rp-cmp');
            return { tpl: ts ? ts.value : '', cmp: cs ? cs.value : '' };
          } },
      ],
      onRender: (rootEl) => {
        const ts = rootEl.querySelector('#km-role-tpl');
        const wrap = rootEl.querySelector('#km-rp-cmp-wrap');
        if (ts) ts.value = curTpl;
        if (ts && wrap) ts.addEventListener('change', () => { wrap.style.display = ts.value === 'compare' ? '' : 'none'; });
      },
    });
    if (res === null) return; // キャンセル
    const tpl = res.tpl;
    if (!tpl) {
      // 役割なし
      await queueUpdate(targetId, (x) => { x.role = 'none'; x.isEyecatch = false; x.compareIndex = null; x.templateKey = ''; });
      await renderQueue();
      showToast('役割をクリアしました', 'success');
      return;
    }
    const newRole = TEMPLATE_TO_ROLE[tpl] || 'none';
    const def = getRoleDef(newRole);
    if (def.unique) {
      for (const it of all) {
        if (it.id !== targetId && normalizeItemRole(it) === newRole) {
          await queueUpdate(it.id, (x) => { x.role = 'none'; x.isEyecatch = false; });
        }
      }
    }
    await queueUpdate(targetId, (x) => {
      x.role = newRole;
      x.templateKey = tpl;
      x.isEyecatch = (newRole === 'eyecatch');
      x.compareIndex = (newRole === 'compare') ? (res.cmp ? Number(res.cmp) : (x.compareIndex || null)) : null;
    });
    await renderQueue();
    const label = (tplSrc && Array.from(tplSrc.options).find(o => o.value === tpl) || {}).text || tpl;
    showToast('🏷 用途を「' + label + '」に設定しました', 'success');
    if (newRole === 'compare') await warnIfCompareDuplicates(); // 同じ製品番号が複数あれば警告
  }

  // 🔄 別の画像を編集し始めるとき、前回の編集データをリセットする。
  // ・前の編集対象の「編集中…」フラグを解除
  // ・前回が自動生成の連結シート(compare_sheet_)で未送信なら、その残骸をキューから削除
  // ・pendingReplace を破棄（exceptId と同じ対象なら何もしない）
  async function discardPreviousEdit(exceptId) {
    if (!pendingReplace || pendingReplace.originalId === exceptId) return false;
    const prevId = pendingReplace.originalId;
    const prevName = (pendingReplace.originalItem && pendingReplace.originalItem.originalName) || '';
    try { await queueUpdate(prevId, (it) => { delete it.editingWith; }); } catch (_) {}
    if (/^compare_sheet_/i.test(prevName)) { try { await queueDelete(prevId); } catch (_) {} }
    pendingReplace = null;
    return true;
  }

  // ─── 編集前の確認ポップアップ → 了承で編集開始 ───────────────
  // queue画像: つくるもの（テンプレ）を選んでから開始。既存ファイル: 確認のみ。
  async function confirmThenEdit(item, engine, opts) {
    opts = opts || {};
    if (serverBusy) { showToast('いまサーバ通信中です。終わるまでお待ちください', 'warn'); return; }
    const allowRole = opts.allowRole !== false;
    // 最新レコードを取得（queue画像のみ。既存ファイル取込direct時は item をそのまま使う）
    if (!opts.skipQueueLookup) {
      const all = await queueAll();
      const latest = all.find(x => x.id === item.id);
      if (!latest) { showToast('この画像はすでに削除されています', 'warn'); return; }
      item = latest;
    }
    const aiName = getEngineLabel(engine);
    const url = URL.createObjectURL(item.blob);
    // 「用途」の選択肢は上部「プロンプト準備」のテンプレ一覧（多い方）に統一する。
    const tplSrc = document.getElementById('ai-template-select');
    const tplOptsHtml = tplSrc ? tplSrc.innerHTML : '';
    // この画像に既に付けた用途（テンプレ）を最優先で初期選択にする＝最初のカテゴリ選択を引き継ぐ。
    // 記録が無ければ役割から逆引き、それも無ければ上部ヘルパーの現在値。
    const curTpl = item.templateKey
      || ROLE_TO_TEMPLATE[normalizeItemRole(item)]
      || (tplSrc ? tplSrc.value : '')
      || 'eyecatch';
    const cmpVal = String(item.compareIndex || '');
    const cmpOptsHtml = ['', '1', '2', '3', '4'].map(v =>
      '<option value="' + v + '"' + (cmpVal === v ? ' selected' : '') + '>' + (v ? '製品' + v : '未割当') + '</option>'
    ).join('');
    const body =
      '<div class="km-edit-confirm">' +
        '<img class="km-edit-thumb" src="' + url + '" alt="">' +
        '<div class="km-edit-info">' +
          '<div class="km-edit-engine">' + escHtml(aiName) + ' で編集します</div>' +
          (allowRole
            ? '<label class="km-edit-field"><span>つくるもの／用途</span>' +
                '<select id="km-tpl-sel">' + tplOptsHtml + '</select></label>' +
              '<label class="km-edit-field" id="km-cmp-wrap"' + (curTpl === 'compare' ? '' : ' style="display:none"') + '>' +
                '<span>比較の製品番号</span><select id="km-cmp-sel">' + cmpOptsHtml + '</select></label>' +
              '<div class="km-edit-note2">タイトル等の細かい入力は、編集画面の「いまAIに送る内容」で行えます</div>'
            : '<div class="km-edit-note">「' + escHtml(item.originalName || 'この画像') + '」を再編集します</div>') +
        '</div>' +
      '</div>';
    const res = await openModal({
      title: '🖼 この方法で編集してもいいですか？',
      bodyHTML: body,
      buttons: [
        { label: 'キャンセル', value: null },
        { label: '✏️ 編集を開始', primary: true, onClick: (rootEl) => {
            const ts = rootEl.querySelector('#km-tpl-sel');
            const cs = rootEl.querySelector('#km-cmp-sel');
            return { tpl: ts ? ts.value : null, cmp: cs ? cs.value : '' };
          } },
      ],
      onRender: (rootEl) => {
        const ts = rootEl.querySelector('#km-tpl-sel');
        const wrap = rootEl.querySelector('#km-cmp-wrap');
        if (ts) ts.value = curTpl; // 実行時の選択値を反映（innerHTMLにはselected属性が無いため）
        if (ts && wrap) ts.addEventListener('change', () => { wrap.style.display = ts.value === 'compare' ? '' : 'none'; });
      },
    });
    try { URL.revokeObjectURL(url); } catch (_) {}
    if (!res) return;  // キャンセル
    // テンプレ → ①プロンプト種別 ②画像の役割（ファイル名）両方に反映（queue画像のみ）
    if (allowRole && res.tpl && !opts.skipQueueLookup) {
      // テンプレを合わせ、毎回プロンプトを作り直す（前回の追記をリセット）
      if (tplSrc) {
        tplSrc.value = res.tpl;
        if (typeof regenerateAIPrompt === 'function') regenerateAIPrompt();
      }
      // ② テンプレ→役割（ファイル名プレフィックス用）に変換
      const newRole = TEMPLATE_TO_ROLE[res.tpl] || 'none';
      const def = getRoleDef(newRole);
      if (def.unique) {
        const all2 = await queueAll();
        // 🔴 既存優先：同じ役割の画像がすでにある場合は「作り直すか？」を確認（既存を優先して使う運用）
        const existsQueue = all2.some(it => it.id !== item.id && normalizeItemRole(it) === newRole);
        // 再編集中のファイル自身（item.replaceDriveFileId）は重複に数えない
        const existsDrive = (getSelectedArticleFolderId() ? (lastExistingFiles || []) : [])
          .some(f => f.id !== item.replaceDriveFileId && parseRoleFromName(f.name).role === newRole);
        if (existsQueue || existsDrive) {
          const go = window.confirm(
            'すでに「' + def.label + '」の画像があります。\n\n' +
            '[OK] 新しく作り直す（既存の' + def.label + 'は役割を外します）\n' +
            '[キャンセル] 既存をそのまま使う（この編集は中止）'
          );
          if (!go) { showToast('既存の「' + def.label + '」を使います（編集を中止しました）', 'success'); return; }
          // 作り直す → 既存を役割解除
          for (const it of all2) {
            if (it.id !== item.id && normalizeItemRole(it) === newRole) {
              await queueUpdate(it.id, (x) => { x.role = 'none'; x.isEyecatch = false; });
            }
          }
        }
      }
      await queueUpdate(item.id, (x) => {
        x.role = newRole;
        x.templateKey = res.tpl; // 次回ポップアップで引き継げるよう用途を記録
        x.isEyecatch = (newRole === 'eyecatch');
        x.compareIndex = (newRole === 'compare') ? (res.cmp ? Number(res.cmp) : (x.compareIndex || null)) : null;
      });
      const all3 = await queueAll();
      item = all3.find(x => x.id === item.id) || item;
      await renderQueue();
      // 🔗 比較表は「割り当て済みの比較画像を自動で1枚に合体」してから編集する。
      // （単体画像のままだとAIに比較全体を渡せないため）
      if (res.tpl === 'compare') {
        // 既存ファイルの再編集から比較表に切り替えた場合、元の単体アイテム（古いblob＋
        // replaceDriveFileId）がキューに残ると、転送時に「古い画像で上書き」されてしまう。
        // 合体シートに切り替えるので、この単体アイテムはキューから除去する。
        if (item.replaceDriveFileId) { try { await queueDelete(item.id); } catch (_) {} }
        await stageCompareSheetFromAssigned();
        await renderQueue();
        return; // 合体シートを編集対象にしたので単体編集はしない
      }
    }
    await oneClickEdit(item, engine);
  }

  async function oneClickEdit(item, engine) {
    // 🛡 クロージャの古いスナップショットを捨てて最新レコードで作業する
    // （古いまま書き戻すと、直前に設定した compareIndex 等が消える）
    {
      const all = await queueAll();
      const latest = all.find(x => x.id === item.id);
      if (!latest) { showToast('この画像はすでに削除されています', 'warn'); return; }
      item = latest;
    }
    // 🔄 別画像の編集に切り替わるなら、前回の編集データをリセット（編集中フラグ解除・連結シート残骸削除）
    await discardPreviousEdit(item.id);
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
    // 🛡 クリップボードには「画像だけ」を入れる（テキストを混ぜると貼付時にAIが文字を優先して
    //   画像が無視される）。プロンプトはURLに自動入力されるので画像専用にする。
    let copyOK = false;
    try {
      if (navigator.clipboard && window.ClipboardItem) {
        const pngBlob = await blobToPngBlob(item.blob);
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })]);
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
  // 🔄 プロンプトの単一ソース：上部「プロンプト準備」(#ai-prompt)の現在値を最優先で使う。
  // 空のときだけ編集開始時のスナップショット(pendingReplace.prompt)にフォールバック。
  function currentEditPrompt() {
    const ta = document.getElementById('ai-prompt');
    const v = ta && ta.value ? ta.value.trim() : '';
    if (v) { if (pendingReplace) pendingReplace.prompt = v; return v; }
    return (pendingReplace && pendingReplace.prompt) || '';
  }
  // バナーに「いま送られるプロンプト」の要約を表示（テンプレ名・タイトル・冒頭プレビュー）。
  // 上部「プロンプト準備」での編集にライブ追従する。
  function escHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  let bannerThumbUrl = null;
  let bannerThumbKey = '';
  let bannerCmpUrls = []; // 比較ギャラリー用 ObjectURL（再描画/閉じる時に解放）
  // 比較表のとき「この比較に使う画像」一覧をバナーに並べる（一時保存＋既存Drive）
  async function renderCompareGalleryInto(box) {
    if (!box) return;
    const items = [];
    try {
      const all = await queueAll();
      all.forEach((it) => {
        if (normalizeItemRole(it) === 'compare'
          && !/^compare_sheet_/i.test(it.originalName || '')
          && !(it.mimeType || '').startsWith('video/') && it.mimeType !== 'application/pdf') {
          items.push({ idx: it.compareIndex || null, url: URL.createObjectURL(it.blob), src: '一時保存', revoke: true, queueId: it.id });
        }
      });
      (getSelectedArticleFolderId() ? (lastExistingFiles || []) : []).forEach((f) => {
        if (/^compare_/i.test(f.name || '') && !/^compare_sheet_/i.test(f.name || '')) {
          const m = /^compare_p(\d+)_/i.exec(f.name || '');
          items.push({ idx: m ? Number(m[1]) : null, url: f.thumbnailUrl || '', src: 'Drive', revoke: false, driveFile: f });
        }
      });
    } catch (e) { console.warn('compare gallery gather failed:', e); }
    // 前回分のURLを解放
    bannerCmpUrls.forEach((u) => { try { URL.revokeObjectURL(u); } catch (_) {} });
    bannerCmpUrls = items.filter((i) => i.revoke).map((i) => i.url);
    if (items.length === 0) {
      box.innerHTML = '<div class="bps-cmp-empty">⚖️ この比較に使う画像がまだありません。一時保存の画像に「⚖️比較」を割り当ててください</div>';
      return;
    }
    items.sort((a, b) => ((a.idx || 99) - (b.idx || 99)));
    const names = getCompareProductNames();
    const dup = duplicateIdxList(items);
    const dupWarn = dup.length
      ? '<div class="bps-cmp-dup">⚠️ 製品番号が重複しています（製品' + dup.join('・') + '）。下の番号を直してください</div>'
      : '';
    // 各セルに「製品番号セレクタ」を付け、その場で番号を直せる＆即更新する
    box.innerHTML =
      '<div class="bps-cmp-title">⚖️ この比較に使う画像（' + items.length + '枚）</div>' +
      dupWarn +
      '<div class="bps-cmp-row">' +
        items.map((it, i) => {
          const nm = (it.idx && names[it.idx - 1]) ? names[it.idx - 1].slice(0, 6) : '';
          const dupCell = (it.idx && dup.indexOf(it.idx) >= 0) ? ' bps-cmp-cell-dup' : '';
          const opts = ['', '1', '2', '3', '4'].map((v) =>
            '<option value="' + v + '"' + (String(it.idx || '') === v ? ' selected' : '') + '>' + (v ? '製品' + v : '番号なし') + '</option>'
          ).join('');
          return '<div class="bps-cmp-cell' + dupCell + '" data-i="' + i + '">' +
            '<img src="' + it.url + '" referrerpolicy="no-referrer" alt="">' +
            '<select class="bps-cmp-idx">' + opts + '</select>' +
            (nm ? '<span class="bps-cmp-pname">' + escHtml(nm) + '</span>' : '') +
            '<span class="bps-cmp-src">' + escHtml(it.src) + '</span></div>';
        }).join('') +
      '</div>' +
      '<button type="button" class="bps-cmp-bundle-btn">⚖️ 比較画像をまとめてAIへ（1枚に合体）</button>';
    // 製品番号セレクタの変更 → その場で反映＆即更新
    box.querySelectorAll('.bps-cmp-cell').forEach((cell) => {
      const sel = cell.querySelector('.bps-cmp-idx');
      const it = items[Number(cell.dataset.i)];
      if (!sel || !it) return;
      sel.addEventListener('change', async () => {
        const v = sel.value;
        if (it.queueId) {
          // 一時保存の画像：番号を更新（renderQueue がギャラリーも再描画する）
          await queueUpdate(it.queueId, (x) => { x.compareIndex = v ? Number(v) : null; });
          await renderQueue();
        } else if (it.driveFile) {
          // Drive既存画像：ファイル名の番号を付け替える（サーバ通信＝ロック付き）
          const folderId = getSelectedArticleFolderId();
          await withServerLock('製品番号を変更中…', async () => {
            const ok = await changeExistingFileRole(it.driveFile, v ? ('compare_p' + v + '_') : 'compare_', folderId);
            if (ok) await loadExistingFiles(folderId);
          });
          refreshCompareGallery();
        }
        await warnIfCompareDuplicates();
      });
    });
    const bundleBtn = box.querySelector('.bps-cmp-bundle-btn');
    if (bundleBtn) bundleBtn.addEventListener('click', async () => {
      bundleBtn.disabled = true;
      try { await runCompareBundle(); } finally { bundleBtn.disabled = false; }
    });
  }
  // 🔄 描画方針（2026-06-13再設計）：
  //  - 「構造」（テンプレ種別・編集対象の画像）が変わった時だけ全再描画する
  //  - それ以外（文字入力等）は軽量同期のみ：全文プレビュー・文字数・非フォーカス欄の値
  //  → 打鍵ごとの再描画ストーム／フォーカス喪失／開いた全文プレビューが閉じる問題を根治
  function updateBannerPromptSummary() {
    if (!editingBanner || editingBanner.style.display === 'none') return;
    const el = document.getElementById('banner-prompt-summary');
    if (!el) return;
    const tplSel0 = document.getElementById('ai-template-select');
    const structureKey = (tplSel0 ? tplSel0.value : '') + '|' +
      (pendingReplace ? (pendingReplace.originalId + ':' + ((pendingReplace.originalItem || {}).editedAt || 0)) : '');
    if (el.dataset.structureKey === structureKey) {
      // ── 軽量同期パス（再描画しない）──
      const full0 = currentEditPrompt();
      const pre0 = el.querySelector('.bps-full pre');
      const sum0 = el.querySelector('.bps-full summary .bps-full-label');
      if (pre0) pre0.textContent = full0;
      if (sum0) sum0.textContent = '📄 指示文の全文を見る（' + full0.length + '文字）';
      // 非フォーカスの欄値をヘルパーと同期（フォーカス中の欄は触らない＝入力を邪魔しない）
      el.querySelectorAll('.bps-input').forEach((inp) => {
        if (inp === document.activeElement) return;
        const src = document.getElementById('ai-var-' + inp.dataset.k);
        if (src && inp.value !== src.value) inp.value = src.value;
      });
      const cardTpl0 = el.querySelector('.bps-tpl');
      if (cardTpl0 && tplSel0 && cardTpl0 !== document.activeElement) cardTpl0.value = tplSel0.value;
      return;
    }
    const tplSel = tplSel0;
    const key = tplSel ? tplSel.value : '';
    const tf = (typeof TEMPLATE_FIELDS !== 'undefined' && TEMPLATE_FIELDS[key]) ? TEMPLATE_FIELDS[key] : null;
    const vals = {
      title: ((document.getElementById('ai-var-title') || {}).value || '').trim(),
      main:  ((document.getElementById('ai-var-main')  || {}).value || '').trim(),
      sub:   ((document.getElementById('ai-var-sub')   || {}).value || '').trim(),
      mood:  ((document.getElementById('ai-var-mood')  || {}).value || '').trim(),
    };
    const full = currentEditPrompt();
    // 編集対象のサムネイル（どの画像をAIに渡すかを見える化）。同じ画像なら ObjectURL を再利用
    let thumb = '';
    try {
      if (pendingReplace && pendingReplace.originalItem && pendingReplace.originalItem.blob) {
        const tKey = pendingReplace.originalId + ':' + (pendingReplace.originalItem.editedAt || 0);
        if (bannerThumbKey !== tKey || !bannerThumbUrl) {
          if (bannerThumbUrl) { URL.revokeObjectURL(bannerThumbUrl); bannerThumbUrl = null; }
          bannerThumbUrl = URL.createObjectURL(pendingReplace.originalItem.blob);
          bannerThumbKey = tKey;
        }
        // 比較の連結シートは横長のまま全パネルを表示（正方形に切り抜くと1枚しか見えない）
        const isSheet = /^compare_sheet_/.test(pendingReplace.originalItem.originalName || '');
        thumb = '<div class="bps-thumb-wrap"><img class="bps-thumb' + (isSheet ? ' bps-thumb-sheet' : '') + '" src="' + bannerThumbUrl + '" alt="編集対象">' +
          '<div class="bps-thumb-cap">' + (isSheet ? '連結シート（全製品入り）' : 'この画像') + '</div></div>';
      }
    } catch (_) {}
    // 🖊 各欄をこの場で直接編集できるようにする（上部「プロンプト準備」と双方向同期＝単一ソース維持）
    const tplOptions = tplSel ? tplSel.innerHTML : '';
    const rows = ['<div class="bps-kv"><span>つくるもの</span>' +
      '<select class="bps-edit bps-tpl">' + tplOptions + '</select></div>'];
    ['title', 'main', 'sub', 'mood'].forEach((k) => {
      const label = tf ? tf[k][0] : { title: 'タイトル', main: 'メイン', sub: 'サブ', mood: '配色' }[k];
      if (label && label.indexOf('（使用しない') === 0) return; // このテンプレで使わない欄は出さない
      const ph = tf ? tf[k][1] : '';
      rows.push('<div class="bps-kv"><span>' + escHtml(label) + '</span>' +
        '<input type="text" class="bps-edit bps-input" data-k="' + k + '" value="' + escHtml(vals[k]).replace(/"/g, '&quot;') + '"' +
        ' placeholder="未入力（おまかせ生成）' + escHtml(ph ? ' ' + ph : '') + '"></div>');
    });
    if (!full) {
      rows.push('<div class="bps-kv bps-warn">⚠️ プロンプト未作成：上の「つくるもの」でテンプレを選んでください</div>');
    }
    // 開いていた全文プレビューの開閉状態を維持
    const prevFull = el.querySelector('.bps-full');
    const fullOpen = !!(prevFull && prevFull.open);
    const articleName = (typeof getSelectedArticleTitle === 'function' && getSelectedArticleTitle())
      ? '<span class="bps-head-article">📝 ' + escHtml(getSelectedArticleTitle()) + '</span>' : '';
    // 比較表のときは「この比較に使う他の画像」も並べて表示する
    const isCompare = (key === 'compare')
      || (pendingReplace && pendingReplace.originalItem && (normalizeItemRole(pendingReplace.originalItem) === 'compare'
        || /^compare_sheet_/.test(pendingReplace.originalItem.originalName || '')));
    el.innerHTML =
      '<div class="bps-head">📤 いまAIに送る内容 ' + articleName +
        '<span class="bps-head-hint">（この場で書き換えOK・上の準備欄と自動同期）</span></div>' +
      '<div class="bps-flex">' + thumb + '<div class="bps-rows">' + rows.join('') + '</div></div>' +
      '<button type="button" class="bps-research-btn" id="bps-research">🔍 リサーチプロンプトをコピー</button>' +
      '<div class="bps-research-hint">↑ ChatGPT/Gemini/Claudeに貼って回答取得 → 上の欄に転記</div>' +
      (isCompare ? '<div class="bps-compare-gallery" id="bps-cmp-gallery"><div class="bps-cmp-loading">比較画像を読み込み中…</div></div>' : '') +
      (full
        ? '<details class="bps-full"' + (fullOpen ? ' open' : '') + '>' +
          '<summary><span class="bps-full-label">📄 指示文の全文を見る（' + full.length + '文字）</span>' +
          '<button type="button" class="bps-copy-full" title="全文をコピー">📋 全文コピー</button></summary>' +
          '<pre>' + escHtml(full) + '</pre></details>'
        : '');
    el.dataset.structureKey = structureKey;
    if (isCompare) {
      const gal = el.querySelector('#bps-cmp-gallery');
      if (gal) renderCompareGalleryInto(gal); // 非同期で埋める
    }
    // ── カード内編集 → 上部ヘルパーへ書き戻し（イベント転送で再生成まで自動） ──
    const cardTpl = el.querySelector('.bps-tpl');
    if (cardTpl) {
      if (tplSel) cardTpl.value = tplSel.value;
      cardTpl.addEventListener('change', () => {
        if (!tplSel) return;
        tplSel.value = cardTpl.value;
        tplSel.dispatchEvent(new Event('change'));   // → regenerateAIPrompt → structureKey変化で全再描画
        const nt = el.querySelector('.bps-tpl');     // 再描画後のselectへフォーカスを戻す
        if (nt) try { nt.focus(); } catch (_) {}
      });
    }
    el.querySelectorAll('.bps-input').forEach((inp) => {
      inp.addEventListener('input', () => {
        const target = document.getElementById('ai-var-' + inp.dataset.k);
        if (!target) return;
        target.value = inp.value;
        target.dispatchEvent(new Event('input'));    // → regenerateAIPrompt → 軽量同期で全文プレビュー更新
      });
    });
    const copyFullBtn = el.querySelector('.bps-copy-full');
    if (copyFullBtn) copyFullBtn.addEventListener('click', async (e) => {
      e.preventDefault(); e.stopPropagation();
      try {
        await navigator.clipboard.writeText(currentEditPrompt());
        showToast('📋 指示文の全文をコピーしました', 'success');
      } catch (err) { showToast('コピー失敗: ' + (err.message || err), 'error'); }
    });
    const researchBtn = el.querySelector('#bps-research');
    if (researchBtn) researchBtn.addEventListener('click', () => copyResearchPromptForCurrent('helper'));
  }
  // 上部ヘルパーの編集にライブ追従：
  //  - 変数欄・テンプレ変更は regenerateAIPrompt の末尾から呼ばれる（main/sub/mood含め全欄カバー）
  //  - #ai-prompt 本文の直接編集だけは regenerate を通らないのでここで結線
  (function () {
    const el = document.getElementById('ai-prompt');
    if (el) el.addEventListener('input', updateBannerPromptSummary);
  })();
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
              '<span class="step-chip" data-clip-chip>②画像 <kbd>⌘V</kbd></span><span class="arrow">→</span>' +
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
              '<span class="step-chip" data-clip-chip>②画像 <kbd>⌘V</kbd></span><span class="arrow">→</span>' +
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
      // 直前再コピー（重要操作）を強調表示
      '<div class="banner-prep-paste">' +
        '<div class="prep-paste-title">📋 AIで <kbd>⌘V</kbd> する <strong>直前に</strong> 押してください</div>' +
        '<div class="prep-paste-buttons">' +
          '<button type="button" id="banner-copy-image" class="prep-btn prep-btn-image" title="クリップボードを画像に上書き">🖼 画像を再コピー</button>' +
          '<button type="button" id="banner-copy-prompt" class="prep-btn prep-btn-prompt" title="クリップボードをプロンプトに上書き">📝 プロンプトをコピー</button>' +
        '</div>' +
        '<small class="prep-paste-hint">途中で別のスクショを取ると上書きされます。AIに貼付直前にこのボタンを押してください。</small>' +
      '</div>' +
      '<div class="editing-banner-actions">' +
        (isMobileDevice() && navigator.share
          ? `<button type="button" id="banner-share" class="banner-open-ai" title="画像＋プロンプトを共有">📤 ${engineLabel}アプリへ共有</button>`
          : `<button type="button" id="banner-open-ai" class="banner-open-ai" title="${engineLabel} を開き直す">🚀 ${engineLabel} を開く</button>`) +
        '<button type="button" id="banner-receive-file" title="設定フォルダから最新画像を自動取込（未設定なら標準ファイル選択）">📥 完成画像を取込</button>' +
        '<button type="button" id="banner-set-folder" title="取込元フォルダ（Google Drive ダウンロード等）を設定">📁 取込元設定</button>' +
        '<button type="button" id="banner-cancel">置換キャンセル</button>' +
      '</div>' +
      '<div id="banner-folder-status" class="banner-folder-status"></div>' +
      // いま送られるプロンプトの要約（テンプレ名・タイトル・冒頭）— 上部での編集にライブ追従
      '<div id="banner-prompt-summary" class="banner-prompt-summary"></div>' +
      // 📝 プロンプトの編集場所は上部「プロンプト準備」に一本化（旧：バナー内エディタは廃止）
      '<div class="banner-prompt-hint">📝 プロンプトを直したいときは、ページ上部の<strong>「プロンプト準備」</strong>欄で編集してください。' +
      'ここの「📝 プロンプトをコピー」と「🚀 開く」には<strong>常に最新の内容が自動反映</strong>されます。</div>' +
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
    // 🔄 統合（2026-06-09）：プロンプト編集は上部「プロンプト準備」(#ai-helper)に一本化。
    // 編集中もヘルパーは隠さない（バナーを開いたまま上で直せる）。
    // バナーの「📝 プロンプトをコピー」「🚀 開く」は常にヘルパーの最新値を使う（currentEditPrompt）。

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
          currentEditPrompt()
        );
        if (!ok) showToast('共有に失敗しました。下の「📋 画像」「📋 プロンプト」で個別に渡してください', 'warn');
      };
    }
    const btnOpenAI = document.getElementById('banner-open-ai');
    if (btnOpenAI) {
      btnOpenAI.onclick = async () => {
        if (!pendingReplace) return;
        const engine = pendingReplace.aiEngine || 'chatgpt';
        const promptText = currentEditPrompt();
        const url = buildAIUrl(engine, promptText);
        pendingReplace.aiUrl = url;

        // ① ★最重要: クリップボードには「画像だけ」を入れる（テキストを混ぜると貼付時に
        //   AI側が文字を優先して画像が無視される＝⌘Vで画像が入らない原因だった）。
        //   プロンプトはURLに自動入力されるので、クリップボードは画像専用にする。
        //   また window.open より前に、フォーカスがある今のうちに確実に書き込む。
        let copied = false;
        try {
          if (pendingReplace.originalItem && navigator.clipboard && window.ClipboardItem) {
            const pngBlob = await blobToPngBlob(pendingReplace.originalItem.blob);
            await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })]);
            copied = true;
            clipboardMode = 'image';
            updateStepChips && updateStepChips();
          }
        } catch (e) { console.warn('image clipboard copy failed:', e); }

        // ② 既存窓を閉じて開き直す → ウィンドウを開く（直前のawaitは短く操作権限は維持される）
        const existing = pendingReplace.aiWindow;
        if (existing && !existing.closed) { try { existing.close(); } catch (_) {} }
        const w = window.open(url, '_blank', 'width=1000,height=900,scrollbars=yes,resizable=yes');
        if (w) { pendingReplace.aiWindow = w; try { w.focus(); } catch (_) {} }
        else { showToast('⚠️ ポップアップがブロックされました。ブラウザでこのサイトのポップアップを許可してください', 'warn'); }

        showToast(copied
          ? `🚀 ${getEngineLabel(engine)}を開きました。チャット欄で <kbd>⌘/Ctrl+V</kbd> → 画像が貼り付きます（プロンプトは入力欄に自動入力済み）`
          : `🚀 ${getEngineLabel(engine)}を開きました。プロンプトは自動入力済み（このブラウザは画像の自動コピー不可）`, 'success');
      };
    }
    const btnCopyImage = document.getElementById('banner-copy-image');
    const btnCopyPrompt = document.getElementById('banner-copy-prompt');
    if (btnCopyImage) {
      btnCopyImage.onclick = async () => {
        if (!pendingReplace || !pendingReplace.originalItem) return;
        try {
          // 画像だけをコピー（テキストを混ぜると貼付時にAIが文字を優先し画像が無視されるため）
          const pngBlob = await blobToPngBlob(pendingReplace.originalItem.blob);
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })]);
          clipboardMode = 'image';
          showToast('📋 画像をコピーしました → AIのチャット欄で ⌘/Ctrl+V', 'success');
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
          await navigator.clipboard.writeText(currentEditPrompt());
          clipboardMode = 'prompt';
          showToast('📋 クリップボードを「プロンプト」に切替', 'success');
          updateStepChips();
        } catch (e) {
          showToast('プロンプトコピー失敗: ' + (e.message || e), 'error');
        }
      };
    }
    updateStepChips();
    updateBannerPromptSummary();
  }

  // ─── ステップチップの強調表示 + クリップボード状態追跡 ─────
  let clipboardMode = 'image'; // 'image' | 'prompt'
  function updateStepChips() {
    if (!editingBanner) return;
    // 🛡 data-clip-chip の目印が付いたチップだけ更新する。
    // chips[1]を無条件で書き換えると、スマホ（②AIアプリ選択）やCanvaのチップ構成を壊す
    const clipChip = editingBanner.querySelector('[data-clip-chip]');
    if (!clipChip) return;
    if (clipboardMode === 'prompt') {
      clipChip.innerHTML = '②プロンプト <kbd>⌘V</kbd>';
    } else {
      clipChip.innerHTML = '②画像 <kbd>⌘V</kbd>';
    }
    clipChip.classList.add('is-active');
  }

  // 旧仕様の autoSwitchToPrompt は廃止
  // 理由：プロンプトはURLにプリフィルするようになったため、
  //       PWAに戻った瞬間にクリップボードを「画像→プロンプト」に切替えると
  //       画像が消えてしまい、AI画面で⌘Vしてもテキストしか貼れない不具合になる。
  //       明示的に「📋 プロンプト」ボタンを押した時だけクリップボードを切替える。

  async function cancelPendingReplace() {
    if (pendingReplace && pendingReplace.originalId != null) {
      // 🛡 queueUpdate は削除済みレコードを復活させない（存在チェック付き部分更新）
      try { await queueUpdate(pendingReplace.originalId, (it) => { delete it.editingWith; }); } catch (e) {}
    }
    pendingReplace = null;
    if (editingBanner) editingBanner.style.display = 'none';
    // サムネ用・比較ギャラリー用 ObjectURL の後片付け
    if (bannerThumbUrl) { try { URL.revokeObjectURL(bannerThumbUrl); } catch (_) {} bannerThumbUrl = null; bannerThumbKey = ''; }
    bannerCmpUrls.forEach((u) => { try { URL.revokeObjectURL(u); } catch (_) {} });
    bannerCmpUrls = [];
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
    // 🛡 最新レコードを取得して更新（削除済みなら復活させず、新規追加にフォールバック）
    const all = await queueAll();
    const orig = all.find(x => x.id === pendingReplace.originalId);
    if (!orig) {
      const engineLabel = getEngineLabel(pendingReplace.aiEngine);
      pendingReplace = null;
      if (editingBanner) editingBanner.style.display = 'none';
      const ah0 = document.getElementById('ai-helper');
      if (ah0) ah0.style.display = '';
      const ahBtn0 = document.getElementById('btn-open-ai-helper');
      if (ahBtn0) ahBtn0.style.display = '';
      await addToQueue(blob, mime, ext);
      showToast(`元画像が削除済みのため、${engineLabel}の編集後画像を新規追加しました`, 'warn');
      return true;
    }
    // 🔑 合体シート(compare_sheet_)をAIで生成した結果＝「比較表の完成版」として登録する。
    //    役割を comparetable に切り替え、ファイル名も comparetable_ にして転送時にDriveへ正しく保存する。
    const wasCompareSheet = /^compare_sheet_/i.test(orig.originalName || '');
    // 元 item を編集後画像で更新
    orig.blob = blob;
    orig.mimeType = mime;
    orig.ext = ext;
    orig.size = blob.size;
    orig.editedAt = Date.now();
    orig.editedWith = pendingReplace.aiEngine;
    delete orig.editingWith;
    if (wasCompareSheet) {
      // 既存の「比較表(完成)」を解除（1記事1枚）
      for (const it of all) {
        if (it.id !== orig.id && normalizeItemRole(it) === 'comparetable') {
          await queueUpdate(it.id, (x) => { x.role = 'none'; });
        }
      }
      orig.role = 'comparetable';
      orig.compareIndex = null;
      orig.templateKey = 'compare';
      orig.originalName = 'comparetable_' + orig.id + '.' + ext;
    } else {
      orig.originalName = (orig.originalName || ('edited_' + orig.id)).replace(/\.[^.]+$/, '') + '.' + ext;
    }
    await queuePut(orig);
    pendingReplace = null;
    if (editingBanner) editingBanner.style.display = 'none';
    // 隠していた新規生成ヘルパーを復活
    const ah = document.getElementById('ai-helper');
    if (ah) ah.style.display = '';
    const ahBtn = document.getElementById('btn-open-ai-helper');
    if (ahBtn) ahBtn.style.display = '';
    await renderQueue();
    showToast(wasCompareSheet
      ? '📊 AI生成の比較表を「完成版」として登録しました。「すべて転送」でDriveに保存されます'
      : '✨ 編集後の画像で置換完了', 'success');
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

  // ─── テンプレごとの入力欄ラベル＆プレースホルダー定義 ─────────
  // テンプレを切り替えると4つの変数欄が「そのテンプレに最適な質問」に変化
  const TEMPLATE_FIELDS = {
    eyecatch: {
      title: ['記事タイトル', '例：MX ERGO S 設定編'],
      main:  ['メイン訴求',   '例：年6万円の時短'],
      sub:   ['サブ訴求',     '例：Logi Options+ で1個を5職務分の専用機に化かす'],
      mood:  ['配色／雰囲気', '例：青系（#1d4ed8）＋オレンジ #f97316'],
    },
    big_number: {
      title: ['文脈テキスト', '例：時短で'],
      main:  ['巨大な数字',   '例：64,500'],
      sub:   ['単位・後置詞', '例：円/年'],
      mood:  ['配色',         '例：青グラデ＋オレンジ強調'],
    },
    specs_card: {
      title: ['製品名',       '例：SwitchBot ロックLite'],
      main:  ['価格（強調値）', '例：12,978円'],
      sub:   ['製品の特徴的形状', '例：白い小型・サムターン装着'],
      mood:  ['配色',         '例：白背景＋青タイトル'],
    },
    icon_grid: {
      title: ['グリッドタイトル', '例：6つの機能'],
      main:  ['6機能（/区切り）', '例：指紋認証 / Suica対応 / スマホ操作 / オートロック / 遠隔操作 / 音声制御'],
      sub:   ['補足コピー',   '例：主な機能一覧'],
      mood:  ['配色',         '例：白背景＋青オレンジアイコン'],
    },
    pros_cons: {
      title: ['全体タイトル', '例：メリット・デメリット'],
      main:  ['メリット項目（/区切り）', '例：賃貸OK / 工事不要 / 15分で取付 / 指紋認証0.3秒'],
      sub:   ['デメリット項目（/区切り）', '例：電池交換半年毎 / 物理鍵併用 / 締め出し注意'],
      mood:  ['配色',         '例：左緑系/右赤系'],
    },
    ranking: {
      title: ['ランキングタイトル', '例：おすすめスマートロックTOP3'],
      main:  ['1〜3位の製品名', '例：1位=ロックLite / 2位=ロックPro / 3位=Qrio Lock'],
      sub:   ['補足',         '例：2026年5月時点・編集部独自評価'],
      mood:  ['配色',         '例：1位金/2位銀/3位銅'],
    },
    target_buyer: {
      title: ['タイトル',     '例：こんな人におすすめ'],
      main:  ['おすすめな人（/区切り）', '例：賃貸暮らし / 在宅ワーカー / 子育て世代 / 鍵をなくしやすい人'],
      sub:   ['不要な人（/区切り）', '例：一戸建てで強固な鍵 / 短期賃貸 / 機械音NGの人'],
      mood:  ['配色',         '例：左緑系/右薄グレー'],
    },
    concept: {
      title: ['概念図タイトル', '例：Actions Ring の仕組み'],
      main:  ['主役要素名',   '例：Actions Ring（円形メニュー）'],
      sub:   ['衛星要素（,区切り）', '例：AI連携, アプリ起動, ショートカット'],
      mood:  ['配色',         '例：白背景＋青枠'],
    },
    flow: {
      title: ['フロー図タイトル', '例：取付5ステップ'],
      main:  ['ステップ内容（/区切り）', '例：①採寸 / ②両面テープ貼付 / ③本体固定 / ④アプリ初期化 / ⑤指紋登録'],
      sub:   ['補足',         '例：所要時間15分・工具不要'],
      mood:  ['配色',         '例：青系＋オレンジ矢印'],
    },
    roi: {
      title: ['ROIタイトル',  '例：ROI 計算の流れ'],
      main:  ['主役数値',     '例：3年純利益 +10万円'],
      sub:   ['注釈',         '例：時給950円・最低賃金基準'],
      mood:  ['配色',         '例：青系＋オレンジハイライト'],
    },
    decision_tree: {
      title: ['タイトル',     '例：あなたにピッタリの選び方'],
      main:  ['最初の質問',   '例：賃貸住まいですか?'],
      sub:   ['結論（Yes/Noの行先）', '例：Yes=ロックLite / No=ロックPro'],
      mood:  ['配色',         '例：青菱形＋オレンジ結論'],
    },
    compare: {
      title: ['比較タイトル', '例：スマートロック比較'],
      main:  ['比較対象（2〜4個を / 区切り）',  '例：ロックLite / ロックPro / Qrio Lock'],
      sub:   ['補足',         '例：価格は2026年5月時点'],
      mood:  ['配色',         '例：白背景＋勝者オレンジ強調'],
    },
    ngsummary: {
      title: ['NGタイトル',   '例：やってはいけない設定 4つ'],
      main:  ['4つのNG項目（/区切り）', '例：左クリック再割当 / DPI高すぎ / 競合設定ON / Smart Actions過多'],
      sub:   ['補足',         '例：（省略可）'],
      mood:  ['配色',         '例：白背景＋赤アクセント'],
    },
    bgremove: {
      title: ['（使用しない）', '透過PNG化のためタイトル不要'],
      main:  ['被写体',       '例：白いスマートロック本体'],
      sub:   ['補足',         '例：透明部分は半透明で残す'],
      mood:  ['（使用しない）', '加工処理のため配色指定不要'],
    },
    colorfix: {
      title: ['（使用しない）', '配色統一のためタイトル不要'],
      main:  ['用途',         '例：ブログ記事用'],
      sub:   ['補足',         '例：人物の肌色は維持'],
      mood:  ['ブランドパレット', '例：青 #1d4ed8 / オレンジ #f97316 / 白＆グレー'],
    },
    addtext: {
      title: ['メインテキスト', '例：賃貸でも15分'],
      main:  ['サブテキスト', '例：鍵から解放'],
      sub:   ['補足テキスト', '例：時給950円で計算'],
      mood:  ['配置・色',     '例：左下・白文字・半透明黒帯背景'],
    },
    custom: {
      title: ['タイトル（自由）', '自由記述'],
      main:  ['訴求（自由）',     '自由記述'],
      sub:   ['サブ（自由）',     '自由記述'],
      mood:  ['配色（自由）',     '自由記述'],
    },
  };

  // ─── テンプレ別「リサーチ補助プロンプト」 ─────────
  // リサーチ必須項目を埋めるための AI 用質問プロンプトをテンプレごとに用意
  // ユーザーが「🔍 リサーチプロンプト生成」を押すと、クリップボードへコピー → AI に貼って回答取得
  function buildResearchPrompt(key, vars) {
    const today = new Date().toISOString().slice(0, 10);

    // === PWA状態から文脈を自動収集 ===
    // 1) 記事名（選択中・新規どちらも対応・prefix除去）
    let articleName = '';
    try {
      const n = (typeof getCurrentArticleName === 'function') ? getCurrentArticleName() : '';
      articleName = (typeof stripArticlePrefix === 'function') ? stripArticlePrefix(n) : n;
    } catch (_) {}

    // 2) 記事タイプ（レビュー / 商品比較 / ツール紹介 等）
    let articleTypeStr = '';
    try {
      const sel = document.getElementById('article-type-select');
      articleTypeStr = (sel && sel.value || '').trim();
    } catch (_) {}

    // 3) 読者に伝えたいポイント（メモ）— 最大6件
    let memoLines = [];
    try {
      if (typeof memos !== 'undefined' && Array.isArray(memos)) {
        memoLines = memos.map(m => (m || '').trim()).filter(m => m.length > 0).slice(0, 6);
      }
    } catch (_) {}

    // 4) 入力変数
    const v = {
      title: (vars.title || '').trim(),
      main: (vars.main || '').trim(),
      sub: (vars.sub || '').trim(),
      mood: (vars.mood || '').trim(),
    };

    // === 文脈ブロック（全テンプレに共通で先頭付与） ===
    const tf = TEMPLATE_FIELDS[key] || TEMPLATE_FIELDS.eyecatch;
    const ctxLines = [];
    ctxLines.push('━━━ 製品・記事の文脈（リサーチ対象を理解するために必読） ━━━');
    if (articleName)   ctxLines.push(`【記事タイトル】${articleName}`);
    if (articleTypeStr) ctxLines.push(`【記事タイプ】${articleTypeStr}`);
    if (memoLines.length) {
      ctxLines.push(`【読者に伝えたいポイント（優先度順・1番目が最重要）】`);
      memoLines.forEach((m, i) => ctxLines.push(`  ${i + 1}. ${m}`));
    }
    if (v.title) ctxLines.push(`【入力欄「${tf.title[0]}」】${v.title}`);
    if (v.main)  ctxLines.push(`【入力欄「${tf.main[0]}」】${v.main}`);
    if (v.sub)   ctxLines.push(`【入力欄「${tf.sub[0]}」】${v.sub}`);
    if (v.mood)  ctxLines.push(`【入力欄「${tf.mood[0]}」】${v.mood}`);
    if (!articleName && !v.title && !v.main && memoLines.length === 0) {
      ctxLines.push('⚠️ 製品名/記事タイトルが特定できません。記事めしPWAで記事を選択＆メモ入力してから再実行してください。');
    }
    ctxLines.push('━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    ctxLines.push('');
    const ctx = ctxLines.join('\n');

    const common = `\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n【回答ルール】\n- ${today} 時点の最新情報で（不確かなら「不明」と明記）\n- 情報源（公式URL・Amazon・口コミサイト等）を併記\n- 上記の「製品・記事の文脈」を踏まえて、その製品/テーマに特化した内容で回答\n- 結果は記事めしPWAの入力欄に直接コピペできる形式で（簡潔・実用）`;

    const M = {
      eyecatch: `上記の記事に最適な「アイキャッチ用キャッチコピー」を提案してください。\n- メイン訴求（最大15文字・強い言葉）：3案\n- サブ訴求（最大30文字・具体メリット）：各メイン案に対応する3案\n- 配色／雰囲気の提案：1案`,
      big_number: `上記の記事の読者にインパクトを与える「巨大な数字」を1つ提案してください。\n- 数字本体（例：64,500）\n- 単位・後置詞（例：円/年）\n- 数字を導く文脈テキスト（例：時短で）\n- その数字の根拠説明（記事本文に使うため計算式付きで）`,
      specs_card: `上記の製品のスペック表データを6項目で教えてください：\n1. 価格（強調値）\n2. 重量 or サイズ\n3. 電源 or バッテリー\n4. 主要機能\n5. 対応OS/環境\n6. 取付方法 or 設置方法`,
      icon_grid: `上記の製品の主要機能を6つ、簡潔な機能名で並べてください：\n例：指紋認証 / Suica対応 / スマホ操作 / オートロック / 遠隔操作 / 音声制御`,
      pros_cons: `上記の製品を実機レビュー目線で：\n- 主なメリット 4つ（各15文字以内）\n- 主なデメリット 3つ（各15文字以内）\n誇張なく、実際の口コミから抽出した内容で。`,
      ranking: `上記の記事カテゴリの人気・おすすめランキング上位3製品を教えてください。\n各製品：\n- 順位\n- 製品名\n- 価格\n- 1行特徴（30文字以内）`,
      target_buyer: `上記の製品の購入者ペルソナを分析してください：\n- ✅ おすすめな人 4タイプ（属性ベースで例：賃貸暮らし、在宅ワーカー、子育て世代 等）\n- ❌ 不要な人 2-3タイプ`,
      concept: `上記の製品/概念を概念図で説明したい。\n- 中心となる「主役要素」\n- 関連する「衛星要素」3〜5個（短い名詞で）`,
      flow: `上記の製品の使用/設定を5ステップのフローで。\n①〜⑤ で簡潔に。所要時間も付記。`,
      roi: `上記の製品のROI（投資対効果）を時給950円（最低賃金）基準で計算してください。\n- 価格（円）\n- 1日節約時間（分）と内訳\n- 1日節約価値（円/日）\n- 損益分岐日数（日）\n- 3年純利益（円）\n計算式の各ステップを明示。`,
      decision_tree: `上記の製品を選ぶ時の最初の判断軸を1つ提案してください。\n- 質問1（Yes/Noで答えられる）：例「賃貸住まいですか?」\n- Yes の場合の結論：オススメ製品名\n- No の場合の結論：別の製品名`,
      compare: `上記の製品と競合製品 計3つを比較してください。\n- 製品名 × 3\n- 価格 / 主要機能 / 重量 等 5項目の比較表`,
      ngsummary: `上記の製品/設定で「やってはいけない設定/使い方」を4つ：\n各NG：\n- 簡潔な見出し（10文字以内）\n- 1行の理由説明`,
      addtext: `上記の記事サムネ画像に重ねるキャッチコピー：\n- メインテキスト（最大10文字・強い言葉）\n- サブテキスト（最大20文字）\n- 補足（任意）`,
      bgremove: `上記の画像の主役被写体を識別して、背景除去のための簡潔な被写体描写を1文で：\n例：「白い小型スマートロック本体（サムターン装着済み）」`,
      colorfix: `上記の画像の用途と維持すべき色の制約を整理：\n- 用途（ブログ記事用/SNS等）\n- 維持すべき色（人物の肌色 等）\n- ブランドパレットへの寄せ方`,
      custom: `上記のテーマで、ブログ記事に使う画像のアイデアを3つ提案。\n各案：構図・色・テキスト・ねらい`,
    };
    return ctx + (M[key] || M.custom) + common;
  }

  // 「🔍 リサーチプロンプトをコピー」ボタンの動作
  async function copyResearchPromptForCurrent(scope) {
    const prefix = scope === 'banner' ? 'banner-' : 'ai-';
    const tplSelEl = document.getElementById(prefix + (scope === 'banner' ? 'tpl' : 'template-select'));
    let key = tplSelEl ? tplSelEl.value : 'eyecatch';
    if (key === '__keep__') key = 'eyecatch';
    const vars = {
      title: (document.getElementById(prefix + 'var-title') || {}).value || '',
      main:  (document.getElementById(prefix + 'var-main')  || {}).value || '',
      sub:   (document.getElementById(prefix + 'var-sub')   || {}).value || '',
      mood:  (document.getElementById(prefix + 'var-mood')  || {}).value || '',
    };
    const prompt = buildResearchPrompt(key, vars);
    try {
      await navigator.clipboard.writeText(prompt);
      showToast('🔍 リサーチプロンプトをコピー。ChatGPT/Gemini/Claude に貼って回答を取得してください', 'success');
    } catch (e) {
      // フォールバック：プロンプトをダイアログ表示
      window.prompt('以下をAIに貼ってリサーチしてください', prompt);
    }
  }

  // テンプレ切替時に入力欄のラベル＆プレースホルダーを書き換える
  // scope: 'helper' = 上部AIヘルパー / 'banner' = バナー内プロンプト編集
  function applyTemplateFields(key, scope) {
    const def = TEMPLATE_FIELDS[key] || TEMPLATE_FIELDS.eyecatch;
    const prefix = scope === 'banner' ? 'banner-var-' : 'ai-var-';
    ['title', 'main', 'sub', 'mood'].forEach((k) => {
      const inp = document.getElementById(prefix + k);
      if (!inp) return;
      const lbl = inp.parentElement && inp.parentElement.querySelector('span');
      if (lbl) lbl.textContent = def[k][0];
      inp.placeholder = def[k][1];
    });
  }

  // ─── 共通ガード文（全テンプレに自動付与）──────────
  // ChatGPT(gpt-image-2) / Gemini Nano Banana 2 両対応の高品質画像生成プロンプト
  const COMMON_GUARDS = `
【対応エンジン】このプロンプトは ChatGPT(gpt-image-2) と Gemini Nano Banana 2 の両方で最高品質の出力が得られるように設計されています。

【絶対遵守ルール（最重要）】
- 日本語テキストは絶対に正しく描画する。指定された文字を1字も省略・置換・架空化しない
- 文字の欠損・分離・順序入れ替わり・架空のひらがな化・読めない崩し字は厳禁
- フォント：Noto Sans JP / Hiragino Kaku Gothic ProN / Yu Gothic Bold / Source Han Sans 相当のクリーンなゴシック体
- 全ての日本語文字を1文字単位で確認してから描画。指定外の文字は1字も追加しない
- 人物が含まれる場合：手の指は5本・歪まない・正常な解剖学
- ピクセル単位でくっきり、JPEG圧縮ノイズなし、4K相当の解像感
- 余白を必ず確保（テキストが画面端に密着しない・最低5%マージン）
- 商標ロゴの完全再現は避ける（一般化したアイコン表現で）

【絶対避ける】
- 「文字化け」「架空のひらがな」「漢字を勝手に追加」「英字に置換」
- 散らかったレイアウト・要素の重なり・読みづらい配色
- 過剰な装飾・ベタなクリップアート・90年代風影

【参考品質基準】
Pinterest 保存数上位 / プロデザイナーの LP 冒頭ヒーロー / Apple公式LP / Google Material Design 3 / Stripe / Linear の品質を目指す`;

  const AI_TEMPLATES = {
    eyecatch: ({title, main, sub, mood}) => `# ブログアイキャッチ画像（最高品質）

【出力仕様】
- サイズ：1200×630px（アスペクト比 40:21 横長）
- 用途：日本語テックブログのアイキャッチ・SNSプレビュー対応
- 出力形式：PNG / フルブリード（端まで色が広がる）

【構図グリッド】
- 黄金分割：左 5/8 にテキストエリア、右 3/8 にビジュアル要素配置
- 左寄せレイアウト（読み視線の起点を左上に）

【テキスト階層】
1. 主見出し（大・48-72pt・白・極太）：「${title || 'メインタイトル'}」
   - 1〜2行で改行、行間1.2倍、字間-2%
2. アクセントタグ（中・18-24pt・オレンジ #f97316 ピル型背景）：「${main || 'メイン訴求'}」
   - 主見出しの上に小さく配置
3. サブコピー（小・20-28pt・薄白 #e5e7eb）：「${sub || 'サブ訴求'}」
   - 主見出しの下、グレーで控えめに

【配色（ブランド固定）】
${mood || '左から右へ深い青 #1d4ed8 → 明るい青 #3b82f6 のリニアグラデ背景 / アクセントオレンジ #f97316 / テキスト白＆薄白 / 装飾の細線は #93c5fd'}

【右側ビジュアル要素】
- 関連する象徴的アイコン（製品シルエット、ロックアイコン、グラフ等）を線画＋ベタ塗りで配置
- アイコンは画面高さの 40〜55%、軽い影付きで浮き感
- 周囲に薄い光彩（ホワイトのソフトグロウ）

【絶対避ける】
- 文字の崩れ・分離・架空文字（特に「賃貸場まずに」のような誤生成）
- 派手すぎる装飾、Web 1.0風の影、ベタなクリップアート
- 過剰な絵文字（プロ感が損なわれる）
${COMMON_GUARDS}`,

    concept: ({title, main, sub, mood}) => `# コンセプト図解（フラット・ベクター品質）

【出力仕様】1200×630px / PNG / 白背景フルブリード
【用途】ブログ記事中の概念説明・H2セクション直下

【構図】
- 上部 1/8：タイトル帯
- 中央 5/8：主役オブジェクトを中心に、衛星要素3〜5個を放射状配置（ハブ＆スポーク型）
- 下部 2/8：補足ラベル

【テキスト階層】
1. タイトル（28-36pt・青 #1d4ed8 極太・中央寄せ）：「${title || '概念図タイトル'}」
2. 主役ラベル（20-24pt・黒 #111827 太字）：「${main || '主役要素名'}」
3. 関連要素ラベル（14-18pt・グレー #4b5563）：${sub || '衛星要素1, 2, 3'}

【ビジュアル】
- 主役は中央の円形 or 六角形フレーム（直径280px・青枠4px）
- 衛星要素 3〜5個、太さ4pxの矢印で主役へ接続（先端は▶アイコン）
- 各要素は薄シャドウ（4px blur, 10% opacity）で浮き感

【配色】
${mood || '白 #ffffff 背景 / 主役枠 青 #1d4ed8 / 衛星 青 #3b82f6 / アクセント オレンジ #f97316 / テキスト #111827・#4b5563'}

【スタイル】Material Design / Notion 図解 / Apple Keynote 一級品の品質。線幅完全統一。
${COMMON_GUARDS}`,

    flow: ({title, main, sub, mood}) => `# フロー図（5ステップ・矢印強調）

【出力仕様】1200×630px / PNG / 白背景

【構図】
- 上部にタイトル帯
- 中央に5ステップを横並び（各ステップ幅200px、間に太矢印60px）
- 下部に補足キャプション帯

【ステップ構造】各ステップは丸角矩形（角丸12px・薄シャドウ）
- 上：ステップ番号（白文字を青円 #1d4ed8 で囲む・直径44px）
- 中：ステップ名（黒太字16-20pt）
- 下：1行説明（グレー12pt）
- ステップ内容：${main || '①開始 ②準備 ③実行 ④検証 ⑤完了'}
- ステップ間：太矢印（オレンジ #f97316・幅8px・先端三角）

【テキスト】
- タイトル（28-36pt・青 #1d4ed8 極太）：「${title || 'プロセスフロー'}」
- 補足キャプション（14pt・グレー）：${sub || '所要時間・前提条件など'}

【配色】
${mood || '白背景 / ステップ枠 薄青 #dbeafe 背景＋濃青 #1d4ed8 枠 / 矢印 オレンジ #f97316 / テキスト #111827'}

【スタイル】Notion / Figma の標準フロー図品質。線太さ完全統一、矢印の角度・長さ統一。
${COMMON_GUARDS}`,

    roi: ({title, main, sub, mood}) => `# ROI投資対効果フロー図（インフォグラフィック）

【出力仕様】1200×630px / PNG / 薄青背景

【構図】
- 上部にタイトル＋サブタイトル
- 中央に4つの矩形ボックスを横並び、太矢印で接続
- 下部に注釈帯

【4ボックス内容】
1. 「購入価格」 → 金額表記（例：18,000円）
2. 「1日節約価値」 → 円/日（例：190円/日）
3. 「損益分岐日数」 → 日数（例：95日）
4. 「3年純利益」 → 大きく金額（例：+124,500円）★最重要・オレンジ強調・他より一回り大きい

【テキスト】
- タイトル（30-40pt・青 #1d4ed8 極太）：「${title || 'ROI 計算の流れ'}」
- 各ボックス：見出し（14pt・グレー）／式 or 値（24-32pt・黒太字 or 白）
- 主役数値：${main || '主要数値'}
- 注釈（11pt・グレー・最下部）：${sub || '時給950円・最低賃金基準'}

【配色】
${mood || '背景 薄青 #eff6ff / ボックス1-3 白＋青枠 #1d4ed8 / ボックス4 オレンジ #f97316 ベタ＋白文字 / 矢印 グレー #6b7280→ オレンジ'}

【スタイル】McKinsey 風コンサル資料 / インフォグラフィック上位1%の質感。
${COMMON_GUARDS}`,

    compare: ({title, main, sub, mood}) => {
      // 比較対象を「/」区切りで分割し、2〜4個に自動調整（比較数 = 入力した製品名の数）
      const products = (main || '').split('/').map(s => s.trim()).filter(Boolean);
      const n = Math.min(4, Math.max(2, products.length || 3));
      const names = products.length
        ? products.slice(0, n)
        : Array.from({ length: n }, (_, i) => '製品' + String.fromCharCode(65 + i));
      // 入力が1製品だけ等、n に満たない場合は仮名で埋めて矛盾のないプロンプトにする
      while (names.length < n) names.push('製品' + String.fromCharCode(65 + names.length) + '（比較対象を追記）');
      const cardW = n <= 2 ? 420 : (n === 3 ? 320 : 260);
      // 製品ごとの実写真割り当て指示（compare_p1_*, compare_p2_* … にひも付け）
      const photoLines = names.map((nm, i) =>
        `  - 製品${i + 1}「${nm}」：アップロード済み実機写真 compare_p${i + 1}_*.jpg をカード上部のヘッダー画像として使用`
      ).join('\n');
      return `# 比較表ビジュアル（${n}列カード・勝者強調）

【出力仕様】1200×630px / PNG / 白背景

【構図】
- 上部 1/8：タイトル
- 中央 6/8：${n}カラム比較カード（各カード幅 約${cardW}px・間隔 32px・横並び均等）
- 下部 1/8：補足

【${n}カードの構造】各カードは縦長丸角矩形（角丸16px）
- ヘッダー：製品名（${names.join(' / ')}）＋下記の実機写真
- 4-5項目の比較行（左：項目名グレー / 右：値）
- ★最優秀カードはオレンジ枠＋「BEST」リボン（右上）
- 各項目：勝者はオレンジ #f97316 太字、敗者はグレー #6b7280

【製品写真の割り当て】各カードのヘッダーには、対応する実機写真を配置すること：
${photoLines}
※ 写真が未アップロードの製品は、製品名のみのテキストヘッダーで代用

【テキスト】
- タイトル（28-36pt・青 #1d4ed8 極太）：「${title || '製品比較'}」
- 補足（13pt・グレー・最下部）：${sub || '価格は2026年5月時点・試用条件'}

【配色】
${mood || '白背景 / カード枠 グレー #e5e7eb / BESTカードのみ オレンジ枠 #f97316＋薄オレンジ背景 #fff7ed / ヘッダー 青 #1d4ed8 ベタ＋白文字'}

【スタイル】Wirecutter / The Verge の比較表記事レベル。表の整列が完璧で目線が自然に流れる。
${COMMON_GUARDS}`;
    },

    ngsummary: ({title, main, sub, mood}) => `# NG集サマリ図（やってはいけない4つ・警告系）

【出力仕様】1200×630px / PNG / 白背景

【構図】
- 上部：タイトル（警告系・赤）
- 中央：2×2 グリッドで4つの NG カード（各カード幅 480px・高さ 220px）
- 下部：補足

【4カードの構造】各カードは丸角矩形＋左上に❌赤バッジ
- ❌バッジ（48×48px・赤 #dc2626 ベタ＋白×印）
- 見出し（NGの内容・黒太字18pt・1行）
- 1行説明（グレー13pt）
- 4項目：${main || 'NG1, NG2, NG3, NG4'}

【テキスト】
- タイトル（30-40pt・赤 #dc2626 極太）：「${title || 'やってはいけない設定 4つ'}」
- 補足（13pt・グレー）：${sub || ''}

【配色】
${mood || '背景 白 / カード 薄ピンク #fef2f2＋赤枠 #fca5a5 / ❌アイコン 赤 #dc2626 / 警告アクセント イエロー #f59e0b（一部）/ テキスト #111827・#4b5563'}

【スタイル】公式マニュアルの注意ページ品質。赤を使いつつ過剰でなく、注意喚起が冷静に伝わる落ち着いたデザイン。
${COMMON_GUARDS}`,

    bgremove: ({title, main, sub, mood}) => `# 背景除去（透過PNG化）— 添付画像を処理

【要件】
- 被写体：${main || '主役オブジェクト（人物・製品・ロゴ等を自動判別）'}
- 背景：完全削除して透過PNG化（アルファチャンネル有効）
- エッジ処理：
  - 毛髪・繊維・透明部分は自然なフェザリング（半透明グラデ）
  - 直線エッジは1px精度でくっきり
  - ハロー（古い背景色の残り）禁止
- サイズ：オリジナル維持
- カラー：被写体の色味は維持・補正なし
${sub ? '【補足】' + sub : ''}
${COMMON_GUARDS}`,

    colorfix: ({title, main, sub, mood}) => `# 配色統一（ブランドカラー化）— 添付画像を処理

【ブランドパレット】
${mood || 'メイン青 #1d4ed8（深い青）/ 補助青 #3b82f6（明るい青）/ アクセントオレンジ #f97316 / 白 #ffffff / グレー #6b7280'}

【処理要件】
- 全体トーンをブランドパレットに収束（ヒストグラム調整 + LUT 適用）
- 被写体本体の色（肌・自然な色）は維持
- 背景・装飾要素・グラデ部分のみブランド色へ
- 用途：${main || 'ブログ記事用'}
- コントラスト維持、可読性最優先
${sub ? '【補足】' + sub : ''}
${COMMON_GUARDS}`,

    addtext: ({title, main, sub, mood}) => `# 画像にテキスト追加（合成）— 添付画像を処理

【追加するテキスト】
1. メインタイトル（48-64pt・白・極太・縁取り黒1px）：「${title || 'メインテキスト'}」
2. サブタイトル（24-32pt・オレンジ #f97316 強調）：「${main || 'サブテキスト'}」
3. 補足（14-18pt・薄白）：「${sub || '補足'}」

【配置ルール】
- ${mood || '画像の主要被写体を妨げない位置（通常は左上 or 左下、視線の流入点）'}
- 文字に半透明黒帯（rgba(0,0,0,0.5)）を背景として敷き、可読性確保
- マージン：画面端から最低40px

【フォント】Noto Sans JP / Hiragino Kaku Gothic ProN / Yu Gothic Bold 相当
${COMMON_GUARDS}`,

    // ─── 追加テンプレ7種（トップガジェットブロガー調査ベース・最高品質仕様） ──

    // 💯 数値インパクトカード（記事冒頭・ROI訴求ヒーロー）
    big_number: ({title, main, sub, mood}) => `# 数値インパクトカード（最高インパクト・LP一級品）

【出力仕様】1200×630px / PNG / 青グラデ背景

【構図】中央集約・左右均等の上下3層
- 上層（高さ20%）：文脈テキスト（白・中央寄せ）：「${title || '時短で'}」（24-30pt）
- 中層（高さ55%）：超巨大数字（オレンジ #f97316・極太・288-360pt）
   - 数字本体：「${main || '64,500'}」
   - 単位は数字より一回り小さく（120-160pt）：「円」
   - 必要なら期間 prefix（48-60pt 白）：「${sub || '/年'}」
   - 数字に微かなドロップシャドウ（4px、20% black）で立体感
- 下層（高さ25%）：キャッチコピー（白・太字・36-48pt）：「節約できる時間と金額」

【配色】
${mood || '背景：左上 #1d4ed8 → 右下 #3b82f6 のリニアグラデーション / 数字：オレンジ #f97316 / 補助テキスト：白 #ffffff、薄白 #e5e7eb'}

【装飾要素】
- 右下隅に小さく「生産技術ガジェット研究所」（11pt・40% 不透明白）
- 数字の周囲に微かなオレンジ光彩（glow radius 40px・15% opacity）

【スタイル】Stripe / Linear / Apple LP のヒーローセクション一級品。数字が主役、それ以外は徹底的に引き算。1秒で意味が伝わるシンプルさ。
${COMMON_GUARDS}`,

    // 📋 スペック表カード（製品紹介セクション）
    specs_card: ({title, main, sub, mood}) => `# 製品スペック表カード（プロダクトページ品質）

【出力仕様】1200×630px / PNG / 白背景

【構図】左右2カラム
- 左カラム（幅 480px・全高）：製品の写実的アイコン or イラスト
   - サブジェクト：${sub || '製品の特徴的形状を表現'}
   - 中央配置・周囲に薄い影
- 右カラム（幅 720px・全高）：スペック表
   - 上部に製品名（青 #1d4ed8・極太・32-40pt）：「${title || '製品名'}」
   - 縦に6行のスペック表：
     1. 価格 ｜ ${main || '12,978円'}
     2. 重量 ｜ 256g
     3. 電源 ｜ CR123A
     4. 認証 ｜ 指紋・IC・スマホ
     5. 取付 ｜ 両面テープ
     6. 対応 ｜ 99.9% のドア
   - 各行：項目名（14pt・グレー #6b7280・左寄せ） ｜ 値（18-22pt・黒太字・右寄せ）
   - 行間：18px、罫線：1px・薄グレー #e5e7eb
   - 1番目の「価格」は値をオレンジ #f97316 で強調

【配色】
${mood || '白 #ffffff 背景 / タイトル青 #1d4ed8 / 価格値はオレンジ #f97316 / 罫線 薄グレー #e5e7eb / 項目名 #6b7280 / 値 #111827'}

【スタイル】Apple / SwitchBot 公式プロダクトページ品質。整列完璧、余白十分、可読性最優先。
${COMMON_GUARDS}`,

    // 🔲 機能アイコン6個グリッド（機能解説）
    icon_grid: ({title, main, sub, mood}) => `# 機能アイコン6個グリッド（インフォグラフィック品質）

【出力仕様】1200×630px / PNG / 白背景

【構図】
- 上部 1/8：タイトル
- 中央 6/8：2行×3列 のカードグリッド（各カード 360×220px、間隔 24px）
- 下部 1/8：補足

【6カードの構造】各カードは丸角矩形（角丸12px・1px枠 #e5e7eb・shadow 4px 8px rgba(0,0,0,0.04)）
- 上半分：線画アイコン（96×96px・青 #1d4ed8 or オレンジ #f97316・線太さ 3.5px 統一）
- 下半分：機能名（16-20pt・黒太字）＋ 1行説明（12-14pt・グレー #6b7280）
- 6機能：${main || '指紋認証 / Suica対応 / スマホ操作 / オートロック / 遠隔操作 / 音声制御'}

【テキスト】
- タイトル（28-36pt・青 #1d4ed8 極太・中央寄せ）：「${title || '6つの機能'}」
- 補足（13pt・グレー・最下部中央）：${sub || '主な機能一覧'}

【配色】
${mood || '白 #ffffff 背景 / アイコン 青 #1d4ed8 と オレンジ #f97316 を 4:2 の比率で配色 / カード枠 #e5e7eb / テキスト #111827・#6b7280'}

【スタイル】Notion アイコンセット / Tabler Icons 級の線画統一感。アイコンは pictogram スタイル、線幅・端処理・サイズすべて完全に揃える。
${COMMON_GUARDS}`,

    // ⚖️ メリット/デメリット並列（レビュー中盤）
    pros_cons: ({title, main, sub, mood}) => `# メリット/デメリット並列カード（レビュー必須ビジュアル）

【出力仕様】1200×630px / PNG / 白背景

【構図】中央縦線で左右2分割
- 上部 1/8：タイトル（中央寄せ）
- 左半分（幅 580px・薄緑グラデ背景 #ecfdf5→#d1fae5）
- 右半分（幅 580px・薄ピンクグラデ背景 #fef2f2→#fee2e2）
- 中央に縦線（2px・グレー #e5e7eb・余白20px）

【左半分（メリット）】
- 見出し（28-32pt・緑 #059669 極太）：「✅ メリット」
- 箇条書き 3〜4項目（各 18-20pt・黒）：${main || '賃貸OK / 工事不要 / 15分で取付 / 指紋認証0.3秒'}
- 各項目の左に ✅ アイコン（緑 #059669・サイズ統一 24px）

【右半分（デメリット）】
- 見出し（28-32pt・赤 #dc2626 極太）：「⚠️ デメリット」
- 箇条書き 2〜3項目（各 18-20pt・黒）：${sub || '電池交換 半年毎 / オートロック締め出し注意 / 物理鍵は併用必須'}
- 各項目の左に ⚠️ アイコン（オレンジ #f59e0b・サイズ統一 24px）

【テキスト】タイトル（26-32pt・黒 #111827 極太）：「${title || 'メリット・デメリット'}」

【配色】
${mood || '左：成功感の緑系 #ecfdf5/#d1fae5/#059669 / 右：注意感の赤系 #fef2f2/#fee2e2/#dc2626 / テキストはコントラスト確保'}

【スタイル】Wirecutter / Cnet の Pros&Cons セクション一級品。左右の重量バランス均衡、視線が左→右に自然に流れる。
${COMMON_GUARDS}`,

    // 🥇 ランキング上位3位（まとめ記事）
    ranking: ({title, main, sub, mood}) => `# ランキング TOP3 カード（まとめ記事ヒーロー）

【出力仕様】1200×630px / PNG / 白背景

【構図】3カード横並び、1位を中央に大きく
- 上部 1/8：タイトル＋小サブ
- 中央 7/8：3カード（1位中央・大、2位左・中、3位右・中）
  - 1位カード：幅 380px・高さ 460px（一回り大きい）・中央・上に出す
  - 2位カード：幅 320px・高さ 400px・左
  - 3位カード：幅 320px・高さ 400px・右

【各カードの構造】丸角矩形（角丸20px）
- 上：順位バッジ（円形 80×80px）
   - 1位 = 金 #fbbf24（金グラデ #fcd34d→#f59e0b）+ 🥇
   - 2位 = 銀 #cbd5e1（銀グラデ #e2e8f0→#94a3b8）+ 🥈
   - 3位 = 銅 #b45309（銅グラデ #d97706→#92400e）+ 🥉
- 中：製品アイコン（線画・カラー）120×120px
- 下：製品名（20-26pt・黒太字）＋ 推しコメント1行（13pt・グレー）
- 1位カードのみ：オレンジ枠 #f97316 4px＋微発光

【テキスト】
- タイトル（30-40pt・黒 #111827 極太）：「${title || 'おすすめランキング TOP3'}」
- 推し製品：${main || '1位=製品A / 2位=製品B / 3位=製品C'}
- 補足（12pt・グレー・最下部）：${sub || '2026年5月時点・編集部独自評価'}

【配色】
${mood || '白 #ffffff 背景 / 1位 金系 / 2位 銀系 / 3位 銅系 / テキスト #111827・#6b7280 / 1位の枠オレンジ #f97316'}

【スタイル】The Verge / GIZMODO のランキング記事品質。1位の威厳と、2位3位の納得感を両立。
${COMMON_GUARDS}`,

    // 🎯 こんな人におすすめ/不要（結論前ペルソナ提示）
    target_buyer: ({title, main, sub, mood}) => `# こんな人におすすめ/不要 並列カード（購買決定促進）

【出力仕様】1200×630px / PNG / 白背景

【構図】中央縦線で左右2分割
- 上部 1/8：タイトル
- 左半分（幅 580px・薄緑グラデ背景 #ecfdf5→#d1fae5）「✅ おすすめな人」
- 右半分（幅 580px・薄グレーグラデ背景 #f9fafb→#f3f4f6）「❌ 不要な人」
- 中央縦線（2px・グレー・余白20px）

【左半分】
- 見出し（28-32pt・緑 #059669 極太）：「✅ おすすめな人」
- 4項目（各 16-20pt・黒）：${main || '賃貸暮らし / 在宅ワーカー / 子育て世代 / 鍵をなくしやすい人'}
- 各項目の左に人物アイコン（線画・緑 #059669・32×32px）

【右半分】
- 見出し（28-32pt・グレー #6b7280 極太）：「❌ 不要な人」
- 2-3項目（各 16-20pt・黒）：${sub || '一戸建てで強固な鍵運用 / 短期賃貸 / 機械音NGの人'}
- 各項目の左に人物アイコン（線画・グレー #9ca3af・32×32px）

【テキスト】タイトル（26-32pt・黒 #111827 極太・中央）：「${title || 'こんな人におすすめ'}」

【配色】
${mood || '左：推奨感の緑系（活発）/ 右：非推奨の薄グレー（控えめ）/ 過剰でない柔らかいコントラスト'}

【スタイル】親しみやすいフラットイラスト風。読者が自分の状況に当てはめやすい配置と簡潔さ。
${COMMON_GUARDS}`,

    // 🌿 使い分けフローチャート（Yes/No分岐）
    decision_tree: ({title, main, sub, mood}) => `# 使い分けフローチャート（Yes/No分岐・選び方ガイド）

【出力仕様】1200×630px / PNG / 白背景

【構図】上から下へ流れる階層フロー
- 上部 1/8：タイトル
- 中央 6/8：分岐ツリー（最上段に質問1、中段に質問2、下段に2つの結論）
- 下部 1/8：補足

【ノード構造】
- 質問ノード：青菱形（青 #1d4ed8 ベタ枠＋白背景・幅240px・高さ120px）＋ 黒太字18-22pt
- 結論ノード：オレンジ角丸矩形（#f97316 ベタ＋白文字・幅280px・高さ100px）＋ 白極太22-28pt
- 矢印（4px太・先端三角）
   - Yes 矢印：緑 #059669・矢印近くに「Yes」ラベル
   - No 矢印：赤 #dc2626・矢印近くに「No」ラベル

【分岐構造（例）】
- 質問1（最上段）：「${main || '賃貸住まいですか?'}」
  - Yes → 質問2「工事不可ですか?」 → Yes → 結論A「ロックLite が最適」（オレンジ）
  - No → 結論B「フル機能のロックPro」（オレンジ薄め）
- 結論内容：${sub || '結論A=ロックLite、結論B=ロックPro'}

【テキスト】タイトル（28-36pt・青 #1d4ed8 極太・中央）：「${title || 'あなたにピッタリの選び方'}」

【配色】
${mood || '白背景 / 質問 青菱形 #1d4ed8 / Yes矢印 緑 #059669 / No矢印 赤 #dc2626 / 結論 オレンジ #f97316'}

【スタイル】Mermaid 級のクリーンなフローチャート。線太さ完全統一、矢印角度45度 or 90度のみ、ノード間隔均等。読者が「自分はこの道」と一目で分かる。
${COMMON_GUARDS}`,

    custom: () => '',
  };

  function regenerateAIPrompt() {
    const key = aiTemplateSelect.value;
    // テンプレに合わせて入力欄のラベル・プレースホルダーを更新（直感的なUX）
    applyTemplateFields(key, 'helper');
    // 比較表テンプレのときだけ「⚖️ 比較画像をまとめてAIへ」を表示
    const cmpBtn = document.getElementById('btn-compare-bundle');
    if (cmpBtn) cmpBtn.hidden = (key !== 'compare');
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
    // バナーの「いまAIに送る内容」カードを最新化（プログラム代入はinputイベントを発火しないため明示呼出）
    if (typeof updateBannerPromptSummary === 'function') updateBannerPromptSummary();
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

  // 🔍 リサーチプロンプト生成ボタン（上部ヘルパー）
  const btnResearchHelper = $('btn-research-helper');
  if (btnResearchHelper) {
    btnResearchHelper.addEventListener('click', () => copyResearchPromptForCurrent('helper'));
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

  // ─── ⚖️ 比較画像をまとめてAIへ（連結シート） ─────────────────
  // AI編集（🤖🍌）は1枚しか渡せないため、比較表生成用に「⚖️比較」役割の画像を
  // 製品ラベル付きで1枚に連結し、画像＋プロンプトをセットでAIへ渡す。
  function blobToImageEl(blob) {
    return new Promise((res, rej) => {
      const u = URL.createObjectURL(blob);
      const im = new Image();
      im.onload = () => { res(im); URL.revokeObjectURL(u); };
      im.onerror = (e) => { URL.revokeObjectURL(u); rej(e); };
      im.src = u;
    });
  }
  // Drive上の既存ファイルをBlobとして取得（GAS downloadFile経由・CORS回避）
  async function fetchDriveBlob(driveFile) {
    const url = GAS_URL + '?' + new URLSearchParams({
      token: TOKEN, action: 'downloadFile', fileId: driveFile.id,
    }).toString();
    const res = await fetch(url).then(r => r.json());
    if (!res || !res.ok) throw new Error((res && res.message) || 'downloadFile 失敗');
    const bin = atob(res.dataBase64);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return new Blob([u8], { type: res.mimeType || driveFile.mimeType || 'image/png' });
  }
  // entries: [{blob?, driveFile?, idx}] を渡すとその画像で連結シートを作る。
  // 省略時は従来通り「⚖️比較」役割の画像を自動収集（後方互換）。
  async function buildCompareSheet(entries) {
    if (!Array.isArray(entries)) {
      // ── 自動収集モード（後方互換）──
      const all = await queueAll();
      const queueComps = all.filter(it =>
        normalizeItemRole(it) === 'compare' &&
        !(it.mimeType || '').startsWith('video/') && it.mimeType !== 'application/pdf' &&
        !/^compare_sheet_/i.test(it.originalName || '')
      );
      const usedIdx = new Set();
      entries = [];
      for (const c of queueComps) {
        const idx = c.compareIndex || null;
        if (idx) usedIdx.add(idx);
        entries.push({ blob: c.blob, idx, at: c.createdAt });
      }
      const driveComps = (getSelectedArticleFolderId() ? (lastExistingFiles || []) : []).filter(f =>
        /^compare_/i.test(f.name || '') && !/^compare_sheet_/i.test(f.name || ''));
      for (const f of driveComps) {
        const m = /^compare_p(\d+)_/i.exec(f.name || '');
        const idx = m ? Number(m[1]) : null;
        if (idx && usedIdx.has(idx)) continue;
        if (idx) usedIdx.add(idx);
        entries.push({ driveFile: f, idx, at: 0 });
      }
    }
    if (!entries || entries.length === 0) {
      showToast('比較する画像が選ばれていません', 'warn');
      return null;
    }
    entries = entries.slice().sort((a, b) => ((a.idx || 99) - (b.idx || 99)) || ((a.at || 0) - (b.at || 0)));
    const blobs = await Promise.all(entries.map(e => e.blob ? Promise.resolve(e.blob) : fetchDriveBlob(e.driveFile)));
    const comps = entries.map((e, i) => ({ compareIndex: e.idx, blob: blobs[i] }));
    const names = getCompareProductNames();
    const imgs = await Promise.all(blobs.map(b => blobToImageEl(b)));
    const cellH = 512, labelH = 56, pad = 16;
    const widths = imgs.map(im => Math.max(1, Math.round(im.naturalWidth * (cellH / im.naturalHeight))));
    const canvas = document.createElement('canvas');
    canvas.width = widths.reduce((a, b) => a + b, 0) + pad * (imgs.length + 1);
    canvas.height = cellH + labelH + pad * 2;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    let x = pad;
    imgs.forEach((im, i) => {
      ctx.drawImage(im, x, pad, widths[i], cellH);
      const pn = comps[i].compareIndex || (i + 1);
      const label = `製品${pn}` + (names[pn - 1] ? `：${names[pn - 1]}` : '');
      ctx.fillStyle = '#1d4ed8';
      ctx.font = 'bold 28px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(label, x + widths[i] / 2, pad + cellH + 38);
      x += widths[i] + pad;
    });
    return { blob: await new Promise(res => canvas.toBlob(res, 'image/png')), count: comps.length };
  }
  // 比較候補（一時保存＋既存Driveファイル）を集める。各候補にプレビューURLを付ける。
  async function gatherCompareCandidates() {
    const all = await queueAll();
    const queueCands = all
      .filter(it => !(it.mimeType || '').startsWith('video/') && it.mimeType !== 'application/pdf'
        && !/^compare_sheet_/i.test(it.originalName || ''))
      .map(it => ({
        kind: 'queue', id: it.id, blob: it.blob,
        name: it.originalName || '一時保存の画像',
        thumb: URL.createObjectURL(it.blob),
        idx: it.compareIndex || null,
        preselect: normalizeItemRole(it) === 'compare',
        at: it.createdAt,
      }));
    const driveCands = (getSelectedArticleFolderId() ? (lastExistingFiles || []) : [])
      .filter(f => (/image/i.test(f.mimeType || '') || /\.(png|jpe?g|webp|gif)$/i.test(f.name || ''))
        && !/^compare_sheet_/i.test(f.name || ''))
      .map(f => {
        const m = /^compare_p(\d+)_/i.exec(f.name || '');
        return {
          kind: 'drive', driveFile: f, name: f.name,
          thumb: f.thumbnailUrl, idx: m ? Number(m[1]) : null,
          preselect: /^compare_/i.test(f.name || ''), at: 0,
        };
      });
    return queueCands.concat(driveCands);
  }

  // 比較する画像を「2枚以上」任意に選び、各製品番号を割り当てるモーダル
  async function chooseCompareImages(cands) {
    const tiles = cands.map((c, i) => {
      const idxOpts = ['', '1', '2', '3', '4'].map(v =>
        '<option value="' + v + '"' + (String(c.idx || '') === v ? ' selected' : '') + '>' + (v ? '製品' + v : '番号なし') + '</option>'
      ).join('');
      return '<label class="km-cmp-tile' + (c.preselect ? ' is-on' : '') + '" data-i="' + i + '">' +
        '<input type="checkbox" class="km-cmp-chk"' + (c.preselect ? ' checked' : '') + '>' +
        '<img src="' + (c.thumb || '') + '" referrerpolicy="no-referrer" alt="">' +
        '<div class="km-cmp-name">' + escHtml(c.name) + '</div>' +
        '<select class="km-cmp-idx">' + idxOpts + '</select>' +
        '<span class="km-cmp-src">' + (c.kind === 'queue' ? '一時保存' : 'Drive') + '</span>' +
      '</label>';
    }).join('');
    const body =
      '<div class="km-cmp-help">比較表に並べたい画像を<strong>2枚以上</strong>選び、それぞれ「製品番号」を割り当ててください。</div>' +
      '<div class="km-cmp-grid">' + tiles + '</div>' +
      '<div class="km-cmp-msg" id="km-cmp-msg"></div>';
    const result = await openModal({
      title: '⚖️ 比較する画像を選ぶ',
      bodyHTML: body,
      buttons: [
        { label: 'キャンセル', value: null },
        { label: '選択した画像で開始', primary: true, onClick: (rootEl) => {
            const picks = [];
            rootEl.querySelectorAll('.km-cmp-tile').forEach((tile) => {
              const chk = tile.querySelector('.km-cmp-chk');
              if (!chk.checked) return;
              const c = cands[Number(tile.dataset.i)];
              const idxV = tile.querySelector('.km-cmp-idx').value;
              picks.push({ blob: c.blob, driveFile: c.driveFile, idx: idxV ? Number(idxV) : (c.idx || null), at: c.at });
            });
            if (picks.length < 2) {
              const msg = rootEl.querySelector('#km-cmp-msg');
              if (msg) msg.textContent = '⚠️ 2枚以上選んでください（今 ' + picks.length + ' 枚）';
              return false; // 閉じない
            }
            return picks;
          } },
      ],
      onRender: (rootEl) => {
        // チェック状態を見た目に反映
        rootEl.querySelectorAll('.km-cmp-tile').forEach((tile) => {
          const chk = tile.querySelector('.km-cmp-chk');
          const sync = () => tile.classList.toggle('is-on', chk.checked);
          chk.addEventListener('change', sync); sync();
        });
      },
    });
    // queue候補のプレビューURLを解放
    cands.forEach(c => { if (c.kind === 'queue' && c.thumb) { try { URL.revokeObjectURL(c.thumb); } catch (_) {} } });
    return result; // picks[] か null
  }

  // 比較entriesの中で重複している製品番号の一覧を返す（[2,3]など）
  function duplicateIdxList(entries) {
    const counts = {};
    entries.forEach(e => { if (e.idx) counts[e.idx] = (counts[e.idx] || 0) + 1; });
    return Object.keys(counts).filter(k => counts[k] > 1).map(Number).sort((a, b) => a - b);
  }
  // 現在「⚖️比較」が割り当たっている画像（一時保存＋既存Drive）を集める
  async function gatherAssignedCompareEntries() {
    const all = await queueAll();
    const entries = [];
    all.forEach(it => {
      if (normalizeItemRole(it) === 'compare'
        && !/^compare_sheet_/i.test(it.originalName || '')
        && !(it.mimeType || '').startsWith('video/') && it.mimeType !== 'application/pdf') {
        entries.push({ blob: it.blob, idx: it.compareIndex || null, at: it.createdAt });
      }
    });
    const usedIdx = new Set(entries.map(e => e.idx).filter(Boolean));
    (getSelectedArticleFolderId() ? (lastExistingFiles || []) : []).forEach(f => {
      if (/^compare_/i.test(f.name || '') && !/^compare_sheet_/i.test(f.name || '')) {
        const m = /^compare_p(\d+)_/i.exec(f.name || '');
        const idx = m ? Number(m[1]) : null;
        if (idx && usedIdx.has(idx)) return;
        if (idx) usedIdx.add(idx);
        entries.push({ driveFile: f, idx, at: 0 });
      }
    });
    return entries;
  }
  // 割り当て済み比較画像に重複番号があればトースト警告して true を返す
  async function warnIfCompareDuplicates() {
    const dup = duplicateIdxList(await gatherAssignedCompareEntries());
    if (dup.length) {
      showToast('⚠️ 製品番号が重複しています（製品' + dup.join('・') + '）。同じ番号は1枚ずつにしてください', 'error');
      return true;
    }
    return false;
  }
  // 連結シート(blob)を一時保存に入れて編集対象(pendingReplace)にし、受取バナーを表示する
  async function stageCompareSheet(sheetBlob, count, prompt) {
    // 前回の編集データ（古い連結シート等）を破棄してから新しいシートを載せる
    await discardPreviousEdit(null);
    const id = Date.now() + '_' + (++itemCounter);
    const record = {
      id, createdAt: Date.now(),
      blob: sheetBlob, mimeType: 'image/png', ext: 'png',
      size: sheetBlob.size,
      originalName: 'compare_sheet_' + id + '.png',
      status: 'pending', editingWith: 'chatgpt',
    };
    await queuePut(record);
    pendingReplace = {
      originalId: record.id, originalItem: record,
      aiEngine: 'chatgpt', prompt: prompt,
      startedAt: Date.now(), aiWindow: null,
      aiUrl: buildAIUrl('chatgpt', prompt),
    };
    await renderQueue();
    showEditingBanner();
    showToast(`⚖️ ${count}枚を1枚に合体しました。バナーの「🖼 画像を再コピー」→「🚀 ${getEngineLabel('chatgpt')}を開く」でAIへ送れます`, 'success');
  }
  // プロンプトに「連結シートの使い方」注記を足す（共通）
  function ensureCompareNote() {
    const note = '【添付画像の使い方】添付の連結シートには各製品の実機写真が「製品1」「製品2」…のラベル付きで横に並んでいます。' +
      '各パネルを切り出して、対応する製品カードのヘッダー画像として使用してください。';
    if (aiPrompt && !aiPrompt.value.includes('【添付画像の使い方】')) {
      aiPrompt.value = (aiPrompt.value.trim() ? aiPrompt.value.trim() + '\n\n' : '') + note;
    }
    return aiPrompt ? aiPrompt.value.trim() : note;
  }
  // 割り当て済み比較画像を自動で1枚に合体して編集対象にする（選択モーダルなし）
  // 比較表テンプレで「編集を開始」したときに使う。
  async function stageCompareSheetFromAssigned() {
    const entries = await gatherAssignedCompareEntries();
    if (entries.length < 2) {
      showToast('比較には画像が2枚以上必要です。一時保存の画像に「⚖️比較」を2枚以上割り当ててください', 'warn');
      return false;
    }
    const dup = duplicateIdxList(entries);
    if (dup.length) {
      showToast('⚠️ 製品番号が重複しています（製品' + dup.join('・') + '）。同じ番号は1枚ずつにしてから編集してください', 'error');
      return false;
    }
    const prompt = ensureCompareNote();
    const sheet = await withServerLock('比較画像を1枚に合体中…', () => buildCompareSheet(entries))
      .catch((e) => { showToast('連結シートの作成に失敗しました: ' + (e.message || e), 'error'); return null; });
    if (!sheet || !sheet.blob) return false;
    await stageCompareSheet(sheet.blob, sheet.count, prompt);
    return true;
  }

  // 「⚖️ 比較画像をまとめてAIへ」の本体（上部ボタン・編集バナー内ボタン共通）
  // 候補を集める → 2枚以上を任意選択＆製品番号割当 → 重複チェック → 1枚に合体 → 編集対象に載せる
  async function runCompareBundle() {
    if (serverBusy) { showToast('いまサーバ通信中です。終わるまでお待ちください', 'warn'); return; }
    const cands = await gatherCompareCandidates();
    if (cands.length < 2) {
      showToast('比較するには画像が2枚以上必要です。一時保存に追加するか、記事を選んで既存ファイルを読み込んでください', 'warn');
      return;
    }
    const picks = await chooseCompareImages(cands);
    if (!picks) return; // キャンセル
    const dup = duplicateIdxList(picks);
    if (dup.length) {
      showToast('⚠️ 製品番号が重複しています（製品' + dup.join('・') + '）。番号を割り当て直してください', 'error');
      return;
    }
    const prompt = ensureCompareNote();
    const sheet = await withServerLock('比較画像を1枚に合体中…', () => buildCompareSheet(picks))
      .catch((e) => { showToast('連結シートの作成に失敗しました: ' + (e.message || e), 'error'); return null; });
    if (!sheet || !sheet.blob) return;
    await stageCompareSheet(sheet.blob, sheet.count, prompt);
  }

  const btnCompareBundle = $('btn-compare-bundle');
  if (btnCompareBundle) {
    btnCompareBundle.addEventListener('click', async () => {
      btnCompareBundle.disabled = true;
      try { await runCompareBundle(); } finally { btnCompareBundle.disabled = false; }
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
    // キューが空でもメモがあれば保存だけは走らせる（記事メモ単独編集ケース）
    if (items.length === 0 && !hasPromptData()) return;
    if (isUploading) return; // 🛡 二重実行ガード
    // 🛡 製品番号未割当の比較画像があれば送信前に確認（どの製品カードにも紐付かないため）
    const unassignedCompare = items.filter(it => normalizeItemRole(it) === 'compare' && !it.compareIndex);
    if (unassignedCompare.length > 0) {
      const go = window.confirm(
        `⚖️ 比較画像のうち ${unassignedCompare.length} 枚が「製品番号」未割当です。\n` +
        `このまま送信すると、比較表のどの製品にも紐付きません。\n\n` +
        `[OK] このまま送信　[キャンセル] 戻って割り当てる`
      );
      if (!go) {
        setStatus('送信を中止しました（キュー画像の「製品?」で番号を割り当ててください）');
        return;
      }
    }
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

    // メモのみ保存ケース：画像転送ループはスキップして完了
    if (items.length === 0) {
      uploadAllBtn.disabled = false;
      setStatus(promptSaved ? '💾 メモのみ保存完了（画像なし）' : '何もすることがありません');
      showToast(promptSaved ? '💾 メモを保存しました（転送する画像なし）' : '転送する画像がありません', promptSaved ? 'success' : 'warn');
      if (promptSaved) clearMemoState();
      return;
    }

    // 🛡 ここから転送中ロック（✕削除・役割変更・編集の誤操作防止）＋全画面オーバーレイ
    isUploading = true;
    lockUI('画像をDriveへ転送中…');
    await renderQueue();

    // 役割（アイキャッチ/セクション/図解 等）が指定された画像は、ファイル名にプレフィックス付与
    for (const it of items) {
      const roleKey = normalizeItemRole(it);
      if (roleKey === 'none') continue;
      const def = getRoleDef(roleKey);
      // 比較ロールで製品番号が割り当てられていれば compare_p{n}_ にする
      const prefix = (roleKey === 'compare' && it.compareIndex)
        ? 'compare_p' + it.compareIndex + '_'
        : def.prefix;
      if (prefix && !new RegExp('^' + prefix, 'i').test(it.originalName || '')) {
        it.originalName = prefix + (it.originalName || (roleKey + '.png'));
        await queuePut(it);
      }
    }

    // 🔑 ユニーク役割（アイキャッチ/ヒーロー/NG集サマリ）の重複検出 → ユーザーに「上書き or コピー」を選ばせる
    if (articleFolderId) {
      try {
        const url = GAS_URL + '?' + new URLSearchParams({
          token: TOKEN, action: 'listArticleFiles', articleFolderId: articleFolderId,
        }).toString();
        const listRes = await fetch(url).then(r => r.json());
        if (listRes.ok && Array.isArray(listRes.files)) {
          const existingFiles = listRes.files;
          const conflicts = []; // {item, def, existing}
          for (const it of items) {
            if (it.replaceDriveFileId) continue; // すでに明示的に上書き対象が決まっている
            const roleKey = normalizeItemRole(it);
            if (roleKey === 'none') continue;
            const def = getRoleDef(roleKey);
            if (!def.unique || !def.prefix) continue;
            const matched = existingFiles.filter(f =>
              new RegExp('^' + def.prefix, 'i').test(f.name || '')
            );
            if (matched.length > 0) {
              matched.sort((a, b) => (b.modifiedTime || '').localeCompare(a.modifiedTime || ''));
              conflicts.push({ item: it, def, existing: matched[0] });
            }
          }
          if (conflicts.length > 0) {
            // ユーザーに確認：上書き or 新規コピー
            const msg = `以下の画像が既存のDriveファイルと役割が同じです：\n\n` +
              conflicts.map(c =>
                `  ${c.def.emoji} ${c.def.label}\n` +
                `    新画像: ${c.item.originalName}\n` +
                `    既存:   ${c.existing.name}`
              ).join('\n\n') +
              `\n\n──────────────\n` +
              `[OK]    既存ファイルを「上書き保存」\n` +
              `[キャンセル]  「新規コピー」として追加（既存も残る）`;
            const wantOverwrite = window.confirm(msg);
            for (const c of conflicts) {
              if (wantOverwrite) {
                c.item.replaceDriveFileId = c.existing.id;
                await queuePut(c.item);
                console.log(`[overwrite] ${c.def.label}: ${c.existing.name} ← ${c.item.originalName}`);
              } else {
                console.log(`[new copy] ${c.def.label}: ${c.item.originalName} (既存 ${c.existing.name} は残置)`);
              }
            }
            setStatus(wantOverwrite
              ? `🔄 ${conflicts.length}件を上書き保存で転送中...`
              : `➕ ${conflicts.length}件を新規コピーで転送中...`);
            await renderQueue(); // バッジを反映（上書きモードの↻バッジ表示）
          }
        }
      } catch (e) {
        console.warn('unique role conflict check failed:', e);
      }
    }

    let success = 0, skipped = 0, failed = 0;
    let didReplace = false; // 既存ファイルの上書きが起きたか（後で一覧を再読込するため）
    // 役割→[ファイル名+fileId] の記録（PROMPT.mdに反映するため）
    const roleUploadMap = {};
    for (const item of items) {
      setStatus('転送中 ' + (success + skipped + failed + 1) + '/' + items.length);
      try {
        // 🛡 上書き(replaceFile)は uploadSmall 経由で行う。大容量経路(uploadLarge)は
        //   replaceDriveFileId を扱えず新規ファイルを作ってしまう＝「更新されない」原因になるため。
        if (item.replaceDriveFileId) didReplace = true;
        const result = (item.size > SMALL_FILE_LIMIT && !item.replaceDriveFileId)
          ? await uploadLarge(item, articleTitle, articleFolderId)
          : await uploadSmall(item, articleTitle, articleFolderId);
        if (result.ok && result.result === 'success') {
          success++;
          // 上書き保存した画像は、手元のblobを新fileIdに紐づけて一覧サムネに使う（Driveサムネ遅延回避）
          if (item.replaceDriveFileId && result.fileId) {
            try { recentReplacedThumbs[result.fileId] = URL.createObjectURL(item.blob); } catch (_) {}
          }
          const roleKey = normalizeItemRole(item);
          if (roleKey !== 'none') {
            if (!roleUploadMap[roleKey]) roleUploadMap[roleKey] = [];
            roleUploadMap[roleKey].push({
              name: result.fileName || item.originalName,
              fileId: result.fileId || '',
            });
          }
        }
        else if (result.ok && result.result === 'skipped') skipped++;
        else { failed++; continue; }
        await queueDelete(item.id);
      } catch (e) {
        failed++;
        console.error('upload error:', e);
      }
    }

    // 役割ごとの画像参照をメモに追記して再保存（AIが認識するため）
    const roleKeys = Object.keys(roleUploadMap);
    if (roleKeys.length > 0 && (articleFolderId || articleTitle)) {
      try {
        // 🛡 メモ消失防止：ローカルメモが空（アップロード後のクリア等）なのに
        // Drive の PROMPT.md にメモが残っている場合、先に取り込んでから書き直す。
        // （役割行も含めて救出する＝下のマージ処理が過去分を正しく保持できる）
        if (getValidMemos().length === 0 && articleFolderId) {
          try {
            const gp = await fetch(GAS_URL + '?' + new URLSearchParams({
              token: TOKEN, action: 'getPrompt', articleFolderId: articleFolderId,
            }).toString()).then(r => r.json());
            if (gp.ok && gp.exists) {
              const rescued = (Array.isArray(gp.memos) ? gp.memos : [])
                .map(m => String(m || '').trim())
                .filter(m => m.length > 0);
              if (rescued.length > 0) memos = [...memos, ...rescued];
              if (!articleTypeSelect.value && gp.articleType) {
                if (!articleTypes.includes(gp.articleType)) {
                  articleTypes.push(gp.articleType); saveArticleTypes(); renderArticleTypes();
                }
                articleTypeSelect.value = gp.articleType;
              }
            }
          } catch (e) { console.warn('existing memo rescue failed:', e); }
        }
        const newNotes = [];
        for (const def of ROLE_DEFS) {
          if (def.key === 'none' || !roleUploadMap[def.key]) continue;
          const list = roleUploadMap[def.key];
          if (def.key === 'compare') {
            // 比較表は「1行＝1製品」の独立メモにする。
            // 🛡 複数行メモはGASのparsePromptMd_が2行目以降を読み戻せず往復で消えるため、必ず1行で完結させる。
            // 🛡 製品名は比較表テンプレ選択中の入力欄だけを信用する（getCompareProductNames）
            const pnames = getCompareProductNames();
            for (const f of list) {
              const m = /compare_p(\d+)_/i.exec(f.name);
              const fid = f.fileId ? ` (fileId: ${f.fileId})` : '';
              if (m) {
                const i = Number(m[1]);
                const nm = pnames[i - 1] ? `（${pnames[i - 1]}）` : '';
                newNotes.push(`${def.label} 製品${i}${nm}: ${f.name}${fid}`);
              } else {
                newNotes.push(`${def.label}: ${f.name}${fid}`);
              }
            }
          } else {
            const desc = list.map(f => f.name + (f.fileId ? ` (fileId: ${f.fileId})` : '')).join(', ');
            newNotes.push(`${def.label}: ${desc}`);
          }
        }
        // 🛡 役割行はマージ方式（2026-06-13改定）：「全削除→今回分のみ」だと過去アップ分の記録が消える。
        // 除去するのは ①今回転送したファイルの行 ②今回ユニーク役割を登録した役割の旧行
        // ③今回と同じ製品番号の比較行 だけ。他の役割行（過去分）は保持する。
        const batchKeys = [];
        Object.values(roleUploadMap).forEach(list => list.forEach(f => {
          if (f.fileId) batchKeys.push(f.fileId);
          if (f.name) batchKeys.push(f.name);
        }));
        const uniqueLabelsNew = ROLE_DEFS.filter(d => d.unique && roleUploadMap[d.key]).map(d => d.label);
        const newCompareIdx = new Set();
        (roleUploadMap.compare || []).forEach(f => {
          const m = /compare_p(\d+)_/i.exec(f.name || '');
          if (m) newCompareIdx.add(Number(m[1]));
        });
        memos = memos.filter(m => {
          if (!ROLE_NOTE_RE.test(m)) return true;            // ユーザーメモは常に保持
          if (batchKeys.some(k => k && m.includes(k))) return false;
          if (uniqueLabelsNew.some(lb => m.indexOf(lb) === 0)) return false;
          const pm = /^比較\/Before-After\s*製品(\d+)/.exec(m);
          if (pm && newCompareIdx.has(Number(pm[1]))) return false;
          return true;
        });
        // 上部に挿入（優先度高い扱い）
        memos = [...newNotes, ...memos];
        persistMemoState();
        renderMemos();
        await savePromptToDrive(articleTitle, articleFolderId);
        showToast(`⭐ 画像役割 ${roleKeys.length}種類を PROMPT.md に記録`, 'success');
      } catch (e) {
        console.error('role memo save error:', e);
      }
    }
    isUploading = false; // 🛡 転送中ロック解除
    unlockUI();
    await renderQueue();
    uploadAllBtn.disabled = false;
    let msg = '✅成功 ' + success + ' / スキップ ' + skipped + ' / 失敗 ' + failed;
    if (promptSaved) msg = '📝メモ保存 / ' + msg;
    setStatus(msg);
    showToast(msg, failed > 0 ? 'error' : 'success');
    navigator.vibrate && navigator.vibrate([50, 30, 50]);

    // 🔄 上書き保存が起きたら、既存ファイル一覧を再読込して更新後の画像を表示する
    //   （Driveのサムネは古いfileIdを指したままなので、再取得しないと「更新されない」ように見える）
    if (didReplace && articleFolderId) {
      try { await loadExistingFiles(articleFolderId); } catch (_) {}
    }

    // 成功時はメモをクリア（次の記事用）
    if (failed === 0 && promptSaved) clearMemoState();
  }

  async function uploadSmall(item, articleTitle, articleFolderId) {
    const base64 = await blobToBase64(item.blob);
    // 既存ファイル上書きモード（再編集用）
    if (item.replaceDriveFileId) {
      const body = new URLSearchParams({
        token: TOKEN,
        action: 'replaceFile',
        fileId: item.replaceDriveFileId,
        mimeType: item.mimeType,
        fileDataBase64: base64,
      });
      const res = await fetch(GAS_URL, {
        method: 'POST',
        body: body.toString(),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      });
      const json = await res.json();
      if (json.ok && json.result === 'replaced') {
        // uploadSmall の戻り値形式に合わせる
        return { ok: true, result: 'success', fileId: json.newFileId, fileName: json.fileName, articleFolderId: json.articleFolderId };
      }
      return json;
    }
    // 通常の新規アップロード
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

  useNewArticleBtn.addEventListener('click', async () => {
    const title = newArticleInput.value.trim();
    if (!title) { showToast('記事名を入力してください', 'error'); return; }
    // 即時 Drive フォルダ作成（prefix「【記事】」は GAS が自動付与）
    useNewArticleBtn.disabled = true;
    const originalLabel = useNewArticleBtn.textContent;
    useNewArticleBtn.textContent = '作成中…';
    try {
      const res = await fetch(GAS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          token: TOKEN,
          action: 'createArticle',
          articleTitle: title,
        }).toString(),
      }).then(r => r.json());
      if (!res || !res.ok) throw new Error((res && res.message) || 'createArticle 失敗');

      // 記事リストを再読込し、新規作成された記事を選択状態に
      await loadArticleList();
      articleSelect.value = res.articleFolderId;
      selectedNewArticle = null; // Drive上に存在する記事として扱う
      newArticleInput.value = '';
      // 既存メモ/ファイルがあれば取得（新規ならどちらも空のはず）
      await loadExistingPrompt(res.articleFolderId, { silent: true });
      await loadExistingFiles(res.articleFolderId);
      showToast(`📁 記事「${res.articleFolderName}」を作成しました`, 'success');
    } catch (err) {
      console.error('createArticle error:', err);
      // GAS呼び出し失敗時は従来通り「メモリ内記事」として扱うフォールバック
      selectedNewArticle = title;
      articleSelect.value = '';
      showToast('フォルダ作成失敗（転送時に再試行されます）: ' + (err.message || err), 'warn');
    } finally {
      useNewArticleBtn.disabled = false;
      useNewArticleBtn.textContent = originalLabel;
      updateCurrentArticleDisplay();
    }
  });
  const LS_LAST_FOLDER_KEY = 'kiji-meshi:last-article-folder';
  articleSelect.addEventListener('change', async () => {
    selectedNewArticle = null;
    newArticleInput.value = '';
    // 既存記事を選んだら PROMPT.md と既存ファイル一覧をDriveから復元
    const folderId = articleSelect.value;
    if (folderId) {
      // 🛡 クロス汚染防止：メモ欄に「別の記事の持ち物」のメモが残っている場合は確認してから処理。
      // 黙って引き継ぐと、前の記事のメモがこの記事のPROMPT.mdへ恒久的に書き込まれてしまう。
      if (memoFolderId && memoFolderId !== folderId && getValidMemos().length > 0) {
        const keep = window.confirm(
          '📝 メモ欄に「前に選んでいた記事」のメモが残っています。\n\n' +
          '[OK] この記事でも使う（引き継ぐ）\n' +
          '[キャンセル] クリアして、この記事の保存済みメモだけを読み込む'
        );
        if (!keep) {
          memos = [];
          renderMemos();
        }
        memoFolderId = folderId;
      }
      localStorage.setItem(LS_LAST_FOLDER_KEY, folderId);
      await withServerLock('Driveから記事データを読み込み中…', async () => {
        await loadExistingPrompt(folderId);
        await loadExistingFiles(folderId);
      });
    } else {
      localStorage.removeItem(LS_LAST_FOLDER_KEY);
      hideExistingFiles();
    }
    updateCurrentArticleDisplay();
  });

  // ─── 既存ファイル一覧（再編集用） ────────────────────
  const existingFilesDetails = $('existing-files-details');
  const efSummaryStatus = $('ef-summary-status');
  const efGrid = $('ef-grid');
  const efEmpty = $('ef-empty');
  const btnReloadFiles = $('btn-reload-files');

  function hideExistingFiles() {
    if (existingFilesDetails) existingFilesDetails.hidden = true;
    lastExistingFiles = []; // 🛡 記事未選択時に前記事の一覧が比較シート等へ混入しないようクリア
  }

  // 既存ファイルの役割を逆引きする。
  // Drive保存時にファイル名がタイムスタンプ名へ変わることがあるため、
  // ①ファイル名プレフィックス → ②PROMPT.mdの役割行（fileId優先・なければ名前）の順で照合する。
  function resolveExistingFileRole(f) {
    const name = f.name || '';
    // ① ファイル名プレフィックス
    const mP = /^compare_p(\d+)_/i.exec(name);
    if (mP) return { def: getRoleDef('compare'), pnum: Number(mP[1]), pname: '' };
    for (const def of ROLE_DEFS) {
      if (def.key === 'none' || !def.prefix) continue;
      if (new RegExp('^' + def.prefix, 'i').test(name)) return { def, pnum: null, pname: '' };
    }
    // ② PROMPT.md の役割行（読み込み済み memos から）
    for (const m of memos) {
      const line = (m || '').trim();
      if (!ROLE_NOTE_RE.test(line)) continue;
      const hit = (f.id && line.includes(f.id)) || (name && line.includes(name));
      if (!hit) continue;
      const label = line.split(/[:：]/)[0].trim();
      const def = ROLE_DEFS.find(d => d.key !== 'none' && label.indexOf(d.label) === 0)
        || (label.indexOf('アイキャッチ') === 0 ? getRoleDef('eyecatch') : null);
      if (def) {
        const pn = /製品(\d+)/.exec(label);
        const pname = (/製品\d+（([^）]+)）/.exec(label) || [])[1] || '';
        return { def, pnum: pn ? Number(pn[1]) : null, pname };
      }
    }
    return null;
  }

  // 役割プレフィックスの除去（多重付与も一括で剥がす）
  const ROLE_PREFIX_STRIP_RE = /^(eyecatch_|hero_|section_|product_|diagram_|comparetable_|compare_p\d+_|compare_|ngsummary_)+/i;
  function stripRolePrefix(name) { return (name || '').replace(ROLE_PREFIX_STRIP_RE, ''); }
  // 役割変更セレクタの選択肢（value = 新しいプレフィックス）
  const EF_ROLE_OPTIONS = [
    { v: '',            t: '☆ 役割なし' },
    { v: 'eyecatch_',   t: '⭐ アイキャッチ' },
    { v: 'hero_',       t: '🎯 ヒーローバナー' },
    { v: 'section_',    t: '📑 セクション画像' },
    { v: 'product_',    t: '📸 商品/実機写真' },
    { v: 'diagram_',    t: '📐 図解/フロー図' },
    { v: 'compare_p1_', t: '⚖️ 比較 製品1' },
    { v: 'compare_p2_', t: '⚖️ 比較 製品2' },
    { v: 'compare_p3_', t: '⚖️ 比較 製品3' },
    { v: 'compare_p4_', t: '⚖️ 比較 製品4' },
    { v: 'comparetable_', t: '📊 比較表(完成)' },
    { v: 'ngsummary_',  t: '⚠️ NG集サマリ' },
  ];
  const UNIQUE_ROLE_PREFIXES = ['eyecatch_', 'hero_', 'ngsummary_', 'comparetable_']; // 1記事1枚の役割
  let lastExistingFiles = []; // 直近の一覧（ユニーク役割の重複解消に使う）
  // 直近で上書き転送した画像の {新fileId: 手元blobのObjectURL}。
  // Driveのサムネ生成は遅延するため、一覧表示では転送した実画像をそのまま見せる（＝確実に最新が映る）。
  const recentReplacedThumbs = {};

  // 既存ファイルの役割を変更する＝Drive上のファイル名のプレフィックスを付け替える
  // （記事生成スクリプトはファイル名プレフィックスで役割を判定するため、リネームが本体）
  async function changeExistingFileRole(f, newPrefix, folderId) {
    const base = stripRolePrefix(f.name);
    const newName = (newPrefix || '') + base;
    // ユニーク役割なら、同じ役割の他ファイルを先に「役割なし」へ降格（重複解消）
    if (newPrefix && UNIQUE_ROLE_PREFIXES.includes(newPrefix)) {
      const dupRe = new RegExp('^' + newPrefix, 'i');
      const others = lastExistingFiles.filter(x => x.id !== f.id && dupRe.test(x.name || ''));
      if (others.length > 0) {
        const ok = window.confirm(
          `この役割は1記事1枚です。すでに ${others.length} 枚が同じ役割です。\n\n` +
          `[OK] この画像に付け替える（他は「役割なし」に降格）\n[キャンセル] やめる`
        );
        if (!ok) return false;
        for (const o of others) {
          const r = await gasRenameFile(o.id, stripRolePrefix(o.name), folderId);
          // 🛡 降格した側のPROMPT.md役割行も除去（残すとバッジ重複・「役割を名前に反映」の誤誘導になる）
          if (r) {
            try { updateRoleLineForFile(o, r.fileName, ''); } catch (e) { console.warn('demote line cleanup failed:', e); }
          }
        }
      }
    }
    const renamed = await gasRenameFile(f.id, newName, folderId);
    if (!renamed) return false;
    // PROMPT.md の役割行も更新（このファイルの記載を消し、新役割行を追記）
    try {
      updateRoleLineForFile(f, renamed.fileName, newPrefix);
      await savePromptToDrive(getSelectedArticleTitle(), folderId);
    } catch (e) { console.warn('role line update failed:', e); }
    return true;
  }
  async function gasRenameFile(fileId, newName, folderId) {
    const body = new URLSearchParams({
      token: TOKEN, action: 'renameFile',
      fileId: fileId, newName: newName, articleFolderId: folderId,
    });
    const res = await fetch(GAS_URL, {
      method: 'POST', body: body.toString(),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    }).then(r => r.json());
    if (!res.ok) { showToast('役割変更に失敗: ' + (res.message || ''), 'error'); return null; }
    return res;
  }
  // PROMPT.md 役割行から対象ファイルの記載を取り除き、新しい役割行を追記する
  function updateRoleLineForFile(f, newName, newPrefix) {
    // 既存役割行から「このファイルのセグメント」だけ除去（同じ行に他ファイルが載っている場合は残す）
    memos = memos.map(m => {
      if (!ROLE_NOTE_RE.test(m)) return m;
      if (!(m.includes(f.id) || m.includes(f.name))) return m;
      const head = m.slice(0, m.search(/[:：]/) + 1);
      const segs = m.slice(head.length).split(',').map(s => s.trim())
        .filter(s => s && !(s.includes(f.id) || s.includes(f.name)));
      return segs.length > 0 ? head + ' ' + segs.join(', ') : '';
    }).filter(m => m !== '');
    if (newPrefix) {
      const mP = /^compare_p(\d+)_$/.exec(newPrefix);
      if (mP) {
        const pnames = getCompareProductNames();
        const nm = pnames[Number(mP[1]) - 1] ? `（${pnames[Number(mP[1]) - 1]}）` : '';
        memos = [`比較/Before-After 製品${mP[1]}${nm}: ${newName} (fileId: ${f.id})`, ...memos];
      } else {
        const def = ROLE_DEFS.find(d => d.prefix === newPrefix);
        if (def) memos = [`${def.label}: ${newName} (fileId: ${f.id})`, ...memos];
      }
    }
    persistMemoState();
    renderMemos();
  }

  async function loadExistingFiles(folderId) {
    if (!existingFilesDetails) return;
    existingFilesDetails.hidden = false;
    efSummaryStatus.textContent = '読込中…';
    efGrid.innerHTML = '';
    efEmpty.hidden = true;
    lastExistingFiles = []; // 🛡 取得失敗時に前記事の一覧が残らないよう先にクリア
    try {
      const url = GAS_URL + '?' + new URLSearchParams({
        token: TOKEN, action: 'listArticleFiles', articleFolderId: folderId,
      }).toString();
      const res = await fetch(url).then(r => r.json());
      if (!res.ok) throw new Error(res.message);
      const files = res.files || [];
      lastExistingFiles = files;
      efSummaryStatus.textContent = files.length + '件';
      if (files.length === 0) {
        efEmpty.hidden = false;
        return;
      }
      for (const f of files) {
        const card = document.createElement('div');
        card.className = 'ef-card';
        // 役割バッジ（キューの一時保存画像と同じ見た目ルール）
        const role = resolveExistingFileRole(f);
        const roleLabel = role
          ? (role.def.key === 'compare'
              ? `${role.def.emoji} 比較 製品${role.pnum || '?'}${role.pname ? '＝' + role.pname.slice(0, 6) : ''}`
              : `${role.def.emoji} ${role.def.label}`)
          : '';
        const roleBadgeHtml = role
          ? `<div class="ef-role-badge" style="background:${role.def.color}" title="この画像の役割">${roleLabel}</div>`
          : '';
        // 役割変更セレクタの現在値：バッジと同じ2段逆引き（ファイル名→PROMPT.md）に合わせる。
        // 古い保存分はファイル名に役割が無いため、名前だけ見ると「役割なし」と誤表示されてしまう。
        const namePrefixM = /^(eyecatch_|hero_|section_|product_|diagram_|compare_p\d_|ngsummary_)/i.exec(f.name || '');
        const namePrefix = namePrefixM ? namePrefixM[1].toLowerCase() : '';
        let curPrefix = namePrefix;
        if (!curPrefix && role) {
          curPrefix = role.def.key === 'compare'
            ? (role.pnum ? 'compare_p' + role.pnum + '_' : '')
            : (role.def.prefix || '');
        }
        // PROMPT.md上は役割があるのにファイル名に未反映 → 記事生成に効かないので修復ボタンを出す
        const needsHeal = !!curPrefix && namePrefix !== curPrefix;
        const roleSelHtml =
          '<select class="ef-role-sel" title="この画像の役割を変更（Drive上のファイル名が変わります）">' +
          EF_ROLE_OPTIONS.map(o =>
            `<option value="${o.v}"${o.v === curPrefix ? ' selected' : ''}>${o.t}</option>`
          ).join('') +
          '</select>' +
          (needsHeal
            ? '<button class="ef-heal-btn" title="役割がファイル名に未反映のため、このままでは記事生成に効きません。タップで反映">🏷 役割を名前に反映</button>'
            : '');
        // 直近で上書きした画像は手元blobをそのまま表示（Driveサムネ生成待ちで古く見えるのを防ぐ）
        const thumbSrc = recentReplacedThumbs[f.id] || f.thumbnailUrl;
        card.innerHTML =
          roleBadgeHtml +
          `<img loading="lazy" src="${thumbSrc}" alt="${f.name}" referrerpolicy="no-referrer">` +
          `<div class="ef-name" title="${f.name}">${f.name}</div>` +
          roleSelHtml +
          '<div class="ef-buttons">' +
            '<button class="ai-edit-btn" data-action="ef-gpt" title="ChatGPTで再編集">🤖</button>' +
            '<button class="ai-edit-btn ai-edit-gemini" data-action="ef-gem" title="Geminiで再編集">🍌</button>' +
            '<button class="ai-edit-btn ai-edit-canva" data-action="ef-canva" title="Canvaで仕上げ">🎨</button>' +
          '</div>';
        card.querySelector('[data-action="ef-gpt"]').onclick = () => editExistingFile(f, 'chatgpt');
        card.querySelector('[data-action="ef-gem"]').onclick = () => editExistingFile(f, 'gemini');
        card.querySelector('[data-action="ef-canva"]').onclick = () => editExistingFile(f, 'canva');
        const healBtn = card.querySelector('.ef-heal-btn');
        if (healBtn) healBtn.onclick = async () => {
          if (serverBusy) { showToast('いまサーバ通信中です。終わるまでお待ちください', 'warn'); return; }
          healBtn.disabled = true;
          const ok = await withServerLock('役割をファイル名に反映中…', async () => {
            const r = await changeExistingFileRole(f, curPrefix, folderId);
            if (r) await loadExistingFiles(folderId);
            return r;
          });
          if (ok) showToast('🏷 役割をファイル名に反映しました（記事生成に効くようになります）', 'success');
          else healBtn.disabled = false;
        };
        const roleSel = card.querySelector('.ef-role-sel');
        roleSel.addEventListener('change', async () => {
          if (serverBusy) { showToast('いまサーバ通信中です。終わるまでお待ちください', 'warn'); roleSel.value = curPrefix; return; }
          const newPrefix = roleSel.value;
          roleSel.disabled = true;
          const ok = await withServerLock('役割を更新中…', async () => {
            const r = await changeExistingFileRole(f, newPrefix, folderId);
            if (r) await loadExistingFiles(folderId); // 一覧を更新（バッジ・名前を反映）
            return r;
          });
          if (ok) {
            showToast(newPrefix
              ? `🏷 役割を「${(EF_ROLE_OPTIONS.find(o => o.v === newPrefix) || {}).t}」に変更しました`
              : '🏷 役割を解除しました', 'success');
          } else {
            roleSel.value = curPrefix; // 失敗・キャンセル時は元に戻す
            roleSel.disabled = false;
          }
        });
        efGrid.appendChild(card);
      }
    } catch (e) {
      efSummaryStatus.textContent = 'エラー';
      showToast('ファイル一覧取得失敗: ' + (e.message || e), 'error');
    }
  }

  // Drive 画像を GAS経由でフルサイズ取得 → キューに追加（上書きモード）→ AI 編集起動
  // ファイル名の役割プレフィックスから role / 製品番号 / 代表テンプレ を判定
  function parseRoleFromName(name) {
    const n = name || '';
    let m;
    if ((m = /^compare_p(\d+)_/i.exec(n))) return { role: 'compare', compareIndex: Number(m[1]), templateKey: ROLE_TO_TEMPLATE.compare };
    if (/^compare_/i.test(n)) return { role: 'compare', compareIndex: null, templateKey: ROLE_TO_TEMPLATE.compare };
    if (/^comparetable_/i.test(n)) return { role: 'comparetable', compareIndex: null, templateKey: 'compare' };
    const map = { 'eyecatch_': 'eyecatch', 'hero_': 'hero', 'section_': 'section', 'product_': 'product', 'diagram_': 'diagram', 'ngsummary_': 'ngsummary' };
    for (const p in map) {
      if (new RegExp('^' + p, 'i').test(n)) { const role = map[p]; return { role, compareIndex: null, templateKey: ROLE_TO_TEMPLATE[role] || '' }; }
    }
    return { role: 'none', compareIndex: null, templateKey: '' };
  }

  // 既存ファイルの再編集：一時保存に取り込み → 一時保存セクションへ移動 → 一時保存と同じ編集フロー(confirmThenEdit)
  async function editExistingFile(driveFile, engine) {
    if (serverBusy) { showToast('いまサーバ通信中です。終わるまでお待ちください', 'warn'); return; }
    // ① ダウンロードして一時保存へ追加（役割もファイル名から引き継ぐ）
    const item = await withServerLock('「' + driveFile.name + '」を一時保存に取り込み中…', async () => {
      const url = GAS_URL + '?' + new URLSearchParams({
        token: TOKEN, action: 'downloadFile', fileId: driveFile.id,
      }).toString();
      const res = await fetch(url).then(r => r.json());
      if (!res || !res.ok) throw new Error((res && res.message) || 'downloadFile 失敗');
      const bin = atob(res.dataBase64);
      const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      const blob = new Blob([u8], { type: res.mimeType || driveFile.mimeType });
      const ext = (driveFile.name.split('.').pop() || 'png').toLowerCase();
      const r = parseRoleFromName(driveFile.name);
      const it = {
        id: 'edit-' + driveFile.id + '-' + Date.now(),
        blob, mimeType: blob.type, ext, size: blob.size,
        originalName: driveFile.name, createdAt: Date.now(),
        replaceDriveFileId: driveFile.id, // ← 上書き保存マーカー
        role: r.role, compareIndex: r.compareIndex,
        templateKey: r.templateKey, isEyecatch: r.role === 'eyecatch',
      };
      await queuePut(it);
      return it;
    }).catch((e) => { showToast('取込失敗: ' + (e.message || e), 'error'); return null; });
    if (!item) return;
    await renderQueue();
    // ② 一時保存セクションへスクロール移動（既存ファイル一覧は畳む）
    if (existingFilesDetails) existingFilesDetails.open = false;
    const qs = document.getElementById('queue-section');
    if (qs) qs.scrollIntoView({ behavior: 'smooth', block: 'start' });
    showToast('📥 一時保存に取り込みました。このまま用途を選んで編集します', 'success');
    // ③ 一時保存と同じ編集フローへ（つくるもの選択ポップアップ → 編集）
    await confirmThenEdit(item, engine);
  }

  // ── セクション間ジャンプ（既存ファイル ⇄ 一時保存）──
  const btnJumpQueue = $('btn-jump-queue');
  if (btnJumpQueue) btnJumpQueue.addEventListener('click', () => {
    const qs = document.getElementById('queue-section');
    if (qs) qs.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  const btnJumpExisting = $('btn-jump-existing');
  if (btnJumpExisting) btnJumpExisting.addEventListener('click', () => {
    if (existingFilesDetails && !existingFilesDetails.hidden) {
      existingFilesDetails.open = true;
      existingFilesDetails.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      showToast('記事を選ぶと「既存ファイル（再編集）」が表示されます', 'warn');
    }
  });

  btnReloadFiles && btnReloadFiles.addEventListener('click', async () => {
    const folderId = articleSelect.value;
    if (!folderId) { showToast('記事を選択してください', 'warn'); return; }
    // 役割バッジの逆引きに PROMPT.md の役割行が必要なため、メモも先に静かに再読込
    await withServerLock('Driveからファイル一覧を読み込み中…', async () => {
      await loadExistingPrompt(folderId, { silent: true });
      await loadExistingFiles(folderId);
    });
  });

  const btnMemoReload = $('btn-memo-reload');
  btnMemoReload && btnMemoReload.addEventListener('click', async () => {
    const folderId = articleSelect.value;
    if (!folderId) { showToast('記事を選択してください', 'warn'); return; }
    await withServerLock('Driveからメモを読み込み中…', () => loadExistingPrompt(folderId));
  });

  const btnMemoSave = $('btn-memo-save');
  btnMemoSave && btnMemoSave.addEventListener('click', async () => {
    if (serverBusy) { showToast('いまサーバ通信中です。終わるまでお待ちください', 'warn'); return; }
    const folderId = articleSelect.value;
    const title = getSelectedArticleTitle();
    if (!folderId && !title) {
      showToast('記事を選択／作成してください', 'warn');
      return;
    }
    if (!hasPromptData()) {
      showToast('メモが空です（記事タイプ・ポイントを少なくとも1つ入力してください）', 'warn');
      return;
    }
    const original = btnMemoSave.textContent;
    btnMemoSave.disabled = true;
    btnMemoSave.textContent = '保存中…';
    let saved = false;
    try {
      const res = await withServerLock('メモをDriveに保存中…', () => savePromptToDrive(title, folderId));
      console.log('[memo save] response:', res);
      if (!res || (!res.ok && !res.skipped)) {
        throw new Error((res && res.message) || 'savePrompt 失敗');
      }
      if (res.skipped) {
        showToast('メモが空のため保存スキップ', 'warn');
      } else {
        const validCount = getValidMemos().length;
        const articleTypeVal = articleTypeSelect.value || '(未設定)';
        showToast(
          `💾 Driveに保存完了：記事タイプ「${articleTypeVal}」/ メモ${validCount}件 → PROMPT.md`,
          'success'
        );
        saved = true;
      }
    } catch (err) {
      console.error('memo save error:', err);
      showToast('保存失敗: ' + (err.message || err), 'error');
    } finally {
      btnMemoSave.disabled = false;
      if (saved) {
        btnMemoSave.textContent = '✅ 保存済';
        btnMemoSave.classList.add('btn-saved-flash');
        setTimeout(() => {
          btnMemoSave.textContent = original;
          btnMemoSave.classList.remove('btn-saved-flash');
        }, 2500);
      } else {
        btnMemoSave.textContent = original;
      }
    }
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
    // 表示は prefix を外して見やすく（フル名は title 属性で残す）
    const displayName = typeof stripArticlePrefix === 'function' ? stripArticlePrefix(name) : name;
    currentArticleNameEl.textContent = displayName;
    currentArticleNameEl.title = name;
    // 編集モードを閉じる
    currentArticleDisplay.hidden = false;
    currentArticleEditForm.hidden = true;
  }

  // 「【記事】」prefix は GAS 側で自動付与されるので、編集UI上は隠して本体だけ見せる
  const ARTICLE_PREFIX = '【記事】';
  function stripArticlePrefix(name) {
    if (!name) return '';
    while (name.indexOf(ARTICLE_PREFIX) === 0) name = name.substring(ARTICLE_PREFIX.length).trim();
    return name;
  }

  btnRenameArticle && btnRenameArticle.addEventListener('click', () => {
    const cur = getCurrentArticleName();
    if (!cur) { showToast('記事を選択してから変更してください', 'error'); return; }
    // prefix を取り除いて見せる
    renameArticleInput.value = stripArticlePrefix(cur);
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

  let promptLoadSeq = 0; // 🛡 素早い記事切替時、古いfetch結果が後から上書きするのを防ぐ世代カウンタ
  async function loadExistingPrompt(folderId, opts) {
    opts = opts || {};
    const seq = ++promptLoadSeq;
    try {
      const url = GAS_URL + '?' + new URLSearchParams({
        token: TOKEN, action: 'getPrompt', articleFolderId: folderId,
      }).toString();
      const res = await fetch(url).then((r) => r.json());
      if (seq !== promptLoadSeq) return; // 🛡 すでに別の記事へ切替済み → この結果は捨てる
      if (!res.ok || !res.exists) {
        memoFolderId = folderId; // 残っているローカルメモはこの記事の持ち物として扱う
        if (opts.silent !== true) showToast('この記事にはまだメモがありません', 'warn');
        return;
      }
      // 既存メモ上書きの確認は完全廃止（自動マージ）— 必要なら「↻ メモ再読込」を押す形に
      articleTypes = Array.from(new Set([
        ...articleTypes,
        ...(res.articleType ? [res.articleType] : []),
      ]));
      saveArticleTypes();
      renderArticleTypes();
      articleTypeSelect.value = res.articleType || articleTypeSelect.value || '';
      // 🛡 メモ消失防止：Driveのメモで「置き換え」ず、ローカルの書きかけメモを残してマージする
      // （置き換えると、記事選択前に書いたメモが黙って消える事故になる）
      const driveMemos = Array.isArray(res.memos) ? res.memos.slice() : [];
      const localDrafts = getValidMemos().filter(m => !driveMemos.includes(m));
      memos = [...driveMemos, ...localDrafts];
      memoFolderId = folderId; // 🛡 メモの持ち主をこの記事に確定
      persistMemoState();
      memoDirty = localDrafts.length > 0; // Driveと同内容なら「保存済み」扱い
      renderMemos();
      // メモセクションを開く
      const det = document.getElementById('memo-details');
      if (det && !det.open) det.open = true;
      if (opts.silent !== true) showToast('既存メモを読み込みました', 'success');
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

  // ─── メモ⇄画像リンク（メモ文字列の末尾に「｜🖼使う画像: …」を保持）─────────
  const MEMO_IMG_RE = /\s*｜🖼使う画像:\s*(.+)$/;
  function memoBaseText(s) { return String(s || '').replace(MEMO_IMG_RE, '').trim(); }
  function memoLinkedTokens(s) {
    const m = MEMO_IMG_RE.exec(String(s || ''));
    return m ? m[1].split(',').map(t => t.trim()).filter(Boolean) : [];
  }
  function setMemoImages(base, tokens) {
    base = (base || '').trim();
    return tokens && tokens.length ? base + ' ｜🖼使う画像: ' + tokens.join(', ') : base;
  }
  // この記事で使える画像候補（一時保存＋Drive既存）をリンク用トークン付きで集める
  async function gatherAllImageCandidates() {
    const out = [];
    try {
      const all = await queueAll();
      all.forEach((it) => {
        if ((it.mimeType || '').startsWith('video/') || it.mimeType === 'application/pdf') return;
        if (/^compare_sheet_/i.test(it.originalName || '')) return;
        const role = normalizeItemRole(it);
        let token;
        if (role === 'compare') token = '比較 製品' + (it.compareIndex || '?');
        else if (role !== 'none') token = getRoleDef(role).label;
        else token = '一時保存: ' + (it.originalName || '画像').replace(/\.[^.]+$/, '');
        const def = getRoleDef(role);
        out.push({ kind: 'queue', token, label: (role !== 'none' ? def.emoji + def.label : (it.originalName || '画像')), thumb: URL.createObjectURL(it.blob), revoke: true });
      });
      (getSelectedArticleFolderId() ? (lastExistingFiles || []) : []).forEach((f) => {
        if (!(/image/i.test(f.mimeType || '') || /\.(png|jpe?g|webp|gif)$/i.test(f.name || ''))) return;
        const r = parseRoleFromName(f.name);
        const def = getRoleDef(r.role);
        const label = (r.role !== 'none' ? def.emoji + def.label + (r.compareIndex ? (' 製品' + r.compareIndex) : '') : f.name);
        out.push({ kind: 'drive', token: f.name, label, thumb: f.thumbnailUrl || '', revoke: false });
      });
    } catch (e) { console.warn('gatherAllImageCandidates failed:', e); }
    return out;
  }
  // メモに紐づける画像を選ぶピッカー（現在のトークンをプリセット）
  async function pickImagesForMemo(currentTokens) {
    const cands = await gatherAllImageCandidates();
    if (cands.length === 0) {
      showToast('リンクできる画像がありません。一時保存に画像を入れるか、記事を選んで既存ファイルを読み込んでください', 'warn');
      return null;
    }
    const cur = new Set(currentTokens || []);
    const body =
      '<div class="km-cmp-help">このポイントで使う画像を選んでください（複数可）。AIが「どの点にどの画像か」を判断できます。</div>' +
      '<div class="km-cmp-grid">' +
        cands.map((c, i) => {
          const on = cur.has(c.token);
          return '<label class="km-cmp-tile' + (on ? ' is-on' : '') + '" data-i="' + i + '">' +
            '<input type="checkbox" class="km-cmp-chk"' + (on ? ' checked' : '') + '>' +
            '<img src="' + (c.thumb || '') + '" referrerpolicy="no-referrer" alt="">' +
            '<div class="km-cmp-name">' + escHtml(c.label) + '</div>' +
            '<span class="km-cmp-src">' + (c.kind === 'queue' ? '一時保存' : 'Drive') + '</span>' +
          '</label>';
        }).join('') +
      '</div>';
    const res = await openModal({
      title: '🖼 このメモに使う画像を選ぶ',
      bodyHTML: body,
      buttons: [
        { label: 'キャンセル', value: null },
        { label: '✅ 決定', primary: true, onClick: (rootEl) => {
            const picked = [];
            rootEl.querySelectorAll('.km-cmp-tile').forEach((tile) => {
              if (tile.querySelector('.km-cmp-chk').checked) picked.push(cands[Number(tile.dataset.i)].token);
            });
            return { tokens: picked };
          } },
      ],
      onRender: (rootEl) => {
        rootEl.querySelectorAll('.km-cmp-tile').forEach((tile) => {
          const chk = tile.querySelector('.km-cmp-chk');
          const sync = () => tile.classList.toggle('is-on', chk.checked);
          chk.addEventListener('change', sync);
        });
      },
    });
    cands.forEach((c) => { if (c.kind === 'queue' && c.thumb) { try { URL.revokeObjectURL(c.thumb); } catch (_) {} } });
    return res ? res.tokens : null;
  }

  function renderMemos() {
    memoList.innerHTML = '';
    memos.forEach((text, i) => {
      const tokens = memoLinkedTokens(text);
      const chips = tokens.length
        ? '<div class="memo-img-chips">' + tokens.map(t => '<span class="memo-img-chip">🖼 ' + escHtml(t) + '</span>').join('') + '</div>'
        : '';
      const row = document.createElement('div');
      row.className = 'memo-item';
      row.innerHTML =
        '<div class="memo-item-num">' + (i + 1) + '</div>' +
        '<div class="memo-item-main">' +
          '<textarea class="memo-item-text" rows="1" placeholder="例: バッテリー持続が競合比で1.5倍という点を推したい"></textarea>' +
          chips +
          '<button class="memo-link-img" type="button">🖼 画像をリンク' + (tokens.length ? '（' + tokens.length + '）' : '') + '</button>' +
        '</div>' +
        '<div class="memo-item-actions">' +
          '<button class="memo-item-btn up" type="button" aria-label="上へ"' + (i === 0 ? ' disabled' : '') + '>↑</button>' +
          '<button class="memo-item-btn down" type="button" aria-label="下へ"' + (i === memos.length - 1 ? ' disabled' : '') + '>↓</button>' +
          '<button class="memo-item-btn delete" type="button" aria-label="削除">✕</button>' +
        '</div>';
      const ta = row.querySelector('textarea');
      ta.value = memoBaseText(text); // 本文だけ表示（画像リンクはチップで別表示）
      ta.addEventListener('input', () => {
        memos[i] = setMemoImages(ta.value, memoLinkedTokens(memos[i])); // リンクは保持
        persistMemoState();
        updateMemoStatus();
      });
      row.querySelector('.memo-link-img').addEventListener('click', async () => {
        const picked = await pickImagesForMemo(memoLinkedTokens(memos[i]));
        if (picked === null) return;
        memos[i] = setMemoImages(memoBaseText(memos[i]), picked);
        persistMemoState();
        renderMemos();
        showToast(picked.length ? '🖼 画像を' + picked.length + '件リンクしました' : '画像リンクを解除しました', 'success');
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

  // 🛡 メモの持ち主（記事フォルダID）と未保存フラグ。
  // 記事切替時に「前の記事のメモが新しい記事に混入してPROMPT.mdへ書き込まれる」事故を防ぐ。
  let memoFolderId = '';
  let memoDirty = false;
  function persistMemoState() {
    memoFolderId = getSelectedArticleFolderId() || memoFolderId || '';
    const state = {
      articleType: articleTypeSelect.value || '',
      memos: memos,
      folderId: memoFolderId,
    };
    localStorage.setItem(LS_MEMO_STATE_KEY, JSON.stringify(state));
    memoDirty = true;
    updateMemoStatus();
  }
  function loadMemoState() {
    try {
      const raw = localStorage.getItem(LS_MEMO_STATE_KEY);
      if (!raw) return;
      const state = JSON.parse(raw);
      if (state && Array.isArray(state.memos)) memos = state.memos;
      if (state && state.articleType) articleTypeSelect.value = state.articleType;
      if (state && typeof state.folderId === 'string') memoFolderId = state.folderId;
    } catch (_) {}
  }
  function clearMemoState() {
    memos = [];
    articleTypeSelect.value = '';
    memoFolderId = '';
    memoDirty = false;
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
      if (memoDirty) parts.push('●未保存'); // 💾 Drive未保存の変更がある印（保存 or 転送で消える）
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
    const json = await res.json();
    if (json && json.ok) {
      memoDirty = false; // 🛡 Drive保存成功 → 「未保存」表示を解除
      if (json.articleFolderId) memoFolderId = json.articleFolderId;
      updateMemoStatus();
    }
    return json;
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

  // カメラ ON/OFF 電源ボタン（右上）/ OFFマスク（中央のタップで起動ボタン）
  const cameraPowerBtn = document.getElementById('camera-power');
  const cameraOnBtn = document.getElementById('camera-on-btn');
  async function toggleCameraPower(forceOn) {
    const next = (typeof forceOn === 'boolean') ? forceOn : !isCameraEnabled();
    setCameraEnabled(next);
    applyCameraPowerUI();
    if (next) {
      await startCamera();
      showToast('📷 カメラ ON', 'success');
    } else {
      stopCamera();
      setStatus('📷 カメラ OFF（タップで起動）');
      showToast('🌙 カメラを停止しました', 'success');
    }
  }
  cameraPowerBtn && cameraPowerBtn.addEventListener('click', () => toggleCameraPower());
  cameraOnBtn && cameraOnBtn.addEventListener('click', () => toggleCameraPower(true));
  // 初期UI反映
  applyCameraPowerUI();

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
    // 警告・エラーは読む時間を長めに確保（操作指示を含むことが多いため）
    const ms = (kind === 'error' || kind === 'warn') ? 6000 : 3000;
    toastTimer = setTimeout(() => toast.classList.add('hidden'), ms);
  }

  // ─── 初期化 ─────────────────────
  (async () => {
    renderArticleTypes();
    loadMemoState();
    renderMemos();
    // 🛡 前回セッションの「編集中…」残骸をクリア。
    // 置換待機(pendingReplace)はメモリのみで再起動で消えるため、editingWithが残ると
    // バッジが固着し、ペーストが置換でなく新規追加になる（解除手段もない）。
    try {
      const startupItems = await queueAll();
      let cleared = 0;
      for (const it of startupItems) {
        if (it.editingWith) { delete it.editingWith; await queuePut(it); cleared++; }
      }
      if (cleared > 0) console.log(`[startup] 編集中フラグを${cleared}件クリア`);
    } catch (e) { console.warn('startup editingWith cleanup failed:', e); }
    await renderQueue();
    await loadArticleList();
    // 前回選択していた記事を復元（リロード後もメモ・ファイル一覧が継続）
    try {
      const lastFolder = localStorage.getItem(LS_LAST_FOLDER_KEY);
      if (lastFolder && Array.from(articleSelect.options).some(o => o.value === lastFolder)) {
        articleSelect.value = lastFolder;
        await loadExistingPrompt(lastFolder, { silent: true });
        await loadExistingFiles(lastFolder);
        updateCurrentArticleDisplay();
      }
    } catch (e) { console.warn('restore last article failed:', e); }
    // 初期はライブカメラ
    await startCamera();
    setStatus('準備完了');
  })();
})();
