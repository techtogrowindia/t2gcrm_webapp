// ===================================================================
// api/lead-form-config.js — business-defined dropdown lists for the
// MOBILE lead-create form (stages, sources, requirements, assignees,
// custom fields).
//
//   GET /api/lead-form-config
//     Headers: Authorization: Bearer <token>   ← PREFERRED
//   GET /api/lead-form-config?ownerId=xxx       ← fallback (legacy)
//
// The business is derived FROM THE TOKEN (same identity the Create Lead
// endpoint /api/secure-data uses), so the config always matches the
// logged-in business — no ownerId to get wrong. If no token, the legacy
// ?ownerId query param is used. Returns only safe config fields, never
// tokens/SMTP/other profile internals. Routes to Postgres or InstantDB
// via the shared readData(), so web ↔ mobile stay in sync.
// ===================================================================
import { init } from '@instantdb/admin';
import { getLeadFormConfig } from './_lead-config.js';
import { verifyJwt } from './auth-pg.js';

const APP_ID = process.env.VITE_INSTANT_APP_ID;
const ADMIN_TOKEN = process.env.INSTANT_ADMIN_TOKEN;

// Resolve the business (ownerId) from the request. Prefer the bearer token so
// the mobile can't fetch a different business's config than the one it's
// logged into; fall back to the ?ownerId query param for older callers.
async function resolveOwnerId(req, db) {
  const authHeader = req.headers.authorization || req.headers.Authorization || '';
  const token = String(authHeader).replace(/^Bearer\s+/i, '').trim();

  if (token) {
    // 1. Postgres stack: token is a JWT carrying tenantId (= ownerId).
    try {
      const payload = verifyJwt(token);
      if (payload?.tenantId) return payload.tenantId;
    } catch { /* not a valid JWT — try InstantDB below */ }

    // 2. InstantDB stack: verify the token, map the email → owner workspace.
    try {
      const r = await db.asUser({ token }).query({ $users: {} });
      const email = (r?.$users?.[0]?.email || '').toLowerCase();
      if (email) {
        const { userProfiles, teamMembers } = await db.query({
          userProfiles: { $: { where: { email } } },
          teamMembers: { $: { where: { email } } },
        });
        const ownerId = userProfiles?.[0]?.userId || teamMembers?.[0]?.userId;
        if (ownerId) return ownerId;
      }
    } catch { /* fall through to the query-param fallback */ }
  }

  // 3. Legacy fallback — robust across Express (req.query) and Vite middleware.
  return req.query?.ownerId
    || new URLSearchParams((req.url || '').split('?')[1] || '').get('ownerId')
    || null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    if (!APP_ID || !ADMIN_TOKEN) return res.status(500).json({ error: 'Missing InstantDB configuration' });

    const db = init({ appId: APP_ID, adminToken: ADMIN_TOKEN });
    const ownerId = await resolveOwnerId(req, db);
    if (!ownerId) return res.status(400).json({ error: 'A bearer token or ownerId is required' });

    const cfg = await getLeadFormConfig(db, ownerId);
    return res.status(200).json({ success: true, ...cfg });
  } catch (err) {
    console.error('lead-form-config error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
}
