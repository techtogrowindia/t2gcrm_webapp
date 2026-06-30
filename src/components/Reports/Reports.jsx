import React, { useState, useMemo, useEffect, useCallback } from 'react';
import db from '../../instant';
import { fmt, fmtD, INDIAN_STATES, DEFAULT_STAGES, DEFAULT_SOURCES, DEFAULT_REQUIREMENTS, stageBadgeClass, getInvoiceStatus } from '../../utils/helpers';

export default function Reports({ user, perms, ownerId, profile }) {
  const canExport = (perms?.can('Reports', 'create') === true) || (perms?.can('Reports', 'edit') === true);

  const [tab, setTab] = useState('pl');
  const [dateFilter, setDateFilter] = useState('This Month');
  const [fromDate, setFromDate] = useState(() => { const d = new Date(); d.setMonth(0, 1); return d.toISOString().split('T')[0]; });
  const [toDate, setToDate] = useState(() => new Date().toISOString().split('T')[0]);

  useEffect(() => {
    if (dateFilter === 'Custom Range') return;
    const today = new Date();
    const sy = today.getFullYear();
    const sm = today.getMonth();
    const sd = today.getDate();

    let f, t;
    if (dateFilter === 'Today') { f = new Date(sy, sm, sd); t = f; }
    else if (dateFilter === 'Yesterday') { f = new Date(sy, sm, sd - 1); t = f; }
    else if (dateFilter === 'This Month') { f = new Date(sy, sm, 1); t = new Date(sy, sm + 1, 0); }
    else if (dateFilter === 'Last Month') { f = new Date(sy, sm - 1, 1); t = new Date(sy, sm, 0); }
    else if (dateFilter === 'This FY') {
      const startYear = sm >= 3 ? sy : sy - 1;
      f = new Date(startYear, 3, 1); t = new Date(startYear + 1, 2, 31);
    }
    else if (dateFilter === 'Previous FY') {
      const startYear = sm >= 3 ? sy - 1 : sy - 2;
      f = new Date(startYear, 3, 1); t = new Date(startYear + 1, 2, 31);
    }
    
    if (f && t) {
      // Adjust timezone offset to reliably get local date string
      const offset = f.getTimezoneOffset() * 60000;
      setFromDate(new Date(f - offset).toISOString().split('T')[0]);
      setToDate(new Date(t - offset).toISOString().split('T')[0]);
    }
  }, [dateFilter]);

  const { data } = db.useQuery({
    invoices: { $: { where: { userId: ownerId } } },
    expenses: { $: { where: { userId: ownerId } } },
    tasks: { $: { where: { userId: ownerId } } },
    teamMembers: { $: { where: { userId: ownerId } } },
    userProfiles: { $: { where: { userId: ownerId } } },
    partnerCommissions: { $: { where: { userId: ownerId } } },
  });

  // Leads fetched via server endpoint — avoids 11k-row InstantDB subscription
  // that hangs the page. One-shot HTTP fetch; server cache makes it ~5ms warm.
  const [leads, setLeads] = useState([]);
  useEffect(() => {
    if (!ownerId) return;
    fetch('/api/leads-page', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ownerId, mode: 'list', pageSize: 100000, actorEmail: user.email }),
    })
      .then(r => r.json())
      .then(d => setLeads((d.items || []).map(l =>
        (l.source === 'Retailer' || l.source === 'Retailers') ? { ...l, source: 'Channel Partners' } : l
      )))
      .catch(() => {});
  }, [ownerId]);

  const invoices = data?.invoices || [];
  const expenses = data?.expenses || [];
  const tasks = data?.tasks || [];
  const team = data?.teamMembers || [];
  const commissions = data?.partnerCommissions || [];

  const isTeam = perms && !perms.isOwner;
  const canSeeAll = perms?.isAdmin || perms?.isManager || !isTeam;

  const filteredInvoicesAtSource = useMemo(
    () => invoices.filter(i => canSeeAll || i.actorId === user.id),
    [invoices, canSeeAll, user.id]
  );
  const filteredExpensesAtSource = useMemo(
    () => expenses.filter(e => canSeeAll || e.actorId === user.id),
    [expenses, canSeeAll, user.id]
  );
  const filteredLeadsAtSource = useMemo(() => {
    const savedLeadStages = profile?.leadStages || [];
    const disabledStages = profile?.disabledStages || [];
    const userName = (perms?.name || '').toLowerCase().trim();
    const userEmail = (user.email || '').toLowerCase().trim();
    return leads.filter(l => {
      if (!canSeeAll) {
        const assignKey = (l.assign || '').toLowerCase().trim();
        const allowed = (assignKey && userName && assignKey === userName)
          || (assignKey && userEmail && assignKey === userEmail)
          || l.actorId === user.id;
        if (!allowed) return false;
      }
      if (savedLeadStages.length > 0 && !savedLeadStages.includes(l.stage)) return false;
      if (disabledStages.includes(l.stage)) return false;
      return true;
    });
  }, [leads, canSeeAll, perms?.name, user.id, user.email, profile?.leadStages, profile?.disabledStages]);

  const filteredTasksAtSource = useMemo(
    () => tasks.filter(t => canSeeAll || t.actorId === user.id || t.assignTo === user.email || t.assignTo === perms?.name),
    [tasks, canSeeAll, user.id, user.email, perms?.name]
  );

  const inRange = useCallback((dateStr) => {
    if (!dateStr) return false;
    const d = new Date(dateStr);
    return d >= new Date(fromDate) && d <= new Date(toDate + 'T23:59:59');
  }, [fromDate, toDate]);

  const filteredInv = useMemo(
    () => filteredInvoicesAtSource.filter(inv => inRange(inv.date) && inv.status !== 'Draft'),
    [filteredInvoicesAtSource, inRange]
  );
  const filteredExp = useMemo(
    () => filteredExpensesAtSource.filter(e => inRange(e.date)),
    [filteredExpensesAtSource, inRange]
  );

  const getInvTax = (inv) => {
    if (typeof inv.taxAmt === 'number') return inv.taxAmt;
    const items = Array.isArray(inv.items) ? inv.items : (inv.items ? JSON.parse(inv.items) : []);
    if (!items || items.length === 0) return 0;
    return items.reduce((s, it) => s + (it.qty || 0) * (it.rate || 0) * (it.taxRate || 0) / 100, 0);
  };

  const { revenue, gst, inputGst } = useMemo(() => {
    let revenue = 0, gst = 0, inputGst = 0;
    filteredInv.forEach(inv => {
      const payments = Array.isArray(inv.payments) ? inv.payments : (inv.payments ? JSON.parse(inv.payments) : []);
      const paidAmt = payments.reduce((s, p) => s + (p.amount || 0), 0);
      if (paidAmt > 0) {
        revenue += paidAmt;
        const totalTax = getInvTax(inv);
        gst += (inv.total > 0) ? (paidAmt / inv.total) * totalTax : 0;
      }
    });
    filteredExp.filter(e => e.status === 'Approved').forEach(e => {
      inputGst += (e.taxAmt || 0);
    });
    return { revenue, gst, inputGst };
  }, [filteredInv, filteredExp]);

  const totalExp = useMemo(() => filteredExp.filter(e => e.status === 'Approved').reduce((s, e) => s + (e.amount || 0), 0), [filteredExp]);
  const totalCommissions = useMemo(() => {
    return commissions
      .filter(c => c.status === 'Paid')
      .filter(c => {
        const d = c.paidAt || c.updatedAt;
        if (!d) return false;
        const dt = new Date(d);
        return dt >= new Date(fromDate) && dt <= new Date(toDate + 'T23:59:59');
      })
      .reduce((s, c) => s + (c.amount || 0), 0);
  }, [commissions, fromDate, toDate]);
  const netGst = gst - inputGst;
  const profit = revenue - totalExp - totalCommissions;

  // Lead pipeline
  const STAGE_ORDER = (profile?.leadStages?.length > 0 
    ? (profile?.stages || DEFAULT_STAGES).filter(s => profile?.leadStages?.includes(s)) 
    : (profile?.stages || DEFAULT_STAGES)
  ).filter(s => !(profile?.disabledStages || []).includes(s));

  const wonStage = profile?.wonStage || STAGE_ORDER[STAGE_ORDER.length - 1];
  const lostStage = profile?.lostStage || 'Lost'; 
  const stageCount = useMemo(
    () => STAGE_ORDER.map(s => ({ stage: s, count: filteredLeadsAtSource.filter(l => l.stage === s).length })),
    [STAGE_ORDER, filteredLeadsAtSource]
  );
  const maxCount = useMemo(() => Math.max(...stageCount.map(s => s.count), 1), [stageCount]);
  const CHART_COLORS = ['#60a5fa', '#6ee7b7', '#fde68a', '#c4b5fd', '#86efac', '#fca5a5'];

  // Team performance
  const teamPerf = useMemo(() => team.map(m => ({
    name: m.name,
    leads: filteredLeadsAtSource.filter(l => l.assign === m.name).length,
    done: filteredTasksAtSource.filter(t => t.assignTo === m.name && t.status === 'Done').length,
    tasks: filteredTasksAtSource.filter(t => t.assignTo === m.name).length,
  })), [team, filteredLeadsAtSource, filteredTasksAtSource]);

  // Lead Funnel
  const funnel = useMemo(() => {
    const total = filteredLeadsAtSource.length;
    // Contacted: any stage that isn't the first one
    const contacted = filteredLeadsAtSource.filter(l => l.stage !== STAGE_ORDER[0]).length;
    // Won: matches wonStage
    const wonCount = filteredLeadsAtSource.filter(l => l.stage === wonStage).length;
    // Negotiation: typically stages near the end but before Won (heuristically)
    const negotiation = filteredLeadsAtSource.filter(l => {
       const idx = STAGE_ORDER.indexOf(l.stage);
       return idx >= Math.floor(STAGE_ORDER.length / 2) && l.stage !== lostStage;
    }).length;
    
    return [
      { name: 'Total Leads', count: total, pct: 100, color: '#60a5fa' },
      { name: 'Contacted', count: contacted, pct: total ? Math.round((contacted/total)*100) : 0, color: '#6ee7b7' },
      { name: 'Negotiation', count: negotiation, pct: total ? Math.round((negotiation/total)*100) : 0, color: '#fde68a' },
      { name: 'Won (Success)', count: wonCount, pct: total ? Math.round((wonCount/total)*100) : 0, color: '#86efac' },
    ];
  }, [filteredLeadsAtSource, STAGE_ORDER, wonStage, lostStage]);

  // Revenue by Source
  const revBySource = useMemo(() => {
    // O(1) lookup: build name→lead map once instead of .find() inside forEach
    const leadByName = Object.fromEntries(filteredLeadsAtSource.map(l => [l.name, l]));
    const srcMap = {};
    filteredInv.forEach(inv => {
      const payments = Array.isArray(inv.payments) ? inv.payments : (inv.payments ? JSON.parse(inv.payments) : []);
      const paidAmt = payments.reduce((s, p) => s + (p.amount || 0), 0);
      if (paidAmt > 0) {
        const src = leadByName[inv.client]?.source || 'Direct/Existing';
        srcMap[src] = (srcMap[src] || 0) + paidAmt;
      }
    });
    return Object.entries(srcMap).sort((a, b) => b[1] - a[1]);
  }, [filteredInv, filteredLeadsAtSource]);
  const maxSrcRev = Math.max(...revBySource.map(([, v]) => v), 1);

  // Monthly GST Breakdown
  const gstBreakdown = useMemo(() => {
    const months = {};
    filteredInv.forEach(inv => {
      const payments = Array.isArray(inv.payments) ? inv.payments : (inv.payments ? JSON.parse(inv.payments) : []);
      const paidAmt = payments.reduce((s, p) => s + (p.amount || 0), 0);
      if (paidAmt > 0) {
        const d = new Date(inv.date);
        const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        if (!months[k]) months[k] = { out: 0, inp: 0 };
        const totalTax = getInvTax(inv);
        months[k].out += (inv.total > 0) ? (paidAmt / inv.total) * totalTax : 0;
      }
    });
    filteredExp.filter(e => e.status === 'Approved').forEach(e => {
      const d = new Date(e.date);
      const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (!months[k]) months[k] = { out: 0, inp: 0 };
      months[k].inp += (e.taxAmt || 0);
    });
    return Object.entries(months).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filteredInv, filteredExp]);

  const maxGst = useMemo(() => {
    return Math.max(...gstBreakdown.map(([, v]) => Math.max(v.out, v.inp)), 1);
  }, [gstBreakdown]);

  const exportCSV = (headers, rows, filename) => {
    const csvContent = [headers.join(','), ...rows.map(r => r.map(cell => `"${(cell || '').toString().replace(/"/g, '""')}"`).join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${filename}.csv`;
    link.click();
  };

  const handleExport = () => {
    if (tab === 'pl') {
      const plData = filteredInv.map(inv => {
        const payments = Array.isArray(inv.payments) ? inv.payments : (inv.payments ? JSON.parse(inv.payments) : []);
        const paidAmt = payments.reduce((s, p) => s + (p.amount || 0), 0);
        const commTotal = commissions.filter(c => c.invoiceId === inv.id && c.status === 'Paid').reduce((s, c) => s + (c.amount || 0), 0);
        return { ...inv, paidAmt, commTotal };
      }).filter(inv => inv.paidAmt > 0);
      exportCSV(['Invoice No', 'Client', 'Date', 'Status', 'Paid Amount', 'Commission Paid'], plData.map(inv => [inv.no, inv.client, fmtD(inv.date), inv.status, inv.paidAmt, inv.commTotal]), `PL_Report_${fromDate}_to_${toDate}`);
    } else if (tab === 'gst') {
      const gstDetails = filteredInv.map(inv => {
        const payments = Array.isArray(inv.payments) ? inv.payments : (inv.payments ? JSON.parse(inv.payments) : []);
        const paidAmt = payments.reduce((s, p) => s + (p.amount || 0), 0);
        const totalTax = getInvTax(inv);
        const paidTax = (inv.total > 0) ? (paidAmt / inv.total) * totalTax : 0;
        return { ...inv, paidAmt, paidTax };
      }).filter(inv => inv.paidAmt > 0);

      const rows = [
        ['--- Monthly Summary ---'],
        ['Month', 'Output GST', 'Input GST', 'Net Payable'],
        ...gstBreakdown.map(([k, v]) => [k, v.out, v.inp, v.out - v.inp]),
        [''],
        ['--- Invoice Details ---'],
        ['Invoice No', 'Client', 'Status', 'Paid Taxable Amt', 'Paid GST Amt'],
        ...gstDetails.map(inv => [inv.no, inv.client, inv.status, inv.paidAmt - inv.paidTax, inv.paidTax])
      ];
      exportCSV(rows[0], rows.slice(1), `GST_Detailed_Report_${fromDate}_to_${toDate}`);
    } else if (tab === 'team') {
      exportCSV(['Name', 'Leads Assigned', 'Tasks Total', 'Tasks Done', 'Completion %'], teamPerf.map(m => [m.name, m.leads, m.tasks, m.done, m.tasks ? Math.round((m.done / m.tasks) * 100) + '%' : '0%']), `Team_Perf_${fromDate}_to_${toDate}`);
    } else if (tab === 'leads') {
      exportCSV(['Stage', 'Count'], stageCount.map(s => [s.stage, s.count]), `Lead_Pipeline_${fromDate}_to_${toDate}`);
    }
  };

  return (
    <div className="reports-view">
      <style>{`
        .reports-view .tw { border: none !important; box-shadow: 0 6px 24px rgba(0,0,0,0.04) !important; border-radius: 16px !important; overflow: hidden; }
        .reports-view .tw-head { background: #fff; border-bottom: 1px solid #f4f4f4 !important; }
        .reports-view .stat-card { border: none !important; box-shadow: 0 6px 24px rgba(0,0,0,0.04) !important; border-radius: 16px !important; background: #fff !important; transition: transform 0.2s ease; }
        .reports-view .stat-card:hover { transform: translateY(-3px); box-shadow: 0 10px 30px rgba(0,0,0,0.06) !important; }
        .reports-view .sh { border: none !important; box-shadow: 0 6px 24px rgba(0,0,0,0.04) !important; }
        .reports-view .tabs { border: none !important; box-shadow: 0 6px 24px rgba(0,0,0,0.04) !important; padding: 6px !important; }
        .reports-view .tab { padding: 8px 16px !important; border-radius: 8px !important; }
        .reports-view table th { background: #fdfdfd !important; text-transform: none; color: #888; font-size: 11px; /* softer headers */ }
      `}</style>
      <div className="sh" style={{ marginBottom: 20, background: '#fff', padding: '16px 20px', borderRadius: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 15 }}>
          <h2 style={{ fontSize: 18, color: '#111' }}>Reports & Analytics</h2>
          {canExport && <button className="btn btn-secondary btn-sm" style={{ background: '#f8faf9', border: '1.5px solid #e2e8f0' }} onClick={handleExport}>⬇ Export (Excel/CSV)</button>}
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <select value={dateFilter} onChange={e => setDateFilter(e.target.value)} style={{ padding: '6px 10px', border: '1.5px solid var(--border)', borderRadius: 7, fontSize: 12, fontFamily: 'inherit' }}>
            {['Today', 'Yesterday', 'This Month', 'Last Month', 'This FY', 'Previous FY', 'Custom Range'].map(s => <option key={s}>{s}</option>)}
          </select>
          {dateFilter === 'Custom Range' && (
            <>
              <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)' }}>From</label>
              <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} style={{ padding: '6px 10px', border: '1.5px solid var(--border)', borderRadius: 7, fontSize: 12, fontFamily: 'inherit' }} />
              <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)' }}>To</label>
              <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} style={{ padding: '6px 10px', border: '1.5px solid var(--border)', borderRadius: 7, fontSize: 12, fontFamily: 'inherit' }} />
            </>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: '24px', alignItems: 'flex-start' }}>
        <div className="tabs no-print" style={{ 
          display: 'flex', 
          flexDirection: 'column', 
          gap: '4px',
          width: '240px', 
          flexShrink: 0,
          marginBottom: 24, 
          padding: 12, 
          background: '#fff', 
          borderRadius: 16, 
          border: '1px solid var(--border)', 
          boxShadow: '0 2px 10px rgba(0,0,0,0.02)' 
        }}>
          <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--muted)', padding: '0 12px 12px', letterSpacing: '0.05em' }}>Report Types</div>
          {[
            ['pl', 'P&L Statement'], 
            ['gst', 'GST Summary'], 
            ['leads', 'Lead Pipeline'], 
            ['funnel', 'Sales Funnel'],
            ['rev-src', 'Revenue by Source'],
            ['team', 'Team Performance']
          ].map(([t, l]) => (
            <div key={t} className={`tab${tab === t ? ' active' : ''}`} onClick={() => setTab(t)} style={{ padding: '10px 16px', borderRadius: 8, width: '100%', textAlign: 'left' }}>{l}</div>
          ))}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          {tab === 'pl' && (
        <div>
          <div className="stat-grid" style={{ marginBottom: 18 }}>
            <div className="stat-card sc-green"><div className="lbl">Revenue (Paid)</div><div className="val" style={{ fontSize: 'clamp(16px, 1.5vw, 20px)', wordBreak: 'break-word', lineHeight: '1.2' }}>{fmt(revenue)}</div></div>
            <div className="stat-card sc-red"><div className="lbl">Expenses</div><div className="val" style={{ fontSize: 'clamp(16px, 1.5vw, 20px)', wordBreak: 'break-word', lineHeight: '1.2' }}>{fmt(totalExp)}</div></div>
            <div className="stat-card" style={{ background: '#faf5ff' }}><div className="lbl" style={{ color: '#7c3aed' }}>Partner Commissions</div><div className="val" style={{ fontSize: 'clamp(16px, 1.5vw, 20px)', wordBreak: 'break-word', lineHeight: '1.2', color: '#7c3aed' }}>{fmt(totalCommissions)}</div></div>
            <div className={`stat-card ${profit >= 0 ? 'sc-green' : 'sc-red'}`}><div className="lbl">Net Profit</div><div className="val" style={{ fontSize: 'clamp(16px, 1.5vw, 20px)', wordBreak: 'break-word', lineHeight: '1.2' }}>{fmt(profit)}</div></div>
            <div className="stat-card sc-blue"><div className="lbl">GST Collected</div><div className="val" style={{ fontSize: 'clamp(16px, 1.5vw, 20px)', wordBreak: 'break-word', lineHeight: '1.2' }}>{fmt(gst)}</div></div>
          </div>
          <div className="tw">
            <div className="tw-head"><h3>Invoice Breakdown</h3></div>
            <div className="tw-scroll">
              <table>
                <thead><tr><th>Invoice No.</th><th>Client</th><th>Date</th><th>Status</th><th>Amount</th><th>Partner Commission</th></tr></thead>
                <tbody>
                  {(() => {
                    const plData = filteredInv.map(inv => {
                      const payments = Array.isArray(inv.payments) ? inv.payments : (inv.payments ? JSON.parse(inv.payments) : []);
                      const paidAmt = payments.reduce((s, p) => s + (p.amount || 0), 0);
                      const commTotal = commissions.filter(c => c.invoiceId === inv.id && c.status === 'Paid').reduce((s, c) => s + (c.amount || 0), 0);
                      return { ...inv, paidAmt, commTotal };
                    }).filter(inv => inv.paidAmt > 0);

                    if (plData.length === 0) return <tr><td colSpan={5} style={{ textAlign: 'center', padding: 28, color: 'var(--muted)' }}>No paid invoices in this period</td></tr>;
                    
                    return plData.map(inv => (
                      <tr key={inv.id}>
                        <td style={{ fontSize: 12 }}>{inv.no}</td>
                        <td>{inv.client}</td>
                        <td style={{ fontSize: 12 }}>{fmtD(inv.date)}</td>
                        <td><span className={`badge ${stageBadgeClass(getInvoiceStatus(inv))}`}>{getInvoiceStatus(inv)}</span></td>
                        <td style={{ fontWeight: 700 }}>{fmt(inv.paidAmt)}</td>
                        <td style={{ fontWeight: 600, color: '#7c3aed' }}>{inv.commTotal > 0 ? fmt(inv.commTotal) : '-'}</td>
                      </tr>
                    ));
                  })()}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {tab === 'gst' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div className="stat-grid">
            <div className="stat-card sc-green"><div className="lbl">Output GST (Collected)</div><div className="val" style={{ fontSize: 'clamp(16px, 1.5vw, 20px)', wordBreak: 'break-word', lineHeight: '1.2' }}>{fmt(gst)}</div></div>
            <div className="stat-card sc-red"><div className="lbl">Input GST (Paid)</div><div className="val" style={{ fontSize: 'clamp(16px, 1.5vw, 20px)', wordBreak: 'break-word', lineHeight: '1.2' }}>{fmt(inputGst)}</div></div>
            <div className="stat-card sc-purple"><div className="lbl">Net GST Payable</div><div className="val" style={{ fontSize: 'clamp(16px, 1.5vw, 20px)', wordBreak: 'break-word', lineHeight: '1.2' }}>{fmt(netGst)}</div></div>
          </div>

          <div className="tw">
            <div className="tw-head"><h3>GST Trend (Output vs Input)</h3></div>
            <div style={{ padding: '24px 20px', display: 'flex', alignItems: 'flex-end', gap: 12, height: 200, overflowX: 'auto' }}>
              {gstBreakdown.length === 0 ? <div style={{ width: '100%', textAlign: 'center', color: 'var(--muted)' }}>No trend data available</div>
                : gstBreakdown.map(([k, v]) => (
                  <div key={k} style={{ flex: 1, minWidth: 60, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                    <div style={{ display: 'flex', gap: 4, alignItems: 'flex-end', height: 140, width: '100%' }}>
                      <div title={`Output: ${fmt(v.out)}`} style={{ flex: 1, background: '#16a34a', height: `${(v.out / maxGst) * 100}%`, borderRadius: '4px 4px 0 0', minHeight: 4 }} />
                      <div title={`Input: ${fmt(v.inp)}`} style={{ flex: 1, background: '#dc2626', height: `${(v.inp / maxGst) * 100}%`, borderRadius: '4px 4px 0 0', minHeight: 4 }} />
                    </div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', textAlign: 'center' }}>
                      {new Date(k + '-01').toLocaleString('default', { month: 'short' })}
                    </div>
                  </div>
                ))}
            </div>
            <div style={{ padding: '0 20px 15px', display: 'flex', gap: 20, fontSize: 11, fontWeight: 600 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 10, height: 10, background: '#16a34a', borderRadius: 2 }} /> Output Tax</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span style={{ width: 10, height: 10, background: '#dc2626', borderRadius: 2 }} /> Input Tax</div>
            </div>
          </div>

          <div className="tw">
            <div className="tw-head"><h3>Monthly GST Breakdown</h3></div>
            <div style={{ padding: '0 20px 20px' }}>
              <div className="tw-scroll">
                <table className="li-table" style={{ width: '100%' }}>
                  <thead><tr><th>Month</th><th>Output Tax</th><th>Input Tax</th><th>Net Payable</th></tr></thead>
                  <tbody>
                    {gstBreakdown.length === 0 ? <tr><td colSpan={4} style={{ textAlign: 'center', padding: 20 }}>No data for this period</td></tr>
                      : gstBreakdown.map(([k, v]) => (
                        <tr key={k}>
                          <td>{new Date(k + '-01').toLocaleString('default', { month: 'short', year: 'numeric' })}</td>
                          <td style={{ textAlign: 'right', color: '#16a34a' }}>{fmt(v.out)}</td>
                          <td style={{ textAlign: 'right', color: '#dc2626' }}>{fmt(v.inp)}</td>
                          <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmt(v.out - v.inp)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div className="tw">
            <div className="tw-head"><h3>Invoice-wise Tax Details</h3></div>
            <div style={{ padding: '0 20px 20px' }}>
              <div className="tw-scroll">
                <table className="li-table" style={{ width: '100%' }}>
                  <thead><tr><th>Invoice No.</th><th>Client</th><th>Status</th><th>Taxable Amount</th><th>GST Amount</th></tr></thead>
                  <tbody>
                    {(() => {
                      const gstDetails = filteredInv.map(inv => {
                        const payments = Array.isArray(inv.payments) ? inv.payments : (inv.payments ? JSON.parse(inv.payments) : []);
                        const paidAmt = payments.reduce((s, p) => s + (p.amount || 0), 0);
                        const totalTax = getInvTax(inv);
                        const paidTax = (inv.total > 0) ? (paidAmt / inv.total) * totalTax : 0;
                        return { ...inv, paidAmt, paidTax };
                      }).filter(inv => inv.paidAmt > 0);

                      if (gstDetails.length === 0) return <tr><td colSpan={5} style={{ textAlign: 'center', padding: 20 }}>No paid invoices in this period</td></tr>;

                      return gstDetails.map(inv => (
                        <tr key={inv.id}>
                          <td>{inv.no}</td>
                          <td>{inv.client}</td>
                          <td><span className={`badge ${inv.status === 'Paid' ? 'bg-green' : inv.status === 'Partially Paid' ? 'bg-blue' : 'bg-gray'}`}>{inv.status}</span></td>
                          <td style={{ textAlign: 'right' }}>{fmt(inv.paidAmt - inv.paidTax)}</td>
                          <td style={{ textAlign: 'right', fontWeight: 700, color: '#16a34a' }}>{fmt(inv.paidTax)}</td>
                        </tr>
                      ));
                    })()}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === 'leads' && (
        <div className="tw">
          <div className="tw-head"><h3>Lead Distribution</h3></div>
          <div style={{ padding: '16px 20px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginBottom: 20 }}>
              <div className="stat-card"><div className="lbl">Total Leads</div><div className="val">{filteredLeadsAtSource.length}</div></div>
              <div className="stat-card sc-green"><div className="lbl">Won</div><div className="val">{filteredLeadsAtSource.filter(l => l.stage === wonStage).length}</div></div>
              <div className="stat-card sc-red"><div className="lbl">Lost</div><div className="val">{filteredLeadsAtSource.filter(l => l.stage === lostStage).length}</div></div>
            </div>
            {stageCount.map(({ stage, count }, i) => (
              <div key={stage} className="chart-row">
                <div className="chart-label" style={{ minWidth: 120 }}>{stage}</div>
                <div className="chart-bar-wrap"><div className="chart-bar" style={{ width: `${(count / maxCount) * 100}%`, background: CHART_COLORS[i % CHART_COLORS.length] }} /></div>
                <div style={{ fontSize: 11, fontWeight: 700, minWidth: 25 }}>{count}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'funnel' && (
        <div className="tw">
          <div className="tw-head"><h3>Sales Conversion Funnel</h3></div>
          <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center' }}>
            {funnel.map((f, i) => (
              <div key={f.name} style={{ width: `${100 - (i * 10)}%`, minWidth: 280, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <div style={{ width: '100%', height: 45, background: f.color, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 800, fontSize: 13, boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}>
                  {f.name}: {f.count}
                </div>
                {i < funnel.length - 1 && (
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', margin: '4px 0' }}>
                    ↓ {f.pct}% Retention
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'rev-src' && (() => {
        const total = revBySource.reduce((s, [, v]) => s + v, 0);
        let currentDeg = 0;
        const stops = revBySource.map(([src, val], i) => {
          const deg = total > 0 ? (val / total) * 360 : 0;
          const stop = `${CHART_COLORS[i % CHART_COLORS.length]} ${currentDeg}deg ${currentDeg + deg}deg`;
          currentDeg += deg;
          return stop;
        }).join(', ');
        
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div className="tw">
              <div className="tw-head"><h3>Revenue Analysis by Source</h3></div>
              <div style={{ padding: '20px' }}>
                {revBySource.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: 28, color: 'var(--muted)' }}>Register paid invoices to see source analysis</div>
                ) : revBySource.map(([src, val], i) => {
                  const pct = total > 0 ? Math.round((val / total) * 100) : 0;
                  return (
                    <div key={src} className="chart-row" style={{ marginBottom: 15 }}>
                      <div className="chart-label" style={{ width: 120 }}>{src}</div>
                      <div className="chart-bar-wrap" style={{ height: 14 }}>
                        <div className="chart-bar" style={{ width: `${(val / maxSrcRev) * 100}%`, background: CHART_COLORS[i % CHART_COLORS.length] }} />
                      </div>
                      <div className="chart-val" style={{ width: 180, fontSize: 13, marginLeft: 10, fontWeight: 700 }}>
                        {fmt(val)} <span style={{ color: 'var(--muted)', fontWeight: 600 }}>({pct}%)</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {revBySource.length > 0 && (
              <div className="tw">
                <div className="tw-head"><h3>Revenue Distribution</h3></div>
                <div style={{ padding: '30px', display: 'flex', gap: 50, alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap' }}>
                  <div style={{
                    width: 200, height: 200,
                    borderRadius: '50%',
                    background: `conic-gradient(${stops})`,
                    boxShadow: '0 4px 15px rgba(0,0,0,0.08)',
                    flexShrink: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center'
                  }}>
                    <div style={{ width: 100, height: 100, background: '#ffffff', borderRadius: '50%', boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.05)' }} />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 220 }}>
                     {revBySource.map(([src, val], i) => {
                      const pct = Math.round((val / total) * 100);
                      return (
                        <div key={src} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <div style={{ width: 14, height: 14, borderRadius: 4, background: CHART_COLORS[i % CHART_COLORS.length] }} />
                            <div style={{ fontSize: 14, fontWeight: 600 }}>{src}</div>
                          </div>
                          <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--muted)' }}>
                            {pct}%
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {tab === 'team' && (
        <div className="tw">
          <div className="tw-head"><h3>Team Performance</h3></div>
          <div className="tw-scroll">
            <table>
              <thead><tr><th>Name</th><th>Leads Assigned</th><th>Tasks Total</th><th>Tasks Done</th><th>Completion</th></tr></thead>
              <tbody>
                {teamPerf.length === 0 ? <tr><td colSpan={5} style={{ textAlign: 'center', padding: 28, color: 'var(--muted)' }}>Add team members to see performance</td></tr>
                  : teamPerf.map((m, i) => {
                    const pct = m.tasks ? Math.round((m.done / m.tasks) * 100) : 0;
                    return (
                      <tr key={i}>
                        <td><strong>{m.name}</strong></td>
                        <td><span className="badge bg-blue">{m.leads}</span></td>
                        <td>{m.tasks}</td>
                        <td><span className="badge bg-green">{m.done}</span></td>
                        <td style={{ minWidth: 100 }}><div className="pbar"><div className="pfill" style={{ width: `${pct}%` }} /></div><span style={{ fontSize: 11, color: 'var(--muted)' }}>{pct}%</span></td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </div>
      )}
        </div>
      </div>
    </div>
  );
}
