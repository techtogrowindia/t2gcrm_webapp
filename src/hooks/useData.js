// ===================================================================
// src/hooks/useData.js — unified read hook for the Postgres migration
//
// Drop-in for db.useQuery in migrated components. Always calls BOTH
// db.useQuery and usePgQuery (Rules of Hooks), returns whichever matches
// the VITE_USE_PG_DATA flag.
//
// Migration in a component:
//   BEFORE:
//     const { data, isLoading } = db.useQuery({
//       customers: { $: { where: { userId: ownerId } } },
//       invoices:  { $: { where: { userId: ownerId } } },
//     });
//
//   AFTER:
//     const { data, isLoading, refetch } = useData(
//       { customers: { $: { where: { userId: ownerId } } },
//         invoices:  { $: { where: { userId: ownerId } } } },   // InstantDB query
//       ['customers', 'invoices']                                // PG collections
//     );
//     // ...and call refetch() after each dbWrite().
//
// NOTE: usePgQuery returns ALL tenant rows for each collection (RLS-scoped);
// any extra where-clauses in the InstantDB query are applied client-side by
// the component, same as before. Don't use this for huge collections
// (leads/callLogs/activityLogs) — those have dedicated server endpoints.
// ===================================================================
import db from '../instant';
import { usePgQuery } from './usePgQuery';

const USE_PG_DATA = import.meta.env.VITE_USE_PG_DATA === 'true';

export function useData(instantQuery, pgCollections) {
  // pgCollections: array of names, or object { coll: { where } } for filters.
  // Both hooks ALWAYS called; the inactive one is fed an empty/null arg.
  const instantResult = db.useQuery(USE_PG_DATA ? null : instantQuery);
  const pgResult      = usePgQuery(USE_PG_DATA ? pgCollections : []);

  if (USE_PG_DATA) {
    return {
      data: pgResult.data,
      isLoading: pgResult.isLoading,
      error: pgResult.error,
      refetch: pgResult.refetch,
    };
  }
  return {
    data: instantResult.data,
    isLoading: instantResult.isLoading,
    error: instantResult.error,
    refetch: () => {}, // InstantDB is real-time — refetch is a no-op
  };
}
