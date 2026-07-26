// ===================================================================
// api/_shared-dashboard-widgets.js — the dashboard widget catalogue.
//
// Imported by BOTH the browser (src/components/Dashboard) and the server
// (api/dashboard-widgets.js). It holds metadata only — no JSX, no Node
// built-ins — so it is safe on either side.
//
// Why shared: every widget carries the permission + plan gate that decides
// whether a caller may see it. The client uses it to build the picker; the
// server uses it to decide what it is willing to COMPUTE. If those two lists
// were maintained separately they would drift, and the drift would always
// fail open — someone hand-edits their saved layout to include a revenue
// widget and the server happily fills it in. One list, both sides.
// (CLAUDE.md → "Web ↔ API Parity": shared logic lives in api/_shared-*.js.)
// ===================================================================

// `requires` is a list of "<PermissionModule>:<planKey>" pairs.
//   match 'all' (default) — every pair must pass
//   match 'any'           — at least one pair must pass
export const WIDGETS = {
  // ── Tiles ────────────────────────────────────────────────────────
  'leads-total':    { label: 'Total leads', desc: 'All leads in your view',      kind: 'tile', group: 'Leads',    requires: ['Leads:leads'], to: 'leads', filter: { tab: 'all' } },
  'leads-active':   { label: 'Active leads', desc: 'Not won or lost yet',     kind: 'tile', group: 'Leads',    requires: ['Leads:leads'], to: 'leads' },
  'leads-overdue':  { label: 'Overdue follow-ups', desc: 'Follow-up date already passed', kind: 'tile', group: 'Leads',  requires: ['Leads:leads'], to: 'leads', filter: { tab: 'overdue', dateMode: 'followup' } },
  'leads-today':    { label: 'Follow-ups today', desc: 'Follow-ups due today', kind: 'tile', group: 'Leads',    requires: ['Leads:leads'], to: 'leads', filter: { tab: 'today', dateMode: 'followup' } },
  'quotes-count':   { label: 'Quotations', desc: 'Total quotations',       kind: 'tile', group: 'Finance',  requires: ['Quotations:quotations'], to: 'quotations' },
  'invoices-count': { label: 'Invoices', desc: 'Total invoices',         kind: 'tile', group: 'Finance',  requires: ['Invoices:invoices'], to: 'invoices' },
  'projects-active':{ label: 'Projects running', desc: 'Projects marked In Progress', kind: 'tile', group: 'Work',     requires: ['Projects:projects'], to: 'projects' },
  'amc-expiring':   { label: 'AMC expiring', desc: 'Contracts ending within 30 days',     kind: 'tile', group: 'Work',     requires: ['AMC:amc'], to: 'amc' },
  'stock-out':      { label: 'Out of stock', desc: 'Products with zero stock',     kind: 'tile', group: 'Inventory',requires: ['Products:products'], to: 'products' },
  'stock-low':      { label: 'Low stock', desc: 'Products below their reorder level',        kind: 'tile', group: 'Inventory',requires: ['Products:products'], to: 'products' },
  'ecom-orders':    { label: 'Store orders', desc: 'Orders placed in your store',     kind: 'tile', group: 'Store',    requires: ['Ecommerce:ecommerce'], to: 'ecom-orders' },
  'ecom-revenue':   { label: 'Store revenue', desc: 'Revenue from delivered orders',    kind: 'tile', group: 'Store',    requires: ['Ecommerce:ecommerce'], to: 'ecom-orders' },
  // Served by /api/dashboard-widgets rather than the component's own queries.
  'leads-untouched':{ label: 'Untouched leads', desc: 'No activity logged for 7+ days',  kind: 'tile', group: 'Leads',    requires: ['Leads:leads'], server: true, to: 'leads' },
  'calls-today':    { label: 'Calls today', desc: 'Calls you made today',      kind: 'tile', group: 'Calls',    requires: ['CallLogs:callLogs'], server: true, to: 'teams' },
  'calls-connected':{ label: 'Connected rate', desc: 'Share of calls today that connected',   kind: 'tile', group: 'Calls',    requires: ['CallLogs:callLogs'], server: true, to: 'teams' },
  'target-progress':{ label: 'My monthly target', desc: 'Leads won this month vs your target',kind: 'tile', group: 'Leads',    requires: ['Leads:leads'], server: true },

  // ── Sections ─────────────────────────────────────────────────────
  'leads-source':      { label: 'Leads by source', desc: 'Bar chart of where your leads come from',    kind: 'section', group: 'Leads',   requires: ['Leads:leads'] },
  'reminders':         { label: 'Upcoming reminders', desc: 'Scrolling list — AMC expiry, overdue follow-ups, stock alerts', kind: 'section', group: 'Leads',   requires: ['Leads:leads', 'AMC:amc'], match: 'any' },
  'leads-recent':      { label: 'Recent leads', desc: 'Table of the 5 newest leads',       kind: 'section', group: 'Leads',   requires: ['Leads:leads'] },
  'leads-hot':         { label: 'Hot leads', desc: 'List of top-priority leads with next follow-up',          kind: 'section', group: 'Leads',   requires: ['Leads:leads'] },
  'followup-calendar': { label: 'Follow-up calendar', desc: 'Month calendar, click a date to see its follow-ups', kind: 'section', group: 'Leads',   requires: ['Leads:leads'] },
  'revenue-trend':     { label: 'Monthly revenue trend', desc: 'Bar chart of the last 6 months', kind: 'section', group: 'Finance', requires: ['Invoices:invoices'] },
  // P&L renders Expenses and Commissions line items, so Invoices alone is not
  // enough to see it. Products is required too — not for access but for
  // correctness: without it COGS silently computes as 0 and Gross Profit reads
  // far too high. A missing input here produces a confidently wrong number.
  'pnl':               { label: 'Profit & loss summary', desc: 'Grid — revenue, COGS, expenses, profit, margin', kind: 'section', group: 'Finance', requires: ['Invoices:invoices', 'Expenses:expenses', 'Products:products'] },
  'ecom-recent':       { label: 'Recent store orders', desc: 'Table of the 5 latest store orders', kind: 'section', group: 'Store',  requires: ['Ecommerce:ecommerce'] },
  'appts-today':       { label: 'Appointments today', desc: 'List of bookings today, with times',  kind: 'section', group: 'Work',   requires: ['Appointments:appointments'] },
  // Served by /api/dashboard-widgets.
  'my-day':            { label: 'My day', desc: 'Your follow-ups, tasks and appointments for today, in time order',              kind: 'section', group: 'Leads',  requires: ['Leads:leads'], server: true },
  'receivables':       { label: 'Aging receivables', desc: 'Unpaid invoices bucketed by how overdue they are',   kind: 'section', group: 'Finance',requires: ['Invoices:invoices'], server: true },
  'team-leaderboard':  { label: 'Team leaderboard', desc: 'Table of calls and leads per member, last 30 days',    kind: 'section', group: 'Calls',  requires: ['Teams:teams', 'CallLogs:callLogs'], match: 'any', server: true },
  'call-heatmap':      { label: 'Best time to call', desc: 'Grid of which day and hour your calls connect',   kind: 'section', group: 'Calls',  requires: ['CallLogs:callLogs'], server: true },
};

