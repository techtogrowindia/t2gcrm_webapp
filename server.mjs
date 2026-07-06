import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';

// Import Vercel handlers
import authHandler from './api/auth.js';
import authPgHandler from './api/auth-pg.js';
import dataPgHandler from './api/data-pg.js';
import dataHandler from './api/data.js';
import secureDataHandler from './api/secure-data.js';
import financeHandler from './api/finance.js';
import notifyHandler from './api/notify.js';
import callLogsHandler from './api/call-logs.js';
import callLogsPageHandler from './api/call-logs-page.js';
import teamActivityHandler from './api/team-activity.js';
import teamStatsHandler from './api/team-stats.js';
import leadCountsHandler from './api/lead-counts.js';
import leadsPageHandler from './api/leads-page.js';
import dashboardStatsHandler from './api/dashboard-stats.js';
import syncWonLeadsHandler from './api/sync-won-leads.js';
import renameAssigneeHandler from './api/rename-assignee.js';
import leadCheckDuplicateHandler from './api/lead-check-duplicate.js';
import leadFormConfigHandler from './api/lead-form-config.js';
import attendanceHandler from './api/attendance.js';
import bookHandler from './api/appointments/book.js';
import checkoutHandler from './api/ecom/checkout.js';
import cronHandler from './api/cron/process-automations.js';
import waAmcCronHandler from './api/cron/process-wa-amc.js';
import waFollowupCronHandler from './api/cron/process-wa-followup.js';
import processIntegrationsHandler from './api/cron/process-integrations.js';
import gsheetsHandler from './api/webhook/gsheets.js';
import indiamartHandler from './api/webhook/indiamart.js';
import justdialHandler from './api/webhook/justdial.js';
import tradeindiaHandler from './api/webhook/tradeindia.js';
import cleanupDuplicatesHandler from './api/cleanup-duplicates.js';
import adminArchiveHandler from './api/admin/archive.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

console.log('🔧 Initializing T2GCRM...');
console.log('📍 App ID:', process.env.VITE_INSTANT_APP_ID ? 'Configured ✅' : 'NOT FOUND ❌');

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// 1. API REWRITES (Mimicking vercel.json)
const wrap = (fn) => (req, res) => fn(req, res).catch(err => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

// Data API with module parameter
app.all('/api/data/:module/:action', (req, res) => {
  req.query.module = req.params.module;
  // Express params don't automatically merge into query like Vercel, so we manually do it
  return dataHandler(req, res);
});
app.all('/api/data/:module', (req, res) => {
  req.query.module = req.params.module;
  return dataHandler(req, res);
});

// Standard APIs
app.all('/api/auth', wrap(authHandler));
app.all('/api/auth-pg', wrap(authPgHandler));  // Postgres auth (migration)
app.all('/api/data-pg', wrap(dataPgHandler));  // Postgres writes (migration)
app.all('/api/data', wrap(dataHandler));
app.all('/api/secure-data', wrap(secureDataHandler));
app.all('/api/call-logs', wrap(callLogsHandler));
app.all('/api/call-logs-page', wrap(callLogsPageHandler));
app.all('/api/team-activity', wrap(teamActivityHandler));
app.all('/api/team-stats', wrap(teamStatsHandler));
app.all('/api/lead-counts', wrap(leadCountsHandler));
app.all('/api/leads-page', wrap(leadsPageHandler));
app.all('/api/dashboard-stats', wrap(dashboardStatsHandler));
app.all('/api/sync-won-leads', wrap(syncWonLeadsHandler));
app.all('/api/rename-assignee', wrap(renameAssigneeHandler));
app.all('/api/lead-check-duplicate', wrap(leadCheckDuplicateHandler));
app.all('/api/lead-form-config', wrap(leadFormConfigHandler));
app.all('/api/attendance', wrap(attendanceHandler));
app.all('/api/finance', wrap(financeHandler));
app.all('/api/notify', wrap(notifyHandler));
app.all('/api/appointments/book', wrap(bookHandler));
app.all('/api/ecom/checkout', wrap(checkoutHandler));
app.all('/api/cron/process-automations', wrap(cronHandler));
app.all('/api/cron/process-wa-amc', wrap(waAmcCronHandler));
app.all('/api/cron/process-wa-followup', wrap(waFollowupCronHandler));
app.all('/api/cron/process-integrations', wrap(processIntegrationsHandler));
app.all('/api/webhook/gsheets', wrap(gsheetsHandler));
app.all('/api/webhook/indiamart', wrap(indiamartHandler));
app.all('/api/webhook/justdial', wrap(justdialHandler));
app.all('/api/webhook/tradeindia', wrap(tradeindiaHandler));
app.all('/api/cleanup-duplicates', wrap(cleanupDuplicatesHandler));
app.all('/api/admin/archive', wrap(adminArchiveHandler));

// 2. STATIC FILES (Frontend)
app.use(express.static(path.join(__dirname, 'dist')));

// 3. SPA ROUTING (Rewrites for Slug urls)
// Mimics: {"source": "/:slug/store", "destination": "/index.html"}
app.get('/:slug/store', (req, res) => res.sendFile(path.join(__dirname, 'dist', 'index.html')));
app.get('/:slug/orders', (req, res) => res.sendFile(path.join(__dirname, 'dist', 'index.html')));
app.get('/:slug/appointment', (req, res) => res.sendFile(path.join(__dirname, 'dist', 'index.html')));
app.get('/:slug/book', (req, res) => res.sendFile(path.join(__dirname, 'dist', 'index.html')));

// Catch-all for React Router (Version-agnostic)
app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'API not found' });
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});

