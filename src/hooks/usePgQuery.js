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

export function usePgQuery(collections) {
  const [data, setData] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  // Stable key so the effect only re-runs when the collection set changes
  const key = Array.isArray(collections) ? collections.join(',') : String(collections || '');
  const list = key ? key.split(',') : [];
  const mounted = useRef(true);

  const fetchData = useCallback(async () => {
    if (!list.length) { setData({}); setIsLoading(false); return; }
    const token = pgAuthGetToken();
    if (!token) { setError(new Error('Not authenticated')); setIsLoading(false); return; }
    try {
      const res = await fetch('/api/data-pg', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: 'query', collections: list }),
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
