// ===================================================================
// src/utils/dbWrite.js — Write helper for the Postgres migration
//
// When VITE_USE_PG_DATA=true: routes writes to /api/data-pg (Postgres)
// When unset/false (prod default): uses db.transact (InstantDB)
//
// Usage (replaces db.transact([...]) calls):
//
//   import { dbWrite, dbOp } from '../../utils/dbWrite';
//
//   // Single op:
//   await dbWrite(dbOp.update('leads', leadId, { stage: 'Won' }));
//
//   // Multiple ops atomically:
//   await dbWrite([
//     dbOp.update('leads',       leadId, { stage: 'Won' }),
//     dbOp.update('activityLogs', logId, { action: 'stage_changed' }),
//   ]);
//
//   // Delete:
//   await dbWrite(dbOp.delete('leads', leadId));
// ===================================================================
import db from '../instant';
import { pgAuthGetToken, pgAuthHandleUnauthorized } from '../hooks/useAuthPg';
import { instantToPgSpec } from '../hooks/usePgQuery';

const USE_PG_DATA = import.meta.env.VITE_USE_PG_DATA === 'true';

// One-off query (not a hook). Routes to Postgres when the flag is on, else
// InstantDB db.query. Use this to replace `await db.query(...)` in event
// handlers — db.query hangs under PG auth (no InstantDB session).
export async function dbQueryOnce(querySpec) {
  if (!USE_PG_DATA) return db.query(querySpec);
  const token = pgAuthGetToken();
  if (!token) throw new Error('Not authenticated');
  const res = await fetch('/api/data-pg', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ action: 'query', queries: instantToPgSpec(querySpec) }),
  });
  if (pgAuthHandleUnauthorized(res)) return new Promise(() => {}); // expired — page is reloading
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Query failed');
  return json.data;
}

// ── Op builders ───────────────────────────────────────────────────
export const dbOp = {
  /** Insert or update a record */
  update: (collection, id, data) => ({ action: 'upsert', collection, id, data }),
  /** Delete a record */
  delete: (collection, id) => ({ action: 'delete', collection, id }),
};

// ── Write (single op or array of ops) ────────────────────────────
export async function dbWrite(opsInput) {
  const ops = Array.isArray(opsInput) ? opsInput : [opsInput];

  if (USE_PG_DATA) {
    const token = pgAuthGetToken();
    if (!token) throw new Error('Not authenticated — no JWT token found');

    const body = ops.length === 1
      ? { ...ops[0] }                       // single op
      : { action: 'batch', ops };           // batch

    const res = await fetch('/api/data-pg', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });
    if (pgAuthHandleUnauthorized(res)) return new Promise(() => {}); // expired — page is reloading
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || 'Write to Postgres failed');
    // Notify all active usePgQuery hooks to refetch (PG is not real-time).
    // This gives refetch-after-mutation app-wide without per-component calls.
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('pg-data-changed'));
    return result;
  }

  // InstantDB path — convert back to db.tx operations
  const txs = ops.map(op => {
    if (op.action === 'delete') return db.tx[op.collection][op.id].delete();
    return db.tx[op.collection][op.id].update(op.data);
  });
  return db.transact(txs);
}

// ── Convenience: single update ────────────────────────────────────
export async function dbUpdate(collection, id, data) {
  return dbWrite(dbOp.update(collection, id, data));
}

// ── Convenience: single delete ────────────────────────────────────
export async function dbDelete(collection, id) {
  return dbWrite(dbOp.delete(collection, id));
}
