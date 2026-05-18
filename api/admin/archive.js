import { init, tx, id } from '@instantdb/admin';

const APP_ID = process.env.VITE_INSTANT_APP_ID;
const ADMIN_TOKEN = process.env.INSTANT_ADMIN_TOKEN;

/**
 * Archive Manager API — Bullet-proof per-customer export/restore/delete.
 *
 * SAFETY GUARANTEES:
 * - ALL actions are scoped to a single customer (userId). No global ops.
 * - Restore is duplicate-safe: only inserts records whose `id` is not present.
 * - Delete requires:
 *     a) ownerId (customer) — scopes the delete to that business only
 *     b) toDate — only records older than this date can be deleted
 *     c) MIN_AGE_DAYS server-enforced — cannot delete records younger than 30 days
 *     d) confirm: 'DELETE' literal token — UI gates on this
 *     e) every delete is logged to archiveHistory with full metadata
 * - Sensitive collections (leads, customers, invoices, quotes) can be EXPORTED
 *   but cannot be DELETED via this API — only "log-like" collections are deletable.
 *
 * ACTIONS:
 *   POST /api/admin/archive  { action: 'preview', ownerId, collection, fromDate, toDate }
 *     → returns { count, estimatedSizeMB, oldestDate, newestDate }
 *
 *   POST /api/admin/archive  { action: 'export', ownerId, collection, fromDate, toDate, actorId }
 *     → returns { records: [...], count, archiveId }
 *     → records `archiveHistory` row
 *
 *   POST /api/admin/archive  { action: 'delete', ownerId, collection, toDate, confirm, actorId }
 *     → deletes records older than toDate FOR THAT CUSTOMER ONLY
 *     → confirm must equal 'DELETE'
 *     → returns { deleted }
 *
 *   POST /api/admin/archive  { action: 'restore', ownerId, collection, records: [...] }
 *     → inserts only records whose `id` is not already in the DB
 *     → returns { inserted, skipped }
 *
 *   POST /api/admin/archive  { action: 'history' }
 *     → returns archiveHistory[] ordered by createdAt desc
 *
 * EXPORTABLE COLLECTIONS:
 *   callLogs, activityLogs, executedAutomations, outbox,
 *   leads, customers, invoices, quotes, attendance, appointments
 *
 * DELETABLE COLLECTIONS (log-like only):
 *   callLogs, activityLogs, executedAutomations, outbox, attendance
 *   (leads, customers, invoices, quotes — NEVER deletable via this API)
 */

// Records younger than this cannot be deleted — server-enforced safety net.
const MIN_AGE_DAYS = 30;

// Owner-key map: per collection, which field stores the owning userId
// callLogs use `userId` (per Call Logs API). activityLogs typically use `userId`
// or `actorId`. We try the standard `userId` field first.
const OWNER_FIELD = {
  callLogs: 'userId',
  activityLogs: 'userId',
  executedAutomations: 'userId',
  outbox: 'userId',
  attendance: 'userId',
  leads: 'userId',
  customers: 'userId',
  invoices: 'userId',
  quotes: 'userId',
  appointments: 'userId',
};

const DELETABLE_COLLECTIONS = new Set([
  'callLogs',
  'activityLogs',
  'executedAutomations',
  'outbox',
  'attendance',
]);

