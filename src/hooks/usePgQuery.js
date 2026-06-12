// ===================================================================
// src/hooks/usePgQuery.js — read hook for the Postgres migration
//
// Drop-in-ish replacement for db.useQuery({ customers: {...}, invoices: {...} }).
// Returns { data: { customers: [...], invoices: [...] }, isLoading, refetch }.
//
// Difference from db.useQuery: NOT real-time. Fetches once on mount and
// whenever the collection list changes. Call refetch() after a write
// (refetch-after-mutation) to reflect changes.
//
// Usage:
//   const { data, isLoading, refetch } = usePgQuery(['customers', 'invoices']);
//   const customers = data?.customers || [];
//   ...
//   await dbWrite(dbOp.update('customers', id, payload));
//   refetch();   // re-pull so the new customer shows
//
// When VITE_USE_PG_DATA is unset/false, callers should keep using db.useQuery
// directly — this hook is only wired up in migrated components.
// ===================================================================
import { useState, useEffect, useCallback, useRef } from 'react';
import { pgAuthGetToken } from './useAuthPg';

export function usePgQuery(spec) {
  const [data, setData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  // spec is either an array of names (['customers']) or an object with
  // optional where filters ({ activityLogs: { where: { entityId: x } } }).
  // Build a stable JSON key so the effect re-runs only when it changes.
  const queries = Array.isArray(spec)
    ? Object.fromEntries((spec || []).map(c => [c, {}]))
    : (spec || {});
  const key = JSON.stringify(queries);
  const mounted = useRef(true);

  const fetchData = useCallback(async () => {
    const q = JSON.parse(key);
    if (!Object.keys(q).length) { setData({}); setIsLoading(false); return; }
    const token = pgAuthGetToken();
    if (!token) { setError(new Error('Not authenticated')); setIsLoading(false); return; }
    try {
      const res = await fetch('/api/data-pg', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'query', queries: q }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Query failed');
      if (mounted.current) { setData(json.data); setError(null); }
    } catch (e) {
      if (mounted.current) setError(e);
    } finally {
      if (mounted.current) setIsLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    mounted.current = true;
    setIsLoading(true);
    fetchData();
    return () => { mounted.current = false; };
  }, [fetchData]);

  return { data, isLoading, error, refetch: fetchData };
}
