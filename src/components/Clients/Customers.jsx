import React, { useState, useMemo, useEffect } from 'react';
import db from '../../instant';
import { id } from '@instantdb/react';
import { fmtD, INDIAN_STATES, COUNTRIES } from '../../utils/helpers';
import { useToast } from '../../context/ToastContext';
import { EMPTY_CUSTOMER } from '../../utils/constants';
import SearchableSelect from '../UI/SearchableSelect';
import { useData } from '../../hooks/useData';
import { dbWrite, dbOp } from '../../utils/dbWrite';

const USE_PG_DATA = import.meta.env.VITE_USE_PG_DATA === 'true';

export default function Customers({ user, perms, ownerId, planEnforcement }) {
  const canCreate = perms?.can('Customers', 'create') === true;
  const canEdit = perms?.can('Customers', 'edit') === true;
  const canDelete = perms?.can('Customers', 'delete') === true;

  const [search, setSearch] = useState('');

  // A fixed-position menu doesn't travel with the page, so close it on any
  // scroll or outside click rather than leaving it stranded mid-screen.
  useEffect(() => {
    const close = (e) => {
      if (e?.type === 'mousedown' && e.target.closest?.('.dd-menu, .btn-icon')) return;
      document.querySelectorAll('.dd-menu').forEach(el => { el.style.display = 'none'; });
    };
    window.addEventListener('scroll', close, true);
    document.addEventListener('mousedown', close);
    return () => { window.removeEventListener('scroll', close, true); document.removeEventListener('mousedown', close); };
  }, []);
  const [modal, setModal] = useState(false);
  const [editData, setEditData] = useState(null);
  const [form, setForm] = useState(EMPTY_CUSTOMER);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [noteText, setNoteText] = useState('');
  const [viewCustomer, setViewCustomer] = useState(null);
  const toast = useToast();

  // NOTE: `leads` is NOT subscribed here — at 11k+ leads the subscription
  // times out and data stays undefined forever (page stuck on spinner).
  // Duplicate checks use /api/lead-check-duplicate; Won-lead sync uses
  // /api/sync-won-leads; contact sync on edit uses a targeted narrow query.
  const { data, refetch } = useData({
    customers: { $: { where: { userId: ownerId }, limit: 10000 } },
    userProfiles: { $: { where: { userId: ownerId } } },
    projects: { $: { where: { userId: ownerId } } },
    quotes: { $: { where: { userId: ownerId } } },
    invoices: { $: { where: { userId: ownerId } } },
    tasks: { $: { where: { userId: ownerId } } },
    amc: { $: { where: { userId: ownerId } } },
    teamMembers: { $: { where: { userId: ownerId } } },
    partnerApplications: { $: { where: { userId: ownerId, status: 'Approved' } } },
  }, ['customers', 'userProfiles', 'projects', 'quotes', 'invoices', 'tasks', 'amc', 'teamMembers', 'partnerApplications']);
  const team = data?.teamMembers || [];
  const myMember = useMemo(() => team.find(t => t.email === user.email), [team, user.email]);
  const customers = useMemo(() => data?.customers || [], [data?.customers]);

  const customFields = data?.userProfiles?.[0]?.customFields || [];
  const projects = data?.projects || [];
  const quotes = data?.quotes || [];
  const invoices = data?.invoices || [];
  const tasks = data?.tasks || [];
  const drawerCustomerId = viewCustomer?.id || null;
  const { data: drawerData } = useData(
    drawerCustomerId ? { activityLogs: { $: { where: { entityId: drawerCustomerId } } } } : {},
    drawerCustomerId ? { activityLogs: { where: { entityId: drawerCustomerId } } } : {}
  );
  const amcList = data?.amc || [];
  const partners = (data?.partnerApplications || []).filter(p => p.status === 'Approved');

  // Targeted lead lookup — only runs while a customer edit drawer is open.
  // Avoids subscribing to all 11k leads just to find one name match.
  const editName = editData?.name || null;
  const { data: leadSyncData } = useData(
    editName ? { leads: { $: { where: { userId: ownerId, name: editName } } } } : {},
    editName ? { leads: { where: { name: editName } } } : {}
  );
  const matchedLead = leadSyncData?.leads?.[0] || null;

  const filtered = useMemo(() => {
    return customers.filter(c => {
      if (!search) return true;
      const q = search.toLowerCase();
      // search in name, email, phone, and all custom fields
      const customVals = c.custom ? Object.values(c.custom) : [];
      return [c.name, c.email, c.phone, ...customVals].some(v => (v || '').toLowerCase().includes(q));
    }).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)); // newest first
  }, [customers, search]);

  const totalPages = pageSize === 'all' ? 1 : Math.ceil(filtered.length / pageSize);
  const paginated = useMemo(() => {
    if (pageSize === 'all') return filtered;
    const start = (currentPage - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, currentPage, pageSize]);

  useEffect(() => { setCurrentPage(1); }, [search, pageSize]);

  const openCreate = () => { setEditData(null); setForm(EMPTY_CUSTOMER); setModal(true); };
  const openEdit = (c) => { 
    setEditData(c); 
    setForm({ 
      ...EMPTY_CUSTOMER,
      ...c,
      custom: { ...EMPTY_CUSTOMER.custom, ...(c.custom || {}) },
      retailerId: c.retailerId || '',
      distributorId: c.distributorId || ''
    }); 
    setModal(true); 
  };

  const logActivity = async (customerId, text) => {
    await dbWrite(dbOp.update('activityLogs', id(), {
      entityId: customerId, entityType: 'customer', text,
      userId: ownerId, actorId: user.id, userName: user.email,
      createdAt: Date.now()
    }));
  };

  const saveCustomer = async () => {
    if (editData && !canEdit) { toast('Permission denied: cannot edit customers', 'error'); return; }
    if (!editData && !canCreate) { toast('Permission denied: cannot create customers', 'error'); return; }
    if (!editData && planEnforcement && !planEnforcement.isWithinLimit('maxCustomers', customers.length)) { toast('Customer limit reached for your plan. Please upgrade.', 'error'); return; }
    if (!form.name.trim()) { toast('Name is required', 'error'); return; }
    if (!form.email.trim()) { toast('Email is mandatory for clients', 'error'); return; }

    // Duplicate phone/email check via server (scans full leads + customers,
    // not just the 25 loaded on current page)
    const checkPhone = (form.phone || '').trim();
    const checkEmail = (form.email || '').trim();
    if (checkPhone || checkEmail) {
      try {
        const dupRes = await fetch('/api/lead-check-duplicate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ownerId,
            phone: checkPhone,
            email: checkEmail,
            excludeLeadId: editData?.leadId || null,
            excludeCustomerId: editData?.id || null,
          }),
        });
        const dupData = await dupRes.json();
        if (dupData.duplicate) {
          const d = dupData.duplicate;
          const matchedOn = checkPhone && d.phone?.replace(/\D/g, '') === checkPhone.replace(/\D/g, '') ? 'phone number' : 'email';
          toast(`Duplicate! A ${d.type} with this ${matchedOn} already exists (${d.name}).`, 'error');
          return;
        }
      } catch (e) {
        // If API fails, skip check rather than blocking the save
        console.warn('Duplicate check API failed, skipping:', e);
      }
    }

    try {
      const txs = [];
      if (editData) {
        const changes = [];
        const fields = { name: 'Name', companyName: 'Company Name', phone: 'Phone', email: 'Email', address: 'Address', state: 'State', country: 'Country', pincode: 'Pincode', gstin: 'GSTIN' };
        Object.entries(fields).forEach(([k, label]) => {
          if (editData[k] !== form[k]) {
            const oldVal = editData[k] || 'None';
            const newVal = form[k] || 'None';
            changes.push(`${label} changed from "${oldVal}" to "${newVal}"`);
          }
        });

        const oldCustom = editData.custom || {};
        const newCustom = form.custom || {};
        customFields.forEach(cf => {
          if (oldCustom[cf.name] !== newCustom[cf.name]) {
            changes.push(`${cf.name} (Custom) changed from "${oldCustom[cf.name] || 'None'}" to "${newCustom[cf.name] || 'None'}"`);
          }
        });

        txs.push(dbOp.update('customers', editData.id, { ...form, userId: ownerId, actorId: user.id, updatedAt: Date.now() }));

        // Sync to Lead if a matching lead was found via targeted query
        const lMatch = matchedLead;
        if (lMatch) {
          txs.push(dbOp.update('leads', lMatch.id, { name: form.name, companyName: form.companyName, email: form.email, phone: form.phone }));
          txs.push(dbOp.update('activityLogs', id(), {
            entityId: lMatch.id, entityType: 'lead', text: `Contact details synced from Customer update (${form.name}).`,
            userId: ownerId, actorId: user.id, userName: user.email, createdAt: Date.now()
          }));
        }

        if (changes.length > 0) {
          txs.push(dbOp.update('activityLogs', id(), {
            entityId: editData.id, entityType: 'customer',
            entityName: form.companyName || form.name, action: 'edited',
            text: `Edited customer **${form.name}**: ${changes.join(' | ')}`,
            userId: ownerId, actorId: user.id, userName: user.email,
            teamMemberId: myMember?.id || null, createdAt: Date.now()
          }));
        }
        await dbWrite(txs);
        toast('Customer updated!', 'success');
      } else {
        const newId = id();
        txs.push(dbOp.update('customers', newId, { ...form, userId: ownerId, actorId: user.id, createdAt: Date.now() }));
        txs.push(dbOp.update('activityLogs', id(), {
          entityId: newId, entityType: 'customer',
          entityName: form.companyName || form.name, action: 'created',
          text: `Created customer **${form.name}**`,
          userId: ownerId, actorId: user.id, userName: user.email,
          teamMemberId: myMember?.id || null, createdAt: Date.now()
        }));
        await dbWrite(txs);
        toast(`Customer "${form.name}" created!`, 'success');
      }
      setModal(false);
      refetch();
    } catch (e) { toast('Error saving customer', 'error'); }
  };

  const deleteCustomer = async (cId) => {
    if (!canDelete) { toast('Permission denied: cannot delete customers', 'error'); return; }
    if (!confirm('Delete customer? All associated activity logs and records will be removed.')) return;
    try {
      if (USE_PG_DATA) {
        await dbWrite(dbOp.delete('customers', cId)); // cascade-deletes activity logs
        refetch();
      } else {
        const res = await fetch('/api/data', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            module: 'customers', ownerId, actorId: user.id,
            userName: user.email, id: cId, logText: 'Customer deleted from CRM'
          })
        });
        if (!res.ok) throw new Error('Failed to delete customer');
      }
      toast('Customer deleted', 'error');
    } catch (e) {
      toast('Error deleting customer', 'error');
    }
  };

  const syncWonLeads = async () => {
    const wonStage = data?.userProfiles?.[0]?.wonStage || 'Won';
    try {
      const res = await fetch('/api/sync-won-leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerId, wonStage, userId: user.id, userEmail: user.email }),
      });
      const result = await res.json();
      if (result.synced > 0) {
        toast(`Automatically synced ${result.synced} new customers from "Won" leads.`, 'success');
      }
    } catch (e) {
      console.warn('sync-won-leads failed:', e);
    }
  };

  // Handle deep-linking from activity logs
  React.useEffect(() => {
    const openId = localStorage.getItem('tc_open_customer');
    if (openId && customers.length > 0) {
      const target = customers.find(c => c.id === openId);
      if (target) {
        setViewCustomer(target);
        localStorage.removeItem('tc_open_customer');
      }
    }
  }, [customers]);

  // Auto-sync Won leads once on mount via server — no longer tied to the
  // full leads subscription (which timed out at 11k leads).
  React.useEffect(() => {
    if (data && ownerId) syncWonLeads();
  }, [!!data, ownerId]);

  const f = (k) => (e) => setForm(p => ({ ...p, [k]: e.target.value }));
  const cf = (k) => (e) => setForm(p => ({ ...p, custom: { ...(p.custom || {}), [k]: e.target.value } }));

  if (viewCustomer) {
    const c = viewCustomer;
    // Matching by name for related records (as names are typed in other modules usually)
    const cName = c.name.toLowerCase();
    
    // Safety check in case the client field doesn't exist
    const cReq = (x) => (x?.client || x?.customer || '').toLowerCase() === cName;
    
    const relProjects = projects.filter(cReq);
    const relQuotes = quotes.filter(cReq);
    const relInvoices = invoices.filter(cReq);
    const relTasks = tasks.filter(t => (t?.client || '').toLowerCase() === cName || (t?.customer || '').toLowerCase() === cName);
    
    // CRM entities matching client name
    const relAmc = amcList.filter(cReq);
    
    // Sort logs newest first
    const cLogs = (drawerData?.activityLogs || []).sort((a,b) => (b.createdAt || 0) - (a.createdAt || 0));

    const addNote = async () => {
    if (!canEdit) { toast('Permission denied: cannot add notes', 'error'); return; }
    if (!noteText.trim()) return;
      await dbWrite(dbOp.update('activityLogs', id(), {
        entityId: c.id, entityType: 'customer', text: noteText.trim(),
        userId: ownerId, actorId: user.id, userName: user.email,
        createdAt: Date.now()
      }));
      setNoteText('');
      toast('Note added', 'success');
      refetch();
    };
    
    return (
      <div>
        <div className="sh" style={{ marginBottom: 15 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button className="btn-icon" onClick={() => setViewCustomer(null)}>← Back</button>
            <div>
              <h2 style={{ fontSize: 24, margin: 0 }}>{c.companyName || c.name}</h2>
              {c.companyName && <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 2 }}>Contact: {c.name}</div>}
              <div className="sub" style={{ fontSize: 13, marginTop: 4 }}>
                {c.email && <span style={{ marginRight: 15 }}>✉ {c.email}</span>}
                {c.phone && <span style={{ marginRight: 15 }}>☏ {c.phone}</span>}
                {c.gstin && <span>GSTIN: {c.gstin}</span>}
              </div>
            </div>
          </div>
          {canEdit && <button className="btn btn-secondary btn-sm" onClick={() => openEdit(c)}>Edit Details</button>}
        </div>

        {customFields.length > 0 && Object.keys(c.custom || {}).length > 0 && (
          <div className="tw" style={{ padding: 18, marginBottom: 20 }}>
            <h4 style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 12 }}>Custom Fields</h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 16 }}>
              {customFields.map(cf => c.custom?.[cf.name] && (
                <div key={cf.name}>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 2 }}>{cf.name}</div>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{c.custom[cf.name]}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="stat-grid" style={{ marginBottom: 25 }}>
          <div className="stat-card sc-blue"><div className="lbl">Projects</div><div className="val">{relProjects.length}</div></div>
          <div className="stat-card sc-yellow"><div className="lbl">Quotations</div><div className="val">{relQuotes.length}</div></div>
          <div className="stat-card sc-green"><div className="lbl">Invoices</div><div className="val">{relInvoices.length}</div></div>
          <div className="stat-card sc-purple"><div className="lbl">Tasks</div><div className="val">{relTasks.length}</div></div>
          <div className="stat-card sc-blue"><div className="lbl">AMC</div><div className="val">{relAmc.length}</div></div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 20, alignItems: 'start' }}>
          
          {/* Projects Box */}
          <div className="tw">
            <div className="tw-head"><h3>Projects</h3></div>
            {relProjects.length === 0 ? <div style={{ padding: 20, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>No projects found for {c.name}.</div> : (
              <div className="tw-scroll">
                <table>
                  <thead><tr><th>Name</th><th>Status</th></tr></thead>
                  <tbody>
                    {relProjects.map(p => (
                      <tr key={p.id}>
                        <td><strong>{p.name}</strong></td>
                        <td><span className={`badge bg-gray`}>{p.status || 'Active'}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Invoices Box */}
          <div className="tw">
            <div className="tw-head"><h3>Invoices</h3></div>
            {relInvoices.length === 0 ? <div style={{ padding: 20, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>No invoices found for {c.name}.</div> : (
              <div className="tw-scroll">
                <table>
                  <thead><tr><th>No</th><th>Amount</th><th>Status</th></tr></thead>
                  <tbody>
                    {relInvoices.map(inv => (
                      <tr key={inv.id}>
                        <td><strong>{inv.no}</strong></td>
                        <td style={{ fontWeight: 700 }}>₹{inv.total}</td>
                        <td><span className={`badge ${inv.status === 'Paid' ? 'bg-green' : inv.status === 'Overdue' ? 'bg-red' : 'bg-gray'}`}>{inv.status}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Quotes Box */}
          <div className="tw">
            <div className="tw-head"><h3>Quotations</h3></div>
            {relQuotes.length === 0 ? <div style={{ padding: 20, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>No quotes found for {c.name}.</div> : (
              <div className="tw-scroll">
                <table>
                  <thead><tr><th>No</th><th>Amount</th><th>Status</th></tr></thead>
                  <tbody>
                    {relQuotes.map(q => (
                      <tr key={q.id}>
                        <td><strong>{q.no}</strong></td>
                        <td style={{ fontWeight: 700 }}>₹{q.total}</td>
                        <td><span className={`badge ${q.status === 'Accepted' ? 'bg-green' : 'bg-gray'}`}>{q.status}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Tasks Box */}
          <div className="tw">
            <div className="tw-head"><h3>Tasks</h3></div>
            {relTasks.length === 0 ? <div style={{ padding: 20, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>No tasks found for {c.name}.</div> : (
              <div className="tw-scroll">
                <table>
                  <thead><tr><th>Title</th><th>Status</th></tr></thead>
                  <tbody>
                    {relTasks.map(t => (
                      <tr key={t.id}>
                        <td><strong>{t.title}</strong></td>
                        <td><span className={`badge ${t.stage === 'Completed' ? 'bg-green' : 'bg-blue'}`}>{t.stage}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* AMC Box */}
          <div className="tw">
            <div className="tw-head"><h3>AMC Contracts</h3></div>
            {relAmc.length === 0 ? <div style={{ padding: 20, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>No active AMC contracts found.</div> : (
              <div className="tw-scroll">
                <table>
                  <thead><tr><th>Type</th><th>Plan / Amount</th><th>Status</th></tr></thead>
                  <tbody>
                    {relAmc.map(a => (
                      <tr key={a.id}>
                        <td><strong>AMC</strong> <span style={{ fontSize: 11, color: 'var(--muted)' }}>({a.contractNo})</span></td>
                        <td style={{ fontWeight: 600 }}>₹{a.amount} <span style={{ fontWeight: 400, color: 'var(--muted)' }}>({a.plan})</span></td>
                        <td><span className={`badge ${a.status === 'Active' ? 'bg-green' : 'bg-red'}`}>{a.status}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

        </div>

        {/* Activity Logs Box */}
        <div className="tw" style={{ marginTop: 20 }}>
          <div className="tw-head"><h3>Activity Logs & Notes</h3></div>
          <div style={{ padding: 20 }}>
            <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
              <input value={noteText} onChange={e => setNoteText(e.target.value)} placeholder="Type a note or log an activity..." style={{ flex: 1, padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13, fontFamily: 'inherit' }} />
              <button className="btn btn-primary" onClick={addNote}>Add Note</button>
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {cLogs.length === 0 ? <div style={{ color: 'var(--muted)', fontSize: 13, textAlign: 'center', padding: 20, background: '#f8fafc', borderRadius: 8 }}>No activity recorded yet for {c.name}.</div> : 
                cLogs.map(l => (
                  <div key={l.id} style={{ background: '#f8fafc', padding: '12px 16px', borderRadius: 8, border: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent)' }}>{l.userName || 'System'}</span>
                      <span style={{ fontSize: 11, color: 'var(--muted)' }}>{new Date(l.createdAt).toLocaleString()}</span>
                    </div>
                    <div style={{ fontSize: 13, whiteSpace: 'pre-wrap', color: '#333' }}>{l.text}</div>
                  </div>
                ))
              }
            </div>
          </div>
        </div>
        
        {/* Using the same modal block below (by just un-returning) requires breaking it out, but we can just duplicate the modal logic for the single view page edit */}
        {modal && (
          <div className="mo open">
            <div className="mo-box">
              <div className="mo-head">
                <h3>Edit Customer</h3>
                <button className="btn-icon" onClick={() => setModal(false)}>✕</button>
              </div>
              <div className="mo-body">
                <div className="fgrid">
                  <div className="fg"><label>Name *</label><input value={form.name} onChange={f('name')} placeholder="Full name" /></div>
                  <div className="fg"><label>Company Name (Optional)</label><input value={form.companyName} onChange={f('companyName')} placeholder="Business name" /></div>
                  <div className="fg"><label>Email *</label><input type="email" value={form.email} onChange={f('email')} /></div>
                  <div className="fg"><label>Phone</label><input value={form.phone} onChange={f('phone')} placeholder="+91..." /></div>
                  <div className="fg span2"><label>Address</label><textarea value={form.address} onChange={f('address')} placeholder="Full address" style={{ minHeight: 60 }} /></div>
                  <div className="fg"><label>Country</label>
                    <select value={form.country} onChange={f('country')}>
                      {COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div className="fg"><label>State</label>
                    <select value={form.state} onChange={f('state')}>
                      <option value="">Select State...</option>
                      {INDIAN_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div className="fg"><label>Pincode</label><input value={form.pincode} onChange={f('pincode')} placeholder="Postal code" /></div>
                  <div className="fg"><label>GSTIN</label><input value={form.gstin} onChange={f('gstin')} placeholder="GST Number" /></div>
                  {customFields.length > 0 && <div className="fg span2" style={{ borderTop: '1px solid var(--border)', paddingTop: 16, marginTop: 4 }}>
                    <h4 style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 12 }}>Custom Fields (Optional)</h4>
                    <div className="fgrid">
                      {customFields.map(field => (
                        <div key={field.name} className="fg">
                          <label>{field.name}</label>
                          {field.type === 'dropdown' ? (
                            <select value={(form.custom || {})[field.name] || ''} onChange={cf(field.name)}>
                              <option value="">Select...</option>
                              {(field.options || '').split(',').map(o => <option key={o.trim()}>{o.trim()}</option>)}
                            </select>
                          ) : (
                            <input type={field.type === 'number' ? 'number' : 'text'} value={form.custom[field.name] || ''} onChange={cf(field.name)} />
                          )}
                        </div>
                      ))}
                    </div>
                  </div>}

                  <div className="fg" style={{ zIndex: 8 }}><label>Distributor (Optional)</label>
                    <SearchableSelect
                      options={[{ id: '', name: '-- None --' }, ...partners.filter(p => p.role === 'Distributor').map(p => ({ id: p.id, name: p.companyName || p.name }))]}
                      displayKey="name" returnKey="id" value={form.distributorId}
                      onChange={val => setForm(p => ({ ...p, distributorId: val, retailerId: '' }))}
                      placeholder="Search distributor..."
                    />
                  </div>
                  <div className="fg" style={{ zIndex: 7 }}><label>Retailer (Optional)</label>
                    <SearchableSelect
                      options={[{ id: '', name: '-- None --' }, ...partners.filter(p => p.role === 'Retailer' && (!form.distributorId || p.parentDistributorId === form.distributorId)).map(p => ({ id: p.id, name: `${p.companyName || p.name}${p.parentDistributorId ? ` (${partners.find(d => d.id === p.parentDistributorId)?.companyName || partners.find(d => d.id === p.parentDistributorId)?.name || ''})` : ''}` }))]}
                      displayKey="name" returnKey="id" value={form.retailerId}
                      onChange={val => {
                        const retailer = partners.find(p => p.id === val);
                        setForm(p => ({ ...p, retailerId: val, distributorId: retailer?.parentDistributorId || p.distributorId }));
                      }}
                      placeholder="Search retailer..."
                    />
                  </div>
                </div>
              </div>
              <div className="mo-foot">
                <button className="btn btn-secondary btn-sm" onClick={() => setModal(false)}>Cancel</button>
                <button className="btn btn-primary btn-sm" onClick={saveCustomer}>Save Customer</button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (!data) return <div className="p-xl" style={{ textAlign: 'center', color: 'var(--muted)' }}><div className="spinner" style={{ margin: '0 auto 10px' }}></div>Loading Customers...</div>;

  return (
    <div>
      {/* Header */}
      <div className="sh">
        <div><h2>Customers</h2><div className="sub">Manage converted leads and clients</div></div>
        <div style={{ display: 'flex', gap: 10 }}>
          {canCreate && <button className="btn btn-primary btn-sm" onClick={openCreate}>+ Create Customer</button>}
        </div>
      </div>

      {/* Table */}
      <div className="tw">
        <div className="tw-head">
          <h3>All Customers ({filtered.length})</h3>
          <div className="sw">
            <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
            <input className="si" placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>
        <div className="tw-scroll">
          <table style={{ minWidth: 600 }}>
            <thead>
              <tr>
                <th>#</th>
                <th>Name</th>
                <th>Phone</th>
                <th>Email</th>
                <th>Created</th>
                {customFields.map(cf => <th key={cf.name}>{cf.name}</th>)}
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {paginated.length === 0 ? (
                <tr><td colSpan={6 + customFields.length} style={{ textAlign: 'center', padding: 28, color: 'var(--muted)' }}>No customers found</td></tr>
              ) : paginated.map((c, i) => (
                <tr key={c.id}>
                  <td style={{ color: 'var(--muted)', fontSize: 11 }}>{(pageSize === 'all' ? 0 : (currentPage - 1) * pageSize) + i + 1}</td>
                  <td>
                    <strong>{c.name}</strong>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 4 }}>
                      {c.phone && (
                        <>
                          <a href={`tel:${c.phone}`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 24, height: 24, borderRadius: '50%', background: '#eff6ff', color: '#2563eb', textDecoration: 'none' }} title="Call">
                            <svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>
                          </a>
                          <a href={`https://wa.me/${c.phone.replace(/\D/g, '')}`} target="_blank" rel="noreferrer" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 24, height: 24, borderRadius: '50%', background: '#e8fdf0', color: '#16a34a', textDecoration: 'none' }} title="WhatsApp">
                            <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.888-.788-1.489-1.761-1.663-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 0 0-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/></svg>
                          </a>
                          <a href={`sms:${c.phone}`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 24, height: 24, borderRadius: '50%', background: '#f5f3ff', color: '#7c3aed', textDecoration: 'none' }} title="SMS">
                            <svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
                          </a>
                        </>
                      )}
                      {c.email && (
                        <a href={`mailto:${c.email}`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 24, height: 24, borderRadius: '50%', background: '#f3f4f6', color: '#4b5563', textDecoration: 'none' }} title="Email">
                          <svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg>
                        </a>
                      )}
                    </div>
                  </td>
                  <td style={{ fontSize: 12 }}>{c.phone || '-'}</td>
                  <td style={{ fontSize: 12 }}>{c.email || '-'}</td>
                  <td style={{ fontSize: 11 }}>{fmtD(c.createdAt || Date.now())}</td>
                  {customFields.map(cf => (
                    <td key={cf.name} style={{ fontSize: 11 }}>{c.custom?.[cf.name] || '-'}</td>
                  ))}
                  <td style={{ textAlign: 'right' }}>
                    <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }}>
                      <button className="btn btn-secondary btn-sm" onClick={() => setViewCustomer(c)}>View</button>
                      <button className="btn-icon" onClick={(e) => {
                        const dm = e.currentTarget.nextElementSibling;
                        document.querySelectorAll('.dd-menu').forEach(el => el !== dm && (el.style.display = 'none'));
                        const opening = dm.style.display !== 'block';
                        dm.style.display = opening ? 'block' : 'none';
                        if (!opening) return;
                        // Fixed, from the button's rect: .tw-scroll sets
                        // overflow-x, which makes the vertical axis compute
                        // to auto too, so an absolute menu was clipped by
                        // the table. Flips above when there's no room below.
                        const r = e.currentTarget.getBoundingClientRect();
                        const h = dm.offsetHeight || 120;
                        dm.style.position = 'fixed';
                        dm.style.top = ((window.innerHeight - r.bottom) < h + 12 ? r.top - h - 4 : r.bottom + 4) + 'px';
                        dm.style.left = Math.max(8, r.right - 140) + 'px';
                        dm.style.right = 'auto';
                      }}>⋮</button>
                      <div className="dd-menu" style={{ display: 'none', position: 'absolute', right: 0, top: 28, background: '#fff', border: '1px solid var(--border)', borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,0.1)', zIndex: 10, width: 100, overflow: 'hidden' }}>
                        {canEdit && <div style={{ padding: '8px 12px', fontSize: 12, cursor: 'pointer', borderBottom: '1px solid var(--border)' }} onClick={() => { openEdit(c); document.querySelectorAll('.dd-menu').forEach(el => el.style.display = 'none'); }}>✎ Edit</div>}
                        {canDelete && <div style={{ padding: '8px 12px', fontSize: 12, cursor: 'pointer', color: '#dc2626' }} onClick={() => { deleteCustomer(c.id); document.querySelectorAll('.dd-menu').forEach(el => el.style.display = 'none'); }}>🗑 Delete</div>}
                      </div>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 20px', borderTop: '1px solid var(--border)', background: '#f8fafc' }}>
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>
              Show: {['25', '50', '100', '500'].map(z => (
                <button key={z} onClick={() => { setPageSize(Number(z)); setCurrentPage(1); }} style={{ margin: '0 4px', padding: '2px 8px', borderRadius: 4, border: '1px solid var(--border)', background: pageSize === Number(z) ? 'var(--accent)' : '#fff', color: pageSize === Number(z) ? '#fff' : 'var(--text)', cursor: 'pointer' }}>{z}</button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn btn-secondary btn-sm" disabled={currentPage === 1} onClick={() => setCurrentPage(p => Math.max(1, p - 1))}>Previous</button>
              <span style={{ fontSize: 13, alignSelf: 'center' }}>Page {currentPage} of {totalPages}</span>
              <button className="btn btn-secondary btn-sm" disabled={currentPage >= totalPages || pageSize === 'all'} onClick={() => setCurrentPage(p => p + 1)}>Next</button>
            </div>
          </div>
        </div>
      </div>

      {/* MODAL */}
      {modal && (
        <div className="mo open">
          <div className="mo-box">
            <div className="mo-head">
              <h3>{editData ? 'Edit Customer' : 'Create Customer'}</h3>
              <button className="btn-icon" onClick={() => setModal(false)}>✕</button>
            </div>
            <div className="mo-body">
              <div className="fgrid">
                <div className="fg"><label>Name *</label><input value={form.name} onChange={f('name')} placeholder="Full name" /></div>
                <div className="fg"><label>Company Name (Optional)</label><input value={form.companyName} onChange={f('companyName')} placeholder="Business name" /></div>
                <div className="fg"><label>Email *</label><input type="email" value={form.email} onChange={f('email')} /></div>
                <div className="fg"><label>Phone</label><input value={form.phone} onChange={f('phone')} placeholder="+91..." /></div>
                <div className="fg span2"><label>Address</label><textarea value={form.address} onChange={f('address')} placeholder="Full address" style={{ minHeight: 60 }} /></div>
                <div className="fg"><label>Country</label>
                  <select value={form.country} onChange={f('country')}>
                    {COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div className="fg"><label>State</label>
                  <select value={form.state} onChange={f('state')}>
                    <option value="">Select State...</option>
                    {INDIAN_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div className="fg"><label>Pincode</label><input value={form.pincode} onChange={f('pincode')} placeholder="Postal code" /></div>
                <div className="fg"><label>GSTIN</label><input value={form.gstin} onChange={f('gstin')} placeholder="GST Number" /></div>
                
                {/* Dynamic Custom Fields */}
                {customFields.length > 0 && <div className="fg span2" style={{ borderTop: '1px solid var(--border)', paddingTop: 16, marginTop: 4 }}>
                  <h4 style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 12 }}>Custom Fields (Optional)</h4>
                  <div className="fgrid">
                    {customFields.map(field => (
                      <div key={field.name} className="fg">
                        <label>{field.name}</label>
                        {field.type === 'dropdown' ? (
                          <select value={(form.custom || {})[field.name] || ''} onChange={cf(field.name)}>
                            <option value="">Select...</option>
                            {(field.options || '').split(',').map(o => <option key={o.trim()}>{o.trim()}</option>)}
                          </select>
                        ) : (
                          <input type={field.type === 'number' ? 'number' : 'text'} value={form.custom[field.name] || ''} onChange={cf(field.name)} />
                        )}
                      </div>
                    ))}
                  </div>
                </div>}

                <div className="fg" style={{ zIndex: 8 }}><label>Distributor (Optional)</label>
                  <SearchableSelect
                    options={[{ id: '', name: '-- None --' }, ...partners.filter(p => p.role === 'Distributor').map(p => ({ id: p.id, name: p.companyName || p.name }))]}
                    displayKey="name" returnKey="id" value={form.distributorId}
                    onChange={val => setForm(p => ({ ...p, distributorId: val, retailerId: '' }))}
                    placeholder="Search distributor..."
                  />
                </div>
                <div className="fg" style={{ zIndex: 7 }}><label>Retailer (Optional)</label>
                  <SearchableSelect
                    options={[{ id: '', name: '-- None --' }, ...partners.filter(p => p.role === 'Retailer' && (!form.distributorId || p.parentDistributorId === form.distributorId)).map(p => ({ id: p.id, name: `${p.companyName || p.name}${p.parentDistributorId ? ` (${partners.find(d => d.id === p.parentDistributorId)?.companyName || partners.find(d => d.id === p.parentDistributorId)?.name || ''})` : ''}` }))]}
                    displayKey="name" returnKey="id" value={form.retailerId}
                    onChange={val => {
                      const retailer = partners.find(p => p.id === val);
                      setForm(p => ({ ...p, retailerId: val, distributorId: retailer?.parentDistributorId || p.distributorId }));
                    }}
                    placeholder="Search retailer..."
                  />
                </div>
              </div>
            </div>
            <div className="mo-foot">
              <button className="btn btn-secondary btn-sm" onClick={() => setModal(false)}>Cancel</button>
              <button className="btn btn-primary btn-sm" onClick={saveCustomer}>Save Customer</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
