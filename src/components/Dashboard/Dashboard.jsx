import React, { useMemo, useEffect, useState, useRef } from 'react';
import db from '../../instant';
import { useApp } from '../../context/AppContext';
import { fmt, fmtD, fmtDT, daysLeft, stageBadgeClass } from '../../utils/helpers';
import { useDashboardLayout } from '../../hooks/useDashboardLayout';
import WidgetPicker from './WidgetPicker';
import { allowedLayout, serverWidgetIds, WIDGETS } from '../../../api/_shared-dashboard-widgets';
import { pgAuthGetToken } from '../../hooks/useAuthPg';

export default function Dashboard({ user, ownerId, perms, planEnforcement }) {
  const { setActiveView } = useApp();
  const [editing, setEditing] = useState(false);
  const dragRef = useRef(null);

  // Permission + plan gates, declared before the queries so they drive BOTH what
  // gets fetched and what gets rendered. Previously every collection was fetched
  // unconditionally and only the rendering was gated, so a member with no
  // Invoices permission still downloaded all 5000 invoices into their browser —
  // invisible in the UI, plainly visible in devtools. Gating the query fixes the
  // exposure and cuts the payload for restricted members at the same time.
  // `perms` is null until MainApp resolves it; `=== true` fails closed, so
  // nothing is fetched until we positively know the caller is allowed.
  const mod = (key) => planEnforcement?.isModuleEnabled(key) !== false;
  const allow = (module, planKey) => perms?.can(module, 'list') === true && mod(planKey);

  const gLeads    = allow('Leads', 'leads');
  const gInvoices = allow('Invoices', 'invoices');
  const gQuotes   = allow('Quotations', 'quotations');
  const gProjects = allow('Projects', 'projects');
  const gAmc      = allow('AMC', 'amc');
  const gProducts = allow('Products', 'products');
  const gExpenses = allow('Expenses', 'expenses');
  const gOrders   = allow('Ecommerce', 'ecommerce');
  const gAppts    = allow('Appointments', 'appointments');
  const gPartners = mod('distributors');
  // P&L needs all three inputs to be TRUE, not just permitted-to-see-invoices.
  // It renders Expenses and Commissions line items, so gating it on Invoices
  // alone leaked expense totals to anyone with invoice access. Worse, a missing
  // input doesn't blank the card — it silently computes as 0, so a member
  // without Products would see COGS 0 and an inflated Gross Profit. Partial
  // data here produces confidently wrong numbers, so require the full set.
  const gPnl = gInvoices && gExpenses && gProducts;

  // Core: needed immediately for KPI cards, calendar, recent leads.
  // NOTE: `leads` is NOT subscribed here — at >10k leads the InstantDB
  // subscription silently truncates/times out (symptom: TOTAL LEADS = 0 or
  // 9999). Lead-derived aggregates now come from /api/dashboard-stats below.
  // Same gates expressed as a context object, for the widget registry shared
  // with the server. One definition of "may this person see this widget".
  const permCtx = useMemo(() => ({
    can: (m, a = 'list') => perms?.can(m, a) === true,
    isModuleEnabled: (k) => planEnforcement?.isModuleEnabled(k) !== false,
  }), [perms, planEnforcement]);

  const { data: coreData } = db.useQuery({
    userProfiles: { $: { where: { userId: ownerId } } },
    teamMembers: { $: { where: { userId: ownerId } } },
    // The viewer's own row — where a team member's dashboard layout is stored.
    // One row, keyed by their identity, so it can't collide with anyone else's.
    ...(user?.id ? { memberProfiles: { $: { where: { userId: user.id }, limit: 1 } } } : {}),
    ...(gInvoices ? { invoices: { $: { where: { userId: ownerId }, limit: 5000 } } } : {}),
    ...(gProjects ? { projects: { $: { where: { userId: ownerId }, limit: 2000 } } } : {}),
    ...(gAmc ? { amc: { $: { where: { userId: ownerId }, limit: 2000 } } } : {}),
  });
  // Deferred: charts, ecom, appointments — non-blocking.
  // `tasks` used to be fetched here and was never read by anything in this
  // component — 2000 rows per dashboard load, for every user, discarded.
  const { data: deferredData } = db.useQuery({
    ...(gQuotes ? { quotes: { $: { where: { userId: ownerId }, limit: 5000 } } } : {}),
    ...(gProducts ? { products: { $: { where: { userId: ownerId }, limit: 2000 } } } : {}),
    ...(gExpenses ? { expenses: { $: { where: { userId: ownerId }, limit: 2000 } } } : {}),
    ...(gOrders ? { orders: { $: { where: { userId: ownerId }, limit: 5000 } } } : {}),
    ...(gAppts ? { appointments: { $: { where: { userId: ownerId }, limit: 2000 } } } : {}),
    ...(gPartners ? { partnerCommissions: { $: { where: { userId: ownerId }, limit: 2000 } } } : {}),
  });

  const profile = coreData?.userProfiles?.[0] || {};
  const wonStage = profile.wonStage || 'Won';
  const lostStage = profile.lostStage || 'Lost';
  const quotesRaw = deferredData?.quotes || [];
  const invoicesRaw = coreData?.invoices || [];
  const projectsRaw = coreData?.projects || [];
  const amcRaw = coreData?.amc || [];
  const ordersRaw = deferredData?.orders || [];
  const apptsRaw = deferredData?.appointments || [];
  const commissionsRaw = deferredData?.partnerCommissions || [];

  const teamMembers = coreData?.teamMembers || [];
  const memberProfile = coreData?.memberProfiles?.[0];
  const myTeamMember = teamMembers.find(t => (t.email || '').toLowerCase() === (user.email || '').toLowerCase());
  // perms.name is the authoritative member name (usePermissions). On the PG/JWT
  // path user.name is empty, so without this fallback myName can be '' and the
  // name-based lead filter hides all of a member's assigned leads.
  const myName = myTeamMember?.name || perms?.name || user.name || '';
  const teamCanSeeAllLeads = profile.teamCanSeeAllLeads !== false;
  const teamCanSeeUnassignedLeads = profile.teamCanSeeUnassignedLeads !== false;

  // Per-user layout. `ready` waits for both the source record and perms so the
  // saved layout isn't briefly replaced by a preset on first paint.
  const { layout, addWidget, removeWidget, moveWidget, reorderWidget, toggleSpan, resetLayout, saveError } = useDashboardLayout({
    userId: user?.id,
    isOwner: perms?.isOwner === true,
    role: perms?.role,
    profile,
    memberProfile,
    ready: !!coreData && !!perms,
  });

  // --- Server-driven lead stats ------------------------------------------
  // Replaces the 10k-lead subscription. Refreshes every 30s.
  const [leadStats, setLeadStats] = useState(null);
  useEffect(() => {
    if (!ownerId) return;
    let cancelled = false;
    const fetchStats = async () => {
      try {
        // Today's window in the VIEWER's local day — the server's timezone
        // isn't the business's, so midnight has to be computed here.
        const d0 = new Date();
        const dayStartMs = new Date(d0.getFullYear(), d0.getMonth(), d0.getDate()).getTime();
        const res = await fetch('/api/dashboard-stats', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ownerId,
            dayStartMs,
            dayEndMs: dayStartMs + 86400000,
            userEmail: user.email,
            myName,
            teamCanSeeAllLeads,
            teamCanSeeUnassignedLeads,
            isOwner: perms?.isOwner === true,
            wonStage,
            lostStage,
            savedLeadStages: profile.leadStages || null,
            disabledStages: profile.disabledStages || [],
            nowMs: Date.now(),
          }),
        });
        const data = await res.json();
        if (!cancelled && !data.error) setLeadStats(data);
      } catch (e) {
        console.error('dashboard-stats fetch failed:', e);
      }
    };
    fetchStats();
    const iv = setInterval(fetchStats, 30000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [ownerId, user.email, myName, teamCanSeeAllLeads, teamCanSeeUnassignedLeads, perms?.isOwner, wonStage, lostStage, JSON.stringify(profile.leadStages), JSON.stringify(profile.disabledStages)]);

  // --- Server-backed widgets ---------------------------------------------
  // Widgets whose data no existing query supplies (my day, call stats, aging
  // receivables, leaderboard). One batched request for all of them, refetched
  // only when the SET of such widgets changes — reordering or adding a
  // client-side tile must not trigger a network round trip.
  const [widgetData, setWidgetData] = useState({});
  const serverIds = useMemo(() => serverWidgetIds(layout), [layout]);
  const serverIdsKey = useMemo(() => [...serverIds].sort().join(','), [serverIds]);

  useEffect(() => {
    if (!ownerId || !serverIdsKey) { setWidgetData({}); return; }
    let cancelled = false;
    const run = async () => {
      try {
        const d0 = new Date();
        const dayStartMs = new Date(d0.getFullYear(), d0.getMonth(), d0.getDate()).getTime();
        const token = pgAuthGetToken() || localStorage.getItem('tc_token') || '';
        const res = await fetch('/api/dashboard-widgets', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify({ ownerId, widgets: serverIdsKey.split(','), dayStartMs, dayEndMs: dayStartMs + 86400000 }),
        });
        const d = await res.json();
        if (!cancelled && d && !d.error) setWidgetData(d.widgets || {});
      } catch { /* widgets render their own empty state */ }
    };
    run();
    const iv = setInterval(run, 60000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [ownerId, serverIdsKey]);

  const quotes = quotesRaw;
  const invoices = invoicesRaw;
  const projects = projectsRaw;
  const amc = amcRaw;
  const orders = ordersRaw;
  const appts = apptsRaw;
  const now = new Date();

  const stats = useMemo(() => {
    const total = leadStats?.totals?.total || 0;
    const active = leadStats?.totals?.active || 0;
    const overdue = leadStats?.totals?.overdue || 0;
    const today = leadStats?.totals?.today || 0;
    const amcExp = amc.filter(a => { const d = daysLeft(a.endDate); return d <= 30 && d >= 0; }).length;
    const inProgress = projects.filter(p => p.status === 'In Progress').length;
    const outOfStock = (deferredData?.products || []).filter(p => p.trackStock && p.stock <= 0).length;
    const lowStock = (deferredData?.products || []).filter(p => p.trackStock && p.stock > 0 && p.stock <= (p.lowStockThreshold || 5)).length;
    return { total, overdue, today, active, amcExp, inProgress, outOfStock, lowStock };
  }, [leadStats, amc, projects, deferredData?.products]);

  const ecomStats = useMemo(() => {
    const total = orders.length;
    const revenue = orders.filter(o => o.status === 'Delivered').reduce((s, o) => s + (o.total || 0), 0);
    const recent = [...orders].sort((a,b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 5);
    return { total, revenue, recent };
  }, [orders]);

  const apptStats = useMemo(() => {
    // Determine today's date in YYYY-MM-DD roughly, matching the date picker output format
    const today = new Date();
    const ts = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
    const todayAppts = appts.filter(a => a.date === ts);
    return { todayAppts };
  }, [appts]);

  // Source chart data (from server)
  const srcData = useMemo(() => leadStats?.sourceCounts || [], [leadStats]);
  const maxSrc = Math.max(...srcData.map(([, v]) => v), 1);
  const CHART_COLORS = ['#22c55e', '#3b82f6', '#f59e0b', '#8b5cf6', '#ef4444', '#14b8a6'];

  // Upcoming reminders
  const reminders = useMemo(() => {
    const rem = [];
    amc.forEach(a => { const d = daysLeft(a.endDate); if (d <= 30 && d >= 0) rem.push({ icon: '🛡', text: `<strong>${a.client}</strong> AMC ${a.plan ? `(<strong>${a.plan}</strong>) ` : ''}expires in <strong>${d} days</strong>`, actionInfo: { type: 'amc', id: a.id } }); });
    (leadStats?.overdueReminders || []).forEach(l => rem.push({ icon: '⏰', text: `Follow-up overdue: <strong>${l.name}</strong>`, actionInfo: { type: 'lead', id: l.id } }));

    // Inventory Alerts
    (deferredData?.products || []).filter(p => p.trackStock).forEach(p => {
      if (p.stock <= 0) rem.push({ icon: '🔴', text: `Out of Stock: <strong>${p.name}</strong> (Available: 0)`, actionInfo: { type: 'product', id: p.id } });
      else if (p.stock <= (p.lowStockThreshold || 5)) rem.push({ icon: '🟡', text: `Low Stock: <strong>${p.name}</strong> (Only <strong>${p.stock}</strong> left)`, actionInfo: { type: 'product', id: p.id } });
    });

    return rem;
  }, [amc, leadStats, deferredData?.products]);

  // Revenue Trend (Last 6 Months)
  const revenueTrend = useMemo(() => {
    const months = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({ 
        name: d.toLocaleDateString('en-IN', { month: 'short' }),
        month: d.getMonth(),
        year: d.getFullYear(),
        total: 0
      });
    }
    invoices.forEach(inv => {
      const idate = new Date(inv.date);
      const mIdx = months.findIndex(m => m.month === idate.getMonth() && m.year === idate.getFullYear());
      if (mIdx !== -1) {
        const payments = Array.isArray(inv.payments) ? inv.payments : (inv.payments ? JSON.parse(inv.payments) : []);
        months[mIdx].total += payments.reduce((s, p) => s + (p.amount || 0), 0);
      }
    });
    return months;
  }, [invoices]);
  const maxRev = Math.max(...revenueTrend.map(m => m.total), 1);

  // Profit & Loss
  const pnl = useMemo(() => {
    const prodMap = (deferredData?.products || []).reduce((acc, p) => { acc[p.name] = p; return acc; }, {});
    let revenue = 0;
    let cogs = 0;

    invoices.forEach(inv => {
      const payments = Array.isArray(inv.payments) ? inv.payments : (inv.payments ? JSON.parse(inv.payments) : []);
      const paidAmt = payments.reduce((s, p) => s + (p.amount || 0), 0);
      
      if (paidAmt > 0) {
        revenue += paidAmt;
        
        let invCogs = 0;
        const items = Array.isArray(inv.items) ? inv.items : (inv.items ? JSON.parse(inv.items) : []);
        items.forEach(item => {
          const prod = prodMap[item.name];
          if (prod && prod.purchasePrice) invCogs += (item.qty || 0) * prod.purchasePrice;
        });
        
        cogs += (inv.total > 0) ? (paidAmt / inv.total) * invCogs : 0;
      }
    });

    const totalExpenses = (deferredData?.expenses || []).filter(e => e.status === 'Approved').reduce((s, e) => s + (e.amount || 0), 0);
    const showPartners = planEnforcement?.isModuleEnabled('distributors') !== false;
    const totalCommissions = showPartners ? commissionsRaw.filter(c => c.status === 'Paid').reduce((s, c) => s + (c.amount || 0), 0) : 0;
    const grossProfit = revenue - cogs;
    const netProfit = grossProfit - totalExpenses - totalCommissions;
    const margin = revenue > 0 ? Math.round((netProfit / revenue) * 100) : 0;
    return { revenue, cogs, grossProfit, netProfit, totalExpenses, totalCommissions, margin };
  }, [invoices, deferredData?.products, deferredData?.expenses, commissionsRaw]);

  // Hot Leads (from server, already sorted/capped)
  const hotLeads = useMemo(() => leadStats?.hotLeads || [], [leadStats]);

  // Calendar
  const [calDate, setCalDate] = React.useState(new Date());
  const [selectedCalDate, setSelectedCalDate] = React.useState(null);
  const followupLeads = leadStats?.followupLeads || [];
  const calDays = useMemo(() => {
    const fDates = new Set(followupLeads.map(l => new Date(l.followup).toDateString()));
    const yr = calDate.getFullYear(), mo = calDate.getMonth();
    const first = new Date(yr, mo, 1).getDay(), total = new Date(yr, mo + 1, 0).getDate();
    const today = new Date();
    const days = [];
    for (let i = 0; i < first; i++) days.push({ empty: true, i });
    for (let d = 1; d <= total; d++) {
      const dt = new Date(yr, mo, d);
      days.push({ d, dt, isToday: dt.toDateString() === today.toDateString(), hasEvent: fDates.has(dt.toDateString()) });
    }
    return days;
  }, [calDate, followupLeads]);

  const calSelectedLeads = useMemo(() => {
    if (!selectedCalDate) return [];
    const target = selectedCalDate.toDateString();
    return followupLeads.filter(l => new Date(l.followup).toDateString() === target);
  }, [selectedCalDate, followupLeads]);

  const greeting = useMemo(() => {
    const h = now.getHours();
    return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  }, []);


  const handleReminderClick = (info) => {
    if (!info) return;
    if (info.type === 'amc') {
      localStorage.setItem('tc_open_amc', info.id);
      setActiveView('amc');
    } else if (info.type === 'lead') {
      localStorage.setItem('tc_open_lead', info.id);
      setActiveView('leads');
    } else if (info.type === 'product') {
      setActiveView('products');
    }
  };

  // ── Widget bodies ────────────────────────────────────────────────
  // The saved layout decides which of these render and in what order. They
  // stay in this file rather than becoming 20 components because each one
  // reads the memos computed above; splitting them would mean threading a
  // dozen props through every widget for no gain.
  const TILES = {
    'leads-total':    () => <div className="stat-card sc-green"><div className="lbl">Total Leads</div><div className="val">{stats.total}</div></div>,
    'leads-active':   () => <div className="stat-card sc-blue"><div className="lbl">Active</div><div className="val">{stats.active}</div></div>,
    'leads-overdue':  () => <div className="stat-card sc-red"><div className="lbl">Overdue Follow</div><div className="val">{stats.overdue}</div></div>,
    'leads-today':    () => <div className="stat-card sc-blue"><div className="lbl">Follow-ups Today</div><div className="val">{stats.today}</div></div>,
    'quotes-count':   () => <div className="stat-card sc-yellow"><div className="lbl">Quotations</div><div className="val">{quotes.length}</div></div>,
    'invoices-count': () => <div className="stat-card sc-purple"><div className="lbl">Invoices</div><div className="val">{invoices.length}</div></div>,
    'projects-active':() => <div className="stat-card sc-teal"><div className="lbl">Projects</div><div className="val">{stats.inProgress}</div></div>,
    'amc-expiring':   () => <div className="stat-card sc-red"><div className="lbl">AMC Expiring</div><div className="val">{stats.amcExp}</div></div>,
    'stock-out':      () => <div className="stat-card sc-red" style={{ background: '#fff5f5', borderColor: '#feb2b2' }}><div className="lbl" style={{ color: '#c53030' }}>Out of Stock</div><div className="val" style={{ color: '#c53030' }}>{stats.outOfStock}</div></div>,
    'stock-low':      () => <div className="stat-card sc-yellow" style={{ background: '#fffff0', borderColor: '#faf089' }}><div className="lbl" style={{ color: '#b7791f' }}>Low Stock</div><div className="val" style={{ color: '#b7791f' }}>{stats.lowStock}</div></div>,
    'ecom-orders':    () => <div className="stat-card sc-blue" style={{ background: '#eff6ff', borderColor: '#bfdbfe' }}><div className="lbl" style={{ color: '#1d4ed8' }}>Store Orders</div><div className="val" style={{ color: '#1d4ed8' }}>{ecomStats.total}</div></div>,
    'ecom-revenue':   () => <div className="stat-card sc-green" style={{ background: '#f0fdf4', borderColor: '#bbf7d0' }}><div className="lbl" style={{ color: '#15803d' }}>Store Revenue</div><div className="val" style={{ color: '#15803d' }}>{fmt(ecomStats.revenue)}</div></div>,
    'leads-untouched':() => {
      const d = widgetData['leads-untouched'];
      return <div className="stat-card sc-yellow"><div className="lbl">Untouched {d?.days || 7}d+</div><div className="val">{d?.count ?? '—'}</div><div className="sub">No activity logged</div></div>;
    },
    'calls-today':    () => <div className="stat-card sc-teal"><div className="lbl">Calls Today</div><div className="val">{widgetData['calls-today']?.count ?? '—'}</div></div>,
    'calls-connected':() => {
      const d = widgetData['calls-connected'];
      return <div className="stat-card sc-blue"><div className="lbl">Connected Rate</div><div className="val">{d ? `${d.pct}%` : '—'}</div><div className="sub">{d ? `${d.connected} of ${d.total} calls` : 'Today'}</div></div>;
    },
    'target-progress':() => {
      const d = widgetData['target-progress'];
      // No target set is a configuration state, not a zero — say so rather than
      // showing "0 of 0", which reads like failure.
      if (!d || !d.target) return <div className="stat-card sc-purple"><div className="lbl">Monthly Target</div><div className="val" style={{ fontSize: 15 }}>Not set</div><div className="sub">Ask your manager to set one</div></div>;
      const pct = Math.min(100, Math.round((d.won / d.target) * 100));
      return (
        <div className="stat-card sc-purple">
          <div className="lbl">Monthly Target</div>
          <div className="val">{d.won}<span style={{ fontSize: 14, color: 'var(--muted)', fontWeight: 600 }}> / {d.target}</span></div>
          <div style={{ height: 5, background: 'var(--border)', borderRadius: 3, marginTop: 7, overflow: 'hidden' }}>
            <div style={{ width: `${pct}%`, height: '100%', background: pct >= 100 ? '#16a34a' : 'var(--accent)' }} />
          </div>
        </div>
      );
    },
  };

  const SECTIONS = {
    'my-day': () => {
      const d = widgetData['my-day'];
      const items = d?.items || [];
      const ICON = { followup: '📞', task: '✅', appointment: '📅' };
      const GO = { followup: 'leads', task: 'alltasks', appointment: 'appointments' };
      return (
        <div className="tw">
          <div className="tw-head">
            <h3>🗓 My Day</h3>
            {items.length > 0 && <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>{d.total} item{d.total !== 1 ? 's' : ''}</span>}
          </div>
          <div style={{ padding: '4px 0', maxHeight: 320, overflowY: 'auto' }}>
            {items.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 28, color: 'var(--muted)', fontSize: 12 }}>✓ Nothing scheduled for today</div>
            ) : items.map(it => (
              <div
                key={`${it.kind}-${it.id}`}
                onClick={() => { if (it.kind === 'followup') localStorage.setItem('tc_open_lead', it.id); setActiveView(GO[it.kind]); }}
                className="rem-item-hover"
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
              >
                <span style={{ fontSize: 13, width: 46, color: 'var(--muted)', fontWeight: 700, flexShrink: 0 }}>
                  {new Date(it.at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false })}
                </span>
                <span style={{ fontSize: 14, flexShrink: 0 }}>{ICON[it.kind]}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.title}</div>
                  {it.sub && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{it.sub}</div>}
                </div>
                {it.tag && <span className="badge" style={{ fontSize: 10, flexShrink: 0 }}>{it.tag}</span>}
              </div>
            ))}
          </div>
        </div>
      );
    },

    'receivables': () => {
      const d = widgetData['receivables'];
      const B = [
        { k: 'current', label: 'Not yet due', color: '#16a34a' },
        { k: 'd30', label: '1–30 days', color: '#d97706' },
        { k: 'd60', label: '31–60 days', color: '#ea580c' },
        { k: 'd90', label: '60+ days', color: '#dc2626' },
      ];
      const max = d ? Math.max(...B.map(b => d.buckets[b.k] || 0), 1) : 1;
      return (
        <div className="tw">
          <div className="tw-head"><h3>💳 Aging Receivables</h3>{d && <span style={{ fontSize: 12, fontWeight: 700 }}>{fmt(d.total)}</span>}</div>
          <div style={{ padding: '14px 16px' }}>
            {!d ? <div style={{ textAlign: 'center', padding: 24, color: 'var(--muted)', fontSize: 12 }}>Loading…</div>
              : d.total === 0 ? <div style={{ textAlign: 'center', padding: 24, color: 'var(--muted)', fontSize: 12 }}>✓ Nothing outstanding</div>
              : B.map(b => (
                <div key={b.k} className="chart-row">
                  <div className="chart-label">{b.label}</div>
                  <div className="chart-bar-wrap"><div className="chart-bar" style={{ width: `${((d.buckets[b.k] || 0) / max) * 100}%`, background: b.color }} /></div>
                  <div className="chart-val">{fmt(d.buckets[b.k] || 0)}</div>
                </div>
              ))}
          </div>
        </div>
      );
    },

    'team-leaderboard': () => {
      const rows = widgetData['team-leaderboard']?.rows || [];
      return (
        <div className="tw">
          <div className="tw-head"><h3>🏆 Team Leaderboard</h3><span style={{ fontSize: 11, color: 'var(--muted)' }}>Last 30 days</span></div>
          <table>
            <thead><tr><th>Member</th><th>Calls</th><th>Leads</th></tr></thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id}>
                  <td><strong>{r.name}</strong>{r.role && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{r.role}</div>}</td>
                  <td style={{ fontWeight: 700 }}>{r.calls}</td>
                  <td>{r.leads}</td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={3} style={{ textAlign: 'center', padding: 24, color: 'var(--muted)' }}>No team activity yet</td></tr>}
            </tbody>
          </table>
        </div>
      );
    },

    'call-heatmap': () => {
      const d = widgetData['call-heatmap'];
      const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      // Business hours only — a 24-column grid is unreadable at this width and
      // the empty night columns carry no information.
      const HOURS = [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19];
      const max = d ? Math.max(...d.grid.flat(), 1) : 1;
      return (
        <div className="tw">
          <div className="tw-head"><h3>🕒 Best Time to Call</h3><span style={{ fontSize: 11, color: 'var(--muted)' }}>Connected calls, 28 days</span></div>
          <div style={{ padding: '14px 16px', overflowX: 'auto' }}>
            {!d ? <div style={{ textAlign: 'center', padding: 24, color: 'var(--muted)', fontSize: 12 }}>Loading…</div> : (
              <table style={{ borderCollapse: 'collapse', fontSize: 10 }}>
                <thead>
                  <tr>
                    <th style={{ padding: 2 }} />
                    {HOURS.map(h => <th key={h} style={{ padding: '2px 3px', fontWeight: 600, color: 'var(--muted)' }}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {DAYS.map((dn, di) => (
                    <tr key={dn}>
                      <td style={{ padding: '2px 6px 2px 0', color: 'var(--muted)', fontWeight: 600 }}>{dn}</td>
                      {HOURS.map(h => {
                        const v = d.grid[di][h] || 0;
                        return (
                          <td key={h} title={`${dn} ${h}:00 — ${v} call${v !== 1 ? 's' : ''}`} style={{ padding: 1 }}>
                            <div style={{ width: 20, height: 18, borderRadius: 3, background: v === 0 ? 'var(--border)' : `rgba(34,197,94,${0.18 + (v / max) * 0.82})` }} />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      );
    },

    'leads-source': () => (
          <div className="tw">
            <div className="tw-head"><h3>Leads by Source</h3></div>
            <div style={{ padding: '14px 16px' }}>
              {srcData.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 24, color: 'var(--muted)', fontSize: 12 }}>No leads yet</div>
              ) : srcData.map(([k, v], i) => (
                <div key={k} className="chart-row">
                  <div className="chart-label">{k}</div>
                  <div className="chart-bar-wrap"><div className="chart-bar" style={{ width: `${(v / maxSrc) * 100}%`, background: CHART_COLORS[i % 6] }} /></div>
                  <div className="chart-val">{v}</div>
                </div>
              ))}
            </div>
          </div>
    ),
    'reminders': () => (
          <div className="tw">
            <div className="tw-head">
              <h3>⏰ Upcoming Reminders</h3>
              {reminders.length > 0 && <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>{reminders.length} total</span>}
            </div>
            <div style={{ padding: '6px 0', maxHeight: 320, overflowY: 'auto' }}>
              {reminders.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 28, color: 'var(--muted)', fontSize: 12 }}>✓ No pending reminders</div>
              ) : reminders.map((r, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'start', gap: 10, padding: '10px 16px', borderBottom: '1px solid var(--border)', cursor: 'pointer', transition: '.15s' }} onClick={() => handleReminderClick(r.actionInfo)} className="rem-item-hover">
                  <span style={{ fontSize: 16, flexShrink: 0 }}>{r.icon}</span>
                  <div style={{ flex: 1, fontSize: 12, lineHeight: 1.6 }} dangerouslySetInnerHTML={{ __html: r.text }} />
                </div>
              ))}
            </div>
          </div>
    ),
    'leads-recent': () => (
            <div className="tw">
              <div className="tw-head"><h3>Recent Leads</h3></div>
              <table>
                <thead><tr><th>Name</th><th>Stage</th><th>Source</th></tr></thead>
                <tbody>
                  {(leadStats?.recentLeads || []).map(l => (
                    <tr key={l.id}>
                      <td><strong>{l.name}</strong></td>
                      <td><span className={`badge ${stageBadgeClass(l.stage, wonStage)}`}>{l.stage}</span></td>
                      <td style={{ color: 'var(--muted)' }}>{l.source}</td>
                    </tr>
                  ))}
                  {(leadStats?.recentLeads || []).length === 0 && <tr><td colSpan={3} style={{ textAlign: 'center', padding: 24, color: 'var(--muted)' }}>No leads yet</td></tr>}
                </tbody>
              </table>
            </div>

    ),
    'leads-hot': () => (
            <div className="tw">
              <div className="tw-head"><h3>🔥 Hot Leads (Top Priority)</h3></div>
              <div style={{ padding: '0' }}>
                {hotLeads.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: 28, color: 'var(--muted)', fontSize: 12 }}>Check your active leads</div>
                ) : hotLeads.map(l => (
                  <div key={l.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 18px', borderBottom: '1px solid var(--border)' }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700 }}>{l.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{l.source} • {l.phone}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <span className={`badge ${stageBadgeClass(l.stage, wonStage)}`} style={{ fontSize: 10 }}>{l.stage}</span>
                      <div style={{ fontSize: 10, color: 'var(--accent)', fontWeight: 700, marginTop: 4 }}>
                        {l.followup ? `Next: ${fmtDT(l.followup)}` : 'Hot Label'}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
    ),
    'pnl': () => (
          <div className="tw">
            <div className="tw-head"><h3>💰 Profit &amp; Loss Summary</h3><span style={{ fontSize: 11, color: 'var(--muted)' }}>Based on Paid Invoices</span></div>
            <div className="pnl-grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))' }}>
              {[
                { label: 'Revenue', value: fmt(pnl.revenue), color: '#16a34a', bg: '#f0fdf4' },
                { label: 'COGS', value: fmt(pnl.cogs), color: '#7c3aed', bg: '#faf5ff' },
                { label: 'Gross Profit', value: fmt(pnl.grossProfit), color: pnl.grossProfit >= 0 ? '#16a34a' : '#dc2626', bg: pnl.grossProfit >= 0 ? '#f0fdf4' : '#fff5f5' },
                { label: 'Expenses', value: fmt(pnl.totalExpenses), color: '#d97706', bg: '#fffbeb' },
                ...(planEnforcement?.isModuleEnabled('distributors') !== false ? [{ label: 'Commissions', value: fmt(pnl.totalCommissions), color: '#2563eb', bg: '#eff6ff' }] : []),
                { label: 'Net Profit', value: fmt(pnl.netProfit), color: pnl.netProfit >= 0 ? '#16a34a' : '#dc2626', bg: pnl.netProfit >= 0 ? '#f0fdf4' : '#fff5f5' },
                { label: 'Margin %', value: `${pnl.margin}%`, color: pnl.margin >= 0 ? '#16a34a' : '#dc2626', bg: pnl.margin >= 0 ? '#f0fdf4' : '#fff5f5' },
              ].map((item, i) => (
                <div key={i} style={{ padding: '14px 18px', borderRight: '1px solid var(--border)', borderBottom: '1px solid var(--border)', background: item.bg }}>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>{item.label}</div>
                  <div style={{ fontSize: 17, fontWeight: 800, color: item.color }}>{item.value}</div>
                </div>
              ))}
            </div>
          </div>
    ),
    'revenue-trend': () => (
          <div className="tw">
            <div className="tw-head"><h3>📈 Monthly Revenue Trend</h3></div>
            <div style={{ padding: '24px 20px', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 10, height: 160 }}>
              {revenueTrend.map(m => {
                const h = (m.total / maxRev) * 100;
                return (
                  <div key={m.name} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--muted)', marginBottom: 4 }}>{m.total > 0 ? `₹${Math.round(m.total/1000)}k` : ''}</div>
                    <div style={{ width: '100%', maxWidth: 30, height: `${Math.max(h, 5)}%`, background: 'var(--accent)', borderRadius: '4px 4px 0 0', minHeight: 4 }} />
                    <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--muted)', marginTop: 8 }}>{m.name}</div>
                  </div>
                );
              })}
            </div>
          </div>
    ),
    'followup-calendar': () => (
          <div className="tw">
            <div className="tw-head">
              <h3>Follow-Up Calendar</h3>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <button className="btn-icon btn-sm" onClick={() => setCalDate(d => new Date(d.getFullYear(), d.getMonth() - 1, 1))}>‹</button>
                <span style={{ fontSize: 12, fontWeight: 700, minWidth: 100, textAlign: 'center' }}>
                  {calDate.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })}
                </span>
                <button className="btn-icon btn-sm" onClick={() => setCalDate(d => new Date(d.getFullYear(), d.getMonth() + 1, 1))}>›</button>
              </div>
            </div>
            <div style={{ padding: '10px 14px' }}>
              <div className="cal-grid">
                {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(d => (
                  <div key={d} style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', padding: '3px 0', textAlign: 'center' }}>{d}</div>
                ))}
                {calDays.map((item, i) => (
                  item.empty
                    ? <div key={i} />
                    : <div
                        key={i}
                        onClick={() => item.hasEvent ? setSelectedCalDate(selectedCalDate?.toDateString() === item.dt.toDateString() ? null : item.dt) : null}
                        className={`cal-day${item.isToday ? ' today' : item.hasEvent ? ' has-event' : ''}${selectedCalDate?.toDateString() === item.dt.toDateString() ? ' cal-day-selected' : ''}`}
                        style={{ cursor: item.hasEvent ? 'pointer' : 'default' }}
                      >
                        {item.d}{item.hasEvent && !item.isToday ? '•' : ''}
                      </div>
                ))}
              </div>

              {/* Follow-up leads popup for selected date */}
              {selectedCalDate && calSelectedLeads.length > 0 && (
                <div style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                      {selectedCalDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} — {calSelectedLeads.length} Follow-up{calSelectedLeads.length > 1 ? 's' : ''}
                    </span>
                    <button onClick={() => setSelectedCalDate(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: 16, lineHeight: 1, padding: '0 2px' }}>×</button>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 200, overflowY: 'auto' }}>
                    {calSelectedLeads.map(l => (
                      <div
                        key={l.id}
                        onClick={() => { localStorage.setItem('tc_open_lead', l.id); setActiveView('leads'); }}
                        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', borderRadius: 8, background: 'var(--bg-soft)', cursor: 'pointer', border: '1px solid var(--border)' }}
                        onMouseEnter={e => e.currentTarget.style.background = 'var(--accent-light, #f0fdf4)'}
                        onMouseLeave={e => e.currentTarget.style.background = 'var(--bg-soft)'}
                      >
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 700 }}>{l.name}</div>
                          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 1 }}>{l.phone || l.email || '—'}</div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 10, background: '#dcfce7', color: '#15803d', fontWeight: 600 }}>{l.stage}</span>
                          {l.assign && <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 3 }}>{l.assign}</div>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
    ),
    'ecom-recent': () => (
          <div className="tw">
            <div className="tw-head"><h3>Recent Store Orders</h3></div>
            <table>
              <thead><tr><th>Customer</th><th>Status</th><th>Total</th></tr></thead>
              <tbody>
                {ecomStats.recent.map(o => (
                  <tr key={o.id}>
                    <td>
                      <div><strong>{o.customerName}</strong></div>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>{o.id.slice(0, 8).toUpperCase()}</div>
                    </td>
                    <td><span className={`badge ${o.status === 'Delivered' ? 'bg-green-100 text-green-800' : 'bg-gray-100'}`} style={{ fontSize: 11 }}>{o.status}</span></td>
                    <td style={{ fontWeight: 700 }}>{fmt(o.total)}</td>
                  </tr>
                ))}
                {ecomStats.recent.length === 0 && <tr><td colSpan={3} style={{ textAlign: 'center', padding: 24, color: 'var(--muted)' }}>No recent orders</td></tr>}
              </tbody>
            </table>
          </div>
    ),
    'appts-today': () => (
          <div className="tw">
            <div className="tw-head"><h3>Appointments Today</h3></div>
            <div style={{ padding: 0 }}>
              {apptStats.todayAppts.length === 0 ? (
                <div style={{ textAlign: 'center', padding: 28, color: 'var(--muted)', fontSize: 12 }}>No appointments scheduled for today</div>
              ) : apptStats.todayAppts.sort((a, b) => a.time.localeCompare(b.time)).map(a => (
                <div key={a.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 18px', borderBottom: '1px solid var(--border)' }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700 }}>{a.customerName}</div>
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{a.service}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--accent)' }}>{a.time}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{a.customerPhone}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
    ),
  };

  // Only render what the layout asks for AND the viewer is entitled to. The
  // permission filter runs on every render, not just when the layout is saved,
  // so revoking someone's access takes effect immediately rather than on their
  // next edit.
  const visible = useMemo(() => allowedLayout(layout, permCtx), [layout, permCtx]);
  const shownTiles = visible.tiles.filter(id => TILES[id]);
  const shownSections = visible.sections.filter(id => SECTIONS[id]);

  // Drill-down: clicking a tile opens the view it summarises. Applied by
  // cloning the rendered element rather than wrapping it, so the .stat-card
  // stays the direct child of .stat-grid and the layout is untouched.
  // Suppressed while editing, where a click means "drag me", not "navigate".
  const tileNode = (id) => {
    const node = TILES[id]();
    const to = WIDGETS[id]?.to;
    if (!to || editing) return node;
    return React.cloneElement(node, {
      onClick: () => {
        // Carry the tile's filter across so the list you land on matches the
        // number you clicked. Without this the Overdue tile opened Leads on
        // the default "All" tab — which looks like a filter that didn't work.
        const f = WIDGETS[id].filter;
        if (f?.tab) localStorage.setItem('tc_leads_tab', f.tab);
        if (f?.dateMode) localStorage.setItem('tc_leads_date_mode', f.dateMode);
        setActiveView(to);
      },
      title: `Open ${WIDGETS[id].label}`,
      style: { ...(node.props.style || {}), cursor: 'pointer' },
    });
  };

  // Wrap a widget with edit controls. This is a plain function, NOT a
  // component: declaring a component inside the render body gives it a new
  // identity every pass, which unmounts and remounts its children — the
  // calendar would silently jump back to the current month on every re-render.
  // When not editing it returns the node untouched, so the normal dashboard is
  // pixel-identical to before (.stat-grid and .dash-grid-2 style their DIRECT
  // children, so an always-on wrapper would change the layout).
  // `node` must be the real element (not a Fragment) — cloneElement can't put
  // style or key handling on a Fragment, and both are needed here.
  const shell = (id, kind, node) => {
    const full = kind === 'section' && layout?.spans?.[id] === 2;
    const spanStyle = full ? { gridColumn: '1 / -1' } : null;
    // Full-width sections span both columns. Applied by cloning (not wrapping)
    // when idle, so .tw stays the direct child of .dash-grid-2; while editing
    // the wrapper IS the grid child, so it carries the span instead.
    if (!editing) {
      return React.cloneElement(node, {
        key: id,
        ...(spanStyle ? { style: { ...(node.props.style || {}), ...spanStyle } } : {}),
      });
    }
    const list = kind === 'tile' ? shownTiles : shownSections;
    const i = list.indexOf(id);
    const btn = { border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--muted)', cursor: 'pointer', borderRadius: 5, fontSize: 12, lineHeight: 1, padding: '3px 6px' };
    return (
      <div
        key={id}
        draggable
        onDragStart={e => { dragRef.current = { id, kind }; e.dataTransfer.effectAllowed = 'move'; }}
        onDragEnd={() => { dragRef.current = null; }}
        onDragOver={e => { if (dragRef.current && dragRef.current.kind === kind) e.preventDefault(); }}
        onDrop={e => {
          const d = dragRef.current;
          if (!d || d.kind !== kind || d.id === id) return;
          e.preventDefault();
          reorderWidget(d.id, kind, list.indexOf(id));
          dragRef.current = null;
        }}
        style={{ outline: '1px dashed var(--border)', outlineOffset: 2, borderRadius: 12, cursor: 'grab', ...(spanStyle || {}) }}
      >
        {/* Controls sit ABOVE the widget, not on top of it. Absolutely
            positioning them over the card covered the tile's own label —
            "Overdue follow-ups", "AMC expiring" and "Untouched 7d+" were all
            unreadable while editing, which is exactly when you need to know
            which widget you're about to move or delete. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 3, padding: '0 2px 4px', justifyContent: 'flex-end' }}>
          <span style={{ marginRight: 'auto', fontSize: 10, color: 'var(--muted)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            ⠿ {WIDGETS[id]?.label || id}
          </span>
          <button style={{ ...btn, opacity: i <= 0 ? 0.4 : 1 }} disabled={i <= 0} title="Move earlier" onClick={() => moveWidget(id, kind, -1)}>←</button>
          <button style={{ ...btn, opacity: i >= list.length - 1 ? 0.4 : 1 }} disabled={i >= list.length - 1} title="Move later" onClick={() => moveWidget(id, kind, 1)}>→</button>
          {kind === 'section' && (
            <button style={btn} title={full ? 'Make half width' : 'Make full width'} onClick={() => toggleSpan(id)}>{full ? '⇥' : '⇤⇥'}</button>
          )}
          <button style={{ ...btn, color: 'var(--danger, #dc2626)' }} title="Remove from my dashboard" onClick={() => removeWidget(id, kind)}>✕</button>
        </div>
        {node}
      </div>
    );
  };

  return (
    <div>
      {/* Header */}
      <div className="sh">
        <div>
          <h2>Dashboard</h2>
          <div className="sub">{`${greeting}! ${now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}`}</div>
        </div>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {stats.amcExp > 0 && mod('amc') && <span className="rem-badge">🛡 {stats.amcExp} AMC expiring</span>}
          <button className={`btn btn-sm ${editing ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setEditing(v => !v)}>
            {editing ? '✓ Done' : '⚙ Customize'}
          </button>
        </div>
      </div>

      {saveError && (
        <div style={{ marginBottom: 12, padding: '8px 12px', borderRadius: 8, background: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', fontSize: 12 }}>
          {saveError} — your layout is saved on this device but didn't reach the server.
        </div>
      )}

      {editing && (
        <WidgetPicker
          layout={layout}
          ctx={permCtx}
          onAdd={addWidget}
          onRemove={removeWidget}
          onReset={resetLayout}
          onClose={() => setEditing(false)}
        />
      )}

      {/* Tiles */}
      {shownTiles.length > 0 && (
        <div className="stat-grid">
          {shownTiles.map(id => shell(id, 'tile', tileNode(id)))}
        </div>
      )}

      {/* Sections */}
      {shownSections.length > 0 && (
        <div className="dash-grid-2">
          {shownSections.map(id => shell(id, 'section', SECTIONS[id]()))}
        </div>
      )}

      {shownTiles.length === 0 && shownSections.length === 0 && (
        <div className="tw" style={{ padding: 40, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
          Your dashboard is empty. Choose <strong>Customize</strong> to add widgets.
        </div>
      )}
    </div>
  );
}
