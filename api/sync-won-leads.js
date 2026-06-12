import { init } from '@instantdb/admin';
import { opU, runOps, readData } from './_write-ops.js';
import { getLeadsForOwner } from './_leads-cache.js';

const APP_ID = process.env.VITE_INSTANT_APP_ID;
const ADMIN_TOKEN = process.env.INSTANT_ADMIN_TOKEN;

// POST /api/sync-won-leads
// Auto-syncs Won-stage leads to the customers collection.
// Previously ran client-side on every subscription update — at 11k leads this
// caused the Customers page to hang because the full leads subscription timed
// out. Now runs as a one-shot server call on page mount.
//
// Body: { ownerId, wonStage, userId, userEmail }
// Returns: { synced: n }
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const { ownerId, wonStage = 'Won', userId, userEmail } = req.body || {};
    if (!ownerId) return res.status(400).json({ error: 'ownerId required' });

    const db = init({ appId: APP_ID, adminToken: ADMIN_TOKEN });

    // Fetch leads from shared cache + customers fresh (customers are small)
    const [allLeads, custResult] = await Promise.all([
      getLeadsForOwner(ownerId),
      db.query({ customers: { $: { where: { userId: ownerId } } } }),
    ]);

    const customers = custResult.customers || [];
    const wonLeads = allLeads.filter(l => l.stage === wonStage);
    if (wonLeads.length === 0) return res.status(200).json({ synced: 0 });

    // Build O(1) lookup maps for dedup
    const emailSet = new Set(customers.map(c => (c.email || '').toLowerCase().trim()).filter(Boolean));
    const phoneSet = new Set(customers.map(c => (c.phone || '').replace(/\D/g, '')).filter(Boolean));
    const nameSet = new Set(customers.map(c => (c.name || '').toLowerCase().trim()));

    const toCreate = wonLeads.filter(l => {
      const email = (l.email || '').toLowerCase().trim();
      const phone = (l.phone || '').replace(/\D/g, '');
      const name = (l.name || '').toLowerCase().trim();
      if (email && emailSet.has(email)) return false;
      if (phone && phoneSet.has(phone)) return false;
      if (name && nameSet.has(name)) return false;
      return true;
    });

    if (toCreate.length === 0) return res.status(200).json({ synced: 0 });

    // Build transactions — batch in groups of 200 to stay within InstantDB limits
    const { id } = await import('@instantdb/admin');
    const BATCH = 200;
    let synced = 0;
    for (let i = 0; i < toCreate.length; i += BATCH) {
      const chunk = toCreate.slice(i, i + BATCH);
      const txs = [];
      chunk.forEach(l => {
        const newId = id();
        txs.push(opU('customers', newId, {
          name: l.name,
          companyName: l.companyName || '',
          email: l.email || '',
          phone: l.phone || '',
          address: l.address || '',
          userId: ownerId,
          actorId: userId || '',
          createdAt: Date.now(),
        }));
        txs.push(opU('activityLogs', id(), {
          entityId: newId,
          entityType: 'customer',
          text: `Customer created via Sync from Lead "${l.name}"`,
          userId: ownerId,
          actorId: userId || '',
          userName: userEmail || '',
          createdAt: Date.now(),
        }));
      });
      await runOps(db, ownerId, txs);
      synced += chunk.length;
    }

    return res.status(200).json({ synced });
  } catch (err) {
    console.error('sync-won-leads error:', err);
    return res.status(500).json({ error: err.message });
  }
}
