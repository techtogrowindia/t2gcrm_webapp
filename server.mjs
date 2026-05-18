import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';

// Import Vercel handlers
import authHandler from './api/auth.js';
import dataHandler from './api/data.js';
import financeHandler from './api/finance.js';
import notifyHandler from './api/notify.js';
import callLogsHandler from './api/call-logs.js';
import leadCountsHandler from './api/lead-counts.js';
import leadsPageHandler from './api/leads-page.js';
import dashboardStatsHandler from './api/dashboard-stats.js';
import syncWonLeadsHandler from './api/sync-won-leads.js';
import leadCheckDuplicateHandler from './api/lead-check-duplicate.js';
import attendanceHandler from './api/attendance.js';
import bookHandler from './api/appointments/book.js';
import checkoutHandler from './api/ecom/checkout.js';
import cronHandler from './api/cron/process-automations.js';
import gsheetsHandler from './api/webhook/gsheets.js';
import indiamartHandler from './api/webhook/indiamart.js';
import justdialHandler from './api/webhook/justdial.js';
import cleanupDuplicatesHandler from './api/cleanup-duplicates.js';

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
app.all('/api/data', wrap(dataHandler));
app.all('/api/call-logs', wrap(callLogsHandler));
app.all('/api/lead-counts', wrap(leadCountsHandler));
app.all('/api/leads-page', wrap(leadsPageHandler));
app.all('/api/dashboard-stats', wrap(dashboardStatsHandler));
app.all('/api/sync-won-leads', wrap(syncWonLeadsHandler));
app.all('/api/lead-check-duplicate', wrap(leadCheckDuplicateHandler));
app.all('/api/attendance', wrap(attendanceHandler));
app.all('/api/finance', wrap(financeHandler));
app.all('/api/notify', wrap(notifyHandler));
app.all('/api/appointments/book', wrap(bookHandler));
app.all('/api/ecom/checkout', wrap(checkoutHandler));
app.all('/api/cron/process-automations', wrap(cronHandler));
app.all('/api/webhook/gsheets', wrap(gsheetsHandler));
app.all('/api/webhook/indiamart', wrap(indiamartHandler));
app.all('/api/webhook/justdial', wrap(justdialHandler));
app.all('/api/cleanup-duplicates', wrap(cleanupDuplicatesHandler));

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
