import { init } from '@instantdb/react';
import { useInstantPgQuery } from './hooks/usePgQuery';

const APP_ID = import.meta.env.VITE_INSTANT_APP_ID;
const USE_PG_DATA = import.meta.env.VITE_USE_PG_DATA === 'true';

if (!APP_ID || APP_ID === 'your-instantdb-app-id-here') {
  console.error(
    '⚠️ T2GCRM: InstantDB App ID not configured!\n' +
    'Please open the .env file and set VITE_INSTANT_APP_ID to your app ID from https://instantdb.com/dash'
  );
}

const realDb = init({ appId: APP_ID });

// Wrapped useQuery: when VITE_USE_PG_DATA=true, ALL db.useQuery() calls across
// the app read from Postgres (via usePgQuery) instead of InstantDB — no
// per-component change needed. Both hooks are always called (Rules of Hooks);
// the inactive one gets null. When the flag is off (prod), it's a pure
// pass-through to InstantDB — zero behaviour change.
function useQuery(query) {
  const instantResult = realDb.useQuery(USE_PG_DATA ? null : query);
  const pgResult      = useInstantPgQuery(USE_PG_DATA ? query : null);
  return USE_PG_DATA ? pgResult : instantResult;
}

// Proxy delegates everything (transact, tx, auth, useAuth, …) to the real
// InstantDB instance, but swaps in the wrapped useQuery.
const db = new Proxy(realDb, {
  get(target, prop) {
    if (prop === 'useQuery') return useQuery;
    const v = target[prop];
    return typeof v === 'function' ? v.bind(target) : v;
  },
});

export default db;
