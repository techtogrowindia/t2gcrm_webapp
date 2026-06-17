import { init } from '@instantdb/admin';
import { getLeadsForOwner } from './_leads-cache.js';
import { getCallLogsForOwner } from './_call-logs-cache.js';
import { readData } from './_write-ops.js';
import { tenantQuery } from './db-pg.js';

const APP_ID = process.env.VITE_INSTANT_APP_ID;
const ADMIN_TOKEN = process.env.INSTANT_ADMIN_TOKEN;
const USE_PG_DATA = process.env.USE_PG_DATA === 'true';

// Per-owner activity-logs cache (InstantDB path only — PG path queries live).
const activityCache = new Map();
const ACT_TTL = 30 * 1000;

// Per (ownerId, dateRange) response cache — date filter swaps within the
// TTL are basically instant.
const responseCache = new Map();
const RESP_TTL = 15 * 1000;

async function getActivityLogsForOwner(db, ownerId) {
  if (USE_PG_DATA) {
    // Postgres path: fetch ALL activity logs for this owner (no date filter
    // here — team-stats needs the full set to accurately attribute per-member).
    const result = await tenantQuery(
      ownerId,
      'SELECT id, doc, created_at FROM activity_logs ORDER BY created_at DESC'
    );
    return result.rows.map(r => ({
      ...r.doc,
      id: r.id,
      createdAt: r.doc.createdAt ?? new Date(r.created_at).getTime(),
    }));
  }
  // InstantDB path with 30s in-memory cache
  const hit = activityCache.get(ownerId);
  if (hit && Date.now() - hit.ts < ACT_TTL) return hit.logs;
  const result = await db.query({
    activityLogs: { $: { where: { userId: ownerId } } },
  });
  const logs = result.activityLogs || [];
  activityCache.set(ownerId, { logs, ts: Date.now() });
  return logs;
}

const isHumanLog = (log) =>
  log.userName !== 'API System' &&
  log.userName !== 'Automation Bot (Server)' &&
  !(log.text || '').includes('🤖');

