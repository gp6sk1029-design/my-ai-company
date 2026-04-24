/**
 * 献立くん（料理レシピ献立アプリ）
 * - PWA・Vanilla JS・IndexedDB
 * - Gemini 2.5 Flash で献立生成 / Gemini Vision で食材認識
 * - 社内ルール（CLAUDE.md）の生産技術思考に準拠：ムダ排除・数値判断・再現性・費用対効果
 */
(() => {
  'use strict';

  const CONFIG = window.COOKING_APP_CONFIG || {};
  const GENERATE_URL = CONFIG.GENERATE_URL || '/api/generate';
  const DETECT_URL = CONFIG.DETECT_URL || '/api/detect-ingredients';
  const DEFAULTS = CONFIG.DEFAULTS || {};
  const MAX_EDGE = CONFIG.MAX_IMAGE_EDGE_PX || 1280;

  // ============ IndexedDB ============
  const DB_NAME = 'cooking-app';
  const DB_VER = 2; // v2: syncMeta store 追加・updatedAt/deletedAt 導入
  const STORES = ['household', 'members', 'recipes', 'cookHistory', 'shopping', 'stock', 'generations'];
  // D1 と同期する対象ストア（generations は端末ローカルのみ）
  const SYNC_STORES = ['members', 'recipes', 'cookHistory', 'shopping', 'stock'];

  let dbInstance = null;

  function openDB() {
    if (dbInstance) return Promise.resolve(dbInstance);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        const tx = e.target.transaction;
        if (!db.objectStoreNames.contains('household')) db.createObjectStore('household', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('members')) db.createObjectStore('members', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('recipes')) db.createObjectStore('recipes', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('cookHistory')) db.createObjectStore('cookHistory', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('shopping')) db.createObjectStore('shopping', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('stock')) db.createObjectStore('stock', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('generations')) db.createObjectStore('generations', { keyPath: 'hash' });
        if (!db.objectStoreNames.contains('syncMeta')) db.createObjectStore('syncMeta', { keyPath: 'id' });

        // v1 → v2 マイグレーション: 既存レコードに updatedAt を付与（次回同期で push されるように）
        if (e.oldVersion < 2) {
          const now = Math.floor(Date.now() / 1000);
          for (const s of SYNC_STORES) {
            const os = tx.objectStore(s);
            os.openCursor().onsuccess = (ev) => {
              const cur = ev.target.result;
              if (!cur) return;
              const v = cur.value || {};
              if (typeof v.updatedAt !== 'number') v.updatedAt = now;
              if (!('deletedAt' in v)) v.deletedAt = null;
              cur.update(v);
              cur.continue();
            };
          }
        }
      };
      req.onsuccess = () => { dbInstance = req.result; resolve(dbInstance); };
      req.onerror = () => reject(req.error);
    });
  }

  const nowSec = () => Math.floor(Date.now() / 1000);

  async function dbAll(store, { includeDeleted = false } = {}) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const req = db.transaction(store, 'readonly').objectStore(store).getAll();
      req.onsuccess = () => {
        const all = req.result || [];
        resolve(includeDeleted ? all : all.filter(r => !r.deletedAt));
      };
      req.onerror = () => reject(req.error);
    });
  }

  async function dbGet(store, id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const req = db.transaction(store, 'readonly').objectStore(store).get(id);
      req.onsuccess = () => {
        const r = req.result || null;
        resolve(r && r.deletedAt ? null : r);
      };
      req.onerror = () => reject(req.error);
    });
  }

  // dbPut: 通常の書き込み。updatedAt を現在時刻に更新して、同期デバウンスを起動する。
  // 内部同期取り込み時は dbPutRaw を使う（updatedAt を保持）
  async function dbPut(store, obj) {
    if (SYNC_STORES.includes(store) || store === 'household') {
      obj.updatedAt = nowSec();
      if (!('deletedAt' in obj)) obj.deletedAt = null;
    }
    const result = await dbPutRaw(store, obj);
    if (SYNC_STORES.includes(store) || store === 'household') {
      scheduleSync();
    }
    return result;
  }

  async function dbPutRaw(store, obj) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const req = db.transaction(store, 'readwrite').objectStore(store).put(obj);
      req.onsuccess = () => resolve(obj);
      req.onerror = () => reject(req.error);
    });
  }

  // 同期対象ストアは論理削除（deletedAt をセット）、それ以外（generations）は物理削除
  async function dbDelete(store, id) {
    if (SYNC_STORES.includes(store)) {
      // 論理削除
      const db = await openDB();
      const tx = db.transaction(store, 'readwrite');
      const os = tx.objectStore(store);
      return new Promise((resolve, reject) => {
        const g = os.get(id);
        g.onsuccess = () => {
          const r = g.result;
          if (!r) return resolve();
          r.deletedAt = nowSec();
          r.updatedAt = nowSec();
          const p = os.put(r);
          p.onsuccess = () => { scheduleSync(); resolve(); };
          p.onerror = () => reject(p.error);
        };
        g.onerror = () => reject(g.error);
      });
    }
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const req = db.transaction(store, 'readwrite').objectStore(store).delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async function dbClear(store) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const req = db.transaction(store, 'readwrite').objectStore(store).clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  // ============ ユーティリティ ============
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random().toString(36).slice(2));
  const todayStr = () => new Date().toISOString().slice(0, 10);
  const MEAL_LABEL = { breakfast: '🌅 朝', lunch: '🍱 昼', dinner: '🌙 夜' };

  function toast(msg, type = '') {
    const el = $('#toast');
    el.textContent = msg;
    el.className = 'toast ' + type;
    setTimeout(() => { el.classList.add('hidden'); }, 2500);
  }

  function showLoading(text = '処理中...') {
    $('#loading-text').textContent = text;
    $('#loading').classList.remove('hidden');
  }
  function hideLoading() { $('#loading').classList.add('hidden'); }

  // 食材名の正規化（買い物リスト集約用）
  function normalizeName(name) {
    return String(name || '')
      .replace(/[ \u3000]/g, '')
      .replace(/[ぁ-ん]/g, s => String.fromCharCode(s.charCodeAt(0) + 0x60))
      .toLowerCase()
      .trim();
  }

  // seasonal.json のキャッシュ
  let seasonalCache = null;
  async function loadSeasonal() {
    if (seasonalCache) return seasonalCache;
    const res = await fetch('/data/seasonal.json');
    seasonalCache = await res.json();
    return seasonalCache;
  }

  async function seasonalForMonth(month) {
    const data = await loadSeasonal();
    const m = data[String(month)];
    if (!m) return [];
    return [...(m.vegetables || []), ...(m.fish || []), ...(m.fruits || []), ...(m.other || [])];
  }

  // ============ 画像縮小（Gemini Vision 送信前） ============
  async function resizeImageBlob(blob) {
    const img = await createImageBitmap(blob);
    const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
    const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d').drawImage(img, 0, 0, w, h);
    return await new Promise(r => canvas.toBlob(b => r(b), 'image/jpeg', 0.82));
  }

  function blobToBase64(blob) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result).split(',')[1]);
      r.onerror = rej;
      r.readAsDataURL(blob);
    });
  }

  // ============ 状態 ============
  const state = {
    generationMode: 'params', // 'params' | 'camera'
    selected: {
      days: DEFAULTS.days || 3,
      mealTypes: [...(DEFAULTS.mealTypes || ['dinner'])],
      maxCookTimeMin: DEFAULTS.maxCookTimeMin || 20,
      mood: DEFAULTS.moodTag || 'normal',
      cuisine: 'any', // any/japanese/chinese/western/italian/korean/ethnic/donburi/mixed
      basicIngredientsOnly: true,
      useCommercialSauces: true, // Cook Do・うちのごはん等を許可
      batchShopping: true,
      useStock: false,
      budgetYen: DEFAULTS.budgetYen || 1500,
    },
    currentGeneration: null, // { days: [...], totalBudgetYen, notes }
    fridgeQueue: [], // [{id, blob, dataUrl}]
    detectedIngredients: [], // [{name, estimatedAmount, category, confidence, storage, selected}]
    cameraStream: null,
    cameraFacing: 'environment',
    recipeFilter: 'all',
  };

  // ============ タブ切替 ============
  function switchPage(name) {
    $$('.page').forEach(p => p.classList.remove('active'));
    const target = $('#page-' + name);
    if (target) target.classList.add('active');
    $$('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.page === name));
    // 画面遷移時に再描画が必要なもの
    if (name === 'recipes') renderRecipes();
    if (name === 'shopping') renderShopping();
    if (name === 'stock') renderStock();
    if (name === 'settings') renderMembers();
    // カメラは離れるときに停止
    if (name !== 'home' && state.cameraStream) stopCamera();
  }

  $$('.tab-btn').forEach(btn => btn.addEventListener('click', () => switchPage(btn.dataset.page)));

  // ============ ホーム：モード切替 ============
  $('#mode-params').addEventListener('click', () => setGenerationMode('params'));
  $('#mode-camera').addEventListener('click', () => setGenerationMode('camera'));

  function setGenerationMode(m) {
    state.generationMode = m;
    $('#mode-params').classList.toggle('active', m === 'params');
    $('#mode-camera').classList.toggle('active', m === 'camera');
    $('#mode-params-panel').classList.toggle('hidden', m !== 'params');
    $('#mode-camera-panel').classList.toggle('hidden', m !== 'camera');
    if (m !== 'camera' && state.cameraStream) stopCamera();
  }

  // ============ チップ選択 ============
  function wireChipGroup(containerId, key, multi = false) {
    $(containerId).addEventListener('click', (e) => {
      const btn = e.target.closest('.chip');
      if (!btn) return;
      const v = btn.dataset.value;
      const chips = $$('.chip', $(containerId));
      if (multi) {
        btn.classList.toggle('active');
        const activeValues = chips.filter(c => c.classList.contains('active')).map(c => c.dataset.value);
        state.selected[key] = activeValues;
        if (activeValues.length === 0) {
          // 少なくとも1つは選択状態にする
          btn.classList.add('active');
          state.selected[key] = [v];
        }
      } else {
        chips.forEach(c => c.classList.remove('active'));
        btn.classList.add('active');
        const num = Number(v);
        state.selected[key] = isNaN(num) ? v : num;
      }
    });
  }

  wireChipGroup('#chip-days', 'days', false);
  wireChipGroup('#chip-meals', 'mealTypes', true);
  wireChipGroup('#chip-time', 'maxCookTimeMin', false);
  wireChipGroup('#chip-mood', 'mood', false);
  wireChipGroup('#chip-cuisine', 'cuisine', false);

  $('#toggle-basic').addEventListener('change', (e) => state.selected.basicIngredientsOnly = e.target.checked);
  $('#toggle-commercial').addEventListener('change', (e) => state.selected.useCommercialSauces = e.target.checked);
  $('#toggle-batch').addEventListener('change', (e) => state.selected.batchShopping = e.target.checked);
  $('#toggle-usestock').addEventListener('change', (e) => state.selected.useStock = e.target.checked);
  $('#input-budget').addEventListener('input', (e) => state.selected.budgetYen = Number(e.target.value) || 1500);

  // ============ カメラ ============
  async function startCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: state.cameraFacing, width: { ideal: 1920 }, height: { ideal: 1440 } },
        audio: false,
      });
      state.cameraStream = stream;
      const video = $('#camera-video');
      video.srcObject = stream;
      await video.play();
      $('#camera-container').classList.remove('hidden');
      $('#btn-camera-start').classList.add('hidden');
    } catch (err) {
      toast('カメラの起動に失敗しました: ' + err.message, 'error');
    }
  }

  function stopCamera() {
    if (state.cameraStream) {
      state.cameraStream.getTracks().forEach(t => t.stop());
      state.cameraStream = null;
    }
    $('#camera-container').classList.add('hidden');
    $('#btn-camera-start').classList.remove('hidden');
  }

  async function shoot() {
    const video = $('#camera-video');
    if (!video || video.videoWidth === 0) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    const blob = await new Promise(r => canvas.toBlob(b => r(b), 'image/jpeg', 0.9));
    const resized = await resizeImageBlob(blob);
    const dataUrl = URL.createObjectURL(resized);
    state.fridgeQueue.push({ id: uid(), blob: resized, dataUrl });
    renderFridgeQueue();
  }

  function renderFridgeQueue() {
    const container = $('#fridge-queue');
    const card = $('#fridge-queue-card');
    container.innerHTML = '';
    state.fridgeQueue.forEach(item => {
      const div = document.createElement('div');
      div.className = 'fridge-queue-item';
      div.innerHTML = `<img src="${item.dataUrl}" alt=""><button class="delete-btn" data-id="${item.id}">×</button>`;
      container.appendChild(div);
    });
    $('#fridge-queue-count').textContent = state.fridgeQueue.length;
    card.style.display = state.fridgeQueue.length > 0 ? '' : 'none';
  }

  $('#btn-camera-start').addEventListener('click', startCamera);
  $('#btn-shutter').addEventListener('click', shoot);
  $('#btn-flip').addEventListener('click', async () => {
    state.cameraFacing = (state.cameraFacing === 'environment') ? 'user' : 'environment';
    stopCamera();
    startCamera();
  });
  $('#fridge-queue').addEventListener('click', (e) => {
    const btn = e.target.closest('.delete-btn');
    if (!btn) return;
    const id = btn.dataset.id;
    const idx = state.fridgeQueue.findIndex(i => i.id === id);
    if (idx >= 0) {
      URL.revokeObjectURL(state.fridgeQueue[idx].dataUrl);
      state.fridgeQueue.splice(idx, 1);
    }
    renderFridgeQueue();
  });

  // ============ 食材認識（Gemini Vision） ============
  $('#btn-detect').addEventListener('click', async () => {
    if (state.fridgeQueue.length === 0) {
      toast('先に冷蔵庫を撮影してください', 'error');
      return;
    }
    showLoading('食材を認識中...');
    try {
      const images = await Promise.all(state.fridgeQueue.map(async (item) => ({
        mimeType: 'image/jpeg',
        data: await blobToBase64(item.blob),
      })));
      const res = await fetch(DETECT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ images }),
      });
      if (!res.ok) {
        const err = await res.text();
        throw new Error('認識失敗: ' + res.status + ' ' + err);
      }
      const data = await res.json();
      if (!data.ingredients || data.ingredients.length === 0) {
        toast('食材が認識できませんでした。別の角度で撮影してみてください', 'error');
        hideLoading();
        return;
      }
      state.detectedIngredients = data.ingredients.map(i => ({ ...i, selected: (i.confidence ?? 1) >= 0.5 }));
      $('#detect-notes').textContent = data.notes || '';
      renderDetectList();
      $('#detect-modal').classList.remove('hidden');
    } catch (e) {
      console.error(e);
      toast('認識エラー: ' + e.message, 'error');
    } finally {
      hideLoading();
    }
  });

  function renderDetectList() {
    const container = $('#detect-list');
    container.innerHTML = '';
    state.detectedIngredients.forEach((ing, idx) => {
      const conf = Math.round((ing.confidence ?? 1) * 100);
      const low = conf < 60;
      const row = document.createElement('div');
      row.className = 'detected-ingredient' + (low ? ' low-conf' : '');
      row.innerHTML = `
        <input type="checkbox" data-idx="${idx}" ${ing.selected ? 'checked' : ''}>
        <div class="di-name">${ing.name}</div>
        <div class="di-amount">${ing.estimatedAmount || ''}</div>
        <div class="conf">${conf}%</div>
      `;
      container.appendChild(row);
    });
  }

  $('#detect-list').addEventListener('change', (e) => {
    const cb = e.target.closest('input[type=checkbox]');
    if (!cb) return;
    const idx = Number(cb.dataset.idx);
    state.detectedIngredients[idx].selected = cb.checked;
  });

  $('#btn-detect-cancel').addEventListener('click', () => $('#detect-modal').classList.add('hidden'));

  $('#btn-detect-confirm').addEventListener('click', async () => {
    const picked = state.detectedIngredients.filter(i => i.selected);
    if (picked.length === 0) { toast('食材を1つ以上選んでください', 'error'); return; }
    // 在庫に保存
    const now = Date.now();
    for (const ing of picked) {
      await dbPut('stock', {
        id: uid(),
        name: ing.name,
        estimatedAmount: ing.estimatedAmount || '',
        category: ing.category || '',
        confidence: ing.confidence ?? null,
        storage: ing.storage || 'fridge',
        detectedAt: now,
        source: 'camera',
      });
    }
    $('#detect-modal').classList.add('hidden');
    // そのまま献立生成
    await generateMenu({ stockOverride: picked });
  });

  // ============ 献立生成（Gemini） ============
  $('#btn-generate').addEventListener('click', () => generateMenu());

  async function generateMenu(opts = {}) {
    const members = await dbAll('members');
    if (members.length === 0) {
      toast('まず家族タブで家族メンバーを追加してください', 'error');
      switchPage('settings');
      return;
    }
    showLoading('献立を生成中...（10〜30秒）');
    try {
      const month = new Date().getMonth() + 1;
      const seasonalHint = await seasonalForMonth(month);
      const recipes = await dbAll('recipes');
      const cookHistory = await dbAll('cookHistory');

      // favorites: 直近180日で評価4以上、ブロックされてない、最大20件
      const NOW = Date.now();
      const DAY = 86400000;
      const favorites = recipes
        .filter(r => !r.blocked && (r.rating || 0) >= 4)
        .filter(r => !r.lastCookedAt || (NOW - r.lastCookedAt) < 180 * DAY)
        .sort((a, b) => (b.rating || 0) - (a.rating || 0))
        .slice(0, 20)
        .map(r => ({
          name: r.title,
          rating: r.rating,
          cookCount: r.cookCount || 0,
          lastCookedAt: r.lastCookedAt ? new Date(r.lastCookedAt).toISOString().slice(0, 10) : null,
          seasonalTag: r.seasonalTag || null,
        }));

      // recentlyCooked: 直近14日
      const recentlyCooked = cookHistory
        .filter(h => (NOW - h.cookedAt) < 14 * DAY)
        .map(h => recipes.find(r => r.id === h.recipeId))
        .filter(Boolean)
        .map(r => r.title);

      // blocked
      const blocked = recipes.filter(r => r.blocked).map(r => r.title);

      // 在庫食材
      let stockIngredients = [];
      if (opts.stockOverride) {
        stockIngredients = opts.stockOverride.map(i => ({
          name: i.name, estimatedAmount: i.estimatedAmount || '', storage: i.storage || 'fridge',
        }));
      } else if (state.selected.useStock) {
        const stock = await dbAll('stock');
        stockIngredients = stock.map(i => ({ name: i.name, estimatedAmount: i.estimatedAmount, storage: i.storage }));
      }

      const household = (await dbGet('household', 'default')) || {};
      const avoidMode = household.avoidMode || 'any';

      const payload = {
        month,
        members: members.map(m => ({
          name: m.name || '名無し',
          kind: m.kind || 'adult',
          age: m.age || null,
          allergies: m.allergies || [],
          dislikes: m.dislikes || [],
          likes: m.likes || [],
        })),
        householdAllergies: [...new Set(members.flatMap(m => m.allergies || []))],
        avoidMode,
        budgetYen: state.selected.budgetYen,
        maxCookTimeMin: state.selected.maxCookTimeMin,
        moodTag: state.selected.mood,
        cuisine: state.selected.cuisine,
        seasonalHint,
        days: state.selected.days,
        mealTypes: state.selected.mealTypes,
        basicIngredientsOnly: state.selected.basicIngredientsOnly,
        useCommercialSauces: state.selected.useCommercialSauces,
        batchShopping: state.selected.batchShopping,
        favorites,
        recentlyCooked,
        blocked,
        stockIngredients,
        stockPriority: opts.stockOverride ? true : state.selected.useStock,
      };

      const res = await fetch(GENERATE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.text();
        throw new Error('生成失敗: ' + res.status + ' ' + err);
      }
      const result = await res.json();

      // アレルギー再チェック（クライアント側ダブルチェック）
      const allergies = payload.householdAllergies.map(a => normalizeName(a));
      let allergyViolated = false;
      if (result.days) {
        for (const d of result.days) {
          for (const m of Object.values(d.meals || {})) {
            for (const ing of (m.ingredients || [])) {
              if (allergies.some(a => normalizeName(ing.name).includes(a))) {
                allergyViolated = true;
                break;
              }
            }
          }
        }
      }
      if (allergyViolated) {
        toast('⚠️ アレルギー食材が混入したため再生成します', 'error');
        // リトライ1回のみ（ここでは簡略化のためエラー表示のみ）
        throw new Error('アレルギー食材が含まれました。再度お試しください。');
      }

      state.currentGeneration = result;
      renderGeneratedMenus(result);
    } catch (e) {
      console.error(e);
      toast(e.message || '生成に失敗しました', 'error');
    } finally {
      hideLoading();
    }
  }

  function timeBadgeClass(min) {
    if (min <= 10) return 'time-green';
    if (min <= 20) return 'time-yellow';
    return 'time-red';
  }

  function cuisineLabel(c) {
    const map = {
      japanese: '🍙 和食', chinese: '🥡 中華', western: '🍖 洋食',
      italian: '🍝 イタリアン', korean: '🍜 韓国', ethnic: '🌶️ エスニック',
      donburi: '🍚 丼・麺',
    };
    return map[c] || c;
  }

  function renderGeneratedMenus(result) {
    const container = $('#menu-list');
    container.innerHTML = '';
    const dateBase = new Date();
    const WEEK_JA = '日月火水木金土';
    const numDays = result.days.length;

    // 1週間以上なら週間サマリーを最上部に表示
    if (numDays >= 5) {
      const endDate = new Date(dateBase);
      endDate.setDate(endDate.getDate() + numDays - 1);
      const totalMeals = result.days.reduce((acc, d) => acc + Object.keys(d.meals || {}).length, 0);
      const totalBudget = result.totalBudgetYen || '-';
      const summary = document.createElement('div');
      summary.className = 'card';
      summary.style.cssText = 'background:linear-gradient(135deg,#dcfce7,#bbf7d0);border:1px solid #86efac;';
      summary.innerHTML = `
        <div style="font-size:13px;font-weight:800;color:var(--accent-deep);margin-bottom:4px;">📅 ${numDays}日間の献立プラン</div>
        <div style="font-size:18px;font-weight:800;color:var(--text);margin-bottom:6px;">
          ${dateBase.getMonth() + 1}/${dateBase.getDate()}（${WEEK_JA[dateBase.getDay()]}）
          〜 ${endDate.getMonth() + 1}/${endDate.getDate()}（${WEEK_JA[endDate.getDay()]}）
        </div>
        <div style="display:flex;gap:14px;font-size:13px;color:var(--text-secondary);flex-wrap:wrap;">
          <span>🍽️ ${totalMeals}食</span>
          <span>💰 合計目安 ¥${typeof totalBudget === 'number' ? totalBudget.toLocaleString() : totalBudget}</span>
        </div>
      `;
      container.appendChild(summary);
    }

    result.days.forEach((day, dayIdx) => {
      const date = new Date(dateBase);
      date.setDate(date.getDate() + dayIdx);
      const dayOfWeek = WEEK_JA[date.getDay()];
      const dayLabel = `${date.getMonth() + 1}/${date.getDate()}（${dayOfWeek}）`;
      const isWeekend = date.getDay() === 0 || date.getDay() === 6;

      // 日付の区切りヘッダー
      const dayHeader = document.createElement('div');
      dayHeader.style.cssText = `margin:16px 0 8px;padding:6px 12px;background:${isWeekend ? 'rgba(239,68,68,0.08)' : 'rgba(22,163,74,0.08)'};border-radius:10px;font-size:13px;font-weight:800;color:${isWeekend ? '#dc2626' : 'var(--accent-deep)'};display:flex;align-items:center;gap:8px;`;
      dayHeader.innerHTML = `<span style="font-size:15px;">📅</span><span>${dayLabel}</span><span style="margin-left:auto;font-size:11px;color:var(--text-muted);font-weight:600;">Day ${dayIdx + 1}/${numDays}</span>`;
      container.appendChild(dayHeader);

      ['breakfast', 'lunch', 'dinner'].forEach(mealKey => {
        const meal = day.meals && day.meals[mealKey];
        if (!meal) return;
        const card = document.createElement('div');
        card.className = 'menu-card';
        card.dataset.dayIndex = day.dayIndex;
        card.dataset.mealType = mealKey;
        const timeCls = timeBadgeClass(meal.cookTimeMin || 20);
        const badges = [];
        badges.push(`<span class="badge ${timeCls}">⏱ ${meal.cookTimeMin || '?'}分</span>`);
        if (meal.servings) badges.push(`<span class="badge">👥 ${meal.servings}人分</span>`);
        if (meal.cuisine) badges.push(`<span class="badge">${cuisineLabel(meal.cuisine)}</span>`);
        if (meal.isFavorite) badges.push(`<span class="badge favorite">⭐ お気に入り再登場</span>`);
        if (meal.useLeftover) badges.push(`<span class="badge leftover">♻️ 使い切り</span>`);
        if (meal.usesCommercialSauce) badges.push(`<span class="badge commercial">🏷️ 市販品使用</span>`);
        if (meal.cookwareHint) badges.push(`<span class="badge">🍳 ${meal.cookwareHint}</span>`);

        const ingredientsHTML = (meal.ingredients || []).map(i =>
          `<div>・${i.name} <span style="color:var(--text-muted)">${i.amount || ''}${i.unit || ''}${i.shelfLifeDays ? '（日持ち'+i.shelfLifeDays+'日）' : ''}</span></div>`
        ).join('');
        const stepsHTML = (meal.steps || []).map(s => `<li>${s}</li>`).join('');

        card.innerHTML = `
          <div class="menu-card-header">
            <div>
              <div class="menu-card-day-meal">${dayLabel} ・ ${MEAL_LABEL[mealKey] || mealKey}</div>
              <div class="menu-card-title">${meal.name || '無題'}</div>
            </div>
          </div>
          <div class="menu-card-badges">${badges.join('')}</div>
          <div class="menu-card-section">
            <h4>材料（${meal.servings || '?'}人分）</h4>
            <div class="menu-card-ingredients">${ingredientsHTML}</div>
          </div>
          <div class="menu-card-section">
            <h4>作り方</h4>
            <ol class="menu-card-steps">${stepsHTML}</ol>
          </div>
          ${meal.seasonalReason ? `<div class="menu-card-note">🌱 ${meal.seasonalReason}</div>` : ''}
          ${meal.favoriteReason ? `<div class="menu-card-note">⭐ ${meal.favoriteReason}</div>` : ''}
          <div class="menu-card-actions">
            <button class="btn-secondary" data-act="save">📖 レシピ保存</button>
            <button class="btn-secondary" data-act="shopping">🛒 買い物追加</button>
          </div>
        `;
        // イベント
        card.querySelector('[data-act="save"]').addEventListener('click', () => saveMealAsRecipe(meal));
        card.querySelector('[data-act="shopping"]').addEventListener('click', () => addMealToShopping(meal, { dayIndex: day.dayIndex, mealKey, dayLabel }));
        container.appendChild(card);
      });
    });
    if (result.notes) {
      const note = document.createElement('div');
      note.style.cssText = 'font-size:12px;color:var(--text-muted);padding:8px 4px;font-style:italic';
      note.textContent = '💡 ' + result.notes;
      container.appendChild(note);
    }
    $('#generated-menus').classList.remove('hidden');
    // スクロール
    setTimeout(() => $('#generated-menus').scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
  }

  async function saveMealAsRecipe(meal) {
    const recipe = {
      id: uid(),
      title: meal.name,
      category: meal.category || '',
      cookTimeMin: meal.cookTimeMin || 20,
      servings: meal.servings || 2,
      ingredients: meal.ingredients || [],
      steps: meal.steps || [],
      seasonalReason: meal.seasonalReason || '',
      cookwareHint: meal.cookwareHint || '',
      createdAt: Date.now(),
      rating: null,
      cookCount: 0,
      lastCookedAt: null,
      blocked: false,
    };
    await dbPut('recipes', recipe);
    toast('レシピを保存しました', 'success');
  }

  async function addMealToShopping(meal, source) {
    const shopping = await dbAll('shopping');
    const existingByKey = new Map();
    for (const item of shopping) existingByKey.set(normalizeName(item.name) + '|' + (item.unit || ''), item);

    for (const ing of (meal.ingredients || [])) {
      const key = normalizeName(ing.name) + '|' + (ing.unit || '');
      const srcTag = `${source.dayLabel}${MEAL_LABEL[source.mealKey] || ''}：${meal.name}`;
      if (existingByKey.has(key)) {
        const ex = existingByKey.get(key);
        ex.amount = (Number(ex.amount) || 0) + (Number(ing.amount) || 0);
        ex.sources = [...new Set([...(ex.sources || []), srcTag])];
        await dbPut('shopping', ex);
      } else {
        const item = {
          id: uid(),
          name: ing.name,
          amount: ing.amount || '',
          unit: ing.unit || '',
          shelfLifeDays: ing.shelfLifeDays || null,
          storage: ing.storage || 'fridge',
          checked: false,
          sources: [srcTag],
          createdAt: Date.now(),
        };
        await dbPut('shopping', item);
        existingByKey.set(key, item);
      }
    }
    toast('買い物リストに追加しました', 'success');
  }

  $('#btn-save-all').addEventListener('click', async () => {
    if (!state.currentGeneration) return;
    let count = 0;
    for (const day of state.currentGeneration.days) {
      for (const meal of Object.values(day.meals || {})) {
        if (meal && meal.name) { await saveMealAsRecipe(meal); count++; }
      }
    }
    toast(`${count}件のレシピを保存しました`, 'success');
  });

  $('#btn-add-all-shopping').addEventListener('click', async () => {
    if (!state.currentGeneration) return;
    // 在庫食材を除外
    let stockNames = new Set();
    if (state.selected.useStock) {
      const stock = await dbAll('stock');
      stockNames = new Set(stock.map(s => normalizeName(s.name)));
    }
    const dateBase = new Date();
    let added = 0;
    for (let dIdx = 0; dIdx < state.currentGeneration.days.length; dIdx++) {
      const day = state.currentGeneration.days[dIdx];
      const date = new Date(dateBase); date.setDate(date.getDate() + dIdx);
      const dayLabel = `${date.getMonth() + 1}/${date.getDate()}`;
      for (const mealKey of Object.keys(day.meals || {})) {
        const meal = day.meals[mealKey];
        if (!meal) continue;
        const filtered = {
          ...meal,
          ingredients: (meal.ingredients || []).filter(i => !stockNames.has(normalizeName(i.name))),
        };
        if (filtered.ingredients.length > 0) {
          await addMealToShopping(filtered, { dayIndex: day.dayIndex, mealKey, dayLabel });
          added++;
        }
      }
    }
    toast(`買い物リストへ集約（${added}メニュー分）`, 'success');
    switchPage('shopping');
  });

  // ============ レシピ画面 ============
  $$('.recipe-filter').forEach(btn => btn.addEventListener('click', () => {
    $$('.recipe-filter').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.recipeFilter = btn.dataset.filter;
    renderRecipes();
  }));
  $('#recipe-search').addEventListener('input', renderRecipes);

  async function renderRecipes() {
    const all = await dbAll('recipes');
    const q = normalizeName($('#recipe-search').value);
    const list = all.filter(r => {
      if (state.recipeFilter === 'favorite' && (!r.rating || r.rating < 4)) return false;
      if (state.recipeFilter === 'blocked' && !r.blocked) return false;
      if (state.recipeFilter === 'all' && r.blocked) return false;
      if (q) {
        const inTitle = normalizeName(r.title).includes(q);
        const inIng = (r.ingredients || []).some(i => normalizeName(i.name).includes(q));
        if (!inTitle && !inIng) return false;
      }
      return true;
    });
    const container = $('#recipe-list');
    container.innerHTML = '';
    if (list.length === 0) {
      $('#recipe-empty').classList.remove('hidden');
      return;
    }
    $('#recipe-empty').classList.add('hidden');
    list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    for (const r of list) {
      const item = document.createElement('div');
      item.className = 'recipe-item' + (r.blocked ? ' blocked' : '');
      const stars = r.rating ? '⭐'.repeat(r.rating) : '';
      const lastCooked = r.lastCookedAt ? new Date(r.lastCookedAt).toLocaleDateString('ja-JP') : '未調理';
      item.innerHTML = `
        <div class="recipe-item-title">${r.title}</div>
        <div class="recipe-item-meta">
          <span>⏱ ${r.cookTimeMin || '?'}分</span>
          <span>🍳 ${r.cookCount || 0}回</span>
          <span>📅 ${lastCooked}</span>
          <span>${stars}</span>
        </div>
      `;
      item.addEventListener('click', () => openRecipeModal(r));
      container.appendChild(item);
    }
  }

  function openRecipeModal(r) {
    const ingredientsHTML = (r.ingredients || []).map(i => `<div>・${i.name} ${i.amount || ''}${i.unit || ''}</div>`).join('');
    const stepsHTML = (r.steps || []).map(s => `<li>${s}</li>`).join('');
    $('#recipe-modal-body').innerHTML = `
      <div class="modal-title">${r.title}</div>
      <div class="menu-card-badges">
        <span class="badge ${timeBadgeClass(r.cookTimeMin || 20)}">⏱ ${r.cookTimeMin || '?'}分</span>
        <span class="badge">👥 ${r.servings || '?'}人分</span>
        <span class="badge">🍳 ${r.cookCount || 0}回調理</span>
      </div>
      <div class="menu-card-section"><h4>材料</h4><div class="menu-card-ingredients">${ingredientsHTML}</div></div>
      <div class="menu-card-section"><h4>作り方</h4><ol class="menu-card-steps">${stepsHTML}</ol></div>
      ${r.seasonalReason ? `<div class="menu-card-note">🌱 ${r.seasonalReason}</div>` : ''}
      <div style="margin-top:14px;">
        <div style="font-size:13px;font-weight:700;color:var(--text-secondary);margin-bottom:4px;">評価</div>
        <div class="rating-buttons">
          <button class="rating-btn ${r.rating===1?'active':''}" data-rating="1">👎 いまいち</button>
          <button class="rating-btn ${r.rating===3?'active':''}" data-rating="3">🙂 普通</button>
          <button class="rating-btn ${r.rating===5?'active':''}" data-rating="5">⭐ 美味しい</button>
        </div>
      </div>
      <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap;">
        <button id="btn-cooked" class="btn-primary" style="flex:2">🍳 今日 作った！</button>
        <button id="btn-block-toggle" class="btn-danger" style="flex:1">${r.blocked ? '🔓 除外解除' : '👎 今後除外'}</button>
        <button id="btn-delete-recipe" class="btn-danger" style="width:100%">🗑️ 削除</button>
      </div>
    `;
    $$('#recipe-modal-body .rating-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        r.rating = Number(btn.dataset.rating);
        if (r.rating === 1) r.blocked = true;
        await dbPut('recipes', r);
        openRecipeModal(r);
        renderRecipes();
      });
    });
    $('#btn-cooked').addEventListener('click', async () => {
      r.cookCount = (r.cookCount || 0) + 1;
      r.lastCookedAt = Date.now();
      await dbPut('recipes', r);
      await dbPut('cookHistory', {
        id: uid(),
        recipeId: r.id,
        cookedAt: Date.now(),
        rating: r.rating || null,
        memo: '',
      });
      toast('今日の調理を記録しました', 'success');
      openRecipeModal(r);
      renderRecipes();
    });
    $('#btn-block-toggle').addEventListener('click', async () => {
      r.blocked = !r.blocked;
      await dbPut('recipes', r);
      openRecipeModal(r);
      renderRecipes();
    });
    $('#btn-delete-recipe').addEventListener('click', async () => {
      if (!confirm('このレシピを削除しますか？')) return;
      await dbDelete('recipes', r.id);
      closeModal('recipe-modal');
      renderRecipes();
    });
    $('#recipe-modal').classList.remove('hidden');
  }

  // ============ 買い物リスト ============
  async function renderShopping() {
    const items = await dbAll('shopping');
    const container = $('#shopping-list');
    container.innerHTML = '';
    if (items.length === 0) {
      $('#shopping-empty').classList.remove('hidden');
      return;
    }
    $('#shopping-empty').classList.add('hidden');

    // 保存方法×日持ちでグループ化
    const groups = {
      urgent: { label: '🔴 要早消費（3日未満）', items: [] },
      fridge: { label: '🟡 冷蔵（3〜7日）', items: [] },
      freezer: { label: '🔵 冷凍可', items: [] },
      room: { label: '🟢 常温・日持ち長', items: [] },
    };
    for (const it of items) {
      const sl = it.shelfLifeDays;
      if (it.storage === 'freezer') groups.freezer.items.push(it);
      else if (sl && sl < 3) groups.urgent.items.push(it);
      else if (it.storage === 'fridge' || (sl && sl < 7)) groups.fridge.items.push(it);
      else groups.room.items.push(it);
    }
    const order = ['urgent', 'fridge', 'freezer', 'room'];
    for (const k of order) {
      const g = groups[k];
      if (g.items.length === 0) continue;
      const wrap = document.createElement('div');
      wrap.className = `shopping-group storage-${k}`;
      wrap.innerHTML = `<div class="shopping-group-header">${g.label}（${g.items.length}件）</div>`;
      g.items.sort((a, b) => (a.checked ? 1 : -1) - (b.checked ? 1 : -1));
      for (const it of g.items) {
        const row = document.createElement('label');
        row.className = 'shopping-item' + (it.checked ? ' checked' : '');
        const srcLabel = (it.sources || []).length > 0 ? `<span class="item-sources">${(it.sources || []).slice(0, 2).join(' / ')}</span>` : '';
        row.innerHTML = `
          <input type="checkbox" ${it.checked ? 'checked' : ''}>
          <div class="shopping-item-text">
            <span class="item-name">${it.name}</span>
            ${it.amount ? `<span class="item-amount">${it.amount}${it.unit || ''}</span>` : ''}
            ${srcLabel}
          </div>
          <button class="btn-danger" style="padding:6px 10px;font-size:12px;" data-del-id="${it.id}">🗑</button>
        `;
        row.querySelector('input').addEventListener('change', async (e) => {
          it.checked = e.target.checked;
          await dbPut('shopping', it);
          renderShopping();
        });
        row.querySelector('[data-del-id]').addEventListener('click', async (e) => {
          e.preventDefault();
          await dbDelete('shopping', it.id);
          renderShopping();
        });
        wrap.appendChild(row);
      }
      container.appendChild(wrap);
    }
  }

  $('#btn-share-shopping').addEventListener('click', async () => {
    const items = await dbAll('shopping');
    if (items.length === 0) return;
    const text = items.filter(i => !i.checked).map(i => `・${i.name} ${i.amount || ''}${i.unit || ''}`).join('\n');
    try {
      if (navigator.share) await navigator.share({ title: '買い物リスト', text });
      else {
        await navigator.clipboard.writeText(text);
        toast('買い物リストをコピーしました', 'success');
      }
    } catch {}
  });
  $('#btn-clear-checked').addEventListener('click', async () => {
    const items = await dbAll('shopping');
    for (const it of items) if (it.checked) await dbDelete('shopping', it.id);
    renderShopping();
    toast('チェック済みを削除しました', 'success');
  });
  $('#btn-clear-all').addEventListener('click', async () => {
    if (!confirm('買い物リストを全削除しますか？')) return;
    // 論理削除（D1 同期時に他端末にも削除が伝播する）
    const items = await dbAll('shopping');
    for (const it of items) await dbDelete('shopping', it.id);
    renderShopping();
  });

  // ============ 在庫（冷蔵庫）タブ ============
  async function renderStock() {
    const items = await dbAll('stock');
    const container = $('#stock-list');
    container.innerHTML = '';
    if (items.length === 0) {
      $('#stock-empty').classList.remove('hidden');
      return;
    }
    $('#stock-empty').classList.add('hidden');
    items.sort((a, b) => (a.expiresAt || Infinity) - (b.expiresAt || Infinity));
    const storageLabel = { room: '🟢 常温', fridge: '🟡 冷蔵', freezer: '🔵 冷凍' };
    for (const it of items) {
      const row = document.createElement('div');
      row.className = 'shopping-item';
      const exp = it.expiresAt ? `〜${new Date(it.expiresAt).toLocaleDateString('ja-JP')}` : '';
      row.innerHTML = `
        <div class="shopping-item-text">
          <span class="item-name">${it.name}</span>
          ${it.estimatedAmount ? `<span class="item-amount">${it.estimatedAmount}</span>` : ''}
          <span class="item-sources">${storageLabel[it.storage] || ''} ${exp} ${it.source === 'camera' ? '📷認識' : ''}</span>
        </div>
        <button class="btn-danger" style="padding:6px 10px;font-size:12px;" data-del-id="${it.id}">🗑</button>
      `;
      row.querySelector('[data-del-id]').addEventListener('click', async () => {
        await dbDelete('stock', it.id);
        renderStock();
      });
      container.appendChild(row);
    }
  }

  $('#btn-add-stock').addEventListener('click', () => {
    $('#stock-name').value = '';
    $('#stock-amount').value = '';
    $('#stock-storage').value = 'fridge';
    $('#stock-expires').value = '';
    $('#stock-modal').classList.remove('hidden');
  });
  $('#btn-stock-save').addEventListener('click', async () => {
    const name = $('#stock-name').value.trim();
    if (!name) { toast('食材名を入力してください', 'error'); return; }
    const exp = $('#stock-expires').value;
    await dbPut('stock', {
      id: uid(),
      name,
      estimatedAmount: $('#stock-amount').value.trim(),
      storage: $('#stock-storage').value,
      expiresAt: exp ? new Date(exp).getTime() : null,
      detectedAt: Date.now(),
      source: 'manual',
    });
    closeModal('stock-modal');
    renderStock();
    toast('追加しました', 'success');
  });

  // ============ 家族メンバー ============
  async function renderMembers() {
    const members = await dbAll('members');
    const container = $('#members-list');
    container.innerHTML = '';
    for (const m of members) container.appendChild(createMemberCard(m));
    // avoid mode
    const household = (await dbGet('household', 'default')) || { id: 'default', avoidMode: 'any' };
    $('#avoid-mode').value = household.avoidMode || 'any';
  }

  function createMemberCard(m) {
    const card = document.createElement('div');
    card.className = 'member-card';
    card.innerHTML = `
      <div class="member-card-head">
        <input class="member-name-input" value="${m.name || ''}" placeholder="名前（例: たろう）" data-field="name">
        <button class="member-delete-btn" title="削除">🗑</button>
      </div>
      <div class="member-row">
        <label>区分</label>
        <select data-field="kind">
          <option value="adult" ${m.kind === 'adult' ? 'selected' : ''}>大人</option>
          <option value="child" ${m.kind === 'child' ? 'selected' : ''}>子供</option>
        </select>
      </div>
      <div class="member-row">
        <label>年齢</label>
        <input type="number" data-field="age" value="${m.age || ''}" placeholder="歳" min="0" max="120">
      </div>
      <div class="member-row">
        <label>🚨 アレルギー</label>
        <div class="tag-input-wrap" data-field="allergies"></div>
      </div>
      <div class="member-row">
        <label>😖 嫌い</label>
        <div class="tag-input-wrap" data-field="dislikes"></div>
      </div>
      <div class="member-row">
        <label>😋 好き</label>
        <div class="tag-input-wrap" data-field="likes"></div>
      </div>
    `;
    // タグ入力
    ['allergies', 'dislikes', 'likes'].forEach(field => {
      const wrap = card.querySelector(`.tag-input-wrap[data-field="${field}"]`);
      renderTagsInto(wrap, m[field] || []);
      wrap.addEventListener('keydown', async (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const input = wrap.querySelector('input');
        const val = input.value.trim();
        if (!val) return;
        m[field] = [...(m[field] || []), val];
        input.value = '';
        renderTagsInto(wrap, m[field]);
        await dbPut('members', m);
      });
      wrap.addEventListener('click', async (e) => {
        const x = e.target.closest('.x');
        if (!x) return;
        const tag = x.dataset.tag;
        m[field] = (m[field] || []).filter(t => t !== tag);
        renderTagsInto(wrap, m[field]);
        await dbPut('members', m);
      });
    });
    // 基本フィールド
    ['name', 'kind', 'age'].forEach(field => {
      const input = card.querySelector(`[data-field="${field}"]`);
      input.addEventListener('change', async () => {
        m[field] = field === 'age' ? Number(input.value) || null : input.value;
        await dbPut('members', m);
      });
      if (field === 'name') {
        input.addEventListener('blur', async () => {
          m[field] = input.value;
          await dbPut('members', m);
        });
      }
    });
    card.querySelector('.member-delete-btn').addEventListener('click', async () => {
      if (!confirm(`${m.name || 'このメンバー'}を削除しますか？`)) return;
      await dbDelete('members', m.id);
      renderMembers();
    });
    return card;
  }

  function renderTagsInto(wrap, tags) {
    wrap.innerHTML = '';
    for (const t of tags) {
      const chip = document.createElement('span');
      chip.className = 'mini-chip';
      chip.innerHTML = `${t}<span class="x" data-tag="${t}">×</span>`;
      wrap.appendChild(chip);
    }
    const input = document.createElement('input');
    input.placeholder = '入力してEnterで追加';
    wrap.appendChild(input);
  }

  $('#btn-add-member').addEventListener('click', async () => {
    const m = { id: uid(), name: '', kind: 'adult', age: null, allergies: [], dislikes: [], likes: [] };
    await dbPut('members', m);
    renderMembers();
  });

  $('#avoid-mode').addEventListener('change', async (e) => {
    const household = (await dbGet('household', 'default')) || { id: 'default' };
    household.avoidMode = e.target.value;
    await dbPut('household', household);
  });

  // ============ データ管理 ============
  $('#btn-export').addEventListener('click', async () => {
    const data = {};
    for (const s of STORES) data[s] = await dbAll(s);
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `kondate-backup-${todayStr()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  $('#btn-import').addEventListener('click', () => $('#import-file').click());
  $('#import-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      for (const s of STORES) {
        if (Array.isArray(data[s])) {
          for (const obj of data[s]) await dbPut(s, obj);
        }
      }
      toast('インポートしました', 'success');
      renderMembers(); renderRecipes(); renderShopping(); renderStock();
    } catch (err) {
      toast('読み込み失敗: ' + err.message, 'error');
    }
  });

  $('#btn-reset').addEventListener('click', async () => {
    if (!confirm('全データを削除します。同期中の世帯からも退出します。よろしいですか？')) return;
    // 同期を止めるためにまず世帯IDをクリア
    await setSyncMeta({ householdId: null, lastSyncAt: 0 });
    // 全ストアを物理削除（既に世帯から抜けているので D1 から引き戻されない）
    for (const s of STORES) await dbClear(s);
    toast('全データを削除しました', 'success');
    renderMembers(); renderRecipes(); renderShopping(); renderStock(); renderSyncUI();
  });

  // ============ モーダル共通 ============
  $$('[data-close-modal]').forEach(btn => btn.addEventListener('click', () => closeModal(btn.dataset.closeModal)));
  function closeModal(id) { $('#' + id).classList.add('hidden'); }

  // ============ D1 同期マネージャ ============
  const SYNC_URL = '/api/sync';
  let syncDebounceTimer = null;
  let syncInFlight = false;

  async function getSyncMeta() {
    const db = await openDB();
    return new Promise((resolve) => {
      const req = db.transaction('syncMeta', 'readonly').objectStore('syncMeta').get('default');
      req.onsuccess = () => resolve(req.result || { id: 'default', householdId: null, lastSyncAt: 0 });
      req.onerror = () => resolve({ id: 'default', householdId: null, lastSyncAt: 0 });
    });
  }
  async function setSyncMeta(meta) {
    meta.id = 'default';
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const req = db.transaction('syncMeta', 'readwrite').objectStore('syncMeta').put(meta);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  // 32文字のランダム世帯ID（暗号学的ランダム）
  function generateHouseholdId() {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  }

  function scheduleSync() {
    if (syncDebounceTimer) clearTimeout(syncDebounceTimer);
    syncDebounceTimer = setTimeout(() => { sync().catch(e => console.warn('sync error', e)); }, 3000);
  }

  async function sync(opts = {}) {
    const meta = await getSyncMeta();
    if (!meta.householdId) return { skipped: true, reason: '世帯ID未設定' };
    if (syncInFlight) return { skipped: true, reason: '同期実行中' };
    syncInFlight = true;
    updateSyncStatus('同期中...');
    try {
      const since = meta.lastSyncAt || 0;

      // ローカルで since 以降に変更されたレコードを集める
      const changes = {};
      for (const s of SYNC_STORES) {
        const all = await dbAll(s, { includeDeleted: true });
        changes[s] = all
          .filter(r => (r.updatedAt || 0) > since)
          .map(r => ({
            id: r.id,
            payload: JSON.stringify(r),
            updatedAt: r.updatedAt || nowSec(),
            deletedAt: r.deletedAt || null,
          }));
      }
      // household 単一レコード
      const hh = await dbGet('household', 'default');
      if (hh && (hh.updatedAt || 0) > since) {
        changes.household = {
          avoidMode: hh.avoidMode || 'any',
          updatedAt: hh.updatedAt || nowSec(),
          deletedAt: hh.deletedAt || null,
        };
      }

      const res = await fetch(SYNC_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ householdId: meta.householdId, since, changes }),
      });
      if (!res.ok) {
        const err = await res.text();
        throw new Error('同期失敗: ' + res.status + ' ' + err.slice(0, 200));
      }
      const data = await res.json();

      // サーバーから返ってきた変更を取り込む
      let applied = 0;
      for (const s of SYNC_STORES) {
        const incoming = data.changes[s] || [];
        for (const row of incoming) {
          let localObj = null;
          try {
            const db = await openDB();
            localObj = await new Promise((resolve) => {
              const req = db.transaction(s, 'readonly').objectStore(s).get(row.id);
              req.onsuccess = () => resolve(req.result || null);
              req.onerror = () => resolve(null);
            });
          } catch {}
          if (localObj && (localObj.updatedAt || 0) >= row.updatedAt) continue; // ローカルの方が新しい
          let parsed;
          try { parsed = JSON.parse(row.payload); }
          catch { continue; }
          parsed.id = row.id;
          parsed.updatedAt = row.updatedAt;
          parsed.deletedAt = row.deletedAt;
          await dbPutRaw(s, parsed);
          applied++;
        }
      }
      // household
      if (data.changes.household) {
        const srv = data.changes.household;
        const local = await dbGet('household', 'default');
        if (!local || (local.updatedAt || 0) < srv.updatedAt) {
          await dbPutRaw('household', {
            id: 'default',
            avoidMode: srv.avoidMode || 'any',
            updatedAt: srv.updatedAt,
            deletedAt: srv.deletedAt || null,
          });
          applied++;
        }
      }

      meta.lastSyncAt = data.now;
      await setSyncMeta(meta);

      updateSyncStatus(`✅ 同期完了（${new Date().toLocaleTimeString('ja-JP')}）${applied > 0 ? ' / ' + applied + '件を取り込み' : ''}`);
      if (applied > 0) {
        renderMembers(); renderRecipes(); renderShopping(); renderStock();
      }
      return { applied };
    } catch (e) {
      console.error(e);
      updateSyncStatus('⚠️ 同期エラー: ' + e.message);
      throw e;
    } finally {
      syncInFlight = false;
    }
  }

  async function createHousehold() {
    const id = generateHouseholdId();
    await setSyncMeta({ householdId: id, lastSyncAt: 0 });
    toast('新しい世帯を作成しました', 'success');
    await sync();
    renderSyncUI();
  }

  async function joinHousehold(id) {
    const cleaned = String(id || '').trim();
    if (!/^[A-Za-z0-9_-]{24,64}$/.test(cleaned)) {
      toast('世帯IDが不正です（24〜64文字の英数字/-_）', 'error');
      return;
    }
    if (!confirm('この端末のローカルデータは、同期先の世帯データと統合されます。続行しますか？')) return;
    await setSyncMeta({ householdId: cleaned, lastSyncAt: 0 });
    toast('世帯に参加中...', 'success');
    try {
      await sync();
      toast('同期完了', 'success');
    } catch (e) {
      toast('同期に失敗: ' + e.message, 'error');
    }
    renderSyncUI();
  }

  async function leaveHousehold() {
    if (!confirm('世帯から退出します（ローカルデータは残ります）。よろしいですか？')) return;
    await setSyncMeta({ householdId: null, lastSyncAt: 0 });
    toast('退出しました', 'success');
    renderSyncUI();
  }

  function updateSyncStatus(text) {
    const el = $('#sync-status');
    if (el) el.textContent = text;
  }

  async function renderSyncUI() {
    const meta = await getSyncMeta();
    const display = $('#household-id-display');
    const join = $('#household-join');
    if (meta.householdId) {
      display.style.display = '';
      join.style.display = 'none';
      $('#household-id-value').value = meta.householdId;
      updateSyncStatus(meta.lastSyncAt
        ? `最終同期: ${new Date(meta.lastSyncAt * 1000).toLocaleString('ja-JP')}`
        : '初回同期待ち');
    } else {
      display.style.display = 'none';
      join.style.display = '';
      updateSyncStatus('同期は無効。「新しい世帯を作成」または「参加」してください。');
    }
  }

  // UI ボタン
  $('#btn-create-household').addEventListener('click', () => createHousehold());
  $('#btn-join-household').addEventListener('click', () => {
    const v = $('#household-join-input').value;
    joinHousehold(v);
  });
  $('#btn-leave-household').addEventListener('click', () => leaveHousehold());
  $('#btn-sync-now').addEventListener('click', async () => {
    try { await sync(); toast('同期完了', 'success'); }
    catch (e) { toast(e.message, 'error'); }
  });
  $('#btn-copy-household-id').addEventListener('click', async () => {
    const v = $('#household-id-value').value;
    try {
      await navigator.clipboard.writeText(v);
      toast('世帯IDをコピーしました', 'success');
    } catch {
      $('#household-id-value').select();
    }
  });

  // ============ 初期化 ============
  async function init() {
    await openDB();
    // household 初期値
    const h = await dbGet('household', 'default');
    if (!h) await dbPut('household', { id: 'default', avoidMode: 'any' });
    // 家族0人なら初期ダイアログ的に家族タブへ
    const members = await dbAll('members');
    if (members.length === 0) {
      switchPage('settings');
      toast('まず家族メンバーを追加してください', '');
    }
    renderMembers();
    renderSyncUI();
    // 起動時に同期（世帯ID があれば）
    setTimeout(() => { sync().catch(() => {}); }, 500);
  }

  init().catch(err => {
    console.error(err);
    toast('初期化に失敗しました: ' + err.message, 'error');
  });

})();
