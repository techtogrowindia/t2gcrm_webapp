// ===================================================================
// api/dashboard-widgets.js — data for the customizable dashboard's widgets.
//
// One request for all of a viewer's widgets, not one per widget. With 11k+
// leads and 27k+ call logs the difference between a batched aggregate and a
// dozen round trips is the difference between a dashboard that loads and one
// that doesn't.
//
// Only serves widgets that need data the existing dashboard path can't supply.
// The original tiles/sections still come from the component's own queries
// (gated by permission in Dashboard.jsx) — duplicating them here would mean
// two code paths for the same number, and they would drift.
//
// Identity comes from the VERIFIED bearer token, never the body. Permissions
// are resolved server-side, so a hand-edited layout asking for a widget the
// caller can't have is refused rather than filled in.
// ===================================================================
import { init } from '@instantdb/admin';
import { getLeadsForOwner } from './_leads-cache.js';
import { getCallLogsForOwner } from './_call-logs-cache.js';
import { rollupRepeatAttempts, isUnpickedCall } from './_shared-call-logs.js';
import { readData } from './_write-ops.js';
import { resolveCallerPerms } from './_shared-perms.js';
import { isWidgetAllowed } from './_shared-dashboard-widgets.js';
import { parseDateValue } from './_shared-dates.js';
import { verifyJwt } from './auth-pg.js';

const APP_ID = process.env.VITE_INSTANT_APP_ID;
const ADMIN_TOKEN = process.env.INSTANT_ADMIN_TOKEN;

const RESP_TTL = 20 * 1000;
const responseCache = new Map();

/**
 * Identity from the bearer token. Supports both auth stacks: the PG JWT
 * (current) and an InstantDB session token (legacy). Returns null when the
 * token is absent or unverifiable — callers must treat that as 401.
 */
async function identify(req, db) {
  const raw = req.headers.authorization || req.headers.Authorization || '';
  const token = String(raw).replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;

  try {
    const payload = verifyJwt(token);
    if (payload?.email) return { email: payload.email, tenantId: payload.tenantId };
  } catch { /* not a PG JWT — try InstantDB below */ }

  try {
    // No verifyToken in the admin SDK; asUser + a trivial query is the
    // supported way to prove a token is real (same approach as secure-data.js).
    const asUser = db.asUser({ token });
    const r = await asUser.query({ $users: {} });
    const email = r?.$users?.[0]?.email;
    if (email) return { email, tenantId: null };
  } catch { /* fall through */ }

  return null;
}

