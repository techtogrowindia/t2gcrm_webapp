import { init } from '@instantdb/admin';
import { tenantQuery } from './db-pg.js';

const APP_ID = process.env.VITE_INSTANT_APP_ID;
const ADMIN_TOKEN = process.env.INSTANT_ADMIN_TOKEN;
const USE_PG_DATA = process.env.USE_PG_DATA === 'true';

// Per-owner activity-logs cache (15s TTL) — InstantDB path only
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
// Body: { ownerId, startMs, endMs, mode }
//
//   mode 'summary' → { summary: { <leadId>: [lastActivityMs, lastRescheduleMs] } }
//   default        → { logs, total, inRange }   (raw rows)
//
// Reports' Follow-up Status only needs those two timestamps per lead, but was
// pulling every raw log to derive them in the browser — ~12 MB and up to 14s
// on a wide date range, because the aggregation ran client-side over data that
// mostly got thrown away. 'summary' does the fold on the server, next to the
// rows, and sends back two numbers per lead instead.
//
// The raw shape stays the default: TeamReports renders individual log rows for
// a selected member's drilldown and genuinely needs them (it already fetches
// lazily, only once a member is picked).
// Fold raw logs into { leadId: [lastActivityMs, lastRescheduleMs] }.
// Arrays, not objects, to keep the payload small — this is the whole point.
// 'bulk' is skipped: it's the synthetic entityId used for bulk-action summary
// rows (LeadsView), not a real lead.
function summarise(logs) {
  const out = {};
  for (const l of logs) {
    const eid = l.entityId;
    if (!eid || eid === 'bulk') continue;
    const t = l.createdAt || 0;
    let e = out[eid];
    if (!e) e = out[eid] = [0, 0];
    if (t > e[0]) e[0] = t;
    if (t > e[1] && /follow\s*up changed/i.test(l.text || '')) e[1] = t;
  }
  return out;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const { ownerId, startMs, endMs, mode } = req.body || {};
    if (!ownerId) return res.status(400).json({ error: 'ownerId required' });

    const sMs = typeof startMs === 'number' ? startMs : 0;
    const eMs = typeof endMs === 'number' ? endMs : Date.now() + 86400000;

    let all;
    if (USE_PG_DATA) {
      // Push date filter to SQL — only fetch rows in range (much faster at scale)
      const result = await tenantQuery(
        ownerId,
        `SELECT id, doc, created_at FROM activity_logs
         WHERE created_at >= $1 AND created_at <= $2
         ORDER BY created_at DESC`,
        [new Date(sMs).toISOString(), new Date(eMs).toISOString()]
      );
      all = result.rows.map(r => ({
        ...r.doc,
        id: r.id,
        createdAt: r.doc.createdAt ?? new Date(r.created_at).getTime(),
      }));
      if (mode === 'summary') {
        return res.status(200).json({ summary: summarise(all), total: all.length, inRange: all.length });
      }
      return res.status(200).json({ logs: all, total: all.length, inRange: all.length });
    }

    // InstantDB path — fetch all then filter in JS
    const db = init({ appId: APP_ID, adminToken: ADMIN_TOKEN });
    all = await getLogsForOwner(db, ownerId);
    const logs = all.filter(l => {
      const t = l.createdAt || 0;
      return t >= sMs && t <= eMs;
    });
    if (mode === 'summary') {
      return res.status(200).json({ summary: summarise(logs), total: all.length, inRange: logs.length });
    }
    return res.status(200).json({ logs, total: all.length, inRange: logs.length });
  } catch (err) {
    console.error('team-activity error:', err);
    return res.status(500).json({ error: err.message });
  }
}
