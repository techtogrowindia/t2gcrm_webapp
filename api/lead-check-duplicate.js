import { init } from '@instantdb/admin';
import { tenantQuery } from './db-pg.js';
import { phoneKey } from './_phone.js';

const APP_ID = process.env.VITE_INSTANT_APP_ID;
const ADMIN_TOKEN = process.env.INSTANT_ADMIN_TOKEN;
const USE_PG_DATA = process.env.USE_PG_DATA === 'true';

// POST /api/lead-check-duplicate
// Single mode:  { ownerId, phone, email, excludeLeadId?, excludeCustomerId? }
//   → { duplicate: {...} | null }
// Batch mode:   { ownerId, candidates: [{ phone, email }, ...] }
//   → { duplicates: { "<index>": { matchedOn, name } } }
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const {
      ownerId,
      phone = '',
      email = '',
      excludeLeadId = null,
      excludeCustomerId = null,
      candidates = null,
    } = req.body || {};

    if (!ownerId) return res.status(400).json({ error: 'ownerId required' });

    // ── Fetch leads + customers (Postgres or InstantDB) ───────────────────
    let leads, customers;
    if (USE_PG_DATA) {
      const [lr, cr] = await Promise.all([
        tenantQuery(ownerId, 'SELECT id, doc FROM leads'),
        tenantQuery(ownerId, 'SELECT id, doc FROM customers'),
      ]);
      leads     = lr.rows.map(r => ({ ...r.doc, id: r.id }));
      customers = cr.rows.map(r => ({ ...r.doc, id: r.id }));
    } else {
      const db = init({ appId: APP_ID, adminToken: ADMIN_TOKEN });
      const result = await db.query({
        leads:     { $: { where: { userId: ownerId } } },
        customers: { $: { where: { userId: ownerId } } },
      });
      leads     = result.leads     || [];
      customers = result.customers || [];
    }

    // ── Batch mode ────────────────────────────────────────────────────────
    if (Array.isArray(candidates)) {
      const phoneIndex = new Map();
      const emailIndex = new Map();
      for (const r of [...leads, ...customers]) {
        const p = phoneKey(r.phone);
        const e = String(r.email || '').trim().toLowerCase();
        if (p && !phoneIndex.has(p)) phoneIndex.set(p, r.name || '');
        if (e && !emailIndex.has(e)) emailIndex.set(e, r.name || '');
      }
      const duplicates = {};
      candidates.forEach((c, i) => {
        const p = phoneKey(c.phone);
        const e = String(c.email || '').trim().toLowerCase();
        if (p && phoneIndex.has(p)) {
          duplicates[i] = { matchedOn: 'phone', name: phoneIndex.get(p) };
        } else if (e && emailIndex.has(e)) {
          duplicates[i] = { matchedOn: 'email', name: emailIndex.get(e) };
        }
      });
      return res.status(200).json({ duplicates });
    }

    // ── Single mode ───────────────────────────────────────────────────────
    // Phone compared on its last-10-digit key (same as batch mode above), so a
    // number stored as +91… is still flagged when the user types the bare form.
    const cleanPhone = phoneKey(phone);
    const cleanEmail = String(email || '').trim().toLowerCase();
    if (!cleanPhone && !cleanEmail) return res.status(200).json({ duplicate: null });

    let origPhone = '';
    let origEmail = '';
    if (excludeLeadId) {
      const orig = leads.find(l => l.id === excludeLeadId);
      if (orig) {
        origPhone = phoneKey(orig.phone);
        origEmail = String(orig.email || '').trim().toLowerCase();
      }
    }

    const check = (r, type) => {
      if (type === 'lead'     && excludeLeadId     && r.id === excludeLeadId)     return null;
      if (type === 'customer' && excludeCustomerId && r.id === excludeCustomerId) return null;
      if (type === 'customer' && excludeLeadId     && r.leadId === excludeLeadId) return null;

      const rPhone = phoneKey(r.phone);
      const rEmail = String(r.email || '').trim().toLowerCase();

      if (type === 'customer' && excludeLeadId && origPhone && rPhone === origPhone && (!origEmail || rEmail === origEmail)) return null;
      if (type === 'customer' && excludeLeadId && origEmail && rEmail === origEmail && (!origPhone || rPhone === origPhone)) return null;

      if (cleanPhone && rPhone && rPhone === cleanPhone)
        return { id: r.id, name: r.name || '', phone: r.phone || '', email: r.email || '', source: r.source || '', type, matchedOn: 'phone' };
      if (cleanEmail && rEmail && rEmail === cleanEmail)
        return { id: r.id, name: r.name || '', phone: r.phone || '', email: r.email || '', source: r.source || '', type, matchedOn: 'email' };
      return null;
    };

    for (const l of leads) {
      const hit = check(l, 'lead');
      if (hit) return res.status(200).json({ duplicate: hit });
    }
    for (const c of customers) {
      const hit = check(c, 'customer');
      if (hit) return res.status(200).json({ duplicate: hit });
    }

    return res.status(200).json({ duplicate: null });
  } catch (err) {
    console.error('lead-check-duplicate error:', err);
    return res.status(500).json({ error: err.message });
  }
}