const startOfDay = (ms) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const {
      ownerId,
      widgets = [],
      dayStartMs = startOfDay(Date.now()),
      dayEndMs = startOfDay(Date.now()) + 86400000,
      untouchedDays = 7,
    } = req.body || {};

    if (!ownerId) return res.status(400).json({ error: 'ownerId required' });
    if (!Array.isArray(widgets) || widgets.length === 0) return res.status(200).json({ widgets: {} });

    const db = init({ appId: APP_ID, adminToken: ADMIN_TOKEN });

    const who = await identify(req, db);
    if (!who) return res.status(401).json({ error: 'Missing or invalid Authorization bearer token' });

    // A PG JWT carries its own tenant. If the caller asks for a different one,
    // refuse — don't let a valid token for tenant A read tenant B.
    if (who.tenantId && String(who.tenantId) !== String(ownerId)) {
      return res.status(403).json({ error: 'Token does not belong to this workspace' });
    }

    const perms = await resolveCallerPerms(ownerId, who.email, { db });

    // Server-side gate. Anything the caller isn't entitled to is reported back
    // as denied and never computed — a tampered layout gets nothing, not zeros.
    const granted = widgets.filter(id => isWidgetAllowed(id, perms));
    const denied = widgets.filter(id => !granted.includes(id));
    if (granted.length === 0) return res.status(200).json({ widgets: {}, denied });

    const cacheKey = `${ownerId}|${who.email}|${granted.slice().sort().join(',')}|${dayStartMs}|${untouchedDays}`;
    const hit = responseCache.get(cacheKey);
    if (hit && Date.now() - hit.ts < RESP_TTL) {
      return res.status(200).json({ ...hit.data, denied, cached: true });
    }

    const want = new Set(granted);
    const need = {
      leads:    ['my-day', 'leads-untouched', 'team-leaderboard', 'target-progress'].some(w => want.has(w)),
      calls:    ['calls-today', 'calls-connected', 'call-heatmap', 'team-leaderboard'].some(w => want.has(w)),
      activity: want.has('leads-untouched'),
      tasks:    want.has('my-day'),
      appts:    want.has('my-day'),
      invoices: want.has('receivables'),
      members:  ['team-leaderboard', 'target-progress'].some(w => want.has(w)),
      profile:  want.has('target-progress'),
    };

    // Fetch each source at most once, in parallel, and only when some granted
    // widget actually needs it.
    const [leads, callLogs, other] = await Promise.all([
      need.leads ? getLeadsForOwner(ownerId) : Promise.resolve([]),
      need.calls ? getCallLogsForOwner(ownerId) : Promise.resolve([]),
      readData(db, ownerId, {
        ...(need.tasks ? { tasks: { $: { where: { userId: ownerId } } } } : {}),
        ...(need.appts ? { appointments: { $: { where: { userId: ownerId } } } } : {}),
        ...(need.invoices ? { invoices: { $: { where: { userId: ownerId } } } } : {}),
        ...(need.members ? { teamMembers: { $: { where: { userId: ownerId } } } } : {}),
        ...(need.activity ? { activityLogs: { $: { where: { userId: ownerId } } } } : {}),
        ...(need.profile ? { userProfiles: { $: { where: { userId: ownerId } } } } : {}),
      }),
    ]);

    const myName = String(perms.name || '').trim().replace(/\s+/g, ' ');
    const myEmail = String(who.email || '').toLowerCase();
    // Leads/tasks are attributed by NAME (l.assign, task.assignee) — the app's
    // long-standing model. Calls and activity logs use email/id and are exact.
    // A renamed member silently loses their name-keyed rows; that's the known
    // assignedToId migration, inherited here rather than introduced.
    const mine = (assigned) => perms.isOwner
      || String(assigned || '').trim().replace(/\s+/g, ' ') === myName;

    const out = {};

    if (want.has('my-day')) {
      const items = [];
      let overdueCount = 0, todayCount = 0;
      for (const l of leads) {
        const f = typeof l.followup === 'number' ? l.followup : Date.parse(l.followup);
        if (!f || isNaN(f)) continue;
        if (!mine(l.assign)) continue;
        const due = f < dayStartMs;
        // Overdue follow-ups belong here. Restricting My Day to strictly-today
        // made it permanently empty for the way this business works: they carry
        // hundreds of overdue follow-ups and schedule everything forward, so on
        // a typical day NOBODY has a follow-up dated today. A panel that reads
        // "nothing scheduled" while a rep has 151 overdue is worse than useless.
        if (!due && (f < dayStartMs || f >= dayEndMs)) continue;
        if (due) overdueCount++; else todayCount++;
        items.push({
          at: f, kind: 'followup', id: l.id, title: l.name,
          phone: l.phone || '', email: l.email || '',
          sub: l.phone || '', tag: l.stage || '', overdue: due,
        });
      }
      for (const t of (other.tasks || [])) {
        const dueAt = typeof t.dueDate === 'number' ? t.dueDate : Date.parse(t.dueDate);
        if (!dueAt || isNaN(dueAt) || dueAt < dayStartMs || dueAt >= dayEndMs) continue;
        if (String(t.status || '').toLowerCase() === 'completed') continue;
        if (!mine(t.assignee)) continue;
        todayCount++;
        items.push({ at: dueAt, kind: 'task', id: t.id, title: t.title || t.name || 'Task', sub: t.priority || '', tag: t.status || '' });
      }
      for (const a of (other.appointments || [])) {
        // Appointments store 'YYYY-MM-DD' plus 'HH:MM' — build the instant in
        // the same local frame the caller's day window came from.
        const at = Date.parse(`${a.date}T${(a.time || '00:00')}:00`);
        if (!at || isNaN(at) || at < dayStartMs || at >= dayEndMs) continue;
        todayCount++;
        items.push({ at, kind: 'appointment', id: a.id, title: a.customerName || 'Appointment', phone: a.customerPhone || '', sub: a.service || '', tag: a.customerPhone || '' });
      }
      // Oldest overdue first (they have waited longest), then today in time
      // order — the sequence a rep should actually work through.
      items.sort((x, y) => (y.overdue ? 1 : 0) - (x.overdue ? 1 : 0) || x.at - y.at);
      out['my-day'] = {
        items: items.slice(0, 50),
        total: items.length,
        overdueCount,
        todayCount,
      };
    }

    if (want.has('leads-untouched')) {
      const cutoff = Date.now() - untouchedDays * 86400000;
      const lastTouch = new Map();
      for (const lg of (other.activityLogs || [])) {
        const t = lg.createdAt || 0;
        if (lg.entityId && t > (lastTouch.get(lg.entityId) || 0)) lastTouch.set(lg.entityId, t);
      }
      let n = 0;
      const sample = [];
      for (const l of leads) {
        if (!mine(l.assign)) continue;
        const touched = Math.max(lastTouch.get(l.id) || 0, l.updatedAt || 0, l.createdAt || 0);
        if (touched >= cutoff) continue;
        n++;
        if (sample.length < 10) sample.push({ id: l.id, name: l.name, days: Math.floor((Date.now() - touched) / 86400000) });
      }
      out['leads-untouched'] = { count: n, days: untouchedDays, sample };
    }

    if (need.calls) {
      const todays = callLogs.filter(c => {
        const t = c.createdAt || 0;
        if (t < dayStartMs || t >= dayEndMs) return false;
        return perms.isOwner || String(c.staffEmail || '').toLowerCase() === myEmail;
      });
      if (want.has('calls-today')) {
        // Roll up repeat unpicked re-dials so this matches the Call Logs page
        // (needs newest-first ordering).
        const sorted = [...todays].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        out['calls-today'] = { count: rollupRepeatAttempts(sorted).length };
      }
      if (want.has('calls-connected')) {
        // Connected is duration > 0, never the `outcome` field — Android sends
        // outcome:'Connected' on zero-duration calls (CLAUDE.md).
        const connected = todays.filter(c => !isUnpickedCall(c)).length;
        out['calls-connected'] = {
          connected, total: todays.length,
          pct: todays.length ? Math.round((connected / todays.length) * 100) : 0,
        };
      }
      if (want.has('call-heatmap')) {
        const grid = Array.from({ length: 7 }, () => new Array(24).fill(0));
        const windowStart = Date.now() - 28 * 86400000;
        for (const c of callLogs) {
          const t = c.createdAt || 0;
          if (t < windowStart) continue;
          if (!perms.isOwner && String(c.staffEmail || '').toLowerCase() !== myEmail) continue;
          const d = new Date(t);
          grid[d.getDay()][d.getHours()]++;
        }
        out['call-heatmap'] = { grid, days: 28 };
      }
    }

    if (want.has('receivables')) {
      const now = Date.now();
      const buckets = { current: 0, d30: 0, d60: 0, d90: 0 };
      let total = 0;
      for (const inv of (other.invoices || [])) {
        const paid = (inv.payments || []).reduce((s, p) => s + (Number(p.amount) || 0), 0);
        const due = (Number(inv.total) || 0) - paid;
        if (due <= 0.5) continue;
        total += due;
        // Date.parse() on an epoch value gives NaN, and a NaN age falls through
        // every bucket comparison into 60+ — so ecom invoices were reported as
        // the most overdue regardless of their real age.
        const dueAt = parseDateValue(inv.dueDate) ?? parseDateValue(inv.createdAt) ?? now;
        const age = Math.floor((now - dueAt) / 86400000);
        if (age <= 0) buckets.current += due;
        else if (age <= 30) buckets.d30 += due;
        else if (age <= 60) buckets.d60 += due;
        else buckets.d90 += due;
      }
      out['receivables'] = {
        total: Math.round(total),
        buckets: Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, Math.round(v)])),
      };
    }

    if (want.has('team-leaderboard')) {
      const members = other.teamMembers || [];
      const since = dayStartMs - 29 * 86400000; // trailing 30 days incl. today
      const calls = callLogs;
      const rows = members.map(m => {
        const email = String(m.email || '').toLowerCase();
        const name = String(m.name || '').trim().replace(/\s+/g, ' ');
        const mineCalls = calls
          .filter(c => (c.createdAt || 0) >= since && String(c.staffEmail || '').toLowerCase() === email)
          .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        return {
          id: m.id, name: m.name || m.email, role: m.role || '',
          calls: rollupRepeatAttempts(mineCalls).length,
          leads: leads.filter(l => String(l.assign || '').trim().replace(/\s+/g, ' ') === name).length,
        };
      }).sort((a, b) => b.calls - a.calls || b.leads - a.leads);
      out['team-leaderboard'] = { rows: rows.slice(0, 10), days: 30 };
    }

    if (want.has('target-progress')) {
      const me = (other.teamMembers || []).find(m => String(m.email || '').toLowerCase() === myEmail);
      const target = Number(me?.monthlyTarget) || 0;
      const wonStage = (other.userProfiles?.[0] || {}).wonStage || 'Won';
      const d = new Date(dayStartMs);
      const monthStart = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
      // Won this month = leads sitting in the won stage whose last movement was
      // this month. `wonAt` is set on conversion; fall back to updatedAt for
      // rows written before that field existed, so older data still counts.
      const won = leads.filter(l => {
        if (l.stage !== wonStage) return false;
        if (!mine(l.assign)) return false;
        const t = l.wonAt || l.updatedAt || l.createdAt || 0;
        return t >= monthStart;
      }).length;
      out['target-progress'] = { won, target, month: d.toLocaleString('en-IN', { month: 'long' }) };
    }

    const data = { widgets: out };
    responseCache.set(cacheKey, { data, ts: Date.now() });
    return res.status(200).json({ ...data, denied });
  } catch (err) {
    console.error('dashboard-widgets error:', err);
    return res.status(500).json({ error: err.message });
  }
}
