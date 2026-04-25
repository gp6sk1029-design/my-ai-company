// ライフプランくん D1同期エンドポイント
// POST /api/sync  body: { householdId, since, changes: {store: [obj, ...]} }
// response: { ok, changes: {store: [obj, ...]}, serverTime }

const SYNC_STORES = ['household', 'members', 'income', 'expense', 'education', 'assets', 'events', 'mfSnapshots'];

export async function onRequestPost({ request, env }) {
  if (!env.DB) {
    return json({ ok: false, error: 'D1 binding missing' }, 500);
  }
  const body = await request.json().catch(() => null);
  if (!body || !body.householdId) {
    return json({ ok: false, error: 'householdId required' }, 400);
  }
  const { householdId, since = 0, changes = {} } = body;
  const now = Math.floor(Date.now() / 1000);

  // push（クライアント→サーバ）
  for (const store of SYNC_STORES) {
    const list = changes[store] || [];
    for (const obj of list) {
      const payload = JSON.stringify(obj);
      if (store === 'household') {
        await env.DB.prepare(
          `INSERT INTO households (id, payload, updatedAt, deletedAt)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(id) DO UPDATE SET
               payload = excluded.payload,
               updatedAt = excluded.updatedAt,
               deletedAt = excluded.deletedAt
             WHERE excluded.updatedAt >= households.updatedAt`
        ).bind(householdId, payload, obj.updatedAt || now, obj.deletedAt || null).run();
      } else {
        await env.DB.prepare(
          `INSERT INTO ${store} (householdId, id, payload, updatedAt, deletedAt)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(householdId, id) DO UPDATE SET
               payload = excluded.payload,
               updatedAt = excluded.updatedAt,
               deletedAt = excluded.deletedAt
             WHERE excluded.updatedAt >= ${store}.updatedAt`
        ).bind(householdId, obj.id, payload, obj.updatedAt || now, obj.deletedAt || null).run();
      }
    }
  }

  // pull（サーバ→クライアント）
  const out = {};
  for (const store of SYNC_STORES) {
    let rows;
    if (store === 'household') {
      rows = await env.DB.prepare(
        'SELECT payload FROM households WHERE id = ? AND updatedAt > ?'
      ).bind(householdId, since).all();
    } else {
      rows = await env.DB.prepare(
        `SELECT payload FROM ${store} WHERE householdId = ? AND updatedAt > ?`
      ).bind(householdId, since).all();
    }
    out[store] = (rows.results || []).map(r => JSON.parse(r.payload));
  }

  return json({ ok: true, changes: out, serverTime: now });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}
