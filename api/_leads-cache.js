import { init } from '@instantdb/admin';
import { tenantQuery } from './db-pg.js';
import { readData } from './_write-ops.js';

const APP_ID = process.env.VITE_INSTANT_APP_ID;
const ADMIN_TOKEN = process.env.INSTANT_ADMIN_TOKEN;

// When USE_PG_DATA=true (dev .env only): fetch leads from Postgres with RLS.
// When unset/false (prod default): fetch from InstantDB with 15s in-memory cache.
// All 8+ callers (leads-page, dashboard-stats, call-logs-page, etc.) share this
// function — one change upgrades all endpoints simultaneously.
const USE_PG_DATA = process.env.USE_PG_DATA === 'true';

// ── InstantDB path: shared 15s in-memory cache ───────────────────
const cache = new Map(); // ownerId -> { leads, ts }
const TTL = 15 * 1000;

let _db = null;
function getDb() {
  if (!_db) _db = init({ appId: APP_ID, adminToken: ADMIN_TOKEN });
  return _db;
}

// ── Postgres path: shared in-memory cache ────────────────────────
// Fetching all tenant leads (11k+ rows, ~5MB) on every request is slow.
// Stores the FULL result set (no LIMIT) so reports still see every lead.
// Same 15s TTL as the InstantDB path — TTL expiry only, matching prod.
const pgCache = new Map(); // ownerId -> { leads, ts }
const PG_TTL = 15 * 1000;

async function getLeadsFromPg(ownerId) {
  const hit = pgCache.get(ownerId);
  if (hit && Date.now() - hit.ts < PG_TTL) return hit.leads;

  const result = await tenantQuery(
    ownerId,
    'SELECT id, doc, created_at, updated_at FROM leads ORDER BY created_at DESC'
  );
  const leads = result.rows.map(r => ({
    ...r.doc,
    id: r.id,
    createdAt:  r.doc.createdAt  ?? new Date(r.created_at).getTime(),
    updatedAt:  r.doc.updatedAt  ?? new Date(r.updated_at).getTime(),
    followup:   r.doc.followup,
    assignedAt: r.doc.assignedAt,
  }));
  pgCache.set(ownerId, { leads, ts: Date.now() });
  return leads;
}

export async function getLeadsForOwner(ownerId) {
  if (USE_PG_DATA) return getLeadsFromPg(ownerId);

  // InstantDB path (prod default)
  const hit = cache.get(ownerId);
  if (hit && Date.now() - hit.ts < TTL) return hit.leads;
  const db = getDb();
  const result = await db.query({
    leads: { $: { where: { userId: ownerId } } },
  });
  const leads = result.leads || [];
  cache.set(ownerId, { leads, ts: Date.now() });
  return leads;
}

export function invalidateLeadsCache(ownerId) {
  if (ownerId) { cache.delete(ownerId); pgCache.delete(ownerId); }
  else { cache.clear(); pgCache.clear(); }
}

// ── Team role lookup: cached 60s to avoid a remote InstantDB call on every request ─
// Both leads-page.js and dashboard-stats.js need this — share it here.
const roleCache = new Map(); // `${ownerId}:${userEmail}` -> { hasElevated, ts }
const ROLE_TTL = 60 * 1000;

export async function hasElevatedLeadsRole(ownerId, userEmail) {
  const key = `${ownerId}:${userEmail}`;
  const hit = roleCache.get(key);
  if (hit && Date.now() - hit.ts < ROLE_TTL) return hit.hasElevated;

  try {
    const db = getDb();
    const r = await readData(db, ownerId, {
      teamMembers: { $: { where: { userId: ownerId, email: userEmail } } },
      userProfiles: { $: { where: { userId: ownerId } } },
    });
    const tm = r.teamMembers?.[0];
    const profile = r.userProfiles?.[0] || {};
    const roleDef = (profile.roles || []).find(rl => rl.name === tm?.role);
    let rolePerms = null;
    if (roleDef) {
      rolePerms = Array.isArray(roleDef.perms)
        ? Object.fromEntries(roleDef.perms.map(k => [k, ['list', 'view']]))
        : (roleDef.perms || {});
    }
    const leadsPerms = (rolePerms && rolePerms.Leads) || [];
    const hasElevated = Array.isArray(leadsPerms)
      && (leadsPerms.includes('delete') || leadsPerms.includes('viewAll'));
    roleCache.set(key, { hasElevated, ts: Date.now() });
    return hasElevated;
  } catch (e) {
    console.warn('[leads-cache] role lookup failed', e?.message);
    return false;
  }
}
