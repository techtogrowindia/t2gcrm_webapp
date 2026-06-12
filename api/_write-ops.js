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
import { pgRunOps, pgRead } from './data-pg.js';

const USE_PG_DATA = process.env.USE_PG_DATA === 'true';

// Read-side mirror of db.query — routes to Postgres when active. Use in
// server endpoints that read reference data while writing (keeps read/write
// on the same backend). Cross-tenant lookups stay on InstantDB (pass-through).
export async function readData(db, tenantId, querySpec) {
  if (USE_PG_DATA && tenantId) return pgRead(tenantId, querySpec);
  return db.query(querySpec);
}

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

// For crons that accumulate ops across MANY owners in one array.
// Each op should carry `_owner` (tenant); falls back to op.data.userId.
// PG: groups by owner and runs one transaction per owner.
// InstantDB: one db.transact for everything (owner-agnostic), as before.
export async function runOpsByOwner(db, ops) {
  const clean = (ops || []).filter(Boolean);
  if (!clean.length) return;
  if (!USE_PG_DATA) {
    const txs = clean.map(op => op.action === 'delete'
      ? tx[op.collection][op.id].delete()
      : tx[op.collection][op.id].update(op.data));
    const B = 100;
    for (let i = 0; i < txs.length; i += B) await db.transact(txs.slice(i, i + B));
    return;
  }
  const byOwner = new Map();
  for (const op of clean) {
    const owner = op._owner || op.data?.userId;
    if (!owner) continue; // can't route without a tenant
    if (!byOwner.has(owner)) byOwner.set(owner, []);
    byOwner.get(owner).push(op);
  }
  for (const [owner, ownerOps] of byOwner) await pgRunOps(owner, ownerOps);
}

export { USE_PG_DATA };
