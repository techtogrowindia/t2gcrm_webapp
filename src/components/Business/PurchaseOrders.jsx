import React, { useState, useMemo, useEffect } from 'react';
import { dbWrite, dbOp } from '../../utils/dbWrite';
import db from '../../instant';
import { id } from '@instantdb/react';
import { fmtD, fmt, stageBadgeClass } from '../../utils/helpers';
import { useToast } from '../../context/ToastContext';
import { logActivity } from '../../utils/activityLogger';

const STATUS_COLORS = { Draft: 'bg-gray', Sent: 'bg-blue', Received: 'bg-green', Cancelled: 'bg-red' };
const EMPTY_ITEM = { name: '', qty: 1, rate: 0, tax: 0, total: 0 };

function calcTotals(items) {
  const sub = items.reduce((s, it) => s + (it.qty || 0) * (it.rate || 0), 0);
  const taxTotal = items.reduce((s, it) => s + (it.qty || 0) * (it.rate || 0) * (it.tax || 0) / 100, 0);
  return { sub, taxTotal, grand: Math.round(sub + taxTotal) };
}

export default function PurchaseOrders({ user, perms, ownerId }) {
  const canCreate = perms?.can('PurchaseOrders', 'create') === true;
  const canEdit = perms?.can('PurchaseOrders', 'edit') === true;
  const canDelete = perms?.can('PurchaseOrders', 'delete') === true;

  const [modal, setModal] = useState(false);
  const [editData, setEditData] = useState(null);
  const [viewPO, setViewPO] = useState(null);
  const [tab, setTab] = useState('all');
  const [search, setSearch] = useState('');
  const [sending, setSending] = useState(null);
  const toast = useToast();

  const EMPTY_FORM = () => ({ vendor: '', vendorEmail: '', date: new Date().toISOString().slice(0, 10), expectedDate: '', notes: '', items: [{ ...EMPTY_ITEM }] });
  const [form, setForm] = useState(EMPTY_FORM());

  const { data } = db.useQuery({
    purchaseOrders: { $: { where: { userId: ownerId } } },
    vendors: { $: { where: { userId: ownerId } } },
    products: { $: { where: { userId: ownerId } } },
    userProfiles: { $: { where: { userId: ownerId } } },
    teamMembers: { $: { where: { userId: ownerId } } },
  });

  const orders = data?.purchaseOrders || [];
  const vendors = data?.vendors || [];
  const products = data?.products || [];
  const profile = data?.userProfiles?.[0] || {};
  const team = data?.teamMembers || [];
  const myMember = useMemo(() => team.find(t => t.email === user.email), [team, user.email]);

  // Auto generate PO number
  const nextPONo = useMemo(() => {
    const nums = orders.map(o => parseInt((o.poNo || '').replace(/\D/g, '')) || 0);
    const next = (Math.max(0, ...nums) + 1);
    return `PO-${String(next).padStart(3, '0')}`;
  }, [orders]);

  const filtered = useMemo(() => {
    let list = orders;
    if (tab !== 'all') list = list.filter(o => o.status === tab);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(o => [o.poNo, o.vendor, o.vendorEmail, o.status].some(v => String(v || '').toLowerCase().includes(q)));
    }
    return list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }, [orders, tab, search]);

  const setItem = (idx, key, val) => {
    setForm(prev => {
      const items = prev.items.map((it, i) => {
        if (i !== idx) return it;
        const updated = { ...it, [key]: val };
        updated.total = (updated.qty || 0) * (updated.rate || 0) * (1 + (updated.tax || 0) / 100);
        return updated;
      });
      return { ...prev, items };
    });
  };

  const addItem = () => setForm(prev => ({ ...prev, items: [...prev.items, { ...EMPTY_ITEM }] }));
  const removeItem = idx => setForm(prev => ({ ...prev, items: prev.items.filter((_, i) => i !== idx) }));

  const fillFromProduct = (idx, productName) => {
    const prod = products.find(p => p.name === productName);
    if (prod) {
      setItem(idx, 'name', prod.name);
      setForm(prev => {
        const items = prev.items.map((it, i) => {
          if (i !== idx) return it;
          const rate = prod.purchasePrice || prod.rate || 0;
          return { ...it, name: prod.name, productId: prod.id, sku: prod.code, rate, tax: prod.tax || 0, total: (it.qty || 1) * rate * (1 + (prod.tax || 0) / 100) };
        });
        return { ...prev, items };
      });
    }
  };

  const save = async () => {
    if (!form.vendor.trim()) { toast('Vendor name required', 'error'); return; }
    if (!form.items.some(it => it.name)) { toast('Add at least one item', 'error'); return; }
    const totals = calcTotals(form.items);
    const payload = {
      ...form,
      poNo: editData ? editData.poNo : nextPONo,
      status: editData ? editData.status : 'Draft',
      subtotal: totals.sub,
      taxTotal: totals.taxTotal,
      grandTotal: totals.grand,
      userId: ownerId,
      actorId: user.id,
      createdAt: editData ? editData.createdAt : Date.now(),
    };
    const isEdit = !!editData;
    const poId = isEdit ? editData.id : id();
    await dbWrite(dbOp.update('purchaseOrders', poId, payload));
    await logActivity({
      entityType: 'purchaseOrder', entityId: poId,
      entityName: payload.poNo || payload.vendor,
      action: isEdit ? 'edited' : 'created',
      text: isEdit
        ? `PO **${editData.poNo}** updated — vendor: ${payload.vendor}, total: ₹${totals.grand}`
        : `Purchase Order **${payload.poNo}** created — vendor: ${payload.vendor}, total: ₹${totals.grand}`,
      userId: ownerId, user, teamMemberId: myMember?.id || null,
      meta: { amount: totals.grand },
    });
    toast(isEdit ? 'PO updated' : 'Purchase Order created', 'success');
    setModal(false);
    setEditData(null);
    setForm(EMPTY_FORM());
  };

  const changeStatus = async (po, newStatus) => {
    if (newStatus === 'Received' && po.status !== 'Received') {
      // Update stock for each tracked product in the PO
      const txs = [dbOp.update('purchaseOrders', po.id, { status: newStatus, receivedAt: Date.now() })];
      for (const item of (po.items || [])) {
        const prod = products.find(p => p.id === item.productId || p.name === item.name);
        if (prod && prod.trackStock) {
          const newStock = (prod.stock || 0) + (item.qty || 0);
          txs.push(dbOp.update('products', prod.id, { stock: newStock }));
          txs.push(dbOp.update('activityLogs', id(), {
            entityId: prod.id, entityType: 'product',
            text: `Stock increased by ${item.qty} via PO ${po.poNo}. New stock: ${newStock}`,
            userId: ownerId, actorId: user.id, userName: user.email, createdAt: Date.now()
          }));
        }
      }
      await dbWrite(txs);
      await logActivity({
        entityType: 'purchaseOrder', entityId: po.id,
        entityName: po.poNo || po.vendor,
        action: 'edited',
        text: `PO **${po.poNo}** marked as Received`,
        userId: ownerId, user, teamMemberId: myMember?.id || null,
        meta: { status: 'Received' },
      });
      toast(`PO marked Received — stock updated for ${po.items?.length || 0} items`, 'success');
    } else {
      await dbWrite(dbOp.update('purchaseOrders', po.id, { status: newStatus }));
      await logActivity({
        entityType: 'purchaseOrder', entityId: po.id,
        entityName: po.poNo || po.vendor,
        action: 'edited',
        text: `PO **${po.poNo}** status changed to ${newStatus}`,
        userId: ownerId, user, teamMemberId: myMember?.id || null,
        meta: { status: newStatus },
      });
      toast(`Status updated to ${newStatus}`, 'success');
    }
  };

  const del = async (oid) => {
    if (!canDelete) { toast('Permission denied', 'error'); return; }
    if (!confirm('Delete this Purchase Order?')) return;
    await dbWrite(dbOp.delete('purchaseOrders', oid));
    toast('Deleted', 'error');
  };

  const sendPOMail = async (po) => {
    if (!po.vendorEmail) { toast('No vendor email on this PO', 'error'); return; }
    setSending(po.id);
    try {
      const itemRows = (po.items || []).map(it =>
        `${it.name} | Qty: ${it.qty} | Rate: ₹${it.rate} | Tax: ${it.tax}% | Total: ₹${Math.round((it.qty || 0) * (it.rate || 0) * (1 + (it.tax || 0) / 100))}`
      ).join('\n');
      const body = `Dear ${po.vendor},\n\nPlease find below our Purchase Order ${po.poNo} dated ${fmtD(po.date)}.\n\n--- ITEMS ---\n${itemRows}\n\nSubtotal: ₹${po.subtotal}\nTax: ₹${po.taxTotal}\nGrand Total: ₹${po.grandTotal}\n\nExpected Delivery: ${po.expectedDate ? fmtD(po.expectedDate) : 'TBD'}\n\n${po.notes ? 'Notes: ' + po.notes + '\n\n' : ''}Regards,\n${profile.bizName || profile.fullName || user.email}`;
      const res = await fetch('/api/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: po.vendorEmail, subject: `Purchase Order ${po.poNo}`, body, ownerId: ownerId, type: 'email' })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed');
      await dbWrite(dbOp.update('purchaseOrders', po.id, { status: 'Sent', sentAt: Date.now() }));
      toast(`PO sent to ${po.vendorEmail}`, 'success');
    } catch (e) {
      toast('Email failed: ' + e.message, 'error');
    } finally {
      setSending(null);
    }
  };

  const totals = calcTotals(form.items);
  const TABS = ['all', 'Draft', 'Sent', 'Received', 'Cancelled'];

  return (
    <div>
      <div className="sh">
        <div><h2>Purchase Orders</h2></div>
        {canCreate && <button className="btn btn-primary btn-sm" onClick={() => { setEditData(null); setForm(EMPTY_FORM()); setModal(true); }}>+ New PO</button>}
      </div>

      {/* Summary stats */}
      <div className="stat-grid" style={{ marginBottom: 18 }}>
        <div className="stat-card sc-blue"><div className="lbl">Total POs</div><div className="val">{orders.length}</div></div>
        <div className="stat-card sc-yellow"><div className="lbl">Pending</div><div className="val">{orders.filter(o => o.status === 'Draft' || o.status === 'Sent').length}</div></div>
        <div className="stat-card sc-green"><div className="lbl">Received</div><div className="val">{orders.filter(o => o.status === 'Received').length}</div></div>
        <div className="stat-card sc-blue"><div className="lbl">Total Value</div><div className="val" style={{ fontSize: 15 }}>{fmt(orders.reduce((s, o) => s + (o.grandTotal || 0), 0))}</div></div>
      </div>

      <div className="tw">
        <div className="tw-head" style={{ flexWrap: 'wrap', gap: 10 }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {TABS.map(t => <button key={t} className={`btn btn-sm ${tab === t ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab(t)}>{t === 'all' ? 'All' : t}</button>)}
          </div>
          <div className="sw">
            <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
            <input className="si" placeholder="Search POs..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>
        <div className="tw-scroll">
          <table>
            <thead><tr><th>#</th><th>PO No.</th><th>Vendor</th><th>Date</th><th>Expected</th><th>Items</th><th>Total</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {filtered.length === 0
                ? <tr><td colSpan={9} style={{ textAlign: 'center', padding: 28, color: 'var(--muted)' }}>No purchase orders found.</td></tr>
                : filtered.map((po, i) => (
                  <tr key={po.id}>
                    <td style={{ color: 'var(--muted)', fontSize: 11 }}>{i + 1}</td>
                    <td><strong style={{ fontFamily: 'monospace', cursor: 'pointer', color: 'var(--accent)' }} onClick={() => setViewPO(po)}>{po.poNo}</strong></td>
                    <td>
                      <div>{profile.bizName || po.vendor}</div>
                      {po.vendorEmail && <div style={{ fontSize: 10, color: 'var(--muted)' }}>{po.vendorEmail}</div>}
                    </td>
                    <td style={{ fontSize: 12 }}>{fmtD(po.date)}</td>
                    <td style={{ fontSize: 12 }}>{po.expectedDate ? fmtD(po.expectedDate) : '—'}</td>
                    <td style={{ fontSize: 12 }}>{(po.items || []).length} items</td>
                    <td style={{ fontWeight: 700 }}>{fmt(po.grandTotal)}</td>
                    <td><span className={`badge ${STATUS_COLORS[po.status] || 'bg-gray'}`}>{po.status}</span></td>
                    <td>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        <button className="btn btn-secondary btn-sm" onClick={() => setViewPO(po)}>View</button>
                        {po.status === 'Draft' && canEdit && <button className="btn btn-secondary btn-sm" onClick={() => { setEditData(po); setForm({ vendor: po.vendor, vendorEmail: po.vendorEmail || '', date: po.date, expectedDate: po.expectedDate || '', notes: po.notes || '', items: po.items || [{ ...EMPTY_ITEM }] }); setModal(true); }}>Edit</button>}
                        {po.status !== 'Received' && po.status !== 'Cancelled' && po.vendorEmail && canEdit && (
                          <button className="btn btn-secondary btn-sm" onClick={() => sendPOMail(po)} disabled={sending === po.id}>{sending === po.id ? '...' : '✉ Send'}</button>
                        )}
                        {po.status === 'Sent' && canEdit && <button className="btn btn-sm" style={{ background: '#dcfce7', color: '#166534' }} onClick={() => changeStatus(po, 'Received')}>✓ Receive</button>}
                        {(po.status === 'Draft' || po.status === 'Sent') && canEdit && <button className="btn btn-sm" style={{ background: '#fee2e2', color: '#991b1b' }} onClick={() => changeStatus(po, 'Cancelled')}>Cancel</button>}
                        {canDelete && po.status === 'Draft' && <button className="btn btn-sm" style={{ background: '#fee2e2', color: '#991b1b' }} onClick={() => del(po.id)}>Del</button>}
                      </div>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create/Edit Modal */}
      {modal && (
        <div className="mo open">
          <div className="mo-box" style={{ maxWidth: 820 }}>
            <div className="mo-head"><h3>{editData ? 'Edit' : 'New'} Purchase Order {!editData && <span style={{ fontFamily: 'monospace', fontSize: 13, color: 'var(--muted)' }}>({nextPONo})</span>}</h3><button className="btn-icon" onClick={() => setModal(false)}>✕</button></div>
            <div className="mo-body">
              <div className="fgrid">
                {/* Vendor selector */}
                <div className="fg">
                  <label>Vendor *</label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <select value={vendors.find(v => v.name === form.vendor)?.id || (form.vendor ? '__custom__' : '')} onChange={e => {
                      if (e.target.value === '__custom__') {
                        setForm(p => ({ ...p, vendor: '__custom__' }));
                        return;
                      }
                      const v = vendors.find(x => x.id === e.target.value);
                      if (v) {
                        setForm(p => ({ ...p, vendor: v.name, vendorEmail: v.email || '' }));
                      } else {
                        setForm(p => ({ ...p, vendor: '', vendorEmail: '' }));
                      }
                    }}>
                      <option value="">— Select Vendor —</option>
                      {vendors.map(v => <option key={v.id} value={v.id}>{v.name} {v.company ? `- ${v.company}` : ''}</option>)}
                      <option value="__custom__">Type manually...</option>
                    </select>
                    {(form.vendor === '__custom__' || (form.vendor && !vendors.find(v => v.name === form.vendor))) && (
                      <input value={form.vendor === '__custom__' ? '' : form.vendor} onChange={e => setForm(p => ({ ...p, vendor: e.target.value }))} placeholder="Or type vendor name" autoFocus />
                    )}
                  </div>
                </div>
                <div className="fg"><label>Vendor Email</label><input type="email" value={form.vendorEmail} onChange={e => setForm(p => ({ ...p, vendorEmail: e.target.value }))} placeholder="vendor@company.com" /></div>
                <div className="fg"><label>PO Date</label><input type="date" value={form.date} onChange={e => setForm(p => ({ ...p, date: e.target.value }))} /></div>
                <div className="fg"><label>Expected Delivery</label><input type="date" value={form.expectedDate} onChange={e => setForm(p => ({ ...p, expectedDate: e.target.value }))} /></div>
              </div>

              {/* Line items */}
              <div style={{ marginTop: 22 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                  <h4 style={{ margin: 0, fontSize: 14, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Items</h4>
                  <button className="btn btn-secondary btn-sm" onClick={addItem}>+ Add Item</button>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                  {form.items.map((it, idx) => (
                    <div key={idx} style={{ border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface)', overflow: 'hidden' }}>
                      <div style={{ background: 'var(--bg-soft)', padding: '8px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)' }}>
                        <span style={{ fontWeight: 600, fontSize: 12, color: 'var(--muted)' }}>Item #{idx + 1}</span>
                        <button className="btn-icon" style={{ color: '#dc2626', padding: 2 }} onClick={() => removeItem(idx)} title="Remove Item">✕</button>
                      </div>
                      <div className="mo-body" style={{ padding: '14px 18px' }}>
                        <div className="fgrid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
                          <div className="fg" style={{ gridColumn: 'span 2' }}>
                            <label>Product / Service *</label>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                              <select value={it.name} onChange={e => fillFromProduct(idx, e.target.value)}>
                                <option value="">— Select Product —</option>
                                {products.map(p => <option key={p.id} value={p.name}>{p.name} {p.code ? `(${p.code})` : ''}</option>)}
                                <option value={it.name !== '' && !products.find(p => p.name === it.name) ? it.name : '__manual__'}>Manual entry...</option>
                              </select>
                              {(!products.find(p => p.name === it.name) || it.name === '') && (
                                <input value={it.name !== '__manual__' ? it.name : ''} onChange={e => setItem(idx, 'name', e.target.value)} placeholder="Type item name" />
                              )}
                            </div>
                          </div>
                          <div className="fg"><label>Qty</label><input type="number" value={it.qty} onChange={e => setItem(idx, 'qty', parseFloat(e.target.value) || 0)} min={1} /></div>
                          <div className="fg"><label>Rate (₹)</label><input type="number" value={it.rate} onChange={e => setItem(idx, 'rate', parseFloat(e.target.value) || 0)} /></div>
                          <div className="fg"><label>Tax %</label><input type="number" value={it.tax} onChange={e => setItem(idx, 'tax', parseFloat(e.target.value) || 0)} /></div>
                          <div className="fg" style={{ justifyContent: 'center' }}>
                            <label>&nbsp;</label>
                            <div style={{ padding: '10px 0', fontWeight: 700, fontSize: 14, color: 'var(--accent)', whiteSpace: 'nowrap' }}>
                              <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 400 }}>Total:</span> ₹{Math.round((it.qty || 0) * (it.rate || 0) * (1 + (it.tax || 0) / 100))}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {form.items.length > 0 && (
                  <div style={{ marginTop: 20, padding: '15px 20px', background: 'var(--bg-soft)', borderRadius: 10, textAlign: 'right', border: '1px solid var(--border)' }}>
                    <div style={{ color: 'var(--muted)', fontSize: 12, marginBottom: 4 }}>
                      Subtotal: <strong>₹{Math.round(totals.sub)}</strong> &nbsp;|&nbsp; Tax: <strong>₹{Math.round(totals.taxTotal)}</strong>
                    </div>
                    <div style={{ fontSize: 18, fontWeight: 700 }}>
                      Grand Total: <span style={{ color: 'var(--accent)' }}>₹{totals.grand}</span>
                    </div>
                  </div>
                )}
              </div>

              <div className="fg span2" style={{ marginTop: 14 }}><label>Notes</label><textarea value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} style={{ minHeight: 55 }} /></div>
            </div>
            <div className="mo-foot">
              <button className="btn btn-secondary btn-sm" onClick={() => { setModal(false); setEditData(null); }}>Cancel</button>
              <button className="btn btn-primary btn-sm" onClick={save}>Save PO</button>
            </div>
          </div>
        </div>
      )}

      {/* View PO Modal */}
      {viewPO && (
        <div className="mo open">
          <div className="mo-box" style={{ maxWidth: 700 }}>
            <div className="mo-head">
              <div>
                <h3>Purchase Order — {viewPO.poNo}</h3>
                <span className={`badge ${STATUS_COLORS[viewPO.status] || 'bg-gray'}`} style={{ marginLeft: 8 }}>{viewPO.status}</span>
              </div>
              <button className="btn-icon" onClick={() => setViewPO(null)}>✕</button>
            </div>
            <div className="mo-body" style={{ padding: 20 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 18 }}>
                <div><div style={{ fontSize: 11, color: 'var(--muted)' }}>Vendor</div><div style={{ fontWeight: 700 }}>{viewPO.vendor}</div><div style={{ fontSize: 12 }}>{viewPO.vendorEmail || '—'}</div></div>
                <div><div style={{ fontSize: 11, color: 'var(--muted)' }}>PO Date</div><div>{fmtD(viewPO.date)}</div>{viewPO.expectedDate && <div style={{ fontSize: 12 }}>Expected: {fmtD(viewPO.expectedDate)}</div>}</div>
              </div>
              <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
                <thead><tr style={{ background: 'var(--bg-soft)' }}><th style={{ padding: '8px 12px', textAlign: 'left' }}>Item</th><th style={{ padding: '8px 12px', textAlign: 'right' }}>Qty</th><th style={{ padding: '8px 12px', textAlign: 'right' }}>Rate</th><th style={{ padding: '8px 12px', textAlign: 'right' }}>Tax</th><th style={{ padding: '8px 12px', textAlign: 'right' }}>Total</th></tr></thead>
                <tbody>
                  {(viewPO.items || []).map((it, i) => (
                    <tr key={i} style={{ borderTop: '1px solid var(--bg-soft)' }}>
                      <td style={{ padding: '8px 12px' }}>{products.find(p => p.id === it.productId)?.name || it.name}</td>
                      <td style={{ padding: '8px 12px', textAlign: 'right' }}>{it.qty} {products.find(p => p.id === it.productId)?.unit || ''}</td>
                      <td style={{ padding: '8px 12px', textAlign: 'right' }}>₹{it.rate}</td>
                      <td style={{ padding: '8px 12px', textAlign: 'right' }}>{it.tax}%</td>
                      <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600 }}>₹{Math.round((it.qty || 0) * (it.rate || 0) * (1 + (it.tax || 0) / 100))}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ borderTop: '2px solid var(--border)', background: 'var(--bg-soft)' }}>
                    <td colSpan={4} style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600 }}>Subtotal</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right' }}>₹{Math.round(viewPO.subtotal || 0)}</td>
                  </tr>
                  <tr style={{ background: 'var(--bg-soft)' }}>
                    <td colSpan={4} style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600 }}>Tax</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right' }}>₹{Math.round(viewPO.taxTotal || 0)}</td>
                  </tr>
                  <tr style={{ background: 'var(--bg-soft)' }}>
                    <td colSpan={4} style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 700, fontSize: 14 }}>Grand Total</td>
                    <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 700, fontSize: 14, color: 'var(--accent)' }}>₹{Math.round(viewPO.grandTotal || 0)}</td>
                  </tr>
                </tfoot>
              </table>
              {viewPO.notes && <div style={{ marginTop: 14, padding: 12, background: 'var(--bg-soft)', borderRadius: 8, fontSize: 12 }}><strong>Notes:</strong> {viewPO.notes}</div>}
            </div>
            <div className="mo-foot">
              <button className="btn btn-secondary btn-sm" onClick={() => setViewPO(null)}>Close</button>
              {viewPO.status !== 'Received' && viewPO.status !== 'Cancelled' && viewPO.vendorEmail && canEdit && (
                <button className="btn btn-secondary btn-sm" onClick={() => { sendPOMail(viewPO); setViewPO(null); }} disabled={sending === viewPO.id}>{sending === viewPO.id ? 'Sending...' : '✉ Send to Vendor'}</button>
              )}
              {viewPO.status === 'Sent' && canEdit && (
                <button className="btn btn-sm" style={{ background: '#dcfce7', color: '#166534' }} onClick={() => { changeStatus(viewPO, 'Received'); setViewPO(null); }}>✓ Mark as Received</button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
