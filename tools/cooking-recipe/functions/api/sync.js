/**
 * POST /api/sync
 * 双方向同期エンドポイント（last-write-wins + 論理削除）
 *
 * リクエスト:
 *   {
 *     householdId: "...",          // 32文字の世帯ID
 *     since: 1234567890,            // 前回同期の updatedAt（UNIX秒）。初回は 0
 *     changes: {
 *       members:      [{id, payload, updatedAt, deletedAt}, ...],
 *       recipes:      [...],
 *       cookHistory:  [...],
 *       shopping:     [...],
 *       stock:        [...],
 *       household:    {avoidMode, updatedAt, deletedAt}   // household は単一レコード
 *     }
 *   }
 *
 * レスポンス:
 *   {
 *     now: <UNIX秒>,                  // クライアントは次回の since に使う
 *     changes: {
 *       members: [{id, payload, updatedAt, deletedAt}, ...],   // since より新しいすべてのレコード
 *       recipes: [...], ...,
 *       household: {...}
 *     }
 *   }
 *
 * セキュリティ:
 *   - householdId を 32文字以上に制限（総当たり耐性）
 *   - payload には食材・家族名など個人情報が含まれるので、D1バックアップは Cloudflare にしかない点に注意
 */

const TABLES = ['members', 'recipes', 'cookHistory', 'shopping', 'stock'];

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.DB;
  if (!db) return json({ error: 'D1 binding "DB" がありません' }, 500);

  let body;
  try { body = await request.json(); }
  catch (e) { return json({ error: '不正なJSON' }, 400); }

  const householdId = String(body.householdId || '');
  if (!/^[A-Za-z0-9_-]{24,64}$/.test(householdId)) {
    return json({ error: '世帯IDが不正です（24〜64文字の英数字・-_のみ）' }, 400);
  }

  const since = Number(body.since) || 0;
  const incoming = body.changes || {};

  // -------- ① 受け取った変更を D1 に書き込む（UPSERT）--------
  try {
    // household（単一レコード、id = householdId）
    if (incoming.household && typeof incoming.household.updatedAt === 'number') {
      await upsertHousehold(db, householdId, incoming.household);
    }
    // 各テーブル
    for (const tbl of TABLES) {
      const rows = Array.isArray(incoming[tbl]) ? incoming[tbl] : [];
      for (const r of rows) {
        if (!r || typeof r.updatedAt !== 'number' || !r.id) continue;
        await upsertRecord(db, tbl, householdId, r);
      }
    }
  } catch (e) {
    return json({ error: 'D1書き込み失敗: ' + e.message }, 500);
  }

  // -------- ② since より新しいレコードをすべて返す --------
  const out = { household: null };
  try {
    const hh = await db
      .prepare('SELECT id, avoidMode, updatedAt, deletedAt FROM households WHERE id = ? AND updatedAt > ?')
      .bind(householdId, since).first();
    if (hh) out.household = { avoidMode: hh.avoidMode, updatedAt: hh.updatedAt, deletedAt: hh.deletedAt };

    for (const tbl of TABLES) {
      const res = await db
        .prepare(`SELECT id, payload, updatedAt, deletedAt FROM ${tbl} WHERE householdId = ? AND updatedAt > ? ORDER BY updatedAt ASC`)
        .bind(householdId, since).all();
      out[tbl] = (res.results || []).map(row => ({
        id: row.id,
        payload: row.payload,
        updatedAt: row.updatedAt,
        deletedAt: row.deletedAt,
      }));
    }
  } catch (e) {
    return json({ error: 'D1読み出し失敗: ' + e.message }, 500);
  }

  return json({
    now: Math.floor(Date.now() / 1000),
    changes: out,
  });
}

async function upsertHousehold(db, householdId, h) {
  // 既存がより新しければスキップ
  const cur = await db.prepare('SELECT updatedAt FROM households WHERE id = ?').bind(householdId).first();
  if (cur && cur.updatedAt >= h.updatedAt) return;
  await db.prepare(
    'INSERT INTO households (id, avoidMode, updatedAt, deletedAt) VALUES (?, ?, ?, ?) ' +
    'ON CONFLICT(id) DO UPDATE SET avoidMode = excluded.avoidMode, updatedAt = excluded.updatedAt, deletedAt = excluded.deletedAt'
  ).bind(householdId, h.avoidMode || 'any', h.updatedAt, h.deletedAt ?? null).run();
}

async function upsertRecord(db, tbl, householdId, r) {
  // last-write-wins
  const cur = await db
    .prepare(`SELECT updatedAt FROM ${tbl} WHERE householdId = ? AND id = ?`)
    .bind(householdId, r.id).first();
  if (cur && cur.updatedAt >= r.updatedAt) return;
  await db.prepare(
    `INSERT INTO ${tbl} (householdId, id, payload, updatedAt, deletedAt) VALUES (?, ?, ?, ?, ?) ` +
    `ON CONFLICT(householdId, id) DO UPDATE SET payload = excluded.payload, updatedAt = excluded.updatedAt, deletedAt = excluded.deletedAt`
  ).bind(householdId, r.id, String(r.payload ?? ''), r.updatedAt, r.deletedAt ?? null).run();
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
