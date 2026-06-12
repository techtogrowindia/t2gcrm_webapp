// Auto-sync scheduler for the TradeIndia lead integration.
//
// Why TradeIndia only:
//   - TradeIndia has a working pull API; the scheduler is most useful for
//     sources whose webhooks can't push us new leads in real time.
//   - IndiaMART and JustDial use real-time webhooks (push) — scheduling
//     pulls there would just be wasted API calls.
//
// How it works:
//   - Runs every 5 minutes via setInterval in server.mjs (production) and
//     vite.config.js (dev).
//   - Scans every userProfiles row, looks at each TradeIndia config.
//   - For configs where (Date.now() - lastAutoSyncAt) >= autoSyncInterval minutes,
//     invokes the TradeIndia webhook handler with a mock req/res to run the sync.
//   - Updates lastAutoSyncAt + autoSyncLastError after each run, in a
//     re-read-then-write step (the handler already mutated lastSyncAt itself,
//     so we re-fetch to avoid overwriting it).
//
// Migration: any existing TradeIndia config without `autoSyncInterval` set
// defaults to 1440 (every 24 hours), saved back on first tick.

import { init } from '@instantdb/admin';
import { opU, runOps } from '../_write-ops.js';
import tradeindiaHandler from '../webhook/tradeindia.js';

const APP_ID = process.env.VITE_INSTANT_APP_ID;
const ADMIN_TOKEN = process.env.INSTANT_ADMIN_TOKEN;

if (!APP_ID || !ADMIN_TOKEN) {
  console.warn('[cron/integrations] Missing VITE_INSTANT_APP_ID or INSTANT_ADMIN_TOKEN');
}

const db = init({ appId: APP_ID, adminToken: ADMIN_TOKEN });

// Default interval applied to existing configs that don't yet have one
const DEFAULT_AUTO_INTERVAL = 1440;  // 24 hours

// Invoke the TradeIndia webhook handler with a mock req/res, return its JSON payload.
async function invokeTradeIndiaSync(ownerId, configIndex) {
  const captured = {};
  const mockReq = {
    method: 'GET',
    query: { action: 'sync', ownerId, configIndex: String(configIndex) },
    body: {},
  };
  const mockRes = {
    setHeader: () => {},
    status(code) { captured.status = code; return this; },
    json(data) { captured.data = data; return this; },
    end() { return this; },
  };
  try {
    await tradeindiaHandler(mockReq, mockRes);
    return captured.data || { success: false, message: 'no response' };
  } catch (e) {
    return { success: false, message: e.message || String(e) };
  }
}

async function refetchProfile(profileId) {
  const r = await db.query({ userProfiles: { $: { where: { id: profileId } } } });
  return r.userProfiles?.[0] || null;
}

async function tickProfile(profile) {
  const stats = { migrated: 0, dueSyncs: 0, succeeded: 0, failed: 0 };

  const configs = profile.tradeindia;
  if (!Array.isArray(configs) || configs.length === 0) return stats;

  // --- Pass 1: migrate any TradeIndia config without autoSyncInterval to 24h default ---
  let typeDirty = false;
  const migratedConfigs = configs.map(cfg => {
    if (!cfg || cfg.autoSyncInterval !== undefined) return cfg;
    typeDirty = true;
    stats.migrated++;
    return { ...cfg, autoSyncInterval: DEFAULT_AUTO_INTERVAL };
  });
  if (typeDirty) {
    await runOps(db, profile.userId, [opU('userProfiles', profile.id, { tradeindia: migratedConfigs })]);
    const refreshed = await refetchProfile(profile.id);
    if (refreshed) profile = refreshed;
  }

  // --- Pass 2: run any due TradeIndia syncs ---
  const tdConfigs = profile.tradeindia || [];
  for (let i = 0; i < tdConfigs.length; i++) {
    const cfg = tdConfigs[i];
    if (!cfg) continue;
    if (cfg.disabled) continue;
    const interval = Number(cfg.autoSyncInterval || 0);
    if (interval <= 0) continue;  // off

    const lastAt = Number(cfg.lastAutoSyncAt || 0);
    const dueAt = lastAt + interval * 60 * 1000;
    if (Date.now() < dueAt) continue;  // not due yet

    stats.dueSyncs++;
    const result = await invokeTradeIndiaSync(profile.userId, i);
    const ok = result?.success === true;
    if (ok) stats.succeeded++; else stats.failed++;

    // The handler may have updated lastSyncAt in DB; re-fetch before our write
    // so we don't overwrite that change.
    const latest = await refetchProfile(profile.id);
    if (!latest) continue;
    const currentConfigs = Array.isArray(latest.tradeindia) ? latest.tradeindia.slice() : [];
    if (!currentConfigs[i]) continue;

    currentConfigs[i] = {
      ...currentConfigs[i],
      lastAutoSyncAt: Date.now(),
      autoSyncLastError: ok ? null : (result?.message || 'Unknown error'),
      autoSyncLastResult: ok
        ? `${result.added || 0} added, ${result.skipped || 0} skipped`
        : null,
    };
    try {
      await runOps(db, profile.userId, [opU('userProfiles', profile.id, { tradeindia: currentConfigs })]);
    } catch (e) {
      console.error('[cron/integrations] DB write failed', profile.id, i, e?.message);
    }
  }

  return stats;
}

export default async function handler(req, res) {
  const startedAt = Date.now();
  const totals = { profilesScanned: 0, dueSyncs: 0, succeeded: 0, failed: 0, migrated: 0 };

  try {
    const result = await db.query({ userProfiles: {} });
    const profiles = result.userProfiles || [];

    for (const profile of profiles) {
      totals.profilesScanned++;
      try {
        const s = await tickProfile(profile);
        totals.dueSyncs += s.dueSyncs;
        totals.succeeded += s.succeeded;
        totals.failed += s.failed;
        totals.migrated += s.migrated;
      } catch (e) {
        console.error('[cron/integrations] tickProfile failed', profile.id, e?.message);
      }
    }

    const summary = { ...totals, elapsedMs: Date.now() - startedAt };
    if (totals.dueSyncs > 0 || totals.migrated > 0 || totals.failed > 0) {
      console.log('[cron/integrations]', JSON.stringify(summary));
    }

    if (res?.status) return res.status(200).json({ success: true, ...summary });
    return summary;
  } catch (e) {
    console.error('[cron/integrations] Fatal:', e);
    if (res?.status) return res.status(500).json({ success: false, error: e.message });
    throw e;
  }
}
