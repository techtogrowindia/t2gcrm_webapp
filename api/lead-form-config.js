// ===================================================================
// api/lead-form-config.js — business-defined dropdown lists for the
// MOBILE lead-create form (stages, sources, requirements, custom fields).
//
//   GET /api/lead-form-config?ownerId=xxx
//
// Returns only the safe config fields from userProfiles — never tokens,
// SMTP creds, or other profile internals. Routes to Postgres or InstantDB
// via the shared readData(), so web ↔ mobile stay in sync.
// ===================================================================
import { init } from '@instantdb/admin';
import { readData } from './_write-ops.js';

const APP_ID = process.env.VITE_INSTANT_APP_ID;
const ADMIN_TOKEN = process.env.INSTANT_ADMIN_TOKEN;

// First-run defaults — mirror DEFAULT_* in src/utils/helpers.js. Returned only
// when the business hasn't configured its own list, so the mobile form always
// has usable options.
const DEFAULT_SOURCES = ['FB Ads', 'Direct', 'Broker', 'Google Ads', 'Referral', 'WhatsApp', 'Website', 'IndiaMART', 'JustDial', 'Other'];
const DEFAULT_STAGES = ['New Enquiry', 'Enquiry Contacted', 'Quotation Created', 'Quotation Sent', 'Invoice Created', 'Invoice Sent', 'Budget Negotiation', 'Advance Paid', 'Won', 'Lost'];
const DEFAULT_REQUIREMENTS = ['Hot', 'Warm', 'Cold', 'VIP', 'Pending'];

const nonEmpty = (v, fallback) => (Array.isArray(v) && v.length) ? v : fallback;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    if (!APP_ID || !ADMIN_TOKEN) return res.status(500).json({ error: 'Missing InstantDB configuration' });
    // Robust across Express (req.query) and the Vite dev middleware (raw req).
    const ownerId = req.query?.ownerId
      || new URLSearchParams((req.url || '').split('?')[1] || '').get('ownerId');
    if (!ownerId) return res.status(400).json({ error: 'ownerId is required' });

    const db = init({ appId: APP_ID, adminToken: ADMIN_TOKEN });
    const { userProfiles } = await readData(db, ownerId, {
      userProfiles: { $: { where: { userId: ownerId } } },
    });
    const p = userProfiles?.[0] || {};

    // Stages for CREATING a lead = the visible subset (leadStages if configured,
    // else all stages) minus disabledStages. Mirrors the filter /api/data applies
    // to lead reads, so mobile only ever shows the same stages the web does.
    const allStages = nonEmpty(p.stages, DEFAULT_STAGES);
    const base = nonEmpty(p.leadStages, allStages);
    const disabled = new Set(p.disabledStages || []);
    const stages = base.filter(s => !disabled.has(s));

    return res.status(200).json({
      success: true,
      stages,
      sources: nonEmpty(p.sources, DEFAULT_SOURCES),
      requirements: nonEmpty(p.requirements, DEFAULT_REQUIREMENTS),
      // No fallback — empty means "hide the control" (business hasn't defined these).
      productCats: Array.isArray(p.productCats) ? p.productCats : [],
      customFields: Array.isArray(p.customFields) ? p.customFields : [],
      wonStage: p.wonStage || allStages[allStages.length - 1] || 'Won',
      lostStage: p.lostStage || 'Lost',
    });
  } catch (err) {
    console.error('lead-form-config error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
}
