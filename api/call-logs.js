import { createHash } from 'crypto';
import { init, tx, id } from '@instantdb/admin';
import { getLeadsForOwner } from './_leads-cache.js';
import { getCallLogsForOwner, invalidateCallLogsCache } from './_call-logs-cache.js';
import { opU, opD, runOps, readData } from './_write-ops.js';
import { rollupRepeatAttempts } from './_shared-call-logs.js';

const APP_ID = process.env.VITE_INSTANT_APP_ID;
const ADMIN_TOKEN = process.env.INSTANT_ADMIN_TOKEN;

// Time-tolerant duplicate window. Two call logs are duplicates when phone,
// direction, duration, and staffEmail all match AND their createdAt values are
// within this window. 10 minutes absorbs sync-time drift across mobile retries
// (sometimes seconds, sometimes minutes if a batch was re-uploaded) while still
// letting genuine callbacks with identical duration flow through as separate
// rows.
const DUP_WINDOW_MS = 10 * 60 * 1000;

// Stable key for grouping potentially-duplicate calls (everything except time).
function dupKey(entry) {
  const cleanPhone = (entry.phone || '').replace(/\D/g, '').slice(-10);
  const dur = entry.duration ? Number(entry.duration) : 0;
  return `${cleanPhone}|${entry.direction || 'Incoming'}|${dur}|${entry.staffEmail || ''}`;
}

