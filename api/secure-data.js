import { init } from '@instantdb/admin';
import dataHandler from './data.js';

const APP_ID = process.env.VITE_INSTANT_APP_ID;
const ADMIN_TOKEN = process.env.INSTANT_ADMIN_TOKEN;

// ─────────────────────────────────────────────────────────────────────────────
// SECURE replacement for /api/data.
//
// The legacy /api/data endpoint trusts `ownerId` / `actorId` / `isOwner` straight
// from the query string — i.e. anyone who knows an ownerId can read/write a whole
// workspace, and any caller can become "owner" just by omitting actorId. This
// endpoint fixes that:
//
//   1. Requires `Authorization: Bearer <token>` — the InstantDB token returned by
//      /api/auth at login.
//   2. Verifies the token server-side (db.asUser + $users). Invalid/expired/forged
//      tokens are rejected.
//   3. Derives the caller's identity (ownerId + actorId + isOwner) FROM the verified
//      email — NEVER from client-supplied params. Client identity fields are
//      stripped before the request is processed, so they can't be spoofed.
//   4. Delegates the actual data work to the existing data.js handler, so all
//      visibility / filtering / CRUD logic stays in ONE place (guaranteed parity
//      with the legacy endpoint while it's still around).
//
// Usage (same query shape as /api/data, minus the identity params):
//   GET /api/secure-data?module=leads
//   GET /api/secure-data?module=leads&srcFilter=Youtube&stgFilter=Warm
//   GET /api/secure-data?module=leads&ownerId=<ws>   ← only as a workspace HINT,
//       honoured only if the authenticated user actually belongs to that workspace.
//   Headers: Authorization: Bearer <token>
// ─────────────────────────────────────────────────────────────────────────────

// Identity fields the client must NOT be able to set — always derived from token.
const IDENTITY_KEYS = ['actorId', 'isOwner', 'userEmail', 'myName', 'teamMemberId'];

const ALLOWED_ORIGINS = [
  'https://crm.t2gcrm.in',
  'https://dev.t2gcrm.in',
];

function stripIdentity(obj) {
  if (!obj || typeof obj !== 'object') return {};
  const clean = {};
  for (const k of Object.keys(obj)) {
    if (!IDENTITY_KEYS.includes(k)) clean[k] = obj[k];
  }
  return clean;
}

export default async function handler(req, res) {
  // CORS — only reflect known browser origins. Non-browser clients (mobile,
  // Postman) don't send an Origin and aren't subject to CORS; the token is the
  // real gate either way.
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (!APP_ID || !ADMIN_TOKEN) {
      return res.status(500).json({ error: 'Missing InstantDB configuration in backend' });
    }

    // 1. Require a bearer token.
    const authHeader = req.headers.authorization || req.headers.Authorization || '';
    const token = String(authHeader).replace(/^Bearer\s+/i, '').trim();
    if (!token) {
      return res.status(401).json({ error: 'Missing Authorization bearer token' });
    }

    const db = init({ appId: APP_ID, adminToken: ADMIN_TOKEN });

    // 2. Verify the token by impersonating the user and reading $users.
    //    A valid token returns exactly one $users row; anything else is rejected.
    let authEmail = '';
    try {
      const r = await db.asUser({ token }).query({ $users: {} });
      authEmail = (r?.$users?.[0]?.email || '').toLowerCase();
    } catch (e) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    if (!authEmail) {
      return res.status(401).json({ error: 'Token is not associated with a user' });
    }

    // 3. Resolve which workspace(s) this user may act in — from the DB, never
    //    from client params. An email can be an owner of one workspace and/or a
    //    team member of others; build the full allow-list.
    const { userProfiles, teamMembers } = await db.query({
      userProfiles: { $: { where: { email: authEmail } } },
      teamMembers: { $: { where: { email: authEmail } } },
    });

    const allowed = {}; // ownerId -> { actorId, isOwner }
    for (const p of (userProfiles || [])) {
      if (p.userId) allowed[p.userId] = { actorId: p.userId, isOwner: true };
    }
    for (const t of (teamMembers || [])) {
      if (t.userId && !allowed[t.userId]) {
        allowed[t.userId] = { actorId: t.id, isOwner: false };
      }
    }

    const allowedWorkspaces = Object.keys(allowed);
    if (allowedWorkspaces.length === 0) {
      return res.status(403).json({ error: 'This account has no workspace access' });
    }

    // 4. Pick the workspace. Client may pass ?ownerId= as a HINT, but it is only
    //    honoured if the authenticated user actually belongs to that workspace.
    const requestedOwnerId = req.query?.ownerId || req.body?.ownerId || null;
    let ownerId;
    if (requestedOwnerId) {
      if (!allowed[requestedOwnerId]) {
        return res.status(403).json({ error: 'You do not have access to the requested workspace' });
      }
      ownerId = requestedOwnerId;
    } else if (allowedWorkspaces.length === 1) {
      ownerId = allowedWorkspaces[0];
    } else {
      return res.status(400).json({
        error: 'Multiple workspaces available — specify ownerId',
        workspaces: allowedWorkspaces,
      });
    }
    const { actorId, isOwner } = allowed[ownerId];

    // 5. Sanitize the request: strip any client-supplied identity, then inject
    //    the trusted identity into BOTH query and body (data.js merges the two).
    const injected = { ownerId, actorId };
    if (isOwner) injected.isOwner = true;

    // NOTE: on Express, `req.query` is a getter-only property — assigning to it
    // throws ("Cannot set property query ... which has only a getter"). Use
    // Object.defineProperty to replace it with a plain value. We override BOTH
    // query and body so data.js (which merges them, body-wins) only ever sees
    // the trusted identity, never client-supplied identity fields.
    const cleanQuery = { ...stripIdentity(req.query), ...injected };
    const cleanBody = { ...stripIdentity(req.body), ...injected };
    Object.defineProperty(req, 'query', { value: cleanQuery, writable: true, configurable: true });
    Object.defineProperty(req, 'body', { value: cleanBody, writable: true, configurable: true });

    // 6. Delegate to the existing data.js logic (single source of truth).
    return dataHandler(req, res);
  } catch (err) {
    console.error('secure-data error:', err);
    return res.status(500).json({ error: err.message });
  }
}
