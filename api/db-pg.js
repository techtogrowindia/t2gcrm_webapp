// ===================================================================
// api/db-pg.js — PostgreSQL access layer (app role, RLS enforced)
//
// PATTERN: every tenant-scoped query runs inside a transaction with
// app.tenant_id set TRANSACTION-LOCAL (is_local=true in set_config).
// This means RLS isolates rows AND the setting can never bleed to the
// next request reusing a pooled connection.
//
// Usage:
//   import { tenantQuery, rawQuery } from './db-pg.js';
//
//   // tenant-scoped (RLS enforced):
//   const { rows } = await tenantQuery(tenantId, 'SELECT * FROM leads WHERE stage=$1', ['Won']);
//
//   // no tenant (auth lookups, health checks — RLS tables return 0 rows):
//   const { rows } = await rawQuery('SELECT * FROM credentials WHERE email=$1', [email]);
// ===================================================================
import pg from 'pg';

// Connection string comes from DATABASE_URL env var (APP role — not OWNER).
// Add to .env:  DATABASE_URL=postgresql://t2gcrm_prod_app:<pass>@localhost:5432/t2gcrm_prod
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('[db-pg] idle client error:', err.message);
});

/**
 * Run a SQL query scoped to one tenant.
 * Sets app.tenant_id transaction-local so RLS applies and cannot
 * leak across pooled connections.
 *
 * @param {string}  tenantId  - The account/tenant uuid
 * @param {string}  sql       - Parameterized SQL
 * @param {any[]}   params    - Query parameters
 * @returns {Promise<pg.QueryResult>}
 */
export async function tenantQuery(tenantId, sql, params = []) {
  if (!tenantId) throw new Error('[db-pg] tenantQuery: tenantId is required');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      "SELECT set_config('app.tenant_id', $1, true)",
      [String(tenantId)]
    );
    const result = await client.query(sql, params);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Run a SQL query WITHOUT a tenant set.
 * Use for: auth lookups (credentials, login_codes), health checks,
 * global_settings reads. On RLS-protected tables this returns 0 rows
 * (fail-closed) — that is intentional.
 *
 * @param {string}  sql     - Parameterized SQL
 * @param {any[]}   params  - Query parameters
 * @returns {Promise<pg.QueryResult>}
 */
export async function rawQuery(sql, params = []) {
  return pool.query(sql, params);
}

/**
 * Convenience: run multiple queries in one tenant-scoped transaction.
 * Pass an array of { sql, params } objects — all run atomically.
 *
 * @param {string}   tenantId
 * @param {{ sql: string, params?: any[] }[]} queries
 * @returns {Promise<pg.QueryResult[]>}
 */
export async function tenantTransaction(tenantId, queries) {
  if (!tenantId) throw new Error('[db-pg] tenantTransaction: tenantId is required');
  if (!queries?.length) return [];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      "SELECT set_config('app.tenant_id', $1, true)",
      [String(tenantId)]
    );
    const results = [];
    for (const { sql, params = [] } of queries) {
      results.push(await client.query(sql, params));
    }
    await client.query('COMMIT');
    return results;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch {}
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Health check — confirms the pool can connect and Postgres is up.
 * @returns {Promise<boolean>}
 */
export async function pgHealthCheck() {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch { return false; }
}

export { pool };
