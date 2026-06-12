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
  leads:     [{ table: 'activity_logs', field: 'entityId' }],
  customers: [{ table: 'activity_logs', field: 'entityId' }],
  invoices:  [{ table: 'activity_logs', field: 'entityId' }],
  quotes:    [{ table: 'activity_logs', field: 'entityId' }],
  projects:  [{ table: 'activity_logs', field: 'entityId' }],
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

// Hot tables with promoted columns (keep in sync with 02-create-crm-schema.sh)
function buildUpsertSql(table, data, tenantId, id) {
  if (table === 'leads') {
    return {
      sql: `INSERT INTO leads
              (id, tenant_id, name, company_name, email, phone, source, stage,
               assign, requirement, label, notes, product_cat, location,
               followup, assigned_at, stage_changed_at, actor_id, custom, doc,
               created_at, updated_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
                    COALESCE((SELECT created_at FROM leads WHERE id=$1), now()), now())
            ON CONFLICT (id) DO UPDATE SET
              name=$3, company_name=$4, email=$5, phone=$6, source=$7, stage=$8,
              assign=$9, requirement=$10, label=$11, notes=$12, product_cat=$13,
              location=$14, followup=$15, assigned_at=$16, stage_changed_at=$17,
              actor_id=$18, custom=$19, doc=$20, updated_at=now()`,
      params: [
        id, tenantId,
        data.name        || null,
        data.companyName || null,
        data.email       || null,
        data.phone       || null,
        data.source      || null,
        data.stage       || null,
        data.assign      || null,
        data.requirement || null,
        data.label       || null,
        data.notes       || null,
        data.productCat  || null,
        data.location    || null,
        data.followup    ? new Date(data.followup).toISOString()        : null,
        data.assignedAt  ? new Date(data.assignedAt).toISOString()      : null,
        data.stageChangedAt ? new Date(data.stageChangedAt).toISOString(): null,
        data.actorId     || null,
        JSON.stringify(data.custom || {}),
        JSON.stringify({ ...data, id }),
      ],
    };
  }

  if (table === 'call_logs') {
    return {
      sql: `INSERT INTO call_logs
              (id, tenant_id, phone, direction, duration, outcome,
               staff_email, device_id, doc, created_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,
                    COALESCE((SELECT created_at FROM call_logs WHERE id=$1), now()))
            ON CONFLICT (id) DO UPDATE SET
              phone=$3, direction=$4, duration=$5, outcome=$6,
              staff_email=$7, device_id=$8, doc=$9`,
      params: [
        id, tenantId,
        data.phone      || null,
        data.direction  || null,
        data.duration != null ? Math.trunc(Number(data.duration)) : null,
        data.outcome    || null,
        data.staffEmail || null,
        data.deviceId   || null,
        JSON.stringify({ ...data, id }),
      ],
    };
  }

  if (table === 'activity_logs') {
    return {
      sql: `INSERT INTO activity_logs
              (id, tenant_id, entity_type, entity_id, action, user_name,
               team_member_id, from_stage, to_stage, text, doc, created_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,
                    COALESCE((SELECT created_at FROM activity_logs WHERE id=$1), now()))
            ON CONFLICT (id) DO UPDATE SET
              entity_type=$3, entity_id=$4, action=$5, user_name=$6,
              team_member_id=$7, from_stage=$8, to_stage=$9, text=$10, doc=$11`,
      params: [
        id, tenantId,
        data.entityType    || null,
        data.entityId      || null,
        data.action        || null,
        data.userName      || null,
        data.teamMemberId  || null,
        data.fromStage     || null,
        data.toStage       || null,
        data.text          || null,
        JSON.stringify({ ...data, id }),
      ],
    };
  }

  // Generic table: id + tenant_id + doc + timestamps
  return {
    sql: `INSERT INTO ${table} (id, tenant_id, doc, created_at, updated_at)
          VALUES ($1, $2, $3,
                  COALESCE((SELECT created_at FROM ${table} WHERE id=$1), now()), now())
          ON CONFLICT (id) DO UPDATE SET doc=$3, updated_at=now()`,
    params: [id, tenantId, JSON.stringify({ ...data, id })],
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
  const table = TABLE_MAP[collection];
  if (!table) throw new Error(`Unknown collection: ${collection}`);
  if (!id) throw new Error('id required for every op');

  if (action === 'delete') {
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
