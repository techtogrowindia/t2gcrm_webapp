import React, { useState, useEffect, useMemo, useRef } from 'react';
import db from '../../instant';
import { id } from '@instantdb/react';
import { useData } from '../../hooks/useData';
import { dbWrite, dbOp } from '../../utils/dbWrite';

const USE_PG_DATA = import.meta.env.VITE_USE_PG_DATA === 'true';
import { fmtD, fmt, stageBadgeClass, TAX_OPTIONS, INDIAN_STATES, COUNTRIES, getInvoiceStatus, SUPPORTED_CURRENCIES, currencySymbol, autoStagePatch } from '../../utils/helpers';
import DocumentTemplate from './DocumentTemplate';
import { useToast } from '../../context/ToastContext';
import SearchableSelect from '../UI/SearchableSelect';
import { EMPTY_CUSTOMER } from '../../utils/constants';
import { fireAutoNotifications } from '../../utils/messaging';
import { logActivity } from '../../utils/activityLogger';

function calcTotals(items, disc, discType, adj, delivery = 0, deliveryTaxRate = 0) {
  const its = Array.isArray(items) ? items : (items ? JSON.parse(items) : []);
  const sub = its.reduce((s, it) => s + (it.qty || 0) * (it.rate || 0), 0);
  const discAmt = discType === '₹' ? (parseFloat(disc) || 0) : (sub * (parseFloat(disc) || 0) / 100);
  // GST on the post-discount taxable value — discount apportioned across items
  // via this factor (keep in sync with computeDocTotals in utils/docTotals.js).
  const discountFactor = sub > 0 ? Math.max(0, (sub - discAmt) / sub) : 1;
  const taxTotal = its.reduce((s, it) => s + (it.qty || 0) * (it.rate || 0) * discountFactor * (it.taxRate || 0) / 100, 0);
  const deliveryAmt = parseFloat(delivery) || 0;
  const deliveryTax = deliveryAmt * (parseFloat(deliveryTaxRate) || 0) / 100;
  const total = Math.round(sub - discAmt + taxTotal + deliveryAmt + deliveryTax + (parseFloat(adj) || 0));
  return { sub, taxTotal, discAmt, deliveryAmt, deliveryTax, total };
}

const EMPTY = { no: '', client: '', dueDate: '', status: 'Draft', notes: '', terms: '', quoteFor: '', disc: 0, discType: '%', adj: 0, items: [{ name: '', desc: '', qty: 1, unit: 'Nos', rate: 0, taxRate: 0 }], isAmc: false, amcCycle: 'Yearly', amcStart: '', amcEnd: '', amcPlan: '', amcAmount: '', amcTaxRate: 0, shipTo: '', addShipping: false, payments: [], assign: '', distributorId: '', retailerId: '', currency: 'INR', deliveryCharge: 0, deliveryTaxRate: 0 };

