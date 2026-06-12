import { init } from '@instantdb/admin';
import { tenantQuery } from './db-pg.js';

const APP_ID = process.env.VITE_INSTANT_APP_ID;
const ADMIN_TOKEN = process.env.INSTANT_ADMIN_TOKEN;

// When USE_PG_DATA=true (dev .env only): fetch leads from Postgres with RLS.
// When unset/false (prod default): fetch from InstantDB with 15s in-memory cache.
// All 8+ callers (leads-page, dashboard-stats, call-logs-page, etc.) share this
// function — one change upgrades all endpoints simultaneously.
const USE_PG_DATA = process.env.USE_PG_DATA === 'true';

// ── InstantDB path: shared 15s in-memory cache ───────────────────
const cache = new Map(); // ownerId -> { leads, ts }
const TTL = 15 * 1000;

let _db = null;
function getDb() {
  if (!_db) _db = init({ appId: APP_ID, adminToken: ADMIN_TOKEN });
  return _db;
}

// ── Postgres path: per-request, RLS enforced ─────────────────────
// No in-memory cache needed — Postgres with indexes is fast enough,
// and RLS guarantees tenant isolation even without a cache TTL.
async function getLeadsFromPg(ownerId) {
  const result = await tenantQuery(
    ownerId,
    'SELECT id, doc, created_at, updated_at FROM leads ORDER BY created_at DESC'
  );
  return result.rows.map(r => ({
    ...r.doc,
    id: r.id, // id ALWAYS comes from the column — doc may not contain it
    // Ensure timestamp fields are numbers (ms) for all downstream logic
    createdAt:  r.doc.createdAt  ?? new Date(r.created_at).getTime(),
    updatedAt:  r.doc.updatedAt  ?? new Date(r.updated_at).getTime(),
    followup:   r.doc.followup,
    assignedAt: r.doc.assignedAt,
  }));
}

export async function getLeadsForOwner(ownerId) {
  if (USE_PG_DATA) return getLeadsFromPg(ownerId);

  // InstantDB path (prod default)
  const hit = cache.get(ownerId);
  if (hit && Date.now() - hit.ts < TTL) return hit.leads;
  const db = getDb();
  const result = await db.query({
    leads: { $: { where: { userId: ownerId } } },
  });
  const leads = result.leads || [];
  cache.set(ownerId, { leads, ts: Date.now() });
  return leads;
}

export function invalidateLeadsCache(ownerId) {
  if (ownerId) cache.delete(ownerId);
  else cache.clear();
}
