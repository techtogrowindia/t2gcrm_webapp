// ===================================================================
// api/_shared-perms.js — server-side permission + plan resolution.
//
// Mirrors src/hooks/usePermissions.js and usePlanEnforcement.js so the server
// reaches the same verdict as the browser. Anything that decides what a caller
// may SEE must be answerable without trusting the request body — the client
// sends `isOwner` and `userEmail` on several legacy endpoints, and both are
// trivially spoofable.
//
// ⚠️ Scope: this resolves permissions for callers that route through it. It is
// NOT a global chokepoint — api/data-pg.js still enforces tenant isolation
// (RLS) only, with no per-module role check, so a team member can read any
// collection in their own tenant by calling it directly. Closing that is an
// app-wide change, not a dashboard one. Don't read this module as proof that
// module permissions are enforced everywhere; they aren't.
// ===================================================================
import { readData } from './_write-ops.js';

const CACHE_TTL = 60 * 1000;
const cache = new Map();

// Mirrors usePermissions: team members never get Admin or Settings, whatever
// their role says.
const BLOCKED_MODULES = ['Admin', 'Settings'];

function normalisePerms(rolePerms) {
  if (!rolePerms) return {};
  // Legacy format was a bare string[] of module names. usePermissions grants
  // only view+list for those — match it exactly, or the server would be more
  // permissive than the UI.
  if (Array.isArray(rolePerms)) {
    return Object.fromEntries(rolePerms.map(k => [k, ['view', 'list']]));
  }
  return rolePerms;
}

function buildCan({ isOwner, role, modules }) {
  if (isOwner) return () => true;
  const isAdmin = String(role || '').toLowerCase().includes('admin');
  return (module, action = 'list') => {
    if (BLOCKED_MODULES.includes(module)) return false;
    if (isAdmin) return true;
    const mp = modules[module];
    if (!Array.isArray(mp)) return false;
    if (action === 'view') return mp.length > 0;
    return mp.includes(action);
  };
}

function buildIsModuleEnabled(profile, settings) {
  const planName = profile?.plan || 'Trial';
  const plans = settings?.plans || profile?.plans || null;
  const activePlan = Array.isArray(plans) ? plans.find(p => p.name === planName) : null;
  // No plan record (legacy data, superadmin) → everything enabled, same as the
  // hook's fallback.
  if (!activePlan) return () => true;
  const modules = activePlan.modules || null;
  if (!modules) return () => true; // legacy plan with no modules field
  // Strict: a module is enabled only if the plan explicitly says true. Missing
  // key = disabled (usePlanEnforcement makes the same choice, deliberately —
  // `!== false` used to leak newly added modules into older plans).
  return (key) => modules[key] === true;
}

/**
 * Resolve what a caller may see, from the DB rather than the request body.
 *
 * @param {string} ownerId   tenant id
 * @param {string} userEmail caller's email — must come from a VERIFIED source
 *                           (JWT / session), never straight off the body
 * @returns {Promise<{isOwner:boolean, role:string|null, name:string,
 *                    teamMemberId:string|null, can:Function, isModuleEnabled:Function}>}
 */
export async function resolveCallerPerms(ownerId, userEmail, { db = null, settings = null } = {}) {
  const email = String(userEmail || '').toLowerCase();
  const key = `${ownerId}:${email}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < CACHE_TTL) return hit.value;

  let value;
  try {
    const r = await readData(db, ownerId, {
      teamMembers: { $: { where: { userId: ownerId } } },
      userProfiles: { $: { where: { userId: ownerId } } },
    });
    const profile = r.userProfiles?.[0] || {};
    const members = r.teamMembers || [];
    const member = members.find(m => String(m.email || '').toLowerCase() === email);
    // Owner precedence, exactly as usePermissions decides it: an email that owns
    // the business is the owner even if it also appears in teamMembers.
    const isOwner = !!email && String(profile.email || '').toLowerCase() === email;

    if (!isOwner && (!member || member.active === false)) {
      // Unknown or deactivated caller — deny everything rather than guess.
      value = {
        isOwner: false, role: null, name: '', teamMemberId: null,
        can: () => false, isModuleEnabled: buildIsModuleEnabled(profile, settings),
      };
    } else {
      const roleDef = (profile.roles || []).find(rl => rl.name === member?.role);
      const modules = normalisePerms(roleDef?.perms);
      value = {
        isOwner,
        role: isOwner ? 'Owner' : (member?.role || null),
        name: isOwner ? (profile.fullName || '') : (member?.name || ''),
        teamMemberId: isOwner ? null : (member?.id || null),
        // A team member whose role no longer exists gets nothing — matches
        // usePermissions, which returns can:()=>false on an unmatched role.
        can: buildCan({ isOwner, role: member?.role, modules: roleDef ? modules : {} }),
        isModuleEnabled: buildIsModuleEnabled(profile, settings),
      };
    }
  } catch (e) {
    console.warn('[shared-perms] resolve failed:', e?.message);
    // Fail closed. A lookup failure must not hand out owner rights.
    value = { isOwner: false, role: null, name: '', teamMemberId: null, can: () => false, isModuleEnabled: () => false };
  }

  cache.set(key, { value, ts: Date.now() });
  return value;
}

/** Drop cached permissions for a tenant — call after a role or plan change. */
export function invalidatePermsCache(ownerId) {
  for (const k of cache.keys()) if (k.startsWith(`${ownerId}:`)) cache.delete(k);
}
