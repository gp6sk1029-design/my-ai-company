// マネーフォワードCSVインポート（サーバサイドスタブ）
// 現状はクライアントでCSVをパースして直接IndexedDBへ書き込むため、
// このエンドポイントは将来のOAuth連携や共有機能のプレースホルダ。
// POST /api/mf-import  body: { csv }
// response: { ok, parsed: [{name, amount, kind}] }

export async function onRequestPost({ request }) {
  const body = await request.json().catch(() => null);
  if (!body || !body.csv) {
    return json({ ok: false, error: 'csv required' }, 400);
  }
  const parsed = parseMfCsv(body.csv);
  return json({ ok: true, parsed });
}

function parseMfCsv(text) {
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
    else if (/株|個別/i.test(name + kindRaw)) kind = 'stock';
    else if (/暗号|crypto|bitcoin|btc|eth/i.test(name + kindRaw)) kind = 'crypto';
    else if (/預金|普通|定期|貯金|現金/.test(name + kindRaw)) kind = 'cash';
    results.push({ name, amount, kind });
  }
  return results;
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}
