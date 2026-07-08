// ===================================================================
// src/hooks/usePgQuery.js — read hook for the Postgres migration
//
// Drop-in-ish replacement for db.useQuery({ customers: {...}, invoices: {...} }).
// Returns { data: { customers: [...], invoices: [...] }, isLoading, refetch }.
//
// Difference from db.useQuery: NOT real-time. Uses stale-while-revalidate
// (SWR) caching via pgCache.js:
//   - Cache hit  → paint instantly (isLoading:false), then revalidate silently.
//   - Cache miss → fetch from DB, show spinner, cache result.
//   - After any write (dbWrite dispatches 'pg-data-changed') → cache cleared,
//     active queries refetch. Edits always show fresh data — never stale.
//   - Login pre-warms hot collections (pgPreWarm in useAuthPg) so first
//     navigation to common pages is instant too.
//   - Cache cleared on logout (pgCacheClear in pgAuthSignOut).
//
// Usage:
//   const { data, isLoading, refetch } = usePgQuery(['customers', 'invoices']);
//   const customers = data?.customers || [];
//
// When VITE_USE_PG_DATA is unset/false, callers should keep using db.useQuery
// directly — this hook is only wired up in migrated components.
// ===================================================================
import { useState, useEffect, useCallback, useRef } from 'react';
import { pgAuthGetToken, pgAuthHandleUnauthorized } from './useAuthPg';
import { pgCacheGet, pgCacheSet, pgCacheClear } from './pgCache';

export function usePgQuery(spec) {
  // Build a stable query object from spec (array of names or object with filters)
  const queries = Array.isArray(spec)
    ? Object.fromEntries((spec || []).map(c => [c, {}]))
    : (spec || {});
  const key = JSON.stringify(queries);
  const mounted = useRef(true);

  // Lazy initial state — if cached, start with data immediately (no spinner flash)
  const [data, setData] = useState(() => {
    if (!Object.keys(queries).length) return {};
    return pgCacheGet(queries) ?? null;
  });
  const [isLoading, setIsLoading] = useState(() => {
    if (!Object.keys(queries).length) return false;
    return pgCacheGet(queries) === null;
  });
  const [error, setError] = useState(null);

  /**
   * Fetch from Postgres.
   * revalidate=false (default): check cache first, serve stale, then revalidate.
   * revalidate=true: skip cache — used for background refresh and post-write refetch.
   */
  const fetchData = useCallback(async (revalidate = false) => {
    const q = JSON.parse(key);
    if (!Object.keys(q).length) { setData({}); setIsLoading(false); return; }

    // SWR: serve stale immediately, revalidate in background
    if (!revalidate) {
      const cached = pgCacheGet(q);
      if (cached) {
        if (mounted.current) { setData(cached); setIsLoading(false); }
        // Background revalidation — keep data fresh without blocking render
        if (mounted.current) fetchData(true);
        return;
      }
    }

    const token = pgAuthGetToken();
    if (!token) {
      if (mounted.current) { setError(new Error('Not authenticated')); setIsLoading(false); }
      return;
    }
    try {
      const res = await fetch('/api/data-pg', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'query', queries: q }),
      });
      if (pgAuthHandleUnauthorized(res)) return; // expired session — page is reloading to login
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Query failed');
      if (mounted.current) {
        pgCacheSet(q, json.data);
        setData(json.data);
        setError(null);
        setIsLoading(false);
      }
    } catch (e) {
      if (mounted.current) { setError(e); setIsLoading(false); }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    mounted.current = true;
    fetchData(); // SWR: serves from cache or fetches; either way sets isLoading=false fast

    // Write listener: clear cache then refetch fresh — ensures edits always
    // show the saved value, never stale cached data.
    const onWrite = () => { pgCacheClear(); fetchData(true); };
    window.addEventListener('pg-data-changed', onWrite);
    return () => { mounted.current = false; window.removeEventListener('pg-data-changed', onWrite); };
  }, [fetchData]);

  return { data, isLoading, error, refetch: fetchData };
}

// Translate an InstantDB query object — { coll: { $: { where } } } — into the
// pg spec { coll: { where } }, stripping userId (RLS handles tenant) and any
// complex operator objects. Used by the db.useQuery wrapper in instant.js.
export function instantToPgSpec(query) {
  if (!query) return {};
  const spec = {};
  for (const [coll, cfg] of Object.entries(query)) {
    const where = cfg?.$?.where || {};
    const filtered = {};
    for (const [k, v] of Object.entries(where)) {
      // userId is the tenant on every collection EXCEPT memberProfiles, where it
      // is the member's OWN id. Strip it elsewhere (RLS scopes the tenant); keep
      // it for memberProfiles so we fetch the right person, not an arbitrary
      // member of the tenant.
      if (k === 'userId' && coll !== 'memberProfiles') continue;
      if (v && typeof v === 'object') continue;     // skip or/and/in operators
      filtered[k] = v;
    }
    spec[coll] = Object.keys(filtered).length ? { where: filtered } : {};
  }
  return spec;
}

// Hook form for the wrapper: takes an InstantDB query, returns InstantDB-shaped result.
export function useInstantPgQuery(query) {
  return usePgQuery(instantToPgSpec(query));
}
