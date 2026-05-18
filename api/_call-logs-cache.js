import { init } from '@instantdb/admin';

const APP_ID = process.env.VITE_INSTANT_APP_ID;
const ADMIN_TOKEN = process.env.INSTANT_ADMIN_TOKEN;

// Shared per-owner call-logs cache. /api/call-logs-page and /api/team-stats
// both read the full call-log set for an owner and derive aggregates from
// it — sharing this cache means concurrent hits within 30s share one
// admin-SDK query.
const cache = new Map(); // ownerId -> { logs, ts }
const TTL = 30 * 1000;   // call logs change slower than leads — slightly longer TTL

let _db = null;
function getDb() {
  if (!_db) _db = init({ appId: APP_ID, adminToken: ADMIN_TOKEN });
  return _db;
}

export async function getCallLogsForOwner(ownerId) {
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
