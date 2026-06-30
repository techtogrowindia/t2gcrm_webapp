import React, { useState, useMemo, useEffect } from 'react';
import { dbWrite, dbOp } from '../../utils/dbWrite';
import db from '../../instant';
import { id } from '@instantdb/react';
import { stageBadgeClass, prioBadgeClass, fmtD } from '../../utils/helpers';
import { useToast } from '../../context/ToastContext';
import SearchableSelect from '../UI/SearchableSelect';
import { EMPTY_CUSTOMER } from '../../utils/constants';

const PROJ_EMPTY = { name: '', client: '', status: 'Planning', startDate: '', endDate: '', desc: '', assignTo: '' };
const DEFAULT_TASK_STATUSES = ['Pending', 'In Progress', 'Completed'];

export default function Projects({ user, perms, ownerId, planEnforcement }) {
  const canCreateProj = perms?.can('Projects', 'create') === true;
  const canEditProj = perms?.can('Projects', 'edit') === true;
  const canDeleteProj = perms?.can('Projects', 'delete') === true;
  
  const canCreateTask = perms?.can('Tasks', 'create') === true;
  const canEditTask = perms?.can('Tasks', 'edit') === true;
  const canDeleteTask = perms?.can('Tasks', 'delete') === true;

  const [projModal, setProjModal] = useState(false);
  const [editProj, setEditProj] = useState(null);
  const [projForm, setProjForm] = useState(PROJ_EMPTY);
  const [selectedProj, setSelectedProj] = useState(null);
  const [taskModal, setTaskModal] = useState(false);
  const [editTask, setEditTask] = useState(null);
  const [search, setSearch] = useState('');
  
  const toast = useToast();

  const { data } = db.useQuery({
    projects: { $: { where: { userId: ownerId } } },
    tasks: { $: { where: { userId: ownerId } } },
    teamMembers: { $: { where: { userId: ownerId } } },
    userProfiles: { $: { where: { userId: ownerId } } },
    customers: { $: { where: { userId: ownerId }, limit: 10000 } },
  });
  const tasks = data?.tasks || [];
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
  const taxRates = profile.taxRates || [];
  const customFields = profile.customFields || [];
  const taskStatuses = profile.taskStatuses || DEFAULT_TASK_STATUSES;
  const drawerProjectId = selectedProj?.id || null;
  const { data: drawerData } = db.useQuery(drawerProjectId ? {
    activityLogs: { $: { where: { entityId: drawerProjectId } } },
  } : {});
  const [noteText, setNoteText] = useState('');
  
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
  
  const projects = useMemo(() => {
    const raw = data?.projects || [];
    // If user has module access, show all projects for the business
    return raw;
  }, [data?.projects]);

  const filteredProjects = projects.filter(p => {
    if (!search) return true;
    const q = search.toLowerCase();
    return [p.name, p.client, p.desc, p.status].some(v => (v || '').toLowerCase().includes(q));
  }).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)); // newest first

  // Handle deep-linking from activity logs
  useEffect(() => {
    const openId = localStorage.getItem('tc_open_project');
    if (openId && projects.length > 0) {
      const target = projects.find(p => p.id === openId);
      if (target) {
        setSelectedProj(target);
        localStorage.removeItem('tc_open_project');
      }
    }
  }, [projects]);

  const [taskForm, setTaskForm] = useState({ title: '', assignTo: '', dueDate: '', priority: 'Medium', status: taskStatuses[0], notes: '', client: '' });

  const myMember = useMemo(() => team.find(t => t.email === user.email), [team, user.email]);

  const pf = (k) => (e) => setProjForm(p => ({ ...p, [k]: e.target.value }));
  const tf = (k) => (e) => setTaskForm(p => ({ ...p, [k]: e.target.value }));

  const saveProj = async () => {
    if (editProj && !canEditProj) { toast('Permission denied: cannot edit projects', 'error'); return; }
    if (!editProj && !canCreateProj) { toast('Permission denied: cannot create projects', 'error'); return; }
    if (!editProj && planEnforcement && !planEnforcement.isWithinLimit('maxProjects', projects.length)) { toast('Project limit reached for your plan. Please upgrade.', 'error'); return; }
    if (!projForm.name.trim()) { toast('Project name required', 'error'); return; }

    try {
      const isEdit = !!editProj;
      let logText = null;
      if (isEdit) {
        const changes = [];
        const fields = { name: 'Name', client: 'Client', status: 'Status', startDate: 'Start Date', endDate: 'End Date', desc: 'Description' };
        Object.entries(fields).forEach(([k, label]) => {
          if (editProj[k] !== projForm[k]) changes.push(`${label} changed to "${projForm[k] || 'None'}"`);
        });
        if (changes.length > 0) logText = `Project updated: ${changes.join(' | ')}`;
      } else {
        logText = `Project "${projForm.name}" created`;
      }

      const res = await fetch('/api/data', {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          module: 'projects',
          ownerId,
          actorId: user.id,
          userName: user.email,
          teamMemberId: myMember?.id || null,
          id: editProj?.id,
          logText,
          ...projForm
        })
      });
      if (!res.ok) throw new Error('Failed to save project');
      toast(isEdit ? 'Project updated' : 'Project created', 'success');
      setProjModal(false);
    } catch (e) {
      toast('Error: ' + e.message, 'error');
    }
  };

  const delProj = async (pid, pName) => {
    if (!canDeleteProj) { toast('Permission denied: cannot delete projects', 'error'); return; }
    if (!confirm(`Delete project "${pName}"? All tasks will be lost.`)) return;
    
    try {
      const res = await fetch('/api/data', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          module: 'projects',
          ownerId,
          actorId: user.id,
          userName: user.email,
          teamMemberId: myMember?.id || null,
          id: pid,
          logText: `Project "${pName}" deleted with all its tasks`
        })
      });
      if (!res.ok) throw new Error('Failed to delete project');
      if (selectedProj?.id === pid) setSelectedProj(null);
      toast('Project deleted', 'error');
    } catch (e) {
      toast('Error: ' + e.message, 'error');
    }
  };

  const saveTask = async () => {
    if (editTask && !canEditTask) { toast('Permission denied: cannot edit tasks', 'error'); return; }
    if (!editTask && !canCreateTask) { toast('Permission denied: cannot create tasks', 'error'); return; }
    if (!taskForm.title.trim()) { toast('Task title required', 'error'); return; }

    try {
      const isEdit = !!editTask;
      let logText = null;
      if (isEdit) {
        const changes = [];
        const fields = { title: 'Title', assignTo: 'Assignee', dueDate: 'Due Date', priority: 'Priority', status: 'Status', notes: 'Notes' };
        Object.entries(fields).forEach(([k, label]) => {
          if (editTask[k] !== taskForm[k]) changes.push(`${label} changed to "${taskForm[k] || 'None'}"`);
        });
        if (changes.length > 0) logText = `Task updated: ${changes.join(' | ')}`;
      } else {
        logText = `Task "${taskForm.title}" created`;
      }

      const res = await fetch('/api/data', {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          module: 'tasks',
          ownerId,
          actorId: user.id,
          userName: user.email,
          teamMemberId: myMember?.id || null,
          projectId: selectedProj.id,
          id: editTask?.id,
          logText,
          ...taskForm
        })
      });
      if (!res.ok) throw new Error('Failed to save task');
      toast(isEdit ? 'Task updated' : 'Task created', 'success');
      setTaskModal(false);
    } catch (e) {
      toast('Error: ' + e.message, 'error');
    }
  };

  const delTask = async (tid, tTitle) => { 
    if (!canDeleteTask) { toast('Permission denied: cannot delete tasks', 'error'); return; }
    if (!confirm(`Delete task "${tTitle}"?`)) return;

    try {
      const res = await fetch('/api/data', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          module: 'tasks',
          ownerId,
          actorId: user.id,
          userName: user.email,
          teamMemberId: myMember?.id || null,
          projectId: selectedProj.id,
          id: tid,
          logText: `Task "${tTitle}" deleted`
        })
      });
      if (!res.ok) throw new Error('Failed to delete task');
      toast('Task deleted', 'error'); 
    } catch (e) {
      toast('Error: ' + e.message, 'error');
    }
  };

  const cycleStatus = async (t) => {
    if (!canEditTask) { toast('Permission denied', 'error'); return; }
    const idx = taskStatuses.indexOf(t.status);
    const nextStatus = taskStatuses[(idx + 1) % taskStatuses.length];
    
    try {
      const res = await fetch('/api/data', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          module: 'tasks',
          ownerId,
          actorId: user.id,
          userName: user.email,
          teamMemberId: myMember?.id || null,
          projectId: selectedProj.id,
          id: t.id,
          status: nextStatus,
          logText: `Status changed from ${t.status} to ${nextStatus}`
        })
      });
      if (!res.ok) throw new Error('Failed to cycle status');
    } catch (e) {
      toast('Error: ' + e.message, 'error');
    }
  };

  const createCustomer = async () => {
    if (!newCustForm.name.trim()) return toast('Name required', 'error');
    if (!newCustForm.email.trim()) return toast('Email is mandatory for clients', 'error');
    const newId = id();
    await dbWrite(dbOp.update('customers', newId, { ...newCustForm, name: newCustForm.name.trim(), userId: ownerId, actorId: user.id, createdAt: Date.now() }));
    if (projModal) setProjForm(p => ({ ...p, client: newCustForm.name.trim() }));
    if (taskModal) setTaskForm(p => ({ ...p, client: newCustForm.name.trim() }));
    setCustModal(false);
    setNewCustForm(EMPTY_CUSTOMER);
    toast('Customer created!', 'success');
  };

  const projTasks = selectedProj ? tasks.filter(t => t.projectId === selectedProj.id) : [];

  return (
    <div>
      <div className="sh">
        <div><h2>Projects & Tasks</h2></div>
        <div style={{ display: 'flex', gap: 8 }}>
          {selectedProj && <button className="btn btn-secondary btn-sm" onClick={() => setSelectedProj(null)}>← Projects</button>}
          {((selectedProj && canCreateTask) || (!selectedProj && canCreateProj)) && (
            <button className="btn btn-primary btn-sm" onClick={() => {
              if (selectedProj) { setEditTask(null); setTaskForm({ title: '', assignTo: '', dueDate: '', priority: 'Medium', status: taskStatuses[0], notes: '', client: selectedProj.client || '' }); setTaskModal(true); }
              else { fetchModalLeads(); setEditProj(null); setProjForm(PROJ_EMPTY); setProjModal(true); }
            }}>
              + {selectedProj ? 'Create Task' : 'Create Project'}
            </button>
          )}
        </div>
      </div>

      {!selectedProj ? (
        /* PROJECT LIST VIEW */
        <div className="tw">
            <div className="tw-head">
              <h3>Projects ({filteredProjects.length})</h3>
              <div className="sw">
                <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
                <input className="si" placeholder="Search projects..." value={search} onChange={e => setSearch(e.target.value)} />
              </div>
            </div>
          <div className="tw-scroll">
            <table>
              <thead><tr><th>#</th><th>Project Name</th><th>Client</th><th>Start Date</th><th>End Date</th><th style={{width:120}}>Progress</th><th>Status</th><th>Actions</th></tr></thead>
              <tbody>
                {filteredProjects.length === 0 ? <tr><td colSpan={8} style={{ textAlign: 'center', padding: 28, color: 'var(--muted)' }}>No projects found</td></tr>
                  : filteredProjects.map((p, i) => {
                    const ptasks = tasks.filter(t => t.projectId === p.id);
                    const done = ptasks.filter(t => ['Completed', 'Done', 'Success', 'Approved'].includes(t.status) || t.status === taskStatuses[taskStatuses.length - 1]).length;
                    const pct = ptasks.length ? Math.round((done / ptasks.length) * 100) : 0;
                    return (
                      <tr key={p.id}>
                        <td style={{ color: 'var(--muted)', fontSize: 11 }}>{i + 1}</td>
                        <td><strong>{p.name}</strong><br/><span style={{fontSize: 10, color: 'var(--muted)'}}>{p.desc?.substring(0,30)}{p.desc?.length > 30 ? '...' : ''}</span></td>
                        <td>{p.client || '-'}</td>
                        <td>{fmtD(p.startDate)}</td>
                        <td>{fmtD(p.endDate)}</td>
                        <td>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--muted)', marginBottom: 2 }}>
                            <span>{done}/{ptasks.length}</span><span>{pct}%</span>
                          </div>
                          <div className="pbar" style={{height: 4}}><div className="pfill" style={{ width: `${pct}%` }} /></div>
                        </td>
                        <td><span className={`badge ${stageBadgeClass(p.status)}`}>{p.status}</span></td>
                        <td>
                          <button className="btn btn-primary btn-sm" onClick={() => setSelectedProj(p)}>Tasks</button>{' '}
                          {canEditProj && <button className="btn btn-secondary btn-sm" onClick={() => { fetchModalLeads(); setEditProj(p); setProjForm({ name: p.name, client: p.client || '', status: p.status, startDate: p.startDate || '', endDate: p.endDate || '', desc: p.desc || '', assignTo: p.assignTo || '' }); setProjModal(true); }}>Edit</button>}{' '}
                          {canDeleteProj && <button className="btn btn-sm" style={{ background: '#fee2e2', color: '#991b1b' }} onClick={() => delProj(p.id, p.name, p.client)}>Del</button>}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* TASKS LIST VIEW */
        <div>
          <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
            <strong style={{ fontSize: 16 }}>{selectedProj.name}</strong>
            <span className={`badge ${stageBadgeClass(selectedProj.status)}`}>{selectedProj.status}</span>
          </div>

          <div className="tw">
            <div className="tw-head">
              <h3>Project Tasks ({projTasks.length})</h3>
            </div>
            <div className="tw-scroll">
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Task Title</th>
                    <th>Assignee</th>
                    <th>Due Date</th>
                    <th>Priority</th>
                    <th>Status</th>
                    <th>Notes</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {projTasks.length === 0 ? (
                    <tr><td colSpan={8} style={{ textAlign: 'center', padding: 28, color: 'var(--muted)' }}>No tasks in this project yet.</td></tr>
                  ) : projTasks.map((t, i) => (
                    <tr key={t.id}>
                      <td style={{ color: 'var(--muted)', fontSize: 11 }}>{i + 1}</td>
                      <td><strong>{t.title}</strong></td>
                      <td style={{ fontSize: 12 }}>{t.assignTo || '-'}</td>
                      <td style={{ fontSize: 12 }}>{fmtD(t.dueDate)}</td>
                      <td><span className={`badge ${prioBadgeClass(t.priority)}`}>{t.priority}</span></td>
                      <td><span className={`badge ${stageBadgeClass(t.status)}`}>{t.status}</span></td>
                      <td style={{ fontSize: 11, color: 'var(--muted)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={t.notes}>{t.notes || '-'}</td>
                      <td>
                        {canEditTask && <button className="btn btn-secondary btn-sm" onClick={() => { setEditTask(t); setTaskForm({ title: t.title, assignTo: t.assignTo || '', dueDate: t.dueDate || '', priority: t.priority, status: t.status, notes: t.notes || '', client: t.client || '' }); setTaskModal(true); }}>Edit</button>}{' '}
                        {canDeleteTask && <button className="btn btn-sm" style={{ background: '#fee2e2', color: '#991b1b' }} onClick={() => delTask(t.id, t.title)}>Del</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="tw" style={{ marginTop: 24, padding: 20 }}>
            <div className="tw-head"><h3>Project Activity Log</h3></div>
            <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
              <input value={noteText} onChange={e => setNoteText(e.target.value)} placeholder="Type a note for this project..." style={{ flex: 1, padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13 }} />
              <button className="btn btn-primary btn-sm" onClick={async () => { 
                if (!noteText.trim()) return; 
                try {
                  const res = await fetch('/api/data', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                      module: 'logs', 
                      ownerId, 
                      actorId: user.id, 
                      userName: user.email,
                      projectId: selectedProj.id,
                      entityId: selectedProj.id,
                      entityType: 'project',
                      text: noteText
                    })
                  });
                  if (!res.ok) throw new Error('Failed to post note');
                  setNoteText('');
                  toast('Note added', 'success');
                } catch (e) {
                  toast('Error: ' + e.message, 'error');
                }
              }}>Post</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxHeight: 300, overflowY: 'auto' }}>
              {(() => {
                const relevantLogs = (drawerData?.activityLogs || []).sort((a,b) => b.createdAt - a.createdAt);
                if (relevantLogs.length === 0) return <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 13, padding: 20 }}>No activity recorded yet for this project.</div>;
                return relevantLogs.map(log => (
                  <div key={log.id} style={{ display: 'flex', gap: 12, paddingBottom: 10, borderBottom: '1px solid var(--border)' }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: log.entityType === 'task' ? '#3b82f6' : 'var(--accent)', marginTop: 6, flexShrink: 0 }} title={log.entityType} />
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                        <span style={{ fontSize: 11, fontWeight: 700 }}>{log.userName} <span style={{ fontWeight: 400, color: 'var(--muted)', marginLeft: 4 }}>({log.entityType})</span></span>
                        <span style={{ fontSize: 10, color: 'var(--muted)' }}>{new Date(log.createdAt).toLocaleString()}</span>
                      </div>
                      <div style={{ fontSize: 12, color: '#444' }}>
                        {log.text?.split('\n').map((line, i) => (
                          <div key={i} style={{ marginBottom: line ? 2 : 0 }}>
                            {line.split('**').map((part, j) => 
                              j % 2 === 1 ? <mark key={j} style={{ background: '#fef08a', color: '#854d0e', padding: '0 4px', borderRadius: 4, fontWeight: 600 }}>{part}</mark> : part
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ));
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Project Modal */}
      {projModal && (
        <div className="mo open">
          <div className="mo-box">
            <div className="mo-head"><h3>{editProj ? 'Edit' : 'Create'} Project</h3><button className="btn-icon" onClick={() => setProjModal(false)}>✕</button></div>
            <div className="mo-body">
              <div className="fgrid">
                <div className="fg span2"><label>Project Name *</label><input value={projForm.name} onChange={pf('name')} /></div>
                <div className="fg">
                  <label>Client</label>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <div style={{ flex: 1 }}>
                      <SearchableSelect 
                        options={clientOptions} 
                        displayKey="displayName" 
                        returnKey="name"
                        value={projForm.client} 
                        onChange={val => setProjForm(p => ({ ...p, client: val }))} 
                        placeholder="Search client or lead..." 
                      />
                    </div>
                    <button className="btn btn-secondary" style={{ padding: '0 10px' }} onClick={() => setCustModal(true)} title="Add New Customer">+</button>
                  </div>
                </div>
                <div className="fg"><label>Status</label><select value={projForm.status} onChange={pf('status')}>{['Planning', 'In Progress', 'On Hold', 'Completed', 'Cancelled'].map(s => <option key={s}>{s}</option>)}</select></div>
                <div className="fg"><label>Start Date</label><input type="date" value={projForm.startDate} onChange={pf('startDate')} /></div>
                <div className="fg"><label>End Date</label><input type="date" value={projForm.endDate} onChange={pf('endDate')} /></div>
                <div className="fg"><label>Assign To</label><select value={projForm.assignTo} onChange={pf('assignTo')}><option value="">Unassigned</option>{team.map(t => <option key={t.id}>{t.name}</option>)}</select></div>
                <div className="fg span2"><label>Description</label><textarea value={projForm.desc} onChange={pf('desc')} /></div>
              </div>
            </div>
            <div className="mo-foot"><button className="btn btn-secondary btn-sm" onClick={() => setProjModal(false)}>Cancel</button><button className="btn btn-primary btn-sm" onClick={saveProj}>Save</button></div>
          </div>
        </div>
      )}

      {/* Task Modal */}
      {taskModal && (
        <div className="mo open">
          <div className="mo-box">
            <div className="mo-head"><h3>{editTask ? 'Edit' : 'Create'} Task</h3><button className="btn-icon" onClick={() => setTaskModal(false)}>✕</button></div>
            <div className="mo-body">
              <div className="fgrid">
                <div className="fg span2"><label>Task Title *</label><input value={taskForm.title} onChange={tf('title')} /></div>
                <div className="fg">
                  {selectedProj?.client ? (
                    <>
                      <label>Client</label>
                      <div style={{ padding: '8px 12px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13, color: 'var(--muted)' }}>
                        👤 {selectedProj.client} <span style={{ fontSize: 10, color: 'var(--accent)' }}>(from project)</span>
                      </div>
                    </>
                  ) : (
                    <>
                      <label>Client</label>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <div style={{ flex: 1 }}>
                          <SearchableSelect 
                            options={clientOptions} 
                            displayKey="displayName" 
                            returnKey="name"
                            value={taskForm.client} 
                            onChange={val => setTaskForm(p => ({ ...p, client: val }))} 
                            placeholder="Search client or lead..." 
                          />
                        </div>
                        <button className="btn btn-secondary" style={{ padding: '0 10px' }} onClick={() => setCustModal(true)} title="Add New Customer">+</button>
                      </div>
                    </>
                  )}
                </div>
                <div className="fg"><label>Assign To</label><select value={taskForm.assignTo} onChange={tf('assignTo')}><option value="">Unassigned</option>{team.map(t => <option key={t.id}>{t.name}</option>)}</select></div>
                <div className="fg"><label>Due Date</label><input type="date" value={taskForm.dueDate} onChange={tf('dueDate')} /></div>
                <div className="fg"><label>Priority</label><select value={taskForm.priority} onChange={tf('priority')}>{['High', 'Medium', 'Low'].map(s => <option key={s}>{s}</option>)}</select></div>
                <div className="fg"><label>Status</label><select value={taskForm.status} onChange={tf('status')}>{taskStatuses.map(s => <option key={s}>{s}</option>)}</select></div>
                <div className="fg span2"><label>Notes</label><textarea value={taskForm.notes} onChange={tf('notes')} /></div>
              </div>
            </div>
            <div className="mo-foot"><button className="btn btn-secondary btn-sm" onClick={() => setTaskModal(false)}>Cancel</button><button className="btn btn-primary btn-sm" onClick={saveTask}>Save</button></div>
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
    </div>
  );
}
