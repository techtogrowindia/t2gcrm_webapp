// ===================================================================
// api/data-pg.js — Generic Postgres write handler (upsert + delete)
//
// Requires: Authorization: Bearer <jwt>  (from api/auth-pg.js login)
// tenantId is extracted from the verified JWT — never trusted from body.
//
// POST /api/data-pg
// Single:  { action:'upsert'|'delete', collection, id, data? }
// Batch:   { action:'batch', ops:[{action, collection, id, data?},...] }
//
// All ops within a batch run in ONE transaction (atomic).
// ===================================================================
import crypto from 'crypto';
import { tenantQuery, tenantTransaction, rawQuery } from './db-pg.js';

const JWT_SECRET = process.env.JWT_SECRET;

// Cascade-delete rules: deleting a parent also deletes related rows by a
// doc field. Keeps Postgres orphan-free (mirrors the Hard Delete policy).
const CASCADE = {
  leads:     [{ table: 'activity_logs', field: 'entityId' }, { table: 'tasks', field: 'entityId' }, { table: 'appointments', field: 'entityId' }, { table: 'call_logs', field: 'leadId' }],
  customers: [{ table: 'activity_logs', field: 'entityId' }, { table: 'tasks', field: 'entityId' }, { table: 'appointments', field: 'entityId' }, { table: 'call_logs', field: 'leadId' }, { table: 'amc', field: 'customerId' }],
  invoices:  [{ table: 'activity_logs', field: 'entityId' }, { table: 'appointments', field: 'entityId' }, { table: 'partner_commissions', field: 'invoiceId' }],
  quotes:    [{ table: 'activity_logs', field: 'entityId' }, { table: 'appointments', field: 'entityId' }],
  projects:  [{ table: 'activity_logs', field: 'entityId' }, { table: 'tasks', field: 'projectId' }, { table: 'expenses', field: 'projectId' }, { table: 'appointments', field: 'entityId' }],
  vendors:   [{ table: 'activity_logs', field: 'entityId' }, { table: 'appointments', field: 'entityId' }, { table: 'purchase_orders', field: 'vendorId' }],
};

// ── InstantDB collection → Postgres table name ───────────────────
const TABLE_MAP = {
  leads:                'leads',
  customers:            'customers',
  quotes:               'quotes',
  invoices:             'invoices',
  tasks:                'tasks',
  projects:             'projects',
  appointments:         'appointments',
  products:             'products',
  vendors:              'vendors',
  purchaseOrders:       'purchase_orders',
  expenses:             'expenses',
  amc:                  'amc',
  orders:               'orders',
  ecomCustomers:        'ecom_customers',
  automations:          'automations',
  executedAutomations:  'executed_automations',
  partnerApplications:  'partner_applications',
  partnerCommissions:   'partner_commissions',
  outbox:               'outbox',
  attendance:           'attendance',
  memberProfiles:       'member_profiles',
  teamMembers:          'team_members',
  ecomSettings:         'ecom_settings',
  appointmentSettings:  'appointment_settings',
  callLogSyncState:     'call_log_sync_state',
  activityLogs:         'activity_logs',
  callLogs:             'call_logs',
};

// Tables without an updated_at column (append-mostly time-series)
const NO_UPDATED_AT = new Set(['call_logs', 'activity_logs']);

// Universal MERGE-upsert. doc is shallow-merged (existing.doc || new.doc) so
// PARTIAL updates only change the provided fields — matching InstantDB's
// .update() merge semantics. Promoted typed columns (name, stage, followup…)
// are kept in sync from doc by BEFORE INSERT/UPDATE triggers in the schema
// (see 02-create-crm-schema.sh + 05-add-write-triggers.sql), so the write
// path never has to enumerate them.
function buildUpsertSql(table, data, tenantId, id) {
  const docJson = JSON.stringify({ ...data, id });
  const setUpdatedAt = NO_UPDATED_AT.has(table) ? '' : ', updated_at = now()';
  return {
    sql: `INSERT INTO ${table} (id, tenant_id, doc)
          VALUES ($1, $2, $3::jsonb)
          ON CONFLICT (id) DO UPDATE SET
            doc = ${table}.doc || EXCLUDED.doc${setUpdatedAt}`,
    params: [id, tenantId, docJson],
  };
}

// ── JWT verification (same pure-Node impl as auth-pg.js) ─────────
function verifyJwt(token) {
  if (!JWT_SECRET) throw new Error('JWT_SECRET not set');
  const parts = (token || '').split('.');
  if (parts.length !== 3) throw new Error('Invalid token');
  const [header, body, sig] = parts;
  const expected = Buffer.from(
    crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest()
  ).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)))
    throw new Error('Invalid token signature');
  const payload = JSON.parse(Buffer.from(body, 'base64').toString());
  if (payload.exp < Math.floor(Date.now() / 1000)) throw new Error('Token expired');
  return payload;
}

