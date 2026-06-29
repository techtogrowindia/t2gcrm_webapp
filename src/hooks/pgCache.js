// ===================================================================
// src/hooks/pgCache.js — sessionStorage-backed SWR cache for PG queries
//
// Shared by usePgQuery.js (reads) and useAuthPg.js (pre-warm + logout).
// Plain module (no hooks) — usePgQuery imports pgAuthGetToken from
// useAuthPg, so this file must not import from either to avoid cycles.
//
// Cache rules:
//   - Writes dispatch 'pg-data-changed' → cache is fully cleared before
//     the next fetch. Edits always land on fresh data — never stale.
//   - pgCacheSet() stores each collection individually too, so pre-warm
//     (all-in-one fetch) seeds page-level queries (subset fetches).
//   - sessionStorage survives hard refresh within the same session.
//   - Everything is cleared on logout (pgCacheClear called by pgAuthSignOut).
// ===================================================================

const PREFIX = 'pgq_';
const mem    = new Map(); // in-memory mirror — avoids JSON.parse per access

// ── Key helpers ────────────────────────────────────────────────────

/** Stable key: sort collection names so {a,b} === {b,a}. */
function makeKey(queries) {
  const sorted = Object.fromEntries(
    Object.keys(queries).sort().map(k => [k, queries[k]])
  );
  return PREFIX + JSON.stringify(sorted);
}

// ── sessionStorage helpers (silent — storage may be disabled) ──────

function ssRead(key) {
  try { const r = sessionStorage.getItem(key); return r ? JSON.parse(r) : null; }
  catch { return null; }
}
function ssWrite(key, val) {
  try { sessionStorage.setItem(key, JSON.stringify(val)); } catch {}
}

// ── Public API ─────────────────────────────────────────────────────

/**
 * Get cached data for a query spec.
 * Checks in order: memory → sessionStorage → reconstruct from individual
 * collection caches (so pre-warm benefits combined-collection queries).
 */
export function pgCacheGet(queries) {
  const key = makeKey(queries);

  // 1. Memory hit (same tick, no JSON overhead)
  if (mem.has(key)) return mem.get(key);

  // 2. sessionStorage hit
  const ss = ssRead(key);
  if (ss) { mem.set(key, ss); return ss; }

  // 3. Reconstruct from individually-cached collections
  //    e.g. pre-warm stored {customers:{}} + {invoices:{}} separately;
  //    a component querying {customers:{}, invoices:{}} can be served immediately.
  const colls = Object.keys(queries);
  if (!colls.length) return null;
  const result = {};
  for (const c of colls) {
    const sKey = makeKey({ [c]: queries[c] });
    const hit  = mem.get(sKey) ?? ssRead(sKey);
    if (!hit || !(c in hit)) return null; // missing piece — need a full fetch
    result[c] = hit[c];
  }
  // Warm the exact combined key so the next access is O(1)
  mem.set(key, result);
  ssWrite(key, result);
  return result;
}

/**
 * Store fetched data. Also caches each collection individually so that
 * the pre-warm's combined response seeds narrower per-page queries.
 */
export function pgCacheSet(queries, data) {
  const key = makeKey(queries);
  mem.set(key, data);
  ssWrite(key, data);

  for (const c of Object.keys(data)) {
    const sKey = makeKey({ [c]: queries[c] ?? {} });
    const val  = { [c]: data[c] };
    mem.set(sKey, val);
    ssWrite(sKey, val);
  }
}

/**
 * Clear everything — called on write (pg-data-changed) and on logout.
 * After a write, the next usePgQuery fetch always goes to the DB.
 */
export function pgCacheClear() {
  mem.clear();
  try {
    Object.keys(sessionStorage)
      .filter(k => k.startsWith(PREFIX))
      .forEach(k => sessionStorage.removeItem(k));
  } catch {}
}

/**
 * Pre-warm hot collections right after login. Fire-and-forget.
 * Fetches all hot tables in one request; pgCacheSet splits them so
 * individual page queries (subsets of these collections) get cache hits.
 *
 * Skipped if all collections are already warm (e.g. within-session reload).
 * Never throws — failure just means the next page visit fetches normally.
 */
export async function pgPreWarm(token) {
  if (!token) return;

  const HOT = [
    'customers', 'products', 'invoices', 'quotes', 'amc',
    'teamMembers', 'vendors', 'expenses', 'projects', 'tasks',
  ];

  // Skip if every collection is already cached
  if (HOT.every(c => {
    const hit = mem.get(makeKey({ [c]: {} })) ?? ssRead(makeKey({ [c]: {} }));
    return hit && c in hit;
  })) return;

  try {
    const queries = Object.fromEntries(HOT.map(c => [c, {}]));
    const res = await fetch('/api/data-pg', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: 'query', queries }),
    });
    if (!res.ok) return;
    const json = await res.json();
    if (json.data) pgCacheSet(queries, json.data);
  } catch {
    // Silent — page fetches will still work normally
  }
}