// POST /api/team-stats
// Body: { ownerId, startMs, endMs }
// Returns: { members: [{ id, name, email, totalActivities, leadsAssigned, ... }] }
//
// Replaces the per-member aggregation that previously ran in TeamReports.jsx
// over all activity logs (50k+ rows on busy workspaces). Server pre-computes
// the small array the page actually renders.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const { ownerId, startMs = 0, endMs = Date.now() + 86400000 } = req.body || {};
    if (!ownerId) return res.status(400).json({ error: 'ownerId required' });

    const cacheKey = `${ownerId}|${startMs}|${endMs}`;
    const hit = responseCache.get(cacheKey);
    if (hit && Date.now() - hit.ts < RESP_TTL) return res.status(200).json(hit.data);

    const db = init({ appId: APP_ID, adminToken: ADMIN_TOKEN });

    const [activityLogs, callLogs, allLeads, otherData] = await Promise.all([
      getActivityLogsForOwner(db, ownerId),
      getCallLogsForOwner(ownerId),
      getLeadsForOwner(ownerId),
      readData(db, ownerId, {
        teamMembers: { $: { where: { userId: ownerId } } },
        userProfiles: { $: { where: { userId: ownerId } } },
      }),
    ]);

    const teamMembers = otherData.teamMembers || [];
    const profile = otherData.userProfiles?.[0] || {};
    const wonStage = profile.wonStage || 'Won';

    const members = [
      { id: ownerId, name: 'Business Owner', email: profile.email || '', isOwnerRow: true },
      ...teamMembers.map(m => ({ id: m.id, name: m.name, email: m.email, role: m.role })),
    ];

    const teamEmails = new Set(teamMembers.map(t => (t.email || '').toLowerCase()).filter(Boolean));

    // ─── Attribution helpers (mirror TeamReports.jsx exactly) ────────────
    const isLogByMember = (log, member) => {
      if (member.isOwnerRow) {
        if (log.teamMemberId) return false;
        const uname = (log.userName || '').toLowerCase();
        if (uname && teamEmails.has(uname)) return false;
        return true;
      }
      if (log.teamMemberId && log.teamMemberId === member.id) return true;
      if (!log.teamMemberId && member.email && log.userName && log.userName.toLowerCase() === member.email.toLowerCase()) return true;
      return false;
    };

    const isCallByMember = (cl, member) => {
      const staff = (cl.staffEmail || '').toLowerCase();
      if (member.isOwnerRow) {
        if (staff && teamEmails.has(staff)) return false;
        if (staff && member.email && staff === member.email.toLowerCase()) return true;
        if (!staff && cl.actorId && cl.actorId === ownerId) return true;
        if (!staff) return true;
        return false;
      }
      if (member.email && staff === member.email.toLowerCase()) return true;
      return false;
    };

    const inRange = (t) => t >= startMs && t <= endMs;

    // Pre-filter activity logs to date range + human-only once — then attribute
    const logsInRange = activityLogs.filter(l => inRange(l.createdAt || 0) && isHumanLog(l));
    const callsInRange = callLogs.filter(cl => inRange(cl.createdAt || 0));

    const isTypeLog = (l, t) => l.entityType === t || l.entityType === `${t}s`;
    const knownTypes = new Set([
      'lead', 'leads', 'task', 'tasks', 'customer', 'customers',
      'quotation', 'quotations', 'invoice', 'invoices', 'amc',
      'project', 'projects', 'appointment', 'appointments',
    ]);

    const result = members.map(m => {
      // Leads currently assigned to this member (all-time snapshot, ignores
      // the date filter).
      const assignedToMember = allLeads.filter(l => l.assign === m.name);
      const leadsAssignedTotal = assignedToMember.length;
      // Leads ASSIGNED within the selected date range — uses `assignedAt`
      // (set when a lead is assigned/reassigned) so the count honours the
      // Today / This Month / This Year / Custom filter like every other
      // column. NOTE: leads assigned before the `assignedAt` field shipped
      // have no timestamp and therefore won't appear in a dated range
      // (they only count when there is no lower bound, i.e. startMs = 0).
      const leadsAssigned = assignedToMember.filter(l => inRange(l.assignedAt || 0)).length;
      const userLogs = logsInRange.filter(l => isLogByMember(l, m));

      const uniqueByEntity = (fn) =>
        new Set(userLogs.filter(fn).map(l => l.entityId)).size;

      const totalActivities = userLogs.length;
      const leadsWorked = uniqueByEntity(l => isTypeLog(l, 'lead'));
      const tasksWorked = uniqueByEntity(l => isTypeLog(l, 'task'));
      const customersWorked = uniqueByEntity(l => isTypeLog(l, 'customer'));
      const quotesWorked = uniqueByEntity(l => isTypeLog(l, 'quotation'));
      const invoicesWorked = uniqueByEntity(l => isTypeLog(l, 'invoice'));
      const amcWorked = uniqueByEntity(l => isTypeLog(l, 'amc'));
      const projectsWorked = uniqueByEntity(l => isTypeLog(l, 'project'));
      const appointmentsWorked = uniqueByEntity(l => isTypeLog(l, 'appointment'));
      const tasksCompleted = uniqueByEntity(l =>
        isTypeLog(l, 'task') &&
        (l.action === 'completed' || (l.text || '').toLowerCase().includes('completed'))
      );
      const leadsWon = uniqueByEntity(l =>
        isTypeLog(l, 'lead') && (
          (l.action === 'stage-change' && l.toStage === wonStage) ||
          l.action === 'converted' ||
          (l.text || '').toLowerCase().includes('won') ||
          (l.text || '').toLowerCase().includes('converted')
        )
      );
      const stageChanges = userLogs.filter(l => isTypeLog(l, 'lead') && l.action === 'stage-change').length;
      const otherWorks = userLogs.filter(l => !knownTypes.has(l.entityType)).length;
      const callsMade = callsInRange.filter(cl => isCallByMember(cl, m)).length;

      return {
        id: m.id,
        name: m.isOwnerRow ? 'Business Owner' : m.name,
        email: m.email,
        role: m.role || (m.isOwnerRow ? 'Owner' : ''),
        leadsAssigned,
        leadsAssignedTotal,
        totalActivities,
        tasksWorked, tasksCompleted,
        leadsWorked, leadsWon,
        customersWorked, quotesWorked, invoicesWorked, amcWorked,
        projectsWorked, appointmentsWorked,
        stageChanges, otherWorks, callsMade,
      };
    }).sort((a, b) => b.totalActivities - a.totalActivities);

    const data = { members: result };
    responseCache.set(cacheKey, { data, ts: Date.now() });

    return res.status(200).json(data);
  } catch (err) {
    console.error('team-stats error:', err);
    return res.status(500).json({ error: err.message });
  }
}
