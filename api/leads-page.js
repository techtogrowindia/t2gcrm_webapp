import { init } from '@instantdb/admin';
import { getLeadsForOwner } from './_leads-cache.js';

const APP_ID = process.env.VITE_INSTANT_APP_ID;
const ADMIN_TOKEN = process.env.INSTANT_ADMIN_TOKEN;


// POST /api/leads-page
// Server-driven list + counts for the Leads page so we can scale past the
// 500-record subscription cap. The client still handles timezone (it sends
// boundaries in ms) and small secondary collections (customers, team,
// userProfiles, partnerApplications) still flow through the live subscription.
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
      isOwner = true,
      mode = 'list',
      dateMode = 'followup',
      tab = 'all',
      customFromMs = null,
      customToMs = null,
      staffFilter = '',
      srcFilter = '',
      stgFilter = '',
      search = '',
      visibleStages = null, // null = all stages allowed
      disabledStages = [],
      page = 1,
      pageSize = 25,
      boundaries = {},
    } = req.body || {};

    if (!ownerId) return res.status(400).json({ error: 'ownerId required' });

    // --- 1. Fetch (cached) -------------------------------------------------
    let leads = await getLeadsForOwner(ownerId);

    // Source normalization — mirror client logic
    leads = leads.map(l => (l.source === 'Retailer' || l.source === 'Retailers')
      ? { ...l, source: 'Channel Partners' }
      : l);

    // Plan-enforcement total: raw count of ALL leads for this owner BEFORE
    // any stage/team/search filtering. Used by the client to check maxLeads.
    const planTotal = leads.length;

    // --- 2. Team visibility filter ----------------------------------------
    // Team members whose role has elevated Leads perms (delete or viewAll)
    // bypass the teamCanSeeAllLeads toggle and always see all leads — they
    // are treated as admins for visibility purposes.
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
        console.warn('[leads-page] role lookup failed', e?.message);
      }
    }
    if (!isOwner && !teamCanSeeAllLeads && !hasElevatedLeads) {
      leads = leads.filter(l => !l.assign || l.assign === userEmail || l.assign === myName);
    }

    // --- 3. Stage visibility (savedLeadStages + disabledStages) -----------
    // Mirror the same filtering that dashboard-stats applies so both
    // endpoints report identical totals.
    const disabledSet = new Set(disabledStages || []);
    if (Array.isArray(visibleStages) && visibleStages.length > 0) {
      const vs = new Set(visibleStages);
      leads = leads.filter(l => vs.has(l.stage) && !disabledSet.has(l.stage));
    } else if (disabledSet.size > 0) {
      leads = leads.filter(l => !disabledSet.has(l.stage));
    }

    // --- 4. Dropdown filters (baseFiltered equivalent) --------------------
    const baseFiltered = leads.filter(l => {
      if (srcFilter && l.source !== srcFilter) return false;
      if (stgFilter && l.stage !== stgFilter) return false;
      if (staffFilter) {
        if (staffFilter === 'unassigned') {
          if (l.assign) return false;
        } else if (staffFilter === 'my') {
          if (l.assign !== userEmail && l.assign !== myName) return false;
        } else {
          if (l.assign !== staffFilter) return false;
        }
      }
      return true;
    });

    // --- 5. Counts bucketing using client-provided boundaries -------------
    const {
      nowMs = Date.now(),
      todayStartMs = 0, todayEndMs = 0,
      yesterdayStartMs = 0, yesterdayEndMs = 0,
      tomorrowStartMs = 0, tomorrowEndMs = 0,
      weekStartMs = 0,
      monthStartMs = 0,
      next7EndMs = 0,
    } = boundaries;

    const dateMsOf = (l) => {
      let v;
      if (dateMode === 'created') v = l.createdAt;
      else if (dateMode === 'assigned') v = l.assignedAt;
      else v = l.followup;
      if (!v) return null;
      if (typeof v === 'number') return v;
      const t = new Date(v).getTime();
      return isNaN(t) ? null : t;
    };

    let total = baseFiltered.length;
    let cToday = 0, cYest = 0, cTomorrow = 0, cNext7 = 0, cOverdue = 0, cWeek = 0, cMonth = 0, cCustom = 0;
    const hasCustom = customFromMs !== null || customToMs !== null;

    for (const l of baseFiltered) {
      const d = dateMsOf(l);
      if (d === null) continue;
      if (d >= todayStartMs && d <= todayEndMs) cToday++;
      if (d >= yesterdayStartMs && d <= yesterdayEndMs) cYest++;
      if (d >= tomorrowStartMs && d <= tomorrowEndMs) cTomorrow++;
      if (d >= todayStartMs && d <= next7EndMs) cNext7++;
      if (d < nowMs) cOverdue++;
      if (d >= weekStartMs) cWeek++;
      if (d >= monthStartMs) cMonth++;
      if (hasCustom) {
        if ((customFromMs === null || d >= customFromMs) && (customToMs === null || d <= customToMs)) cCustom++;
      }
    }

    const counts = {
      total,
      today: cToday,
      yesterday: cYest,
      tomorrow: cTomorrow,
      next7days: cNext7,
      overdue: cOverdue,
      thisweek: cWeek,
      thismonth: cMonth,
      custom: cCustom,
    };

    // --- 6. Apply tab filter ---------------------------------------------
    let filteredForTab = baseFiltered;
    if (tab !== 'all') {
      filteredForTab = baseFiltered.filter(l => {
        const d = dateMsOf(l);
        if (tab === 'custom') {
          if (!hasCustom) return false;
          if (d === null) return false;
          if (customFromMs !== null && d < customFromMs) return false;
          if (customToMs !== null && d > customToMs) return false;
          return true;
        }
        if (d === null) return false;
        if (tab === 'today') return d >= todayStartMs && d <= todayEndMs;
        if (tab === 'yesterday') return d >= yesterdayStartMs && d <= yesterdayEndMs;
        if (tab === 'tomorrow') return d >= tomorrowStartMs && d <= tomorrowEndMs;
        if (tab === 'next7days') return d >= todayStartMs && d <= next7EndMs;
        if (tab === 'overdue') return d < nowMs;
        if (tab === 'thisweek') return d >= weekStartMs;
        if (tab === 'thismonth') return d >= monthStartMs;
        return true;
      });
    }

    // --- 7. Search --------------------------------------------------------
    if (search) {
      const q = search.toLowerCase();
      filteredForTab = filteredForTab.filter(l => {
        // Standard fields
        const stdFields = [l.name, l.companyName, l.email, l.phone, l.source, l.stage, l.assign, l.label, l.notes, l.requirement, l.location, l.alternativeNumber, l.productCat];
        if (stdFields.some(v => (v || '').toString().toLowerCase().includes(q))) return true;
        // Custom fields
        if (l.custom && typeof l.custom === 'object') {
          return Object.values(l.custom).some(v => (v || '').toString().toLowerCase().includes(q));
        }
        return false;
      });
    }

    const totalFiltered = filteredForTab.length;

    // --- 8. Sort newest first --------------------------------------------
    filteredForTab.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    // --- 9. Paginate / cap ------------------------------------------------
    let items;
    if (mode === 'kanban') {
      items = filteredForTab.slice(0, 1000);
    } else {
      const ps = Number(pageSize) || 25;
      const p = Math.max(1, Number(page) || 1);
      items = filteredForTab.slice((p - 1) * ps, p * ps);
    }

    return res.status(200).json({ items, counts, totalFiltered, planTotal });
  } catch (err) {
    console.error('leads-page error:', err);
    return res.status(500).json({ error: err.message });
  }
}
