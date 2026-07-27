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
const FIELDS = {
  stages:         { source: 'leads', pick: (l) => l.stage,       label: 'lead' },
  sources:        { source: 'leads', pick: (l) => l.source,      label: 'lead' },
  requirements:   { source: 'leads', pick: (l) => l.requirement, label: 'lead' },
  productCats:    { source: 'leads', pick: (l) => l.productCat,  label: 'lead' },
  // Custom fields live under leads.custom[<name>]; a value is "in use" when any
  // lead has a non-empty entry for that field, whatever the entry says.
  customFields:   { source: 'leads', pick: (l, name) => (l.custom && l.custom[name] ? name : null), label: 'lead' },
  expCats:        { source: 'query', collection: 'expenses', pick: (e) => e.category, label: 'expense' },
  productUnits:   { source: 'query', collection: 'products', pick: (p) => p.unit,     label: 'product' },
  taskStatuses:   { source: 'query', collection: 'tasks',    pick: (t) => t.status,   label: 'task' },
  orderStatuses:  { source: 'query', collection: 'orders',   pick: (o) => o.status,   label: 'order' },
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

    let rows;
    if (spec.source === 'leads') {
      rows = await getLeadsForOwner(ownerId);
    } else {
      const db = init({ appId: APP_ID, adminToken: ADMIN_TOKEN });
      const r = await readData(db, ownerId, {
        [spec.collection]: { $: { where: { userId: ownerId } } },
      });
      rows = r[spec.collection] || [];
    }

    const target = norm(value);
    const matches = rows.filter(r => norm(spec.pick(r, value)) === target);

    return res.status(200).json({
      checked: true,
      count: matches.length,
      label: spec.label,
      // A few names so the warning can be specific rather than just a number.
      sample: matches.slice(0, 5).map(r => r.name || r.title || r.client || r.no || '(unnamed)'),
    });
  } catch (err) {
    console.error('field-usage error:', err);
    return res.status(500).json({ error: err.message });
  }
}
