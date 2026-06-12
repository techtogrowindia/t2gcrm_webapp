// ===================================================================
// api/_write-ops.js — shared server-side write router (InstantDB ↔ Postgres)
//
// Lets any server endpoint build a backend-agnostic ops array and run it
// on whichever backend is active (USE_PG_DATA flag), exactly like data.js.
//
//   import { opU, opD, runOps } from './_write-ops.js';
//   await runOps(db, ownerId, [ opU('leads', id, data), opD('x', id2) ]);
//
// ownerId is the tenant (tenant_id in Postgres). For collections keyed by
// ownerId in InstantDB (e.g. callLogSyncState), pass that same ownerId.
// ===================================================================
import { tx } from '@instantdb/admin';
import { pgRunOps } from './data-pg.js';

const USE_PG_DATA = process.env.USE_PG_DATA === 'true';

export const opU = (collection, _id, data) => ({ action: 'upsert', collection, id: _id, data });
export const opD = (collection, _id) => ({ action: 'delete', collection, id: _id });

export async function runOps(db, ownerId, ops) {
  const clean = (ops || []).filter(Boolean);
  if (!clean.length) return;
  if (USE_PG_DATA) return pgRunOps(ownerId, clean);
  const txs = clean.map(op => op.action === 'delete'
    ? tx[op.collection][op.id].delete()
    : tx[op.collection][op.id].update(op.data));
  const B = 100;
  for (let i = 0; i < txs.length; i += B) await db.transact(txs.slice(i, i + B));
}

export { USE_PG_DATA };
