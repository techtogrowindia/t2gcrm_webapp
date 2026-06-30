// ===================================================================
// api/_shared-call-logs.js — single source of truth for call-log
// dedup/rollup so EVERY consumer shows identical numbers:
//   - web Call Logs page        (api/call-logs-page.js)
//   - mobile app call list      (api/call-logs.js GET)
//   - Team Performance          (api/team-stats.js callsMade)
//
// Mirrors src/components/CallLogs/CallLogs.jsx. If you change the rollup
// rule, change it HERE — do not re-inline it in a consumer.
// ===================================================================

// Consecutive unpicked attempts to the same number within this window
// collapse into one synthetic row.
export const REPEAT_GROUP_WINDOW_MS = 24 * 60 * 60 * 1000;

// Connected = talk time > 0. Never trust `outcome` — Android sometimes
// sends outcome:'Connected' on zero-duration calls (see CLAUDE.md).
export const isUnpickedCall = (l) => !l.duration || Number(l.duration) === 0;

// Last-10-digits phone key so formatting/country-code drift doesn't split a group.
export const normalizePhone = (p) => (p ? String(p).replace(/\D/g, '').slice(-10) : '');

/**
 * Repeat-attempt rollup. Collapses runs of consecutive UNPICKED (duration 0)
 * calls to the same phone + direction + staffEmail within 24h into a single
 * synthetic row carrying { attemptCount, groupedIds, firstAttemptAt,
 * lastAttemptAt }. Connected calls (duration > 0) always stay as their own row.
 *
 * INPUT MUST be sorted newest-first by createdAt (same as the web page) —
 * grouping only merges adjacent entries.
 *
 * @param {object[]} logs - call-log rows, newest-first
 * @returns {object[]} rolled-up rows
 */
export function rollupRepeatAttempts(logs) {
  const grouped = [];
  let i = 0;
  while (i < logs.length) {
    const log = logs[i];
    if (!isUnpickedCall(log)) { grouped.push(log); i++; continue; }
    const phone = normalizePhone(log.phone);
    const group = [log];
    let j = i + 1;
    while (j < logs.length) {
      const next = logs[j];
      if (!isUnpickedCall(next)) break;
      if (normalizePhone(next.phone) !== phone) break;
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
  return grouped;
}
