import { init } from '@instantdb/admin';
import { getLeadsForOwner } from './_leads-cache.js';
import { opU, runOps, readData } from './_write-ops.js';

const APP_ID = process.env.VITE_INSTANT_APP_ID;
const ADMIN_TOKEN = process.env.INSTANT_ADMIN_TOKEN;

// POST /api/rename-assignee
// When a team member is renamed, leads (and tasks) store the assignee by NAME,
// so they'd orphan. This cascades old name -> new name across the owner's leads
// and tasks. Runs server-side because the leads table is too large to load in
// the browser. Routes to Postgres or InstantDB via the shared write path.
//
// Body: { ownerId, oldName, newName }
// Returns: { updated, tasksUpdated }
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
      return res.status(200).json({ updated: 0, tasksUpdated: 0 });
    }

    const db = init({ appId: APP_ID, adminToken: ADMIN_TOKEN });

    // Match leads case-insensitively + trimmed, so stray spaces/casing on the old
    // value are also remapped to the clean new name.
    const leads = await getLeadsForOwner(ownerId);
    const oldKey = oldTrim.toLowerCase();
    const leadsToFix = leads.filter(l => norm(l.assign).toLowerCase() === oldKey);

    // Tasks reference the assignee by name too (field: assignedTo).
    const taskData = await readData(db, ownerId, { tasks: { $: { where: { userId: ownerId } } } });
    const tasksToFix = (taskData.tasks || []).filter(t => norm(t.assignedTo).toLowerCase() === oldKey);

    const BATCH = 200;
    let updated = 0;
    for (let i = 0; i < leadsToFix.length; i += BATCH) {
      const chunk = leadsToFix.slice(i, i + BATCH);
      await runOps(db, ownerId, chunk.map(l => opU('leads', l.id, { assign: newTrim })));
      updated += chunk.length;
    }
    let tasksUpdated = 0;
    for (let i = 0; i < tasksToFix.length; i += BATCH) {
      const chunk = tasksToFix.slice(i, i + BATCH);
      await runOps(db, ownerId, chunk.map(t => opU('tasks', t.id, { assignedTo: newTrim })));
      tasksUpdated += chunk.length;
    }

    console.log(`[rename-assignee] ${ownerId}: "${oldTrim}" -> "${newTrim}" — leads ${updated}, tasks ${tasksUpdated}`);
    return res.status(200).json({ updated, tasksUpdated });
  } catch (err) {
    console.error('rename-assignee error:', err);
    return res.status(500).json({ error: err.message });
  }
}