// Auto-sync scheduler for lead integrations.
// Runs every 5 minutes; the handler itself decides which configs are due
// based on each config's autoSyncInterval + lastAutoSyncAt.
let integrationsRunning = false;
const runIntegrationsCron = async () => {
  if (integrationsRunning) return;
  integrationsRunning = true;
  try {
    const mockReq = { method: 'POST', query: {}, body: {} };
    const mockRes = {
      setHeader: () => {},
      status: () => ({ json: () => {}, end: () => {} }),
      json: () => {},
      end: () => {},
    };
    await processIntegrationsHandler(mockReq, mockRes);
  } catch (e) {
    console.error('[integrations-cron] tick failed:', e?.message || e);
  } finally {
    integrationsRunning = false;
  }
};
setInterval(runIntegrationsCron, 5 * 60 * 1000);   // every 5 minutes
setTimeout(runIntegrationsCron, 10 * 1000);        // first run 10s after boot

// WhatsApp AMC expiry reminder — runs once per day.
// Finds AMC contracts expiring in exactly N days (per template config)
// and sends a WhatsApp alert via Waprochat. Deduplicates via executedAutomations.
let waAmcRunning = false;
const runWaAmcCron = async () => {
  if (waAmcRunning) return;
  waAmcRunning = true;
  try {
    const mockReq = { method: 'POST', query: {}, body: {} };
    const mockRes = {
      setHeader: () => {},
      status: () => ({ json: () => {}, end: () => {} }),
      json: () => {},
      end: () => {},
    };
    await waAmcCronHandler(mockReq, mockRes);
  } catch (e) {
    console.error('[wa-amc-cron] tick failed:', e?.message || e);
  } finally {
    waAmcRunning = false;
  }
};
setInterval(runWaAmcCron, 24 * 60 * 60 * 1000); // once per day
setTimeout(runWaAmcCron, 30 * 1000);             // first run 30s after boot

// WhatsApp lead follow-up reminder — runs once per day.
// Checks leads with a followup date exactly N days away and sends a WA alert.
let waFollowupRunning = false;
const runWaFollowupCron = async () => {
  if (waFollowupRunning) return;
  waFollowupRunning = true;
  try {
    const mockReq = { method: 'POST', query: {}, body: {} };
    const mockRes = {
      setHeader: () => {},
      status: () => ({ json: () => {}, end: () => {} }),
      json: () => {},
      end: () => {},
    };
    await waFollowupCronHandler(mockReq, mockRes);
  } catch (e) {
    console.error('[wa-followup-cron] tick failed:', e?.message || e);
  } finally {
    waFollowupRunning = false;
  }
};
setInterval(runWaFollowupCron, 24 * 60 * 60 * 1000); // once per day
setTimeout(runWaFollowupCron, 45 * 1000);             // first run 45s after boot
