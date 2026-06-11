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
import { pgAuthGetToken } from '../hooks/useAuthPg';

const USE_PG_DATA = import.meta.env.VITE_USE_PG_DATA === 'true';

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
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || 'Write to Postgres failed');
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
