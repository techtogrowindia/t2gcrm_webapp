import { getLeadsForOwner, hasElevatedLeadsRole } from './_leads-cache.js';

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
//     overdueReminders: [{ id, name, followup }, ...],  // 50 most overdue;
//       the TRUE count is totals.overdue — don't report this array's length
//     todayFollowups: [{ id, name, phone, stage, followup }, ...],  // due in
//       the caller's local day, earliest first, capped 50; count = totals.today
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
      // Today's window, in the CALLER's local day. Sent by the client because
      // the server's timezone is not the business's — deriving midnight here
      // would put an IST user's "today" on the wrong day for part of the day.
      dayStartMs = null,
      dayEndMs = null,
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
      // Personal "visible stages" narrowing removed here: only a stage the
      // business has DISABLED hides a lead, so a mistyped / blank / renamed
      // stage still counts in the KPIs instead of silently disappearing.
      if (disabledSet.has(l.stage)) return false;
      return true;
    });

    // Team visibility — mirror /api/leads-page logic so dashboard counts match
    // the Leads page. Elevated roles (delete or viewAll on Leads) bypass the
    // teamCanSeeAllLeads toggle.
    const hasElevatedLeads = (!isOwner && !teamCanSeeAllLeads && userEmail)
      ? await hasElevatedLeadsRole(ownerId, userEmail)
      : false;
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
    const todayFollowups = [];
    let todayCount = 0;
    const followupLeads = [];
    const hotCandidates = [];

    for (const l of leads) {
      if (l.stage !== wonStage && l.stage !== lostStage) active++;

      if (l.source) sourceCounts.set(l.source, (sourceCounts.get(l.source) || 0) + 1);

      const fMs = l.followup ? (typeof l.followup === 'number' ? l.followup : new Date(l.followup).getTime()) : null;
      if (fMs && !isNaN(fMs)) {
        if (fMs < nowMs) {
          overdue++;
          // Collect ALL overdue here and cap AFTER sorting (below). Capping in
          // this loop took an arbitrary 50 in row order, and row order is not
          // stable between polls — so each poll returned a different 50, the
          // notification's per-lead ack ids changed with it, and the alert the
          // user had just dismissed came straight back with the next 50.
          overdueReminders.push({ id: l.id, name: l.name, followup: fMs });
        }
        // Due today (caller's local day). Computed here rather than client-side
        // off followupLeads, because that array is capped at the 2000
        // furthest-future follow-ups — a tenant with more than that would have
        // today's silently cut off the end.
        if (dayStartMs != null && dayEndMs != null && fMs >= dayStartMs && fMs < dayEndMs) {
          todayCount++;
          todayFollowups.push({
            id: l.id, name: l.name, phone: l.phone, stage: l.stage, followup: fMs,
          });
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

    // Sort by count desc, then alphabetically as tiebreaker so order is
    // identical regardless of whether leads came from InstantDB or Postgres.
    const sourceCountsArr = [...sourceCounts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

    // Most-overdue first (earliest followup date); tiebreak by name then id so
    // the order is fully deterministic — two polls over the same data must
    // produce the same 50, or the notification re-fires after being dismissed.
    overdueReminders.sort((a, b) =>
      a.followup - b.followup ||
      String(a.name || '').localeCompare(String(b.name || '')) ||
      String(a.id).localeCompare(String(b.id))
    );
    const cappedOverdue = overdueReminders.slice(0, 50);

    // Earliest-first — the next one due today is the one to act on. Same
    // deterministic tiebreak as above so the notification's ack ids are stable
    // between polls and a dismissed alert stays dismissed.
    todayFollowups.sort((a, b) =>
      a.followup - b.followup ||
      String(a.name || '').localeCompare(String(b.name || '')) ||
      String(a.id).localeCompare(String(b.id))
    );

    return res.status(200).json({
      totals: {
        total: leads.length,
        active,
        overdue,
        today: todayCount,
      },
      sourceCounts: sourceCountsArr,
      recentLeads,
      hotLeads,
      overdueReminders: cappedOverdue,
      todayFollowups: todayFollowups.slice(0, 50),
      followupLeads: cappedFollowups,
    });
  } catch (err) {
    console.error('dashboard-stats error:', err);
    return res.status(500).json({ error: err.message });
  }
}
