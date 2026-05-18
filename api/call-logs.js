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
 *   GET    /api/call-logs?ownerId=xxx                              - List all call logs
 *   GET    /api/call-logs?ownerId=xxx&since=timestamp              - Get logs after a timestamp
 *   GET    /api/call-logs?ownerId=xxx&action=sync-state&deviceId=x - Get stored sync state for device
 *   POST   /api/call-logs                                          - Create single call log
 *   POST   /api/call-logs  (body: { batch, deviceId, ... })        - Batch create + update device sync state
 *   PATCH  /api/call-logs                                          - Update a call log
 *   DELETE /api/call-logs                                          - Delete a call log
 *
 * Device Sync State (callLogSyncState collection):
 *   Tracks the last successful sync timestamp per device per owner.
 *   Android app should send deviceId on every batch POST.
 *   Server stores lastSyncedAt server-side so reinstalls/upgrades
 *   can resume from where they left off — no full re-push needed.
 *
 *   Android sync flow:
 *     1. GET ?action=sync-state&deviceId=xxx → get stored nextSyncFrom (0 if first sync)
 *     2. POST { batch: calls.filter(c => c.createdAt > nextSyncFrom), deviceId }
 *     3. Server filters + deduplicates + saves + updates sync state
 *     4. Response: { created, skipped, nextSyncFrom } → store for next time
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

    /* ── GET: List / Sync / Sync-State ── */
    if (method === 'GET') {
      // Special action: return stored sync state for a device.
      // Android calls this on startup to know where to resume from.
      // nextSyncFrom = 0 means first sync ever — send all device call logs.
      if (params.action === 'sync-state') {
        const { deviceId } = params;
        if (!deviceId) return res.status(400).json({ error: 'deviceId is required' });
        const { callLogSyncState } = await db.query({
          callLogSyncState: { $: { where: { ownerId, deviceId } } },
        });
        const state = callLogSyncState?.[0] || null;
        return res.status(200).json({
          success: true,
          deviceId,
          nextSyncFrom: state?.lastSyncedAt || 0,
          lastSyncAt: state?.lastSyncAt || null,
          totalSynced: state?.totalSynced || 0,
          staffEmail: state?.staffEmail || null,
        });
      }

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
      const { batch, deviceId, ...singleData } = params;

      // Batch mode: array of call logs from Android app
      if (Array.isArray(batch) && batch.length > 0) {
        const now = Date.now();
        const DEDUP_WINDOW_MS = 48 * 60 * 60 * 1000;
        const dedupSince = now - DEDUP_WINDOW_MS;

        // Load leads cache, existing logs cache, and device sync state in parallel.
        // The sync state tells us the max createdAt already stored for this device —
        // any call older than that is a guaranteed duplicate and skipped before
        // fingerprinting, making each sync O(new calls) not O(total calls).
        const [leads, existingLogs, syncStateResult] = await Promise.all([
          getLeadsForOwner(ownerId),
          getCallLogsForOwner(ownerId),
          deviceId
            ? db.query({ callLogSyncState: { $: { where: { ownerId, deviceId } } } })
            : Promise.resolve({ callLogSyncState: [] }),
        ]);
        const leadMap = Object.fromEntries((leads || []).map(l => [l.phone?.replace(/\D/g, ''), l]));

        // Device sync state: the server's record of what this device already sent.
        const syncStateRecord = syncStateResult.callLogSyncState?.[0] || null;
        const deviceLastSyncedAt = syncStateRecord?.lastSyncedAt || 0;

        // Build fingerprint set from last 48h only — scanning 27k+ rows every
        // sync would grow unbounded; duplicates never arrive more than 48h late.
        const existingFingerprints = new Set();
        existingLogs
          .filter(l => (l.createdAt || 0) >= dedupSince)
          .forEach(l => existingFingerprints.add(fingerprintCall(l)));

        // Filter batch:
        // 1. Skip calls already covered by device sync state (createdAt <= deviceLastSyncedAt)
        // 2. Skip fingerprint duplicates in existing logs (last 48h)
        // 3. Skip duplicates within this batch itself
        const seenInBatch = new Set();
        const accepted = [];
        let skipped = 0;
        for (const entry of batch) {
          const entryTs = entry.createdAt || now;
          // Fast path: server already has everything up to deviceLastSyncedAt for this device
          if (deviceId && entryTs <= deviceLastSyncedAt) { skipped++; continue; }
          const fp = fingerprintCall(entry);
          if (existingFingerprints.has(fp) || seenInBatch.has(fp)) { skipped++; continue; }
          seenInBatch.add(fp);
          accepted.push({ ...entry, _ts: entryTs });
        }

        if (accepted.length === 0) {
          // No new calls — update lastSyncAt so we know the device checked in
          if (deviceId && syncStateRecord) {
            await db.transact(tx.callLogSyncState[syncStateRecord.id].update({ lastSyncAt: now }));
          }
          return res.status(200).json({
            success: true, created: 0, skipped,
            nextSyncFrom: deviceLastSyncedAt,
          });
        }

        const callTxs = accepted.map(entry => {
          const cleanPhone = entry.phone?.replace(/\D/g, '') || '';
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
            createdAt: entry._ts,
            updatedAt: now,
            source: 'android',
          });
        });

        // Batch in groups of 50 to stay within InstantDB transaction limits
        for (let i = 0; i < callTxs.length; i += 50) {
          await db.transact(callTxs.slice(i, i + 50));
        }

        // Update device sync state — store the max createdAt of everything accepted.
        // This is the server's authoritative record of how far this device has synced.
        // On next sync (even after reinstall), the device sends deviceId and the server
        // returns nextSyncFrom = this value, so only new calls need to be sent.
        const newLastSyncedAt = Math.max(...accepted.map(e => e._ts));
        if (deviceId) {
          const syncStateTx = syncStateRecord
            ? tx.callLogSyncState[syncStateRecord.id].update({
                lastSyncedAt: Math.max(deviceLastSyncedAt, newLastSyncedAt),
                lastSyncAt: now,
                totalSynced: (syncStateRecord.totalSynced || 0) + accepted.length,
              })
            : tx.callLogSyncState[id()].update({
                deviceId,
                ownerId,
                staffEmail: accepted[0]?.staffEmail || '',
                staffName: accepted[0]?.staffName || '',
                lastSyncedAt: newLastSyncedAt,
                lastSyncAt: now,
                totalSynced: accepted.length,
                createdAt: now,
              });
          await db.transact(syncStateTx);
        }

        // Invalidate call logs cache so next read reflects the new rows
        invalidateCallLogsCache(ownerId);

        return res.status(201).json({
          success: true,
          created: accepted.length,
          skipped,
          nextSyncFrom: newLastSyncedAt,  // Android stores this, sends only calls after this on next sync
        });
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
