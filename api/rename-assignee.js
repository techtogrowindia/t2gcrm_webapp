import { init } from '@instantdb/admin';
import { getLeadsForOwner } from './_leads-cache.js';
import { opU, runOps, readData } from './_write-ops.js';

const APP_ID = process.env.VITE_INSTANT_APP_ID;
const ADMIN_TOKEN = process.env.INSTANT_ADMIN_TOKEN;

// POST /api/rename-assignee
// Leads, quotes, invoices, AMC contracts and tasks all store the assignee by
// NAME, so renaming a team member orphans every record still pointing at the
// old one — they disappear from that member's lists and from name-based
// reports. This cascades old name -> new name across all of them.
//
// Runs server-side because the leads table is far too large to load in the
// browser. Routes to Postgres or InstantDB via the shared write path.
//
// Body: { ownerId, oldName, newName }
// Returns: { updated, tasksUpdated, byCollection: {...}, total }

// Every place an assignee name is stored. Adding another is one line here.
// `field` must be the EXACT doc key the app reads: tasks use `assignTo`, and
// writing `assignedTo` instead (as this did) silently creates a junk field
// while leaving the real one stale — the rename appears to work and doesn't.
const ASSIGNEE_FIELDS = [
  { collection: 'leads',    field: 'assign' },
  { collection: 'quotes',   field: 'assign' },
  { collection: 'invoices', field: 'assign' },
  { collection: 'amc',      field: 'assign' },
  { collection: 'tasks',    field: 'assignTo' },
];

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const { ownerId, oldName, newName } = req.body || {};
    if (!ownerId || oldName == null || newName == null) {
      return res.status(400).json({ error: 'ownerId, oldName, newName required' });
    }
    const norm = (s) => String(s ?? '').trim().replace(/\s+/g, ' ');   // trim + collapse internal spaces
    const oldTrim = norm(oldName);
    const newTrim = norm(newName);
    if (!oldTrim || !newTrim || oldTrim === newTrim) {
      return res.status(200).json({ updated: 0, tasksUpdated: 0, byCollection: {}, total: 0 });
    }

    const db = init({ appId: APP_ID, adminToken: ADMIN_TOKEN });
    // Match case-insensitively and trimmed, so stray spacing or casing on the
    // old value is remapped to the clean new name as well.
    const oldKey = oldTrim.toLowerCase();
    const BATCH = 200;
    const byCollection = {};

    for (const { collection, field } of ASSIGNEE_FIELDS) {
      // Leads come from the shared cache — that table is too big for a plain read.
      const rows = collection === 'leads'
        ? await getLeadsForOwner(ownerId)
        : (await readData(db, ownerId, { [collection]: { $: { where: { userId: ownerId } } } }))[collection] || [];

      const toFix = (rows || []).filter(r => norm(r[field]).toLowerCase() === oldKey);
      let n = 0;
      for (let i = 0; i < toFix.length; i += BATCH) {
        const chunk = toFix.slice(i, i + BATCH);
        await runOps(db, ownerId, chunk.map(r => opU(collection, r.id, { [field]: newTrim })));
        n += chunk.length;
      }
      byCollection[collection] = n;
    }

    const total = Object.values(byCollection).reduce((a, b) => a + b, 0);
    console.log(`[rename-assignee] ${ownerId}: "${oldTrim}" -> "${newTrim}" —`,
      Object.entries(byCollection).map(([c, n]) => `${c} ${n}`).join(', '));
    // updated / tasksUpdated kept so any existing caller keeps working.
    return res.status(200).json({
      updated: byCollection.leads || 0,
      tasksUpdated: byCollection.tasks || 0,
      byCollection,
      total,
    });
  } catch (err) {
    console.error('rename-assignee error:', err);
    return res.status(500).json({ error: err.message });
  }
}
