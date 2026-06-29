import React, { useState, useMemo, useEffect } from 'react';
import { dbWrite, dbOp } from '../../utils/dbWrite';
import db from '../../instant';
import { id } from '@instantdb/react';
import { fmtD, fmt, stageBadgeClass, TAX_OPTIONS, INDIAN_STATES, COUNTRIES, SUPPORTED_CURRENCIES, currencySymbol } from '../../utils/helpers';
import DocumentTemplate from './DocumentTemplate';
import { useToast } from '../../context/ToastContext';
import SearchableSelect from '../UI/SearchableSelect';
import { EMPTY_CUSTOMER } from '../../utils/constants';
import { logActivity } from '../../utils/activityLogger';
import { fireAutoNotifications } from '../../utils/messaging';

const EMPTY = { no: '', client: '', validUntil: '', status: 'Created', notes: '', terms: '', disc: 0, adj: 0, tdsRate: 0, items: [{ name: '', desc: '', qty: 1, unit: 'Nos', rate: 0, taxRate: 0 }], isAmc: false, amcCycle: 'Yearly', amcStart: '', amcEnd: '', amcPlan: '', amcAmount: '', amcTaxRate: 0, shipTo: '', addShipping: false, assign: '', distributorId: '', retailerId: '', currency: 'INR', deliveryCharge: 0, deliveryTaxRate: 0, addDelivery: false };

function calcTotals(items, disc, tdsRate, adj, delivery = 0, deliveryTaxRate = 0) {
  const its = Array.isArray(items) ? items : (items ? JSON.parse(items) : []);
  const sub = its.reduce((s, it) => s + (it.qty || 0) * (it.rate || 0), 0);
  const taxTotal = its.reduce((s, it) => s + (it.qty || 0) * (it.rate || 0) * (it.taxRate || 0) / 100, 0);
  const discAmt = sub * (disc || 0) / 100;
  const tdsAmt = (sub - discAmt) * (tdsRate || 0) / 100;
  const deliveryAmt = parseFloat(delivery) || 0;
  const deliveryTax = deliveryAmt * (parseFloat(deliveryTaxRate) || 0) / 100;
  const total = Math.round(sub - discAmt + taxTotal + deliveryAmt + deliveryTax - tdsAmt + (parseFloat(adj) || 0));
  return { sub, taxTotal, discAmt, tdsAmt, deliveryAmt, deliveryTax, total };
}

