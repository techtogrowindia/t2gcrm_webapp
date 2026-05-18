import { init } from '@instantdb/admin';

const APP_ID = process.env.VITE_INSTANT_APP_ID;
const ADMIN_TOKEN = process.env.INSTANT_ADMIN_TOKEN;

// Per-owner activity-logs cache (15s TTL) so repeated requests during a
// session (date-filter changes, drawer opens) share one underlying query.
const cache = new Map();
const TTL = 15 * 1000;

async function getLogsForOwner(db, ownerId) {
  const hit = cache.get(ownerId);
  if (hit && Date.now() - hit.ts < TTL) return hit.logs;
  const result = await db.query({
    activityLogs: { $: { where: { userId: ownerId } } },
  });
  const logs = result.activityLogs || [];
  cache.set(ownerId, { logs, ts: Date.now() });
  return logs;
}

// POST /api/team-activity
// Body: { ownerId, startMs, endMs }
// Returns: { logs }  — activity logs for this owner within the date range.
// Replaces the limit:2000 client subscription which returned arbitrary rows
// (often oldest) and at scale also hit the InstantDB WebSocket timeout.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const { ownerId, startMs, endMs } = req.body || {};
    if (!ownerId) return res.status(400).json({ error: 'ownerId required' });

    const db = init({ appId: APP_ID, adminToken: ADMIN_TOKEN });
    const all = await getLogsForOwner(db, ownerId);

    const sMs = typeof startMs === 'number' ? startMs : 0;
    const eMs = typeof endMs === 'number' ? endMs : Date.now() + 86400000;

    const logs = all.filter(l => {
      const t = l.createdAt || 0;
      return t >= sMs && t <= eMs;
    });

    return res.status(200).json({ logs, total: all.length, inRange: logs.length });
  } catch (err) {
    console.error('team-activity error:', err);
    return res.status(500).json({ error: err.message });
  }
}
