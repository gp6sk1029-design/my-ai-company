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
      const main = el('div', { class: 'item-main' });
      const thisYear = new Date().getFullYear();
      const age = thisYear - (c.birthYear || thisYear);
      main.appendChild(el('div', { class: 'item-title' }, `${c.name || '子供'}（${age}歳）`));
      main.appendChild(el('div', { class: 'item-sub' }, `${c.birthYear || '—'}年生まれ`));
      row.appendChild(main);
      row.appendChild(el('button', {
        class: 'btn small danger',
        onclick: async () => { await dbDelete('members', c.id); await dbDelete('education', c.id); renderChildren(); renderEducation(); }
      }, '削除'));
      box.appendChild(row);
    }
  }

  async function addChild() {
    const name = prompt('子供の名前（ニックネーム可）', '子1') || '子';
    const birthYearStr = prompt('生まれ年（西暦）', String(new Date().getFullYear() - 5));
    const birthYear = parseInt(birthYearStr);
    if (!birthYear) return;
    const id = uid();
    await dbPut('members', { id, kind: 'child', name, birthYear });
    await dbPut('education', {
      id, childId: id,
      plan: { pre: 'public', es: 'public', jhs: 'public', hs: 'public', univ: 'public' },
      juku: 'light'
    });
    renderChildren();
    renderEducation();
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
      const main = el('div', { class: 'item-main' });
      main.appendChild(el('div', { class: 'item-title' }, `${inc.label || '収入'}：${yen(inc.annualAmount)}/年`));
      main.appendChild(el('div', { class: 'item-sub' }, `${inc.fromAge}〜${inc.toAge}歳  上昇率${((inc.growthRate || 0) * 100).toFixed(1)}%`));
      row.appendChild(main);
      row.appendChild(el('button', {
        class: 'btn small danger',
        onclick: async () => { await dbDelete('income', inc.id); renderIncomes(); }
      }, '削除'));
      box.appendChild(row);
    }
  }

  async function addIncome() {
    const label = prompt('収入のラベル（例：給与、副業、年金）', '給与');
    if (!label) return;
    const annualAmountStr = prompt('年収（円）', '5000000');
    const fromAgeStr = prompt('開始年齢', '35');
    const toAgeStr = prompt('終了年齢', '65');
    const growthStr = prompt('年間上昇率（%、昇給想定）', '1.5');
    await dbPut('income', {
      id: uid(),
      label,
      annualAmount: parseInt(annualAmountStr) || 0,
      fromAge: parseInt(fromAgeStr) || 0,
      toAge: parseInt(toAgeStr) || 65,
      growthRate: (parseFloat(growthStr) || 0) / 100
    });
    renderIncomes();
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
      const main = el('div', { class: 'item-main' });
      main.appendChild(el('div', { class: 'item-title' }, `${ex.category || '支出'}：${yen(ex.monthlyAmount)}/月`));
      main.appendChild(el('div', { class: 'item-sub' }, `${ex.fromAge}〜${ex.toAge}歳  インフレ${((ex.inflationRate || 0) * 100).toFixed(1)}%`));
      row.appendChild(main);
      row.appendChild(el('button', {
        class: 'btn small danger',
        onclick: async () => { await dbDelete('expense', ex.id); renderExpenses(); }
      }, '削除'));
      box.appendChild(row);
    }
  }

  async function addExpense() {
    const category = prompt('カテゴリ（基本生活費・住居費・保険・通信 など）', '基本生活費');
    if (!category) return;
    const monthlyStr = prompt('月額（円）', '250000');
    const fromAgeStr = prompt('開始年齢', '35');
    const toAgeStr = prompt('終了年齢', '95');
    const inflStr = prompt('年間インフレ率（%）', '1.0');
    await dbPut('expense', {
      id: uid(),
      category,
      monthlyAmount: parseInt(monthlyStr) || 0,
      fromAge: parseInt(fromAgeStr) || 0,
      toAge: parseInt(toAgeStr) || 95,
      inflationRate: (parseFloat(inflStr) || 0) / 100
    });
    renderExpenses();
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
      const main = el('div', { class: 'item-main' });
      main.appendChild(el('div', { class: 'item-title' }, `${kindLabel[a.kind] || a.kind}：${yen(a.currentBalance)}`));
      const ret = a.kind === 'stock' || a.kind === 'crypto'
        ? `シナリオ:${a.scenario || 'neutral'}`
        : `利回り${((a.expectedReturn || 0) * 100).toFixed(1)}%`;
      main.appendChild(el('div', { class: 'item-sub' }, `毎月${yen(a.monthlyContribution || 0)}  ${ret}`));
      row.appendChild(main);
      row.appendChild(el('button', {
        class: 'btn small danger',
        onclick: async () => { await dbDelete('assets', a.id); renderAssets(); }
      }, '削除'));
      box.appendChild(row);
    }
  }

  async function addAsset() {
    const kindLbl = prompt('口座種別を選択してください:\n  1: 新NISA(つみたて)\n  2: 新NISA(成長)\n  3: 特定口座\n  4: 個別株\n  5: 暗号資産\n  6: 現金・預金', '1');
    const kindMap = { '1': 'nisa_tsumitate', '2': 'nisa_growth', '3': 'tokutei', '4': 'stock', '5': 'crypto', '6': 'cash' };
    const kind = kindMap[kindLbl];
    if (!kind) return;
    const balStr = prompt('現在残高（円）', '0');
    const monthlyStr = prompt('毎月積立額（円）', '50000');
    let expectedReturn = 0.04;
    let scenario = 'neutral';
    if (kind === 'stock' || kind === 'crypto') {
      const sc = prompt('シナリオ: strong / neutral / weak', 'neutral');
      scenario = ['strong', 'neutral', 'weak'].includes(sc) ? sc : 'neutral';
    } else if (kind === 'cash') {
      expectedReturn = 0.001;
    } else {
      const retStr = prompt('期待年利回り（%）：S&P500=5, 全世界=4, バランス=3', '4');
      expectedReturn = (parseFloat(retStr) || 4) / 100;
    }
    await dbPut('assets', {
      id: uid(),
      kind,
      currentBalance: parseInt(balStr) || 0,
      monthlyContribution: parseInt(monthlyStr) || 0,
      expectedReturn,
      scenario
    });
    renderAssets();
  }

  $('btn-add-asset').addEventListener('click', addAsset);

  // MF CSV インポート
  const mfDrop = $('mf-drop');
  const mfFile = $('mf-file');
  let mfParsed = null;

  mfDrop.addEventListener('click', () => mfFile.click());
  mfDrop.addEventListener('dragover', (e) => { e.preventDefault(); mfDrop.classList.add('dragging'); });
  mfDrop.addEventListener('dragleave', () => mfDrop.classList.remove('dragging'));
  mfDrop.addEventListener('drop', (e) => {
    e.preventDefault();
    mfDrop.classList.remove('dragging');
    if (e.dataTransfer.files[0]) handleMfFile(e.dataTransfer.files[0]);
  });
  mfFile.addEventListener('change', (e) => {
    if (e.target.files[0]) handleMfFile(e.target.files[0]);
  });

  function parseMfCsv(text) {
    // MF CSVは「資産推移」または「資産一覧」のフォーマット。代表列に対応
    // 想定列: "名称", "種別", "残高", "評価額" のいずれか
    const lines = text.split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) return [];
    const header = lines[0].split(',').map(s => s.replace(/"/g, '').trim());
    const nameIdx = header.findIndex(h => /名称|口座|銘柄|資産/.test(h));
    const amountIdx = header.findIndex(h => /残高|評価額|時価|金額/.test(h));
    const kindIdx = header.findIndex(h => /種別|カテゴリ|分類/.test(h));
    if (nameIdx < 0 || amountIdx < 0) return [];

    const results = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',').map(s => s.replace(/"/g, '').trim());
      const name = cols[nameIdx];
      const amount = parseInt((cols[amountIdx] || '').replace(/[,円¥ ]/g, '')) || 0;
      const kindRaw = (kindIdx >= 0 ? cols[kindIdx] : '').toLowerCase();
      if (!name || amount === 0) continue;
      let kind = 'cash';
      if (/nisa|つみたて/i.test(name + kindRaw)) kind = 'nisa_tsumitate';
      else if (/成長投資|成長枠/.test(name + kindRaw)) kind = 'nisa_growth';
      else if (/特定|投信|投資信託/.test(name + kindRaw)) kind = 'tokutei';
      else if (/株|個別|us_stock/i.test(name + kindRaw)) kind = 'stock';
      else if (/暗号|crypto|bitcoin|btc|eth/i.test(name + kindRaw)) kind = 'crypto';
      else if (/預金|普通|定期|貯金|現金/.test(name + kindRaw)) kind = 'cash';
      results.push({ name, amount, kind });
    }
    return results;
  }

  async function handleMfFile(file) {
    const text = await file.text();
    const parsed = parseMfCsv(text);
    if (parsed.length === 0) {
      alert('CSVを解析できませんでした。列名「名称」「残高」または「評価額」を含めてください。');
      return;
    }
    const existing = await dbAll('assets');
    // 種別で集計して既存残高と比較
    const summary = {};
    for (const p of parsed) {
      summary[p.kind] = (summary[p.kind] || 0) + p.amount;
    }
    mfParsed = { parsed, summary };

    const box = $('mf-diff-list');
    box.innerHTML = '';
    const kindLabel = {
      nisa_tsumitate: '新NISA(つみたて)',
      nisa_growth: '新NISA(成長)',
      tokutei: '特定口座',
      stock: '個別株',
      crypto: '暗号資産',
      cash: '現金・預金'
    };
    for (const [kind, amount] of Object.entries(summary)) {
      const exi = existing.find(e => e.kind === kind);
      const before = exi ? exi.currentBalance : 0;
      const row = el('div', { class: 'diff-row' });
      row.appendChild(el('div', {}, kindLabel[kind] || kind));
      const right = el('div', {});
      right.appendChild(el('span', { class: 'diff-before' }, yen(before)));
      right.appendChild(el('span', { class: 'diff-arrow' }, ' → '));
      right.appendChild(el('span', { class: 'diff-after' }, yen(amount)));
      row.appendChild(right);
      box.appendChild(row);
    }
    $('mf-diff-area').classList.remove('hidden');
  }

  $('mf-apply').addEventListener('click', async () => {
    if (!mfParsed) return;
    const existing = await dbAll('assets');
    for (const [kind, amount] of Object.entries(mfParsed.summary)) {
      const exi = existing.find(e => e.kind === kind);
      if (exi) {
        exi.currentBalance = amount;
        await dbPut('assets', exi);
      } else {
        await dbPut('assets', {
          id: uid(),
          kind,
          currentBalance: amount,
          monthlyContribution: 0,
          expectedReturn: kind === 'cash' ? 0.001 : 0.04,
          scenario: 'neutral'
        });
      }
    }
    // スナップショット保存
    await dbPut('mfSnapshots', {
      id: uid(),
      importedAt: nowSec(),
      balances: mfParsed.parsed
    });
    $('mf-diff-area').classList.add('hidden');
    mfParsed = null;
    alert('残高を更新しました');
    renderAssets();
    renderHome();
  });

  // ============ イベントタブ ============
  function renderEventTemplates() {
    const box = $('event-templates');
    box.innerHTML = '';
    if (!eventTemplates) return;
    for (const t of eventTemplates.templates) {
      const chip = el('button', {
        class: 'chip',
        onclick: async () => {
          const ageStr = prompt(`${t.label} を開始する年齢`, String(t.startAge));
          const amountStr = prompt(`金額（円）`, String(t.amountDefault));
          await dbPut('events', {
            id: uid(),
            label: t.label,
            category: t.category,
            startAge: parseInt(ageStr) || t.startAge,
            everyYears: t.everyYears,
            amount: parseInt(amountStr) || t.amountDefault
          });
          renderEvents();
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
    for (const e of list) {
      const row = el('div', { class: 'item' });
      const main = el('div', { class: 'item-main' });
      main.appendChild(el('div', { class: 'item-title' }, `${e.label}：${yen(e.amount)}`));
      const freq = e.everyYears > 0 ? `${e.startAge}歳から${e.everyYears}年ごと` : `${e.startAge}歳で単発`;
      main.appendChild(el('div', { class: 'item-sub' }, freq));
      row.appendChild(main);
      row.appendChild(el('button', {
        class: 'btn small danger',
        onclick: async () => { await dbDelete('events', e.id); renderEvents(); }
      }, '削除'));
      box.appendChild(row);
    }
  }

  async function addFreeEvent() {
    const label = prompt('イベント名', '車買替');
    if (!label) return;
    const amountStr = prompt('金額（円）', '1000000');
    const ageStr = prompt('開始年齢', '40');
    const everyStr = prompt('繰り返し（年、0=単発）', '0');
    await dbPut('events', {
      id: uid(),
      label,
      category: 'other',
      amount: parseInt(amountStr) || 0,
      startAge: parseInt(ageStr) || 40,
      everyYears: parseInt(everyStr) || 0
    });
    renderEvents();
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
