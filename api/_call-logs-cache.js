import { init } from '@instantdb/admin';
import { tenantQuery } from './db-pg.js';

const APP_ID = process.env.VITE_INSTANT_APP_ID;
const ADMIN_TOKEN = process.env.INSTANT_ADMIN_TOKEN;

// When USE_PG_DATA=true (dev .env only): fetch call logs from Postgres with RLS.
// When unset/false (prod default): fetch from InstantDB with 30s in-memory cache.
// All callers (call-logs-page, team-stats, call-logs batch sync) share this.
const USE_PG_DATA = process.env.USE_PG_DATA === 'true';

// ── InstantDB path: shared 30s in-memory cache ───────────────────
const cache = new Map(); // ownerId -> { logs, ts }
const TTL = 30 * 1000;  // call logs change slower than leads

let _db = null;
function getDb() {
  if (!_db) _db = init({ appId: APP_ID, adminToken: ADMIN_TOKEN });
  return _db;
}

// ── Postgres path: per-request, RLS enforced ─────────────────────
async function getCallLogsFromPg(ownerId) {
  const result = await tenantQuery(
    ownerId,
    'SELECT doc, created_at FROM call_logs ORDER BY created_at DESC'
  );
  return result.rows.map(r => ({
    ...r.doc,
    createdAt: r.doc.createdAt ?? new Date(r.created_at).getTime(),
  }));
}

export async function getCallLogsForOwner(ownerId) {
  if (USE_PG_DATA) return getCallLogsFromPg(ownerId);

  // InstantDB path (prod default)
  const hit = cache.get(ownerId);
  if (hit && Date.now() - hit.ts < TTL) return hit.logs;
  const db = getDb();
  const result = await db.query({
    callLogs: { $: { where: { userId: ownerId } } },
  });
  const logs = result.callLogs || [];
  cache.set(ownerId, { logs, ts: Date.now() });
  return logs;
}

export function invalidateCallLogsCache(ownerId) {
  if (ownerId) cache.delete(ownerId);
  else cache.clear();
}
