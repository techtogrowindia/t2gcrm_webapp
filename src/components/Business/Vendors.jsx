import React, { useState } from 'react';
import { dbWrite, dbOp } from '../../utils/dbWrite';
import db from '../../instant';
import { id } from '@instantdb/react';
import { fmtD } from '../../utils/helpers';
import { useToast } from '../../context/ToastContext';

const EMPTY = { name: '', company: '', email: '', phone: '', address: '', gst: '', category: 'General', notes: '' };
const CATS = ['Electronics', 'Raw Materials', 'Office Supplies', 'Machinery', 'Packaging', 'Services', 'General'];

export default function Vendors({ user, perms, ownerId }) {
  const canCreate = perms?.can('Vendors', 'create') === true;
  const canEdit = perms?.can('Vendors', 'edit') === true;
  const canDelete = perms?.can('Vendors', 'delete') === true;

  const [modal, setModal] = useState(false);
  const [editData, setEditData] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [search, setSearch] = useState('');
  const toast = useToast();

  const { data } = db.useQuery({ vendors: { $: { where: { userId: ownerId } } } });
  const vendors = data?.vendors || [];
  const filtered = vendors.filter(v => {
    if (!search) return true;
    const q = search.toLowerCase();
    return [v.name, v.company, v.email, v.phone, v.gst, v.category].some(x => String(x || '').toLowerCase().includes(q));
  }).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)); // newest first

  const f = k => e => setForm(p => ({ ...p, [k]: e.target.value }));

  const save = async () => {
    if (editData && !canEdit) { toast('Permission denied', 'error'); return; }
    if (!editData && !canCreate) { toast('Permission denied', 'error'); return; }
    if (!form.name.trim()) { toast('Vendor name required', 'error'); return; }
    const payload = { ...form, userId: ownerId, actorId: user.id, createdAt: editData ? undefined : Date.now() };
    if (editData) { await dbWrite(dbOp.update('vendors', editData.id, payload)); toast('Vendor updated', 'success'); }
    else { await dbWrite(dbOp.update('vendors', id(), payload)); toast('Vendor added', 'success'); }
    setModal(false);
  };

  const del = async (vid) => {
    if (!canDelete) { toast('Permission denied', 'error'); return; }
    if (!confirm('Delete vendor?')) return;
    await dbWrite(dbOp.delete('vendors', vid));
    toast('Deleted', 'error');
  };

  return (
    <div>
      <div className="sh">
        <div><h2>Vendors</h2></div>
        {canCreate && <button className="btn btn-primary btn-sm" onClick={() => { setEditData(null); setForm(EMPTY); setModal(true); }}>+ Add Vendor</button>}
      </div>
      <div className="tw">
        <div className="tw-head">
          <h3>Vendors ({filtered.length})</h3>
          <div className="sw">
            <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
            <input className="si" placeholder="Search vendors..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>
        <div className="tw-scroll">
          <table>
            <thead><tr><th>#</th><th>Name</th><th>Company</th><th>Category</th><th>Email</th><th>Phone</th><th>GST No.</th><th>Actions</th></tr></thead>
            <tbody>
              {filtered.length === 0
                ? <tr><td colSpan={8} style={{ textAlign: 'center', padding: 28, color: 'var(--muted)' }}>No vendors found. Add your first vendor.</td></tr>
                : filtered.map((v, i) => (
                  <tr key={v.id}>
                    <td style={{ color: 'var(--muted)', fontSize: 11 }}>{i + 1}</td>
                    <td><strong>{v.name}</strong><div style={{ fontSize: 10, color: 'var(--muted)' }}>{v.notes}</div></td>
                    <td>{v.company || '—'}</td>
                    <td><span style={{ fontSize: 11, background: 'var(--bg-soft)', padding: '2px 8px', borderRadius: 4 }}>{v.category || 'General'}</span></td>
                    <td style={{ fontSize: 12 }}>{v.email || '—'}</td>
                    <td style={{ fontSize: 12 }}>{v.phone || '—'}</td>
                    <td style={{ fontSize: 12, fontFamily: 'monospace' }}>{v.gst || '—'}</td>
                    <td>
                      <div style={{ display: 'flex', gap: 4 }}>
                        {canEdit && <button className="btn btn-secondary btn-sm" onClick={() => { setEditData(v); setForm({ name: v.name, company: v.company || '', email: v.email || '', phone: v.phone || '', address: v.address || '', gst: v.gst || '', category: v.category || 'General', notes: v.notes || '' }); setModal(true); }}>Edit</button>}
                        {canDelete && <button className="btn btn-sm" style={{ background: '#fee2e2', color: '#991b1b' }} onClick={() => del(v.id)}>Del</button>}
                      </div>
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
            <div className="mo-head"><h3>{editData ? 'Edit' : 'Add'} Vendor</h3><button className="btn-icon" onClick={() => setModal(false)}>✕</button></div>
            <div className="mo-body">
              <div className="fgrid">
                <div className="fg"><label>Vendor Name *</label><input value={form.name} onChange={f('name')} placeholder="Contact person name" /></div>
                <div className="fg"><label>Company</label><input value={form.company} onChange={f('company')} placeholder="Company / Firm name" /></div>
                <div className="fg"><label>Email</label><input type="email" value={form.email} onChange={f('email')} /></div>
                <div className="fg"><label>Phone</label><input value={form.phone} onChange={f('phone')} /></div>
                <div className="fg"><label>GST Number</label><input value={form.gst} onChange={f('gst')} placeholder="22AAAAA0000A1Z5" /></div>
                <div className="fg"><label>Category</label>
                  <select value={form.category} onChange={f('category')}>
                    {CATS.map(c => <option key={c}>{c}</option>)}
                  </select>
                </div>
                <div className="fg span2"><label>Address</label><textarea value={form.address} onChange={f('address')} style={{ minHeight: 55 }} /></div>
                <div className="fg span2"><label>Notes</label><textarea value={form.notes} onChange={f('notes')} style={{ minHeight: 45 }} /></div>
              </div>
            </div>
            <div className="mo-foot">
              <button className="btn btn-secondary btn-sm" onClick={() => setModal(false)}>Cancel</button>
              <button className="btn btn-primary btn-sm" onClick={save}>Save Vendor</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