// Content-addressable ID — the same physical call always hashes to the same
// ID, so InstantDB merges concurrent writes into ONE row instead of N. This is
// the primary line of defence against duplicates: it works even for old mobile
// builds that don't send deviceId, and even when N parallel POSTs race past the
// 30s cache TTL. The 1-minute bucket absorbs sub-minute drift between mobile
// resyncs while letting genuinely separate calls (different duration OR >1 min
// apart) keep their own rows.
function stableCallLogId(entry) {
  const phone = (entry.phone || '').replace(/\D/g, '').slice(-10);
  const direction = entry.direction || 'Incoming';
  const duration = Number(entry.duration) || 0;
  const staff = entry.staffEmail || '';
  const ts = Number(entry.createdAt) || 0;
  const minute = Math.floor(ts / 60000);
  const key = `${phone}|${direction}|${duration}|${staff}|${minute}`;
  const h = createHash('sha1').update(key).digest('hex');
  // Format as a UUIDv5-looking string so it sits alongside id()-generated UUIDs.
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

// Human-friendly sync summary for the mobile app to display. A sync where
// everything was skipped (already in the DB) is a SUCCESS, not a failure —
// the message makes that explicit so the app doesn't render it as an error.
function buildSyncMessage(created, skipped, rejectedOld) {
  const parts = [];
  if (created > 0) parts.push(`${created} new call${created === 1 ? '' : 's'} synced`);
  if (skipped > 0) parts.push(`${skipped} already up to date`);
  if (rejectedOld > 0) parts.push(`${rejectedOld} older than 30 days skipped`);
  if (parts.length === 0) return 'Nothing to sync.';
  if (created === 0 && skipped > 0 && rejectedOld === 0) {
    return `All ${skipped} call${skipped === 1 ? '' : 's'} already synced — nothing new to upload.`;
  }
  return parts.join(', ') + '.';
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
        const { callLogSyncState } = await readData(db, ownerId, {
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
        readData(db, ownerId, { callLogs: { $: { where: { userId: ownerId } } } }),
        getLeadsForOwner(ownerId),
      ]);

      let logs = callLogs || [];

      // Hard cap on history exposed via the API. The mobile app should only
      // ever see the last 30 days of call logs — older data stays in the DB
      // but is invisible to sync clients. Saves bandwidth, keeps the mobile
      // list snappy, and prevents an old install from re-pulling years of
      // history on first sync.
      const HISTORY_CAP_MS = 30 * 24 * 60 * 60 * 1000;
      const capCutoff = Date.now() - HISTORY_CAP_MS;

      // Filter by `since` timestamp for incremental sync, clamped to capCutoff
      // (callers can't reach further back than the cap even if they ask).
      const rawSince = params.since ? Number(params.since) : null;
      const since = Math.max(rawSince || 0, capCutoff);
      logs = logs.filter(l => {
        const t = Math.max(l.createdAt || 0, l.updatedAt || 0);
        return t > since;
      });

      // Repeat-attempt rollup so the mobile list matches the web Call Logs page
      // (consecutive unpicked re-dials to one number collapse into a single row
      // with attemptCount/groupedIds). Default ON; pass ?rollup=false to opt out.
      // Rollup needs newest-first ordering — sort before grouping.
      logs = logs.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      if (params.rollup !== 'false') {
        logs = rollupRepeatAttempts(logs);
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

    /* ── POST: Create (single or batch) or admin actions ── */
    if (method === 'POST') {
      // ── Action: dedupe-duplicates ─────────────────────────────────────
      // Sweeps every call log for this owner, groups by
      // (phone last10 | direction | duration | staffEmail), keeps the
      // oldest in each ≤10-minute cluster, hard-deletes the rest.
      // Uses the same logic as _cleanup-duplicate-call-logs.mjs so the
      // result is identical whether triggered from the UI or the migration
      // script. Idempotent: running it again on a clean dataset deletes 0.
      if (params.action === 'dedupe-duplicates') {
        const { callLogs } = await readData(db, ownerId, {
          callLogs: { $: { where: { userId: ownerId } } },
        });
        const buckets = new Map();
        for (const l of callLogs || []) {
          const k = dupKey(l);
          const arr = buckets.get(k);
          if (arr) arr.push(l);
          else buckets.set(k, [l]);
        }
        const toDelete = [];
        for (const [, rows] of buckets) {
          if (rows.length < 2) continue;
          rows.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
          let anchor = rows[0];
          for (let i = 1; i < rows.length; i++) {
            const r = rows[i];
            const dt = (r.createdAt || 0) - (anchor.createdAt || 0);
            if (dt <= DUP_WINDOW_MS) {
              toDelete.push(r.id);
            } else {
              anchor = r;
            }
          }
        }
        await runOps(db, ownerId, toDelete.map(cid => opD('callLogs', cid)));
        if (toDelete.length > 0) invalidateCallLogsCache(ownerId);
        return res.status(200).json({
          success: true,
          deleted: toDelete.length,
          scanned: (callLogs || []).length,
        });
      }

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
            ? readData(db, ownerId, { callLogSyncState: { $: { where: { ownerId, deviceId } } } })
            : Promise.resolve({ callLogSyncState: [] }),
        ]);
        const leadMap = Object.fromEntries((leads || []).map(l => [l.phone?.replace(/\D/g, ''), l]));

        // Device sync state: the server's record of what this device already sent.
        const syncStateRecord = syncStateResult.callLogSyncState?.[0] || null;
        const deviceLastSyncedAt = syncStateRecord?.lastSyncedAt || 0;

        // Build a Set of existing call log IDs from the cache. Used to skip
        // writes whose stableCallLogId already lives in the DB — avoids
        // overwriting fields that may have been edited via the web UI after
        // the original mobile sync. No extra DB query, reuses the cache load.
        const existingIds = new Set();
        for (const l of existingLogs) existingIds.add(l.id);

        // Server-side retention cap: never accept call logs older than 30
        // days. A fresh install may report years of phone-history; without
        // this gate the DB would balloon with old data the user can't even
        // see (the read path already hides anything older than 30 days).
        const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
        const retentionCutoff = now - RETENTION_MS;

        // Filter batch:
        // 1. Reject calls older than the 30-day retention window
        // 2. Skip calls already covered by device sync state (fast path)
        // 3. Compute stable ID; skip if it's already in the DB
        // 4. Skip duplicates within this batch itself
        const seenInBatch = new Set();
        const accepted = [];
        let skipped = 0;
        let rejectedOld = 0;
        for (const entry of batch) {
          const entryTs = entry.createdAt || now;
          if (entryTs < retentionCutoff) { rejectedOld++; continue; }
          if (deviceId && entryTs <= deviceLastSyncedAt) { skipped++; continue; }
          const stableId = stableCallLogId({ ...entry, createdAt: entryTs });
          if (existingIds.has(stableId) || seenInBatch.has(stableId)) { skipped++; continue; }
          seenInBatch.add(stableId);
          accepted.push({ ...entry, _ts: entryTs, _id: stableId });
        }

        if (accepted.length === 0) {
          // No new calls — update lastSyncAt so we know the device checked in
          if (deviceId && syncStateRecord) {
            await runOps(db, ownerId, [opU('callLogSyncState', syncStateRecord.id, { lastSyncAt: now })]);
          }
          // Compute today's rolled-up count for the mobile counter (matches web dashboard).
          // Client sends todayStart (ms, midnight in device's local tz) + staffEmail.
          let todayTotal = null;
          const reqStaffEmail = (params.staffEmail || '').toLowerCase();
          const todayStart = Number(params.todayStart) || 0;
          if (todayStart && reqStaffEmail) {
            const freshLogs = await getCallLogsForOwner(ownerId);
            const todayStaffLogs = freshLogs
              .filter(l => (l.staffEmail || '').toLowerCase() === reqStaffEmail && (l.createdAt || 0) >= todayStart)
              .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
            todayTotal = rollupRepeatAttempts(todayStaffLogs).length;
          }
          return res.status(200).json({
            success: true, created: 0, skipped, rejectedOld,
            nextSyncFrom: deviceLastSyncedAt,
            todayTotal,
            message: buildSyncMessage(0, skipped, rejectedOld),
          });
        }

        const callOps = accepted.map(entry => {
          const cleanPhone = entry.phone?.replace(/\D/g, '') || '';
          const matched = leadMap[cleanPhone] || null;
          return opU('callLogs', entry._id, {
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
        await runOps(db, ownerId, callOps);

        // Update device sync state — store the max createdAt of everything accepted.
        // This is the server's authoritative record of how far this device has synced.
        // On next sync (even after reinstall), the device sends deviceId and the server
        // returns nextSyncFrom = this value, so only new calls need to be sent.
        const newLastSyncedAt = Math.max(...accepted.map(e => e._ts));
        if (deviceId) {
          const syncStateOp = syncStateRecord
            ? opU('callLogSyncState', syncStateRecord.id, {
                lastSyncedAt: Math.max(deviceLastSyncedAt, newLastSyncedAt),
                lastSyncAt: now,
                totalSynced: (syncStateRecord.totalSynced || 0) + accepted.length,
              })
            : opU('callLogSyncState', id(), {
                deviceId,
                ownerId,
                staffEmail: accepted[0]?.staffEmail || '',
                staffName: accepted[0]?.staffName || '',
                lastSyncedAt: newLastSyncedAt,
                lastSyncAt: now,
                totalSynced: accepted.length,
                createdAt: now,
              });
          await runOps(db, ownerId, [syncStateOp]);
        }

        // Invalidate call logs cache so next read reflects the new rows
        invalidateCallLogsCache(ownerId);

        // Compute today's rolled-up count for the mobile counter (matches web dashboard).
        // Client sends todayStart (ms, midnight in device's local tz) + staffEmail.
        let todayTotal = null;
        const reqStaffEmail = (accepted[0]?.staffEmail || params.staffEmail || '').toLowerCase();
        const todayStart = Number(params.todayStart) || 0;
        if (todayStart && reqStaffEmail) {
          const freshLogs = await getCallLogsForOwner(ownerId);
          const todayStaffLogs = freshLogs
            .filter(l => (l.staffEmail || '').toLowerCase() === reqStaffEmail && (l.createdAt || 0) >= todayStart)
            .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
          todayTotal = rollupRepeatAttempts(todayStaffLogs).length;
        }

        return res.status(201).json({
          success: true,
          created: accepted.length,
          skipped,
          rejectedOld,
          nextSyncFrom: newLastSyncedAt,  // Android stores this, sends only calls after this on next sync
          todayTotal,
          message: buildSyncMessage(accepted.length, skipped, rejectedOld),
        });
      }

      // Single create — uniqueness comes from the deterministic stableCallLogId.
      // If a row with that ID already exists (web edit, prior sync, parallel
      // POST), we skip — InstantDB's per-ID merge semantics also guarantee no
      // duplicate row even if two writers race past this check simultaneously.
      const now = Date.now();
      // Same 30-day retention cap as the batch path. Single-call inserts from
      // mobile (e.g. real-time after a call ends) should always be recent, but
      // we enforce defensively.
      const RETENTION_MS_SINGLE = 30 * 24 * 60 * 60 * 1000;
      const incomingTs = Number(singleData.createdAt) || now;
      if (incomingTs < now - RETENTION_MS_SINGLE) {
        return res.status(200).json({ success: true, skipped: 1, reason: 'older-than-retention', message: 'Call older than 30 days — skipped.' });
      }
      const [leads, existingLogs] = await Promise.all([
        getLeadsForOwner(ownerId),
        getCallLogsForOwner(ownerId),
      ]);
      const cleanPhone = singleData.phone?.replace(/\D/g, '') || '';
      const matched = (leads || []).find(l => l.phone?.replace(/\D/g, '') === cleanPhone);

      const singleStableId = stableCallLogId({ ...singleData, createdAt: singleData.createdAt || now });
      if (existingLogs.some(l => l.id === singleStableId)) {
        return res.status(200).json({ success: true, skipped: 1, reason: 'duplicate', message: 'Call already synced.' });
      }

      const newId = singleStableId;
      await runOps(db, ownerId, [opU('callLogs', newId, {
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
        // Honour the caller's createdAt when supplied so the stored timestamp
        // matches the value used to compute stableCallLogId.
        createdAt: Number(singleData.createdAt) || now,
        updatedAt: now,
        source: singleData.source || 'api',
      })]);

      // Invalidate cache so next read reflects the new row
      invalidateCallLogsCache(ownerId);

      return res.status(201).json({ success: true, id: newId, lastSyncedAt: now, created: 1, message: '1 new call synced.' });
    }

    /* ── PATCH: Update ── */
    if (method === 'PATCH') {
      const { id: logId, ...updates } = params;
      if (!logId) return res.status(400).json({ error: 'id is required' });

      updates.updatedAt = Date.now();
      delete updates.ownerId;
      await runOps(db, ownerId, [opU('callLogs', logId, updates)]);
      return res.status(200).json({ success: true });
    }

    /* ── DELETE ── */
    if (method === 'DELETE') {
      const logId = params.id;
      if (!logId) return res.status(400).json({ error: 'id is required' });
      await runOps(db, ownerId, [opD('callLogs', logId)]);
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('Call Logs API Error:', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
}
