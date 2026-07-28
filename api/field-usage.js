// ===================================================================
// api/field-usage.js — "is this configured value still in use?"
//
// Settings lets an owner delete or disable a stage, source, requirement,
// custom field, category and so on. Nothing checked whether records still
// referenced the value, so the records didn't move — they were simply orphaned
// against a value that no longer exists, or (for a disabled stage) hidden from
// every report while still sitting in the database. That is how ARS ended up
// with leads stranded in "Quotation Created".
//
// Counting happens here rather than in the browser because Settings must never
// subscribe to leads — the collection is 11k+ rows (CLAUDE.md "Scale
// Architecture"). Uses the shared 15s leads cache, so repeated checks while
// someone edits a list are effectively free.
// ===================================================================
import { init } from '@instantdb/admin';
import { getLeadsForOwner } from './_leads-cache.js';
import { readData } from './_write-ops.js';

const APP_ID = process.env.VITE_INSTANT_APP_ID;
const ADMIN_TOKEN = process.env.INSTANT_ADMIN_TOKEN;

// Settings list key -> where that value is referenced.
//   source 'leads'  reads the cached leads array
//   source 'query'  reads a smaller collection directly
// Each entry is a LIST of probes, because one value is usually referenced from
// more than one collection — a custom field appears on customers as well as
// leads, and a product name is copied onto quotation and invoice line items.
// Checking only the first one is how a value gets deleted while records still
// point at it.
const itemNamed = (name) => (rec) =>
  (rec.items || []).some(i => norm(i?.name) === norm(name)) ? name : null;
const customUsed = (rec, name) => (rec.custom && rec.custom[name] ? name : null);

const FIELDS = {
  stages:        [{ source: 'leads', pick: (l) => l.stage,       label: 'lead' }],
  sources:       [{ source: 'leads', pick: (l) => l.source,      label: 'lead' }],
  requirements:  [{ source: 'leads', pick: (l) => l.requirement, label: 'lead' }],
  productCats:   [
    { source: 'leads', pick: (l) => l.productCat, label: 'lead' },
    { source: 'query', collection: 'products', pick: (p) => p.category, label: 'product' },
  ],
  // A value is "in use" when any record has a non-empty entry for that field,
  // whatever the entry says.
  customFields:  [
    { source: 'leads', pick: customUsed, label: 'lead' },
    { source: 'query', collection: 'customers', pick: customUsed, label: 'customer' },
  ],
  // The product itself. Deleting one leaves leads and documents pointing at a
  // name that no longer exists.
  products:      [
    // Leads hold the product NAME in `productName` — that's the field the
    // Leads list and the product reports read (LeadsView.jsx:996).
    { source: 'leads', pick: (l) => l.productName, label: 'lead' },
    { source: 'query', collection: 'quotes',   pick: (q, n) => itemNamed(n)(q), label: 'quotation' },
    { source: 'query', collection: 'invoices', pick: (i, n) => itemNamed(n)(i), label: 'invoice' },
  ],
  expCats:       [{ source: 'query', collection: 'expenses', pick: (e) => e.category, label: 'expense' }],
  productUnits:  [{ source: 'query', collection: 'products', pick: (p) => p.unit,     label: 'product' }],
  taskStatuses:  [{ source: 'query', collection: 'tasks',    pick: (t) => t.status,   label: 'task' }],
  orderStatuses: [{ source: 'query', collection: 'orders',   pick: (o) => o.status,   label: 'order' }],
};

const norm = (v) => String(v ?? '').trim().toLowerCase();

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { ownerId, field, value } = req.body || {};
    if (!ownerId) return res.status(400).json({ error: 'ownerId required' });
    const spec = FIELDS[field];
    // Unknown list (e.g. tax rates) — report "not checkable" rather than 0, so
    // the caller doesn't take silence for a clean bill of health.
    if (!spec) return res.status(200).json({ checked: false, count: 0, label: 'record', sample: [] });
    if (!value) return res.status(400).json({ error: 'value required' });

    const target = norm(value);
    let db = null;
    let total = 0;
    const breakdown = {};   // { lead: 12, customer: 3, quotation: 1 }
    const sample = [];

    for (const probe of spec) {
      let rows;
      if (probe.source === 'leads') {
        rows = await getLeadsForOwner(ownerId);
      } else {
        db = db || init({ appId: APP_ID, adminToken: ADMIN_TOKEN });
        const r = await readData(db, ownerId, {
          [probe.collection]: { $: { where: { userId: ownerId } } },
        });
        rows = r[probe.collection] || [];
      }
      const matches = (rows || []).filter(r => norm(probe.pick(r, value)) === target);
      if (!matches.length) continue;
      total += matches.length;
      breakdown[probe.label] = (breakdown[probe.label] || 0) + matches.length;
      for (const m of matches.slice(0, 5)) {
        if (sample.length < 5) sample.push(m.name || m.title || m.client || m.no || '(unnamed)');
      }
    }

    // `label` is the collection contributing the most, so single-source
    // callers keep reading naturally ("12 leads still use this stage").
    const label = Object.entries(breakdown).sort((a, b) => b[1] - a[1])[0]?.[0] || spec[0].label;

    return res.status(200).json({
      checked: true,
      count: total,
      label,
      breakdown,          // lets the caller spell out every collection
      sample,             // a few names, so the warning is specific
    });
  } catch (err) {
    console.error('field-usage error:', err);
    return res.status(500).json({ error: err.message });
  }
}