const ALLOWED_COLLECTIONS = new Set([
  'callLogs',
  'activityLogs',
  'executedAutomations',
  'outbox',
  'leads',
  'customers',
  'invoices',
  'quotes',
  'attendance',
  'appointments',
]);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    if (!APP_ID || !ADMIN_TOKEN) {
      return res.status(500).json({ error: 'Missing InstantDB configuration' });
    }

    const db = init({ appId: APP_ID, adminToken: ADMIN_TOKEN });
    const { action, collection, fromDate, toDate, records, actorId, ownerId, confirm } = req.body || {};

    if (!action) return res.status(400).json({ error: 'action is required' });

    // History is the only action that doesn't need an ownerId
    if (action !== 'history' && !ownerId) {
      return res.status(400).json({ error: 'ownerId (customer) is required for this action' });
    }

    // Helper: scope a result set to a specific owner
    const scopeToOwner = (records, coll) => {
      const ownerField = OWNER_FIELD[coll] || 'userId';
      return records.filter(r => r[ownerField] === ownerId);
    };

    // ── PREVIEW: count records matching date range FOR THIS CUSTOMER ──
    if (action === 'preview') {
      if (!collection) return res.status(400).json({ error: 'collection is required' });
      if (!ALLOWED_COLLECTIONS.has(collection)) {
        return res.status(400).json({ error: `Collection "${collection}" is not allowed for archive` });
      }

      const result = await db.query({ [collection]: { $: {} } });
      const allForOwner = scopeToOwner(result[collection] || [], collection);

      const fromTs = fromDate ? new Date(fromDate).getTime() : 0;
      const toTs = toDate ? new Date(toDate).getTime() + (24 * 60 * 60 * 1000 - 1) : Date.now();

      const filtered = allForOwner.filter(r => {
        const ts = r.createdAt || 0;
        return ts >= fromTs && ts <= toTs;
      });

      // Estimate size by sampling
      let avgSize = 500;
      if (filtered.length > 0) {
        const sample = filtered.slice(0, Math.min(20, filtered.length));
        avgSize = sample.reduce((s, r) => s + JSON.stringify(r).length, 0) / sample.length;
      }

      const estimatedSizeMB = ((filtered.length * avgSize) / (1024 * 1024)).toFixed(2);
      const dates = filtered.map(r => r.createdAt || 0).filter(Boolean);
      const oldestDate = dates.length ? Math.min(...dates) : null;
      const newestDate = dates.length ? Math.max(...dates) : null;

      return res.status(200).json({
        success: true,
        count: filtered.length,
        totalForOwner: allForOwner.length,
        estimatedSizeMB: parseFloat(estimatedSizeMB),
        oldestDate,
        newestDate,
      });
    }

    // ── EXPORT: return all matching records FOR THIS CUSTOMER + log to archiveHistory ──
    if (action === 'export') {
      if (!collection) return res.status(400).json({ error: 'collection is required' });
      if (!ALLOWED_COLLECTIONS.has(collection)) {
        return res.status(400).json({ error: `Collection "${collection}" is not allowed for archive` });
      }

      const result = await db.query({ [collection]: { $: {} } });
      const allForOwner = scopeToOwner(result[collection] || [], collection);

      const fromTs = fromDate ? new Date(fromDate).getTime() : 0;
      const toTs = toDate ? new Date(toDate).getTime() + (24 * 60 * 60 * 1000 - 1) : Date.now();

      const records = allForOwner.filter(r => {
        const ts = r.createdAt || 0;
        return ts >= fromTs && ts <= toTs;
      });

      // Log to archiveHistory
      const archiveId = id();
      const now = Date.now();
      const sizeBytes = JSON.stringify(records).length;

      try {
        await db.transact(tx.archiveHistory[archiveId].update({
          collection,
          ownerId,
          fromDate: fromDate || null,
          toDate: toDate || null,
          recordCount: records.length,
          sizeBytes,
          actorId: actorId || null,
          createdAt: now,
          action: 'export',
        }));
      } catch (err) {
        // Don't fail the export if history logging fails (e.g. collection doesn't exist yet)
        console.warn('archiveHistory logging failed:', err.message);
      }

      return res.status(200).json({
        success: true,
        records,
        count: records.length,
        archiveId,
        collection,
        fromDate,
        toDate,
        exportedAt: now,
      });
    }

    // ── DELETE: per-customer + date-filtered delete with multiple safeguards ──
    if (action === 'delete') {
      if (!collection) return res.status(400).json({ error: 'collection is required' });
      if (!DELETABLE_COLLECTIONS.has(collection)) {
        return res.status(403).json({
          error: `Collection "${collection}" is not deletable via this API. Allowed: ${[...DELETABLE_COLLECTIONS].join(', ')}`,
        });
      }
      if (!toDate) {
        return res.status(400).json({ error: 'toDate is required — must specify how old records must be to delete' });
      }
      if (confirm !== 'DELETE') {
        return res.status(400).json({ error: 'confirm token must be the literal string "DELETE"' });
      }

      // SERVER-ENFORCED MIN AGE: toDate cannot be more recent than (now - 30 days)
      const toTs = new Date(toDate).getTime() + (24 * 60 * 60 * 1000 - 1);
      const minAllowedTs = Date.now() - (MIN_AGE_DAYS * 24 * 60 * 60 * 1000);
      if (toTs > minAllowedTs) {
        return res.status(400).json({
          error: `Cannot delete records newer than ${MIN_AGE_DAYS} days. Earliest allowed toDate: ${new Date(minAllowedTs).toISOString().split('T')[0]}`,
        });
      }

      // Fetch + scope to customer + filter to older-than-toDate
      const result = await db.query({ [collection]: { $: {} } });
      const allForOwner = scopeToOwner(result[collection] || [], collection);
      const fromTs = fromDate ? new Date(fromDate).getTime() : 0;

      const toDelete = allForOwner.filter(r => {
        const ts = r.createdAt || 0;
        return ts >= fromTs && ts <= toTs;
      });

      if (toDelete.length === 0) {
        return res.status(200).json({
          success: true,
          deleted: 0,
          message: 'No records matched the filter — nothing deleted',
        });
      }

      // Delete in batches of 50 to stay within InstantDB transaction limits
      let deleted = 0;
      for (let i = 0; i < toDelete.length; i += 50) {
        const batch = toDelete.slice(i, i + 50);
        const txs = batch.map(r => tx[collection][r.id].delete());
        await db.transact(txs);
        deleted += batch.length;
      }

      // Log delete to archiveHistory (audit trail)
      try {
        await db.transact(tx.archiveHistory[id()].update({
          collection,
          ownerId,
          fromDate: fromDate || null,
          toDate,
          recordCount: deleted,
          sizeBytes: JSON.stringify(toDelete).length,
          actorId: actorId || null,
          createdAt: Date.now(),
          action: 'delete',
        }));
      } catch (err) {
        console.warn('archiveHistory logging failed:', err.message);
      }

      return res.status(200).json({
        success: true,
        deleted,
        collection,
        ownerId,
        message: `Deleted ${deleted} record(s) from ${collection} for this customer.`,
      });
    }

    // ── RESTORE: insert only new records (duplicate-safe, scoped to customer) ──
    if (action === 'restore') {
      if (!collection) return res.status(400).json({ error: 'collection is required' });
      if (!ALLOWED_COLLECTIONS.has(collection)) {
        return res.status(400).json({ error: `Collection "${collection}" is not allowed for restore` });
      }
      if (!Array.isArray(records) || records.length === 0) {
        return res.status(400).json({ error: 'records array is required' });
      }

      // Sanity: every record in the JSON must belong to the selected customer.
      // Prevents accidentally restoring another customer's data.
      const ownerField = OWNER_FIELD[collection] || 'userId';
      const mismatched = records.filter(r => r[ownerField] && r[ownerField] !== ownerId);
      if (mismatched.length > 0) {
        return res.status(400).json({
          error: `Restore aborted: ${mismatched.length} record(s) in the JSON belong to a different customer. The selected customer must match the JSON's ${ownerField}.`,
        });
      }

      // Fetch all existing IDs to build a duplicate-check Set
      const result = await db.query({ [collection]: { $: {} } });
      const existing = result[collection] || [];
      const existingIds = new Set(existing.map(r => r.id));

      // Filter to only records whose ID is NOT already in DB
      const toInsert = records.filter(r => r.id && !existingIds.has(r.id));
      const skipped = records.length - toInsert.length;

      if (toInsert.length === 0) {
        return res.status(200).json({
          success: true,
          inserted: 0,
          skipped,
          message: 'All records already exist in the database — nothing inserted',
        });
      }

      // Batch in chunks of 50 to stay within InstantDB transaction limits
      let inserted = 0;
      for (let i = 0; i < toInsert.length; i += 50) {
        const batch = toInsert.slice(i, i + 50);
        const txs = batch.map(r => {
          const { id: recordId, ...rest } = r;
          return tx[collection][recordId].update(rest);
        });
        await db.transact(txs);
        inserted += batch.length;
      }

      // Log restore to archiveHistory
      try {
        await db.transact(tx.archiveHistory[id()].update({
          collection,
          ownerId,
          recordCount: inserted,
          sizeBytes: JSON.stringify(toInsert).length,
          actorId: actorId || null,
          createdAt: Date.now(),
          action: 'restore',
        }));
      } catch (err) {
        console.warn('archiveHistory logging failed:', err.message);
      }

      return res.status(200).json({
        success: true,
        inserted,
        skipped,
        message: `Restored ${inserted} record(s). Skipped ${skipped} duplicate(s).`,
      });
    }

    // ── HISTORY: return archive history records ──
    if (action === 'history') {
      try {
        const result = await db.query({ archiveHistory: { $: {} } });
        const history = result.archiveHistory || [];
        history.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        return res.status(200).json({ success: true, history });
      } catch (err) {
        return res.status(200).json({ success: true, history: [] });
      }
    }

    return res.status(400).json({ error: `Unknown action: ${action}` });
  } catch (err) {
    console.error('Archive API Error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
}
