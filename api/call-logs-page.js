import { getCallLogsForOwner } from './_call-logs-cache.js';
import { getLeadsForOwner } from './_leads-cache.js';

// Repeat-attempt rollup constants — mirror src/components/CallLogs/CallLogs.jsx
const REPEAT_GROUP_WINDOW_MS = 24 * 60 * 60 * 1000;
const isUnpickedCall = (l) => !l.duration || Number(l.duration) === 0;
const normalize = (p) => p ? String(p).replace(/\D/g, '').slice(-10) : '';

// POST /api/call-logs-page
// Server-driven list + counts + team summary for the Call Logs page.
// Replaces the 13k-row db.useQuery subscription that was the slowest page
// in the app. All filtering, grouping, paging, and per-member aggregation
// happens here so the client only holds the current page.
//
// Body: {
//   ownerId,                 // required
//   page, pageSize,          // pagination (default 1, 25)
//   search,                  // string match against phone/contactName/notes
//   dirFilter,               // 'Outgoing' | 'Incoming' | 'Missed' | ''
//   staffFilter,             // staffEmail to filter to
//   dateFrom, dateTo,        // YYYY-MM-DD strings (inclusive)
//   groupRepeats,            // bool — apply unpicked-attempt rollup
//   summaryDate,             // YYYY-MM-DD string for team-summary's "today" default
// }
// Returns: {
//   items, totalFiltered, totalUngrouped, counts, teamStats
// }
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const {
      ownerId,
      page = 1,
      pageSize = 25,
      search = '',
      dirFilter = '',
      staffFilter = '',
      dateFrom = '',
      dateTo = '',
      groupRepeats = true,
      groupByPhone = false, // when true, collapse all calls to one row per phone
      summaryDate = '',     // YYYY-MM-DD (client computes today in its tz)
      team = [],            // [{ email, name }] — small, sent by client to avoid DB lookup
    } = req.body || {};

    if (!ownerId) return res.status(400).json({ error: 'ownerId required' });

    // Pull all call logs for this owner from shared cache (30s TTL)
    let logs = await getCallLogsForOwner(ownerId);

    // Sort newest first (callLogs may come back unordered from admin SDK)
    logs = [...logs].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    // ─── Date helper: convert YYYY-MM-DD to ms boundary in caller's tz ────
    // Client sends summaryDate so we use its day-boundaries, avoiding UTC drift
    const toDayStart = (s) => s ? new Date(s + 'T00:00:00').getTime() : null;
    const toDayEnd   = (s) => s ? new Date(s + 'T23:59:59.999').getTime() : null;
    const fromMs = toDayStart(dateFrom);
    const toMs   = toDayEnd(dateTo);

    // ─── Filter (mirrors CallLogs.jsx `filtered` useMemo) ─────────────────
    const filtered = logs.filter(l => {
      if (search) {
        const s = search.toLowerCase();
        const hay = `${l.phone || ''} ${l.contactName || ''} ${l.notes || ''}`.toLowerCase();
        if (!hay.includes(s)) return false;
      }
      if (dirFilter && l.direction !== dirFilter) return false;
      if (staffFilter && l.staffEmail !== staffFilter) return false;
      if (fromMs !== null && (l.createdAt || 0) < fromMs) return false;
      if (toMs !== null && (l.createdAt || 0) > toMs) return false;
      return true;
    });

    const totalUngrouped = filtered.length;

    // ─── Counts on the filtered (ungrouped) list — used by UI badges ──────
    const counts = {
      total: filtered.length,
      connected: filtered.filter(l => l.duration && Number(l.duration) > 0).length,
      notPicked: filtered.filter(l => l.direction === 'Outgoing' && (!l.duration || Number(l.duration) === 0)).length,
      missed: filtered.filter(l => l.direction === 'Missed').length,
      incoming: filtered.filter(l => l.direction === 'Incoming').length,
      outgoing: filtered.filter(l => l.direction === 'Outgoing').length,
    };

    // ─── Phone-group mode: one row per phone (takes priority over groupRepeats) ─
    let grouped;
    if (groupByPhone) {
      const byPhone = new Map();
      for (const l of filtered) {
        const k = normalize(l.phone) || `__unknown_${l.id}`;
        const g = byPhone.get(k);
        if (g) g.calls.push(l);
        else byPhone.set(k, { calls: [l] });
      }
      grouped = [];
      for (const [, g] of byPhone) {
        const calls = g.calls.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        const latest = calls[0];
        const totalDuration = calls.reduce((s, c) => s + (Number(c.duration) || 0), 0);
        const connectedCount = calls.filter(c => Number(c.duration || 0) > 0).length;
        const notPickedCount = calls.filter(c => c.direction === 'Outgoing' && !(Number(c.duration) > 0)).length;
        const missedCount = calls.filter(c => c.direction === 'Missed').length;
        const incomingCount = calls.filter(c => c.direction === 'Incoming').length;
        const outgoingCount = calls.filter(c => c.direction === 'Outgoing').length;
        // Pick the most informative contact name across all calls in the group
        const contactName = calls.map(c => c.contactName).find(n => n && n.trim()) || '';
        grouped.push({
          ...latest,
          contactName,
          phoneGroup: true,
          attemptCount: calls.length,
          firstAttemptAt: Math.min(...calls.map(c => c.createdAt || 0)),
          lastAttemptAt: Math.max(...calls.map(c => c.createdAt || 0)),
          groupedIds: calls.map(c => c.id),
          // Duration field on the group row reflects the TOTAL talk time
          duration: totalDuration,
          breakdown: {
            outgoing: outgoingCount,
            incoming: incomingCount,
            missed: missedCount,
            connected: connectedCount,
            notPicked: notPickedCount,
          },
          // Embed the full call list so the client can expand inline without
          // a second fetch. Strip to small fields only.
          calls: calls.map(c => ({
            id: c.id,
            createdAt: c.createdAt || 0,
            direction: c.direction || '',
            duration: Number(c.duration) || 0,
            outcome: c.outcome || '',
            notes: c.notes || '',
            staffName: c.staffName || '',
            staffEmail: c.staffEmail || '',
            contactName: c.contactName || '',
          })),
        });
      }
      grouped.sort((a, b) => (b.lastAttemptAt || 0) - (a.lastAttemptAt || 0));
    } else if (groupRepeats) {
      grouped = [];
      let i = 0;
      while (i < filtered.length) {
        const log = filtered[i];
        if (!isUnpickedCall(log)) { grouped.push(log); i++; continue; }
        const phone = normalize(log.phone);
        const group = [log];
        let j = i + 1;
        while (j < filtered.length) {
          const next = filtered[j];
          if (!isUnpickedCall(next)) break;
          if (normalize(next.phone) !== phone) break;
          if ((next.staffEmail || '') !== (log.staffEmail || '')) break;
          if ((next.direction || '') !== (log.direction || '')) break;
          const last = group[group.length - 1];
          if (Math.abs((last.createdAt || 0) - (next.createdAt || 0)) > REPEAT_GROUP_WINDOW_MS) break;
          group.push(next);
          j++;
        }
        if (group.length === 1) {
          grouped.push(log);
        } else {
          grouped.push({
            ...log,
            attemptCount: group.length,
            firstAttemptAt: Math.min(...group.map(g => g.createdAt || 0)),
            lastAttemptAt: Math.max(...group.map(g => g.createdAt || 0)),
            groupedIds: group.map(g => g.id),
          });
        }
        i = j;
      }
    } else {
      grouped = filtered;
    }

    const totalFiltered = grouped.length;

    // ─── Paginate ─────────────────────────────────────────────────────────
    const ps = pageSize === 'all' ? grouped.length : Math.max(1, Number(pageSize) || 25);
    const p = Math.max(1, Number(page) || 1);
    const items = pageSize === 'all' ? grouped : grouped.slice((p - 1) * ps, p * ps);

    // ─── Team summary stats (mirrors CallLogs.jsx `teamCallStats` useMemo) ─
    // Defaults to "today" if no date filter applied (uses client-provided summaryDate)
    const teamStats = team.map(m => {
      const memberAll = logs.filter(l => l.staffEmail === m.email);
      const memberInScope = memberAll.filter(l => {
        const t = l.createdAt || 0;
        if (fromMs !== null || toMs !== null) {
          if (fromMs !== null && t < fromMs) return false;
          if (toMs !== null && t > toMs) return false;
          return true;
        }
        // No date filter: default to summaryDate (today in client tz)
        if (!summaryDate) return true;
        const dayStart = toDayStart(summaryDate);
        const dayEnd = toDayEnd(summaryDate);
        return t >= dayStart && t <= dayEnd;
      });
      return {
        name: m.name,
        email: m.email,
        total: memberInScope.length,
        connected: memberInScope.filter(l => l.duration && Number(l.duration) > 0).length,
        toLeads: memberInScope.filter(l => l.leadId).length,
        toUnknown: memberInScope.filter(l => !l.leadId).length,
        outgoing: memberInScope.filter(l => l.direction === 'Outgoing').length,
        incoming: memberInScope.filter(l => l.direction === 'Incoming').length,
        missed: memberInScope.filter(l => l.direction === 'Missed').length,
        notPicked: memberInScope.filter(l => l.direction === 'Outgoing' && (!l.duration || Number(l.duration) === 0)).length,
      };
    });

    // ─── Enrich items with matched-lead info (small fields only) ──────────
    // Only enrich the current page slice — keeps response small.
    const leads = await getLeadsForOwner(ownerId);
    const leadById = Object.fromEntries(leads.map(l => [l.id, l]));
    const leadByPhone = {};
    for (const l of leads) {
      const n = normalize(l.phone);
      if (n.length >= 7 && !leadByPhone[n]) leadByPhone[n] = l;
    }
    const enrichedItems = items.map(log => {
      const match = log.leadId
        ? leadById[log.leadId] || null
        : leadByPhone[normalize(log.phone)] || null;
      return match
        ? { ...log, matchedLeadId: match.id, matchedLeadName: match.name }
        : log;
    });

    return res.status(200).json({
      items: enrichedItems,
      totalFiltered,
      totalUngrouped,
      counts,
      teamStats,
    });
  } catch (err) {
    console.error('call-logs-page error:', err);
    return res.status(500).json({ error: err.message });
  }
}
