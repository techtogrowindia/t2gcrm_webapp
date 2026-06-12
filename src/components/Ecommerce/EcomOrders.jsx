import React, { useState, useMemo } from 'react';
import { dbWrite, dbOp } from '../../utils/dbWrite';
import db from '../../instant';
import { id } from '@instantdb/react';
import { fmt, fmtD } from '../../utils/helpers';
import { useToast } from '../../context/ToastContext';

const FALLBACK_STATUSES = ['Pending', 'Confirmed', 'Processing', 'Shipped', 'Delivered', 'Cancelled'];

const STATUS_COLORS = {
  Pending: { bg: '#fef3c7', color: '#92400e' },
  Confirmed: { bg: '#dbeafe', color: '#1e40af' },
  Processing: { bg: '#ede9fe', color: '#5b21b6' },
  Shipped: { bg: '#d1fae5', color: '#065f46' },
  Delivered: { bg: '#dcfce7', color: '#166534' },
  Cancelled: { bg: '#fee2e2', color: '#991b1b' },
};

export default function EcomOrders({ ownerId, perms }) {
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState(null);

  const { data } = db.useQuery({
    orders: { $: { where: { userId: ownerId } } },
    userProfiles: { $: { where: { userId: ownerId } } },
    customers: { $: { where: { userId: ownerId } } },
  });

  const orders = data?.orders || [];
  const customers = data?.customers || [];
  // leads fetched on-demand via /api/lead-lookup (avoids 11k+ subscription)
  const orderStatuses = data?.userProfiles?.[0]?.orderStatuses || FALLBACK_STATUSES;

  const filtered = useMemo(() => {
    let list = [...orders].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    if (statusFilter !== 'All') list = list.filter(o => o.status === statusFilter);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(o => [o.customerName, o.customerEmail, o.customerPhone, o.id].some(v => String(v || '').toLowerCase().includes(q)));
    }
    return list;
  }, [orders, statusFilter, search]);

  const updateStatus = async (orderId, status) => {
    const order = orders.find(o => o.id === orderId);
    if (!window.confirm(`Are you sure you want to change this order's status to ${status}?`)) return;
    
    const txs = [dbOp.update('orders', orderId, { status, updatedAt: Date.now() })];

    if (status === 'Delivered') {
      const existingCustomer = customers.find(c => c.phone === order.customerPhone || (c.email && c.email === order.customerEmail));
      if (!existingCustomer && order.customerPhone) {
        const newCustomerId = id();
        txs.push(dbOp.update('customers', newCustomerId, {
          userId: ownerId,
          name: order.customerName || 'Unknown',
          phone: order.customerPhone || '',
          email: order.customerEmail || '',
          address: order.customerAddress || '',
          createdAt: Date.now()
        }));
        
        txs.push(dbOp.update('activityLogs', id(), {
          entityId: newCustomerId, entityType: 'customer', text: `Auto-converted from E-commerce order (${order.id.slice(0,8)}) upon delivery.`,
          userId: ownerId, createdAt: Date.now()
        }));
      }
      
      // Look up matching lead server-side (avoids 11k+ subscription)
      try {
        const lookupRes = await fetch('/api/lead-lookup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ownerId, phone: order.customerPhone, email: order.customerEmail }),
        });
        const lookupData = await lookupRes.json();
        const existingLead = lookupData.lead;
        if (existingLead && existingLead.stage !== 'Converted') {
          txs.push(dbOp.update('leads', existingLead.id, { stage: 'Converted', updatedAt: Date.now() }));
        }
      } catch (e) { console.warn('Lead lookup failed:', e); }
    }
    
    await dbWrite(txs);
    toast(`Order status updated to ${status}`, 'success');
  };

  const startEditing = () => {
    const items = Array.isArray(selectedOrder.items) ? selectedOrder.items : JSON.parse(selectedOrder.items || '[]');
    setEditForm({ 
      items: [...items], 
      address: selectedOrder.address || '', 
      businessNotes: selectedOrder.businessNotes || '',
      notes: selectedOrder.notes || '' 
    });
    setIsEditing(true);
  };

  const saveOrderEdits = async () => {
    if (!editForm) return;
    const items = editForm.items;
    const total = items.reduce((s, it) => s + (it.rate * it.qty), 0);
    
    await dbWrite([
      dbOp.update('orders', selectedOrder.id, {
        items,
        total,
        address: editForm.address,
        businessNotes: editForm.businessNotes,
        notes: editForm.notes,
        updatedAt: Date.now()
      })
    ]);
    
    toast('Order updated successfully', 'success');
    setIsEditing(false);
    setSelectedOrder(prev => ({ ...prev, items, total, ...editForm }));
  };

  const totalRevenue = orders.filter(o => o.status === 'Delivered').reduce((s, o) => s + (o.total || 0), 0);
  const pending = orders.filter(o => o.status === 'Pending').length;

  return (
    <div>
      <div className="sh">
        <div>
          <h2>🛒 E-Commerce Orders</h2>
          <div className="sub">Manage orders from your public store</div>
        </div>
      </div>

      {/* Stats */}
      <div className="stat-grid" style={{ marginBottom: 18 }}>
        <div className="stat-card sc-blue"><div className="lbl">Total Orders</div><div className="val">{orders.length}</div></div>
        <div className="stat-card sc-yellow"><div className="lbl">Pending</div><div className="val">{pending}</div></div>
        <div className="stat-card sc-green"><div className="lbl">Revenue (Delivered)</div><div className="val" style={{ fontSize: 16 }}>{fmt(totalRevenue)}</div></div>
        <div className="stat-card sc-purple"><div className="lbl">Delivered</div><div className="val">{orders.filter(o => o.status === 'Delivered').length}</div></div>
      </div>

      <div className="tw">
        <div className="tw-head">
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <h3>Orders ({filtered.length})</h3>
            {['All', ...orderStatuses].map(s => (
              <button key={s} onClick={() => setStatusFilter(s)}
                className={`btn btn-sm ${statusFilter === s ? 'btn-primary' : 'btn-secondary'}`}
                style={{ fontSize: 11, padding: '3px 10px' }}>
                {s}
              </button>
            ))}
          </div>
          <div className="sw">
            <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
            <input className="si" placeholder="Search orders..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>
        <div className="tw-scroll">
          <table>
            <thead><tr>
              <th>#</th><th>Order ID</th><th>Customer</th><th>Items</th><th>Total</th><th>Status</th><th>Date</th><th>Actions</th>
            </tr></thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={8} style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>No orders yet. Orders from your store will appear here.</td></tr>
              )}
              {filtered.map((o, i) => {
                const items = Array.isArray(o.items) ? o.items : (o.items ? JSON.parse(o.items) : []);
                const sc = STATUS_COLORS[o.status] || STATUS_COLORS.Pending;
                return (
                  <tr key={o.id}>
                    <td style={{ color: 'var(--muted)', fontSize: 11 }}>{i + 1}</td>
                    <td><code style={{ fontSize: 10, background: 'var(--bg-soft)', padding: '2px 6px', borderRadius: 4 }}>{o.id?.slice(0, 8)}...</code></td>
                    <td>
                      <div style={{ fontWeight: 600 }}>{o.customerName || '—'}</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>{o.customerPhone}</div>
                    </td>
                    <td style={{ fontSize: 12 }}>
                      {items.slice(0, 2).map((it, j) => <div key={j}>{it.name} × {it.qty}</div>)}
                      {items.length > 2 && <div style={{ color: 'var(--muted)', fontSize: 10 }}>+{items.length - 2} more</div>}
                    </td>
                    <td style={{ fontWeight: 700 }}>{fmt(o.total)}</td>
                    <td>
                      <select
                        value={o.status || 'Pending'}
                        onChange={e => {
                          const val = e.target.value;
                          if (val !== o.status) updateStatus(o.id, val);
                        }}
                        style={{ fontSize: 11, padding: '3px 6px', borderRadius: 6, border: '1.5px solid', borderColor: sc.color || '#3b82f6', background: sc.bg || '#eff6ff', color: sc.color || '#1d4ed8', fontWeight: 700 }}>
                        {orderStatuses.map(s => <option key={s}>{s}</option>)}
                      </select>
                    </td>
                    <td style={{ fontSize: 11 }}>{o.createdAt ? fmtD(o.createdAt) : '—'}</td>
                    <td>
                      <button className="btn btn-secondary btn-sm" onClick={() => setSelectedOrder(o)}>View</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Order Detail Modal */}
      {selectedOrder && (
        <div className="mo open">
          <div className="mo-box" style={{ maxWidth: 640 }}>
            <div className="mo-head">
              <h3>{isEditing ? 'Editing Order' : 'Order Details'}</h3>
              <button className="btn-icon" onClick={() => { setSelectedOrder(null); setIsEditing(false); }}>✕</button>
            </div>
            <div className="mo-body" style={{ padding: 20 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
                {[
                  ['Customer', selectedOrder.customerName],
                  ['Phone', selectedOrder.customerPhone],
                  ['Email', selectedOrder.customerEmail],
                  ['Date', selectedOrder.createdAt ? fmtD(selectedOrder.createdAt) : '—'],
                ].map(([label, val]) => (
                  <div key={label} style={{ background: 'var(--bg-soft)', padding: '10px 14px', borderRadius: 8 }}>
                    <div style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase' }}>{label}</div>
                    <div style={{ fontWeight: 600, marginTop: 2 }}>{val || '—'}</div>
                  </div>
                ))}
              </div>

              {isEditing ? (
                <div style={{ display: 'grid', gap: 16, marginBottom: 20 }}>
                   <div className="fg">
                      <label>Delivery Address</label>
                      <textarea value={editForm.address} onChange={e => setEditForm(p => ({...p, address: e.target.value}))} style={{ minHeight: 60 }} />
                   </div>
                </div>
              ) : selectedOrder.address && (
                <div style={{ background: 'var(--bg-soft)', padding: '10px 14px', borderRadius: 8, marginBottom: 16 }}>
                  <div style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase', marginBottom: 2 }}>Delivery Address</div>
                  <div style={{ fontSize: 13 }}>{selectedOrder.address}</div>
                </div>
              )}

              <div style={{ border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', marginBottom: 16 }}>
                <div style={{ padding: '10px 16px', background: 'var(--bg-soft)', fontWeight: 800, fontSize: 12, display: 'flex', justifyContent: 'space-between' }}>
                   <span>Items Ordered</span>
                   {isEditing && <span>Qty / Subtotal</span>}
                </div>
                {(isEditing ? editForm.items : (Array.isArray(selectedOrder.items) ? selectedOrder.items : JSON.parse(selectedOrder.items || '[]'))).map((it, j) => (
                  <div key={j} style={{ padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--border)', fontSize: 14 }}>
                    <div style={{ flex: 1 }}>
                       <div style={{ fontWeight: 600 }}>{it.name}</div>
                       <div style={{ fontSize: 11, color: 'var(--muted)' }}>Rate: {fmt(it.rate)}</div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                       {isEditing ? (
                         <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <button onClick={() => {
                               const items = [...editForm.items];
                               if (items[j].qty > 1) items[j].qty--;
                               setEditForm(p => ({...p, items}));
                            }} style={{ width: 24, height: 24, borderRadius: 4, border: '1px solid #ddd', background: '#fff', cursor: 'pointer' }}>-</button>
                            <span style={{ fontWeight: 800, minWidth: 20, textAlign: 'center' }}>{it.qty}</span>
                            <button onClick={() => {
                               const items = [...editForm.items];
                               items[j].qty++;
                               setEditForm(p => ({...p, items}));
                            }} style={{ width: 24, height: 24, borderRadius: 4, border: '1px solid #ddd', background: '#fff', cursor: 'pointer' }}>+</button>
                            <button onClick={() => {
                               const items = editForm.items.filter((_, idx) => idx !== j);
                               setEditForm(p => ({...p, items}));
                            }} style={{ marginLeft: 8, color: '#dc2626', background: 'none', border: 'none', cursor: 'pointer', fontSize: 16 }}>🗑</button>
                         </div>
                       ) : (
                         <strong>{fmt(it.rate * it.qty)}</strong>
                       )}
                       {!isEditing && <span style={{ color: 'var(--muted)', fontSize: 12 }}>× {it.qty}</span>}
                    </div>
                  </div>
                ))}
                <div style={{ padding: '12px 16px', borderTop: '2px solid var(--border)', display: 'flex', justifyContent: 'space-between', fontWeight: 900, background: 'var(--bg-soft)' }}>
                  <span>{isEditing ? 'Estimated New Total' : 'Total'}</span>
                  <span style={{ color: 'var(--accent2)', fontSize: 18 }}>
                     {fmt(isEditing ? editForm.items.reduce((s, it) => s + (it.rate * it.qty), 0) : selectedOrder.total)}
                  </span>
                </div>
              </div>

              <div style={{ display: 'grid', gap: 12 }}>
                 {isEditing ? (
                   <>
                      <div className="fg">
                         <label>Customer Notes (Visible to Customer)</label>
                         <textarea value={editForm.notes} onChange={e => setEditForm(p => ({...p, notes: e.target.value}))} placeholder="Explain changes to the customer..." style={{ minHeight: 60 }} />
                      </div>
                      <div className="fg">
                         <label>Business Internal Notes (Private)</label>
                         <textarea value={editForm.businessNotes} onChange={e => setEditForm(p => ({...p, businessNotes: e.target.value}))} placeholder="Internal reasons for edit..." style={{ minHeight: 60, background: '#fffbeb' }} />
                      </div>
                   </>
                 ) : (
                   <>
                      {selectedOrder.notes && (
                        <div style={{ background: '#eff6ff', padding: '12px 16px', borderRadius: 12, border: '1px solid #dbeafe', fontSize: 13 }}>
                          <div style={{ fontSize: 10, fontWeight: 800, color: '#3b82f6', textTransform: 'uppercase', marginBottom: 4 }}>Customer facing note</div>
                          {selectedOrder.notes}
                        </div>
                      )}
                      {selectedOrder.businessNotes && (
                        <div style={{ background: '#fffbeb', padding: '12px 16px', borderRadius: 12, border: '1px solid #fef3c7', fontSize: 13 }}>
                          <div style={{ fontSize: 10, fontWeight: 800, color: '#92400e', textTransform: 'uppercase', marginBottom: 4 }}>Internal Note</div>
                          {selectedOrder.businessNotes}
                        </div>
                      )}
                   </>
                 )}
              </div>
            </div>
            <div className="mo-foot" style={{ justifyContent: 'space-between' }}>
              <div>
                 {!isEditing && <button className="btn btn-primary btn-sm" onClick={startEditing}>✎ Edit Order</button>}
                 {isEditing && <button className="btn btn-primary" onClick={saveOrderEdits}>Save Changes</button>}
              </div>
              <button className="btn btn-secondary btn-sm" onClick={() => { setSelectedOrder(null); setIsEditing(false); }}>{isEditing ? 'Cancel' : 'Close'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