export default function Quotations({ user, perms, ownerId, settings }) {
  const canCreate = perms?.can('Quotations', 'create') === true;
  const canEdit = perms?.can('Quotations', 'edit') === true;
  const canDelete = perms?.can('Quotations', 'delete') === true;

  const [tab, setTab] = useState('all');
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState(false);
  const [editData, setEditData] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [printing, setPrinting] = useState(null);
  const [custModal, setCustModal] = useState(false);
  const [newCustForm, setNewCustForm] = useState(EMPTY_CUSTOMER);
  const [saving, setSaving] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const toast = useToast();

  const { data, isLoading } = db.useQuery({
    quotes: { $: { where: { userId: ownerId } } },
    products: { $: { where: { userId: ownerId } } },
    customers: { $: { where: { userId: ownerId }, limit: 10000 } },
    userProfiles: { $: { where: { userId: ownerId } } },
    teamMembers: { $: { where: { userId: ownerId } } },
    partnerApplications: { $: { where: { userId: ownerId, status: 'Approved' } } },
  });
  const quotes = useMemo(() => {
    return data?.quotes || [];
  }, [data?.quotes]);

  const products = data?.products || [];
  const customers = data?.customers || [];
  const team = data?.teamMembers || [];

  const [modalLeads, setModalLeads] = useState([]);
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
  const profile = data?.userProfiles?.[0] || {};
  const wonStage = profile.wonStage || 'Won';
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

  const filtered = useMemo(() => {
    return quotes.filter(q => tab === 'all' || q.status === tab)
      .filter(q => {
        if (!search) return true;
        const s = search.toLowerCase();
        const items = Array.isArray(q.items) ? q.items : (q.items ? JSON.parse(q.items) : []);
        return [q.no, q.client, q.status, q.notes, q.terms].some(v => (v || '').toLowerCase().includes(s)) ||
               items.some(it => (it.name || '').toLowerCase().includes(s));
      })
      .sort((a, b) => (b.createdAt || new Date(b.date || 0).getTime()) - (a.createdAt || new Date(a.date || 0).getTime())); // newest first
  }, [quotes, tab, search]);

  const totalPages = pageSize === 'all' ? 1 : Math.ceil(filtered.length / pageSize);
  const paginated = useMemo(() => {
    if (pageSize === 'all') return filtered;
    const start = (currentPage - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, currentPage, pageSize]);

  useEffect(() => { setCurrentPage(1); }, [tab, search]);

  const tots = calcTotals(form.items, form.disc, form.tdsRate, form.adj, form.deliveryCharge, form.deliveryTaxRate);
  const curSym = currencySymbol(form.currency || 'INR');

  const openCreate = () => {
    fetchModalLeads();
    setEditData(null);
    const nextNo = `QUOTE/${new Date().getFullYear()}/${String(quotes.length + 1).padStart(3, '0')}`;
    const defTax = profile?.defaultTaxRate || 0;
    
    // Default 14-day validity
    const d = new Date();
    d.setDate(d.getDate() + 14);
    const defDue = d.toISOString().split('T')[0];
    
    setForm({ ...EMPTY, no: nextNo, validUntil: defDue, terms: profile?.qTerms || '', notes: profile?.qNotes || '', currency: profile?.defaultCurrency || 'INR', items: [{ name: '', desc: '', qty: 1, unit: 'Nos', rate: 0, taxRate: defTax }] });
    setModal(true); 
  };
  const openEdit = (q) => {
    fetchModalLeads();
    setEditData(q);
    const normalizedItems = Array.isArray(q.items) ? q.items : (typeof q.items === 'string' ? JSON.parse(q.items) : []);
    
    setForm({ 
      no: q.no || '', client: q.client, validUntil: q.validUntil || '', status: q.status, 
      notes: q.notes || '', terms: q.terms || '', disc: q.disc || 0, adj: q.adj || 0, tdsRate: q.tdsRate || 0, 
      items: normalizedItems.length ? normalizedItems : EMPTY.items, 
      isAmc: !!q.amcStart || !!q.isAmc, 
      amcCycle: q.amcCycle || 'Yearly', 
      amcStart: q.amcStart || '', 
      amcEnd: q.amcEnd || '', 
      amcPlan: q.amcPlan || '', 
      amcAmount: q.amcAmount || '', 
      amcTaxRate: q.amcTaxRate || 0,
      shipTo: q.shipTo || '', addShipping: !!q.shipTo, assign: q.assign || '',
      currency: q.currency || profile?.defaultCurrency || 'INR',
      deliveryCharge: q.deliveryCharge || 0,
      deliveryTaxRate: q.deliveryTaxRate || 0,
      addDelivery: !!(q.deliveryCharge && q.deliveryCharge > 0),
      distributorId: q.distributorId || '',
      retailerId: q.retailerId || ''
    });
    setModal(true);
  };

  const handleAmcStartChange = (val) => {
    let endDate = form.amcEnd;
    if (val && form.amcCycle !== 'Custom') {
      const d = new Date(val);
      if (form.amcCycle === 'Monthly') d.setMonth(d.getMonth() + 1);
      else if (form.amcCycle === 'Yearly') d.setFullYear(d.getFullYear() + 1);
      d.setDate(d.getDate() - 1);
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
    if (editData && !canEdit) { toast('Permission denied: cannot edit quotations', 'error'); return; }
    if (!editData && !canCreate) { toast('Permission denied: cannot create quotations', 'error'); return; }
    if (!form.client) { toast('Client required', 'error'); return; }
    const validItems = (form.items || []).filter(it => it.name?.trim());
    if (validItems.length === 0) { toast('Add at least one item with a product name', 'error'); return; }
    if (profile.reqShipping === 'Mandatory' && !form.shipTo?.trim()) { toast('Shipping Address is required', 'error'); return; }
    
    const { addShipping, addDelivery, ...qPayload } = form;
    if (profile.reqShipping === 'Hidden' || (!addShipping && profile.reqShipping !== 'Mandatory')) {
      qPayload.shipTo = '';
    }
    if (!addDelivery) {
      qPayload.deliveryCharge = 0;
      qPayload.deliveryTaxRate = 0;
    }

    const payload = { 
      ...qPayload, 
      userId: ownerId, 
      actorId: user.id, 
      date: editData ? editData.date : new Date().toISOString().split('T')[0], 
      total: tots.total, 
      sub: tots.sub, 
      taxAmt: tots.taxTotal 
    };
    
    // AMC handling
    if (form.isAmc && form.amcStart && form.amcEnd) {
      payload.amcStart = form.amcStart;
      payload.amcEnd = form.amcEnd;
      payload.amcCycle = form.amcCycle;
      payload.amcPlan = form.amcPlan;
      payload.amcDetails = form.amcPlan; // For spreadsheet template
      payload.amcAmount = form.amcAmount;
      payload.amcTaxRate = form.amcTaxRate;
    }

    if (!payload.no) {
      payload.no = editData ? editData.no : `QUOTE/${new Date().getFullYear()}/${String(quotes.length + 1).padStart(3, '0')}`;
    }

    setSaving(true);
    const txs = [];
    const qId = editData ? editData.id : id();
    txs.push(dbOp.update('quotes', qId, payload));

    // Handle AMC contract creation
    if (form.isAmc && form.amcStart && form.amcEnd) {
      const amcId = id();
      txs.push(dbOp.update('amcs', amcId, {
        id: amcId,
        userId: ownerId,
        actorId: user.id,
        client: payload.client,
        productId: form.amcProductId || '',
        sku: form.amcSku || '',
        plan: form.amcPlan,
        amount: parseFloat(form.amcAmount) || 0,
        taxRate: parseFloat(form.amcTaxRate) || 0,
        startDate: form.amcStart,
        endDate: form.amcEnd,
        billingCycle: form.amcCycle,
        status: 'Active',
        createdAt: Date.now(),
        sourceId: qId,
        sourceType: 'Quotation'
      }));
    }

    const lMatch = modalLeads.find(l => (l.name || '').trim().toLowerCase() === (form.client || '').trim().toLowerCase() && l.stage !== wonStage);
    if (lMatch) {
       if (payload.status === 'Sent') {
          txs.push(dbOp.update('leads', lMatch.id, { 
             stage: 'Quotation Sent',
             email: lMatch.email || payload.email || '',
             phone: lMatch.phone || payload.phone || '',
             stageChangedAt: Date.now()
          }));
          txs.push(dbOp.update('activityLogs', id(), {
             entityId: lMatch.id, entityType: 'lead', text: 'Stage changed to Quotation Sent (via Quotation)',
             userId: ownerId, actorId: user.id, userName: user.email, createdAt: Date.now()
          }));
       } else if (payload.status === 'Draft' || payload.status === 'Created') {
           txs.push(dbOp.update('leads', lMatch.id, { 
              stage: 'Quotation Created',
              email: lMatch.email || payload.email || '',
              phone: lMatch.phone || payload.phone || '',
              stageChangedAt: Date.now()
           }));
           txs.push(dbOp.update('activityLogs', id(), {
              entityId: lMatch.id, entityType: 'lead', text: 'Stage changed to Quotation Created (via Quotation)',
              userId: ownerId, actorId: user.id, userName: user.email, createdAt: Date.now()
           }));
        }
    }

    try {
      await dbWrite(txs);

      // Track team activity (per-module performance)
      const myMember = (data?.teamMembers || []).find(t => t.email === user.email);
      await logActivity({
        entityType: 'quotation',
        entityId: qId,
        entityName: payload.no || form.client,
        action: editData ? 'edited' : 'created',
        text: editData
          ? `Edited quotation **${payload.no}** for ${form.client} (${fmt(tots.total, form.currency)})`
          : `Created quotation **${payload.no}** for ${form.client} (${fmt(tots.total, form.currency)})`,
        userId: ownerId,
        user,
        teamMemberId: myMember?.id || null,
        meta: { amount: tots.total, status: payload.status },
      });

      // Email Recipient Warning
      if (payload.status === 'Sent') {
        const lMatch = modalLeads.find(l => (l.name || '').trim().toLowerCase() === (form.client || '').trim().toLowerCase());
        const cMatch = customers.find(c => (c.name || '').trim().toLowerCase() === (form.client || '').trim().toLowerCase());
        const targetEmail = lMatch?.email || cMatch?.email;
        if (!targetEmail) {
          toast('Quotation saved, but client has no email address. Automated email was skipped.', 'warning');
        } else {
          toast('Quotation saved', 'success');
        }
      } else {
        toast('Quotation saved', 'success');
      }
      
      // WhatsApp auto-notification for new quotation
      if (!editData) {
        const qProfile = data?.userProfiles?.[0];
        const lMatch2 = modalLeads.find(l => (l.name || '').trim().toLowerCase() === (form.client || '').trim().toLowerCase());
        const cMatch2 = customers.find(c => (c.name || '').trim().toLowerCase() === (form.client || '').trim().toLowerCase());
        const recipientPhone = lMatch2?.phone || cMatch2?.phone;
        if (qProfile && recipientPhone) {
          fireAutoNotifications('quotation_created', {
            client: form.client,
            phone: recipientPhone,
            clientphoneno: recipientPhone,
            leadphoneno: recipientPhone,
            quoteno: payload.no,
            amount: tots.total,
            date: new Date().toISOString().split('T')[0],
            validuntil: form.validUntil || '',
            bizName: qProfile.bizName || qProfile.businessName || '',
            ownerPhone: qProfile.waNotifPhone || qProfile.phone || '',
            entityId: payload.no,
          }, qProfile, ownerId).catch(() => {});
        }
      }

      setModal(false);
    } catch { toast('Error saving quotation', 'error'); }
    finally { setSaving(false); }
  };

  const del = async (qid) => { 
    if (!canDelete) { toast('Permission denied: cannot delete quotations', 'error'); return; }
    if (!confirm('Delete this quotation? All associated records and activity logs will be removed.')) return;
    try {
      const res = await fetch('/api/data', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          module: 'quotations',
          ownerId,
          actorId: user.id,
          userName: user.email,
          id: qid,
          logText: `Quotation ${quotes.find(q => q.id === qid)?.no} deleted`
        })
      });
      if (!res.ok) throw new Error('Failed to delete quotation');
      toast('Quotation deleted', 'error');
    } catch (e) {
      toast('Error deleting quotation', 'error');
    }
  };

  const updateItem = (i, k, v) => {
    let newIt = { ...form.items[i], [k]: k === 'name' || k === 'desc' ? v : parseFloat(v) || 0 };
    if (k === 'name') {
      const pMatch = products.find(p => p.name === v);
      if (pMatch) newIt = { ...newIt, rate: pMatch.rate || 0, taxRate: pMatch.tax || 0, unit: pMatch.unit || 'Nos' };
    }
    const items = form.items.map((it, idx) => idx === i ? newIt : it);
    setForm(p => ({ ...p, items }));
  };
  const addItem = () => setForm(p => ({ ...p, items: [...p.items, { name: '', desc: '', qty: 1, unit: 'Nos', rate: 0, taxRate: profile?.defaultTaxRate || 0 }] }));
  const removeItem = (i) => setForm(p => ({ ...p, items: p.items.filter((_, idx) => idx !== i) }));

  const convertToInvoice = async (q) => {
    if (!canEdit) { toast('Permission denied: cannot convert quotations', 'error'); return; }
    if (!confirm('Convert to Invoice?')) return;
    try {
      const invNo = `INV/${new Date().getFullYear()}/${String(Math.floor(Math.random()*1000)).padStart(3, '0')}`;
      const payload = { ...q, no: invNo, status: 'Draft', createdAt: Date.now() };
      delete payload.id;
      
      const txs = [
        dbOp.update('invoices', id(), payload),
        dbOp.update('quotes', q.id, { status: 'Completed' })
      ];

      // Sync lead stage
      const lMatch = modalLeads.find(l => l.name === q.client && l.stage !== wonStage);
      if (lMatch) {
        txs.push(dbOp.update('leads', lMatch.id, { 
           stage: 'Invoice Created',
           email: lMatch.email || q.email || '',
           phone: lMatch.phone || q.phone || '',
           stageChangedAt: Date.now()
        }));
        txs.push(dbOp.update('activityLogs', id(), {
           entityId: lMatch.id, entityType: 'lead', text: `Quotation converted to Invoice (${invNo}). Stage changed to Invoice Created.`,
           userId: ownerId, actorId: user.id, userName: user.email, createdAt: Date.now()
        }));
      }

      await dbWrite(txs);
      toast('Converted to Invoice successfully!', 'success');
    } catch { toast('Error converting', 'error'); }
  };

  // Auto-fill shipping address when client changes
  useEffect(() => {
    if (form.client && !editData && profile?.reqShipping !== 'Hidden') {
      const match = customers.find(c => c.name === form.client);
      if (match && match.address) {
        setForm(p => ({ ...p, shipTo: match.address, addShipping: profile?.reqShipping === 'Mandatory' ? true : p.addShipping }));
      }
    }
  }, [form.client, customers, editData, profile?.reqShipping]);

  if (printing) {
    const clientMatch = customers.find(c => c.name === printing.client) || modalLeads.find(l => l.name === printing.client);
    const dataWithContext = {
      ...printing,
      items: (Array.isArray(printing.items) ? printing.items : JSON.parse(printing.items || '[]')).map(it => ({
        ...it,
        name: products.find(p => p.id === it.productId || p.name === it.name)?.name || it.name
      })),
      clientDetails: clientMatch,
      companyName: clientMatch?.companyName || '',
      template: printing.template || profile?.quotationTemplate || 'Classic'
    };

    return (
      <div className="quotation-print-container">
        <DocumentTemplate 
          data={dataWithContext} 
          profile={profile} 
          type="Quotation" 
          settings={settings}
        />
        <div className="no-print" style={{ marginTop: 40, textAlign: 'center', paddingBottom: 40, display: 'flex', justifyContent: 'center', gap: 10 }}>
          <button className="btn btn-primary" onClick={() => window.print()}>Print / Save PDF</button>
          <button className="btn btn-secondary" onClick={() => window.print()}>Download PDF</button>
          <button className="btn btn-secondary" onClick={() => { 
            const q = printing;
            setPrinting(null);
            openEdit(q);
          }}>Edit Quotation</button>
          <button className="btn btn-secondary" onClick={() => setPrinting(null)}>Close</button>
        </div>
      </div>
    );
  }

  if (isLoading) return <div className="p-xl">Loading...</div>;

  return (
    <div>
      <div className="sh">
        <div><h2>Quotations</h2></div>
        {canCreate && <button className="btn btn-primary btn-sm" onClick={openCreate}>+ Create</button>}
      </div>
      <div className="tabs">
        {['all', 'Created', 'Sent', 'Completed', 'Cancelled'].map(t => (
          <div key={t} className={`tab${tab === t ? ' active' : ''}`} onClick={() => setTab(t)}>{t === 'all' ? 'All' : t}</div>
        ))}
      </div>
      <div className="tw">
        <div className="tw-head">
          <h3>Quotations ({filtered.length})</h3>
          <div className="sw">
            <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
            <input className="si" placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>
        <div className="tw-scroll">
          <table>
            <thead><tr><th>#</th><th>Quote No.</th><th>Client</th><th>Status</th><th>Date</th><th>Valid Until</th><th>Amount</th><th>Actions</th></tr></thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={8} style={{ textAlign: 'center', padding: 28, color: 'var(--muted)' }}>No quotations yet</td></tr>
              ) : paginated.map((q, i) => (
                <tr key={q.id}>
                  <td style={{ color: 'var(--muted)', fontSize: 11 }}>{i + 1}</td>
                  <td>
                    <strong 
                      style={{ fontSize: 12, cursor: 'pointer', color: 'var(--accent2)', textDecoration: 'underline' }} 
                      onClick={() => setPrinting(q)}
                    >
                      {q.no}
                    </strong>
                  </td>
                  <td>{q.client}</td>
                  <td><span className={`badge ${stageBadgeClass(q.status)}`}>{q.status}</span></td>
                  <td style={{ fontSize: 12 }}>{fmtD(q.date)}</td>
                  <td style={{ fontSize: 12 }}>{fmtD(q.validUntil)}</td>
                  <td style={{ fontWeight: 700 }}>{fmt(q.total, q.currency)}</td>
                  <td>
                    <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 4 }}>
                      <button className="btn btn-secondary btn-sm" onClick={() => setPrinting(q)}>View</button>
                      {canEdit && <button className="btn btn-secondary btn-sm" onClick={() => openEdit(q)}>Edit</button>}
                      <button className="btn-icon" onClick={(e) => {
                        const dm = e.currentTarget.nextElementSibling;
                        document.querySelectorAll('.dd-menu').forEach(el => el !== dm && (el.style.display = 'none'));
                        dm.style.display = dm.style.display === 'block' ? 'none' : 'block';
                      }}>⋮</button>
                      <div className="dd-menu" style={{ display: 'none', position: 'absolute', right: 0, top: 28, background: '#fff', border: '1px solid var(--border)', borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,0.1)', zIndex: 10, width: 140, overflow: 'hidden' }}>
                        <div style={{ padding: '8px 12px', fontSize: 12, cursor: 'pointer', borderBottom: '1px solid var(--border)' }} onClick={() => { setPrinting(q); document.querySelectorAll('.dd-menu').forEach(el => el.style.display = 'none'); }}>📄 View / PDF</div>
                        {canEdit && <div style={{ padding: '8px 12px', fontSize: 12, cursor: 'pointer', borderBottom: '1px solid var(--border)' }} onClick={() => { convertToInvoice(q); document.querySelectorAll('.dd-menu').forEach(el => el.style.display = 'none'); }}>💵 Convert to Invoice</div>}
                        {canDelete && <div style={{ padding: '8px 12px', fontSize: 12, cursor: 'pointer', color: '#dc2626' }} onClick={() => { del(q.id); document.querySelectorAll('.dd-menu').forEach(el => el.style.display = 'none'); }}>🗑 Delete</div>}
                      </div>
                    </div>
                  </td>
                </tr>
              ))}
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

      {/* MODAL */}
      {modal && (
        <div className="mo open fullpage">
          <div className="mo-box wide fullpage">
            <div className="mo-head">
              <h3>{editData ? 'Edit Quotation' : 'Create Quotation'}</h3>
              <button className="btn-icon" onClick={() => setModal(false)}>✕</button>
            </div>
            <div className="mo-body">
              <div className="fgrid" style={{ gridTemplateColumns: '1fr 2fr 1fr 1fr 1fr' }}>
                <div className="fg">
                  <label>Quote No.</label>
                  <input value={form.no} onChange={e => setForm(p => ({ ...p, no: e.target.value }))} placeholder="QUOTE/..." />
                </div>
                <div className="fg">
                  <label>Client / Lead *</label>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <div style={{ flex: 1 }}>
                      <SearchableSelect 
                        options={clientOptions} 
                        displayKey="displayName" 
                        returnKey="name"
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
                <div className="fg"><label>Valid Until</label><input type="date" value={form.validUntil} onChange={e => setForm(p => ({ ...p, validUntil: e.target.value }))} /></div>
                <div className="fg"><label>Status</label>
                  <select value={form.status} onChange={e => setForm(p => ({ ...p, status: e.target.value }))}>
                    {['Created', 'Sent', 'Completed', 'Cancelled'].map(s => <option key={s}>{s}</option>)}
                  </select>
                </div>
                <div className="fg">
                  <label>Assign To</label>
                  <select value={form.assign} onChange={e => setForm(p => ({ ...p, assign: e.target.value }))}>
                    <option value="">Unassigned</option>
                    {team.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
                  </select>
                </div>
                {(data?.partnerApplications || []).length > 0 && (
                  <>
                    <div className="fg" style={{ zIndex: 8 }}>
                      <label>Distributor <span style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 400 }}>auto-mapped</span></label>
                      <SearchableSelect
                        options={[{ id: '', name: '-- None --' }, ...(data?.partnerApplications || []).filter(p => p.role === 'Distributor').map(p => ({ id: p.id, name: p.companyName || p.name }))]}
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
                          ...(data?.partnerApplications || []).filter(p => p.role === 'Retailer' && (!form.distributorId || p.parentDistributorId === form.distributorId)).map(p => ({ id: p.id, name: `${p.companyName || p.name}${p.parentDistributorId ? ` (${(data?.partnerApplications || []).find(d => d.id === p.parentDistributorId)?.companyName || (data?.partnerApplications || []).find(d => d.id === p.parentDistributorId)?.name || ''})` : ''}` }))
                        ]}
                        displayKey="name"
                        returnKey="id"
                        value={form.retailerId}
                        onChange={val => {
                          const retailer = (data?.partnerApplications || []).find(p => p.id === val);
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

              {/* AMC Section */}
              <div style={{ background: '#f0f9ff', padding: 15, borderRadius: 8, border: '1px solid #bae6fd', marginBottom: 20 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontWeight: 600, fontSize: 13, color: '#0369a1' }}>
                  <input type="checkbox" checked={form.isAmc} onChange={e => setForm(p => ({ ...p, isAmc: e.target.checked }))} style={{ width: 16, height: 16 }} />
                  Automatically generate AMC Contract for this Quotation
                </label>
                {form.isAmc && (
                  <div className="fgrid" style={{ marginTop: 15, marginBottom: 0 }}>
                    <div className="fg"><label>Plan Name</label><input value={form.amcPlan} onChange={e => setForm(p => ({ ...p, amcPlan: e.target.value }))} placeholder="e.g. Basic Support" /></div>
                    <div className="fg">
                      <label>Cycle</label>
                      <select value={form.amcCycle} onChange={e => handleAmcCycleChange(e.target.value)}>
                        <option>Monthly</option>
                        <option>Yearly</option>
                        <option>Custom</option>
                      </select>
                    </div>
                    <div className="fg"><label>Amount</label><input type="number" value={form.amcAmount} onChange={e => setForm(p => ({ ...p, amcAmount: e.target.value }))} /></div>
                    <div className="fg">
                      <label>Tax (%)</label>
                      <select value={form.amcTaxRate} onChange={e => setForm(p => ({ ...p, amcTaxRate: parseFloat(e.target.value) || 0 }))}>
                        {taxRates.map(t => <option key={t.label} value={t.rate}>{t.label}</option>)}
                      </select>
                    </div>
                    <div className="fg"><label>Start Date</label><input type="date" value={form.amcStart} onChange={e => handleAmcStartChange(e.target.value)} /></div>
                    <div className="fg"><label>End Date</label><input type="date" value={form.amcEnd} onChange={e => setForm(p => ({ ...p, amcEnd: e.target.value }))} /></div>
                  </div>
                )}
              </div>

              {/* Line Items */}
              <div style={{ marginTop: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 7 }}>
                  <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase' }}>Item Details</label>
                  <button className="btn btn-secondary btn-sm" onClick={addItem}>+ Add Row</button>
                </div>
                <table className="li-table">
                  <thead><tr><th>Item</th><th style={{ width: 95, textAlign: 'center' }}>Qty</th><th style={{ width: 80 }}>Unit</th><th style={{ width: 90, textAlign: 'right' }}>Rate</th><th style={{ width: 160 }}>Tax</th><th style={{ width: 80, textAlign: 'right' }}>Amount</th><th style={{ width: 28 }}></th></tr></thead>
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
                                    toast(`Warning: product priced in ${pMatch.currency} but quotation is in ${prev.currency}`, 'warning');
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
                        <td>
                          <select className="li-input" value={it.taxRate} onChange={e => updateItem(i, 'taxRate', e.target.value)}>
                            {taxRates.map(t => <option key={t.label} value={t.rate}>{t.label}</option>)}
                          </select>
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 700, fontSize: 12 }}>{((it.qty || 0) * (it.rate || 0)).toFixed(2)}</td>
                        <td><button onClick={() => removeItem(i)} style={{ background: '#fee2e2', color: '#991b1b', border: 'none', borderRadius: 5, cursor: 'pointer', width: 22, height: 22 }}>✕</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Totals & Notes */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, marginTop: 14 }}>
                <div>
                  <div className="fg"><label>Notes</label><textarea value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} style={{ minHeight: 60 }} placeholder="Customer notes..." /></div>
                  <div className="fg"><label>Terms & Conditions</label><textarea value={form.terms} onChange={e => setForm(p => ({ ...p, terms: e.target.value }))} style={{ minHeight: 120 }} /></div>
                </div>
                <div className="totals-box">
                  <div className="total-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ color: 'var(--muted)', fontSize: 13 }}>Currency</span>
                    <select value={form.currency || 'INR'} onChange={e => setForm(p => ({ ...p, currency: e.target.value }))} style={{ border: '1px solid var(--border)', background: '#fff', borderRadius: 4, padding: '3px 6px', fontSize: 12, cursor: 'pointer' }}>
                      {SUPPORTED_CURRENCIES.map(c => <option key={c.code} value={c.code}>{c.symbol} {c.code}</option>)}
                    </select>
                  </div>
                  <div className="total-row"><span style={{ color: 'var(--muted)' }}>Sub Total</span><span style={{ fontWeight: 700 }}>{fmt(tots.sub, form.currency)}</span></div>
                  <div className="total-row">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ color: 'var(--muted)', fontSize: 12 }}>Discount</span>
                      <input type="number" value={form.disc} onChange={e => setForm(p => ({ ...p, disc: parseFloat(e.target.value) || 0 }))} style={{ width: 50, padding: '2px 5px', border: '1.5px solid var(--border)', borderRadius: 6, fontSize: 12, fontFamily: 'inherit', outline: 'none' }} />
                      <span style={{ fontSize: 11, color: 'var(--muted)' }}>%</span>
                    </div>
                    <span style={{ color: '#dc2626', fontSize: 12 }}>- {fmt(tots.discAmt, form.currency)}</span>
                  </div>
                  {(() => {
                    const clientMatchForm = customers.find(c => c.name === form.client);
                    const isInterStateForm = profile?.bizState && clientMatchForm?.state && profile.bizState !== clientMatchForm.state;
                    if (tots.taxTotal > 0) {
                      return isInterStateForm ? (
                        <div className="total-row"><span style={{ color: 'var(--muted)' }}>IGST</span><span style={{ fontWeight: 600, color: '#16a34a' }}>{fmt(tots.taxTotal, form.currency)}</span></div>
                      ) : (
                        <>
                          <div className="total-row"><span style={{ color: 'var(--muted)' }}>CGST</span><span style={{ fontWeight: 600, color: '#16a34a' }}>{fmt(tots.taxTotal / 2, form.currency)}</span></div>
                          <div className="total-row"><span style={{ color: 'var(--muted)' }}>SGST</span><span style={{ fontWeight: 600, color: '#16a34a' }}>{fmt(tots.taxTotal / 2, form.currency)}</span></div>
                        </>
                      );
                    }
                    return <div className="total-row"><span style={{ color: 'var(--muted)' }}>Tax (GST)</span><span style={{ fontWeight: 600, color: '#16a34a' }}>{fmt(0, form.currency)}</span></div>;
                  })()}
                  <div className="total-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <label style={{ color: 'var(--muted)', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                      <input type="checkbox" checked={!!form.addDelivery} onChange={e => setForm(p => ({ ...p, addDelivery: e.target.checked, deliveryCharge: e.target.checked ? p.deliveryCharge : 0, deliveryTaxRate: e.target.checked ? p.deliveryTaxRate : 0 }))} style={{ width: 14, height: 14 }} />
                      Delivery Charges
                    </label>
                    {form.addDelivery && (
                      <input type="number" value={form.deliveryCharge} onChange={e => setForm(p => ({ ...p, deliveryCharge: parseFloat(e.target.value) || 0 }))} style={{ width: 70, padding: '2px 5px', border: '1.5px solid var(--border)', borderRadius: 6, fontSize: 12, textAlign: 'right' }} placeholder="0" />
                    )}
                  </div>
                  {form.addDelivery && (
                    <div className="total-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--muted)', fontSize: 12 }}>Delivery Tax</span>
                      <select value={form.deliveryTaxRate} onChange={e => setForm(p => ({ ...p, deliveryTaxRate: parseFloat(e.target.value) || 0 }))} style={{ width: 120, padding: 3, border: '1.5px solid var(--border)', borderRadius: 6, fontSize: 12 }}>
                        {taxRates.map(t => <option key={t.label} value={t.rate}>{t.label}</option>)}
                      </select>
                    </div>
                  )}
                  {form.addDelivery && tots.deliveryTax > 0 && (
                    <div className="total-row"><span style={{ color: 'var(--muted)' }}>Delivery Tax Amt</span><span style={{ color: '#16a34a' }}>{fmt(tots.deliveryTax, form.currency)}</span></div>
                  )}
                  <div className="total-row">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ color: 'var(--muted)', fontSize: 12 }}>TDS</span>
                      <input type="number" value={form.tdsRate} onChange={e => setForm(p => ({ ...p, tdsRate: parseFloat(e.target.value) || 0 }))} style={{ width: 50, padding: '2px 5px', border: '1.5px solid var(--border)', borderRadius: 6, fontSize: 12, fontFamily: 'inherit', outline: 'none' }} />
                      <span style={{ fontSize: 11, color: 'var(--muted)' }}>%</span>
                    </div>
                    <span style={{ color: '#dc2626', fontSize: 12 }}>- {fmt(tots.tdsAmt, form.currency)}</span>
                  </div>
                  <div className="total-row">
                    <span style={{ color: 'var(--muted)', fontSize: 12 }}>Adjustment</span>
                    <input type="number" value={form.adj} onChange={e => setForm(p => ({ ...p, adj: parseFloat(e.target.value) || 0 }))} style={{ width: 70, padding: '2px 5px', border: '1.5px solid var(--border)', borderRadius: 6, fontSize: 12, fontFamily: 'inherit', outline: 'none', textAlign: 'right' }} />
                  </div>
                  <div className="total-row grand"><strong style={{ fontSize: 14 }}>Total ({curSym})</strong><strong style={{ fontSize: 18, color: 'var(--accent2)' }}>{fmt(tots.total, form.currency)}</strong></div>
                </div>
              </div>
            </div>
            <div className="mo-foot">
              <button className="btn btn-secondary btn-sm" onClick={() => setModal(false)}>Cancel</button>
              <button className="btn btn-primary btn-sm" onClick={save} disabled={saving}>
                {saving ? 'Saving...' : 'Save Quotation'}
              </button>
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
                {(data?.partnerApplications || []).length > 0 && (
                  <>
                    <div className="fg" style={{ zIndex: 8 }}>
                      <label>Distributor (Optional)</label>
                      <SearchableSelect
                        options={[{ id: '', name: '-- None --' }, ...(data?.partnerApplications || []).filter(p => p.role === 'Distributor').map(p => ({ id: p.id, name: p.companyName || p.name }))]}
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
                          ...(data?.partnerApplications || []).filter(p => p.role === 'Retailer' && (!newCustForm.distributorId || p.parentDistributorId === newCustForm.distributorId))
                            .map(p => ({ id: p.id, name: `${p.companyName || p.name}${p.parentDistributorId ? ` (${(data?.partnerApplications || []).find(d => d.id === p.parentDistributorId)?.companyName || (data?.partnerApplications || []).find(d => d.id === p.parentDistributorId)?.name || ''})` : ''}` }))
                        ]}
                        displayKey="name" returnKey="id" value={newCustForm.retailerId}
                        onChange={val => {
                          const retailer = (data?.partnerApplications || []).find(p => p.id === val);
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
              <button className="btn btn-primary btn-sm" onClick={async () => {
                if (!newCustForm.name.trim()) return toast('Name required', 'error');
                if (!newCustForm.email.trim()) return toast('Email is mandatory for clients', 'error');
                const newId = id();
                await dbWrite(dbOp.update('customers', newId, { ...newCustForm, name: newCustForm.name.trim(), companyName: newCustForm.companyName || '', userId: ownerId, actorId: user.id, createdAt: Date.now() }));
                setForm(p => ({ ...p, client: newCustForm.name.trim(), distributorId: newCustForm.distributorId || p.distributorId, retailerId: newCustForm.retailerId || p.retailerId }));
                setCustModal(false);
                setNewCustForm(EMPTY_CUSTOMER);
                toast('Customer created!', 'success');
              }}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
