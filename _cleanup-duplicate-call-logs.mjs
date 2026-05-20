// One-shot cleanup for duplicate call logs created before the time-tolerant
// dedup landed. Groups every call log by (phone last10, direction, duration,
// staffEmail) and walks each group sorted by createdAt. The first row keeps
// the duplicate window open; any subsequent row within 10 minutes is treated
// as the same physical call and deleted. The next row outside that window
// starts a fresh window — so distinct callbacks with identical duration are
// preserved.
//
// Usage:
//   1. Make sure your local .env has the prod VITE_INSTANT_APP_ID and
//      INSTANT_ADMIN_TOKEN (the same values you use in the live VPS).
//   2. node _cleanup-duplicate-call-logs.mjs                # dry run, no deletes
//   3. node _cleanup-duplicate-call-logs.mjs --commit       # actually delete
//   Optionally restrict by owner: --owner=<userProfiles.userId>
//
// After verifying the result, delete this file (per CLAUDE.md Call Logs
// Integrity → Rule 4: cleanup is a one-shot, not a recurring button).

import 'dotenv/config';
import { init, tx } from '@instantdb/admin';

const APP_ID = process.env.VITE_INSTANT_APP_ID;
const ADMIN_TOKEN = process.env.INSTANT_ADMIN_TOKEN;
if (!APP_ID || !ADMIN_TOKEN) {
  console.error('Missing VITE_INSTANT_APP_ID or INSTANT_ADMIN_TOKEN in env.');
  process.exit(1);
}

const args = new Set(process.argv.slice(2));
const COMMIT = args.has('--commit');
const ownerArg = process.argv.find(a => a.startsWith('--owner='));
const ONLY_OWNER = ownerArg ? ownerArg.split('=')[1] : null;

const DUP_WINDOW_MS = 10 * 60 * 1000;

const db = init({ appId: APP_ID, adminToken: ADMIN_TOKEN });

function keyOf(l) {
  const phone = (l.phone || '').replace(/\D/g, '').slice(-10);
  const dur = l.duration ? Number(l.duration) : 0;
  return `${l.userId}|${phone}|${l.direction || 'Incoming'}|${dur}|${l.staffEmail || ''}`;
}

async function main() {
  console.log(`Mode: ${COMMIT ? 'COMMIT (will delete)' : 'DRY RUN (no deletes)'}`);
  if (ONLY_OWNER) console.log(`Owner filter: ${ONLY_OWNER}`);

  const where = ONLY_OWNER ? { userId: ONLY_OWNER } : {};
  const { callLogs } = await db.query({ callLogs: { $: { where } } });
  console.log(`Loaded ${callLogs.length} call log rows.`);

  // Bucket by key, sort each bucket by createdAt asc.
  const buckets = new Map();
  for (const l of callLogs) {
    const k = keyOf(l);
    const arr = buckets.get(k);
    if (arr) arr.push(l);
    else buckets.set(k, [l]);
  }

  const toDelete = [];
  let groupsScanned = 0;
  let groupsWithDup = 0;
  for (const [, rows] of buckets) {
    groupsScanned++;
    if (rows.length < 2) continue;
    rows.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    let anchor = rows[0];
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const dt = (r.createdAt || 0) - (anchor.createdAt || 0);
      if (dt <= DUP_WINDOW_MS) {
        toDelete.push(r.id);
      } else {
        anchor = r;
      }
    }
    if (toDelete.length > 0) groupsWithDup++;
  }

  console.log(`Groups scanned: ${groupsScanned}`);
  console.log(`Duplicate rows queued for deletion: ${toDelete.length}`);

  if (!COMMIT) {
    console.log('Dry run — nothing deleted. Re-run with --commit to apply.');
    return;
  }
  if (toDelete.length === 0) {
    console.log('Nothing to delete.');
    return;
  }

  // InstantDB transactions batch in groups of 50.
  for (let i = 0; i < toDelete.length; i += 50) {
    const chunk = toDelete.slice(i, i + 50);
    await db.transact(chunk.map(id => tx.callLogs[id].delete()));
    console.log(`Deleted ${Math.min(i + 50, toDelete.length)}/${toDelete.length}`);
  }
  console.log('Done.');
}

main().catch(e => { console.error(e); process.exit(1); });
