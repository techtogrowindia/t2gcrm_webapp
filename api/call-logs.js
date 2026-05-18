import { init, tx, id } from '@instantdb/admin';
import { getLeadsForOwner } from './_leads-cache.js';
import { getCallLogsForOwner, invalidateCallLogsCache } from './_call-logs-cache.js';

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
/** Derive call outcome — duration is the only honest signal of "connected".
 * The Android sync sometimes sends outcome='Connected' even on zero-duration
 * (unpicked) calls. We override that lie: no duration = not connected.
 * Specific non-connected reasons from mobile (Busy, Voicemail, Wrong Number,
 * Callback Requested) are preserved because they carry information beyond
 * "didn't answer".
 */
function deriveOutcome(entry) {
  const dur = entry.duration ? Number(entry.duration) : 0;
  // Real duration → definitely connected, override whatever label was sent
  if (dur > 0) return 'Connected';
  // Zero duration but outcome says 'Connected' — that's the bad label, fix it
  if (entry.outcome === 'Connected') return entry.direction === 'Missed' ? 'No Answer' : 'No Answer';
  // Preserve specific non-connected reasons from the caller
  if (entry.outcome && entry.outcome !== '') return entry.outcome;
  // Missed direction → No Answer
  if (entry.direction === 'Missed') return 'No Answer';
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
        // Use shared caches — avoids fresh DB queries on every sync.
        // For fingerprinting, only check the last 48h of existing logs:
        // duplicates never arrive more than 48h after the original call,
        // and scanning 27k+ rows per batch POST would grow unbounded over time.
        const DEDUP_WINDOW_MS = 48 * 60 * 60 * 1000;
        const dedupSince = Date.now() - DEDUP_WINDOW_MS;

        const [leads, existingLogs] = await Promise.all([
          getLeadsForOwner(ownerId),
          getCallLogsForOwner(ownerId),
        ]);
        const leadMap = Object.fromEntries((leads || []).map(l => [l.phone?.replace(/\D/g, ''), l]));

        // Build fingerprint set from recent logs only (last 48h).
        // Minute-bucketed timestamp is more robust than exact createdAt —
        // mobile re-syncs sometimes have ms-level drift on the same physical call.
        const existingFingerprints = new Set();
        existingLogs
          .filter(l => (l.createdAt || 0) >= dedupSince)
          .forEach(l => existingFingerprints.add(fingerprintCall(l)));

        // Filter batch: skip duplicates of existing rows AND dedup within the
        // batch itself (mobile sometimes includes the same call twice in one batch).
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

        const now = Date.now();
        const txs = accepted.map(entry => {
          const cleanPhone = entry.phone?.replace(/\D/g, '') || '';
          const entryTs = entry.createdAt || now;
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
            updatedAt: now,
            source: 'android',
          });
        });

        // Batch in groups of 50 to stay within InstantDB transaction limits
        for (let i = 0; i < txs.length; i += 50) {
          await db.transact(txs.slice(i, i + 50));
        }

        // Invalidate cache so next read reflects the new rows
        invalidateCallLogsCache(ownerId);

        // Return lastSyncedAt = max createdAt of accepted entries so the
        // Android app can store it and only send calls AFTER this timestamp
        // on the next sync — preventing full re-push on upgrade/restart.
        const lastSyncedAt = Math.max(...accepted.map(e => e.createdAt || now));
        return res.status(201).json({ success: true, created: txs.length, skipped, lastSyncedAt });
      }

      // Single create — also dedup-guarded via shared cache (48h window)
      const DEDUP_WINDOW_MS = 48 * 60 * 60 * 1000;
      const dedupSince = Date.now() - DEDUP_WINDOW_MS;
      const [leads, existingLogs] = await Promise.all([
        getLeadsForOwner(ownerId),
        getCallLogsForOwner(ownerId),
      ]);
      const cleanPhone = singleData.phone?.replace(/\D/g, '') || '';
      const matched = (leads || []).find(l => l.phone?.replace(/\D/g, '') === cleanPhone);

      const incomingFp = fingerprintCall(singleData);
      const isDup = existingLogs
        .filter(l => (l.createdAt || 0) >= dedupSince)
        .some(l => fingerprintCall(l) === incomingFp);
      if (isDup) {
        return res.status(200).json({ success: true, skipped: 1, reason: 'duplicate' });
      }

      const newId = id();
      const now = Date.now();
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
        createdAt: now,
        updatedAt: now,
        source: singleData.source || 'api',
      }));

      // Invalidate cache so next read reflects the new row
      invalidateCallLogsCache(ownerId);

      return res.status(201).json({ success: true, id: newId, lastSyncedAt: now });
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
