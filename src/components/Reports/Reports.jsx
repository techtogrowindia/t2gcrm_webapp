import React, { useState, useMemo, useEffect } from 'react';
import db from '../../instant';
import { fmt, fmtD, INDIAN_STATES, DEFAULT_STAGES, DEFAULT_SOURCES, DEFAULT_REQUIREMENTS, stageBadgeClass, getInvoiceStatus } from '../../utils/helpers';

export default function Reports({ user, perms, ownerId, profile }) {
  const canExport = (perms?.can('Reports', 'create') === true) || (perms?.can('Reports', 'edit') === true);

  const [tab, setTab] = useState('pl');
  const [dateFilter, setDateFilter] = useState('This Month');
  const [fromDate, setFromDate] = useState(() => { const d = new Date(); d.setMonth(0, 1); return d.toISOString().split('T')[0]; });
  const [toDate, setToDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [prodPage, setProdPage] = useState(1);
  const [prodSearch, setProdSearch] = useState('');
  const [prodSortBy, setProdSortBy] = useState('revenue'); // revenue | units | name
  const prodPageSize = 50;
  const [catFilter, setCatFilter] = useState('');
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

  // Reset pagination + category filter when tab changes
  useEffect(() => {
    setProdPage(1);
    setCatFilter('');
  }, [tab]);

  // Core: always needed for pl, gst, rev-src, funnel tabs
  const { data, isLoading: coreLoading } = db.useQuery({
    invoices: { $: { where: { userId: ownerId } } },
    expenses: { $: { where: { userId: ownerId } } },
    userProfiles: { $: { where: { userId: ownerId } } },
    partnerCommissions: { $: { where: { userId: ownerId } } },
  });

  // Deferred: subscription for non-leads tabs only; leads replaced by server fetch
  const needsLeadsData = ['leads', 'funnel', 'rev-src', 'product-enquiry', 'lead-source'].includes(tab);
  const needsProductsData = tab === 'products';
  const needsCustomersData = tab === 'customer-purchase';
  const needsStageLogs = tab === 'stage-transitions';
  // Stage Transitions is fetched server-side (see below), NOT via this
  // subscription — db.useQuery({ activityLogs: limit:5000 }) returns
  // arbitrary (often oldest) rows with no ordering, dropping recent
  // transitions in the selected window on busy workspaces.
  const needsDeferred = needsProductsData || needsCustomersData;
  const { data: deferredData, isLoading: deferredLoadingRaw } = db.useQuery(needsProductsData ? {
    products: { $: { where: { userId: ownerId } } },
  } : needsCustomersData ? {
    customers: { $: { where: { userId: ownerId }, limit: 10000 } },
  } : {});
  // Empty query ({}) resolves instantly — only treat deferred as loading when
  // the active tab actually needs deferred data.
  const deferredLoading = needsDeferred && deferredLoadingRaw;

  // Fetch leads via server when on a leads-related tab — avoids the
  // limit:10000 subscription that times out at 11k scale.
  const [reportLeads, setReportLeads] = useState([]);
  const [reportLeadsLoading, setReportLeadsLoading] = useState(false);
  useEffect(() => {
    if (!needsLeadsData || !ownerId) return;
    setReportLeadsLoading(true);
    // Fetch ALL leads (mode:'list' + large pageSize) — NOT mode:'kanban',
    // which caps at 1000 and returns only the newest-by-followup subset,
    // making every lead report undercount on large workspaces. Reports
    // aggregate over the full set and date-filter client-side, and
    // revBySource needs all-time leads to match invoices by name.
    fetch('/api/leads-page', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ownerId, mode: 'list', tab: 'all', page: 1, pageSize: 100000, isOwner: true, teamCanSeeAllLeads: true, boundaries: {} }),
    })
      .then(r => r.json())
      .then(json => setReportLeads(json.items || []))
      .catch(() => {})
      .finally(() => setReportLeadsLoading(false));
  }, [needsLeadsData, ownerId]);

  // Stage Transitions: fetch activity logs server-side for the selected date
  // range (full set, no WebSocket cap, correct on busy workspaces). Re-fetches
  // when the date range changes since the server filters by createdAt.
  const [stageLogsData, setStageLogsData] = useState([]);
  const [stageLogsLoading, setStageLogsLoading] = useState(false);
  useEffect(() => {
    if (tab !== 'stage-transitions' || !ownerId) return;
    const startMs = new Date(fromDate).getTime();
    const endMs = new Date(toDate + 'T23:59:59').getTime();
    setStageLogsLoading(true);
    fetch('/api/team-activity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ownerId, startMs, endMs }),
    })
      .then(r => r.json())
      .then(json => setStageLogsData(json.logs || []))
      .catch(() => {})
      .finally(() => setStageLogsLoading(false));
  }, [tab, ownerId, fromDate, toDate]);

  const invoices = data?.invoices || [];
  const expenses = data?.expenses || [];
  const leads = reportLeads.map(l => (l.source === 'Retailer' || l.source === 'Retailers') ? { ...l, source: 'Channel Partners' } : l);
  const products = deferredData?.products || [];
  const customersList = deferredData?.customers || [];
  const stageLogs = stageLogsData;

  // Whether the data the ACTIVE tab depends on is still loading. Used to show
  // a progress window over the report area. pl/gst/expenses/rev-src need the
  // core query (invoices/expenses); lead tabs need the leads fetch; the rest
  // need their deferred subscription.
  const needsCore = ['pl', 'gst', 'expenses', 'rev-src'].includes(tab);
  const reportLoading =
    (needsLeadsData && reportLeadsLoading) ||
    (needsStageLogs && stageLogsLoading) ||
    deferredLoading ||
    (needsCore && coreLoading);
  const commissions = data?.partnerCommissions || [];

  const isTeam = perms && !perms.isOwner;
  const canSeeAll = perms?.isAdmin || perms?.isManager || !isTeam;

  const filteredInvoicesAtSource = invoices.filter(i => canSeeAll || i.actorId === user.id);
  const filteredExpensesAtSource = expenses.filter(e => canSeeAll || e.actorId === user.id);
  const filteredLeadsAtSource = leads.filter(l => {
    // 1. Check permissions/assignee
    let allowed = false;
    if (canSeeAll) {
      allowed = true;
    } else {
      const assignKey = (l.assign || '').toLowerCase().trim();
      const userName = (perms?.name || '').toLowerCase().trim();
      const userEmail = (user.email || '').toLowerCase().trim();
      allowed = (assignKey && userName && assignKey === userName) || (assignKey && userEmail && assignKey === userEmail) || l.actorId === user.id;
    }
    if (!allowed) return false;

    // 2. Filter by profile settings (leadStages & disabledStages)
    const savedLeadStages = profile?.leadStages || [];
    const disabledStages = profile?.disabledStages || [];
    
    if (savedLeadStages.length > 0 && !savedLeadStages.includes(l.stage)) return false;
    if (disabledStages.includes(l.stage)) return false;

    return true;
  });
  const inRange = (dateStr) => {
    if (!dateStr) return false;
    const d = new Date(dateStr);
    return d >= new Date(fromDate) && d <= new Date(toDate + 'T23:59:59');
  };

  const filteredInv = filteredInvoicesAtSource.filter(inv => inRange(inv.date) && inv.status !== 'Draft');
  const filteredExp = filteredExpensesAtSource.filter(e => inRange(e.date));

  // Category filter for Expense Report — options from profile.expCats (user-configured, not hardcoded)
  const expCats = profile?.expCats || [];
  const filteredExpByCat = catFilter
    ? filteredExp.filter(e => (e.category || 'Uncategorised') === catFilter)
    : filteredExp;

  const getInvTax = (inv) => {
    if (typeof inv.taxAmt === 'number') return inv.taxAmt;
    const items = Array.isArray(inv.items) ? inv.items : (inv.items ? JSON.parse(inv.items) : []);
    if (!items || items.length === 0) return 0;
    return items.reduce((s, it) => s + (it.qty || 0) * (it.rate || 0) * (it.taxRate || 0) / 100, 0);
  };

  // Resolve how much has actually been paid for an invoice. Prefers the sum
  // of explicit payment entries; falls back to inv.total for Paid/Partially Paid
  // invoices that were marked paid without logging individual payments (older data).
  const getInvPaidAmt = (inv) => {
    const payments = Array.isArray(inv.payments) ? inv.payments : (inv.payments ? JSON.parse(inv.payments) : []);
    const fromPayments = payments.reduce((s, p) => s + (p.amount || 0), 0);
    if (fromPayments > 0) return fromPayments;
    if (inv.status === 'Paid') return inv.total || 0;
    if (inv.status === 'Partially Paid') return inv.paidAmount || 0;
    return 0;
  };

  const { revenue, gst, inputGst } = useMemo(() => {
    let revenue = 0, gst = 0, inputGst = 0;
    filteredInv.forEach(inv => {
      const paidAmt = getInvPaidAmt(inv);
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
  const pipelineLeads = useMemo(() => {
    if (tab !== 'leads') return [];
    return filteredLeadsAtSource.filter(l => l.createdAt && inRange(new Date(l.createdAt).toISOString()));
  }, [tab, filteredLeadsAtSource, fromDate, toDate]);
  const stageCount = STAGE_ORDER.map(s => ({ stage: s, count: pipelineLeads.filter(l => l.stage === s).length }));
  const maxCount = Math.max(...stageCount.map(s => s.count), 1);
  const CHART_COLORS = ['#60a5fa', '#6ee7b7', '#fde68a', '#c4b5fd', '#86efac', '#fca5a5'];

  // Lead Funnel — date-filtered on createdAt (mirrors pipelineLeads) so it
  // honours the From/To filter like every other lead report.
  const funnel = useMemo(() => {
    const inRangeLeads = filteredLeadsAtSource.filter(l => l.createdAt && inRange(new Date(l.createdAt).toISOString()));
    const total = inRangeLeads.length;
    // Contacted: any stage that isn't the first one
    const contacted = inRangeLeads.filter(l => l.stage !== STAGE_ORDER[0]).length;
    // Won: matches wonStage
    const wonCount = inRangeLeads.filter(l => l.stage === wonStage).length;
    // Negotiation: typically stages near the end but before Won (heuristically)
    const negotiation = inRangeLeads.filter(l => {
       const idx = STAGE_ORDER.indexOf(l.stage);
       return idx >= Math.floor(STAGE_ORDER.length / 2) && l.stage !== lostStage;
    }).length;

    return [
      { name: 'Total Leads', count: total, pct: 100, color: '#60a5fa' },
      { name: 'Contacted', count: contacted, pct: total ? Math.round((contacted/total)*100) : 0, color: '#6ee7b7' },
      { name: 'Negotiation', count: negotiation, pct: total ? Math.round((negotiation/total)*100) : 0, color: '#fde68a' },
      { name: 'Won (Success)', count: wonCount, pct: total ? Math.round((wonCount/total)*100) : 0, color: '#86efac' },
    ];
  }, [filteredLeadsAtSource, STAGE_ORDER, wonStage, lostStage, fromDate, toDate]);

  // Product Performance
  const productPerf = useMemo(() => {
    const prodMap = {};
    filteredInv.forEach(inv => {
      const paidAmt = getInvPaidAmt(inv);
      if (paidAmt > 0) {
        const items = Array.isArray(inv.items) ? inv.items : (inv.items ? JSON.parse(inv.items) : []);
        items.forEach(item => {
          const pName = item.product || item.description || 'Unknown';
          if (!prodMap[pName]) {
            prodMap[pName] = { name: pName, units: 0, revenue: 0, totalTax: 0 };
          }
          const itemQty = item.qty || 0;
          const itemRate = item.rate || 0;
          const itemAmount = itemQty * itemRate;
          const itemTax = itemAmount * ((item.taxRate || 0) / 100);
          prodMap[pName].units += itemQty;
          prodMap[pName].revenue += itemAmount;
          prodMap[pName].totalTax += itemTax;
        });
      }
    });
    return Object.values(prodMap).sort((a, b) => b.revenue - a.revenue);
  }, [filteredInv]);

  // Revenue by Source
  const revBySource = useMemo(() => {
    const srcMap = {};
    filteredInv.forEach(inv => {
      const paidAmt = getInvPaidAmt(inv);
      if (paidAmt > 0) {
        const lead = filteredLeadsAtSource.find(l => l.name === inv.client);
        const src = lead?.source || 'Direct/Existing';
        srcMap[src] = (srcMap[src] || 0) + paidAmt;
      }
    });
    return Object.entries(srcMap).sort((a, b) => b[1] - a[1]);
  }, [filteredInv, filteredLeadsAtSource]);
  const maxSrcRev = Math.max(...revBySource.map(([, v]) => v), 1);

  // Product search + sort + pagination
  const prodFiltered = useMemo(() => {
    const q = prodSearch.trim().toLowerCase();
    const base = q ? productPerf.filter(p => p.name.toLowerCase().includes(q)) : productPerf;
    const sorted = [...base];
    if (prodSortBy === 'units') sorted.sort((a, b) => b.units - a.units);
    else if (prodSortBy === 'name') sorted.sort((a, b) => a.name.localeCompare(b.name));
    else sorted.sort((a, b) => b.revenue - a.revenue);
    return sorted;
  }, [productPerf, prodSearch, prodSortBy]);
  const prodTotalPages = Math.max(1, Math.ceil(prodFiltered.length / prodPageSize));
  const prodPaginated = useMemo(() => {
    const start = (prodPage - 1) * prodPageSize;
    return prodFiltered.slice(start, start + prodPageSize);
  }, [prodFiltered, prodPage]);

  // Reset page when search or sort changes
  useEffect(() => { setProdPage(1); }, [prodSearch, prodSortBy]);

  // Top 10 chart data (by revenue)
  const topProducts = useMemo(() => productPerf.slice(0, 10), [productPerf]);
  const maxProdRev = Math.max(...topProducts.map(p => p.revenue), 1);

  // ==================================================
  // #2 PRODUCT ENQUIRY REPORT — leads by requirement (product interest)
  // ==================================================
  const productEnquiry = useMemo(() => {
    if (tab !== 'product-enquiry') return [];
    const inRangeLeads = filteredLeadsAtSource.filter(l => l.createdAt && inRange(new Date(l.createdAt).toISOString()));
    const map = {};
    inRangeLeads.forEach(l => {
      const prod = l.requirement || l.productCat || 'Not Specified';
      if (!map[prod]) map[prod] = { product: prod, enquiries: 0, won: 0, lost: 0, open: 0, sources: {} };
      map[prod].enquiries += 1;
      if (l.stage === wonStage) map[prod].won += 1;
      else if (l.stage === lostStage) map[prod].lost += 1;
      else map[prod].open += 1;
      const src = l.source || 'Unknown';
      map[prod].sources[src] = (map[prod].sources[src] || 0) + 1;
    });
    return Object.values(map).map(p => ({
      ...p,
      conversionRate: p.enquiries > 0 ? Math.round((p.won / p.enquiries) * 100) : 0,
      topSource: Object.entries(p.sources).sort((a, b) => b[1] - a[1])[0]?.[0] || '-',
    })).sort((a, b) => b.enquiries - a.enquiries);
  }, [tab, filteredLeadsAtSource, fromDate, toDate, wonStage, lostStage]);

  // ==================================================
  // #2b LEADS BY SOURCE — leads grouped by source (date-filtered)
  // ==================================================
  const leadSource = useMemo(() => {
    if (tab !== 'lead-source') return [];
    const inRangeLeads = filteredLeadsAtSource.filter(l => l.createdAt && inRange(new Date(l.createdAt).toISOString()));
    const map = {};
    inRangeLeads.forEach(l => {
      const src = l.source || 'Unknown';
      if (!map[src]) map[src] = { source: src, enquiries: 0, won: 0, lost: 0, open: 0, requirements: {} };
      map[src].enquiries += 1;
      if (l.stage === wonStage) map[src].won += 1;
      else if (l.stage === lostStage) map[src].lost += 1;
      else map[src].open += 1;
      const req = l.requirement || l.productCat || 'Not Specified';
      map[src].requirements[req] = (map[src].requirements[req] || 0) + 1;
    });
    return Object.values(map).map(s => ({
      ...s,
      conversionRate: s.enquiries > 0 ? Math.round((s.won / s.enquiries) * 100) : 0,
      topRequirement: Object.entries(s.requirements).sort((a, b) => b[1] - a[1])[0]?.[0] || '-',
    })).sort((a, b) => b.enquiries - a.enquiries);
  }, [tab, filteredLeadsAtSource, fromDate, toDate, wonStage, lostStage]);

  // ==================================================
  // #3 CUSTOMER PURCHASE REPORT — from paid invoice items, grouped by product
  // ==================================================
  const customerPurchase = useMemo(() => {
    if (tab !== 'customer-purchase') return { byProduct: [], byCustomer: [], totalCustomers: 0 };
    const byProd = {};
    const byCust = {};
    filteredInv.forEach(inv => {
      const paidAmt = getInvPaidAmt(inv);
      if (paidAmt <= 0) return;
      const items = Array.isArray(inv.items) ? inv.items : (inv.items ? JSON.parse(inv.items) : []);
      const clientKey = inv.client || 'Unknown';
      items.forEach(item => {
        const pName = item.product || item.description || 'Unknown';
        if (!byProd[pName]) byProd[pName] = { product: pName, uniqueCustomers: new Set(), units: 0, revenue: 0, orders: 0 };
        byProd[pName].uniqueCustomers.add(clientKey);
        byProd[pName].units += (item.qty || 0);
        byProd[pName].revenue += (item.qty || 0) * (item.rate || 0);
        byProd[pName].orders += 1;
      });
      if (!byCust[clientKey]) byCust[clientKey] = { customer: clientKey, orders: 0, revenue: 0, products: new Set() };
      byCust[clientKey].orders += 1;
      byCust[clientKey].revenue += paidAmt;
      items.forEach(item => byCust[clientKey].products.add(item.product || item.description || 'Unknown'));
    });
    const byProduct = Object.values(byProd).map(p => ({
      product: p.product,
      uniqueCustomers: p.uniqueCustomers.size,
      units: p.units,
      revenue: p.revenue,
      orders: p.orders,
      avgOrderValue: p.orders > 0 ? p.revenue / p.orders : 0,
      repeatRate: p.uniqueCustomers.size > 0 ? Math.round(((p.orders - p.uniqueCustomers.size) / p.orders) * 100) : 0,
    })).sort((a, b) => b.revenue - a.revenue);
    const byCustomer = Object.values(byCust).map(c => ({
      customer: c.customer, orders: c.orders, revenue: c.revenue, productCount: c.products.size,
    })).sort((a, b) => b.revenue - a.revenue);
    return { byProduct, byCustomer, totalCustomers: byCustomer.length };
  }, [tab, filteredInv]);

  // ==================================================
  // #4 STAGE TRANSITIONS REPORT — from activityLogs with action='stage-change'
  // ==================================================
  const stageTransitions = useMemo(() => {
    if (tab !== 'stage-transitions') return { matrix: {}, fromStages: [], toStages: [], total: 0, avgTime: {} };
    const fromMs = new Date(fromDate).getTime();
    const toMs = new Date(toDate + 'T23:59:59').getTime();
    const matrix = {}; // matrix[fromStage][toStage] = count
    const fromSet = new Set();
    const toSet = new Set();
    let total = 0;
    stageLogs.forEach(log => {
      if (log.createdAt < fromMs || log.createdAt > toMs) return;
      let from = null, to = null;
      // Prefer structured fields
      if (log.action === 'stage-change' && log.fromStage && log.toStage) {
        from = log.fromStage;
        to = log.toStage;
      } else if (log.text) {
        // Backward compat: parse text like: Stage changed from "X" to "Y"
        const m = log.text.match(/Stage changed from "([^"]+)" to "([^"]+)"/i);
        if (m) { from = m[1]; to = m[2]; }
      }
      if (!from || !to) return;
      if (!matrix[from]) matrix[from] = {};
      matrix[from][to] = (matrix[from][to] || 0) + 1;
      fromSet.add(from);
      toSet.add(to);
      total += 1;
    });
    const fromStages = [...fromSet].sort();
    const toStages = [...toSet].sort();
    return { matrix, fromStages, toStages, total };
  }, [tab, stageLogs, fromDate, toDate]);

  // Expense Report aggregates (category breakdown + month trend + status totals)
  const expenseReport = useMemo(() => {
    if (tab !== 'expenses') return null;
    const all = filteredExpByCat;
    const byStatus = { Approved: 0, Pending: 0, Rejected: 0 };
    all.forEach(e => { byStatus[e.status] = (byStatus[e.status] || 0) + (e.amount || 0); });
    const totalApproved = byStatus.Approved || 0;
    const totalPending = byStatus.Pending || 0;
    const totalRejected = byStatus.Rejected || 0;
    const grandTotal = totalApproved + totalPending + totalRejected;
    const approvedCount = all.filter(e => e.status === 'Approved').length;
    const avgPerExpense = approvedCount > 0 ? totalApproved / approvedCount : 0;

    // Category breakdown (Approved only — Approved is what hit the books)
    const byCat = {};
    all.filter(e => e.status === 'Approved').forEach(e => {
      const k = e.category || 'Uncategorised';
      if (!byCat[k]) byCat[k] = { amount: 0, count: 0 };
      byCat[k].amount += (e.amount || 0);
      byCat[k].count += 1;
    });
    const byCategory = Object.entries(byCat)
      .map(([category, v]) => ({
        category,
        amount: v.amount,
        count: v.count,
        share: totalApproved > 0 ? Math.round((v.amount / totalApproved) * 1000) / 10 : 0,
      }))
      .sort((a, b) => b.amount - a.amount);
    const maxCatAmount = byCategory.reduce((m, c) => Math.max(m, c.amount), 0);

    // Monthly trend
    const months = {};
    all.filter(e => e.status === 'Approved').forEach(e => {
      const d = new Date(e.date);
      const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      months[k] = (months[k] || 0) + (e.amount || 0);
    });
    const monthly = Object.entries(months).sort((a, b) => a[0].localeCompare(b[0]));

    // Detail rows sorted newest first
    const detail = [...all].sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    return {
      totalApproved, totalPending, totalRejected, grandTotal,
      approvedCount, avgPerExpense,
      byCategory, maxCatAmount,
      monthly,
      detail,
    };
  }, [tab, filteredExpByCat]);

  // Monthly GST Breakdown
  const gstBreakdown = useMemo(() => {
    const months = {};
    filteredInv.forEach(inv => {
      const paidAmt = getInvPaidAmt(inv);
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
        const paidAmt = getInvPaidAmt(inv);
        const commTotal = commissions.filter(c => c.invoiceId === inv.id && c.status === 'Paid').reduce((s, c) => s + (c.amount || 0), 0);
        return { ...inv, paidAmt, commTotal };
      }).filter(inv => inv.paidAmt > 0);
      exportCSV(['Invoice No', 'Client', 'Date', 'Status', 'Paid Amount', 'Commission Paid'], plData.map(inv => [inv.no, inv.client, fmtD(inv.date), inv.status, inv.paidAmt, inv.commTotal]), `PL_Report_${fromDate}_to_${toDate}`);
    } else if (tab === 'gst') {
      const gstDetails = filteredInv.map(inv => {
        const paidAmt = getInvPaidAmt(inv);
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
    } else if (tab === 'products') {
      exportCSV(['Product', 'Units Sold', 'Revenue', 'GST Collected', 'Total (with Tax)'], prodFiltered.map(p => [p.name, p.units, p.revenue, p.totalTax, p.revenue + p.totalTax]), `Product_Performance_${fromDate}_to_${toDate}`);
    } else if (tab === 'product-enquiry') {
      exportCSV(['Product', 'Enquiries', 'Won', 'Lost', 'Open', 'Conversion %', 'Top Source'], productEnquiry.map(p => [p.product, p.enquiries, p.won, p.lost, p.open, p.conversionRate + '%', p.topSource]), `Product_Enquiries_${fromDate}_to_${toDate}`);
    } else if (tab === 'lead-source') {
      exportCSV(['Source', 'Enquiries', 'Won', 'Lost', 'Open', 'Conversion %', 'Top Requirement'], leadSource.map(s => [s.source, s.enquiries, s.won, s.lost, s.open, s.conversionRate + '%', s.topRequirement]), `Leads_By_Source_${fromDate}_to_${toDate}`);
    } else if (tab === 'customer-purchase') {
      const rows = [
        ['--- By Product ---'],
        ['Product', 'Unique Customers', 'Orders', 'Units', 'Revenue', 'Avg Order Value', 'Repeat Rate %'],
        ...customerPurchase.byProduct.map(p => [p.product, p.uniqueCustomers, p.orders, p.units, p.revenue, Math.round(p.avgOrderValue), p.repeatRate + '%']),
        [''],
        ['--- By Customer ---'],
        ['Customer', 'Orders', 'Products Bought', 'Total Revenue'],
        ...customerPurchase.byCustomer.map(c => [c.customer, c.orders, c.productCount, c.revenue]),
      ];
      exportCSV(rows[0], rows.slice(1), `Customer_Purchases_${fromDate}_to_${toDate}`);
    } else if (tab === 'stage-transitions') {
      const headers = ['From Stage', ...stageTransitions.toStages, 'Total Out'];
      const rows = stageTransitions.fromStages.map(fs => {
        const row = [fs];
        let tot = 0;
        stageTransitions.toStages.forEach(ts => {
          const v = stageTransitions.matrix[fs]?.[ts] || 0;
          row.push(v); tot += v;
        });
        row.push(tot);
        return row;
      });
      exportCSV(headers, rows, `Stage_Transitions_${fromDate}_to_${toDate}`);
    } else if (tab === 'leads') {
      exportCSV(['Stage', 'Count'], stageCount.map(s => [s.stage, s.count]), `Lead_Pipeline_${fromDate}_to_${toDate}`);
    } else if (tab === 'expenses' && expenseReport) {
      const rows = [
        ['--- Category Breakdown (Approved only) ---'],
        ['Category', 'Count', 'Amount', 'Share %'],
        ...expenseReport.byCategory.map(c => [c.category, c.count, c.amount, c.share + '%']),
        [''],
        ['--- Monthly Trend (Approved) ---'],
        ['Month', 'Amount'],
        ...expenseReport.monthly.map(([m, v]) => [m, v]),
        [''],
        ['--- Detailed Expenses ---'],
        ['Date', 'Category', 'Description', 'Status', 'Amount', 'Notes'],
        ...expenseReport.detail.map(e => [fmtD(e.date), e.category || '', e.desc || '', e.status || '', e.amount || 0, e.notes || '']),
      ];
      exportCSV(rows[0], rows.slice(1), `Expense_Report_${fromDate}_to_${toDate}`);
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
            ['expenses', 'Expense Report'],
            ['gst', 'GST Summary'],
            ['product-enquiry', 'Leads by Requirement'],
            ['lead-source', 'Leads by Source'],
            ['customer-purchase', 'Customer Purchases'],
            ['stage-transitions', 'Stage Transitions'],
            ['leads', 'Lead Pipeline'],
            ['funnel', 'Sales Funnel'],
            ['rev-src', 'Revenue by Source'],
            ['products', 'Product Performance']
          ].map(([t, l]) => (
            <div key={t} className={`tab${tab === t ? ' active' : ''}`} onClick={() => setTab(t)} style={{ padding: '10px 16px', borderRadius: 8, width: '100%', textAlign: 'left' }}>{l}</div>
          ))}
        </div>

        <div style={{ flex: 1, minWidth: 0, position: 'relative', minHeight: reportLoading ? 360 : undefined }}>
          {reportLoading && (
            <div className="no-print" style={{ position: 'absolute', inset: 0, background: 'rgba(255,255,255,0.82)', backdropFilter: 'blur(1px)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 14, zIndex: 30, borderRadius: 16 }}>
              <div className="spinner" style={{ width: 40, height: 40, borderColor: 'var(--accent)', borderTopColor: 'transparent' }} />
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text)' }}>Loading report…</div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>Crunching the numbers, please wait</div>
            </div>
          )}
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
                      const paidAmt = getInvPaidAmt(inv);
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

      {tab === 'expenses' && expenseReport && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {/* Category filter — options from profile.expCats (user-configured) */}
          {expCats.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', background: '#fff', padding: '12px 16px', borderRadius: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)' }}>Filter by Category:</span>
              <select
                value={catFilter}
                onChange={e => setCatFilter(e.target.value)}
                style={{ padding: '6px 10px', border: '1.5px solid var(--border)', borderRadius: 7, fontSize: 12, fontFamily: 'inherit', minWidth: 160 }}
              >
                <option value="">All Categories</option>
                {expCats.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              {catFilter && (
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => setCatFilter('')}
                  style={{ fontSize: 12 }}
                >✕ Clear</button>
              )}
              {catFilter && (
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                  Showing {filteredExpByCat.length} of {filteredExp.length} entries
                </span>
              )}
            </div>
          )}

          {/* KPI cards */}
          <div className="stat-grid">
            <div className="stat-card sc-green"><div className="lbl">Approved</div><div className="val" style={{ fontSize: 'clamp(16px, 1.5vw, 20px)' }}>{fmt(expenseReport.totalApproved)}</div></div>
            <div className="stat-card sc-yellow"><div className="lbl">Pending</div><div className="val" style={{ fontSize: 'clamp(16px, 1.5vw, 20px)' }}>{fmt(expenseReport.totalPending)}</div></div>
            <div className="stat-card sc-red"><div className="lbl">Rejected</div><div className="val" style={{ fontSize: 'clamp(16px, 1.5vw, 20px)' }}>{fmt(expenseReport.totalRejected)}</div></div>
            <div className="stat-card sc-blue"><div className="lbl">Approved Count</div><div className="val" style={{ fontSize: 'clamp(16px, 1.5vw, 20px)' }}>{expenseReport.approvedCount}</div></div>
            <div className="stat-card sc-purple"><div className="lbl">Avg / Expense</div><div className="val" style={{ fontSize: 'clamp(16px, 1.5vw, 20px)' }}>{fmt(expenseReport.avgPerExpense)}</div></div>
          </div>

          {/* Category breakdown */}
          <div className="tw">
            <div className="tw-head"><h3>Category Breakdown (Approved)</h3></div>
            {expenseReport.byCategory.length === 0 ? (
              <div style={{ padding: 30, textAlign: 'center', color: 'var(--muted)' }}>No approved expenses in this period.</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: '#fafafa', borderBottom: '1px solid #f0f0f0' }}>
                      <th style={{ padding: '10px 14px', textAlign: 'left', fontSize: 12, fontWeight: 600 }}>Category</th>
                      <th style={{ padding: '10px 14px', textAlign: 'center', fontSize: 12, fontWeight: 600 }}>Entries</th>
                      <th style={{ padding: '10px 14px', textAlign: 'right', fontSize: 12, fontWeight: 600 }}>Amount</th>
                      <th style={{ padding: '10px 14px', textAlign: 'left', fontSize: 12, fontWeight: 600, minWidth: 200 }}>Share</th>
                    </tr>
                  </thead>
                  <tbody>
                    {expenseReport.byCategory.map(c => (
                      <tr key={c.category} style={{ borderBottom: '1px solid #f4f4f4' }}>
                        <td style={{ padding: '10px 14px', fontWeight: 600 }}>{c.category}</td>
                        <td style={{ padding: '10px 14px', textAlign: 'center', color: 'var(--muted)' }}>{c.count}</td>
                        <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700 }}>{fmt(c.amount)}</td>
                        <td style={{ padding: '10px 14px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <div style={{ flex: 1, height: 8, background: '#f1f5f9', borderRadius: 6, overflow: 'hidden' }}>
                              <div style={{ width: `${expenseReport.maxCatAmount ? (c.amount / expenseReport.maxCatAmount) * 100 : 0}%`, height: '100%', background: '#7c3aed', borderRadius: 6 }} />
                            </div>
                            <span style={{ fontSize: 12, color: 'var(--muted)', minWidth: 45, textAlign: 'right' }}>{c.share}%</span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Monthly trend */}
          {expenseReport.monthly.length > 0 && (
            <div className="tw">
              <div className="tw-head"><h3>Monthly Trend (Approved)</h3></div>
              <div style={{ padding: '24px 20px 0', paddingTop: 36, display: 'flex', alignItems: 'flex-end', gap: 12, height: 200, overflowX: 'auto', overflowY: 'visible' }}>
                {(() => {
                  const maxM = expenseReport.monthly.reduce((m, [, v]) => Math.max(m, v), 0);
                  return expenseReport.monthly.map(([m, v]) => (
                    <div key={m} style={{ minWidth: 48, flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                      <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 4 }}>{fmt(v)}</div>
                      <div style={{ width: 28, height: `${maxM ? (v / maxM) * 130 : 4}px`, background: '#7c3aed', borderRadius: '6px 6px 0 0', minHeight: 4 }} />
                      <div style={{ fontSize: 11, fontWeight: 600, marginTop: 6 }}>{m}</div>
                    </div>
                  ));
                })()}
              </div>
            </div>
          )}

          {/* Detailed list */}
          <div className="tw">
            <div className="tw-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3>Detailed Expenses</h3>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>{expenseReport.detail.length} entries</span>
            </div>
            {expenseReport.detail.length === 0 ? (
              <div style={{ padding: 30, textAlign: 'center', color: 'var(--muted)' }}>No expenses in this period.</div>
            ) : (
              <div style={{ overflowX: 'auto', maxHeight: 500, overflowY: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: '#fafafa', borderBottom: '1px solid #f0f0f0', position: 'sticky', top: 0, zIndex: 1 }}>
                      <th style={{ padding: '10px 14px', textAlign: 'left', fontSize: 12, fontWeight: 600 }}>Date</th>
                      <th style={{ padding: '10px 14px', textAlign: 'left', fontSize: 12, fontWeight: 600 }}>Category</th>
                      <th style={{ padding: '10px 14px', textAlign: 'left', fontSize: 12, fontWeight: 600 }}>Description</th>
                      <th style={{ padding: '10px 14px', textAlign: 'left', fontSize: 12, fontWeight: 600 }}>Status</th>
                      <th style={{ padding: '10px 14px', textAlign: 'right', fontSize: 12, fontWeight: 600 }}>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {expenseReport.detail.map(e => (
                      <tr key={e.id} style={{ borderBottom: '1px solid #f4f4f4' }}>
                        <td style={{ padding: '10px 14px', fontSize: 13, whiteSpace: 'nowrap' }}>{fmtD(e.date)}</td>
                        <td style={{ padding: '10px 14px' }}><span className="badge bg-gray" style={{ fontSize: 11 }}>{e.category || '—'}</span></td>
                        <td style={{ padding: '10px 14px', fontSize: 13 }}>{e.desc || '—'}{e.notes && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{e.notes}</div>}</td>
                        <td style={{ padding: '10px 14px' }}>
                          <span className={`badge ${e.status === 'Approved' ? 'bg-green' : e.status === 'Rejected' ? 'bg-red' : 'bg-yellow'}`} style={{ fontSize: 11 }}>{e.status}</span>
                        </td>
                        <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700, whiteSpace: 'nowrap' }}>{fmt(e.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ background: '#fafafa', borderTop: '2px solid #e2e8f0' }}>
                      <td colSpan={4} style={{ padding: '12px 14px', fontWeight: 700, textAlign: 'right' }}>Approved Total</td>
                      <td style={{ padding: '12px 14px', textAlign: 'right', fontWeight: 800, color: '#16a34a' }}>{fmt(expenseReport.totalApproved)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
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
                        const paidAmt = getInvPaidAmt(inv);
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
              <div className="stat-card"><div className="lbl">Total Leads</div><div className="val">{pipelineLeads.length}</div></div>
              <div className="stat-card sc-green"><div className="lbl">Won</div><div className="val">{pipelineLeads.filter(l => l.stage === wonStage).length}</div></div>
              <div className="stat-card sc-red"><div className="lbl">Lost</div><div className="val">{pipelineLeads.filter(l => l.stage === lostStage).length}</div></div>
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

      {tab === 'product-enquiry' && (() => {
        const maxEnq = Math.max(...productEnquiry.map(p => p.enquiries), 1);
        const totalEnq = productEnquiry.reduce((s, p) => s + p.enquiries, 0);
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div className="stat-grid">
              <div className="stat-card sc-blue"><div className="lbl">Total Enquiries</div><div className="val">{totalEnq}</div></div>
              <div className="stat-card sc-green"><div className="lbl">Unique Requirements</div><div className="val">{productEnquiry.length}</div></div>
              <div className="stat-card" style={{ background: '#fff7ed' }}>
                <div className="lbl" style={{ color: '#c2410c' }}>Top Requirement</div>
                <div className="val" style={{ color: '#c2410c', fontSize: 'clamp(12px, 1.2vw, 16px)', wordBreak: 'break-word', lineHeight: '1.2' }}>{productEnquiry[0]?.product || '-'}</div>
              </div>
            </div>

            {productEnquiry.slice(0, 10).length > 0 && (
              <div className="tw">
                <div className="tw-head"><h3>Top 10 Requirements</h3></div>
                <div style={{ padding: '16px 20px' }}>
                  {productEnquiry.slice(0, 10).map((p, i) => (
                    <div key={p.product} className="chart-row" style={{ marginBottom: 10 }}>
                      <div className="chart-label" style={{ width: 180, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={p.product}>{i + 1}. {p.product}</div>
                      <div className="chart-bar-wrap" style={{ height: 14 }}>
                        <div className="chart-bar" style={{ width: `${(p.enquiries / maxEnq) * 100}%`, background: CHART_COLORS[i % CHART_COLORS.length] }} />
                      </div>
                      <div style={{ width: 180, fontSize: 12, marginLeft: 10, fontWeight: 700, textAlign: 'right' }}>
                        {p.enquiries} leads <span style={{ color: p.conversionRate >= 30 ? '#16a34a' : 'var(--muted)', fontWeight: 600 }}>({p.conversionRate}% won)</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="tw">
              <div className="tw-head"><h3>All Requirements ({productEnquiry.length})</h3></div>
              <div className="tw-scroll">
                <table>
                  <thead><tr><th>#</th><th>Product / Requirement</th><th style={{ textAlign: 'right' }}>Enquiries</th><th style={{ textAlign: 'right' }}>Won</th><th style={{ textAlign: 'right' }}>Lost</th><th style={{ textAlign: 'right' }}>Open</th><th style={{ textAlign: 'right' }}>Conv %</th><th>Top Source</th></tr></thead>
                  <tbody>
                    {productEnquiry.length === 0 ? <tr><td colSpan={8} style={{ textAlign: 'center', padding: 28, color: 'var(--muted)' }}>No lead enquiries in this period</td></tr>
                      : productEnquiry.map((p, i) => (
                        <tr key={p.product}>
                          <td style={{ color: 'var(--muted)', fontSize: 12 }}>{i + 1}</td>
                          <td><strong>{p.product}</strong></td>
                          <td style={{ textAlign: 'right', fontWeight: 700 }}>{p.enquiries}</td>
                          <td style={{ textAlign: 'right', color: '#16a34a' }}>{p.won}</td>
                          <td style={{ textAlign: 'right', color: '#dc2626' }}>{p.lost}</td>
                          <td style={{ textAlign: 'right', color: 'var(--muted)' }}>{p.open}</td>
                          <td style={{ textAlign: 'right', fontWeight: 700, color: p.conversionRate >= 30 ? '#16a34a' : p.conversionRate >= 10 ? '#ca8a04' : '#dc2626' }}>{p.conversionRate}%</td>
                          <td style={{ fontSize: 12 }}>{p.topSource}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        );
      })()}

      {tab === 'lead-source' && (() => {
        const maxEnq = Math.max(...leadSource.map(s => s.enquiries), 1);
        const totalEnq = leadSource.reduce((s, x) => s + x.enquiries, 0);
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div className="stat-grid">
              <div className="stat-card sc-blue"><div className="lbl">Total Leads</div><div className="val">{totalEnq}</div></div>
              <div className="stat-card sc-green"><div className="lbl">Unique Sources</div><div className="val">{leadSource.length}</div></div>
              <div className="stat-card" style={{ background: '#fff7ed' }}>
                <div className="lbl" style={{ color: '#c2410c' }}>Top Source</div>
                <div className="val" style={{ color: '#c2410c', fontSize: 'clamp(12px, 1.2vw, 16px)', wordBreak: 'break-word', lineHeight: '1.2' }}>{leadSource[0]?.source || '-'}</div>
              </div>
            </div>

            {leadSource.slice(0, 10).length > 0 && (
              <div className="tw">
                <div className="tw-head"><h3>Top 10 Sources</h3></div>
                <div style={{ padding: '16px 20px' }}>
                  {leadSource.slice(0, 10).map((s, i) => (
                    <div key={s.source} className="chart-row" style={{ marginBottom: 10 }}>
                      <div className="chart-label" style={{ width: 180, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={s.source}>{i + 1}. {s.source}</div>
                      <div className="chart-bar-wrap" style={{ height: 14 }}>
                        <div className="chart-bar" style={{ width: `${(s.enquiries / maxEnq) * 100}%`, background: CHART_COLORS[i % CHART_COLORS.length] }} />
                      </div>
                      <div style={{ width: 180, fontSize: 12, marginLeft: 10, fontWeight: 700, textAlign: 'right' }}>
                        {s.enquiries} leads <span style={{ color: s.conversionRate >= 30 ? '#16a34a' : 'var(--muted)', fontWeight: 600 }}>({s.conversionRate}% won)</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="tw">
              <div className="tw-head"><h3>All Sources ({leadSource.length})</h3></div>
              <div className="tw-scroll">
                <table>
                  <thead><tr><th>#</th><th>Source</th><th style={{ textAlign: 'right' }}>Leads</th><th style={{ textAlign: 'right' }}>Won</th><th style={{ textAlign: 'right' }}>Lost</th><th style={{ textAlign: 'right' }}>Open</th><th style={{ textAlign: 'right' }}>Conv %</th><th>Top Requirement</th></tr></thead>
                  <tbody>
                    {leadSource.length === 0 ? <tr><td colSpan={8} style={{ textAlign: 'center', padding: 28, color: 'var(--muted)' }}>No leads in this period</td></tr>
                      : leadSource.map((s, i) => (
                        <tr key={s.source}>
                          <td style={{ color: 'var(--muted)', fontSize: 12 }}>{i + 1}</td>
                          <td><strong>{s.source}</strong></td>
                          <td style={{ textAlign: 'right', fontWeight: 700 }}>{s.enquiries}</td>
                          <td style={{ textAlign: 'right', color: '#16a34a' }}>{s.won}</td>
                          <td style={{ textAlign: 'right', color: '#dc2626' }}>{s.lost}</td>
                          <td style={{ textAlign: 'right', color: 'var(--muted)' }}>{s.open}</td>
                          <td style={{ textAlign: 'right', fontWeight: 700, color: s.conversionRate >= 30 ? '#16a34a' : s.conversionRate >= 10 ? '#ca8a04' : '#dc2626' }}>{s.conversionRate}%</td>
                          <td style={{ fontSize: 12 }}>{s.topRequirement}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        );
      })()}

      {tab === 'customer-purchase' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div className="stat-grid">
            <div className="stat-card sc-blue"><div className="lbl">Unique Buyers</div><div className="val">{customerPurchase.totalCustomers}</div></div>
            <div className="stat-card sc-green"><div className="lbl">Products Sold</div><div className="val">{customerPurchase.byProduct.length}</div></div>
            <div className="stat-card sc-green"><div className="lbl">Total Revenue</div><div className="val" style={{ fontSize: 'clamp(16px, 1.5vw, 20px)', lineHeight: '1.2' }}>{fmt(customerPurchase.byCustomer.reduce((s, c) => s + c.revenue, 0))}</div></div>
          </div>

          <div className="tw">
            <div className="tw-head"><h3>Purchases by Product</h3></div>
            <div className="tw-scroll">
              <table>
                <thead><tr><th>Product</th><th style={{ textAlign: 'right' }}>Unique Customers</th><th style={{ textAlign: 'right' }}>Orders</th><th style={{ textAlign: 'right' }}>Units</th><th style={{ textAlign: 'right' }}>Revenue</th><th style={{ textAlign: 'right' }}>Avg Order</th><th style={{ textAlign: 'right' }}>Repeat %</th></tr></thead>
                <tbody>
                  {customerPurchase.byProduct.length === 0 ? <tr><td colSpan={7} style={{ textAlign: 'center', padding: 28, color: 'var(--muted)' }}>No paid invoices in this period</td></tr>
                    : customerPurchase.byProduct.map(p => (
                      <tr key={p.product}>
                        <td><strong>{p.product}</strong></td>
                        <td style={{ textAlign: 'right', fontWeight: 700 }}>{p.uniqueCustomers}</td>
                        <td style={{ textAlign: 'right' }}>{p.orders}</td>
                        <td style={{ textAlign: 'right' }}>{p.units}</td>
                        <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmt(p.revenue)}</td>
                        <td style={{ textAlign: 'right', color: 'var(--muted)' }}>{fmt(Math.round(p.avgOrderValue))}</td>
                        <td style={{ textAlign: 'right', color: p.repeatRate > 0 ? '#16a34a' : 'var(--muted)' }}>{p.repeatRate}%</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="tw">
            <div className="tw-head"><h3>Top Customers by Revenue</h3></div>
            <div className="tw-scroll">
              <table>
                <thead><tr><th>#</th><th>Customer</th><th style={{ textAlign: 'right' }}>Orders</th><th style={{ textAlign: 'right' }}>Products Bought</th><th style={{ textAlign: 'right' }}>Total Revenue</th></tr></thead>
                <tbody>
                  {customerPurchase.byCustomer.length === 0 ? <tr><td colSpan={5} style={{ textAlign: 'center', padding: 28, color: 'var(--muted)' }}>No customers found</td></tr>
                    : customerPurchase.byCustomer.slice(0, 50).map((c, i) => (
                      <tr key={c.customer}>
                        <td style={{ color: 'var(--muted)', fontSize: 12 }}>{i + 1}</td>
                        <td><strong>{c.customer}</strong></td>
                        <td style={{ textAlign: 'right' }}>{c.orders}</td>
                        <td style={{ textAlign: 'right' }}>{c.productCount}</td>
                        <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmt(c.revenue)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {tab === 'stage-transitions' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div className="stat-grid">
            <div className="stat-card sc-blue"><div className="lbl">Total Transitions</div><div className="val">{stageTransitions.total}</div></div>
            <div className="stat-card sc-green"><div className="lbl">Unique Stages (From)</div><div className="val">{stageTransitions.fromStages.length}</div></div>
            <div className="stat-card sc-purple"><div className="lbl">Unique Stages (To)</div><div className="val">{stageTransitions.toStages.length}</div></div>
          </div>

          <div className="tw">
            <div className="tw-head"><h3>Stage Transition Matrix (From → To)</h3></div>
            <div style={{ padding: '12px 16px 4px', fontSize: 11, color: 'var(--muted)' }}>
              Rows = From Stage · Columns = To Stage · Cell = # of leads that moved
            </div>
            <div className="tw-scroll">
              {stageTransitions.total === 0 ? (
                <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>
                  No stage transitions recorded in this period.<br />
                  <span style={{ fontSize: 11 }}>Tip: Stage changes made going forward will be captured automatically.</span>
                </div>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th style={{ background: '#f9fafb' }}>From \ To</th>
                      {stageTransitions.toStages.map(ts => <th key={ts} style={{ textAlign: 'right' }}>{ts}</th>)}
                      <th style={{ textAlign: 'right', background: '#f3f4f6' }}>Total Out</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stageTransitions.fromStages.map(fs => {
                      const rowTotal = stageTransitions.toStages.reduce((s, ts) => s + (stageTransitions.matrix[fs]?.[ts] || 0), 0);
                      const rowMax = Math.max(...stageTransitions.toStages.map(ts => stageTransitions.matrix[fs]?.[ts] || 0), 1);
                      return (
                        <tr key={fs}>
                          <td><strong>{fs}</strong></td>
                          {stageTransitions.toStages.map(ts => {
                            const v = stageTransitions.matrix[fs]?.[ts] || 0;
                            const intensity = v === 0 ? 0 : Math.max(0.15, v / rowMax);
                            return (
                              <td key={ts} style={{ textAlign: 'right', background: v > 0 ? `rgba(59, 130, 246, ${intensity * 0.3})` : 'transparent', fontWeight: v > 0 ? 700 : 400, color: v === 0 ? 'var(--muted)' : '#111' }}>
                                {v || '-'}
                              </td>
                            );
                          })}
                          <td style={{ textAlign: 'right', fontWeight: 700, background: '#f9fafb' }}>{rowTotal}</td>
                        </tr>
                      );
                    })}
                    <tr style={{ background: '#f9fafb' }}>
                      <td><strong>Total In</strong></td>
                      {stageTransitions.toStages.map(ts => {
                        const col = stageTransitions.fromStages.reduce((s, fs) => s + (stageTransitions.matrix[fs]?.[ts] || 0), 0);
                        return <td key={ts} style={{ textAlign: 'right', fontWeight: 700 }}>{col}</td>;
                      })}
                      <td style={{ textAlign: 'right', fontWeight: 700, background: '#e5e7eb' }}>{stageTransitions.total}</td>
                    </tr>
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {stageTransitions.total > 0 && (
            <div className="tw">
              <div className="tw-head"><h3>Top Transition Paths</h3></div>
              <div style={{ padding: '16px 20px' }}>
                {(() => {
                  const flat = [];
                  stageTransitions.fromStages.forEach(fs => {
                    stageTransitions.toStages.forEach(ts => {
                      const v = stageTransitions.matrix[fs]?.[ts] || 0;
                      if (v > 0) flat.push({ from: fs, to: ts, count: v });
                    });
                  });
                  flat.sort((a, b) => b.count - a.count);
                  const top = flat.slice(0, 10);
                  const maxV = Math.max(...top.map(t => t.count), 1);
                  return top.map((t, i) => (
                    <div key={i} className="chart-row" style={{ marginBottom: 10 }}>
                      <div className="chart-label" style={{ width: 280, fontSize: 12, overflow: 'hidden' }} title={`${t.from} → ${t.to}`}>
                        <span style={{ color: '#6b7280' }}>{t.from}</span> <span style={{ color: '#111', margin: '0 6px' }}>→</span> <strong>{t.to}</strong>
                      </div>
                      <div className="chart-bar-wrap" style={{ height: 14 }}>
                        <div className="chart-bar" style={{ width: `${(t.count / maxV) * 100}%`, background: CHART_COLORS[i % CHART_COLORS.length] }} />
                      </div>
                      <div style={{ width: 80, fontSize: 12, marginLeft: 10, fontWeight: 700, textAlign: 'right' }}>{t.count} leads</div>
                    </div>
                  ));
                })()}
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'products' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div className="stat-grid">
            <div className="stat-card sc-blue"><div className="lbl">Unique Products Sold</div><div className="val">{productPerf.length}</div></div>
            <div className="stat-card sc-green"><div className="lbl">Total Units Sold</div><div className="val">{productPerf.reduce((s, p) => s + p.units, 0)}</div></div>
            <div className="stat-card sc-green"><div className="lbl">Total Revenue</div><div className="val" style={{ fontSize: 'clamp(16px, 1.5vw, 20px)', lineHeight: '1.2' }}>{fmt(productPerf.reduce((s, p) => s + p.revenue, 0))}</div></div>
            <div className="stat-card sc-purple"><div className="lbl">GST Collected</div><div className="val" style={{ fontSize: 'clamp(16px, 1.5vw, 20px)', lineHeight: '1.2' }}>{fmt(productPerf.reduce((s, p) => s + p.totalTax, 0))}</div></div>
          </div>

          {topProducts.length > 0 && (
            <div className="tw">
              <div className="tw-head"><h3>Top 10 Products by Revenue</h3></div>
              <div style={{ padding: '16px 20px' }}>
                {topProducts.map((p, i) => (
                  <div key={p.name} className="chart-row" style={{ marginBottom: 10 }}>
                    <div className="chart-label" style={{ width: 180, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={p.name}>{i + 1}. {p.name}</div>
                    <div className="chart-bar-wrap" style={{ height: 14 }}>
                      <div className="chart-bar" style={{ width: `${(p.revenue / maxProdRev) * 100}%`, background: CHART_COLORS[i % CHART_COLORS.length] }} />
                    </div>
                    <div style={{ width: 180, fontSize: 12, marginLeft: 10, fontWeight: 700, textAlign: 'right' }}>
                      {fmt(p.revenue)} <span style={{ color: 'var(--muted)', fontWeight: 500 }}>({p.units} units)</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="tw">
            <div className="tw-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
              <h3>All Products {prodFiltered.length !== productPerf.length ? `(${prodFiltered.length} of ${productPerf.length})` : `(${productPerf.length})`}</h3>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  type="text"
                  placeholder="🔍 Search product..."
                  value={prodSearch}
                  onChange={e => setProdSearch(e.target.value)}
                  style={{ padding: '6px 10px', border: '1.5px solid var(--border)', borderRadius: 7, fontSize: 12, fontFamily: 'inherit', minWidth: 180 }}
                />
                <select value={prodSortBy} onChange={e => setProdSortBy(e.target.value)} style={{ padding: '6px 10px', border: '1.5px solid var(--border)', borderRadius: 7, fontSize: 12, fontFamily: 'inherit' }}>
                  <option value="revenue">Sort: Revenue</option>
                  <option value="units">Sort: Units</option>
                  <option value="name">Sort: Name</option>
                </select>
              </div>
            </div>
            <div className="tw-scroll">
              <table>
                <thead><tr><th>#</th><th>Product</th><th style={{ textAlign: 'right' }}>Units Sold</th><th style={{ textAlign: 'right' }}>Revenue</th><th style={{ textAlign: 'right' }}>GST</th><th style={{ textAlign: 'right' }}>With Tax</th></tr></thead>
                <tbody>
                  {prodFiltered.length === 0 ? <tr><td colSpan={6} style={{ textAlign: 'center', padding: 28, color: 'var(--muted)' }}>{prodSearch ? 'No products match your search' : 'No product sales in this period'}</td></tr>
                    : prodPaginated.map((p, i) => (
                      <tr key={p.name}>
                        <td style={{ color: 'var(--muted)', fontSize: 12 }}>{(prodPage - 1) * prodPageSize + i + 1}</td>
                        <td><strong>{p.name}</strong></td>
                        <td style={{ textAlign: 'right' }}>{p.units}</td>
                        <td style={{ textAlign: 'right', fontWeight: 700 }}>{fmt(p.revenue)}</td>
                        <td style={{ textAlign: 'right', color: '#16a34a' }}>{fmt(p.totalTax)}</td>
                        <td style={{ textAlign: 'right', fontWeight: 600 }}>{fmt(p.revenue + p.totalTax)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            {prodFiltered.length > prodPageSize && (
              <div style={{ padding: '12px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--border)', fontSize: 12 }}>
                <div style={{ color: 'var(--muted)' }}>Showing {(prodPage - 1) * prodPageSize + 1}-{Math.min(prodPage * prodPageSize, prodFiltered.length)} of {prodFiltered.length} products</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-secondary btn-sm" onClick={() => setProdPage(p => Math.max(1, p - 1))} disabled={prodPage === 1} style={{ opacity: prodPage === 1 ? 0.5 : 1 }}>← Prev</button>
                  <span style={{ padding: '4px 10px', background: 'var(--bg-soft)', borderRadius: 6, fontWeight: 600 }}>{prodPage} / {prodTotalPages}</span>
                  <button className="btn btn-secondary btn-sm" onClick={() => setProdPage(p => Math.min(prodTotalPages, p + 1))} disabled={prodPage === prodTotalPages} style={{ opacity: prodPage === prodTotalPages ? 0.5 : 1 }}>Next →</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

        </div>
      </div>
    </div>
  );
}