/** Widget ids in this layout whose data comes from /api/dashboard-widgets. */
export function serverWidgetIds(layout) {
  return [...(layout?.tiles || []), ...(layout?.sections || [])].filter(id => WIDGETS[id]?.server);
}

/**
 * Can this caller see this widget?
 * @param {string} id
 * @param {{ can:(module:string,action?:string)=>boolean, isModuleEnabled:(key:string)=>boolean }} ctx
 */
export function isWidgetAllowed(id, ctx) {
  const w = WIDGETS[id];
  if (!w) return false;
  const test = (pair) => {
    const [module, planKey] = pair.split(':');
    return ctx.can(module, 'list') === true && ctx.isModuleEnabled(planKey) !== false;
  };
  return w.match === 'any' ? w.requires.some(test) : w.requires.every(test);
}

/** Filter a saved layout down to what the caller is actually entitled to. */
export function allowedLayout(layout, ctx) {
  const pick = (ids, kind) => (Array.isArray(ids) ? ids : [])
    .filter(id => WIDGETS[id]?.kind === kind && isWidgetAllowed(id, ctx));
  return { tiles: pick(layout?.tiles, 'tile'), sections: pick(layout?.sections, 'section') };
}

// Starting layouts. A member gets a COPY on first login and diverges from
// there — presets are a starting point, never a live link, so an owner
// changing the preset can't silently rearrange someone's dashboard.
export const PRESETS = {
  owner: {
    tiles: ['leads-total', 'leads-active', 'leads-overdue', 'quotes-count', 'invoices-count', 'projects-active', 'amc-expiring', 'stock-out', 'stock-low', 'ecom-orders', 'ecom-revenue'],
    sections: ['leads-source', 'reminders', 'leads-recent', 'leads-hot', 'pnl', 'revenue-trend', 'followup-calendar', 'ecom-recent', 'appts-today'],
  },
  // Field sales: what to do today, not how the business is doing. "My day"
  // leads because it is the only widget that answers "what now?" directly.
  sales: {
    tiles: ['leads-today', 'leads-overdue', 'calls-today', 'target-progress'],
    sections: ['my-day', 'reminders', 'followup-calendar', 'leads-hot'],
    // My day is the widget people actually work from — give it the full width.
    spans: { 'my-day': 2 },
  },
  manager: {
    tiles: ['leads-total', 'leads-active', 'leads-overdue', 'leads-today', 'calls-today', 'leads-untouched'],
    sections: ['my-day', 'team-leaderboard', 'leads-source', 'reminders', 'revenue-trend', 'call-heatmap'],
    spans: { 'my-day': 2, 'call-heatmap': 2 },
  },
};

/** Preset for a role name; unknown roles get the sales (task-focused) layout. */
export function presetFor({ isOwner, role }) {
  if (isOwner) return PRESETS.owner;
  const r = String(role || '').toLowerCase();
  if (r.includes('admin')) return PRESETS.owner;
  if (r.includes('manager')) return PRESETS.manager;
  return PRESETS.sales;
}
