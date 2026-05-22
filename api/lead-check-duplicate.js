import { init } from '@instantdb/admin';

const APP_ID = process.env.VITE_INSTANT_APP_ID;
const ADMIN_TOKEN = process.env.INSTANT_ADMIN_TOKEN;

// POST /api/lead-check-duplicate
// Single mode:  { ownerId, phone, email, excludeLeadId?, excludeCustomerId? }
//   → { duplicate: {...} | null }
// Batch mode:   { ownerId, candidates: [{ phone, email }, ...] }
//   → { duplicates: { "<index>": { matchedOn, name } } }  (only duplicate rows included)
//
// Batch mode exists for bulk CSV import: checking N rows one-at-a-time meant N
// sequential requests AND N full-DB scans (catastrophic at thousands of rows —
// froze the browser). Batch mode queries the DB ONCE, builds phone/email index
// maps, and resolves every candidate in memory.
//
// Checks leads + customers for matching phone or email (case-insensitive).
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const db = init({ appId: APP_ID, adminToken: ADMIN_TOKEN });
    const {
      ownerId,
      phone = '',
      email = '',
      excludeLeadId = null,
      excludeCustomerId = null,
      candidates = null, // batch mode when this is an array
    } = req.body || {};

    if (!ownerId) return res.status(400).json({ error: 'ownerId required' });

    // ─── Batch mode ─────────────────────────────────────────────────────
    if (Array.isArray(candidates)) {
      const result = await db.query({
        leads: { $: { where: { userId: ownerId } } },
        customers: { $: { where: { userId: ownerId } } },
      });
      const phoneIndex = new Map(); // last10digits → name
      const emailIndex = new Map(); // lowercased email → name
      for (const r of [...(result.leads || []), ...(result.customers || [])]) {
        const p = String(r.phone || '').replace(/\D/g, '').slice(-10);
        const e = String(r.email || '').trim().toLowerCase();
        if (p && !phoneIndex.has(p)) phoneIndex.set(p, r.name || '');
        if (e && !emailIndex.has(e)) emailIndex.set(e, r.name || '');
      }
      const duplicates = {};
      candidates.forEach((c, i) => {
        const p = String(c.phone || '').replace(/\D/g, '').slice(-10);
        const e = String(c.email || '').trim().toLowerCase();
        if (p && phoneIndex.has(p)) {
          duplicates[i] = { matchedOn: 'phone', name: phoneIndex.get(p) };
        } else if (e && emailIndex.has(e)) {
          duplicates[i] = { matchedOn: 'email', name: emailIndex.get(e) };
        }
      });
      return res.status(200).json({ duplicates });
    }

    const cleanPhone = String(phone || '').trim().toLowerCase();
    const cleanEmail = String(email || '').trim().toLowerCase();
    if (!cleanPhone && !cleanEmail) return res.status(200).json({ duplicate: null });

    const result = await db.query({
      leads: { $: { where: { userId: ownerId } } },
      customers: { $: { where: { userId: ownerId } } },
    });

    const leads = result.leads || [];
    const customers = result.customers || [];

    // Also compute original (pre-edit) identity so we can skip the converted
    // customer record when editing a lead that's already been converted.
    let origPhone = '';
    let origEmail = '';
    if (excludeLeadId) {
      const orig = leads.find(l => l.id === excludeLeadId);
      if (orig) {
        origPhone = String(orig.phone || '').trim().toLowerCase();
        origEmail = String(orig.email || '').trim().toLowerCase();
      }
    }

    const check = (r, type) => {
      if (type === 'lead' && excludeLeadId && r.id === excludeLeadId) return null;
      if (type === 'customer' && excludeCustomerId && r.id === excludeCustomerId) return null;

      // Skip the converted-customer record linked to the lead being edited
      if (type === 'customer' && excludeLeadId && r.leadId === excludeLeadId) return null;

      const rPhone = String(r.phone || '').trim().toLowerCase();
      const rEmail = String(r.email || '').trim().toLowerCase();

      // Skip records whose phone+email both match the original lead's identity
      if (type === 'customer' && excludeLeadId && origPhone && rPhone === origPhone && (!origEmail || rEmail === origEmail)) return null;
      if (type === 'customer' && excludeLeadId && origEmail && rEmail === origEmail && (!origPhone || rPhone === origPhone)) return null;

      if (cleanPhone && rPhone && rPhone === cleanPhone) {
        return { id: r.id, name: r.name || '', phone: r.phone || '', email: r.email || '', source: r.source || '', type, matchedOn: 'phone' };
      }
      if (cleanEmail && rEmail && rEmail === cleanEmail) {
        return { id: r.id, name: r.name || '', phone: r.phone || '', email: r.email || '', source: r.source || '', type, matchedOn: 'email' };
      }
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
