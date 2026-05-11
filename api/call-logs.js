import { init, tx, id } from '@instantdb/admin';
import { getLeadsForOwner } from './_leads-cache.js';

const APP_ID = process.env.VITE_INSTANT_APP_ID;
const ADMIN_TOKEN = process.env.INSTANT_ADMIN_TOKEN;

// Fingerprint a call log for dedup: same number + direction + minute + duration + staff
// = same physical call. The mobile app sometimes re-sends batches (retry, restart,
// second device), and without this guard each re-send creates duplicate rows.
function fingerprintCall(entry) {
  const cleanPhone = (entry.phone || '').replace(/\D/g, '').slice(-10);
  const minute = Math.floor((entry.createdAt || Date.now()) / 60000);
  const dur = entry.duration ? Number(entry.duration) : 0;
  return `${cleanPhone}|${entry.direction || 'Incoming'}|${minute}|${dur}|${entry.staffEmail || ''}`;
}

/**
 * Dedicated Call Logs API for Android App integration.
 * Supports batch sync of call logs from mobile devices.
 *
 * Endpoints:
 *   GET    /api/call-logs?ownerId=xxx                    - List all call logs
 *   GET    /api/call-logs?ownerId=xxx&since=timestamp    - Get logs after a timestamp (for sync)
 *   POST   /api/call-logs                                - Create single call log
 *   POST   /api/call-logs  (body: { batch: [...] })      - Batch create multiple call logs
 *   PATCH  /api/call-logs                                - Update a call log
 *   DELETE /api/call-logs                                - Delete a call log
 */
