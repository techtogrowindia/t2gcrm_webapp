// ===================================================================
// src/hooks/useAuthPg.js — JWT-based auth hook (Postgres migration)
//
// Drop-in replacement for db.useAuth() when VITE_USE_PG_AUTH=true.
// Returns the same shape: { user, isLoading, error }
// user.id = the member's OWN identity: owners → tenantId (accountId/userId used
//   as ownerId for queries); team/partner → their own credentialId. Using the
//   owner's tenantId for a team member makes usePermissions grant owner rights.
// user.email = email
//
// JWT is stored in localStorage under 'pg_auth_token'.
// On mount: validates the token via /api/auth-pg { action:'me' }.
// If expired/invalid: clears localStorage, returns user=null.
// ===================================================================
import { useState, useEffect, useCallback } from 'react';
import { pgPreWarm, pgCacheClear } from './pgCache';

const TOKEN_KEY  = 'pg_auth_token';
const PROFILE_KEY = 'pg_auth_profile';

export function useAuthPg() {
  const [user, setUser]       = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError]     = useState(null);

  const clearAuth = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(PROFILE_KEY);
    pgCacheClear();
    setUser(null);
  }, []);

  // On mount: verify stored token (if any)
  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) { setIsLoading(false); return; }

    // Quick local check — try to parse expiry without a network call
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      if (payload.exp * 1000 < Date.now()) {
        clearAuth();
        setIsLoading(false);
        return;
      }
      // Token looks valid — restore from cached profile (avoids network on every reload)
      const cached = localStorage.getItem(PROFILE_KEY);
      if (cached) {
        const profile = JSON.parse(cached);
        // Stale cache from before the identityId fix: a team/partner member with
        // no identityId would fall back to tenantId as user.id and be mis-detected
        // as the owner (privilege escalation). Force a server re-verify to repopulate.
        const stale = (profile.isTeam || profile.isPartner) && !profile.identityId;
        if (!stale) {
          setUser({ id: profile.identityId ?? profile.tenantId, email: profile.email, ...profile });
          setIsLoading(false);
          return;
        }
      }
    } catch {}

    // Fallback: verify with server
    fetch('/api/auth-pg', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: 'me' }),
    })
      .then(r => r.json())
      .then(data => {
        if (data.ok) {
          // Team/partner → own credential id (JWT sub); owner → tenant id.
          const identityId = (data.isTeam || data.isPartner) ? data.sub : data.tenantId;
          const profile = {
            tenantId:  data.tenantId,
            identityId,
            email:     data.email,
            isOwner:   data.isOwner,
            isTeam:    data.isTeam,
            isPartner: data.isPartner,
          };
          localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
          setUser({ id: identityId, email: data.email, ...profile });
        } else {
          clearAuth();
        }
      })
      .catch(() => clearAuth())
      .finally(() => setIsLoading(false));
  }, [clearAuth]);

  return { user, isLoading, error };
}

// ── Helpers called from AuthScreen ────────────────────────────────

/** Store token + profile after successful login. Triggers background pre-warm. */
export function pgAuthSetSession(data) {
  localStorage.setItem(TOKEN_KEY, data.token);
  const profile = {
    tenantId:  data.accountId,
    // Identity id used as user.id app-wide. Owners: account/tenant id.
    // Team/partner: their own credential id — never the owner's tenant id,
    // or usePermissions would grant them owner privileges.
    identityId: (data.isTeam || data.isPartner) ? data.credentialId : data.accountId,
    email:     data.email,
    isOwner:   data.isOwner,
    isTeam:    data.isTeam,
    isPartner: data.isPartner,
  };
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));

  // MainApp.jsx reads tc_team_member / tc_channel_partner (separate keys from
  // pg_auth_profile above) to resolve targetUserId = the OWNER's tenant id for
  // data queries. Must be set here — the single call site every PG login path
  // (password AND magic-code) goes through — or a team/partner session falls
  // back to their own identity id as targetUserId, querying a tenant that
  // doesn't exist and silently returning zero leads/stats for them.
  if (data.isTeam) {
    localStorage.setItem('tc_team_member', JSON.stringify({
      isTeamMember: true,
      ownerUserId: data.accountId,
      // teamMembers.id — NOT credentialId. They are different rows, and every
      // teamMembers.find(m => m.id === teamMemberId) in the app depends on this.
      // Null is fine: MainApp reconciles it from the email match on mount.
      teamMemberId: data.teamMemberId || null,
    }));
  } else {
    localStorage.removeItem('tc_team_member');
  }
  if (data.isPartner) {
    localStorage.setItem('tc_channel_partner', JSON.stringify({
      isPartner: true,
      ownerUserId: data.accountId,
      partnerId: data.credentialId,
    }));
  } else {
    localStorage.removeItem('tc_channel_partner');
  }

  // Pre-warm hot collections in background so first page navigations are instant.
  // Fire-and-forget — failure silently falls back to normal per-page fetches.
  pgPreWarm(data.token).catch(() => {});
}

/** Sign out — clears auth keys and query cache (no stale tenant data left in browser). */
export function pgAuthSignOut() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(PROFILE_KEY);
  // Also clear team/partner identity — leaving these behind would let a stale
  // teamInfo leak into whatever session logs in next on this browser.
  localStorage.removeItem('tc_team_member');
  localStorage.removeItem('tc_channel_partner');
  pgCacheClear();
}

/** Get the stored JWT (for API calls that need Authorization header). */
export function pgAuthGetToken() {
  return localStorage.getItem(TOKEN_KEY);
}

/**
 * Call right after any fetch to /api/data-pg or /api/auth-pg. If the response
 * is 401 (expired/invalid JWT), signs out and reloads so the user lands on
 * the login screen instead of a dead-end "Unauthorized: Token expired" error.
 * Returns true if it handled a 401 (caller should stop and not read the body).
 */
export function pgAuthHandleUnauthorized(res) {
  if (res.status === 401) {
    pgAuthSignOut();
    window.location.reload();
    return true;
  }
  return false;
}
