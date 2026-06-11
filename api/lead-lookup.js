import { getLeadsForOwner } from './_leads-cache.js';
import { init } from '@instantdb/admin';
import { tenantQuery } from './db-pg.js';

const APP_ID = process.env.VITE_INSTANT_APP_ID;
const ADMIN_TOKEN = process.env.INSTANT_ADMIN_TOKEN;
const USE_PG_DATA = process.env.USE_PG_DATA === 'true';

let _db = null;
function getDb() {
  if (!_db) _db = init({ appId: APP_ID, adminToken: ADMIN_TOKEN });
  return _db;
}

// POST /api/lead-lookup
// Body: { ownerId, phone?, email? }
// Returns: { lead: {...} | null, customer: {...} | null }
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const { ownerId, phone, email } = req.body || {};
    if (!ownerId) return res.status(400).json({ error: 'ownerId required' });
    if (!phone && !email) return res.status(400).json({ error: 'phone or email required' });

    const normalPhone = (phone || '').trim().toLowerCase();
    const normalEmail = (email || '').trim().toLowerCase();

    // leads — already migrated via _leads-cache.js
    const leads = await getLeadsForOwner(ownerId);

    // customers — Postgres or InstantDB
    let customers;
    if (USE_PG_DATA) {
      const result = await tenantQuery(ownerId, 'SELECT doc FROM customers');
      customers = result.rows.map(r => r.doc);
    } else {
      const db = getDb();
      const result = await db.query({
        customers: { $: { where: { userId: ownerId } } },
      });
      customers = result.customers || [];
    }

    const matchingLead = leads.find(l => {
      if (normalPhone && (l.phone || '').trim().toLowerCase() === normalPhone) return true;
      if (normalEmail && (l.email || '').trim().toLowerCase() === normalEmail) return true;
      return false;
    }) || null;

    const matchingCustomer = customers.find(c => {
      if (normalPhone && (c.phone || '').trim().toLowerCase() === normalPhone) return true;
      if (normalEmail && (c.email || '').trim().toLowerCase() === normalEmail) return true;
      return false;
    }) || null;

    return res.status(200).json({ lead: matchingLead, customer: matchingCustomer });
  } catch (err) {
    console.error('lead-lookup error:', err);
    return res.status(500).json({ error: err.message });
  }
}