/** Derive call outcome from available data — don't blindly default to 'Connected' */
function deriveOutcome(entry) {
  // Trust explicit outcome from mobile/caller if present
  if (entry.outcome && entry.outcome !== '') return entry.outcome;
  // Derive from duration: if > 0 then connected
  if (entry.duration && Number(entry.duration) > 0) return 'Connected';
  // Missed calls
  if (entry.direction === 'Missed') return 'No Answer';
  // Default for outgoing/incoming with no duration
  return 'No Answer';
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (!APP_ID || !ADMIN_TOKEN) {
      return res.status(500).json({ error: 'Missing InstantDB configuration' });
    }

    const db = init({ appId: APP_ID, adminToken: ADMIN_TOKEN });
    const { method } = req;
    const params = { ...req.query, ...(req.body || {}) };
    const { ownerId } = params;

    if (!ownerId) {
      return res.status(400).json({ error: 'ownerId is required' });
    }

    /* ── GET: List / Sync ── */
    if (method === 'GET') {
      // Use shared leads cache to avoid pulling 11k leads per request
      const [{ callLogs }, leads] = await Promise.all([
        db.query({ callLogs: { $: { where: { userId: ownerId } } } }),
        getLeadsForOwner(ownerId),
      ]);

      let logs = callLogs || [];

      // Filter by since timestamp for incremental sync
      const since = params.since ? Number(params.since) : null;
      if (since) {
        logs = logs.filter(l => (l.createdAt || 0) > since || (l.updatedAt || 0) > since);
      }

      // Enrich with lead info
      const leadMap = Object.fromEntries((leads || []).map(l => [l.phone?.replace(/\D/g, ''), l]));
      const enriched = logs.map(log => {
        const cleanPhone = log.phone?.replace(/\D/g, '') || '';
        const matchedLead = log.leadId
          ? (leads || []).find(l => l.id === log.leadId)
          : leadMap[cleanPhone] || null;
        return {
          ...log,
          matchedLeadName: matchedLead?.name || null,
          matchedLeadId: matchedLead?.id || null,
        };
      });

      return res.status(200).json({ success: true, data: enriched, count: enriched.length });
    }

    /* ── POST: Create (single or batch) ── */
    if (method === 'POST') {
      const { batch, ...singleData } = params;

      // Batch mode: array of call logs from Android app
      if (Array.isArray(batch) && batch.length > 0) {
        // Use shared leads cache (avoids re-pulling 11k leads per request).
        // Pull existing callLogs in parallel for dedup fingerprint check.
        const [leads, existingResult] = await Promise.all([
          getLeadsForOwner(ownerId),
          db.query({ callLogs: { $: { where: { userId: ownerId } } } }),
        ]);
        const leadMap = Object.fromEntries((leads || []).map(l => [l.phone?.replace(/\D/g, ''), l]));

        // Build minute-bucketed fingerprint set. This is more robust than exact
        // createdAt because mobile re-syncs sometimes have ms-level drift on
        // the same physical call.
        const existingFingerprints = new Set();
        (existingResult.callLogs || []).forEach(l => existingFingerprints.add(fingerprintCall(l)));

        // Filter batch: skip duplicates of existing rows AND dedup within the
        // batch itself (mobile sometimes includes the same call twice).
        const seenInBatch = new Set();
        const accepted = [];
        let skipped = 0;
        for (const entry of batch) {
          const fp = fingerprintCall(entry);
          if (existingFingerprints.has(fp) || seenInBatch.has(fp)) { skipped++; continue; }
          seenInBatch.add(fp);
          accepted.push(entry);
        }

        if (accepted.length === 0) {
          return res.status(200).json({ success: true, created: 0, skipped });
        }

        const txs = accepted.map(entry => {
          const cleanPhone = entry.phone?.replace(/\D/g, '') || '';
          const entryTs = entry.createdAt || Date.now();
          const matched = leadMap[cleanPhone] || null;
          return tx.callLogs[id()].update({
            phone: entry.phone || '',
            contactName: entry.contactName || matched?.name || '',
            direction: entry.direction || 'Incoming',
            outcome: deriveOutcome(entry),
            duration: entry.duration ? Number(entry.duration) : 0,
            notes: entry.notes || '',
            leadId: matched?.id || '',
            leadName: matched?.name || entry.contactName || '',
            staffEmail: entry.staffEmail || '',
            staffName: entry.staffName || '',
            userId: ownerId,
            actorId: entry.actorId || ownerId,
            createdAt: entryTs,
            updatedAt: Date.now(),
            source: 'android',
          });
        });

        // Batch in groups of 50 to stay within InstantDB transaction limits
        for (let i = 0; i < txs.length; i += 50) {
          await db.transact(txs.slice(i, i + 50));
        }
        return res.status(201).json({ success: true, created: txs.length, skipped });
      }

      // Single create — also dedup-guarded
      const [leads, existingResult] = await Promise.all([
        getLeadsForOwner(ownerId),
        db.query({ callLogs: { $: { where: { userId: ownerId } } } }),
      ]);
      const cleanPhone = singleData.phone?.replace(/\D/g, '') || '';
      const matched = (leads || []).find(l => l.phone?.replace(/\D/g, '') === cleanPhone);

      const incomingFp = fingerprintCall(singleData);
      const isDup = (existingResult.callLogs || []).some(l => fingerprintCall(l) === incomingFp);
      if (isDup) {
        return res.status(200).json({ success: true, skipped: 1, reason: 'duplicate' });
      }

      const newId = id();
      await db.transact(tx.callLogs[newId].update({
        phone: singleData.phone || '',
        contactName: singleData.contactName || matched?.name || '',
        direction: singleData.direction || 'Outgoing',
        outcome: deriveOutcome(singleData),
        duration: singleData.duration ? Number(singleData.duration) : 0,
        notes: singleData.notes || '',
        leadId: singleData.leadId || matched?.id || '',
        leadName: matched?.name || singleData.contactName || '',
        staffEmail: singleData.staffEmail || '',
        staffName: singleData.staffName || '',
        userId: ownerId,
        actorId: singleData.actorId || ownerId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        source: singleData.source || 'api',
      }));

      return res.status(201).json({ success: true, id: newId });
    }

    /* ── PATCH: Update ── */
    if (method === 'PATCH') {
      const { id: logId, ...updates } = params;
      if (!logId) return res.status(400).json({ error: 'id is required' });

      updates.updatedAt = Date.now();
      delete updates.ownerId;
      await db.transact(tx.callLogs[logId].update(updates));
      return res.status(200).json({ success: true });
    }

    /* ── DELETE ── */
    if (method === 'DELETE') {
      const logId = params.id;
      if (!logId) return res.status(400).json({ error: 'id is required' });
      await db.transact(tx.callLogs[logId].delete());
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('Call Logs API Error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
}