// ── Execute one op (returns { sql, params } or delete tuple) ─────
async function execOp(op, tenantId) {
  const { action, collection, id, data } = op;

  // userProfiles -> accounts: partial SHALLOW-MERGE into doc (matches
  // InstantDB's top-level merge). Always scoped to the JWT tenant.
  if (collection === 'userProfiles') {
    if (action === 'delete') return [];
    return [{
      sql: `UPDATE accounts SET doc = doc || $1::jsonb, updated_at = now() WHERE id = $2`,
      params: [JSON.stringify(data || {}), tenantId],
    }];
  }
  // globalSettings -> global_settings: partial merge (single platform row)
  if (collection === 'globalSettings') {
    if (action === 'delete') return [];
    return [{
      sql: `UPDATE global_settings SET doc = doc || $1::jsonb, updated_at = now()`,
      params: [JSON.stringify(data || {})],
    }];
  }

  const table = TABLE_MAP[collection];
  // Collections not in the Postgres schema (e.g. memberStats) are skipped
  // rather than failing the whole write — they're non-critical aggregates.
  if (!table) return [];
  if (!id) throw new Error('id required for every op');

  if (action === 'delete') {
    // PG ids are uuids — skip legacy non-uuid keys (e.g. "<invId>-comm")
    // rather than erroring. The proper cascade below handles such children.
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id));
    if (!isUuid) return [];
    // Returns an array of {sql,params} so a delete can cascade.
    const out = [{ sql: `DELETE FROM ${table} WHERE id=$1`, params: [id] }];
    for (const c of (CASCADE[table] || [])) {
      out.push({ sql: `DELETE FROM ${c.table} WHERE doc->>'${c.field}' = $1`, params: [id] });
    }
    return out;
  }
  if (action === 'upsert' || action === 'update') {
    return [buildUpsertSql(table, data || {}, tenantId, id)];
  }
  throw new Error(`Unknown action: ${action}`);
}

// Reusable write runner — used by /api/data when USE_PG_DATA=true so the
// legacy REST endpoint's writes also land in Postgres (one shared code path).
export async function pgRunOps(tenantId, ops) {
  const nested = await Promise.all(ops.map(op => execOp(op, tenantId)));
  await tenantTransaction(tenantId, nested.flat());
}
export { execOp };

// ── Handler ───────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Verify JWT — tenantId is never trusted from the body
  let tenantId;
  try {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : auth;
    const payload = verifyJwt(token);
    tenantId = payload.tenantId;
    if (!tenantId) throw new Error('No tenantId in token');
  } catch (e) {
    return res.status(401).json({ error: `Unauthorized: ${e.message}` });
  }

  try {
    const { action, collection, id, data, ops, collections } = req.body || {};

    // ── Query (read collections, tenant-scoped via RLS) ──────────────
    // Accepts either:
    //   { collections: ['customers','invoices'] }                    (no filter)
    //   { queries: { activityLogs: { where: { entityId: 'x' } } } }  (filtered)
    if (action === 'query') {
      const { queries } = req.body || {};
      const spec = queries || Object.fromEntries(
        (Array.isArray(collections) ? collections : [collection]).map(c => [c, {}])
      );
      const out = {};
      for (const [coll, cfg] of Object.entries(spec)) {
        // Special non-tenant collections
        if (coll === 'userProfiles') {
          const r = await rawQuery('SELECT id, doc FROM accounts WHERE id = $1', [tenantId]);
          out[coll] = r.rows.map(row => ({ ...row.doc, id: row.id, userId: row.id }));
          continue;
        }
        if (coll === 'globalSettings') {
          const r = await rawQuery('SELECT id, doc FROM global_settings LIMIT 1');
          out[coll] = r.rows.map(row => ({ ...row.doc, id: row.id }));
          continue;
        }
        const table = TABLE_MAP[coll];
        if (!table) { out[coll] = []; continue; }

        // Optional WHERE on doc fields (equality only)
        const where = cfg?.where || {};
        const keys = Object.keys(where);
        let sql = `SELECT id, doc FROM ${table}`;
        const params = [];
        if (keys.length) {
          const clauses = keys.map((k, i) => {
            params.push(String(where[k]));
            return `doc->>'${k}' = $${i + 1}`;
          });
          sql += ` WHERE ${clauses.join(' AND ')}`;
        }
        const r = await tenantQuery(tenantId, sql, params);
        out[coll] = r.rows.map(row => ({ ...row.doc, id: row.id }));
      }
      return res.status(200).json({ ok: true, data: out });
    }

    // ── Batch (atomic) ───────────────────────────────────────────
    if (action === 'batch') {
      if (!Array.isArray(ops) || !ops.length)
        return res.status(400).json({ error: 'ops array required for batch' });
      const nested = await Promise.all(ops.map(op => execOp(op, tenantId)));
      await tenantTransaction(tenantId, nested.flat());
      return res.status(200).json({ ok: true, count: ops.length });
    }

    // ── Single op ────────────────────────────────────────────────
    if (!collection || !id) return res.status(400).json({ error: 'collection and id required' });
    const queries = await execOp({ action, collection, id, data }, tenantId);
    await tenantTransaction(tenantId, queries);
    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error('[data-pg] error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
