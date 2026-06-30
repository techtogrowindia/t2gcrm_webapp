import React, { useState, useMemo } from 'react';
import { dbWrite, dbOp } from '../../utils/dbWrite';
import db from '../../instant';
import { id } from '@instantdb/react';
import { fmtD, fmt, stageBadgeClass } from '../../utils/helpers';
import { useToast } from '../../context/ToastContext';
import { logActivity } from '../../utils/activityLogger';

const DEFAULT_CATS = ['Software', 'Hardware', 'Travel', 'Office', 'Marketing', 'Utilities', 'Salaries', 'Misc'];
const EMPTY = { desc: '', amount: '', taxRate: 0, taxAmt: 0, category: 'Office', date: '', status: 'Pending', notes: '' };

export default function Expenses({ user, perms, ownerId }) {
  const canCreate = perms?.can('Expenses', 'create') === true;
  const canEdit = perms?.can('Expenses', 'edit') === true;
  const canDelete = perms?.can('Expenses', 'delete') === true;

  const [modal, setModal] = useState(false);
  const [editData, setEditData] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const toast = useToast();

  const { data } = db.useQuery({
    expenses: { $: { where: { userId: ownerId } } },
    userProfiles: { $: { where: { userId: ownerId } } },
    teamMembers: { $: { where: { userId: ownerId } } },
  });
  const expenses = useMemo(() => {
    return (data?.expenses || []).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)); // newest first
  }, [data?.expenses]);
  const profile = data?.userProfiles?.[0] || {};
  const team = data?.teamMembers || [];
  const myMember = useMemo(() => team.find(t => t.email === user.email), [team, user.email]);
  const cats = profile.expCats || DEFAULT_CATS;
  const taxRates = profile.taxRates || [{ label: 'None (0%)', rate: 0 }, { label: 'GST @ 5%', rate: 5 }, { label: 'GST @ 12%', rate: 12 }, { label: 'GST @ 18%', rate: 18 }, { label: 'GST @ 28%', rate: 28 }];
  const f = (k) => (e) => setForm(p => ({ ...p, [k]: e.target.value }));

  const total = useMemo(() => expenses.filter(e => e.status === 'Approved').reduce((s, e) => s + (e.amount || 0), 0), [expenses]);
  const pending = useMemo(() => expenses.filter(e => e.status === 'Pending').reduce((s, e) => s + (e.amount || 0), 0), [expenses]);

  const save = async () => {
    if (editData && !canEdit) { toast('Permission denied: cannot edit expenses', 'error'); return; }
    if (!editData && !canCreate) { toast('Permission denied: cannot add expenses', 'error'); return; }
    if (!form.desc.trim()) { toast('Description required', 'error'); return; }
    const payload = { 
      ...form, 
      amount: parseFloat(form.amount) || 0,
      taxRate: parseFloat(form.taxRate) || 0,
      taxAmt: parseFloat(form.taxAmt) || 0,
      userId: ownerId,
      actorId: user.id
    };
    const isEdit = !!editData;
    const expId = isEdit ? editData.id : id();
    await dbWrite(dbOp.update('expenses', expId, payload));
    await logActivity({
      entityType: 'expense', entityId: expId,
      entityName: form.desc,
      action: isEdit ? 'edited' : 'created',
      text: isEdit ? `Expense updated: **${form.desc}** (₹${payload.amount})` : `Expense added: **${form.desc}** ₹${payload.amount}`,
      userId: ownerId, user, teamMemberId: myMember?.id || null,
      meta: { amount: payload.amount, status: payload.status },
    });
    toast(isEdit ? 'Updated' : 'Expense added', 'success');
    setModal(false);
  };

  const del = async (eid) => { 
    if (!canDelete) { toast('Permission denied: cannot delete expenses', 'error'); return; }
    if (!confirm('Delete?')) return; 
    await dbWrite(dbOp.delete('expenses', eid)); 
    toast('Deleted', 'error'); 
  };
  const changeStatus = async (eid, s) => {
    if (!canEdit) { toast('Permission denied: cannot change status', 'error'); return; }
    const exp = expenses.find(e => e.id === eid);
    await dbWrite(dbOp.update('expenses', eid, { status: s }));
    await logActivity({
      entityType: 'expense', entityId: eid,
      entityName: exp?.desc || '',
      action: 'edited',
      text: `Expense **${exp?.desc || ''}** marked as ${s}`,
      userId: ownerId, user, teamMemberId: myMember?.id || null,
      meta: { status: s },
    });
    toast(`Expense ${s.toLowerCase()}`, 'success');
  };

  return (
    <div>
      <div className="sh"><div><h2>Expenses</h2></div>{canCreate && <button className="btn btn-primary btn-sm" onClick={() => { setEditData(null); setForm(EMPTY); setModal(true); }}>+ Add Expense</button>}</div>
      <div className="stat-grid" style={{ marginBottom: 18 }}>
        <div className="stat-card sc-green"><div className="lbl">Approved</div><div className="val">{fmt(total)}</div></div>
        <div className="stat-card sc-yellow"><div className="lbl">Pending</div><div className="val">{fmt(pending)}</div></div>
        <div className="stat-card sc-blue"><div className="lbl">Total Entries</div><div className="val">{expenses.length}</div></div>
      </div>
      <div className="tw">
        <div className="tw-head"><h3>Expenses ({expenses.length})</h3></div>
        <div className="tw-scroll">
          <table>
            <thead><tr><th>#</th><th>Description</th><th>Category</th><th>Date</th><th>Amount</th><th>Tax (GST)</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {expenses.length === 0 ? <tr><td colSpan={7} style={{ textAlign: 'center', padding: 28, color: 'var(--muted)' }}>No expenses</td></tr>
                : expenses.map((e, i) => (
                  <tr key={e.id}>
                    <td style={{ color: 'var(--muted)', fontSize: 11 }}>{i + 1}</td>
                    <td>{e.desc}</td>
                    <td><span className="badge bg-gray">{e.category}</span></td>
                    <td style={{ fontSize: 12 }}>{fmtD(e.date)}</td>
                    <td style={{ fontWeight: 700 }}>{fmt(e.amount)}</td>
                    <td style={{ fontSize: 12, color: '#16a34a' }}>{e.taxAmt ? fmt(e.taxAmt) : '—'}</td>
                     <td><span className={`badge ${stageBadgeClass(e.status)}`}>{e.status}</span></td>
                     <td style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                       {e.status === 'Pending' && canEdit && <><button className="btn btn-sm" style={{ background: '#dcfce7', color: '#166534' }} onClick={() => changeStatus(e.id, 'Approved')}>✓</button><button className="btn btn-sm" style={{ background: '#fee2e2', color: '#991b1b' }} onClick={() => changeStatus(e.id, 'Rejected')}>✕</button></>}
                       {canEdit && <button className="btn btn-secondary btn-sm" onClick={() => { setEditData(e); setForm({ desc: e.desc, amount: e.amount, category: e.category, date: e.date || '', status: e.status, notes: e.notes || '' }); setModal(true); }}>Edit</button>}
                       {canDelete && <button className="btn btn-sm" style={{ background: '#fee2e2', color: '#991b1b' }} onClick={() => del(e.id)}>Del</button>}
                     </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
      {modal && (
        <div className="mo open">
          <div className="mo-box">
            <div className="mo-head"><h3>{editData ? 'Edit' : 'Add'} Expense</h3><button className="btn-icon" onClick={() => setModal(false)}>✕</button></div>
            <div className="mo-body">
              <div className="fgrid">
                <div className="fg span2"><label>Description *</label><input value={form.desc} onChange={f('desc')} placeholder="Expense description" /></div>
                <div className="fg"><label>Category</label><select value={form.category} onChange={f('category')}>{cats.map(c => <option key={c}>{c}</option>)}</select></div>
                <div className="fg"><label>Amount (Incl. Tax) ₹</label><input type="number" value={form.amount} onChange={f('amount')} /></div>
                <div className="fg"><label>Tax Rate (%)</label>
                  <select value={form.taxRate} onChange={e => {
                    const r = parseFloat(e.target.value) || 0;
                    const amt = parseFloat(form.amount) || 0;
                    const tax = Math.round(amt - (amt / (1 + r / 100)));
                    setForm(p => ({ ...p, taxRate: r, taxAmt: tax }));
                  }}>
                    {taxRates.map(t => <option key={t.label} value={t.rate}>{t.label}</option>)}
                  </select>
                </div>
                <div className="fg"><label>Tax Amount (₹)</label><input type="number" value={form.taxAmt} onChange={e => setForm(p => ({ ...p, taxAmt: parseFloat(e.target.value) || 0 }))} /></div>
                <div className="fg"><label>Date</label><input type="date" value={form.date} onChange={f('date')} /></div>
                <div className="fg"><label>Status</label><select value={form.status} onChange={f('status')}>{['Pending', 'Approved', 'Rejected'].map(s => <option key={s}>{s}</option>)}</select></div>
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
