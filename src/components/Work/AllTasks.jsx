import React, { useState, useMemo, useEffect } from 'react';
import db from '../../instant';
import { id } from '@instantdb/react';
import { fmtD, stageBadgeClass, prioBadgeClass } from '../../utils/helpers';
import { useToast } from '../../context/ToastContext';
import SearchableSelect from '../UI/SearchableSelect';
import { EMPTY_CUSTOMER } from '../../utils/constants';
import { fireAutoNotifications } from '../../utils/messaging';

const DEFAULT_TASK_STATUSES = ['Pending', 'In Progress', 'Completed'];

export default function AllTasks({ user, perms, ownerId, planEnforcement }) {
  const canCreate = perms?.can('Tasks', 'create') === true;
  const canEdit = perms?.can('Tasks', 'edit') === true;
  const canDelete = perms?.can('Tasks', 'delete') === true;
  const isOwner = perms?.isOwner === true;

  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [fltClient, setFltClient] = useState('');
  const [fltProj, setFltProj] = useState('');
  const [fltAssign, setFltAssign] = useState('');
  const [modal, setModal] = useState(false);
  const [colModal, setColModal] = useState(false);
  const [editData, setEditData] = useState(null);
  const [form, setForm] = useState({ title: '', assignTo: '', dueDate: '', priority: 'Medium', status: 'Pending', notes: '', projectId: '', client: '', taskNumber: null });
  const toast = useToast();

  const { data } = db.useQuery({
    tasks: { $: { where: { userId: ownerId } } },
    projects: { $: { where: { userId: ownerId } } },
    teamMembers: { $: { where: { userId: ownerId } } },
    userProfiles: { $: { where: { userId: ownerId } } },
    customers: { $: { where: { userId: ownerId }, limit: 10000 } },
  });
  const tasks = useMemo(() => {
    const rawTasks = data?.tasks || [];
    // If the user can access the module, they should see all tasks in this "All Tasks" view
    // unless there is a specific lower-level restriction.
    // For now, we will show all tasks assigned to the business/owner.
    return rawTasks;
  }, [data?.tasks]);

  const projects = data?.projects || [];
  const team = data?.teamMembers || [];
  const customers = data?.customers || [];
  const profile = data?.userProfiles?.[0] || {};

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
  const customFields = profile.customFields || [];
  const taskStatuses = profile.taskStatuses || DEFAULT_TASK_STATUSES;
  const savedCols = profile.taskCols;
  const savedStages = profile.taskStages;
  const savedPageSize = profile.taskPageSize || 25;

  const [pageSize, setPageSize] = useState(25);
  const [currentPage, setCurrentPage] = useState(1);
  const [tempCols, setTempCols] = useState([]);
  const [tempStages, setTempStages] = useState([]);
  const [tempPageSize, setTempPageSize] = useState(25);

  useEffect(() => {
    if (savedPageSize) setPageSize(savedPageSize);
  }, [savedPageSize]);

  const allPossibleCols = ['Task #', 'Title', 'Client', 'Project', 'Assigned To', 'Due Date', 'Priority', 'Status', ...customFields.map(c => c.name).filter(n => !['Retailer', 'Distributor'].includes(n))];
  const activeCols = savedCols || allPossibleCols;
  const activeStages = savedStages || taskStatuses;

  const f = (k) => (e) => setForm(p => ({ ...p, [k]: e.target.value }));
  
  const [custModal, setCustModal] = useState(false);
  const [newCustForm, setNewCustForm] = useState(EMPTY_CUSTOMER);
  
  const ncf = (k) => (e) => setNewCustForm(p => ({ ...p, [k]: e.target.value }));
  const nccf = (k) => (e) => setNewCustForm(p => ({ ...p, custom: { ...(p.custom || {}), [k]: e.target.value } }));

  const clientOptions = useMemo(() => {
    const wonStage = profile.wonStage || 'Won';
    return [
      ...customers.map(c => ({ ...c, isLead: false, displayName: c.name })),
      ...modalLeads.filter(l => l.stage !== wonStage).map(l => ({ ...l, isLead: true, displayName: `${l.name} (Lead)` }))
    ];
  }, [customers, modalLeads, profile.wonStage]);

  const projName = (pid) => projects.find(p => p.id === pid)?.name || '-';

  // Auto-migrate task numbers
  useEffect(() => {
    if (isOwner && tasks.length > 0) {
      const withoutNum = tasks.filter(t => !t.taskNumber).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      if (withoutNum.length > 0) {
        let currentMax = tasks.reduce((max, t) => Math.max(max, t.taskNumber || 0), 0);
        if (currentMax < 100) currentMax = 100;
        
        const updates = withoutNum.map((t, idx) => {
          return db.tx.tasks[t.id].update({ taskNumber: currentMax + idx + 1 });
        });
        
        db.transact(updates).then(() => {
          console.log(`Migrated ${updates.length} tasks with numbers.`);
        });
      }
    }
  }, [isOwner, tasks.length]);

  // Handle deep-linking from activity logs
  useEffect(() => {
    const openId = localStorage.getItem('tc_open_task');
    if (openId && tasks.length > 0) {
      const target = tasks.find(t => t.id === openId);
      if (target) {
        setViewData(target);
        setEditData(null);
        setForm({
          title: target.title || '',
          assignTo: target.assignTo || '',
          dueDate: target.dueDate || '',
          priority: target.priority || 'Medium',
          status: target.status || 'Pending',
          notes: target.notes || '',
          projectId: target.projectId || '',
          client: target.client || '',
          taskNumber: target.taskNumber || null
        });
        setModal(true);
        localStorage.removeItem('tc_open_task');
      }
    }
  }, [tasks]);

  const filtered = tasks.filter(t => {
    if (filter === 'all') return activeStages.includes(t.status) || t.priority === 'High';
    if (filter === 'high') return t.priority === 'High';
    return t.status === filter;
  }).filter(t => {
    const q = search.toLowerCase();
    const pName = projName(t.projectId).toLowerCase();
    const matchSearch = !search || [t.title, t.assignTo, t.notes, pName, t.client].some(v => (v || '').toLowerCase().includes(q));
    const matchClient = !fltClient || t.client === fltClient;
    const matchProj = !fltProj || t.projectId === fltProj;
    const matchAssign = !fltAssign || t.assignTo === fltAssign;
    return matchSearch && matchClient && matchProj && matchAssign;
  }).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)); // newest first

  const totalPages = pageSize === 'all' ? 1 : Math.ceil(filtered.length / pageSize);
  const paginated = useMemo(() => {
    if (pageSize === 'all') return filtered;
    const start = (currentPage - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, currentPage, pageSize]);

  useEffect(() => { setCurrentPage(1); }, [filter, search, fltClient, fltProj, fltAssign, pageSize]);

  const [viewData, setViewData] = useState(null);

  const myMember = useMemo(() => team.find(t => t.email === user.email), [team, user.email]);

  const save = async () => {
    if (!form.title.trim()) { toast('Title required', 'error'); return; }
    if (!editData && planEnforcement && !planEnforcement.isWithinLimit('maxTasks', tasks.length)) { toast('Task limit reached for your plan. Please upgrade.', 'error'); return; }
    try {
      if (editData) {
        const changes = [];
        if (editData.title !== form.title) changes.push(`Title changed to "${form.title}"`);
        if (editData.status !== form.status) changes.push(`Status changed from "${editData.status}" to "${form.status}"`);
        if (editData.assignTo !== form.assignTo) changes.push(`Assigned to "${form.assignTo || 'Unassigned'}"`);
        
        const res = await fetch('/api/data', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            module: 'tasks',
            ownerId,
            actorId: user.id,
            userName: user.email,
            teamMemberId: myMember?.id || null,
            id: editData.id,
            projectId: form.projectId || editData.projectId || '',
            logText: changes.length > 0 ? `Task updated: ${changes.join(' | ')}` : null,
            ...form
          })
        });
        if (!res.ok) throw new Error('Failed to update');
        
        toast('Updated', 'success');
      } else {
        const res = await fetch('/api/data', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ module: 'tasks', ownerId, actorId: user.id, userName: user.email, teamMemberId: myMember?.id || null, ...form })
        });
        if (!res.ok) throw new Error('Failed to create');
        const result = await res.json();
        // Backend handles task numbering and creation log
        toast('Task created', 'success');

        // WhatsApp notification when task is assigned to a staff member
        if (form.assignTo) {
          const tProfile = profile;
          const assignedMember = (data?.teamMembers || []).find(t => t.name === form.assignTo);
          const assignedPhone = assignedMember?.phone || '';
          if (tProfile && assignedPhone) {
            fireAutoNotifications('task_assigned', {
              assignee: form.assignTo,
              phone: assignedPhone,
              clientphoneno: assignedPhone,
              leadphoneno: assignedPhone,
              task: form.title,
              client: form.client || '',
              duedate: form.dueDate || '',
              priority: form.priority || '',
              date: new Date().toISOString().split('T')[0],
              bizName: tProfile.bizName || tProfile.businessName || '',
              ownerPhone: tProfile.waNotifPhone || tProfile.phone || '',
              entityId: form.title,
            }, tProfile, ownerId).catch(() => {});
          }
        }
      }
      setModal(false);
    } catch (e) {
      toast('Error: ' + e.message, 'error');
    }
  };

  const del = async (tid) => {
    if (!confirm('Delete this task?')) return;
    try {
      const res = await fetch('/api/data', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ module: 'tasks', ownerId, actorId: user.id, userName: user.email, teamMemberId: myMember?.id || null, id: tid, logText: 'Task deleted' })
      });
      if (!res.ok) throw new Error('Failed to delete');
      toast('Deleted', 'error');
    } catch (e) {
      toast('Error: ' + e.message, 'error');
    }
  };

  const createCustomer = async () => {
    if (!newCustForm.name.trim()) return toast('Name required', 'error');
    if (!newCustForm.email.trim()) return toast('Email is mandatory for clients', 'error');
    const newId = id();
    await db.transact(db.tx.customers[newId].update({ ...newCustForm, name: newCustForm.name.trim(), userId: ownerId, actorId: user.id, createdAt: Date.now() }));
    setForm(p => ({ ...p, client: newCustForm.name.trim() }));
    setCustModal(false);
    setNewCustForm(EMPTY_CUSTOMER);
    toast('Customer created!', 'success');
  };

  const saveViewConfig = async (cols, stages, size) => {
    if (!isOwner) return toast('Only owner can change view config', 'error');
    await db.transact(db.tx.userProfiles[profile.id].update({ taskCols: cols, taskStages: stages, taskPageSize: size }));
    setColModal(false);
    toast('View saved', 'success');
  };

  const resetViewConfig = () => saveViewConfig(allPossibleCols, taskStatuses, 25);

  const cycleStatus = async (t) => {
    if (!canEdit) return;
    const idx = taskStatuses.indexOf(t.status);
    const nextStatus = taskStatuses[(idx + 1) % taskStatuses.length];
    try {
      await fetch('/api/data', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          module: 'tasks',
          ownerId,
          actorId: user.id,
          userName: user.email,
          teamMemberId: myMember?.id || null,
          id: t.id,
          projectId: t.projectId || '',
          status: nextStatus,
          logText: `Task updated: Status changed from "${t.status}" to "${nextStatus}"`
        })
      });
      toast(`Status: ${nextStatus}`, 'success');
    } catch (e) { toast('Error: ' + e.message, 'error'); }
  };

  const smartSelection = (key, val) => {
    if (key === 'projectId') {
      const p = projects.find(x => x.id === val);
      if (p && p.client) {
        setForm(prev => ({ ...prev, projectId: val, client: p.client }));
      } else {
        setForm(prev => ({ ...prev, projectId: val }));
      }
    } else if (key === 'client') {
      setForm(prev => ({ ...prev, client: val, projectId: '' }));
    } else {
      setForm(prev => ({ ...prev, [key]: val }));
    }
  };

  return (
    <div>
      <div className="sh">
        <div><h2>All Tasks</h2></div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-secondary btn-sm" onClick={() => {
            setTempCols(activeCols);
            setTempStages(activeStages);
            setTempPageSize(pageSize);
            setColModal(true);
          }}>⚙ Configure View</button>
          {canCreate && <button className="btn btn-primary btn-sm" onClick={() => { fetchModalLeads(); setEditData(null); setViewData(null); setForm({ title: '', assignTo: '', dueDate: '', priority: 'Medium', status: taskStatuses[0], notes: '', projectId: '', client: '', taskNumber: null }); setModal(true); }}>+ Create Task</button>}
        </div>
      </div>
      <div className="tabs">
        <div className={`tab${filter === 'all' ? ' active' : ''}`} onClick={() => setFilter('all')}>All</div>
        <div className={`tab${filter === 'high' ? ' active' : ''}`} onClick={() => setFilter('high')}>🔴 High Priority</div>
        {taskStatuses.map(s => (
          <div key={s} className={`tab${filter === s ? ' active' : ''}`} onClick={() => setFilter(s)}>{s}</div>
        ))}
      </div>
      <div className="tw">
        <div className="tw-head">
          <div style={{ flex: 1 }}><h3>Tasks ({filtered.length})</h3></div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <div className="sw">
              <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
              <input className="si" placeholder="Search title/notes..." value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <select className="si" style={{ width: 140 }} value={fltClient} onChange={e => setFltClient(e.target.value)}>
              <option value="">All Clients</option>
              {Array.from(new Set(tasks.map(t => t.client).filter(Boolean))).map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <select className="si" style={{ width: 140 }} value={fltProj} onChange={e => setFltProj(e.target.value)}>
              <option value="">All Projects</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <select className="si" style={{ width: 140 }} value={fltAssign} onChange={e => setFltAssign(e.target.value)}>
              <option value="">All Staff</option>
              {team.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
            </select>
          </div>
        </div>
        <div style={{ padding: '8px 25px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)', background: 'var(--bg-soft)', gap: 15 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
            <span style={{ color: 'var(--muted)', fontWeight: 600 }}>Show</span>
            <select 
              style={{ border: '1px solid var(--border)', background: 'var(--surface)', fontWeight: 700, outline: 'none', cursor: 'pointer', color: 'var(--accent)', padding: '2px 4px', borderRadius: 4, fontSize: 11 }}
              value={pageSize}
              onChange={e => setPageSize(parseInt(e.target.value, 10))}
            >
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
              <option value={500}>500</option>
            </select>
          </div>

          {pageSize !== 'all' && totalPages > 1 && (
            <div style={{ display: 'flex', gap: 4 }}>
              <button className="btn btn-secondary btn-sm" disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)}>Prev</button>
              <span style={{ fontSize: 12, alignSelf: 'center' }}>Page {currentPage} of {totalPages}</span>
              <button className="btn btn-secondary btn-sm" disabled={currentPage === totalPages} onClick={() => setCurrentPage(p => p + 1)}>Next</button>
            </div>
          )}
        </div>
        <div className="tw-scroll">
          <table>
            <thead>
              <tr>
                <th>#</th>
                {activeCols.includes('Task #') && <th>Task #</th>}
                {activeCols.includes('Title') && <th>Title</th>}
                {activeCols.includes('Client') && <th>Client</th>}
                {activeCols.includes('Project') && <th>Project</th>}
                {activeCols.includes('Assigned To') && <th>Assigned To</th>}
                {activeCols.includes('Due Date') && <th>Due Date</th>}
                {activeCols.includes('Priority') && <th>Priority</th>}
                {activeCols.includes('Status') && <th>Status</th>}
                {customFields.filter(cf => activeCols.includes(cf.name)).map(cf => <th key={cf.name}>{cf.name}</th>)}
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {paginated.length === 0 ? <tr><td colSpan={activeCols.length + 2} style={{ textAlign: 'center', padding: 28, color: 'var(--muted)' }}>No tasks</td></tr>
                : paginated.map((t, i) => (
                  <tr key={t.id}>
                    <td style={{ color: 'var(--muted)', fontSize: 11 }}>{(currentPage - 1) * (pageSize === 'all' ? 0 : pageSize) + i + 1}</td>
                    {activeCols.includes('Task #') && <td style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent)' }}>{t.taskNumber ? `T-${t.taskNumber}` : '-'}</td>}
                    {activeCols.includes('Title') && <td><strong>{t.title}</strong></td>}
                    {activeCols.includes('Client') && <td style={{ fontSize: 12 }}>{t.client || '-'}</td>}
                    {activeCols.includes('Project') && <td style={{ fontSize: 12 }}>{projName(t.projectId)}</td>}
                    {activeCols.includes('Assigned To') && <td style={{ fontSize: 12 }}>{t.assignTo || '-'}</td>}
                    {activeCols.includes('Due Date') && <td style={{ fontSize: 12 }}>{fmtD(t.dueDate)}</td>}
                    {activeCols.includes('Priority') && <td><span className={`badge ${prioBadgeClass(t.priority)}`}>{t.priority}</span></td>}
                    {activeCols.includes('Status') && <td><span className={`badge ${stageBadgeClass(t.status)}`} style={{ cursor: canEdit ? 'pointer' : 'default' }} onClick={() => cycleStatus(t)} title={canEdit ? 'Click to cycle status' : ''}>{t.status}</span></td>}
                    {customFields.filter(cf => activeCols.includes(cf.name)).map(cf => (
                      <td key={cf.name} style={{ fontSize: 12 }}>{t.custom?.[cf.name] || '-'}</td>
                    ))}
                    <td>
                      <button className="btn btn-secondary btn-sm" onClick={() => { fetchModalLeads(); setViewData(t); setEditData(null); setForm({ title: t.title, assignTo: t.assignTo || '', dueDate: t.dueDate || '', priority: t.priority, status: t.status, notes: t.notes || '', projectId: t.projectId || '', client: t.client || '' }); setModal(true); }}>View</button>{' '}
                      {canEdit && <button className="btn btn-secondary btn-sm" onClick={() => { fetchModalLeads(); setEditData(t); setViewData(null); setForm({ title: t.title, assignTo: t.assignTo || '', dueDate: t.dueDate || '', priority: t.priority, status: t.status, notes: t.notes || '', projectId: t.projectId || '', client: t.client || '' }); setModal(true); }}>Edit</button>}{' '}
                      {canDelete && <button className="btn btn-sm" style={{ background: '#fee2e2', color: '#991b1b' }} onClick={() => del(t.id)}>Del</button>}
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
            <div className="mo-head"><h3>{viewData ? 'View' : editData ? 'Edit' : 'Create'} Task</h3><button className="btn-icon" onClick={() => setModal(false)}>✕</button></div>
            <div className="mo-body">
              <div className="fgrid">
                <div className="fg span2"><label>Task Title {!viewData && '*'}</label><input value={form.title} onChange={f('title')} disabled={!!viewData} /></div>
                <div className="fg">
                  <label>Client</label>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <div style={{ flex: 1 }}>
                      {viewData ? (
                        <input value={form.client || '-'} disabled />
                      ) : (
                        <SearchableSelect 
                          options={clientOptions} 
                          displayKey="displayName" 
                          returnKey="name"
                          value={form.client} 
                          onChange={val => setForm(p => ({ ...p, client: val }))} 
                          placeholder="Search client or lead..." 
                        />
                      )}
                    </div>
                    {!viewData && <button className="btn btn-secondary" style={{ padding: '0 10px' }} onClick={() => setCustModal(true)} title="Add New Customer">+</button>}
                  </div>
                </div>
                <div className="fg"><label>Project</label>
                  {viewData ? <input value={projName(form.projectId)} disabled /> : (
                    <select value={form.projectId} onChange={e => smartSelection('projectId', e.target.value)}>
                      <option value="">No Project</option>
                      {projects.filter(p => !form.client || p.client === form.client).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  )}
                </div>
                <div className="fg"><label>Assign To</label>
                  {viewData ? <input value={form.assignTo || 'Unassigned'} disabled /> : (
                    <select value={form.assignTo} onChange={f('assignTo')}><option value="">Unassigned</option>{team.map(t => <option key={t.id}>{t.name}</option>)}</select>
                  )}
                </div>
                <div className="fg"><label>Due Date</label><input type="date" value={form.dueDate} onChange={f('dueDate')} disabled={!!viewData} /></div>
                <div className="fg"><label>Priority</label>
                  {viewData ? <input value={form.priority} disabled /> : (
                    <select value={form.priority} onChange={f('priority')}>{['High', 'Medium', 'Low'].map(s => <option key={s}>{s}</option>)}</select>
                  )}
                </div>
                <div className="fg"><label>Status</label>
                  {viewData ? <input value={form.status} disabled /> : (
                    <select value={form.status} onChange={f('status')}>{taskStatuses.map(s => <option key={s}>{s}</option>)}</select>
                  )}
                </div>
                <div className="fg span2"><label>Notes</label><textarea value={form.notes} onChange={f('notes')} disabled={!!viewData} style={{ minHeight: viewData ? 120 : 80 }} /></div>
              </div>
            </div>
            <div className="mo-foot">
              <button className="btn btn-secondary btn-sm" onClick={() => setModal(false)}>{viewData ? 'Close' : 'Cancel'}</button>
              {viewData && canEdit && (
                <button className="btn btn-primary btn-sm" onClick={() => {
                  setEditData(viewData);
                  setViewData(null);
                }}>Edit Task</button>
              )}
              {!viewData && <button className="btn btn-primary btn-sm" onClick={save}>Save</button>}
            </div>
          </div>
        </div>
      )}
      {/* Quick Add Customer Modal */}
      {custModal && (
        <div className="mo open">
          <div className="mo-box">
            <div className="mo-head"><h3>Quick Add Customer</h3><button className="btn-icon" onClick={() => setCustModal(false)}>✕</button></div>
            <div className="mo-body">
              <div className="fgrid">
                <div className="fg span2"><label>Full Name *</label><input value={newCustForm.name} onChange={ncf('name')} placeholder="e.g. John Doe" /></div>
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
      {/* Configure View Modal */}
      {colModal && (
        <div className="mo open">
          <div className="mo-box" style={{ width: 480 }}>
            <div className="mo-head"><h3>Configure View</h3><button className="btn-icon" onClick={() => setColModal(false)}>✕</button></div>
            <div className="mo-body" style={{ display: 'flex', flexDirection: 'column', gap: 20, maxHeight: '60vh', overflowY: 'auto' }}>
              <div>
                <strong style={{ fontSize: 13, color: 'var(--text)', marginBottom: 12, display: 'block' }}>Visible Statuses</strong>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  {taskStatuses.map(s => (
                    <label key={s} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
                      <input type="checkbox" checked={tempStages.includes(s)} onChange={e => {
                        if (e.target.checked) setTempStages([...tempStages, s]);
                        else setTempStages(tempStages.filter(x => x !== s));
                      }} style={{ width: 16, height: 16, accentColor: 'var(--accent)' }} />
                      {s}
                    </label>
                  ))}
                </div>
              </div>
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
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
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
                <strong style={{ fontSize: 13, color: 'var(--text)', marginBottom: 12, display: 'block' }}>Default Page Size</strong>
                <div style={{ display: 'flex', gap: 8 }}>
                  {[25, 50, 100, 500].map(size => (
                    <button key={size} className={`btn btn-sm ${tempPageSize === size ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTempPageSize(size)}>{size}</button>
                  ))}
                </div>
              </div>
            </div>
            <div className="mo-foot" style={{ justifyContent: 'space-between' }}>
              <button className="btn btn-secondary btn-sm" onClick={resetViewConfig}>Reset</button>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-secondary btn-sm" onClick={() => setColModal(false)}>Cancel</button>
                <button className="btn btn-primary btn-sm" onClick={() => saveViewConfig(tempCols, tempStages, tempPageSize)}>Save View</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
