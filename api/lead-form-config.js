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
import { getLeadFormConfig } from './_lead-config.js';

const APP_ID = process.env.VITE_INSTANT_APP_ID;
const ADMIN_TOKEN = process.env.INSTANT_ADMIN_TOKEN;

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
    const cfg = await getLeadFormConfig(db, ownerId);
    return res.status(200).json({ success: true, ...cfg });
  } catch (err) {
    console.error('lead-form-config error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
}
