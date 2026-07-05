// Routes auth password/credential actions to the active auth backend.
//
// When VITE_USE_PG_AUTH=true, login reads from Postgres — so password
// change/reset and team/partner credential set/delete MUST also hit Postgres
// (/api/auth-pg), or the write lands in InstantDB and silently never takes
// effect. When the flag is off, everything stays on InstantDB (/api/auth).
//
// Use ONLY for the actions implemented in both backends:
//   change-password, reset-password-request, reset-password-verify,
//   set-team-password, set-partner-password, delete-partner-credentials.
// InstantDB-only admin actions (business-analytics, admin-create-user, …)
// must keep using '/api/auth' directly.
export const AUTH_API = import.meta.env.VITE_USE_PG_AUTH === 'true' ? '/api/auth-pg' : '/api/auth';
