import { init, tx } from '@instantdb/admin';

const APP_ID = process.env.VITE_INSTANT_APP_ID;
const ADMIN_TOKEN = process.env.INSTANT_ADMIN_TOKEN;

/**
 * GET  /api/cleanup-duplicates?ownerId=xxx&module=callLogs&dryRun=true   → preview duplicates
 * POST /api/cleanup-duplicates  { ownerId, module, dryRun? }             → remove duplicates
 *
 * Modules supported:
 *   - callLogs: dedup on phone + createdAt + direction + staffEmail
 *   - leads:    dedup on phone (last 10 digits), keeping the earliest record
 */
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (!APP_ID || !ADMIN_TOKEN) {
      return res.status(500).json({ error: 'Missing InstantDB configuration' });
    }

    const db = init({ appId: APP_ID, adminToken: ADMIN_TOKEN });
    const params = { ...req.query, ...(req.body || {}) };
    const { ownerId, module = 'callLogs', dryRun = 'true' } = params;
    const isDryRun = dryRun === 'true' || dryRun === true;

    if (!ownerId) {
      return res.status(400).json({ error: 'ownerId is required' });
    }

    /* ══════════ CALL LOGS CLEANUP ══════════ */
    if (module === 'callLogs') {
      const { callLogs } = await db.query({
        callLogs: { $: { where: { userId: ownerId } } },
      });

      const logs = callLogs || [];
      const seen = new Map(); // dedupKey → first record id
      const duplicateIds = [];

      // Sort by createdAt ascending so we keep the earliest record
      const sorted = [...logs].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

      for (const log of sorted) {
        const phone = (log.phone || '').replace(/\D/g, '').slice(-10);
        const key = `${phone}|${log.createdAt || ''}|${log.direction || ''}|${log.staffEmail || ''}`;

        if (seen.has(key)) {
          duplicateIds.push(log.id);
        } else {
          seen.set(key, log.id);
        }
      }

      if (isDryRun) {
        return res.status(200).json({
          success: true,
          dryRun: true,
          module: 'callLogs',
          totalRecords: logs.length,
          duplicatesFound: duplicateIds.length,
          afterCleanup: logs.length - duplicateIds.length,
          duplicateIds,
        });
      }

      // Actually delete
      if (duplicateIds.length > 0) {
        const txs = duplicateIds.map(id => tx.callLogs[id].delete());
        for (let i = 0; i < txs.length; i += 50) {
          await db.transact(txs.slice(i, i + 50));
        }
      }

      return res.status(200).json({
        success: true,
        dryRun: false,
        module: 'callLogs',
        deleted: duplicateIds.length,
        remaining: logs.length - duplicateIds.length,
      });
    }

    /* ══════════ LEADS CLEANUP ══════════ */
    if (module === 'leads') {
      const { leads } = await db.query({
        leads: { $: { where: { userId: ownerId } } },
      });

      const allLeads = leads || [];
      const seen = new Map(); // phone (last 10 digits) → first record id
      const duplicateIds = [];

      // Sort by createdAt ascending so we keep the earliest record
      const sorted = [...allLeads].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

      for (const lead of sorted) {
        const phone = (lead.phone || '').replace(/\D/g, '').slice(-10);
        if (!phone || phone.length < 7) continue; // skip leads without proper phone

        // Also check name similarity to avoid false positives
        const nameKey = (lead.name || '').trim().toLowerCase();
        const key = `${phone}|${nameKey}`;

        if (seen.has(key)) {
          duplicateIds.push({ id: lead.id, name: lead.name, phone: lead.phone, createdAt: lead.createdAt });
        } else {
          seen.set(key, lead.id);
        }
      }

      if (isDryRun) {
        return res.status(200).json({
          success: true,
          dryRun: true,
          module: 'leads',
          totalRecords: allLeads.length,
          duplicatesFound: duplicateIds.length,
          afterCleanup: allLeads.length - duplicateIds.length,
          duplicates: duplicateIds.slice(0, 50), // preview first 50
        });
      }

      // Actually delete
      if (duplicateIds.length > 0) {
        const txs = duplicateIds.map(d => tx.leads[d.id].delete());
        for (let i = 0; i < txs.length; i += 50) {
          await db.transact(txs.slice(i, i + 50));
        }
      }

      return res.status(200).json({
        success: true,
        dryRun: false,
        module: 'leads',
        deleted: duplicateIds.length,
        remaining: allLeads.length - duplicateIds.length,
      });
    }

    return res.status(400).json({ error: `Unknown module: ${module}. Supported: callLogs, leads` });
  } catch (err) {
    console.error('Cleanup duplicates error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
}
