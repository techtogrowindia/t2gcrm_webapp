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
// Fold raw logs into the two shapes Follow-up Status needs.
//
//   summary   { leadId: [lastActivityMs, lastRescheduleMs] }
//   movedFrom { leadId: ['YYYY-MM-DD', ...] }  dates the lead was rescheduled
//             AWAY from
//
// movedFrom exists because the report used to select leads by their CURRENT
// follow-up date. Working a lead almost always reschedules it, which moved it
// out of the day being reported on — so the day's list drained down to exactly
// the leads nobody had touched, and everything read "untouched". Verified on
// production: 219 leads worked in a day, 0 of them still dated that day.
//
// The reschedule log records where the follow-up came FROM, so a lead moved off
// the 27th can still be counted against the 27th — as rescheduled, which is
// what actually happened.
//
// 'bulk' is skipped: it's the synthetic entityId used for bulk-action summary
// rows (LeadsView), not a real lead.
const MONTHS = { jan:1, feb:2, mar:3, apr:4, may:5, jun:6, jul:7, aug:8, sep:9, oct:10, nov:11, dec:12 };

// "27 Jul 2026, 04:30 pm" -> "2026-07-27". Built from the matched digits rather
// than a Date object, so the server's timezone can't shift the day.
function parseDueDateKey(raw) {
  const m = /^\s*(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})/.exec(String(raw || ''));
  if (!m) return null;
  const mo = MONTHS[m[2].slice(0, 3).toLowerCase()];
  if (!mo) return null;
  return `${m[3]}-${String(mo).padStart(2, '0')}-${String(Number(m[1])).padStart(2, '0')}`;
}

const RESCHEDULE_RE = /follow\s*up changed/i;
const FROM_RE = /from\s+"([^"]*)"/i;

function summarise(logs) {
  const summary = {};
  const movedFrom = {};
  for (const l of logs) {
    const eid = l.entityId;
    if (!eid || eid === 'bulk') continue;
    // A lead's own creation entry is not work. Counting it marked every lead
    // as "worked" the moment it existed, which made "attended" meaningless and
    // hid the leads nobody had actually touched. Creation entries for other
    // entities (quotation, invoice) ARE work and are attached to those
    // records, not the lead, so only lead-creation is skipped.
    if (l.action === 'created' && l.entityType === 'lead') continue;
    const t = l.createdAt || 0;
    let e = summary[eid];
    if (!e) e = summary[eid] = [0, 0];
    if (t > e[0]) e[0] = t;

    const text = l.text || '';
    if (!RESCHEDULE_RE.test(text)) continue;
    if (t > e[1]) e[1] = t;

    // "from \"None\"" means it had no date before — nothing to attribute.
    const from = FROM_RE.exec(text);
    const key = from ? parseDueDateKey(from[1]) : null;
    if (!key) continue;
    const seen = movedFrom[eid] || (movedFrom[eid] = []);
    if (!seen.includes(key)) seen.push(key);
  }
  return { summary, movedFrom };
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
        const { summary, movedFrom } = summarise(all);
        return res.status(200).json({ summary, movedFrom, total: all.length, inRange: all.length });
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
      const { summary, movedFrom } = summarise(logs);
      return res.status(200).json({ summary, movedFrom, total: all.length, inRange: logs.length });
    }
    return res.status(200).json({ logs, total: all.length, inRange: logs.length });
  } catch (err) {
    console.error('team-activity error:', err);
    return res.status(500).json({ error: err.message });
  }
}
