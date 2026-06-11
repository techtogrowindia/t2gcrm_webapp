import { init } from '@instantdb/admin';
import { tenantQuery } from './db-pg.js';

const APP_ID = process.env.VITE_INSTANT_APP_ID;
const ADMIN_TOKEN = process.env.INSTANT_ADMIN_TOKEN;
const USE_PG_DATA = process.env.USE_PG_DATA === 'true';

// POST /api/lead-counts
// Body: { ownerId, userEmail?, myName?, teamCanSeeAllLeads?, isOwner? }
// Response: { items: [{ id, createdAt, followup, assign }], total }
// Lightweight metadata only — bucketing done on the client (timezone-correct).
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const {
      ownerId, userEmail, myName,
      teamCanSeeAllLeads = true,
      isOwner = true,
    } = req.body || {};

    if (!ownerId) return res.status(400).json({ error: 'ownerId required' });

    let all;
    if (USE_PG_DATA) {
      // Only fetch the columns needed — keeps payload small
      const result = await tenantQuery(
        ownerId,
        `SELECT id, doc->>'createdAt' AS created_at_raw,
                doc->>'followup' AS followup, doc->>'assign' AS assign
         FROM leads`
      );
      all = result.rows.map(r => ({
        id:        r.id,
        createdAt: r.created_at_raw ? Number(r.created_at_raw) : 0,
        followup:  r.followup  || '',
        assign:    r.assign    || '',
      }));
    } else {
      const db = init({ appId: APP_ID, adminToken: ADMIN_TOKEN });
      const result = await db.query({
        leads: { $: { where: { userId: ownerId } } },
      });
      all = (result.leads || []).map(l => ({
        id:        l.id,
        createdAt: l.createdAt || 0,
        followup:  l.followup  || '',
        assign:    l.assign    || '',
      }));
    }

    if (!isOwner && !teamCanSeeAllLeads) {
      all = all.filter(l => !l.assign || l.assign === userEmail || l.assign === myName);
    }

    return res.status(200).json({ items: all, total: all.length });
  } catch (err) {
    console.error('lead-counts error:', err);
    return res.status(500).json({ error: err.message });
  }
}
