import React, { useState, useMemo, useEffect } from 'react';
import { dbWrite, dbOp } from '../../utils/dbWrite';
import db from '../../instant';
import { id } from '@instantdb/react';
import { fmtD, fmt, daysLeft } from '../../utils/helpers';
import { useToast } from '../../context/ToastContext';
import { sendEmail, sendEmailMock, renderTemplate, fireAutoNotifications } from '../../utils/messaging';
import { EMPTY_CUSTOMER } from '../../utils/constants';
import SearchableSelect from '../UI/SearchableSelect';
import { logActivity } from '../../utils/activityLogger';

const EMPTY = { client: '', email: '', phone: '', contractNo: '', cycle: 'Yearly', startDate: '', endDate: '', amount: '', taxRate: 0, plan: '', unit: 'Nos', productId: '', sku: '', status: 'Active', notes: '', assign: '' };

export default function AMC({ user, perms, ownerId }) {
  const canCreate = perms?.can('AMC', 'create') === true;
  const canEdit = perms?.can('AMC', 'edit') === true;
  const canDelete = perms?.can('AMC', 'delete') === true;

  const [modal, setModal] = useState(false);
  const [editData, setEditData] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [tab, setTab] = useState('all');
  const [search, setSearch] = useState('');
  const [viewAMC, setViewAMC] = useState(null);
  const [renewModal, setRenewModal] = useState(null); // holds the AMC being renewed
  const [renewForm, setRenewForm] = useState({ paidOn: '', amount: '', cycle: 'Yearly', genInvoice: true, taxRate: 0, plan: '' });
  
  const [custModal, setCustModal] = useState(false);
  const [newCustForm, setNewCustForm] = useState(EMPTY_CUSTOMER);
  
  const toast = useToast();
  
  
  const ncf = (k) => (e) => setNewCustForm(p => ({ ...p, [k]: e.target.value }));
  const handleNewCustChange = (k, v) => setNewCustForm(p => ({ ...p, [k]: v }));
  const nccf = (k) => (e) => setNewCustForm(p => ({ ...p, custom: { ...(p.custom || {}), [k]: e.target.value } }));

  const createCustomer = async () => {
    if (!newCustForm.name.trim()) return toast('Name required', 'error');
    if (!newCustForm.email.trim()) return toast('Email is mandatory for clients', 'error');
    const newId = id();
    const custPayload = { ...newCustForm, name: newCustForm.name.trim(), userId: ownerId, actorId: user.id, createdAt: Date.now() };
    await dbWrite(dbOp.update('customers', newId, custPayload));
    setForm(p => ({ ...p, client: custPayload.name, email: custPayload.email, phone: custPayload.phone }));
    setCustModal(false);
    setNewCustForm(EMPTY_CUSTOMER);
    toast('Customer created!', 'success');
  };

  const { data } = db.useQuery({
    amc: { $: { where: { userId: ownerId } } },
    customers: { $: { where: { userId: ownerId }, limit: 10000 } },
    invoices: { $: { where: { userId: ownerId } } },
    products: { $: { where: { userId: ownerId } } },
    userProfiles: { $: { where: { userId: ownerId } } },
    teamMembers: { $: { where: { userId: ownerId } } },
  });

  const profile = data?.userProfiles?.[0] || {};
  const customFields = profile.customFields || [];
  const team = data?.teamMembers || [];
  const amcList = useMemo(() => {
    return data?.amc || [];
  }, [data?.amc]);

  const customers = data?.customers || [];
  const products = data?.products || [];

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
  const taxRates = profile.taxRates || [{ label: 'None (0%)', rate: 0 }, { label: 'GST @ 5%', rate: 5 }, { label: 'GST @ 12%', rate: 12 }, { label: 'GST @ 18%', rate: 18 }, { label: 'GST @ 28%', rate: 28 }];

  // Keep viewAMC in sync with live data
  const liveViewAMC = viewAMC ? amcList.find(a => a.id === viewAMC.id) : null;

  useEffect(() => {
    const openId = localStorage.getItem('tc_open_amc');
    if (openId && amcList.length > 0) {
      const target = amcList.find(a => a.id === openId);
      if (target) {
        setViewAMC(target);
        localStorage.removeItem('tc_open_amc');
      }
    }
  }, [amcList]);

  const filtered = useMemo(() => {
    const now = new Date();
    return amcList.filter(a => {
      if (tab === 'expiring') { const d = daysLeft(a.endDate); return d <= 30 && d >= 0; }
      if (tab === 'expired') return new Date(a.endDate) < now && !(a.renewedAt && a.renewedAt > new Date(a.endDate).getTime());
      if (tab === 'active') return a.status === 'Active' && new Date(a.endDate) >= now;
      if (tab === 'renewed') return !!(a.renewals && a.renewals.length > 0);
      if (tab === 'followup') return a.needsFollowUp;
      return true;
    }).filter(a => {
      if (!search) return true;
      const q = search.toLowerCase();
      return [a.client, a.email, a.phone, a.contractNo, a.plan, a.status].some(v => (v || '').toLowerCase().includes(q));
    })
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)); // newest first
  }, [amcList, tab, search]);

  const f = (k) => (e) => setForm(p => ({ ...p, [k]: e.target.value }));

  const handleStartDateChange = (val) => {
    let endDate = form.endDate;
    if (val && form.cycle !== 'Custom') {
      const d = new Date(val);
      if (form.cycle === 'Monthly') d.setMonth(d.getMonth() + 1);
      else if (form.cycle === 'Quarterly') d.setMonth(d.getMonth() + 3);
      else if (form.cycle === 'Yearly') d.setFullYear(d.getFullYear() + 1);
      d.setDate(d.getDate() - 1);
      endDate = d.toISOString().split('T')[0];
    }
    setForm(p => ({ ...p, startDate: val, endDate }));
  };

  const handleCycleChange = (val) => {
    let endDate = form.endDate;
    if (form.startDate && val !== 'Custom') {
      const d = new Date(form.startDate);
      if (val === 'Monthly') d.setMonth(d.getMonth() + 1);
      else if (val === 'Quarterly') d.setMonth(d.getMonth() + 3);
      else if (val === 'Yearly') d.setFullYear(d.getFullYear() + 1);
      d.setDate(d.getDate() - 1);
      endDate = d.toISOString().split('T')[0];
    }
    setForm(p => ({ ...p, cycle: val, endDate }));
  };

  const clientOptions = useMemo(() => {
    return [
      ...customers.map(c => ({ ...c, isLead: false, displayName: c.companyName ? `${c.companyName} (${c.name})` : c.name })),
      ...modalLeads.map(l => ({ ...l, isLead: true, displayName: l.companyName ? `${l.companyName} (${l.name}) (Lead)` : `${l.name} (Lead)` }))
    ];
  }, [customers, modalLeads]);

  const handleClientSelect = (cName) => {
    const cust = customers.find(c => c.name === cName);
    setForm(p => ({
      ...p,
      client: cName,
      email: cust ? cust.email : p.email,
      phone: cust && cust.phone ? cust.phone : p.phone
    }));
  };

  const save = async () => {
    if (editData && !canEdit) { toast('Permission denied: cannot edit AMC', 'error'); return; }
    if (!editData && !canCreate) { toast('Permission denied: cannot create AMC', 'error'); return; }
    if (!form.client.trim()) { toast('Client required', 'error'); return; }
    const payload = { ...form, amount: parseFloat(form.amount) || 0, taxRate: parseFloat(form.taxRate) || 0, userId: ownerId, actorId: user.id };
    // Auto-assign contract number if empty
    if (!payload.contractNo || !payload.contractNo.trim()) {
      const existingNos = amcList.map(a => {
        const m = (a.contractNo || '').match(/^AMC(\d+)$/);
        return m ? parseInt(m[1], 10) : 0;
      });
      const maxNo = existingNos.length > 0 ? Math.max(...existingNos) : 50000;
      payload.contractNo = `AMC${maxNo + 1}`;
    }
    const myMember = team.find(t => t.email === user.email);
    const teamMemberId = myMember?.id || null;
    if (editData) {
      await dbWrite(dbOp.update('amc', editData.id, payload));
      await logActivity({
        entityType: 'amc', entityId: editData.id, entityName: payload.contractNo || payload.client,
        action: 'edited', text: `Edited AMC **${payload.contractNo}** (${payload.client}, ₹${payload.amount})`,
        userId: ownerId, user, teamMemberId,
        meta: { amount: payload.amount, status: payload.status },
      });
      toast('AMC updated', 'success');

      // WhatsApp expiry alert — fire if contract is expiring within 30 days
      if (payload.phone && daysLeft(payload.endDate) <= 30) {
        fireAutoNotifications('amc_expiry', {
          client: payload.client,
          phone: payload.phone,
          clientphoneno: payload.phone,
          contractNo: payload.contractNo,
          endDate: payload.endDate,
          daysLeft: String(Math.max(0, daysLeft(payload.endDate))),
          amount: payload.amount,
          plan: payload.plan || '',
          date: new Date().toISOString().split('T')[0],
          bizName: profile?.bizName || profile?.businessName || '',
          ownerPhone: profile?.waNotifPhone || profile?.phone || '',
          entityId: `${payload.contractNo}-${payload.endDate}`,
        }, profile, ownerId).catch(() => {});
      }
    }
    else {
      const newAmcId = id();
      const txs = [dbOp.update('amc', newAmcId, payload)];
      const wonStage = profile.wonStage || 'Won';
      const lMatch = modalLeads.find(l => (l.name || '').trim().toLowerCase() === (payload.client || '').trim().toLowerCase() && l.stage !== wonStage);
      if (lMatch) {
        txs.push(dbOp.update('leads', lMatch.id, { 
           stage: wonStage,
           email: lMatch.email || payload.email || '',
           phone: lMatch.phone || payload.phone || ''
        }));
        txs.push(dbOp.update('activityLogs', id(), {
           entityId: lMatch.id, entityType: 'lead', text: `AMC Contract created (${payload.contractNo || 'N/A'}). Stage changed to ${wonStage}.`,
           userId: ownerId, actorId: user.id, userName: user.email, createdAt: Date.now()
        }));
      }
      await dbWrite(txs);
      await logActivity({
        entityType: 'amc', entityId: newAmcId, entityName: payload.contractNo || payload.client,
        action: 'created', text: `Created AMC **${payload.contractNo}** for ${payload.client} (₹${payload.amount})`,
        userId: ownerId, user, teamMemberId,
        meta: { amount: payload.amount, status: payload.status },
      });
      toast('AMC contract created', 'success');

      // WhatsApp expiry alert — fire immediately if contract is already expiring within 30 days
      if (payload.phone && daysLeft(payload.endDate) <= 30) {
        fireAutoNotifications('amc_expiry', {
          client: payload.client,
          phone: payload.phone,
          clientphoneno: payload.phone,
          contractNo: payload.contractNo,
          endDate: payload.endDate,
          daysLeft: String(Math.max(0, daysLeft(payload.endDate))),
          amount: payload.amount,
          plan: payload.plan || '',
          date: new Date().toISOString().split('T')[0],
          bizName: profile?.bizName || profile?.businessName || '',
          ownerPhone: profile?.waNotifPhone || profile?.phone || '',
          entityId: `${payload.contractNo}-${payload.endDate}`,
        }, profile, ownerId).catch(() => {});
      }
    }
    setModal(false);
  };

  const del = async (aid) => {
    if (!canDelete) { toast('Permission denied: cannot delete AMC', 'error'); return; }
    if (!confirm('Delete?')) return;
    const a = amcList.find(x => x.id === aid);
    const txs = [dbOp.delete('amc', aid)];
    if (a) {
      const lMatch = modalLeads.find(l => l.name === a.client);
      if (lMatch) {
        txs.push(dbOp.update('activityLogs', id(), {
          entityId: lMatch.id, entityType: 'lead', text: `AMC Contract ${a.contractNo || ''} was deleted.`,
          userId: ownerId, actorId: user.id, userName: user.email, createdAt: Date.now()
        }));
      }
    }
    await dbWrite(txs);
    toast('Deleted', 'error');
  };

  // ─── RENEWAL LOGIC ───────────────────────────────────────────────
  const openRenewModal = (a) => {
    const lastRenewal = a.renewals?.length ? a.renewals[a.renewals.length - 1] : null;
    setRenewForm({
      paidOn: new Date().toISOString().split('T')[0],
      amount: String(a.amount || ''),
      cycle: a.cycle || 'Yearly',
      genInvoice: true,
      taxRate: a.taxRate || 0,
      plan: a.plan || '',
      unit: a.unit || 'Nos'
    });
    setRenewModal(a);
  };

  const handleRenewAMC = async () => {
    if (!canEdit) { toast('Permission denied: cannot renew AMC', 'error'); return; }
    if (!renewForm.paidOn) { toast('Payment date required', 'error'); return; }
    const a = renewModal;

    // Compute new period starting from current endDate + 1 day
    const prevEnd = new Date(a.endDate);
    const newStart = new Date(prevEnd);
    newStart.setDate(newStart.getDate() + 1);

    const newEnd = new Date(newStart);
    if (renewForm.cycle === 'Monthly') newEnd.setMonth(newEnd.getMonth() + 1);
    else if (renewForm.cycle === 'Quarterly') newEnd.setMonth(newEnd.getMonth() + 3);
    else if (renewForm.cycle === 'Yearly') newEnd.setFullYear(newEnd.getFullYear() + 1);
    newEnd.setDate(newEnd.getDate() - 1);

    const newStartStr = newStart.toISOString().split('T')[0];
    const newEndStr = newEnd.toISOString().split('T')[0];
    const paidAmount = parseFloat(renewForm.amount) || 0;

    // Append renewal to history
    const existingRenewals = Array.isArray(a.renewals) ? a.renewals : [];
    const newRenewal = {
      paidOn: renewForm.paidOn,
      amount: paidAmount,
      fromDate: newStartStr,
      toDate: newEndStr,
      cycle: renewForm.cycle,
      renewalNo: existingRenewals.length + 1,
      unit: renewForm.unit || 'Nos',
    };

    const txs = [
      dbOp.update('amc', a.id, {
        startDate: newStartStr,
        endDate: newEndStr,
        amount: paidAmount,
        taxRate: parseFloat(renewForm.taxRate) || 0,
        plan: renewForm.plan,
        unit: renewForm.unit || 'Nos',
        status: 'Active',
        renewedAt: Date.now(),
        renewals: [...existingRenewals, newRenewal],
      })
    ];

    // Auto-generate Invoice if enabled
    if (renewForm.genInvoice) {
      const invoiceCount = (data?.invoices || []).length;
      const invoiceNo = `INV/${new Date().getFullYear()}/${String(invoiceCount + 1).padStart(3, '0')}`;
      
      const invoicePayload = {
        userId: ownerId,
        no: invoiceNo,
        client: a.client,
        date: renewForm.paidOn,
        dueDate: renewForm.paidOn,
        status: 'Paid',
        total: Math.round(paidAmount * (1 + (parseFloat(renewForm.taxRate) || 0) / 100)),
        template: 'Classic',
        disc: 0, adj: 0, tdsRate: 0,
        items: [{
          name: a.plan || 'AMC Renewal',
          qty: 1,
          rate: paidAmount,
          taxRate: parseFloat(renewForm.taxRate) || 0
        }],
        fromAmc: true,
        notes: ''
      };

      txs.push(dbOp.update('invoices', id(), invoicePayload));
    }

    await dbWrite(txs);

    const myMember = team.find(t => t.email === user.email);
    await logActivity({
      entityType: 'amc', entityId: a.id, entityName: a.contractNo || a.client,
      action: 'renewed',
      text: `Renewed AMC **${a.contractNo}** for ${a.client} (₹${paidAmount}, ${renewForm.cycle})`,
      userId: ownerId, user, teamMemberId: myMember?.id || null,
      meta: { amount: paidAmount, status: 'Active' },
    });

    setRenewModal(null);
    toast(`AMC renewed! ${renewForm.genInvoice ? 'Invoice generated. ' : ''}New period: ${fmtD(newStartStr)} → ${fmtD(newEndStr)}`, 'success');
  };

  // ─── STATUS BADGE ─────────────────────────────────────────────────
  const getStatusBadge = (a) => {
    const d = daysLeft(a.endDate);
    const hasRenewals = a.renewals && a.renewals.length > 0;
    // If renewed recently and contract is now active
    if (d >= 0 && hasRenewals) return { label: `Renewed · Active`, cls: 'bg-blue' };
    if (d < 0 && hasRenewals) {
      // renewedAt is after old endDate — means they renewed before we updated the date (shouldn't normally happen with our logic)
      return { label: 'Renewed · Active', cls: 'bg-blue' };
    }
    if (d < 0) return { label: 'Expired', cls: 'bg-red' };
    if (d <= 30) return { label: `Expiring in ${d}d`, cls: 'bg-yellow' };
    return { label: 'Active', cls: 'bg-green' };
  };

  const getCycleDuration = (cycle) => {
    if (cycle === 'Monthly') return '1 Month';
    if (cycle === 'Quarterly') return '3 Months';
    if (cycle === 'Yearly') return '1 Year';
    return cycle;
  };

  const toggleFollowUp = async (a) => {
    if (!canEdit) { toast('Permission denied', 'error'); return; }
    await dbWrite(dbOp.update('amc', a.id, { needsFollowUp: !a.needsFollowUp }));
    toast(a.needsFollowUp ? 'Follow-up removed' : 'Marked for follow-up', 'success');
  };

  const handleSendReminder = async (a) => {
    if (!canEdit) { toast('Permission denied: cannot send reminders', 'error'); return; }
    if (!a.email) return toast('Client has no email address', 'error');
    if (!confirm(`Send reminder email to ${a.client} (${a.email})?`)) return;

    const reminders = profile.reminders || { amc: { msg: 'Hello {client}, your AMC contract is expiring on {date}.' } };
    const template = reminders.amc?.msg || 'Hello {client}, your AMC contract is expiring on {date}.';
    const emailConfig = { smtpHost: profile.smtpHost, smtpPort: profile.smtpPort, smtpUser: profile.smtpUser, smtpPass: profile.smtpPass, bizName: profile.bizName };
    const body = renderTemplate(template, { client: a.client, date: fmtD(a.endDate), contractNo: a.contractNo, bizName: profile.bizName || '' });
    const subject = 'AMC Renewal Reminder';
    try {
      toast('Sending email...', 'info');
      if (emailConfig.smtpHost && emailConfig.smtpUser && emailConfig.smtpPass) {
        const res = await sendEmail(a.email, subject, body, ownerId, profile?.bizName, ownerId);
        if (res === 'OK') toast('Reminder sent!', 'success');
        else toast('Failed to send', 'error');
      } else {
        await sendEmailMock(user.id, a.email, subject, body, { entityId: a.id, entityType: 'amc' });
        toast('Email config missing, logged to outbox.', 'warning');
      }
    } catch (e) { toast('Failed to send email', 'error'); }
  };

  const handleGenerateInvoice = async (a) => {
    if (!perms?.can('Invoices', 'create')) { toast('Permission denied: cannot create invoices', 'error'); return; }
    if (!confirm(`Generate Draft Invoice for ${a.client} (₹${a.amount})?`)) return;
    
    const invoiceCount = (data?.invoices || []).length;
    const no = `INV/${new Date().getFullYear()}/${String(invoiceCount + 1).padStart(3, '0')}`;

    const invoicePayload = {
      userId: ownerId, no, client: a.client,
      date: new Date().toISOString().split('T')[0],
      dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      status: 'Draft', template: 'Classic', 
      total: Math.round(a.amount * (1 + (a.taxRate || 0) / 100)), 
      disc: 0, adj: 0, tdsRate: 0,
      notes: '', fromAmc: true,
      items: [{ name: a.plan || 'AMC Plan', qty: 1, rate: a.amount, taxRate: a.taxRate || 0 }]
    };

    await dbWrite(dbOp.update('invoices', id(), invoicePayload));
    toast(`Draft Invoice ${no} created!`, 'success');
  };

  // ─── AMC DETAIL VIEW ─────────────────────────────────────────────
  if (liveViewAMC) {
    const a = liveViewAMC;
    const s = getStatusBadge(a);
    const renewals = Array.isArray(a.renewals) ? [...a.renewals].reverse() : [];
    const lastRenewal = a.renewals?.length ? a.renewals[a.renewals.length - 1] : null;
    const totalPaid = (Array.isArray(a.renewals) ? a.renewals : []).reduce((sum, r) => sum + (r.amount || 0), 0);

    return (
      <div>
        <div className="sh" style={{ marginBottom: 15 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button className="btn-icon" onClick={() => setViewAMC(null)}>← Back</button>
            <div>
              <h2 style={{ fontSize: 22, margin: 0 }}>{a.client}</h2>
              <div className="sub" style={{ fontSize: 12, marginTop: 3 }}>
                {a.contractNo && <span style={{ marginRight: 12 }}>📄 {a.contractNo}</span>}
                {a.email && <span style={{ marginRight: 12 }}>✉ {a.email}</span>}
                {a.phone && <span>📞 {a.phone}</span>}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {canEdit && <button className="btn btn-secondary btn-sm" onClick={() => { fetchModalLeads(); setEditData(a); setForm({ client: a.client, email: a.email || '', phone: a.phone || '', contractNo: a.contractNo || '', cycle: a.cycle || 'Yearly', startDate: a.startDate || '', endDate: a.endDate || '', amount: a.amount, taxRate: a.taxRate || 0, plan: a.plan, productId: a.productId || '', sku: a.sku || '', status: a.status, notes: a.notes || '', unit: a.unit || 'Nos' }); setModal(true); }}>Edit</button>}
            {canEdit && <button className="btn btn-primary btn-sm" onClick={() => openRenewModal(a)}>🔄 Renew AMC</button>}
          </div>
        </div>

        {/* Contract Stats */}
        <div className="stat-grid" style={{ marginBottom: 22 }}>
          <div className="stat-card sc-blue"><div className="lbl">Plan</div><div className="val" style={{ fontSize: 16 }}>{products.find(p => p.id === a.productId)?.name || a.plan || '-'}</div></div>
          <div className="stat-card sc-green"><div className="lbl">Current Amount</div><div className="val" style={{ fontSize: 16 }}>{fmt(a.amount)}</div></div>
          <div className="stat-card sc-yellow"><div className="lbl">Renewals</div><div className="val">{(a.renewals || []).length}</div></div>
          <div className="stat-card sc-teal"><div className="lbl">Total Paid</div><div className="val" style={{ fontSize: 16 }}>{fmt(totalPaid + (a.amount || 0))}</div></div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>

          {/* Contract Info */}
          <div className="tw" style={{ padding: 20 }}>
            <h3>Contract Details</h3>
            <div style={{ marginTop: 15, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {[
                ['Start Date', fmtD(a.startDate)],
                ['End Date (Current)', fmtD(a.endDate)],
                ['Cycle', a.cycle],
                ['Tax Rate', `${a.taxRate || 0}%`],
                ['Status', null],
              ].map(([label, val]) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>{label}</span>
                  {val ? <span style={{ fontSize: 13, fontWeight: 600 }}>{val}</span>
                    : <span className={`badge ${s.cls}`} style={{ fontSize: 11 }}>{s.label}</span>}
                </div>
              ))}
              {a.notes && (
                <div style={{ marginTop: 8 }}>
                  <span style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Notes</span>
                  <div style={{ fontSize: 13, background: 'var(--bg)', padding: 10, borderRadius: 8 }}>{a.notes}</div>
                </div>
              )}
            </div>
          </div>

          {/* Renewal History */}
          <div className="tw" style={{ padding: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 }}>
              <h3>Renewal History</h3>
              {renewals.length > 0 && (
                <span style={{ fontSize: 11, background: '#eff6ff', color: '#2563eb', padding: '2px 8px', borderRadius: 20, fontWeight: 700 }}>
                  {renewals.length} Renewal{renewals.length > 1 ? 's' : ''}
                </span>
              )}
            </div>

            {renewals.length === 0 ? (
              <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 13, padding: '40px 20px' }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>🔄</div>
                No renewals yet. Click "Renew AMC" to log the first renewal.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxHeight: 420, overflowY: 'auto' }}>
                {renewals.map((r, i) => {
                  const isLatest = i === 0;
                  const renewalNum = r.renewalNo || (renewals.length - i);
                  return (
                    <div key={i} style={{ background: isLatest ? '#f0fdf4' : 'var(--bg)', border: `1px solid ${isLatest ? '#86efac' : 'var(--border)'}`, borderRadius: 10, padding: '12px 14px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                        <div>
                          <span style={{ fontSize: 11, fontWeight: 700, color: isLatest ? '#16a34a' : 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                            Renewal #{renewalNum} {isLatest && '· Latest'}
                          </span>
                          <div style={{ fontSize: 13, fontWeight: 700, marginTop: 3, color: 'var(--text)' }}>
                            {fmt(r.amount)}
                          </div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <span style={{ fontSize: 10, background: '#e0f2fe', color: '#0369a1', borderRadius: 20, padding: '2px 8px', fontWeight: 700 }}>
                            {getCycleDuration(r.cycle)}
                          </span>
                          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                            Paid on {fmtD(r.paidOn)}
                          </div>
                        </div>
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ background: 'var(--surface)', padding: '2px 8px', borderRadius: 6, border: '1px solid var(--border)', fontWeight: 600 }}>{fmtD(r.fromDate)}</span>
                        <span>→</span>
                        <span style={{ background: 'var(--surface)', padding: '2px 8px', borderRadius: 6, border: '1px solid var(--border)', fontWeight: 600 }}>{fmtD(r.toDate)}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Edit Modal (reused) */}
        {modal && (
          <div className="mo open">
            <div className="mo-box wide">
              <div className="mo-head"><h3>Edit AMC Contract</h3><button className="btn-icon" onClick={() => setModal(false)}>✕</button></div>
              <div className="mo-body">
                <div className="fgrid">
                  <div className="fg" style={{ zIndex: 10 }}>
                    <label>Client *</label>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <div style={{ flex: 1 }}>
                        <SearchableSelect options={customers} displayKey="name" returnKey="name" value={form.client} onChange={handleClientSelect} placeholder="Search client..." />
                      </div>
                      <button className="btn btn-secondary" style={{ padding: '0 10px' }} onClick={() => setCustModal(true)} title="Add New Customer">+</button>
                    </div>
                  </div>
                  <div className="fg"><label>Contract No.</label><input value={form.contractNo} onChange={f('contractNo')} placeholder="AMC/2025/001" /></div>
                  <div className="fg"><label>Email</label><input type="email" value={form.email} onChange={f('email')} /></div>
                  <div className="fg"><label>Phone</label><input value={form.phone} onChange={f('phone')} /></div>
                  <div className="fg"><label>Cycle</label><select value={form.cycle} onChange={e => handleCycleChange(e.target.value)}>{['Custom', 'Monthly', 'Quarterly', 'Yearly'].map(c => <option key={c}>{c}</option>)}</select></div>
                  <div className="fg"><label>Start Date</label><input type="date" value={form.startDate} onChange={e => handleStartDateChange(e.target.value)} /></div>
                  <div className="fg"><label>End Date (Expiry)</label><input type="date" value={form.endDate} readOnly={form.cycle !== 'Custom'} onChange={e => form.cycle === 'Custom' && f('endDate')(e)} style={{ border: form.cycle !== 'Custom' ? 'none' : '', background: form.cycle !== 'Custom' ? '#f1f5f9' : '#fff' }} /></div>
                  <div className="fg" style={{ zIndex: 9 }}>
                    <label>Plan / Service</label>
                    <SearchableSelect options={products} displayKey="name" returnKey="name" value={form.plan} onChange={val => { const pMatch = products.find(p => p.name === val); setForm(prev => ({ ...prev, plan: val, amount: pMatch ? pMatch.rate : prev.amount, taxRate: pMatch ? (pMatch.tax || 0) : prev.taxRate, unit: pMatch ? (pMatch.unit || 'Nos') : prev.unit })); }} placeholder="e.g. Server AMC" />
                  </div>
                  <div className="fg"><label>Unit</label>
                    <select value={form.unit || 'Nos'} onChange={f('unit')}>
                      {(profile?.productUnits || ['Nos', 'Kgs', 'Ltrs', 'Mtrs', 'Pkt', 'Box', 'Set']).map(u => <option key={u}>{u}</option>)}
                    </select>
                  </div>
                  <div className="fg"><label>Tax (GST %)</label>
                    <select value={form.taxRate} onChange={f('taxRate')}>{taxRates.map(t => <option key={t.label} value={t.rate}>{t.label}</option>)}</select>
                  </div>
                  <div className="fg"><label>Amount (₹)</label><input type="number" value={form.amount} onChange={f('amount')} /></div>
                  <div className="fg"><label>Status</label><select value={form.status} onChange={f('status')}>{['Active', 'Expired'].map(s => <option key={s}>{s}</option>)}</select></div>
                  <div className="fg">
                    <label>Assign To</label>
                    <select value={form.assign} onChange={f('assign')}>
                      <option value="">Unassigned</option>
                      {data?.teamMembers?.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
                    </select>
                  </div>
                  <div className="fg span2"><label>Notes</label><textarea value={form.notes} onChange={f('notes')} /></div>
                </div>
              </div>
              <div className="mo-foot"><button className="btn btn-secondary btn-sm" onClick={() => setModal(false)}>Cancel</button><button className="btn btn-primary btn-sm" onClick={save}>Save</button></div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ─── LIST VIEW ────────────────────────────────────────────────────
  return (
    <div>
      <div className="sh"><div><h2>AMC Contracts</h2><div className="sub">Annual Maintenance Contracts</div></div>
        {canCreate && <button className="btn btn-primary btn-sm" onClick={() => { fetchModalLeads(); setEditData(null); setForm(EMPTY); setModal(true); }}>+ Create AMC</button>}
      </div>
      <div className="tabs">
        {[['all', 'All'], ['active', 'Active'], ['expiring', '⚠ Expiring (30d)'], ['expired', 'Expired'], ['renewed', '🔄 Renewed'], ['followup', '📌 Follow Up']].map(([t, l]) => (
          <div key={t} className={`tab${tab === t ? ' active' : ''}`} onClick={() => setTab(t)}>{l}</div>
        ))}
      </div>
      <div className="tw">
        <div className="tw-head">
          <h3>AMC Contracts ({filtered.length})</h3>
          <div className="sw">
            <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
            <input className="si" placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>
        <div className="tw-scroll">
          <table>
            <thead><tr><th>#</th><th>Contract No.</th><th>Client</th><th>Plan</th><th>Start</th><th>End (Expiry)</th><th>Amount</th><th>Status</th><th>Renewals</th><th>Phone</th><th>Actions</th></tr></thead>
            <tbody>
              {filtered.length === 0 ? <tr><td colSpan={11} style={{ textAlign: 'center', padding: 28, color: 'var(--muted)' }}>No AMC contracts</td></tr>
                : filtered.map((a, i) => {
                  const s = getStatusBadge(a);
                  const renewalCount = (a.renewals || []).length;
                  return (
                    <tr key={a.id}>
                      <td style={{ color: 'var(--muted)', fontSize: 11 }}>{i + 1}</td>
                      <td>
                        <strong style={{ cursor: 'pointer', color: 'var(--accent2)', textDecoration: 'underline' }} onClick={() => setViewAMC(a)}>{a.contractNo || '-'}</strong>
                      </td>
                      <td>
                        <div style={{ fontWeight: 600 }}>{a.client}</div>
                        <div style={{ fontSize: 10, color: 'var(--muted)' }}>{a.email}</div>
                      </td>
                      <td>
                        <div style={{ fontWeight: 600 }}>{products.find(p => p.id === a.productId)?.name || a.plan}</div>
                        <div style={{ fontSize: 10, color: 'var(--muted)' }}>{products.find(p => p.id === a.productId)?.code || a.sku || '-'}</div>
                      </td>
                      <td style={{ fontSize: 12 }}>{fmtD(a.startDate)}</td>
                      <td style={{ fontSize: 12, fontWeight: 600 }}>{fmtD(a.endDate)}</td>
                      <td style={{ fontWeight: 700 }}>{fmt(a.amount)}</td>
                      <td><span className={`badge ${s.cls}`}>{s.label}</span></td>
                      <td>
                        {renewalCount > 0
                          ? <span style={{ fontSize: 11, background: '#eff6ff', color: '#2563eb', padding: '2px 8px', borderRadius: 20, fontWeight: 700, cursor: 'pointer' }} onClick={() => setViewAMC(a)}>
                              🔄 {renewalCount}x
                            </span>
                          : <span style={{ color: 'var(--muted)', fontSize: 12 }}>-</span>}
                      </td>
                      <td style={{ fontSize: 12 }}>{a.phone || '-'}</td>
                      <td>
                        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 4 }}>
                          <button className="btn btn-secondary btn-sm" onClick={() => setViewAMC(a)}>View</button>
                          {canEdit && <button className="btn btn-primary btn-sm" style={{ fontSize: 11, padding: '4px 8px' }} onClick={() => openRenewModal(a)}>🔄 Renew</button>}
                          <button className={`btn-icon ${a.needsFollowUp ? 'text-primary' : ''}`} style={{ padding: '4px 8px', fontSize: 13 }} onClick={() => toggleFollowUp(a)}>
                            {a.needsFollowUp ? '📌' : '📍'}
                          </button>
                          {canDelete && <button className="btn-icon" style={{ background: '#fee2e2', color: '#991b1b', padding: '4px 8px', fontSize: 13 }} onClick={() => del(a.id)}>Del</button>}
                          <button className="btn-icon" onClick={(e) => {
                            const dm = e.currentTarget.nextElementSibling;
                            document.querySelectorAll('.dd-menu').forEach(el => el !== dm && (el.style.display = 'none'));
                            dm.style.display = dm.style.display === 'block' ? 'none' : 'block';
                          }}>⋮</button>
                          <div className="dd-menu" style={{ display: 'none', position: 'absolute', right: 0, top: 28, background: '#fff', border: '1px solid var(--border)', borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,0.1)', zIndex: 10, minWidth: 160, overflow: 'hidden' }}>
                            {canEdit && <div style={{ padding: '8px 12px', fontSize: 12, cursor: 'pointer', borderBottom: '1px solid var(--border)' }} onClick={() => { handleGenerateInvoice(a); document.querySelectorAll('.dd-menu').forEach(el => el.style.display = 'none'); }}>💳 Generate Invoice</div>}
                            {canEdit && <div style={{ padding: '8px 12px', fontSize: 12, cursor: 'pointer', borderBottom: '1px solid var(--border)' }} onClick={() => { handleSendReminder(a); document.querySelectorAll('.dd-menu').forEach(el => el.style.display = 'none'); }}>📧 Send Reminder</div>}
                            {canEdit && <div style={{ padding: '8px 12px', fontSize: 12, cursor: 'pointer' }} onClick={() => { setEditData(a); setForm({ client: a.client, email: a.email || '', phone: a.phone || '', contractNo: a.contractNo || '', cycle: a.cycle || 'Yearly', startDate: a.startDate || '', endDate: a.endDate || '', amount: a.amount, taxRate: a.taxRate || 0, plan: a.plan, unit: a.unit || 'Nos', status: a.status, notes: a.notes || '' }); setModal(true); document.querySelectorAll('.dd-menu').forEach(el => el.style.display = 'none'); }}>✎ Edit</div>}
                          </div>
                        </div>
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
      </div>

      {/* CREATE/EDIT MODAL */}
      {modal && (
        <div className="mo open">
          <div className="mo-box wide">
            <div className="mo-head"><h3>{editData ? 'Edit' : 'Create'} AMC Contract</h3><button className="btn-icon" onClick={() => setModal(false)}>✕</button></div>
            <div className="mo-body">
              <div className="fgrid">
                <div className="fg" style={{ zIndex: 10 }}>
                  <label>Client *</label>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <div style={{ flex: 1 }}>
                      <SearchableSelect options={customers} displayKey="name" returnKey="name" value={form.client} onChange={handleClientSelect} placeholder="Search client..." />
                    </div>
                    <button className="btn btn-secondary" style={{ padding: '0 10px' }} onClick={() => setCustModal(true)} title="Add New Customer">+</button>
                  </div>
                </div>
                <div className="fg"><label>Contract No.</label><input value={form.contractNo} onChange={f('contractNo')} placeholder="AMC/2025/001" /></div>
                <div className="fg"><label>Email</label><input type="email" value={form.email} onChange={f('email')} /></div>
                <div className="fg"><label>Phone</label><input value={form.phone} onChange={f('phone')} /></div>
                <div className="fg"><label>Cycle</label><select value={form.cycle} onChange={e => handleCycleChange(e.target.value)}>{['Custom', 'Monthly', 'Quarterly', 'Yearly'].map(c => <option key={c}>{c}</option>)}</select></div>
                <div className="fg"><label>Start Date</label><input type="date" value={form.startDate} onChange={e => handleStartDateChange(e.target.value)} /></div>
                <div className="fg"><label>End Date (Expiry)</label><input type="date" value={form.endDate} readOnly={form.cycle !== 'Custom'} onChange={e => form.cycle === 'Custom' && f('endDate')(e)} style={{ border: form.cycle !== 'Custom' ? 'none' : '', background: form.cycle !== 'Custom' ? '#f1f5f9' : '#fff' }} /></div>
                <div className="fg" style={{ zIndex: 9 }}>
                  <label>Plan / Service</label>
                                    <SearchableSelect 
                    options={products} 
                    displayKey="name" 
                    returnKey="id" 
                    value={form.productId || form.plan} 
                    onChange={val => { 
                      const pMatch = products.find(p => p.id === val || p.name === val); 
                      setForm(prev => ({ 
                        ...prev, 
                        productId: pMatch?.id || '',
                        sku: pMatch?.code || '',
                        plan: pMatch?.name || val, 
                        amount: pMatch ? pMatch.rate : prev.amount, 
                        taxRate: pMatch ? (pMatch.tax || 0) : prev.taxRate 
                      })); 
                    }} 
                    placeholder="e.g. Server AMC" 
                  />
                </div>
                <div className="fg"><label>Tax (GST %)</label>
                  <select value={form.taxRate} onChange={f('taxRate')}>{taxRates.map(t => <option key={t.label} value={t.rate}>{t.label}</option>)}</select>
                </div>
                <div className="fg"><label>Amount (₹)</label><input type="number" value={form.amount} onChange={f('amount')} /></div>
                <div className="fg"><label>Status</label><select value={form.status} onChange={f('status')}>{['Active', 'Expired'].map(s => <option key={s}>{s}</option>)}</select></div>
                <div className="fg span2"><label>Notes</label><textarea value={form.notes} onChange={f('notes')} /></div>
              </div>
            </div>
            <div className="mo-foot"><button className="btn btn-secondary btn-sm" onClick={() => setModal(false)}>Cancel</button><button className="btn btn-primary btn-sm" onClick={save}>Save</button></div>
          </div>
        </div>
      )}

      {/* RENEW MODAL */}
      {renewModal && (
        <div className="mo open">
          <div className="mo-box" style={{ width: 460 }}>
            <div className="mo-head">
              <h3>🔄 Renew AMC — {renewModal.client}</h3>
              <button className="btn-icon" onClick={() => setRenewModal(null)}>✕</button>
            </div>
            <div className="mo-body">
              {/* Last Renewal Info */}
              {renewModal.renewals && renewModal.renewals.length > 0 && (() => {
                const last = renewModal.renewals[renewModal.renewals.length - 1];
                return (
                  <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: '12px 14px', marginBottom: 18 }}>
                    <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Last Renewal</div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                      <span>Amount paid: <strong>{fmt(last.amount)}</strong></span>
                      <span>on {fmtD(last.paidOn)}</span>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
                      Period: {fmtD(last.fromDate)} → {fmtD(last.toDate)} · {getCycleDuration(last.cycle)}
                    </div>
                  </div>
                );
              })()}

              {/* Preview of new period */}
              {(() => {
                const prevEnd = new Date(renewModal.endDate);
                const newStart = new Date(prevEnd); newStart.setDate(newStart.getDate() + 1);
                const newEnd = new Date(newStart);
                if (renewForm.cycle === 'Monthly') newEnd.setMonth(newEnd.getMonth() + 1);
                else if (renewForm.cycle === 'Quarterly') newEnd.setMonth(newEnd.getMonth() + 3);
                else newEnd.setFullYear(newEnd.getFullYear() + 1);
                newEnd.setDate(newEnd.getDate() - 1);
                return (
                  <div style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 10, padding: '12px 14px', marginBottom: 18 }}>
                    <div style={{ fontSize: 11, color: '#16a34a', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>New Period (Preview)</div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
                      {newStart.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })} → {newEnd.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{getCycleDuration(renewForm.cycle)}</div>
                  </div>
                );
              })()}

              <div className="fgrid">
                <div className="fg">
                  <label>Payment Date *</label>
                  <input type="date" value={renewForm.paidOn} onChange={e => setRenewForm(p => ({ ...p, paidOn: e.target.value }))} />
                </div>
                <div className="fg">
                  <label>Renewal Cycle</label>
                  <select value={renewForm.cycle} onChange={e => setRenewForm(p => ({ ...p, cycle: e.target.value }))}>
                    {['Monthly', 'Quarterly', 'Yearly'].map(c => <option key={c}>{c}</option>)}
                  </select>
                </div>
                <div className="fg span2" style={{ zIndex: 9 }}>
                  <label>Plan / Product <span style={{ color: 'var(--muted)', fontWeight: 400, fontSize: 11 }}>— auto-fills rate &amp; GST</span></label>
                  <SearchableSelect
                    options={products}
                    displayKey="name"
                    returnKey="name"
                    value={renewForm.plan}
                    onChange={val => {
                      const pMatch = products.find(p => p.name === val);
                      setRenewForm(prev => ({
                        ...prev,
                        plan: val,
                        amount: pMatch ? String(pMatch.rate || prev.amount) : prev.amount,
                        taxRate: pMatch ? (pMatch.tax || 0) : prev.taxRate
                      }));
                    }}
                    placeholder="Select product to auto-fill rate &amp; GST"
                  />
                </div>
                <div className="fg">
                  <label>New Renewal Amount (₹) {renewModal.amount !== parseFloat(renewForm.amount) ? <span style={{ color: '#d97706', fontSize: 10, fontWeight: 700 }}>· Changed</span> : ''}</label>
                  <input type="number" value={renewForm.amount} onChange={e => setRenewForm(p => ({ ...p, amount: e.target.value }))} />
                </div>
                <div className="fg">
                  <label>Tax Rate (GST %)</label>
                  <select value={renewForm.taxRate} onChange={e => setRenewForm(p => ({ ...p, taxRate: e.target.value }))}>
                    {taxRates.map(t => <option key={t.label} value={t.rate}>{t.label}</option>)}
                  </select>
                </div>

                <div className="fg span2" style={{ marginTop: 5 }}>
                  {(() => {
                    const base = parseFloat(renewForm.amount) || 0;
                    const tax = base * (parseFloat(renewForm.taxRate) || 0) / 100;
                    const total = base + tax;
                    return (
                      <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '10px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                          Calculation: {fmt(base)} + {fmt(tax)} (GST)
                        </div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>
                          Total: {fmt(Math.round(total))}
                        </div>
                      </div>
                    );
                  })()}
                </div>

                <div className="fg span2" style={{ marginTop: 5 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                    <input 
                      type="checkbox" 
                      checked={renewForm.genInvoice} 
                      onChange={e => setRenewForm(p => ({ ...p, genInvoice: e.target.checked }))} 
                      style={{ width: 16, height: 16 }}
                    />
                    Generate Invoice for this renewal (Status: Paid)
                  </label>
                </div>
              </div>
            </div>
            <div className="mo-foot">
              <button className="btn btn-secondary btn-sm" onClick={() => setRenewModal(null)}>Cancel</button>
              <button className="btn btn-primary btn-sm" onClick={handleRenewAMC}>✓ Confirm Renewal</button>
            </div>
          </div>
        </div>
      )}
      {/* Quick Add Customer Modal */}
      {custModal && (
        <div className="mo open" style={{ zIndex: 2000 }}>
          <div className="mo-box">
            <div className="mo-head"><h3>Quick Add Customer</h3><button className="btn-icon" onClick={() => setCustModal(false)}>✕</button></div>
            <div className="mo-body">
              <div className="fgrid">
                <div className="fg"><label>Name *</label><input value={newCustForm.name} onChange={e => handleNewCustChange('name', e.target.value)} placeholder="Full name" /></div>
                <div className="fg"><label>Company Name (Optional)</label><input value={newCustForm.companyName} onChange={e => handleNewCustChange('companyName', e.target.value)} placeholder="Business name" /></div>
                <div className="fg"><label>Email *</label><input value={newCustForm.email} onChange={ncf('email')} placeholder="john@example.com" /></div>
                <div className="fg"><label>Phone</label><input value={newCustForm.phone} onChange={ncf('phone')} placeholder="+91..." /></div>
                <div className="fg span2"><label>Address</label><textarea value={newCustForm.address} onChange={ncf('address')} placeholder="Full address..." /></div>
                <div className="fg"><label>Country</label>
                  <select value={newCustForm.country} onChange={ncf('country')}>
                    {['India', 'USA', 'UK', 'UAE', 'Australia', 'Other'].map(c => <option key={c}>{c}</option>)}
                  </select>
                </div>
                <div className="fg"><label>State</label><input value={newCustForm.state} onChange={ncf('state')} placeholder="e.g. Tamil Nadu" /></div>
                <div className="fg"><label>Pincode</label><input value={newCustForm.pincode} onChange={ncf('pincode')} placeholder="600XXX" /></div>
                <div className="fg"><label>GSTIN</label><input value={newCustForm.gstin} onChange={ncf('gstin')} placeholder="22AAAAA0000A1Z5" /></div>
                
                {customFields.map(cf => (
                  <div key={cf.name} className="fg">
                    <label>{cf.name} {cf.required ? '*' : ''}</label>
                    <input 
                      type={cf.type === 'Number' ? 'number' : 'text'} 
                      value={newCustForm.custom?.[cf.name] || ''} 
                      onChange={nccf(cf.name)} 
                      placeholder={cf.name} 
                    />
                  </div>
                ))}
              </div>
            </div>
            <div className="mo-foot">
              <button className="btn btn-secondary btn-sm" onClick={() => setCustModal(false)}>Cancel</button>
              <button className="btn btn-primary btn-sm" onClick={createCustomer}>Create Customer</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
