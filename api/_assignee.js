// Assignment by member ID, not by name.
//
// Leads, quotes, invoices, AMC and tasks have always stored the assignee as a
// NAME string. Renaming a member therefore orphaned every record pointing at
// the old name — they vanished from that member's lists and from name-based
// reports — and two members sharing a name were indistinguishable.
//
// The fix is `assignedToId`, holding teamMembers.id. Migration is staged so
// behaviour never changes underfoot:
//
//   1. WRITE  — every write sets assignedToId alongside assign  (no read change)
//   2. BACKFILL — existing rows get assignedToId from their current name
//   3. READ   — matching prefers the id, falling back to the name for any row
//               not yet backfilled
//   4. RETIRE — once no rows lack an id, the name fallback can go and `assign`
//               becomes display-only
//
// Both fields are kept in sync during 1-3, so a half-migrated database always
// behaves correctly. `assign` stays as the display value, which also means
// nothing else has to change to render a name.

const norm = (s) => String(s ?? '').trim().replace(/\s+/g, ' ');
const key = (s) => norm(s).toLowerCase();

/**
 * Find a team member's id from an assignee name.
 * Matching is trimmed + case-insensitive, because names have historically been
 * typed by hand and drift by spacing/casing.
 * @returns {string|null} member id, or null when the name matches no member
 *          (unassigned, or a stale name left by an old rename)
 */
export function resolveAssigneeId(name, teamMembers) {
  const k = key(name);
  if (!k) return null;
  const hit = (teamMembers || []).find(m => key(m.name) === k);
  return hit ? hit.id : null;
}

/**
 * Resolve an assignee value that may be a NAME **or an EMAIL** to the canonical
 * member. The mobile app's picker is keyed by email while the web uses the
 * name, so `assign` ended up holding both — leads created on mobile displayed a
 * raw email on the web, and the app's own "my leads" filter never matched a
 * lead the web had assigned.
 *
 * @returns {{name: string, id: string|null}} the member's canonical NAME (what
 *          the whole app matches on) and id. Falls back to the value as given
 *          when it matches no member, so a hand-typed assignee isn't discarded.
 */
export function resolveAssignee(value, teamMembers) {
  const k = key(value);
  if (!k) return { name: '', id: null };
  const hit = (teamMembers || []).find(m => key(m.name) === k || key(m.email) === k);
  return hit ? { name: norm(hit.name), id: hit.id } : { name: norm(value), id: null };
}

/**
 * The assignee fields to write. Call this wherever `assign` is set so the id
 * is never allowed to drift from the name, and so an email is stored as the
 * member's name rather than verbatim.
 */
export function assigneeFields(value, teamMembers) {
  const { name, id } = resolveAssignee(value, teamMembers);
  return { assign: name, assignedToId: id };
}

/**
 * Does this record belong to this member?
 * Prefers the id. Falls back to the name only when the record has no id yet,
 * so rows written before the migration keep working unchanged.
 *
 * @param record  any record with assign / assignedToId
 * @param member  { id, name, email }
 */
export function isAssignedTo(record, member) {
  if (!record || !member) return false;
  if (record.assignedToId) return record.assignedToId === member.id;
  const k = key(record.assign);
  if (!k) return false;
  return k === key(member.name) || k === key(member.email);
}

/** True when nobody is assigned. Independent of which field is in use. */
export function isUnassigned(record) {
  return !record?.assignedToId && !key(record?.assign);
}

export { norm as normAssigneeName };
