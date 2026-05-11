import { init, tx } from '@instantdb/admin';

const APP_ID = process.env.VITE_INSTANT_APP_ID;
const ADMIN_TOKEN = process.env.INSTANT_ADMIN_TOKEN;

// Fingerprint: same number + direction + minute + duration + staff = same call
function fingerprintCall(l) {
  const cleanPhone = (l.phone || '').replace(/\D/g, '').slice(-10);
  const minute = Math.floor((l.createdAt || 0) / 60000);
  const dur = l.duration ? Number(l.duration) : 0;
  return `${cleanPhone}|${l.direction || ''}|${minute}|${dur}|${l.staffEmail || ''}`;
}

// POST /api/dedupe-call-logs  { ownerId }
// Hard-deletes duplicate callLogs rows for this owner. Keeps the OLDEST row
// in each duplicate group (preserves the original audit trail) and deletes
// the rest. Returns { groups, deleted }.
//
// Follows CLAUDE.md rules:
//   - Hard delete (db.tx.callLogs[id].delete()) — no soft delete flag
//   - No orphans: callLogs has no dependent collections to cascade
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const { ownerId } = req.body || {};
    if (!ownerId) return res.status(400).json({ error: 'ownerId required' });

    const db = init({ appId: APP_ID, adminToken: ADMIN_TOKEN });
    const { callLogs } = await db.query({
      callLogs: { $: { where: { userId: ownerId } } },
    });
    const logs = callLogs || [];

    const groups = new Map(); // fingerprint -> [logs]
    for (const l of logs) {
      const fp = fingerprintCall(l);
      if (!groups.has(fp)) groups.set(fp, []);
      groups.get(fp).push(l);
    }

    const toDelete = [];
    let dupGroups = 0;
    for (const [, list] of groups) {
      if (list.length <= 1) continue;
      dupGroups++;
      // Keep oldest (smallest createdAt), delete the rest
      list.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      for (let i = 1; i < list.length; i++) toDelete.push(list[i].id);
    }

    if (toDelete.length === 0) {
      return res.status(200).json({ groups: 0, deleted: 0 });
    }

    // Hard delete in batches of 200 to stay within InstantDB transaction limits
    const BATCH = 200;
    for (let i = 0; i < toDelete.length; i += BATCH) {
      const chunk = toDelete.slice(i, i + BATCH);
      await db.transact(chunk.map(id => tx.callLogs[id].delete()));
    }

    return res.status(200).json({ groups: dupGroups, deleted: toDelete.length });
  } catch (err) {
    console.error('dedupe-call-logs error:', err);
    return res.status(500).json({ error: err.message });
  }
}
