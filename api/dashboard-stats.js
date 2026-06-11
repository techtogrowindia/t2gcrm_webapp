import { init } from '@instantdb/admin';
import { getLeadsForOwner } from './_leads-cache.js';
// USE_PG_DATA flag handled inside _leads-cache.js — no change needed here.

const APP_ID = process.env.VITE_INSTANT_APP_ID;
const ADMIN_TOKEN = process.env.INSTANT_ADMIN_TOKEN;

// POST /api/dashboard-stats
// Server-driven dashboard aggregates — replaces the 10,000-lead subscription
// that the Dashboard previously did in the browser. At >10k leads that
// subscription silently truncates or times out (symptom: TOTAL LEADS shows
// 9999 or 0). All lead-derived aggregates are computed here from the shared
// cache, so the Leads page and Dashboard share one underlying fetch.
//
// Body:
//   ownerId (required)
//   userEmail, myName, teamCanSeeAllLeads, isOwner - for team visibility
//   wonStage, lostStage - to compute Active
//   savedLeadStages - array or null. If set, leads outside it are hidden.
//   disabledStages - array, always hidden
//   nowMs - client's "now" (so overdue is timezone-correct)
//
// Returns:
//   { totals: { total, active, overdue },
//     sourceCounts: [[source, n], ...],  // sorted desc
//     recentLeads: [{ id, name, stage, source }, ...],  // last 5 by createdAt
//     hotLeads: [{ id, name, source, phone, stage, followup, label }, ...],
//     overdueReminders: [{ id, name }, ...],  // capped 50
//     followupLeads: [{ id, name, phone, email, stage, assign, followup }, ...] // capped 2000, for calendar
//   }
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const {
      ownerId,
      userEmail = '',
      myName = '',
      teamCanSeeAllLeads = true,
      teamCanSeeUnassignedLeads = true,
      isOwner = true,
      wonStage = 'Won',
      lostStage = 'Lost',
      savedLeadStages = null,
      disabledStages = [],
      nowMs = Date.now(),
    } = req.body || {};

    if (!ownerId) return res.status(400).json({ error: 'ownerId required' });

    let leads = await getLeadsForOwner(ownerId);

    // Source normalization (mirror client)
    leads = leads.map(l => (l.source === 'Retailer' || l.source === 'Retailers')
      ? { ...l, source: 'Channel Partners' }
      : l);

    // Stage visibility
    const stageSet = Array.isArray(savedLeadStages) && savedLeadStages.length > 0
      ? new Set(savedLeadStages) : null;
    const disabledSet = new Set(disabledStages || []);
    leads = leads.filter(l => {
      if (stageSet && !stageSet.has(l.stage)) return false;
      if (disabledSet.has(l.stage)) return false;
      return true;
    });

    // Team visibility — mirror /api/leads-page logic so dashboard counts match
    // the Leads page. Elevated roles (delete or viewAll on Leads) bypass the
    // teamCanSeeAllLeads toggle.
    let hasElevatedLeads = false;
    if (!isOwner && !teamCanSeeAllLeads && userEmail) {
      try {
        const db = init({ appId: APP_ID, adminToken: ADMIN_TOKEN });
        const r = await db.query({
          teamMembers: { $: { where: { userId: ownerId, email: userEmail } } },
          userProfiles: { $: { where: { userId: ownerId } } },
        });
        const tm = r.teamMembers?.[0];
        const profile = r.userProfiles?.[0] || {};
        const roleDef = (profile.roles || []).find(rl => rl.name === tm?.role);
        let rolePerms = null;
        if (roleDef) {
          if (Array.isArray(roleDef.perms)) {
            rolePerms = Object.fromEntries(roleDef.perms.map(k => [k, ['list', 'view']]));
          } else {
            rolePerms = roleDef.perms || {};
          }
        }
        const leadsPerms = (rolePerms && rolePerms.Leads) || [];
        hasElevatedLeads = Array.isArray(leadsPerms)
          && (leadsPerms.includes('delete') || leadsPerms.includes('viewAll'));
      } catch (e) {
        console.warn('[dashboard-stats] role lookup failed', e?.message);
      }
    }
    if (!isOwner && !teamCanSeeAllLeads && !hasElevatedLeads) {
      if (teamCanSeeUnassignedLeads !== false) {
        leads = leads.filter(l => !l.assign || l.assign === userEmail || l.assign === myName);
      } else {
        leads = leads.filter(l => l.assign === userEmail || l.assign === myName);
      }
    }

    // Single-pass aggregation
    let active = 0;
    let overdue = 0;
    const sourceCounts = new Map();
    const overdueReminders = [];
    const followupLeads = [];
    const hotCandidates = [];

    for (const l of leads) {
      if (l.stage !== wonStage && l.stage !== lostStage) active++;

      if (l.source) sourceCounts.set(l.source, (sourceCounts.get(l.source) || 0) + 1);

      const fMs = l.followup ? (typeof l.followup === 'number' ? l.followup : new Date(l.followup).getTime()) : null;
      if (fMs && !isNaN(fMs)) {
        if (fMs < nowMs) {
          overdue++;
          if (overdueReminders.length < 50) {
            overdueReminders.push({ id: l.id, name: l.name });
          }
        }
        followupLeads.push({
          id: l.id,
          name: l.name,
          phone: l.phone,
          email: l.email,
          stage: l.stage,
          assign: l.assign,
          followup: fMs,
        });
      }

      if (l.label === 'Hot' || (fMs && fMs >= nowMs)) {
        hotCandidates.push({
          id: l.id,
          name: l.name,
          source: l.source,
          phone: l.phone,
          stage: l.stage,
          followup: fMs,
          label: l.label,
          createdAt: l.createdAt || 0,
        });
      }
    }

    // Recent leads: last 5 by createdAt (mirror `leads.slice(-5).reverse()` but
    // correctly sorted — the original was buggy when source order wasn't
    // insertion order).
    const recentLeads = [...leads]
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
      .slice(0, 5)
      .map(l => ({ id: l.id, name: l.name, stage: l.stage, source: l.source }));

    // Hot leads: top 5 — prefer earliest upcoming followup, then Hot label
    hotCandidates.sort((a, b) => {
      // Upcoming followups first, ascending
      if (a.followup && b.followup) return a.followup - b.followup;
      if (a.followup) return -1;
      if (b.followup) return 1;
      return (b.createdAt || 0) - (a.createdAt || 0);
    });
    const hotLeads = hotCandidates.slice(0, 5).map(({ createdAt, ...rest }) => rest);

    // Cap followupLeads to 2000 most recent to keep payload bounded — covers
    // calendar view for any realistic month range.
    followupLeads.sort((a, b) => b.followup - a.followup);
    const cappedFollowups = followupLeads.slice(0, 2000);

    const sourceCountsArr = [...sourceCounts.entries()].sort((a, b) => b[1] - a[1]);

    return res.status(200).json({
      totals: {
        total: leads.length,
        active,
        overdue,
      },
      sourceCounts: sourceCountsArr,
      recentLeads,
      hotLeads,
      overdueReminders,
      followupLeads: cappedFollowups,
    });
  } catch (err) {
    console.error('dashboard-stats error:', err);
    return res.status(500).json({ error: err.message });
  }
}
