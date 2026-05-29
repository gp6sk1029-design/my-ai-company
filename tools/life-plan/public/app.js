/**
 * ライフプランくん アプリ本体
 * Vanilla JS / IndexedDB / Chart.js
 * 計算ロジックは calc.js に分離（window.LIFEPLAN_CALC）
 */
(() => {
  'use strict';

  const CONFIG = window.LIFEPLAN_CONFIG || {};
  const CALC = window.LIFEPLAN_CALC;
  const D = CONFIG.DEFAULTS || {};

  // ============ IndexedDB ============
  const DB_NAME = 'life-plan';
  const DB_VER = 1;
  const STORES = ['household', 'members', 'income', 'expense', 'education', 'assets', 'events', 'mfSnapshots'];
  let dbInstance = null;
  const nowSec = () => Math.floor(Date.now() / 1000);
  const uid = () => 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);

  function openDB() {
    if (dbInstance) return Promise.resolve(dbInstance);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        for (const s of STORES) {
          if (!db.objectStoreNames.contains(s)) {
            const keyPath = s === 'household' ? 'id' : 'id';
            db.createObjectStore(s, { keyPath });
          }
        }
      };
      req.onsuccess = () => { dbInstance = req.result; resolve(dbInstance); };
      req.onerror = () => reject(req.error);
    });
  }

  async function dbAll(store) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const req = db.transaction(store, 'readonly').objectStore(store).getAll();
      req.onsuccess = () => resolve((req.result || []).filter(r => !r.deletedAt));
      req.onerror = () => reject(req.error);
    });
  }

  async function dbGet(store, id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const req = db.transaction(store, 'readonly').objectStore(store).get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async function dbPut(store, obj) {
    obj.updatedAt = nowSec();
    if (!('deletedAt' in obj)) obj.deletedAt = null;
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const req = db.transaction(store, 'readwrite').objectStore(store).put(obj);
      req.onsuccess = () => resolve(obj);
      req.onerror = () => reject(req.error);
    });
  }

  async function dbDelete(store, id) {
    const obj = await dbGet(store, id);
    if (!obj) return;
    obj.deletedAt = nowSec();
    obj.updatedAt = nowSec();
    return dbPut(store, obj);
  }

  // ============ ヘルパー ============
  const yen = (n) => {
    if (n === 0) return '¥0';
    const abs = Math.abs(n);
    let s;
    if (abs >= 100000000) s = (n / 100000000).toFixed(2) + '億';
    else if (abs >= 10000) s = (n / 10000).toFixed(0) + '万';
    else s = n.toLocaleString();
    return (n < 0 ? '-' : '') + '¥' + s.replace('-', '');
  };
  const yenFull = (n) => '¥' + Math.round(n).toLocaleString();
  const $ = (id) => document.getElementById(id);
  const el = (tag, attrs = {}, children = []) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') e.className = v;
      else if (k === 'html') e.innerHTML = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v);
    }
    for (const c of (Array.isArray(children) ? children : [children])) {
      if (c == null) continue;
      e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
    return e;
  };

  // ============ モーダルフォーム ============
  // openForm({title, fields, values}) → Promise<values | null>
  //   fields: [{key, label, type, default?, options?, hint?, min?, max?, step?}]
  //   type: 'text'|'number'|'select'|'percent' (percent は%表示↔小数で自動変換)
  //
  //   「%表示↔小数」の変換が必要な理由：
  //   UIでは「1.5%」と入力するが、DBには 0.015 で保存するから。
  //   呼び出し側が values[key] を渡すときは既に小数を渡す（保存形）
  //   表示に回すときだけ percent フィールドが *100 して、保存時に /100 する。
  function openForm({ title, fields, values = {} }) {
    return new Promise((resolve) => {
      const backdrop = $('modal-backdrop');
      const body = $('modal-body');
      $('modal-title').textContent = title;
      body.innerHTML = '';

      const inputs = {};
      for (const f of fields) {
        const row = el('div', { class: 'form-row' });
        row.appendChild(el('label', { class: 'lbl' }, f.label));
        let input;
        const initValue = values[f.key] !== undefined ? values[f.key] : f.default;
        if (f.type === 'select') {
          input = el('select');
          for (const opt of f.options) {
            const o = el('option', { value: opt.value }, opt.label);
            if (String(opt.value) === String(initValue)) o.selected = true;
            input.appendChild(o);
          }
        } else if (f.type === 'percent') {
          input = el('input', { type: 'number', step: f.step ?? '0.1' });
          if (initValue !== undefined && initValue !== null) input.value = (Number(initValue) * 100).toFixed(2).replace(/\.?0+$/, '');
        } else if (f.type === 'number') {
          input = el('input', { type: 'number', inputmode: 'numeric' });
          if (f.step) input.step = f.step;
          if (f.min !== undefined) input.min = f.min;
          if (f.max !== undefined) input.max = f.max;
          if (initValue !== undefined && initValue !== null) input.value = initValue;
        } else {
          input = el('input', { type: 'text' });
          if (initValue !== undefined && initValue !== null) input.value = initValue;
        }
        inputs[f.key] = { el: input, type: f.type };
        row.appendChild(input);
        if (f.hint) row.appendChild(el('div', { class: 'hint' }, f.hint));
        body.appendChild(row);
      }

      backdrop.classList.remove('hidden');
      // 最初の入力にフォーカス
      setTimeout(() => {
        const first = Object.values(inputs)[0];
        if (first) first.el.focus();
      }, 50);

      const cleanup = () => {
        backdrop.classList.add('hidden');
        $('modal-save').onclick = null;
        $('modal-cancel').onclick = null;
        $('modal-close').onclick = null;
        backdrop.onclick = null;
      };
      const onCancel = () => { cleanup(); resolve(null); };
      const onSave = () => {
        const result = {};
        for (const [key, { el: inp, type }] of Object.entries(inputs)) {
          if (type === 'percent') {
            const n = parseFloat(inp.value);
            result[key] = isNaN(n) ? 0 : n / 100;
          } else if (type === 'number') {
            const n = parseFloat(inp.value);
            result[key] = isNaN(n) ? 0 : n;
          } else {
            result[key] = inp.value;
          }
        }
        cleanup();
        resolve(result);
      };

      $('modal-save').onclick = onSave;
      $('modal-cancel').onclick = onCancel;
      $('modal-close').onclick = onCancel;
      backdrop.onclick = (e) => { if (e.target === backdrop) onCancel(); };
    });
  }

  // ============ 状態 ============
  let educationDataset = null;
  let eventTemplates = null;
  let chartAssets = null;

  async function loadStaticData() {
    const [eduRes, evtRes] = await Promise.all([
      fetch('/data/education-costs.json').then(r => r.json()),
      fetch('/data/life-events.json').then(r => r.json())
    ]);
    educationDataset = eduRes;
    eventTemplates = evtRes;
  }

  // ============ 使い方モーダル ============
  function openHelp() {
    const backdrop = $('modal-backdrop');
    const body = $('modal-body');
    $('modal-title').textContent = '❓ 使い方';
    body.innerHTML = `
      <div class="help-section">
        <h3>💡 このツールでできること</h3>
        <p>現在年齢〜想定寿命までの<b>家計キャッシュフロー</b>と<b>資産推移</b>を可視化し、老後資金の枯渇リスクを数値で把握します。新NISA・特定口座・個別株/暗号の複利を税引き後で自動計算します。</p>
      </div>

      <div class="help-section">
        <h3>🚀 初回セットアップ（推奨順）</h3>
        <ol>
          <li><span class="tag">1</span><b>基本</b>タブ → 年齢・退職予定・想定寿命・子供を登録</li>
          <li><span class="tag">2</span><b>収支</b>タブ → 年収と月額支出を年齢区間で追加</li>
          <li><span class="tag">3</span><b>教育</b>タブ → 子供ごとの進路（公立/私立）を選択</li>
          <li><span class="tag">4</span><b>資産</b>タブ → 口座を追加（MFスクショor一括棚卸しで残高更新）</li>
          <li><span class="tag">5</span><b>イベント</b>タブ → 車買替・旅行などテンプレから追加</li>
          <li><span class="tag">6</span><b>ホーム</b>タブ → CF表・グラフ・枯渇年齢を確認</li>
        </ol>
      </div>

      <div class="help-section">
        <h3>✏️ 編集・削除</h3>
        <p>登録した項目の<b>白いカード部分をタップ</b>すると編集モーダルが開きます。右側の「削除」ボタンは確認後に消去します。</p>
      </div>

      <div class="help-section">
        <h3>📈 投資の複利計算</h3>
        <ul>
          <li><b>新NISA</b>：つみたて＋成長で生涯1,800万円非課税。上限を超えた積立は自動で特定口座へ回ります</li>
          <li><b>特定口座</b>：運用中は複利、取崩時に譲渡益20.315%を控除</li>
          <li><b>個別株・暗号資産</b>：シナリオ（強気+12% / 中立+5% / 弱気-3%）で切替可能</li>
        </ul>
      </div>

      <div class="help-section">
        <h3>🏦 マネーフォワード連携（2方式）</h3>
        <p><b>⚠️ 前提：</b>MFは「資産残高のCSV出力」に対応していません（家計簿CSVのみ）。そこでライフプランくんでは以下の2方式で対応しています。</p>
        <ul>
          <li><b>📸 スクショOCR取込（資産タブ）</b>：MFアプリの「資産」画面スクショをドロップ → 端末内でOCR処理 → 差分プレビュー → 残高反映。画像は外部に送信されません</li>
          <li><b>🔄 一括棚卸しモード（資産タブ）</b>：OCRが失敗した時の現実解。全口座を一画面で順に手入力。前回残高からの差分（±円/±%）を自動表示</li>
          <li><b>📥 家計簿CSV取込（収支タブ）</b>：MFの家計簿CSV（MFアプリ→家計簿→CSV書出）を投入 → 振替を除外→大項目×月で集計 → 直近3ヶ月平均で「支出」項目を実績ベースに更新</li>
        </ul>
      </div>

      <div class="help-section">
        <h3>🔒 データの保存先</h3>
        <p>すべての入力は<b>端末のブラウザ内（IndexedDB）</b>に保存されます。クラウドには送信されません。スマホのPWAとしてホーム画面に追加すればアプリのように使えます。</p>
      </div>

      <div class="help-section">
        <h3>💡 見方のコツ</h3>
        <ul>
          <li>ホーム上部の「資産枯渇リスク」が「枯渇なし」ならOK、年齢が出ていたら対策が必要</li>
          <li>CF表で赤字年（薄いピンク）は支出見直しのサイン</li>
          <li>グラフの積み上げは口座別、青い太線が純資産合計</li>
        </ul>
      </div>
    `;
    // Save/Cancelは不要、閉じるのみ
    $('modal-save').textContent = '閉じる';
    $('modal-cancel').style.display = 'none';
    const close = () => {
      backdrop.classList.add('hidden');
      $('modal-save').textContent = '保存';
      $('modal-cancel').style.display = '';
      $('modal-save').onclick = null;
      $('modal-close').onclick = null;
      backdrop.onclick = null;
    };
    $('modal-save').onclick = close;
    $('modal-close').onclick = close;
    backdrop.onclick = (e) => { if (e.target === backdrop) close(); };
    backdrop.classList.remove('hidden');
  }

  $('btn-help').addEventListener('click', openHelp);

  // ============ タブ切替 ============
  function switchPage(pageKey) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    const page = $('page-' + pageKey);
    const btn = document.querySelector(`.tab-btn[data-page="${pageKey}"]`);
    if (page) page.classList.add('active');
    if (btn) btn.classList.add('active');
    if (pageKey === 'home') renderHome();
  }

  document.querySelectorAll('.tab-btn').forEach(b => {
    b.addEventListener('click', () => switchPage(b.dataset.page));
  });

  // ============ 基本情報タブ ============
  async function loadBasic() {
    const hh = await dbGet('household', 'singleton');
    if (hh) {
      $('in-self-age').value = hh.selfAge ?? 35;
      $('in-retire-age').value = hh.retireAge ?? 65;
      $('in-lifespan').value = hh.lifespan ?? 95;
      $('in-spouse-age').value = hh.spouseAge ?? 0;
    }
    renderChildren();
  }

  async function saveBasic() {
    const hh = {
      id: 'singleton',
      selfAge: parseInt($('in-self-age').value) || 35,
      retireAge: parseInt($('in-retire-age').value) || 65,
      lifespan: parseInt($('in-lifespan').value) || 95,
      spouseAge: parseInt($('in-spouse-age').value) || 0
    };
    await dbPut('household', hh);
    alert('保存しました');
    renderHome();
  }

  async function renderChildren() {
    const children = (await dbAll('members')).filter(m => m.kind === 'child');
    const box = $('list-children');
    box.innerHTML = '';
    if (children.length === 0) {
      box.appendChild(el('div', { class: 'empty' }, '子供は未登録'));
      return;
    }
    for (const c of children) {
      const row = el('div', { class: 'item' });
      const main = el('div', { class: 'item-main', style: 'cursor:pointer;', onclick: () => editChild(c) });
      const thisYear = new Date().getFullYear();
      const age = thisYear - (c.birthYear || thisYear);
      main.appendChild(el('div', { class: 'item-title' }, `${c.name || '子供'}（${age}歳）`));
      main.appendChild(el('div', { class: 'item-sub' }, `${c.birthYear || '—'}年生まれ  ✏️ タップで編集`));
      row.appendChild(main);
      row.appendChild(el('button', {
        class: 'btn small danger',
        onclick: async () => {
          if (!confirm(`${c.name} を削除しますか？`)) return;
          await dbDelete('members', c.id); await dbDelete('education', c.id);
          renderChildren(); renderEducation();
        }
      }, '削除'));
      box.appendChild(row);
    }
  }

  async function addChild() { return editChild(null); }

  async function editChild(existing) {
    const isNew = !existing;
    const result = await openForm({
      title: isNew ? '子供を追加' : '子供を編集',
      fields: [
        { key: 'name', label: '名前', type: 'text', default: '子1' },
        { key: 'birthYear', label: '生まれ年（西暦）', type: 'number', default: new Date().getFullYear() - 5, min: 1950, max: new Date().getFullYear() }
      ],
      values: existing ? { name: existing.name, birthYear: existing.birthYear } : {}
    });
    if (!result) return;
    if (!result.birthYear) return;
    const id = existing?.id || uid();
    await dbPut('members', { id, kind: 'child', name: result.name || '子', birthYear: parseInt(result.birthYear) });
    if (isNew) {
      await dbPut('education', {
        id, childId: id,
        plan: { pre: 'public', es: 'public', jhs: 'public', hs: 'public', univ: 'public' },
        juku: 'light'
      });
    }
    renderChildren();
    renderEducation();
    renderHome();
  }

  $('btn-save-basic').addEventListener('click', saveBasic);
  $('btn-add-child').addEventListener('click', addChild);

  // ============ 収支タブ ============
  async function renderIncomes() {
    const list = await dbAll('income');
    const box = $('list-incomes');
    box.innerHTML = '';
    if (list.length === 0) {
      box.appendChild(el('div', { class: 'empty' }, '未登録'));
      return;
    }
    for (const inc of list) {
      const row = el('div', { class: 'item' });
      const main = el('div', { class: 'item-main', style: 'cursor:pointer;', onclick: () => editIncome(inc) });
      main.appendChild(el('div', { class: 'item-title' }, `${inc.label || '収入'}：${yen(inc.annualAmount)}/年`));
      main.appendChild(el('div', { class: 'item-sub' }, `${inc.fromAge}〜${inc.toAge}歳  上昇率${((inc.growthRate || 0) * 100).toFixed(1)}%  ✏️ タップで編集`));
      row.appendChild(main);
      row.appendChild(el('button', {
        class: 'btn small danger',
        onclick: async () => {
          if (!confirm(`${inc.label} を削除しますか？`)) return;
          await dbDelete('income', inc.id); renderIncomes(); renderHome();
        }
      }, '削除'));
      box.appendChild(row);
    }
  }

  async function addIncome() { return editIncome(null); }

  async function editIncome(existing) {
    const result = await openForm({
      title: existing ? '収入を編集' : '収入を追加',
      fields: [
        { key: 'label', label: 'ラベル', type: 'text', default: '給与', hint: '例：給与・副業・年金・配偶者給与' },
        { key: 'annualAmount', label: '年収（円）', type: 'number', default: 5000000 },
        { key: 'fromAge', label: '開始年齢', type: 'number', default: 35 },
        { key: 'toAge', label: '終了年齢', type: 'number', default: 65 },
        { key: 'growthRate', label: '年間上昇率（%）', type: 'percent', default: 0.015, hint: '昇給・年金スライド想定' }
      ],
      values: existing
    });
    if (!result) return;
    await dbPut('income', {
      id: existing?.id || uid(),
      label: result.label || '収入',
      annualAmount: parseInt(result.annualAmount) || 0,
      fromAge: parseInt(result.fromAge) || 0,
      toAge: parseInt(result.toAge) || 65,
      growthRate: result.growthRate
    });
    renderIncomes();
    renderHome();
  }

  async function renderExpenses() {
    const list = await dbAll('expense');
    const box = $('list-expenses');
    box.innerHTML = '';
    if (list.length === 0) {
      box.appendChild(el('div', { class: 'empty' }, '未登録'));
      return;
    }
    for (const ex of list) {
      const row = el('div', { class: 'item' });
      const main = el('div', { class: 'item-main', style: 'cursor:pointer;', onclick: () => editExpense(ex) });
      main.appendChild(el('div', { class: 'item-title' }, `${ex.category || '支出'}：${yen(ex.monthlyAmount)}/月`));
      main.appendChild(el('div', { class: 'item-sub' }, `${ex.fromAge}〜${ex.toAge}歳  インフレ${((ex.inflationRate || 0) * 100).toFixed(1)}%  ✏️ タップで編集`));
      row.appendChild(main);
      row.appendChild(el('button', {
        class: 'btn small danger',
        onclick: async () => {
          if (!confirm(`${ex.category} を削除しますか？`)) return;
          await dbDelete('expense', ex.id); renderExpenses(); renderHome();
        }
      }, '削除'));
      box.appendChild(row);
    }
  }

  async function addExpense() { return editExpense(null); }

  async function editExpense(existing) {
    const result = await openForm({
      title: existing ? '支出を編集' : '支出を追加',
      fields: [
        { key: 'category', label: 'カテゴリ', type: 'text', default: '基本生活費', hint: '例：基本生活費・住居費・保険・通信' },
        { key: 'monthlyAmount', label: '月額（円）', type: 'number', default: 250000 },
        { key: 'fromAge', label: '開始年齢', type: 'number', default: 35 },
        { key: 'toAge', label: '終了年齢', type: 'number', default: 95 },
        { key: 'inflationRate', label: 'インフレ率（%/年）', type: 'percent', default: 0.01, hint: '物価上昇で年々増える想定' }
      ],
      values: existing
    });
    if (!result) return;
    await dbPut('expense', {
      id: existing?.id || uid(),
      category: result.category || '支出',
      monthlyAmount: parseInt(result.monthlyAmount) || 0,
      fromAge: parseInt(result.fromAge) || 0,
      toAge: parseInt(result.toAge) || 95,
      inflationRate: result.inflationRate
    });
    renderExpenses();
    renderHome();
  }

  $('btn-add-income').addEventListener('click', addIncome);
  $('btn-add-expense').addEventListener('click', addExpense);

  // ============ 教育費タブ ============
  async function renderEducation() {
    const children = (await dbAll('members')).filter(m => m.kind === 'child');
    const edus = await dbAll('education');
    const box = $('list-education');
    box.innerHTML = '';
    if (children.length === 0) {
      box.appendChild(el('div', { class: 'empty' }, '「基本情報」タブで子供を追加してください'));
      return;
    }
    for (const c of children) {
      const edu = edus.find(e => e.childId === c.id) || { plan: {}, juku: 'none', childId: c.id, id: c.id };
      const card = el('div', { class: 'card' });
      card.appendChild(el('div', { class: 'card-title' }, `${c.name}（${new Date().getFullYear() - (c.birthYear || 0)}歳）`));

      const stageKeys = ['pre', 'es', 'jhs', 'hs', 'univ'];
      const stageLabels = { pre: '幼稚園', es: '小学校', jhs: '中学校', hs: '高校', univ: '大学' };

      for (const sk of stageKeys) {
        const row = el('div', { class: 'form-row cols-2' });
        const lbl = el('div', {}, [
          el('label', { class: 'lbl' }, stageLabels[sk])
        ]);
        const sel = el('select', {
          onchange: async (e) => {
            edu.plan[sk] = e.target.value;
            edu.childId = c.id; edu.id = c.id;
            await dbPut('education', edu);
            renderEduSummary();
          }
        });
        if (sk === 'univ') {
          for (const v of [['public', '国公立'], ['private_bunkei', '私立文系'], ['private_rikei', '私立理系'], ['private_med', '私立医歯']]) {
            const o = el('option', { value: v[0] }, v[1]);
            if ((edu.plan[sk] || 'public') === v[0]) o.selected = true;
            sel.appendChild(o);
          }
        } else {
          for (const v of [['public', '公立'], ['private', '私立']]) {
            const o = el('option', { value: v[0] }, v[1]);
            if ((edu.plan[sk] || 'public') === v[0]) o.selected = true;
            sel.appendChild(o);
          }
        }
        row.appendChild(lbl);
        row.appendChild(sel);
        card.appendChild(row);
      }

      // 塾
      const jukuRow = el('div', { class: 'form-row' });
      jukuRow.appendChild(el('label', { class: 'lbl' }, '塾・習い事'));
      const jSel = el('select', {
        onchange: async (e) => {
          edu.juku = e.target.value;
          edu.childId = c.id; edu.id = c.id;
          await dbPut('education', edu);
          renderEduSummary();
        }
      });
      for (const v of [['none', 'なし'], ['light', 'ライト（年12万）'], ['standard', '標準（年36万）'], ['heavy', 'ヘビー（年72万）']]) {
        const o = el('option', { value: v[0] }, v[1]);
        if ((edu.juku || 'none') === v[0]) o.selected = true;
        jSel.appendChild(o);
      }
      jukuRow.appendChild(jSel);
      card.appendChild(jukuRow);

      box.appendChild(card);
    }
    renderEduSummary();
  }

  async function renderEduSummary() {
    if (!educationDataset) return;
    const children = (await dbAll('members')).filter(m => m.kind === 'child');
    const edus = await dbAll('education');
    const tbody = $('edu-summary').querySelector('tbody');
    tbody.innerHTML = '';
    for (const c of children) {
      const edu = edus.find(e => e.childId === c.id);
      if (!edu) continue;
      const byAge = CALC.buildEducationByAge({ ...edu, birthYear: c.birthYear }, educationDataset);
      const stageTotals = { pre: 0, es: 0, jhs: 0, hs: 0, univ: 0 };
      const jukuTotal = (educationDataset.juku[edu.juku || 'none'] || 0) * 12;
      for (const [age, v] of Object.entries(byAge)) {
        const a = parseInt(age);
        if (a <= 5) stageTotals.pre += v;
        else if (a <= 11) stageTotals.es += v;
        else if (a <= 14) stageTotals.jhs += v;
        else if (a <= 17) stageTotals.hs += v;
        else if (a <= 21) stageTotals.univ += v;
      }
      // 塾は年齢範囲で内包されているので分離
      const eduOnly = {
        pre: stageTotals.pre,
        es: stageTotals.es - jukuTotal * (6/12),
        jhs: stageTotals.jhs - jukuTotal * (3/12),
        hs: stageTotals.hs - jukuTotal * (3/12),
        univ: stageTotals.univ
      };
      const total = Object.values(stageTotals).reduce((a, b) => a + b, 0);
      const tr = el('tr', {}, [
        el('td', {}, c.name),
        el('td', {}, yen(eduOnly.pre)),
        el('td', {}, yen(eduOnly.es)),
        el('td', {}, yen(eduOnly.jhs)),
        el('td', {}, yen(eduOnly.hs)),
        el('td', {}, yen(eduOnly.univ)),
        el('td', {}, yen(jukuTotal)),
        el('td', {}, yen(total))
      ]);
      tbody.appendChild(tr);
    }
  }

  // ============ 資産タブ ============
  async function renderAssets() {
    const list = await dbAll('assets');
    const box = $('list-assets');
    box.innerHTML = '';
    if (list.length === 0) {
      box.appendChild(el('div', { class: 'empty' }, '未登録'));
      return;
    }
    const kindLabel = {
      nisa_tsumitate: '新NISA(つみたて)',
      nisa_growth: '新NISA(成長)',
      tokutei: '特定口座',
      stock: '個別株',
      crypto: '暗号資産',
      cash: '現金・預金'
    };
    for (const a of list) {
      const row = el('div', { class: 'item' });
      const main = el('div', { class: 'item-main', style: 'cursor:pointer;', onclick: () => editAsset(a) });
      main.appendChild(el('div', { class: 'item-title' }, `${kindLabel[a.kind] || a.kind}：${yen(a.currentBalance)}`));
      const ret = a.kind === 'stock' || a.kind === 'crypto'
        ? `シナリオ:${a.scenario || 'neutral'}`
        : `利回り${((a.expectedReturn || 0) * 100).toFixed(1)}%`;
      main.appendChild(el('div', { class: 'item-sub' }, `毎月${yen(a.monthlyContribution || 0)}  ${ret}  ✏️ タップで編集`));
      row.appendChild(main);
      row.appendChild(el('button', {
        class: 'btn small danger',
        onclick: async () => {
          if (!confirm(`${kindLabel[a.kind]} を削除しますか？`)) return;
          await dbDelete('assets', a.id); renderAssets(); renderHome();
        }
      }, '削除'));
      box.appendChild(row);
    }
  }

  async function addAsset() { return editAsset(null); }

  async function editAsset(existing) {
    const result = await openForm({
      title: existing ? '口座を編集' : '口座を追加',
      fields: [
        {
          key: 'kind', label: '口座種別', type: 'select',
          default: 'nisa_tsumitate',
          options: [
            { value: 'nisa_tsumitate', label: '新NISA（つみたて枠）' },
            { value: 'nisa_growth',    label: '新NISA（成長枠）' },
            { value: 'tokutei',        label: '特定口座（課税）' },
            { value: 'stock',          label: '個別株' },
            { value: 'crypto',         label: '暗号資産' },
            { value: 'cash',           label: '現金・預金' }
          ]
        },
        { key: 'currentBalance', label: '現在残高（円）', type: 'number', default: 0 },
        { key: 'monthlyContribution', label: '毎月積立額（円）', type: 'number', default: 50000 },
        { key: 'expectedReturn', label: '期待年利回り（%）', type: 'percent', default: 0.04, hint: 'S&P500=5 / 全世界=4 / バランス=3 / 債券=1。株・暗号は下のシナリオ優先' },
        {
          key: 'scenario', label: 'シナリオ（株・暗号のみ）', type: 'select',
          default: 'neutral',
          options: [
            { value: 'strong',  label: '強気 +12%' },
            { value: 'neutral', label: '中立 +5%' },
            { value: 'weak',    label: '弱気 -3%' }
          ]
        }
      ],
      values: existing
    });
    if (!result) return;
    let expectedReturn = result.expectedReturn;
    if (result.kind === 'cash') expectedReturn = 0.001;
    await dbPut('assets', {
      id: existing?.id || uid(),
      kind: result.kind,
      currentBalance: parseInt(result.currentBalance) || 0,
      monthlyContribution: parseInt(result.monthlyContribution) || 0,
      expectedReturn,
      scenario: result.scenario
    });
    renderAssets();
    renderHome();
  }

  $('btn-add-asset').addEventListener('click', addAsset);

  // ============ 資産スクショOCR取込 ============
  // MFは資産残高のCSVを出せないため、画面スクショから金額を抽出して反映する
  const ASSET_KIND_LABEL = {
    nisa_tsumitate: '新NISA(つみたて)',
    nisa_growth: '新NISA(成長)',
    tokutei: '特定口座',
    stock: '個別株',
    crypto: '暗号資産',
    cash: '現金・預金'
  };

  const ocrDrop = $('ocr-drop');
  const ocrFile = $('ocr-file');
  let ocrParsed = null;
  let tesseractLoadPromise = null;

  function loadTesseract() {
    if (window.Tesseract) return Promise.resolve(window.Tesseract);
    if (tesseractLoadPromise) return tesseractLoadPromise;
    tesseractLoadPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.0/dist/tesseract.min.js';
      s.onload = () => resolve(window.Tesseract);
      s.onerror = reject;
      document.head.appendChild(s);
    });
    return tesseractLoadPromise;
  }

  function setOcrStatus(msg, busy = false) {
    const box = $('ocr-status');
    box.innerHTML = '';
    if (busy) box.appendChild(el('div', { class: 'spinner' }));
    box.appendChild(el('div', {}, msg));
    box.classList.remove('hidden');
  }
  function clearOcrStatus() { $('ocr-status').classList.add('hidden'); }

  ocrDrop.addEventListener('click', () => ocrFile.click());
  ocrDrop.addEventListener('dragover', (e) => { e.preventDefault(); ocrDrop.classList.add('dragging'); });
  ocrDrop.addEventListener('dragleave', () => ocrDrop.classList.remove('dragging'));
  ocrDrop.addEventListener('drop', (e) => {
    e.preventDefault();
    ocrDrop.classList.remove('dragging');
    if (e.dataTransfer.files[0]) handleAssetScreenshot(e.dataTransfer.files[0]);
  });
  ocrFile.addEventListener('change', (e) => {
    if (e.target.files[0]) handleAssetScreenshot(e.target.files[0]);
  });

  async function handleAssetScreenshot(file) {
    try {
      setOcrStatus('Tesseract.js 読込中（初回のみ 約30MB）...', true);
      const T = await loadTesseract();
      setOcrStatus('画像解析中（日本語OCR）...', true);
      const { data } = await T.recognize(file, 'jpn+eng', { logger: () => {} });
      const text = data?.text || '';
      const extracted = extractBalancesFromOcr(text);
      if (extracted.length === 0) {
        setOcrStatus('❌ 金額を抽出できませんでした。明るい場所で撮り直すか、一括棚卸しモードで手動入力してください');
        return;
      }
      // 既存資産との比較プレビュー（kind単位でマージ）
      const existing = await dbAll('assets');
      const summary = {};
      for (const e of extracted) {
        summary[e.kind] = (summary[e.kind] || 0) + e.amount;
      }
      ocrParsed = { extracted, summary, rawText: text };
      renderOcrDiff(existing, summary);
      setOcrStatus(`✅ ${extracted.length}件の残高候補を検出しました`);
      $('ocr-diff-area').classList.remove('hidden');
    } catch (e) {
      console.error(e);
      setOcrStatus('❌ OCR処理に失敗しました：' + (e.message || e));
    }
  }

  function renderOcrDiff(existing, summary) {
    const box = $('ocr-diff-list');
    box.innerHTML = '';
    for (const [kind, amount] of Object.entries(summary)) {
      const exi = existing.find(e => e.kind === kind);
      const before = exi ? (exi.currentBalance || 0) : 0;
      const row = el('div', { class: 'diff-row' });
      row.appendChild(el('div', {}, ASSET_KIND_LABEL[kind] || kind));
      const right = el('div', {});
      right.appendChild(el('span', { class: 'diff-before' }, yen(before)));
      right.appendChild(el('span', { class: 'diff-arrow' }, ' → '));
      right.appendChild(el('span', { class: 'diff-after' }, yen(amount)));
      if (before > 0) {
        const delta = amount - before;
        const pct = Math.round((delta / before) * 100);
        const up = delta >= 0;
        right.appendChild(el('span', { class: 'diff-delta ' + (up ? 'up' : 'down') },
          (up ? '+' : '') + yen(delta) + ` (${up ? '+' : ''}${pct}%)`));
      }
      row.appendChild(right);
      box.appendChild(row);
    }
  }

  // OCR結果から「金融機関名＋残高」を抽出
  // expose to window for unit-testability
  function extractBalancesFromOcr(text) {
    const lines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    const out = [];
    // 「¥」「円」表記の金額を検出。OCRは空白混入や桁区切り誤検出があるので寛容に
    const amountRe = /(?:¥|￥|\\)?\s*([0-9][0-9,\s]{2,})\s*円?/;
    for (const line of lines) {
      const m = line.match(amountRe);
      if (!m) continue;
      const rawNum = m[1].replace(/[,\s]/g, '');
      const amount = parseInt(rawNum, 10);
      if (!Number.isFinite(amount) || amount < 1000) continue; // ノイズ除去：1000円未満は捨てる
      const kind = classifyAssetLine(line);
      out.push({ name: line.replace(amountRe, '').trim() || kind, amount, kind });
    }
    return out;
  }

  function classifyAssetLine(line) {
    const s = line.toLowerCase();
    if (/つみたて|tsumitate/.test(s) || /積立nisa/.test(s)) return 'nisa_tsumitate';
    if (/成長投資|成長枠|growth/.test(s)) return 'nisa_growth';
    if (/nisa/.test(s)) return 'nisa_tsumitate'; // NISAとだけ書かれた場合はつみたて寄せ
    if (/特定|投信|投資信託/.test(line)) return 'tokutei';
    if (/株|証券|stock|sbi|楽天|マネックス/.test(s)) return 'stock';
    if (/暗号|crypto|bitcoin|btc|eth|コイン/.test(s)) return 'crypto';
    if (/預金|普通|定期|貯金|現金|銀行|ゆうちょ|ufj|みずほ|smbc/.test(s)) return 'cash';
    return 'cash';
  }

  $('ocr-cancel').addEventListener('click', () => {
    $('ocr-diff-area').classList.add('hidden');
    clearOcrStatus();
    ocrParsed = null;
  });

  $('ocr-apply').addEventListener('click', async () => {
    if (!ocrParsed) return;
    const existing = await dbAll('assets');
    for (const [kind, amount] of Object.entries(ocrParsed.summary)) {
      const exi = existing.find(e => e.kind === kind);
      if (exi) {
        exi.currentBalance = amount;
        exi.lastInventoryAt = nowSec();
        await dbPut('assets', exi);
      } else {
        await dbPut('assets', {
          id: uid(),
          kind,
          currentBalance: amount,
          monthlyContribution: 0,
          expectedReturn: kind === 'cash' ? 0.001 : 0.04,
          scenario: 'neutral',
          lastInventoryAt: nowSec()
        });
      }
    }
    // OCR履歴を保存（mfSnapshotsを転用）
    await dbPut('mfSnapshots', {
      id: uid(),
      type: 'ocr',
      importedAt: nowSec(),
      extracted: ocrParsed.extracted,
      rawText: ocrParsed.rawText.slice(0, 2000)
    });
    $('ocr-diff-area').classList.add('hidden');
    clearOcrStatus();
    ocrParsed = null;
    alert('残高を更新しました');
    renderAssets();
    renderHome();
  });

  // ============ 一括棚卸しモード ============
  $('btn-inventory-mode').addEventListener('click', openInventoryMode);

  async function openInventoryMode() {
    const list = await dbAll('assets');
    if (list.length === 0) {
      alert('まず口座を追加してください');
      return;
    }
    const backdrop = $('modal-backdrop');
    const body = $('modal-body');
    $('modal-title').textContent = '🔄 一括棚卸し';
    body.innerHTML = '';
    body.appendChild(el('div', { class: 'card-hint', style: 'margin-bottom:10px;' },
      'MFアプリで各口座の現在残高を確認して入力してください。前回値との差分を自動表示します'));

    const inputs = {};
    for (const a of list) {
      const row = el('div', { class: 'inventory-row' });
      const nameCell = el('div');
      nameCell.appendChild(el('div', { class: 'name' }, ASSET_KIND_LABEL[a.kind] || a.kind));
      nameCell.appendChild(el('div', { class: 'prev' }, '前回 ' + yen(a.currentBalance || 0)));
      row.appendChild(nameCell);

      const input = el('input', { type: 'number', inputmode: 'numeric', value: String(a.currentBalance || 0) });
      row.appendChild(input);

      const deltaEl = el('div', { class: 'diff-delta' }, '±0');
      const onInput = () => {
        const next = parseInt(input.value, 10) || 0;
        const before = a.currentBalance || 0;
        const delta = next - before;
        deltaEl.className = 'diff-delta ' + (delta > 0 ? 'up' : delta < 0 ? 'down' : '');
        const pct = before > 0 ? Math.round((delta / before) * 100) : 0;
        deltaEl.textContent = (delta >= 0 ? '+' : '') + yen(delta) + (before > 0 ? ` (${delta >= 0 ? '+' : ''}${pct}%)` : '');
      };
      input.addEventListener('input', onInput);
      row.appendChild(deltaEl);
      body.appendChild(row);
      inputs[a.id] = input;
    }

    const cleanup = () => {
      backdrop.classList.add('hidden');
      $('modal-save').onclick = null;
      $('modal-cancel').onclick = null;
      $('modal-close').onclick = null;
      backdrop.onclick = null;
    };
    $('modal-save').onclick = async () => {
      for (const a of list) {
        const v = parseInt(inputs[a.id].value, 10);
        if (!Number.isFinite(v)) continue;
        a.currentBalance = v;
        a.lastInventoryAt = nowSec();
        await dbPut('assets', a);
      }
      cleanup();
      renderAssets();
      renderHome();
    };
    $('modal-cancel').onclick = cleanup;
    $('modal-close').onclick = cleanup;
    backdrop.onclick = (e) => { if (e.target === backdrop) cleanup(); };
    backdrop.classList.remove('hidden');
  }

  // ============ 家計簿CSV取込（支出実績化） ============
  const kakeiboDrop = $('kakeibo-drop');
  const kakeiboFile = $('kakeibo-file');
  let kakeiboParsed = null;

  kakeiboDrop.addEventListener('click', () => kakeiboFile.click());
  kakeiboDrop.addEventListener('dragover', (e) => { e.preventDefault(); kakeiboDrop.classList.add('dragging'); });
  kakeiboDrop.addEventListener('dragleave', () => kakeiboDrop.classList.remove('dragging'));
  kakeiboDrop.addEventListener('drop', (e) => {
    e.preventDefault();
    kakeiboDrop.classList.remove('dragging');
    if (e.dataTransfer.files[0]) handleKakeiboCsv(e.dataTransfer.files[0]);
  });
  kakeiboFile.addEventListener('change', (e) => {
    if (e.target.files[0]) handleKakeiboCsv(e.target.files[0]);
  });

  async function handleKakeiboCsv(file) {
    // MFはShift_JISで書き出すことが多いので両方試す
    let text;
    try {
      const buf = await file.arrayBuffer();
      text = new TextDecoder('shift_jis').decode(buf);
      if (!/計算対象|日付|金額/.test(text)) {
        text = new TextDecoder('utf-8').decode(buf);
      }
    } catch (_) {
      text = await file.text();
    }
    const rows = parseKakeiboCsv(text);
    if (rows.length === 0) {
      alert('家計簿CSVを解析できませんでした。MFアプリ→家計簿→CSV書出でダウンロードしたファイルを投入してください。\n想定列：計算対象,日付,内容,金額(円),保有金融機関,大項目,中項目,メモ,振替,ID');
      return;
    }
    const summary = summarizeKakeibo(rows);
    if (summary.categories.length === 0) {
      alert('集計対象（計算対象=1／振替=0／支出）の行がありませんでした');
      return;
    }
    const existingExpenses = await dbAll('expense');
    kakeiboParsed = { summary, existingExpenses };
    renderKakeiboMapping();
    $('kakeibo-diff-area').classList.remove('hidden');
  }

  // MF家計簿CSVパーサー
  // 想定列: 計算対象,日付,内容,金額(円),保有金融機関,大項目,中項目,メモ,振替,ID
  function parseKakeiboCsv(text) {
    const lines = text.split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) return [];
    const header = splitCsvLine(lines[0]);
    const idx = {
      flag: header.findIndex(h => /計算対象/.test(h)),
      date: header.findIndex(h => /日付/.test(h)),
      content: header.findIndex(h => /内容/.test(h)),
      amount: header.findIndex(h => /金額/.test(h)),
      bank: header.findIndex(h => /保有金融機関|金融機関/.test(h)),
      major: header.findIndex(h => /大項目/.test(h)),
      minor: header.findIndex(h => /中項目/.test(h)),
      transfer: header.findIndex(h => /振替/.test(h))
    };
    if (idx.date < 0 || idx.amount < 0 || idx.major < 0) return [];
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = splitCsvLine(lines[i]);
      if (cols.length < 2) continue;
      const amountStr = (cols[idx.amount] || '').replace(/[,円¥￥\s]/g, '');
      const amount = parseInt(amountStr, 10);
      if (!Number.isFinite(amount)) continue;
      rows.push({
        flag: (cols[idx.flag] || '').trim(),
        date: (cols[idx.date] || '').trim(),
        content: (cols[idx.content] || '').trim(),
        amount,
        bank: (cols[idx.bank] || '').trim(),
        major: (cols[idx.major] || '').trim(),
        minor: (cols[idx.minor] || '').trim(),
        transfer: (cols[idx.transfer] || '').trim()
      });
    }
    return rows;
  }

  // 単純なCSVスプリット（ダブルクォート内のカンマに対応）
  function splitCsvLine(line) {
    const out = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') { inQ = !inQ; continue; }
      if (c === ',' && !inQ) { out.push(cur); cur = ''; continue; }
      cur += c;
    }
    out.push(cur);
    return out.map(s => s.trim());
  }

  // 計算対象=1／振替=0／支出のみ残し、大項目×月で集計→直近3ヶ月平均
  function summarizeKakeibo(rows) {
    const filtered = rows.filter(r =>
      r.flag === '1' && r.transfer === '0' && r.amount < 0 && r.major
    );
    // 年月キー → 大項目 → 合計
    const byMonth = {};
    for (const r of filtered) {
      const ym = (r.date || '').replace(/[\/\-]/g, '/').slice(0, 7); // YYYY/MM
      if (!ym) continue;
      if (!byMonth[ym]) byMonth[ym] = {};
      byMonth[ym][r.major] = (byMonth[ym][r.major] || 0) + Math.abs(r.amount);
    }
    const months = Object.keys(byMonth).sort().slice(-3); // 直近3ヶ月
    const catTotals = {};
    for (const ym of months) {
      for (const [cat, v] of Object.entries(byMonth[ym])) {
        catTotals[cat] = (catTotals[cat] || 0) + v;
      }
    }
    const n = Math.max(months.length, 1);
    const categories = Object.entries(catTotals)
      .map(([cat, total]) => ({ major: cat, monthlyAvg: Math.round(total / n) }))
      .sort((a, b) => b.monthlyAvg - a.monthlyAvg);
    return { categories, months, rowCount: filtered.length };
  }

  function renderKakeiboMapping() {
    if (!kakeiboParsed) return;
    const { summary, existingExpenses } = kakeiboParsed;
    const box = $('kakeibo-diff-list');
    box.innerHTML = '';
    box.appendChild(el('div', { class: 'card-hint', style: 'margin-bottom:6px;' },
      `直近${summary.months.length}ヶ月 / 有効${summary.rowCount}行 を集計`));
    for (const c of summary.categories) {
      const row = el('div', { class: 'expense-map-row' });
      const head = el('div', { class: 'map-head' });
      const chk = el('input', { type: 'checkbox' });
      chk.checked = true;
      head.appendChild(chk);
      row.appendChild(head);

      const right = el('div');
      const title = el('div', {});
      title.appendChild(el('span', { class: 'cat' }, c.major));
      title.appendChild(el('span', {}, ' → '));
      const sel = el('select');
      sel.appendChild(el('option', { value: '__new__' }, `＋新規追加：${c.major}`));
      for (const e of existingExpenses) {
        sel.appendChild(el('option', { value: e.id }, `既存：${e.category}（${yen(e.monthlyAmount)}/月）`));
      }
      // 類似度マッチ：大項目とexpense.categoryの前方一致で候補選択
      const match = existingExpenses.find(e => e.category && (e.category.includes(c.major) || c.major.includes(e.category)));
      if (match) sel.value = match.id;
      title.appendChild(sel);
      right.appendChild(title);

      const vals = el('div', { class: 'values' });
      const beforeTxt = match ? `既存 ${yen(match.monthlyAmount)}/月` : '新規';
      vals.appendChild(el('span', { class: 'diff-before' }, beforeTxt));
      vals.appendChild(el('span', { class: 'diff-arrow' }, '→'));
      vals.appendChild(el('span', { class: 'diff-after' }, `実績平均 ${yen(c.monthlyAvg)}/月`));
      if (match) {
        const delta = c.monthlyAvg - match.monthlyAmount;
        const pct = match.monthlyAmount > 0 ? Math.round((delta / match.monthlyAmount) * 100) : 0;
        vals.appendChild(el('span', { class: 'diff-delta ' + (delta >= 0 ? 'up' : 'down') },
          (delta >= 0 ? '+' : '') + yen(delta) + (match.monthlyAmount > 0 ? ` (${delta >= 0 ? '+' : ''}${pct}%)` : '')));
      }
      right.appendChild(vals);
      row.appendChild(right);
      box.appendChild(row);

      c._checkbox = chk;
      c._select = sel;
    }
  }

  $('kakeibo-cancel').addEventListener('click', () => {
    $('kakeibo-diff-area').classList.add('hidden');
    kakeiboParsed = null;
  });

  $('kakeibo-apply').addEventListener('click', async () => {
    if (!kakeiboParsed) return;
    const { summary, existingExpenses } = kakeiboParsed;
    let updated = 0;
    let created = 0;
    for (const c of summary.categories) {
      if (!c._checkbox.checked) continue;
      const targetId = c._select.value;
      if (targetId === '__new__') {
        await dbPut('expense', {
          id: uid(),
          category: c.major,
          monthlyAmount: c.monthlyAvg,
          fromAge: 35,
          toAge: 95,
          inflationRate: 0.01
        });
        created++;
      } else {
        const exi = existingExpenses.find(e => e.id === targetId);
        if (!exi) continue;
        exi.monthlyAmount = c.monthlyAvg;
        await dbPut('expense', exi);
        updated++;
      }
    }
    $('kakeibo-diff-area').classList.add('hidden');
    kakeiboParsed = null;
    alert(`支出項目を更新しました（更新${updated}件／新規${created}件）`);
    renderExpenses();
    renderHome();
  });

  // 単体テスト用に関数をwindowに露出
  window.LIFEPLAN_MF = {
    parseKakeiboCsv, summarizeKakeibo,
    extractBalancesFromOcr, classifyAssetLine
  };

  // ============ イベントタブ ============
  function renderEventTemplates() {
    const box = $('event-templates');
    box.innerHTML = '';
    if (!eventTemplates) return;
    for (const t of eventTemplates.templates) {
      const chip = el('button', {
        class: 'chip',
        onclick: async () => {
          await editEvent(null, {
            label: t.label,
            amount: t.amountDefault,
            startAge: t.startAge,
            everyYears: t.everyYears,
            category: t.category
          });
        }
      }, t.label);
      box.appendChild(chip);
    }
  }

  async function renderEvents() {
    const list = await dbAll('events');
    const box = $('list-events');
    box.innerHTML = '';
    if (list.length === 0) {
      box.appendChild(el('div', { class: 'empty' }, 'テンプレから選ぶか、自由追加してください'));
      return;
    }
    for (const ev of list) {
      const row = el('div', { class: 'item' });
      const main = el('div', { class: 'item-main', style: 'cursor:pointer;', onclick: () => editEvent(ev) });
      main.appendChild(el('div', { class: 'item-title' }, `${ev.label}：${yen(ev.amount)}`));
      const freq = ev.everyYears > 0 ? `${ev.startAge}歳から${ev.everyYears}年ごと` : `${ev.startAge}歳で単発`;
      main.appendChild(el('div', { class: 'item-sub' }, `${freq}  ✏️ タップで編集`));
      row.appendChild(main);
      row.appendChild(el('button', {
        class: 'btn small danger',
        onclick: async () => {
          if (!confirm(`${ev.label} を削除しますか？`)) return;
          await dbDelete('events', ev.id); renderEvents(); renderHome();
        }
      }, '削除'));
      box.appendChild(row);
    }
  }

  async function addFreeEvent() { return editEvent(null); }

  async function editEvent(existing, templateDefaults = null) {
    const defaults = templateDefaults || { label: '車買替', amount: 1000000, startAge: 40, everyYears: 0 };
    const result = await openForm({
      title: existing ? 'イベントを編集' : 'イベントを追加',
      fields: [
        { key: 'label', label: 'イベント名', type: 'text', default: defaults.label },
        { key: 'amount', label: '金額（円）', type: 'number', default: defaults.amount },
        { key: 'startAge', label: '開始年齢', type: 'number', default: defaults.startAge },
        { key: 'everyYears', label: '繰り返し（年）', type: 'number', default: defaults.everyYears, hint: '0=単発、10=10年ごと繰返し' }
      ],
      values: existing
    });
    if (!result) return;
    await dbPut('events', {
      id: existing?.id || uid(),
      label: result.label || 'イベント',
      category: existing?.category || templateDefaults?.category || 'other',
      amount: parseInt(result.amount) || 0,
      startAge: parseInt(result.startAge) || 40,
      everyYears: parseInt(result.everyYears) || 0
    });
    renderEvents();
    renderHome();
  }

  $('btn-add-event').addEventListener('click', addFreeEvent);

  // ============ ホーム（CF表 + Chart） ============
  async function renderHome() {
    const hh = await dbGet('household', 'singleton') || { selfAge: 35, retireAge: 65, lifespan: 95 };
    const incomes = await dbAll('income');
    const expenses = await dbAll('expense');
    const members = (await dbAll('members')).filter(m => m.kind === 'child');
    const edus = await dbAll('education');
    const events = await dbAll('events');
    const assets = await dbAll('assets');

    const educations = members.map(c => {
      const edu = edus.find(e => e.childId === c.id);
      return edu ? { ...edu, birthYear: c.birthYear } : null;
    }).filter(Boolean);

    const { rows, assetSeries, exhaustedAge } = CALC.buildCashflow({
      self: { currentAge: hh.selfAge, retireAge: hh.retireAge, lifespan: hh.lifespan },
      incomes, expenses, educations, events, assets,
      educationDataset
    });

    // サマリータイル
    const nowBalance = assets.reduce((sum, a) => sum + (a.currentBalance || 0), 0);
    $('tile-now').textContent = yen(nowBalance);

    const retireRow = rows.find(r => r.age === hh.retireAge);
    if (retireRow) {
      $('tile-retire').textContent = yen(retireRow.totalAssets);
      $('tile-retire-sub').textContent = `${hh.retireAge}歳時点`;
    }

    let peak = rows[0] || { totalAssets: 0, age: hh.selfAge };
    for (const r of rows) if (r.totalAssets > peak.totalAssets) peak = r;
    $('tile-peak').textContent = yen(peak.totalAssets);
    $('tile-peak-sub').textContent = `${peak.age}歳で到達`;

    const exTile = $('tile-exhaust');
    if (exhaustedAge) {
      exTile.textContent = `${exhaustedAge}歳`;
      exTile.classList.add('danger');
    } else {
      exTile.textContent = '枯渇なし';
      exTile.classList.remove('danger');
      exTile.classList.add('success');
    }

    // バッジ
    const badges = $('badges');
    badges.innerHTML = '';
    if (exhaustedAge) {
      badges.appendChild(el('span', { class: 'status-badge danger' }, `⚠️ ${exhaustedAge}歳で資産枯渇の可能性`));
    } else if (rows.length > 0) {
      badges.appendChild(el('span', { class: 'status-badge success' }, `✅ 寿命まで資産が持つ見込み`));
    }

    // CF表
    const tbody = $('cf-body');
    tbody.innerHTML = '';
    for (const r of rows) {
      const tr = el('tr');
      if (r.net < 0) tr.classList.add('negative');
      if (exhaustedAge && r.age === exhaustedAge) tr.classList.add('exhausted');
      tr.appendChild(el('td', {}, String(r.year)));
      tr.appendChild(el('td', {}, String(r.age)));
      tr.appendChild(el('td', {}, yen(r.income)));
      tr.appendChild(el('td', {}, yen(r.expense)));
      tr.appendChild(el('td', {}, yen(r.education)));
      tr.appendChild(el('td', {}, yen(r.event)));
      const netTd = el('td', { class: r.net >= 0 ? 'pos' : 'neg' }, yen(r.net));
      tr.appendChild(netTd);
      tr.appendChild(el('td', {}, yen(r.totalAssets)));
      tbody.appendChild(tr);
    }

    // Chart
    if (window.Chart) {
      const labels = rows.map(r => r.age + '歳');
      const datasets = [];
      const colors = {
        nisa_tsumitate: '#10b981',
        nisa_growth: '#14b8a6',
        tokutei: '#6366f1',
        tokutei_overflow: '#818cf8',
        stock: '#f59e0b',
        crypto: '#a855f7',
        cash: '#94a3b8'
      };
      const kindLabel = {
        nisa_tsumitate: '新NISA(つみたて)',
        nisa_growth: '新NISA(成長)',
        tokutei: '特定口座',
        tokutei_overflow: '特定(NISA超過)',
        stock: '個別株',
        crypto: '暗号資産',
        cash: '現金'
      };
      for (const [kind, arr] of Object.entries(assetSeries)) {
        const data = rows.map((r, i) => {
          const row = arr[i];
          if (!row) return 0;
          const taxable = ['tokutei', 'tokutei_overflow', 'stock', 'crypto'].includes(kind);
          return taxable ? row.balanceAfterTax : row.balance;
        });
        datasets.push({
          label: kindLabel[kind] || kind,
          data,
          backgroundColor: (colors[kind] || '#64748b') + 'aa',
          borderColor: colors[kind] || '#64748b',
          fill: true,
          tension: 0.2,
          pointRadius: 0,
          borderWidth: 1.5
        });
      }
      // 純資産（投資+現金）ライン
      datasets.push({
        label: '純資産合計',
        data: rows.map(r => r.totalAssets),
        borderColor: '#0ea5e9',
        backgroundColor: 'rgba(14,165,233,0.0)',
        fill: false,
        tension: 0.2,
        pointRadius: 0,
        borderWidth: 2.5,
        type: 'line'
      });

      if (chartAssets) chartAssets.destroy();
      const ctx = $('chart-assets').getContext('2d');
      chartAssets = new Chart(ctx, {
        type: 'line',
        data: { labels, datasets },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          scales: {
            x: { ticks: { font: { size: 10 }, maxTicksLimit: 12 } },
            y: {
              stacked: true,
              ticks: {
                font: { size: 10 },
                callback: (v) => yen(v)
              }
            }
          },
          plugins: {
            legend: { labels: { font: { size: 10 }, boxWidth: 12 } },
            tooltip: {
              callbacks: {
                label: (c) => `${c.dataset.label}: ${yen(c.parsed.y)}`
              }
            }
          }
        }
      });
      // stacked: 純資産合計ラインだけ外す
      chartAssets.data.datasets.forEach((ds, i) => {
        ds.stack = ds.type === 'line' ? undefined : 'assets';
      });
      chartAssets.update();
    }
  }

  // ============ 初期化 ============
  async function init() {
    await loadStaticData();
    await loadBasic();
    await renderIncomes();
    await renderExpenses();
    await renderEducation();
    await renderAssets();
    renderEventTemplates();
    await renderEvents();
    await renderHome();
  }

  init().catch(err => {
    console.error(err);
    alert('初期化エラー: ' + err.message);
  });
})();
