import { init } from '@instantdb/admin';
import { getLeadsForOwner, invalidateLeadsCache } from './_leads-cache.js';
import { opU, runOps, readData } from './_write-ops.js';

const APP_ID = process.env.VITE_INSTANT_APP_ID;
const ADMIN_TOKEN = process.env.INSTANT_ADMIN_TOKEN;

// POST /api/member-reassign
// Powers the team-member delete-guard: a member can't be removed while records
// are still assigned to them, so this both COUNTS what's assigned and REASSIGNS
// it to another member before deletion.
//
//   action:'count'    → { total, leads, byCollection }   (no writes)
//   action:'reassign' → moves every record from one member to another, stamping
//                       the assignee NAME + stable assignedToId + assignedAt
//
// Runs server-side because the leads table is too large to load in the browser.
// Matches a member the same way visibility should: by stable id when the record
// has one, else by name — so it catches both migrated and legacy records.
//
// Body: { ownerId, action, fromId, fromName, toId?, toName? }

const ASSIGNEE_FIELDS = [
  { collection: 'leads',    field: 'assign' },
  { collection: 'quotes',   field: 'assign' },
  { collection: 'invoices', field: 'assign' },
  { collection: 'amc',      field: 'assign' },
  { collection: 'tasks',    field: 'assignTo' },
];

const norm = (s) => String(s ?? '').trim().replace(/\s+/g, ' ');

// A record belongs to the member if its stable id matches; only when it has no
// id do we fall back to the name — mirrors the id-preferred visibility rule so
// count and reassign never disagree with what the member actually sees.
function belongsTo(rec, field, fromId, fromKey) {
  const aid = rec.assignedToId || '';
  if (aid) return !!fromId && aid === fromId;
  return norm(rec[field]).toLowerCase() === fromKey;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const { ownerId, action, fromId = '', fromName = '', toId = '', toName = '' } = req.body || {};
    if (!ownerId) return res.status(400).json({ error: 'ownerId required' });
    if (action !== 'count' && action !== 'reassign') {
      return res.status(400).json({ error: "action must be 'count' or 'reassign'" });
    }
    if (!fromId && !norm(fromName)) {
      return res.status(400).json({ error: 'fromId or fromName required' });
    }
    if (action === 'reassign' && !toId && !norm(toName)) {
      return res.status(400).json({ error: 'toId or toName required for reassign' });
    }

    const db = init({ appId: APP_ID, adminToken: ADMIN_TOKEN });
    const fromKey = norm(fromName).toLowerCase();
    const now = Date.now();
    const BATCH = 200;
    const byCollection = {};
    let wroteLeads = false;

    for (const { collection, field } of ASSIGNEE_FIELDS) {
      // Leads come from the shared cache — that table is too big for a plain read.
      const rows = collection === 'leads'
        ? await getLeadsForOwner(ownerId)
        : (await readData(db, ownerId, { [collection]: { $: { where: { userId: ownerId } } } }))[collection] || [];

      const mine = (rows || []).filter(r => belongsTo(r, field, fromId, fromKey));

      if (action === 'count') { byCollection[collection] = mine.length; continue; }

      // reassign: name snapshot + stable id + when it was (re)assigned
      const patch = { [field]: norm(toName), assignedToId: toId || '', assignedAt: now };
      let n = 0;
      for (let i = 0; i < mine.length; i += BATCH) {
        const chunk = mine.slice(i, i + BATCH);
        await runOps(db, ownerId, chunk.map(r => opU(collection, r.id, patch)));
        n += chunk.length;
      }
      byCollection[collection] = n;
      if (collection === 'leads' && n > 0) wroteLeads = true;
    }

    // The leads cache we read from is now stale after a reassign.
    if (action === 'reassign' && wroteLeads) invalidateLeadsCache(ownerId);

    const total = Object.values(byCollection).reduce((a, b) => a + b, 0);
    if (action === 'reassign') {
      console.log(`[member-reassign] ${ownerId}: "${fromName || fromId}" -> "${toName || toId}" —`,
        Object.entries(byCollection).map(([c, n]) => `${c} ${n}`).join(', '));
    }
    return res.status(200).json({ total, leads: byCollection.leads || 0, byCollection });
  } catch (err) {
    console.error('member-reassign error:', err);
    return res.status(500).json({ error: err.message });
  }
}
