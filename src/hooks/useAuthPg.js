// ===================================================================
// src/hooks/useAuthPg.js — JWT-based auth hook (Postgres migration)
//
// Drop-in replacement for db.useAuth() when VITE_USE_PG_AUTH=true.
// Returns the same shape: { user, isLoading, error }
// user.id = tenantId (the accountId / userId used throughout the app)
// user.email = email
//
// JWT is stored in localStorage under 'pg_auth_token'.
// On mount: validates the token via /api/auth-pg { action:'me' }.
// If expired/invalid: clears localStorage, returns user=null.
// ===================================================================
import { useState, useEffect, useCallback } from 'react';

const TOKEN_KEY  = 'pg_auth_token';
const PROFILE_KEY = 'pg_auth_profile';

export function useAuthPg() {
  const [user, setUser]       = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError]     = useState(null);

  const clearAuth = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(PROFILE_KEY);
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
        setUser({ id: profile.tenantId, email: profile.email, ...profile });
        setIsLoading(false);
        return;
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
          const profile = {
            tenantId:  data.tenantId,
            email:     data.email,
            isOwner:   data.isOwner,
            isTeam:    data.isTeam,
            isPartner: data.isPartner,
          };
          localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
          setUser({ id: data.tenantId, email: data.email, ...profile });
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

/** Store token + profile after successful login. */
export function pgAuthSetSession(data) {
  localStorage.setItem(TOKEN_KEY, data.token);
  const profile = {
    tenantId:  data.accountId,
    email:     data.email,
    isOwner:   data.isOwner,
    isTeam:    data.isTeam,
    isPartner: data.isPartner,
  };
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
}

/** Sign out — clears all pg auth keys. */
export function pgAuthSignOut() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(PROFILE_KEY);
}

/** Get the stored JWT (for API calls that need Authorization header). */
export function pgAuthGetToken() {
  return localStorage.getItem(TOKEN_KEY);
}