export default function Invoices({ user, perms, ownerId, settings, planEnforcement }) {
  const canCreate = perms?.can('Invoices', 'create') === true;
  const canEdit = perms?.can('Invoices', 'edit') === true;
  const canDelete = perms?.can('Invoices', 'delete') === true;

  const [tab, setTab] = useState('all');
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState(false);
  const [editData, setEditData] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [printing, setPrinting] = useState(null);
  const [payModal, setPayModal] = useState(null);
  const [payAmt, setPayAmt] = useState('');
  const [colModal, setColModal] = useState(false);
  const [tempCols, setTempCols] = useState([]);
  const [custModal, setCustModal] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [newCustForm, setNewCustForm] = useState(EMPTY_CUSTOMER);
  const toast = useToast();

  const { data, isLoading, refetch } = useData({
    invoices: { $: { where: { userId: ownerId } } },
    products: { $: { where: { userId: ownerId } } },
    userProfiles: { $: { where: { userId: ownerId } } },
    teamMembers: { $: { where: { userId: ownerId } } },
    partnerApplications: { $: { where: { userId: ownerId } } },
    partnerCommissions: { $: { where: { userId: ownerId } } },
  }, ['invoices', 'products', 'userProfiles', 'teamMembers', 'partnerApplications', 'partnerCommissions']);
  const invoices = useMemo(() => {
    return data?.invoices || [];
  }, [data?.invoices]);

  const products = (data?.products || []).slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  const team = data?.teamMembers || [];

  // Customers loaded lazily when the form/print view opens — avoids a 10k-row
  // real-time subscription on every Invoices page open.
  const [modalCustomers, setModalCustomers] = useState([]);
  const custFetchRef = useRef(false);
  const fetchModalCustomers = async () => {
    if (custFetchRef.current) return;
    custFetchRef.current = true;
    try {
      if (USE_PG_DATA) {
        const token = localStorage.getItem('pg_auth_token');
        const res = await fetch('/api/data-pg', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ action: 'query', queries: { customers: {} } }),
        });
        const json = await res.json();
        setModalCustomers(json.data?.customers || []);
      } else {
        const result = await db.queryOnce({ customers: { $: { where: { userId: ownerId } } } });
        setModalCustomers(result.customers || []);
      }
    } catch(e) { custFetchRef.current = false; }
  };
  const customers = modalCustomers;
  // Fetch when any view that needs customer lookup opens: create/edit form,
  // print view, or the payment modal (payment_received WA notif needs the phone).
  useEffect(() => { if (modal || printing || payModal) fetchModalCustomers(); }, [!!modal, !!printing, !!payModal]);

  // NOTE: this initial fetch only preloads the first 500 leads (by the
  // server's default order) — production accounts have 11k+ leads, so a lead
  // outside that window won't be found by name OR phone until searchLeads()
  // (below) pulls it in from the server on demand.
  const [modalLeads, setModalLeads] = useState([]);
  const [leadsSearching, setLeadsSearching] = useState(false);
  const fetchModalLeads = async () => {
    if (modalLeads.length > 0) return; // already cached for this session
    try {
      const r = await fetch('/api/leads-page', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerId, mode: 'list', pageSize: 500, tab: 'all', page: 1, isOwner: true, teamCanSeeAllLeads: true, boundaries: {} }),
      });
      const json = await r.json();
      setModalLeads(json.items || []);
    } catch (e) { /* silent — dropdown will be empty but save still works */ }
  };
  // Server-side type-ahead: runs the SAME name/phone/company search leads-page
  // already applies (see api/leads-page.js), so typing a phone number or name
  // finds a match across ALL of the tenant's leads, not just the preloaded
  // first 500. Results are merged into modalLeads (deduped by id) so they
  // become selectable and stay available for the rest of the session.
  const searchLeads = async (query) => {
    const q = (query || '').trim();
    if (q.length < 2) return;
    setLeadsSearching(true);
    try {
      const r = await fetch('/api/leads-page', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerId, mode: 'list', pageSize: 50, tab: 'all', page: 1, isOwner: true, teamCanSeeAllLeads: true, search: q, boundaries: {} }),
      });
      const json = await r.json();
      const found = json.items || [];
      if (found.length > 0) {
        setModalLeads(prev => {
          const byId = new Map(prev.map(l => [l.id, l]));
          found.forEach(l => byId.set(l.id, l));
          return [...byId.values()];
        });
      }
    } catch (e) { /* silent — search just won't widen this time */ }
    finally { setLeadsSearching(false); }
  };
  const profile = data?.userProfiles?.[0] || {};
  const partnerApplications = data?.partnerApplications || [];
  // O(1) lookup index — avoids repeated .find() inside .map()
  const partnersById = useMemo(() => {
    const map = {};
    partnerApplications.forEach(p => { map[p.id] = p; });
    return map;
  }, [partnerApplications]);
  const partnerCommissions = data?.partnerCommissions || [];
  const wonStage = profile.wonStage || 'Won';
  const disabledStages = profile.disabledStages || [];
  // Stages the business switched off in Settings. The system must not move
  // leads into them automatically — see autoStagePatch in utils/helpers.

  const taxRates = profile.taxRates || TAX_OPTIONS;
  const customFields = profile.customFields || [];
  
  const ncf = (k) => (e) => setNewCustForm(p => ({ ...p, [k]: e.target.value }));
  const nccf = (k) => (e) => setNewCustForm(p => ({ ...p, custom: { ...(p.custom || {}), [k]: e.target.value } }));
  
  const clientOptions = useMemo(() => {
    const savedLeadStages = profile?.leadStages;
    const filteredLeads = modalLeads.filter(l => {
      const isVisible = !savedLeadStages || savedLeadStages.length === 0 || savedLeadStages.includes(l.stage);
      return isVisible && l.stage !== wonStage;
    });
    return [
      ...customers.map(c => ({ ...c, isLead: false, displayName: c.companyName ? `${c.companyName} (${c.name})` : c.name })),
      ...filteredLeads.map(l => ({ ...l, isLead: true, displayName: l.companyName ? `${l.companyName} (${l.name}) (Lead)` : `${l.name} (Lead)` }))
    ];
  }, [customers, modalLeads, profile?.leadStages, wonStage]);
  
  const allPossibleCols = ['Date', 'Due Date', 'Status', 'Paid Amount', 'Balance Due'];
  const savedCols = profile?.invoiceCols;
  const activeCols = savedCols || allPossibleCols;

  const filtered = React.useMemo(() => {
    return invoices.filter(inv => {
      const st = getInvoiceStatus(inv);
      return tab === 'all' || st === tab;
    }).filter(inv => {
        if (!search) return true;
        const s = search.toLowerCase();
        const st = getInvoiceStatus(inv);
        const items = Array.isArray(inv.items) ? inv.items : (inv.items ? JSON.parse(inv.items) : []);
        return [inv.no, inv.client, st, inv.notes, inv.terms].some(v => (v || '').toLowerCase().includes(s)) ||
               items.some(it => (it.name || '').toLowerCase().includes(s));
      })
      .sort((a, b) => (b.createdAt || new Date(b.date || 0).getTime()) - (a.createdAt || new Date(a.date || 0).getTime())); // newest first
  }, [invoices, tab, search]);

  const totalPages = pageSize === 'all' ? 1 : Math.ceil(filtered.length / pageSize);
  const paginated = React.useMemo(() => {
    if (pageSize === 'all') return filtered;
    const start = (currentPage - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, currentPage, pageSize]);

  React.useEffect(() => { setCurrentPage(1); }, [tab, search]);

  const tots = calcTotals(form.items, form.disc, form.discType, form.adj, form.deliveryCharge, form.deliveryTaxRate);
  const curSym = currencySymbol(form.currency || 'INR');

  const openCreate = () => {
    fetchModalLeads();
    setEditData(null);
    // Numbering from Settings > Financial: prefix + next sequence. The next
    // sequence is the higher of the configured Starting Number and (highest
    // existing invoice number + 1), so a fresh business honours its chosen
    // start and an existing one continues without collisions — regardless of
    // any past number format. (Previously this was hardcoded to
    // `INV/<year>/<count>` and ignored the settings entirely.)
    const iPrefix = profile?.iPrefix ?? 'INV-';
    const iStart = parseInt(profile?.iNextNum) || 1;
    const iMaxSeq = invoices.reduce((m, inv) => {
      const match = String(inv.no || '').match(/(\d+)\s*$/);
      return match ? Math.max(m, parseInt(match[1])) : m;
    }, 0);
    const nextNo = `${iPrefix}${String(Math.max(iStart, iMaxSeq + 1)).padStart(3, '0')}`;
    const defTax = profile?.defaultTaxRate || 0;
    
    // Default 14-day due date
    const d = new Date();
    d.setDate(d.getDate() + 14);
    const defDue = d.toISOString().split('T')[0];
    
    setForm({ ...EMPTY, no: nextNo, dueDate: defDue, terms: profile?.iTerms || '', notes: profile?.iNotes || '', currency: profile?.defaultCurrency || 'INR', items: [{ name: '', desc: '', qty: 1, unit: 'Nos', rate: 0, taxRate: defTax }] });
    setModal(true); 
  };
  const openEdit = (inv) => {
    fetchModalLeads();
    setEditData(inv);
    const normalizedItems = Array.isArray(inv.items) ? inv.items : (typeof inv.items === 'string' ? JSON.parse(inv.items) : []);
    const normalizedPayments = Array.isArray(inv.payments) ? inv.payments : (typeof inv.payments === 'string' ? JSON.parse(inv.payments) : []);
    
    setForm({ 
      no: inv.no || '', client: inv.client, dueDate: inv.dueDate || '', status: inv.status || 'Draft', 
      notes: inv.notes || '', terms: inv.terms || '', disc: inv.disc || 0, discType: inv.discType || '%', adj: inv.adj || 0, 
      items: normalizedItems.length ? normalizedItems : EMPTY.items,
      isAmc: !!inv.amcStart || !!inv.isAmc, 
      amcCycle: inv.amcCycle || 'Yearly', 
      amcStart: inv.amcStart || '', 
      amcEnd: inv.amcEnd || '', 
      amcPlan: inv.amcPlan || '', 
      amcAmount: inv.amcAmount || '', 
      amcTaxRate: inv.amcTaxRate || 0,
      shipTo: inv.shipTo || '', addShipping: !!inv.shipTo, payments: normalizedPayments,
      fromAmc: !!inv.fromAmc,
      currency: inv.currency || profile?.defaultCurrency || 'INR',
      deliveryCharge: inv.deliveryCharge || 0,
      deliveryTaxRate: inv.deliveryTaxRate || 0,
      addDelivery: !!(inv.deliveryCharge && inv.deliveryCharge > 0),
      assign: inv.assign || '',
      distributorId: inv.distributorId || '',
      retailerId: inv.retailerId || ''
    });
    setModal(true);
  };

  const handleAmcStartChange = (val) => {
    let endDate = form.amcEnd;
    if (val && form.amcCycle !== 'Custom') {
      const d = new Date(val);
      if (form.amcCycle === 'Monthly') d.setMonth(d.getMonth() + 1);
      else if (form.amcCycle === 'Yearly') d.setFullYear(d.getFullYear() + 1);
      d.setDate(d.getDate() - 1); // Expiry is conventionally the day before
      endDate = d.toISOString().split('T')[0];
    }
    setForm(p => ({ ...p, amcStart: val, amcEnd: endDate }));
  };
  
  const handleAmcCycleChange = (val) => {
    let endDate = form.amcEnd;
    if (form.amcStart && val !== 'Custom') {
      const d = new Date(form.amcStart);
      if (val === 'Monthly') d.setMonth(d.getMonth() + 1);
      else if (val === 'Yearly') d.setFullYear(d.getFullYear() + 1);
      d.setDate(d.getDate() - 1);
      endDate = d.toISOString().split('T')[0];
    }
    setForm(p => ({ ...p, amcCycle: val, amcEnd: endDate }));
  };

  const save = async () => {
    if (editData && !canEdit) { toast('Permission denied: cannot edit invoices', 'error'); return; }
    if (!editData && !canCreate) { toast('Permission denied: cannot create invoices', 'error'); return; }
    if (!editData && planEnforcement && !planEnforcement.isWithinLimit('maxInvoices', invoices.length)) { toast('Invoice limit reached for your plan. Please upgrade.', 'error'); return; }
    if (!form.client.trim()) { toast('Client required', 'error'); return; }
    const validItems = (form.items || []).filter(it => it.name?.trim());
    if (validItems.length === 0) { toast('Add at least one item with a product name', 'error'); return; }
    if (profile.reqShipping === 'Mandatory' && !form.shipTo?.trim()) { toast('Shipping Address is required', 'error'); return; }
    
    // Extract auto-amc trigger fields vs actual invoice fields
    const { isAmc, amcPlan, amcAmount, amcTaxRate, amcStart, amcEnd, amcCycle, addShipping, addDelivery, ...invPayload } = form;
    if (!addDelivery) {
      invPayload.deliveryCharge = 0;
      invPayload.deliveryTaxRate = 0;
    }
    
    // We'll optionally attach amcStart/EndDate to the final invoice IF AND ONLY IF isAmc is indeed checked.
    if (isAmc) {
      invPayload.amcStart = amcStart;
      invPayload.amcEnd = amcEnd;
    }

    if (profile.reqShipping === 'Hidden' || (!addShipping && profile.reqShipping !== 'Mandatory')) {
      invPayload.shipTo = '';
    }

    const payload = { 
      ...invPayload, 
      userId: ownerId, 
      actorId: user.id, 
      date: editData ? editData.date : new Date().toISOString().split('T')[0], 
      total: tots.total, 
      taxAmt: tots.taxTotal,
      isAmc: !!isAmc,
      amcPlan: amcPlan || '',
      amcAmount: amcAmount || '',
      amcTaxRate: amcTaxRate || 0,
      amcCycle: amcCycle || 'Yearly'
    };
    
    // Ensure no is present. If user cleared it, generate one
    if (!payload.no) {
      payload.no = editData ? editData.no : `INV/${new Date().getFullYear()}/${String(invoices.length + 1).padStart(3, '0')}`;
    }
    
    const invId = editData ? editData.id : id();
    const invAction = dbOp.update('invoices', invId, { ...payload });

    const txs = [invAction];

    // Auto-create AMC contract if ticked
    if (isAmc && amcStart && amcEnd && (!editData || !editData.amcStart)) {
      const custMatch = customers.find(c => (c.name || '').trim().toLowerCase() === (form.client || '').trim().toLowerCase());
      const amcId = id();
      txs.push(dbOp.update('amc', amcId, {
        userId: ownerId,
        actorId: user.id,
        client: form.client,
        email: custMatch ? custMatch.email : '',
        phone: custMatch ? custMatch.phone : '',
        startDate: amcStart,
        endDate: amcEnd,
        cycle: amcCycle,
        amount: parseFloat(amcAmount) || tots.total,
        taxRate: parseFloat(amcTaxRate) || 0,
        plan: amcPlan || 'Custom',
        status: 'Active',
        notes: `Auto-generated from Invoice`
      }));
    }

    let isNewCustomer = false;
    const cMatchOuter = customers.find(c => (c.name || '').trim().toLowerCase() === (payload.client || '').trim().toLowerCase());
    const lMatch = modalLeads.find(l => (l.name || '').trim().toLowerCase() === (payload.client || '').trim().toLowerCase() && l.stage !== wonStage);
    
    if (lMatch) {
            if (payload.status === 'Sent' || payload.status === 'Draft') {
        const target = payload.status === 'Sent' ? 'Invoice Sent' : 'Invoice Created';
        const { patch, changed } = autoStagePatch(target, disabledStages,
          payload.status === 'Sent' ? {} : {
            email: lMatch.email || payload.email || '',
            phone: lMatch.phone || payload.phone || '',
          });
        txs.push(dbOp.update('leads', lMatch.id, patch));
        txs.push(dbOp.update('activityLogs', id(), {
           entityId: lMatch.id, entityType: 'lead',
           text: changed
             ? `Stage changed to ${target} (via Invoice)`
             : `Invoice recorded. Stage kept as "${lMatch.stage}" — "${target}" is disabled in Settings.`,
           userId: ownerId, actorId: user.id, userName: user.email, createdAt: Date.now()
        }));
      } else if (payload.status === 'Paid' || payload.status === 'Partially Paid') {
        txs.push(dbOp.update('customers', id(), {
          name: lMatch.name, companyName: lMatch.companyName || '', email: lMatch.email || '', phone: lMatch.phone || '', userId: ownerId, actorId: user.id, createdAt: Date.now(),
          partnerId: lMatch.partnerId || '', distributorId: lMatch.distributorId || payload.distributorId || '', retailerId: lMatch.retailerId || payload.retailerId || ''
        }));
                const won1 = autoStagePatch(wonStage, disabledStages, {
           email: lMatch.email || payload.email || '',
           phone: lMatch.phone || payload.phone || '',
        });
        txs.push(dbOp.update('leads', lMatch.id, won1.patch));
        txs.push(dbOp.update('activityLogs', id(), {
           entityId: lMatch.id, entityType: 'lead',
           text: won1.changed
             ? `Lead converted to Customer. Stage changed to ${wonStage} (via Invoice save).`
             : `Lead converted to Customer. Stage kept as "${lMatch.stage}" — "${wonStage}" is disabled in Settings.`,
           userId: ownerId, actorId: user.id, userName: user.email, createdAt: Date.now()
        }));
        isNewCustomer = true;
      }
    }
    
    // Dual Partner Commission Generation (skip if distributors module disabled)
    const isPartnerModuleActive = planEnforcement?.isModuleEnabled('distributors') !== false;
    const distId = isPartnerModuleActive ? (payload.distributorId || cMatchOuter?.distributorId || lMatch?.distributorId) : null;
    const retId = isPartnerModuleActive ? (payload.retailerId || cMatchOuter?.retailerId || lMatch?.retailerId) : null;
    const legacyPartnerId = isPartnerModuleActive ? (cMatchOuter?.partnerId || lMatch?.partnerId) : null;

    const commStatus = (payload.status === 'Paid') ? 'Pending Payout' : 'Awaiting Customer Payment';
    
    // Delete existing commissions if we are editing the invoice
    if (editData) {
      const existing = partnerCommissions.filter(c => c.invoiceId === invId);
      existing.forEach(c => {
         txs.push(dbOp.delete('partnerCommissions', c.id));
      });
    }

    [...new Set([distId, retId, legacyPartnerId].filter(Boolean))].forEach(pId => {
      const pApp = partnersById[pId];
      if (pApp && pApp.commission > 0) {
        let effectivePct = pApp.commission;
        
        // Dual Commission: If this partner is a Distributor AND there's no Retailer on this sale,
        // stack the default retailer commission onto their base rate
        if (pApp.role === 'Distributor' && !retId) {
          // Use THIS distributor's own retailer commission from their profile
          // Fall back to the global default if not set
          const defaultRetComm = parseFloat(pApp.retailerCommission) || parseFloat(profile?.defaultRetailerCommission) || 0;
          if (defaultRetComm > 0) {
            effectivePct = pApp.commission + defaultRetComm;
          }
        }
        
        const commAmt = Math.round(tots.total * (effectivePct / 100));
        txs.push(dbOp.update('partnerCommissions', id(), {
          invoiceId: invId,
          partnerId: pId,
          amount: commAmt,
          status: commStatus,
          userId: ownerId,
          clientName: payload.client,
          invoiceNo: payload.no,
          commissionPct: effectivePct,
          basePct: pApp.commission,
          bonusPct: effectivePct - pApp.commission,
          isDualCommission: effectivePct !== pApp.commission,
          invoiceTotal: tots.total, 
          updatedAt: Date.now()
        }));
      }
    });

    // Inventory Stock Deduction Logic
    if (payload.status === 'Paid' && !editData?.stockDeducted) {
      payload.stockDeducted = true;
      for (const item of payload.items) {
        const pMatch = products.find(p => p.name === item.name);
        if (pMatch && pMatch.trackStock) {
          const newStock = (pMatch.stock || 0) - (item.qty || 0);
          txs.push(dbOp.update('products', pMatch.id, { stock: newStock }));
          txs.push(dbOp.update('activityLogs', id(), {
            entityId: pMatch.id,
            entityType: 'product',
            text: `Stock reduced by ${item.qty} via Invoice ${payload.no}. New stock: ${newStock}`,
            userId: ownerId,
            actorId: user.id,
            userName: user.email,
            createdAt: Date.now()
          }));
        }
      }
    }

    setSaving(true);
    try {
      await dbWrite(txs);
      refetch();

      // Track team activity (per-module performance)
      const myMember = team.find(t => t.email === user.email);
      await logActivity({
        entityType: 'invoice',
        entityId: invId,
        entityName: payload.no || form.client,
        action: editData ? 'edited' : 'created',
        text: editData
          ? `Edited invoice **${payload.no}** for ${form.client} (${fmt(tots.total, form.currency)})`
          : `Created invoice **${payload.no}** for ${form.client} (${fmt(tots.total, form.currency)})`,
        userId: ownerId,
        user,
        teamMemberId: myMember?.id || null,
        meta: { amount: tots.total, status: payload.status },
      });

    // Email Recipient Warning
    if (payload.status === 'Sent') {
      const lMatch = modalLeads.find(l => (l.name || '').trim().toLowerCase() === (payload.client || '').trim().toLowerCase());
      const cMatch = customers.find(c => (c.name || '').trim().toLowerCase() === (payload.client || '').trim().toLowerCase());
      const targetEmail = lMatch?.email || cMatch?.email;
      if (!targetEmail) {
        toast('Invoice saved, but client has no email address. Automated email was skipped.', 'warning');
      } else {
        toast('Invoice saved' + (isAmc ? ' & AMC created' : '') + (isNewCustomer ? ' & Lead Converted!' : ''), 'success');
      }
    } else {
      toast('Invoice saved' + (isAmc ? ' & AMC created' : '') + (isNewCustomer ? ' & Lead Converted!' : ''), 'success');
    }
    
    // Fire WhatsApp auto-notification for new invoices
    if (!editData) {
      const cMatch = customers.find(c => (c.name || '').trim().toLowerCase() === (form.client || '').trim().toLowerCase());
      const lMatchNotif = modalLeads.find(l => (l.name || '').trim().toLowerCase() === (form.client || '').trim().toLowerCase());
      const recipientPhone = cMatch?.phone || lMatchNotif?.phone;
      if (recipientPhone) {
        fireAutoNotifications('invoice_created', {
          client: form.client,
          phone: recipientPhone,
          clientphoneno: recipientPhone,
          leadphoneno: recipientPhone,
          invoiceno: payload.no,
          amount: tots.total,
          date: payload.date,
          bizName: profile?.businessName || profile?.bizName || '',
          ownerPhone: profile?.phone || '',
          entityId: payload.no,
        }, profile, ownerId).catch(() => {});
      }
    }
    
    } catch (e) {
      toast('Error saving invoice', 'error');
    } finally {
      setSaving(false);
    }
    
    setModal(false);
  };

  const del = async (iid) => {
    if (!canDelete) { toast('Permission denied: cannot delete invoices', 'error'); return; }
    if (!confirm('Delete this invoice? All associated records and activity logs will be removed.')) return;
    try {
      if (USE_PG_DATA) {
        await dbWrite(dbOp.delete('invoices', iid)); // cascade-deletes activity logs
        try { await dbWrite(dbOp.delete('partnerCommissions', `${iid}-comm`)); } catch (e) {}
        refetch();
      } else {
        const res = await fetch('/api/data', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            module: 'invoices', ownerId, actorId: user.id, userName: user.email,
            id: iid, logText: `Invoice ${invoices.find(v => v.id === iid)?.no} deleted`
          })
        });
        if (!res.ok) throw new Error('Failed to delete invoice');
        try { await dbWrite(dbOp.delete('partnerCommissions', `${iid}-comm`)); } catch (e) {}
      }
      toast('Invoice deleted', 'error');
    } catch (e) {
      toast('Error deleting invoice', 'error');
    }
  };

  const updateItem = (i, k, v) => {
    let newIt = { ...form.items[i], [k]: k === 'name' || k === 'desc' ? v : parseFloat(v) || 0 };
    if (k === 'name') {
      const pMatch = products.find(p => p.name === v);
      if (pMatch) newIt = { ...newIt, rate: pMatch.rate || 0, taxRate: pMatch.tax || 0 };
    }
    const items = form.items.map((it, idx) => idx === i ? newIt : it);
    setForm(p => ({ ...p, items }));
  };

  // Auto-fill shipping address when client changes
  useEffect(() => {
    if (form.client && !editData && profile?.reqShipping !== 'Hidden') {
      const match = customers.find(c => c.name === form.client);
      if (match && match.address) {
        setForm(p => ({ ...p, shipTo: match.address, addShipping: profile?.reqShipping === 'Mandatory' ? true : p.addShipping }));
      }
    }
  }, [form.client, customers, editData, profile?.reqShipping]);  if (printing) {
    const clientMatch = customers.find(c => c.name === printing.client) || modalLeads.find(l => l.name === printing.client);
    const dataWithContext = {
      ...printing,
      items: (Array.isArray(printing.items) ? printing.items : JSON.parse(printing.items || '[]')).map(it => ({
        ...it,
        name: products.find(p => p.id === it.productId)?.name || it.name
      })),
      clientDetails: clientMatch,
      companyName: clientMatch?.companyName || '',
      template: printing.template || profile?.invoiceTemplate || 'Classic'
    };

    return (
      <div className="invoice-print-container">
        <DocumentTemplate 
          data={dataWithContext} 
          profile={profile} 
          type="Invoice" 
          settings={settings}
        />
        <div className="no-print" style={{ marginTop: 40, textAlign: 'center', paddingBottom: 40, display: 'flex', justifyContent: 'center', gap: 10 }}>
          <button className="btn btn-primary" onClick={() => window.print()}>Print / Save PDF</button>
          {/* Real downloadable PDF file (named by invoice number). react-pdf is
              dynamically imported so its ~1MB bundle only loads on click. Falls
              back to the Print dialog if generation fails for any reason. */}
          <button className="btn btn-secondary" onClick={async () => {
            try {
              const { downloadDocumentPdf } = await import('./DocumentPdf');
              await downloadDocumentPdf({ data: dataWithContext, profile, type: 'Invoice', settings });
            } catch (e) {
              console.error('PDF download failed', e);
              toast('PDF generation failed — use Print / Save PDF instead', 'error');
            }
          }}>Download PDF</button>
          <button className="btn btn-secondary" onClick={() => { 
            const inv = printing;
            setPrinting(null);
            openEdit(inv);
          }}>Edit Invoice</button>
          <button className="btn btn-secondary" onClick={() => setPrinting(null)}>Close</button>
        </div>
      </div>
    );
  }

  if (isLoading) return <div className="p-xl">Loading...</div>;

  const savePayment = async () => {
    if (!canEdit) { toast('Permission denied: cannot record payments', 'error'); return; }
    if (!payAmt || parseFloat(payAmt) <= 0) { toast('Invalid amount', 'error'); return; }
    const existing = payModal.payments || [];
    const nw = [...existing, { date: Date.now(), amount: parseFloat(payAmt) }];
    const totalPaid = nw.reduce((s, p) => s + p.amount, 0);
    const stat = totalPaid >= payModal.total ? 'Paid' : 'Partially Paid';
    
    const txs = [dbOp.update('invoices', payModal.id, { payments: nw, status: stat })];
    let isNewCustomer = false;
    
    if (stat === 'Paid' || stat === 'Partially Paid') {
      const lMatch = modalLeads.find(l => (l.name || '').trim().toLowerCase() === (payModal.client || '').trim().toLowerCase() && l.stage !== wonStage);
      if (lMatch) {
         txs.push(dbOp.update('customers', id(), {
            name: lMatch.name, companyName: lMatch.companyName || '', email: lMatch.email || '', phone: lMatch.phone || '', userId: ownerId, actorId: user.id, createdAt: Date.now(),
            partnerId: lMatch.partnerId || payModal.distributorId || '', distributorId: lMatch.distributorId || payModal.distributorId || '', retailerId: lMatch.retailerId || payModal.retailerId || ''
         }));
                  const won2 = autoStagePatch(wonStage, disabledStages, {
            email: lMatch.email || payModal.email || '', // payModal might not have email/phone, depends on where it comes from
            phone: lMatch.phone || payModal.phone || '',
         });
         txs.push(dbOp.update('leads', lMatch.id, won2.patch));
         txs.push(dbOp.update('activityLogs', id(), {
            entityId: lMatch.id, entityType: 'lead',
            text: won2.changed
              ? `Payment received. Lead converted to Customer. Stage changed to ${wonStage} (via Invoice payment).`
              : `Payment received. Lead converted to Customer. Stage kept as "${lMatch.stage}" — "${wonStage}" is disabled in Settings.`,
            userId: ownerId, actorId: user.id, userName: user.email, createdAt: Date.now()
         }));
         isNewCustomer = true;
      }
    }

    // Dual Partner Commission Update (on Payment)
    if (stat === 'Paid') {
      const payComms = partnerCommissions.filter(c => c.invoiceId === payModal.id);
      payComms.forEach(c => {
        txs.push(dbOp.update('partnerCommissions', c.id, {
          status: 'Pending Payout',
          updatedAt: Date.now()
        }));
      });
    }

    await dbWrite(txs);
    refetch();
    toast('Payment added' + (isNewCustomer ? ' & Lead Converted!' : ''), 'success');
    
    // Fire WhatsApp auto-notification for payment received
    const cMatchPay = customers.find(c => (c.name || '').trim().toLowerCase() === (payModal.client || '').trim().toLowerCase());
    const lMatchPay = modalLeads.find(l => (l.name || '').trim().toLowerCase() === (payModal.client || '').trim().toLowerCase());
    const payRecipientPhone = cMatchPay?.phone || lMatchPay?.phone;
    if (payRecipientPhone) {
      fireAutoNotifications('payment_received', {
        client: payModal.client,
        phone: payRecipientPhone,
        clientphoneno: payRecipientPhone,
        leadphoneno: payRecipientPhone,
        invoiceno: payModal.no,
        amount: parseFloat(payAmt),
        date: new Date().toISOString().split('T')[0],
        bizName: profile?.businessName || profile?.bizName || '',
        ownerPhone: profile?.phone || '',
        entityId: `${payModal.no}-${payAmt}`,
      }, profile, ownerId).catch(() => {});
    }
    
    setPayModal(null);
    setPayAmt('');
  };

  const createCustomer = async () => {
    if (!newCustForm.name.trim()) return toast('Name required', 'error');
    if (!newCustForm.email.trim()) return toast('Email is mandatory for clients', 'error');
    const newId = id();
    const newCustData = { ...newCustForm, name: newCustForm.name.trim(), userId: ownerId, actorId: user.id, createdAt: Date.now() };
    await dbWrite(dbOp.update('customers', newId, newCustData));
    setModalCustomers(prev => [...prev, { ...newCustData, id: newId }]);
    setForm(p => ({ ...p, client: newCustData.name, distributorId: newCustForm.distributorId || p.distributorId, retailerId: newCustForm.retailerId || p.retailerId }));
    setCustModal(false);
    setNewCustForm(EMPTY_CUSTOMER);
    toast('Customer created!', 'success');
  };

  const saveViewConfig = async (cols) => {
    if (!perms?.isOwner) { toast('Only the business owner can change view configurations', 'error'); return; }
    if (profile?.id) await dbWrite(dbOp.update('userProfiles', profile.id, { invoiceCols: cols }));
    setColModal(false);
    toast('View saved', 'success');
  };

  return (
    <div>
      <div className="sh">
        <div><h2>Invoices</h2></div>
        {canCreate && <button className="btn btn-primary btn-sm" onClick={openCreate}>+ Create</button>}
      </div>
      <div className="tabs">
        {['all', 'Draft', 'Sent', 'Partially Paid', 'Paid', 'Overdue'].map(t => (
          <div key={t} className={`tab${tab === t ? ' active' : ''}`} onClick={() => setTab(t)}>{t === 'all' ? 'All' : t}</div>
        ))}
      </div>
      <div className="tw">
        <div className="tw-head">
          <h3>Invoices ({filtered.length})</h3>
          <div style={{ display: 'flex', gap: 8 }}>
            <div className="sw">
              <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
              <input className="si" placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <button className="btn btn-secondary btn-sm" onClick={() => { setTempCols(activeCols); setColModal(true); }}>⚙ View</button>
          </div>
        </div>
        <div className="tw-scroll">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Invoice No.</th>
                <th>Client</th>
                {activeCols.includes('Status') && <th>Status</th>}
                {activeCols.includes('Date') && <th>Date</th>}
                {activeCols.includes('Due Date') && <th>Due Date</th>}
                <th>Amount</th>
                {activeCols.includes('Paid Amount') && <th>Paid</th>}
                {activeCols.includes('Balance Due') && <th>Balance</th>}
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0
                ? <tr><td colSpan={10} style={{ textAlign: 'center', padding: 28, color: 'var(--muted)' }}>No invoices yet</td></tr>
                : paginated.map((inv, i) => {
                    const payments = Array.isArray(inv.payments) ? inv.payments : (inv.payments ? JSON.parse(inv.payments) : []);
                    const fromPayments = payments.reduce((s, p) => s + p.amount, 0);
                    const paidAmt = fromPayments > 0 ? fromPayments : inv.status === 'Paid' ? (inv.total || 0) : inv.status === 'Partially Paid' ? (inv.paidAmount || 0) : 0;
                    const balAmt = Math.max(0, (inv.total || 0) - paidAmt);
                    return (
                      <tr key={inv.id}>
                        <td style={{ color: 'var(--muted)', fontSize: 11 }}>{i + 1}</td>
                        <td>
                          <strong 
                            style={{ fontSize: 12, cursor: 'pointer', color: 'var(--accent2)', textDecoration: 'underline' }} 
                            onClick={() => setPrinting(inv)}
                          >
                            {inv.no}
                          </strong>
                          {inv.fromAmc && <span style={{ marginLeft: 6, fontSize: 10, background: '#e0e7ff', color: '#4338ca', padding: '2px 4px', borderRadius: 4, fontWeight: 600 }}>AMC</span>}
                        </td>
                        <td>{inv.client}</td>
                        {activeCols.includes('Status') && <td><span className={`badge ${stageBadgeClass(getInvoiceStatus(inv))}`}>{getInvoiceStatus(inv)}</span></td>}
                        {activeCols.includes('Date') && <td style={{ fontSize: 12 }}>{fmtD(inv.date)}</td>}
                        {activeCols.includes('Due Date') && <td style={{ fontSize: 12 }}>{fmtD(inv.dueDate)}</td>}
                        <td style={{ fontWeight: 700 }}>{fmt(inv.total, inv.currency)}</td>
                        {activeCols.includes('Paid Amount') && <td style={{ color: '#16a34a', fontWeight: 600 }}>{fmt(paidAmt, inv.currency)}</td>}
                        {activeCols.includes('Balance Due') && <td style={{ color: '#dc2626', fontWeight: 600 }}>{fmt(balAmt < 0 ? 0 : balAmt, inv.currency)}</td>}
                         <td>
                           <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 4 }}>
                             <button className="btn btn-secondary btn-sm" onClick={() => setPrinting(inv)}>View</button>
                             {canEdit && <button className="btn btn-secondary btn-sm" onClick={() => openEdit(inv)}>Edit</button>}
                             <button className="btn-icon" onClick={(e) => {
                              const dm = e.currentTarget.nextElementSibling;
                              document.querySelectorAll('.dd-menu').forEach(el => el !== dm && (el.style.display = 'none'));
                              dm.style.display = dm.style.display === 'block' ? 'none' : 'block';
                             }}>⋮</button>
                             <div className="dd-menu" style={{ display: 'none', position: 'absolute', right: 0, top: 28, background: '#fff', border: '1px solid var(--border)', borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,0.1)', zIndex: 10, width: 140, overflow: 'hidden' }}>
                               <div style={{ padding: '8px 12px', fontSize: 12, cursor: 'pointer', borderBottom: '1px solid var(--border)' }} onClick={() => { setPrinting(inv); document.querySelectorAll('.dd-menu').forEach(el => el.style.display = 'none'); }}>📄 Print</div>
                               {canEdit && <div style={{ padding: '8px 12px', fontSize: 12, cursor: 'pointer', borderBottom: '1px solid var(--border)' }} onClick={() => { setPayModal(inv); document.querySelectorAll('.dd-menu').forEach(el => el.style.display = 'none'); }}>💵 Add Payment</div>}
                               {canDelete && <div style={{ padding: '8px 12px', fontSize: 12, cursor: 'pointer', color: '#dc2626' }} onClick={() => { del(inv.id); document.querySelectorAll('.dd-menu').forEach(el => el.style.display = 'none'); }}>🗑 Delete</div>}
                             </div>
                           </div>
                         </td>
                      </tr>
                    );
                })}
            </tbody>
          </table>
        </div>
        {totalPages > 1 && (
          <div style={{ padding: '12px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--border)', background: 'var(--bg-soft)', flexWrap: 'wrap', gap: 10 }}>
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>
              Showing <strong>{(currentPage - 1) * pageSize + 1}</strong>–<strong>{Math.min(currentPage * pageSize, filtered.length)}</strong> of <strong>{filtered.length}</strong>
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setCurrentPage(1); }} style={{ fontSize: 12, padding: '3px 6px', borderRadius: 6, border: '1px solid var(--border)' }}>
                {[25, 50, 100, 500].map(s => <option key={s} value={s}>{`${s} / page`}</option>)}
              </select>
              <button className="btn btn-secondary btn-sm" disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)}>&#8249; Prev</button>
              <span style={{ fontSize: 12 }}>Page {currentPage} / {totalPages}</span>
              <button className="btn btn-secondary btn-sm" disabled={currentPage === totalPages} onClick={() => setCurrentPage(p => p + 1)}>Next &#8250;</button>
            </div>
          </div>
        )}
      </div>

      {modal && (
        <div className="mo open fullpage">
          <div className="mo-box wide fullpage">
            <div className="mo-head"><h3>{editData ? 'Edit Invoice' : 'Create Invoice'}</h3><button className="btn-icon" onClick={() => setModal(false)}>✕</button></div>
            <div className="mo-body">
              <div className="fgrid" style={{ gridTemplateColumns: '1fr 2fr 1fr 1fr 1fr' }}>
                <div className="fg">
                  <label>Invoice No.</label>
                  <input value={form.no} onChange={e => setForm(p => ({ ...p, no: e.target.value }))} placeholder="INV/..." />
                </div>
                <div className="fg">
                  <label>Client *</label>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <div style={{ flex: 1 }}>
                      <SearchableSelect
                        options={clientOptions}
                        displayKey="displayName"
                        returnKey="name"
                        searchKeys={['phone']}
                        subKey="phone"
                        onSearchChange={searchLeads}
                        searching={leadsSearching}
                        value={form.client}
                        onChange={val => {
                          // Auto-map distributor/retailer from matching lead
                          const matchedLead = modalLeads.find(l => (l.name || '').trim().toLowerCase() === (val || '').trim().toLowerCase());
                          const matchedCust = customers.find(c => (c.name || '').trim().toLowerCase() === (val || '').trim().toLowerCase());
                          setForm(p => ({ 
                            ...p, 
                            client: val,
                            distributorId: matchedLead?.distributorId || matchedCust?.distributorId || '',
                            retailerId: matchedLead?.retailerId || matchedCust?.retailerId || ''
                          }));
                        }} 
                        placeholder="Search client or lead..." 
                      />
                    </div>
                    <button className="btn btn-secondary" style={{ padding: '0 10px' }} onClick={() => setCustModal(true)} title="Add New Customer">+</button>
                  </div>
                </div>
                <div className="fg"><label>Due Date</label><input type="date" value={form.dueDate} onChange={e => setForm(p => ({ ...p, dueDate: e.target.value }))} /></div>
                <div className="fg"><label>Status</label>
                  <select value={form.status} onChange={e => setForm(p => ({ ...p, status: e.target.value }))}>
                    {['Draft', 'Sent', 'Paid', 'Overdue'].map(s => <option key={s}>{s}</option>)}
                  </select>
                </div>
                <div className="fg">
                  <label>Assign To</label>
                  <select value={form.assign} onChange={e => setForm(p => ({ ...p, assign: e.target.value }))}>
                    <option value="">Unassigned</option>
                    {data?.teamMembers?.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
                  </select>
                </div>
                {planEnforcement?.isModuleEnabled('distributors') !== false && partnerApplications.length > 0 && (
                  <>
                    <div className="fg" style={{ zIndex: 8 }}>
                      <label>Distributor <span style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 400 }}>auto-mapped</span></label>
                      <SearchableSelect
                        options={[{ id: '', name: '-- None --' }, ...partnerApplications.filter(p => p.role === 'Distributor').map(p => ({ id: p.id, name: p.companyName || p.name }))]}
                        displayKey="name"
                        returnKey="id"
                        value={form.distributorId}
                        onChange={val => setForm(p => ({ ...p, distributorId: val, retailerId: '' }))}
                        placeholder="Select distributor..."
                      />
                    </div>
                    <div className="fg" style={{ zIndex: 7 }}>
                      <label>Retailer</label>
                      <SearchableSelect
                        options={[
                          { id: '', name: '-- None --' },
                          ...partnerApplications.filter(p => p.role === 'Retailer' && (!form.distributorId || p.parentDistributorId === form.distributorId)).map(p => ({ id: p.id, name: `${p.companyName || p.name}${p.parentDistributorId ? ` (${partnersById[p.parentDistributorId]?.companyName || partnersById[p.parentDistributorId]?.name || ''})` : ''}` }))
                        ]}
                        displayKey="name"
                        returnKey="id"
                        value={form.retailerId}
                        onChange={val => {
                          const retailer = partnersById[val];
                          setForm(p => ({ ...p, retailerId: val, distributorId: retailer?.parentDistributorId || p.distributorId }));
                        }}
                        placeholder="Select retailer..."
                      />
                    </div>
                  </>
                )}
</div>

              {profile?.reqShipping !== 'Hidden' && (
                <div style={{ background: '#f8fafc', padding: 15, borderRadius: 8, border: '1px solid #e2e8f0', marginBottom: 20 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>
                    {profile?.reqShipping === 'Mandatory' ? (
                      <span style={{ color: 'var(--accent)' }}>Shipping Address (Required)</span>
                    ) : (
                      <>
                        <input type="checkbox" checked={form.addShipping} onChange={e => setForm(p => ({ ...p, addShipping: e.target.checked }))} style={{ width: 16, height: 16 }} />
                        Ship To Address
                      </>
                    )}
                  </label>
                  {(form.addShipping || profile?.reqShipping === 'Mandatory') && (
                    <div className="fg" style={{ marginTop: 15, marginBottom: 0 }}>
                      <textarea value={form.shipTo} onChange={e => setForm(p => ({ ...p, shipTo: e.target.value }))} placeholder="Enter full shipping address..." style={{ minHeight: 60 }} />
                      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4}}>Leave blank if same as billing</div>
                    </div>
                  )}
                </div>
              )}


              <div style={{ background: '#f8fafc', padding: 15, borderRadius: 8, border: '1px solid #e2e8f0', marginBottom: 20 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>
                  <input type="checkbox" checked={form.isAmc} onChange={e => setForm(p => ({ ...p, isAmc: e.target.checked }))} style={{ width: 16, height: 16 }} />
                  Automatically generate AMC Contract for this Invoice
                </label>
                {form.isAmc && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 15, marginTop: 15 }}>
                    <div className="fg" style={{ marginBottom: 0 }}>
                      <label>AMC Product / Plan</label>
                      <SearchableSelect 
                        options={products} 
                        displayKey="name" 
                        returnKey="name"
                        value={form.amcPlan} 
                         onChange={val => {
                           const pMatch = products.find(p => p.id === val || p.name === val);
                           setForm(prev => ({ 
                             ...prev, 
                             amcPlan: pMatch?.name || val, 
                             amcProductId: pMatch?.id || '',
                             amcSku: pMatch?.code || '',
                             amcAmount: pMatch ? pMatch.rate : prev.amcAmount, 
                             amcTaxRate: pMatch ? (pMatch.tax || 0) : prev.amcTaxRate 
                           }));
                        }} 
                        placeholder="e.g. Hosting, Maintenance..." 
                      />
                    </div>
                    <div className="fg" style={{ marginBottom: 0 }}>
                      <label>AMC Amount ({curSym})</label>
                      <input type="number" value={form.amcAmount} onChange={e => setForm(p => ({ ...p, amcAmount: e.target.value }))} placeholder="Amount for AMC" />
                    </div>
                    <div className="fg" style={{ marginBottom: 0 }}>
                      <label>AMC Tax (GST)</label>
                      <select value={form.amcTaxRate} onChange={e => setForm(p => ({ ...p, amcTaxRate: parseFloat(e.target.value) || 0 }))}>
                        {taxRates.map(t => <option key={t.label} value={t.rate}>{t.label}</option>)}
                      </select>
                    </div>
                    <div className="fg" style={{ marginBottom: 0 }}>
                      <label>Billing Cycle</label>
                      <select value={form.amcCycle} onChange={e => handleAmcCycleChange(e.target.value)}>
                        {['Custom', 'Monthly', 'Yearly'].map(c => <option key={c}>{c}</option>)}
                      </select>
                    </div>
                    <div className="fg" style={{ marginBottom: 0 }}></div>
                    <div className="fg" style={{ marginBottom: 0 }}><label>AMC Start Date</label><input type="date" value={form.amcStart} onChange={e => handleAmcStartChange(e.target.value)} /></div>
                    <div className="fg" style={{ marginBottom: 0 }}><label>AMC End Date (Expiry)</label><input type="date" value={form.amcEnd} readOnly={form.amcCycle !== 'Custom'} onChange={e => form.amcCycle === 'Custom' && setForm(p => ({ ...p, amcEnd: e.target.value }))} style={{ border: form.amcCycle !== 'Custom' ? 'none' : '', background: form.amcCycle !== 'Custom' ? '#f1f5f9' : '#fff' }} /></div>
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 7 }}>
                <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase' }}>Line Items</label>
                <button className="btn btn-secondary btn-sm" onClick={() => setForm(p => ({ ...p, items: [...p.items, { name: '', desc: '', qty: 1, unit: 'Nos', rate: 0, taxRate: profile?.defaultTaxRate || 0 }] }))}>+ Add Row</button>
              </div>
              <table className="li-table">
                <thead><tr><th>Item</th><th style={{ width: 95 }}>Qty</th><th style={{ width: 80 }}>Unit</th><th style={{ width: 90 }}>Rate</th><th style={{ width: 160 }}>Tax</th><th style={{ width: 80 }}>Amount</th><th></th></tr></thead>
                <tbody>
                  {form.items.map((it, i) => (
                    <tr key={i}>
                      <td>
                        <div style={{ position: 'relative', minWidth: 200 }}>
                          <SearchableSelect 
                            options={products} 
                            displayKey="name"
                            returnKey="id"
                            value={it.productId || it.name}
                            onChange={val => {
                              const pMatch = products.find(p => p.id === val || p.name === val);
                              const updates = {
                                productId: pMatch?.id || '',
                                sku: pMatch?.code || '',
                                name: pMatch?.name || val
                              };
                              if (pMatch) {
                                updates.rate = pMatch.rate || 0;
                                updates.taxRate = pMatch.tax || 0;
                                updates.unit = pMatch.unit || 'Nos';
                              }
                              const its = form.items.map((x, idx) => idx === i ? { ...x, ...updates } : x);
                              setForm(prev => {
                                let nextCurrency = prev.currency;
                                if (pMatch && pMatch.currency && pMatch.currency !== prev.currency) {
                                  const hasOtherFilled = prev.items.some((x, idx) => idx !== i && (x.name || x.rate));
                                  if (!hasOtherFilled) {
                                    nextCurrency = pMatch.currency;
                                    toast(`Currency set to ${pMatch.currency} from product`, 'success');
                                  } else {
                                    toast(`Warning: product priced in ${pMatch.currency} but invoice is in ${prev.currency}`, 'warning');
                                  }
                                }
                                return { ...prev, items: its, currency: nextCurrency };
                              });
                            }}
                            placeholder="Select Product"
                          />
                        </div>
                      </td>
                      <td><input className="li-input" type="number" value={it.qty} onChange={e => updateItem(i, 'qty', e.target.value)} style={{ width: 95, textAlign: 'center' }} /></td>
                      <td>
                        <select className="li-input" value={it.unit || 'Nos'} onChange={e => updateItem(i, 'unit', e.target.value)}>
                          {(profile?.productUnits || ['Nos', 'Kgs', 'Ltrs', 'Mtrs', 'Pkt', 'Box', 'Set']).map(u => <option key={u}>{u}</option>)}
                        </select>
                      </td>
                      <td><input className="li-input" type="number" value={it.rate} onChange={e => updateItem(i, 'rate', e.target.value)} style={{ textAlign: 'right' }} /></td>
                      <td><select className="li-input" value={it.taxRate} onChange={e => updateItem(i, 'taxRate', e.target.value)}>{TAX_OPTIONS.map(t => <option key={t.label} value={t.rate}>{t.label}</option>)}</select></td>
                      <td style={{ textAlign: 'right', fontWeight: 700, fontSize: 12 }}>{((it.qty || 0) * (it.rate || 0)).toFixed(2)}</td>
                      <td><button onClick={() => setForm(p => ({ ...p, items: p.items.filter((_, idx) => idx !== i) }))} style={{ background: '#fee2e2', color: '#991b1b', border: 'none', borderRadius: 5, cursor: 'pointer', width: 22, height: 22 }}>✕</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, marginTop: 14 }}>
                <div>
                  {profile?.invoiceTemplate === 'Formal' && (
                    <div className="fg">
                      <label>Opening Note <span style={{ fontWeight: 400, color: 'var(--muted)', fontSize: 11 }}>(shown at the top of the "Formal Quote" template — leave blank for the default greeting)</span></label>
                      <textarea value={form.quoteFor || ''} onChange={e => setForm(p => ({ ...p, quoteFor: e.target.value }))} style={{ minHeight: 55 }} placeholder={`Dear Mam/Sir,\nAs per the discussion we had, we are happy to provide our best invoice for...`} />
                    </div>
                  )}
                  <div className="fg"><label>Notes</label><textarea value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} style={{ minHeight: 55 }} /></div>
                  <div className="fg"><label>Terms</label><textarea value={form.terms} onChange={e => setForm(p => ({ ...p, terms: e.target.value }))} style={{ minHeight: 120 }} /></div>
                </div>
                <div className="totals-box">
                  <div className="total-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--muted)', fontSize: 13 }}>Currency</span>
                    <select value={form.currency || 'INR'} onChange={e => setForm(p => ({ ...p, currency: e.target.value }))} style={{ border: '1px solid var(--border)', background: '#fff', borderRadius: 4, padding: '3px 6px', fontSize: 12, cursor: 'pointer' }}>
                      {SUPPORTED_CURRENCIES.map(c => <option key={c.code} value={c.code}>{c.symbol} {c.code}</option>)}
                    </select>
                  </div>
                  <div className="total-row"><span style={{ color: 'var(--muted)' }}>Sub Total</span><span style={{ fontWeight: 700 }}>{fmt(tots.sub, form.currency)}</span></div>
                  <div className="total-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--muted)', fontSize: 13, marginRight: 10, display: 'flex', alignItems: 'center', gap: 4 }}>
                      Discount
                      <select value={form.discType} onChange={e => setForm(p => ({ ...p, discType: e.target.value, disc: 0 }))} style={{ border: '1px solid var(--border)', background: '#fff', borderRadius: 4, padding: '2px', fontSize: 11, cursor: 'pointer' }}>
                        <option value="%">%</option>
                        <option value={curSym}>{curSym}</option>
                      </select>
                    </span>
                    <input type="number" value={form.disc} onChange={e => setForm(p => ({ ...p, disc: parseFloat(e.target.value) || 0 }))} style={{ width: 80, padding: 4, textAlign: 'right', border: '1px solid var(--border)', borderRadius: 4 }} placeholder="0" />
                  </div>
                  {(tots.discAmt > 0 && form.discType === '%') && <div className="total-row"><span style={{ color: 'var(--muted)' }}>Discount Amount</span><span style={{ color: '#dc2626' }}>- {fmt(tots.discAmt, form.currency)}</span></div>}
                  {(() => {
                    const clientMatchForm = customers.find(c => c.name === form.client);
                    const isInterStateForm = profile?.bizState && clientMatchForm?.state && profile.bizState !== clientMatchForm.state;
                    if (tots.taxTotal > 0) {
                      return isInterStateForm ? (
                        <div className="total-row"><span style={{ color: 'var(--muted)' }}>IGST</span><span style={{ color: '#16a34a' }}>{fmt(tots.taxTotal, form.currency)}</span></div>
                      ) : (
                        <>
                          <div className="total-row"><span style={{ color: 'var(--muted)' }}>CGST</span><span style={{ color: '#16a34a' }}>{fmt(tots.taxTotal / 2, form.currency)}</span></div>
                          <div className="total-row"><span style={{ color: 'var(--muted)' }}>SGST</span><span style={{ color: '#16a34a' }}>{fmt(tots.taxTotal / 2, form.currency)}</span></div>
                        </>
                      );
                    }
                    return <div className="total-row"><span style={{ color: 'var(--muted)' }}>GST</span><span style={{ color: '#16a34a' }}>{fmt(0, form.currency)}</span></div>;
                  })()}
                  <div className="total-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <label style={{ color: 'var(--muted)', fontSize: 13, marginRight: 10, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                      <input type="checkbox" checked={!!form.addDelivery} onChange={e => setForm(p => ({ ...p, addDelivery: e.target.checked, deliveryCharge: e.target.checked ? p.deliveryCharge : 0, deliveryTaxRate: e.target.checked ? p.deliveryTaxRate : 0 }))} style={{ width: 14, height: 14 }} />
                      Delivery Charges
                    </label>
                    {form.addDelivery && (
                      <input type="number" value={form.deliveryCharge} onChange={e => setForm(p => ({ ...p, deliveryCharge: parseFloat(e.target.value) || 0 }))} style={{ width: 80, padding: 4, textAlign: 'right', border: '1px solid var(--border)', borderRadius: 4 }} placeholder="0" />
                    )}
                  </div>
                  {form.addDelivery && (
                    <div className="total-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--muted)', fontSize: 13, marginRight: 10 }}>Delivery Tax</span>
                      <select value={form.deliveryTaxRate} onChange={e => setForm(p => ({ ...p, deliveryTaxRate: parseFloat(e.target.value) || 0 }))} style={{ width: 120, padding: 4, border: '1px solid var(--border)', borderRadius: 4, fontSize: 12 }}>
                        {taxRates.map(t => <option key={t.label} value={t.rate}>{t.label}</option>)}
                      </select>
                    </div>
                  )}
                  {form.addDelivery && tots.deliveryTax > 0 && (
                    <div className="total-row"><span style={{ color: 'var(--muted)' }}>Delivery Tax Amt</span><span style={{ color: '#16a34a' }}>{fmt(tots.deliveryTax, form.currency)}</span></div>
                  )}
                  <div className="total-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--muted)', fontSize: 13, marginRight: 10 }}>Adjustment</span>
                    <input type="number" value={form.adj} onChange={e => setForm(p => ({ ...p, adj: parseFloat(e.target.value) || 0 }))} style={{ width: 80, padding: 4, textAlign: 'right', border: '1px solid var(--border)', borderRadius: 4 }} placeholder="0" />
                  </div>
                  <div className="total-row grand"><strong style={{ fontSize: 14 }}>Total ({curSym})</strong><strong style={{ fontSize: 18, color: 'var(--accent2)' }}>{fmt(tots.total, form.currency)}</strong></div>
                </div>
              </div>
            </div>
            <div className="mo-foot">
              <button className="btn btn-secondary btn-sm" onClick={() => setModal(false)}>Cancel</button>
              <button className="btn btn-primary btn-sm" onClick={save} disabled={saving}>
                 {saving ? 'Saving...' : 'Save Invoice'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* PAY MODAL */}
      {payModal && (
        <div className="mo open">
          <div className="mo-box" style={{ width: 400 }}>
            <div className="mo-head"><h3>Record Payment</h3><button className="btn-icon" onClick={() => setPayModal(null)}>✕</button></div>
            <div className="mo-body" style={{ padding: 20 }}>
             <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 15, fontSize: 13, background: '#f8fafc', padding: 10, borderRadius: 8 }}>
                <span>Total: <strong>{fmt(payModal.total, payModal.currency)}</strong></span>
                {(() => {
                  const payments = Array.isArray(payModal.payments) ? payModal.payments : (payModal.payments ? JSON.parse(payModal.payments) : []);
                  const fromPay = payments.reduce((s,p) => s + p.amount, 0);
                  const shownPaid = fromPay > 0 ? fromPay : payModal.status === 'Paid' ? (payModal.total || 0) : (payModal.paidAmount || 0);
                  return <span>Paid: <strong style={{ color: '#16a34a' }}>{fmt(shownPaid, payModal.currency)}</strong></span>
                })()}
              </div>
              <div className="fg">
                <label>Amount ({currencySymbol(payModal.currency)})</label>
                <input type="number" value={payAmt} onChange={e => setPayAmt(e.target.value)} placeholder="0.00" />
              </div>
            </div>
            <div className="mo-foot">
              <button className="btn btn-secondary btn-sm" onClick={() => setPayModal(null)}>Cancel</button>
              <button className="btn btn-primary btn-sm" onClick={savePayment}>Save Payment</button>
            </div>
          </div>
        </div>
      )}

      {/* CREATE CUSTOMER MODAL */}
      {custModal && (
        <div className="mo open">
          <div className="mo-box">
            <div className="mo-head"><h3>Quick Add Customer</h3><button className="btn-icon" onClick={() => setCustModal(false)}>✕</button></div>
            <div className="mo-body">
              <div className="fgrid">
                <div className="fg"><label>Name *</label><input value={newCustForm.name} onChange={ncf('name')} placeholder="Full name" /></div>
                <div className="fg"><label>Company Name (Optional)</label><input value={newCustForm.companyName} onChange={ncf('companyName')} placeholder="Business name" /></div>
                <div className="fg"><label>Email *</label><input type="email" value={newCustForm.email} onChange={ncf('email')} /></div>
                <div className="fg"><label>Phone</label><input value={newCustForm.phone} onChange={ncf('phone')} placeholder="+91..." /></div>
                <div className="fg span2"><label>Address</label><textarea value={newCustForm.address} onChange={ncf('address')} placeholder="Full address" style={{ minHeight: 60 }} /></div>
                <div className="fg"><label>Country</label>
                  <select value={newCustForm.country} onChange={ncf('country')}>
                    {COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div className="fg"><label>State</label>
                  <select value={newCustForm.state} onChange={ncf('state')}>
                    <option value="">Select State...</option>
                    {INDIAN_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div className="fg"><label>Pincode</label><input value={newCustForm.pincode} onChange={ncf('pincode')} placeholder="Postal code" /></div>
                <div className="fg"><label>GSTIN</label><input value={newCustForm.gstin} onChange={ncf('gstin')} placeholder="GST Number" /></div>
                {partnerApplications.length > 0 && (
                  <>
                    <div className="fg" style={{ zIndex: 8 }}>
                      <label>Distributor (Optional)</label>
                      <SearchableSelect
                        options={[{ id: '', name: '-- None --' }, ...partnerApplications.filter(p => p.role === 'Distributor').map(p => ({ id: p.id, name: p.companyName || p.name }))]}
                        displayKey="name" returnKey="id" value={newCustForm.distributorId}
                        onChange={val => setNewCustForm(p => ({ ...p, distributorId: val, retailerId: '' }))}
                        placeholder="Search distributor..."
                      />
                    </div>
                    <div className="fg" style={{ zIndex: 7 }}>
                      <label>Retailer (Optional)</label>
                      <SearchableSelect
                        options={[
                          { id: '', name: '-- None --' },
                          ...partnerApplications.filter(p => p.role === 'Retailer' && (!newCustForm.distributorId || p.parentDistributorId === newCustForm.distributorId))
                            .map(p => ({ id: p.id, name: `${p.companyName || p.name}${p.parentDistributorId ? ` (${partnersById[p.parentDistributorId]?.companyName || partnersById[p.parentDistributorId]?.name || ''})` : ''}` }))
                        ]}
                        displayKey="name" returnKey="id" value={newCustForm.retailerId}
                        onChange={val => {
                          const retailer = partnersById[val];
                          setNewCustForm(p => ({ ...p, retailerId: val, distributorId: retailer?.parentDistributorId || p.distributorId }));
                        }}
                        placeholder="Search retailer..."
                      />
                    </div>
                  </>
                )}
                {customFields.length > 0 && <div className="fg span2" style={{ borderTop: '1px solid var(--border)', paddingTop: 16, marginTop: 4 }}>
                  <h4 style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 12 }}>Custom Fields (Optional)</h4>
                  <div className="fgrid">
                    {customFields.map(field => (
                      <div key={field.name} className="fg">
                        <label>{field.name}</label>
                        {field.type === 'dropdown' ? (
                          <select value={newCustForm.custom[field.name] || ''} onChange={nccf(field.name)}>
                            <option value="">Select...</option>
                            {field.options.split(',').map(o => <option key={o.trim()}>{o.trim()}</option>)}
                          </select>
                        ) : (
                          <input type={field.type === 'number' ? 'number' : 'text'} value={newCustForm.custom[field.name] || ''} onChange={nccf(field.name)} />
                        )}
                      </div>
                    ))}
                  </div>
                </div>}
              </div>
            </div>
            <div className="mo-foot">
              <button className="btn btn-secondary btn-sm" onClick={() => setCustModal(false)}>Cancel</button>
              <button className="btn btn-primary btn-sm" onClick={createCustomer}>Save</button>
            </div>
          </div>
        </div>
      )}

      {/* COLUMNS MODAL */}
      {colModal && (
        <div className="mo open">
          <div className="mo-box" style={{ width: 400 }}>
            <div className="mo-head"><h3>Configure View</h3><button className="btn-icon" onClick={() => setColModal(false)}>✕</button></div>
            <div className="mo-body" style={{ padding: 20 }}>
              <strong style={{ fontSize: 13, color: 'var(--text)', marginBottom: 12, display: 'block' }}>Visible Columns</strong>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                {allPossibleCols.map(c => (
                  <label key={c} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
                    <input type="checkbox" checked={tempCols.includes(c)} onChange={e => {
                      if (e.target.checked) setTempCols([...tempCols, c]);
                      else setTempCols(tempCols.filter(x => x !== c));
                    }} style={{ width: 16, height: 16, accentColor: 'var(--accent)' }} />
                    {c}
                  </label>
                ))}
              </div>
            </div>
            <div className="mo-foot" style={{ justifyContent: 'space-between' }}>
              <button className="btn btn-secondary btn-sm" onClick={() => saveViewConfig(allPossibleCols)}>Reset</button>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-secondary btn-sm" onClick={() => setColModal(false)}>Cancel</button>
                <button className="btn btn-primary btn-sm" onClick={() => saveViewConfig(tempCols)}>Save</button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
