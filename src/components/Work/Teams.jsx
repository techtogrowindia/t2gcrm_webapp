import React, { useState, useMemo, lazy, Suspense } from 'react';
import { dbWrite, dbOp } from '../../utils/dbWrite';
import db from '../../instant';
import { id } from '@instantdb/react';
import { useToast } from '../../context/ToastContext';
import { AUTH_API } from '../../utils/authApi';
import { EMPTY_MEMBER } from '../../utils/constants';
import { fmtDT, normalizeName } from '../../utils/helpers';

const CallLogs = lazy(() => import('../CallLogs/CallLogs'));
const TeamReports = lazy(() => import('./TeamReports'));

const MODULES = [
  { key: 'Dashboard', actions: ['view'] },
  { key: 'Leads', actions: ['list', 'create', 'edit', 'delete'] },
  { key: 'Customers', actions: ['list', 'create', 'edit', 'delete'] },
  { key: 'Quotations', actions: ['list', 'create', 'edit', 'delete'] },
  { key: 'Invoices', actions: ['list', 'create', 'edit', 'delete'] },
  { key: 'PaymentsReceived', actions: ['list'] },
  { key: 'AMC', actions: ['list', 'create', 'edit', 'delete'] },
  { key: 'Expenses', actions: ['list', 'create', 'edit', 'delete'] },
  { key: 'Products', actions: ['list', 'create', 'edit', 'delete'] },
  { key: 'Vendors', actions: ['list', 'create', 'edit', 'delete'] },
  { key: 'PurchaseOrders', actions: ['list', 'create', 'edit', 'delete'] },
  { key: 'Campaigns', actions: ['list', 'create', 'edit'] },
  { key: 'Projects', actions: ['list', 'create', 'edit', 'delete'] },
  { key: 'Tasks', actions: ['list', 'create', 'edit', 'delete'] },
  { key: 'Teams', actions: ['list', 'create', 'edit', 'delete'] },
  { key: 'Reports', actions: ['view'] },
  { key: 'Automation', actions: ['list', 'create', 'edit', 'delete'] },
  { key: 'Ecommerce', actions: ['list', 'create', 'edit', 'delete'] },
  { key: 'Appointments', actions: ['list', 'create', 'edit', 'delete'] },
  { key: 'Integrations', actions: ['view', 'edit'] },
  { key: 'CallLogs', actions: ['list', 'create', 'edit', 'delete'] },
  { key: 'Attendance', actions: ['list', 'create', 'edit', 'delete'] },
  { key: 'MessagingLogs', actions: ['list'] },
  { key: 'Distributors', actions: ['list', 'create', 'edit', 'delete'] },
];

const ALL_ACTIONS = ['list', 'view', 'create', 'edit', 'delete'];

// Map Teams module key (PascalCase) → Admin plan module key (camelCase)
const MODULE_TO_PLAN_KEY = {
  Dashboard: null,        // Always shown
  Leads: 'leads',
  Customers: 'customers',
  Quotations: 'quotations',
  Invoices: 'invoices',
  PaymentsReceived: 'paymentsReceived',
  AMC: 'amc',
  Expenses: 'expenses',
  Products: 'products',
  Vendors: 'vendors',
  PurchaseOrders: 'purchaseOrders',
  Campaigns: 'campaigns',
  Projects: 'projects',
  Tasks: 'tasks',
  Teams: 'teams',
  Reports: 'reports',
  Automation: 'automation',
  Ecommerce: 'ecommerce',
  Appointments: 'appointments',
  Integrations: 'integrations',
  CallLogs: 'callLogs',
  Attendance: 'attendance',
  MessagingLogs: 'messagingLogs',
  Distributors: 'distributors',
};

const DEFAULT_ROLES = [
  { name: 'Admin', perms: Object.fromEntries(MODULES.map(m => [m.key, [...m.actions]])) },
  { name: 'Sales', perms: { Dashboard: ['view'], Leads: ['list', 'create', 'edit'], Customers: ['list'], Quotations: ['list', 'create'], Products: ['list'] } },
];

// Normalise old string[] perms to new object format
function normalisePerms(perms) {
  if (!perms) return {};
  if (Array.isArray(perms)) {
    // old format: ['Leads', 'Dashboard'] → give full access to those modules
    return Object.fromEntries(
      perms.map(key => {
        const mod = MODULES.find(m => m.key === key);
        return [key, mod ? [...mod.actions] : ['view']];
      })
    );
  }
  return perms; // already new format
}

const EMPTY_ROLE = { name: '', perms: {} };

export default function Teams({ user, ownerId, perms, planEnforcement }) {
  const canCreate = perms?.can('Teams', 'create') === true;
  const canEdit = perms?.can('Teams', 'edit') === true;
  const canDelete = perms?.can('Teams', 'delete') === true;
  const [tab, setTab] = useState('members');
  const [modal, setModal] = useState(false);
  const [roleModal, setRoleModal] = useState(false);
  const [pwdModal, setPwdModal] = useState(null); // holds teamMember being set password
  const [editData, setEditData] = useState(null);
  const [editRole, setEditRole] = useState(null);
  const [form, setForm] = useState(EMPTY_MEMBER);
  const [roleForm, setRoleForm] = useState(EMPTY_ROLE);
  const [pwdForm, setPwdForm] = useState({ password: '', confirm: '' });
  const [pwdLoading, setPwdLoading] = useState(false);
  const toast = useToast();

  const { data } = db.useQuery({
    teamMembers: { $: { where: { userId: ownerId } } },
    userProfiles: { $: { where: { userId: ownerId } } },
    attendance: { $: { where: { userId: ownerId } } },
  });
  const team = data?.teamMembers || [];
  const profileId = data?.userProfiles?.[0]?.id;
  const rawRoles = data?.userProfiles?.[0]?.roles || DEFAULT_ROLES;
  // Normalise all roles to new format
  const roles = rawRoles.map(r => ({ ...r, perms: normalisePerms(r.perms) }));
  const allAttendance = data?.attendance || [];

  // Filter modules to only those enabled in the business plan
  const visibleModules = useMemo(() => {
    if (!planEnforcement) return MODULES;
    return MODULES.filter(m => {
      const planKey = MODULE_TO_PLAN_KEY[m.key];
      if (planKey === null) return true; // Always show Dashboard, Settings
      return planEnforcement.isModuleEnabled(planKey);
    });
  }, [planEnforcement]);

  // Attendance filters
  const [attDateFrom, setAttDateFrom] = useState(() => {
    const d = new Date(); d.setDate(1);
    return d.toISOString().split('T')[0];
  });
  const [attDateTo, setAttDateTo] = useState(() => new Date().toISOString().split('T')[0]);
  const [attStaffFilter, setAttStaffFilter] = useState('');

  const filteredAttendance = useMemo(() => {
    let list = allAttendance;
    if (attStaffFilter) list = list.filter(r => r.staffEmail === attStaffFilter);
    if (attDateFrom) list = list.filter(r => r.date >= attDateFrom);
    if (attDateTo) list = list.filter(r => r.date <= attDateTo);
    return list.sort((a, b) => {
      if (a.date !== b.date) return b.date.localeCompare(a.date);
      return (b.checkInTime || 0) - (a.checkInTime || 0);
    });
  }, [allAttendance, attStaffFilter, attDateFrom, attDateTo]);

  const f = (k) => (e) => setForm(p => ({ ...p, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  const save = async () => {
    if (editData && !canEdit) { toast('Permission denied: cannot edit members', 'error'); return; }
    if (!editData && !canCreate) { toast('Permission denied: cannot add members', 'error'); return; }
    if (!editData && planEnforcement && !planEnforcement.isWithinLimit('maxUsers', team.length)) { toast('Team member limit reached for your plan. Please upgrade.', 'error'); return; }
    if (!form.name.trim() || !form.email.trim()) { toast('Name and email required', 'error'); return; }
    const normalizedEmail = form.email.trim().toLowerCase();
    // Duplicate-email guard: identity is resolved by email, so a member sharing
    // the owner's email (or another member's) corrupts login/permissions — an
    // owner added as a member with their own email gets locked out of Settings.
    if (!editData || normalizedEmail !== (editData.email || '').trim().toLowerCase()) {
      const ownerEmail = (data?.userProfiles?.[0]?.email || '').trim().toLowerCase();
      if (ownerEmail && normalizedEmail === ownerEmail) {
        toast('This email belongs to the business owner — use a different email for the team member', 'error');
        return;
      }
      const dup = team.find(m => m.id !== editData?.id && (m.email || '').trim().toLowerCase() === normalizedEmail);
      if (dup) { toast(`This email is already used by team member "${dup.name}"`, 'error'); return; }
    }
    const trimmedName = normalizeName(form.name);   // trim edges + collapse internal double-spaces — stray spaces break name-based assignment matching
    const payload = { ...form, name: trimmedName, email: normalizedEmail, userId: ownerId };
    if (editData) {
      const oldName = (editData.name || '').trim();
      const renaming = oldName && oldName !== trimmedName;
      if (renaming) {
        // Move the records FIRST, then commit the rename. The old order renamed
        // the member and then cascaded, so a failed cascade left every lead,
        // quote, invoice and AMC pointing at a name nobody had — they vanished
        // from that member's lists with no warning. Failing here changes
        // nothing at all, so it's safe to retry.
        let d;
        try {
          const r = await fetch('/api/rename-assignee', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ownerId, oldName, newName: trimmedName }),
          });
          // A non-2xx used to fall through as a success toast reading
          // "reassigned 0 lead(s)", which looks like "nothing to move".
          if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
          d = await r.json();
        } catch (e) {
          toast(`Rename cancelled — could not move this member's records (${e.message}). Nothing was changed.`, 'error');
          return;
        }
        await dbWrite(dbOp.update('teamMembers', editData.id, payload));
        const moved = Object.entries(d.byCollection || {}).filter(([, n]) => n > 0).map(([c, n]) => `${n} ${c}`);
        toast(`Renamed to "${trimmedName}" — moved ${d.total ?? 0} record(s)${moved.length ? ': ' + moved.join(', ') : ''}`, 'success');
      } else {
        await dbWrite(dbOp.update('teamMembers', editData.id, payload));
        toast('Member updated', 'success');
      }
    }
    else { await dbWrite(dbOp.update('teamMembers', id(), payload)); toast('Member added', 'success'); }
    setModal(false);
  };

  const del = async (tid) => {
    if (!canDelete) { toast('Permission denied: cannot remove members', 'error'); return; }
    if (!confirm('Remove this team member?\n\nThis will also permanently delete:\n• Login credentials (they can no longer sign in)\n• Attendance records\n• Performance stats\n• Activity logs')) return;
    try {
      // Route through /api/data so cascade (credentials, attendance, memberStats, activityLogs) runs
      const res = await fetch('/api/data', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          module: 'teams',
          ownerId,
          actorId: user.id,
          userName: user.email,
          id: tid,
          logText: 'Team member removed from CRM'
        })
      });
      if (!res.ok) throw new Error('Failed to remove member');
      toast('Member removed permanently', 'success');
    } catch (e) {
      toast('Error removing member', 'error');
    }
  };
  const toggleActive = async (m) => { 
    if (!canEdit) { toast('Permission denied', 'error'); return; }
    await dbWrite(dbOp.update('teamMembers', m.id, { active: !m.active })); 
  };

  const saveRole = async () => {
    if (!canEdit) { toast('Permission denied: cannot modify roles', 'error'); return; }
    if (!roleForm.name.trim()) { toast('Role name required', 'error'); return; }
    let newRoles = [...roles];
    if (editRole) {
      const idx = newRoles.findIndex(r => r.name === editRole.name);
      if (idx !== -1) newRoles[idx] = roleForm;
    } else {
      const forbidden = ['superadmin', 'admin'];
      if (forbidden.includes(roleForm.name.toLowerCase())) {
        toast(`"${roleForm.name}" is a protected system role`, 'error');
        return;
      }
      if (newRoles.find(r => r.name.toLowerCase() === roleForm.name.toLowerCase())) {
        toast('Role already exists', 'error');
        return;
      }
      newRoles.push({ name: roleForm.name.trim(), perms: roleForm.perms });
    }
    if (profileId) { await dbWrite(dbOp.update('userProfiles', profileId, { roles: newRoles })); }
    else { await dbWrite(dbOp.update('userProfiles', id(), { roles: newRoles, userId: ownerId })); }
    toast('Role saved', 'success');
    setRoleModal(false);
  };

  const delRole = async (rName) => {
    if (!canDelete) { toast('Permission denied: cannot delete roles', 'error'); return; }
    if (!confirm('Delete this role?')) return;
    const newRoles = roles.filter(r => r.name !== rName);
    if (profileId) await dbWrite(dbOp.update('userProfiles', profileId, { roles: newRoles }));
    toast('Role deleted', 'error');
  };

  // Toggle a single action in a role's perms
  const togglePerm = (moduleKey, action, checked) => {
    setRoleForm(prev => {
      const existing = prev.perms[moduleKey] || [];
      const updated = checked
        ? [...new Set([...existing, action])]
        : existing.filter(a => a !== action);
      const newPerms = { ...prev.perms };
      if (updated.length === 0) delete newPerms[moduleKey];
      else newPerms[moduleKey] = updated;
      return { ...prev, perms: newPerms };
    });
  };

  // Toggle entire module (all or none)
  const toggleModule = (moduleKey, actions, checked) => {
    setRoleForm(prev => {
      const newPerms = { ...prev.perms };
      if (checked) newPerms[moduleKey] = [...actions];
      else delete newPerms[moduleKey];
      return { ...prev, perms: newPerms };
    });
  };

  const handleSetPassword = async () => {
    if (!pwdForm.password || pwdForm.password.length < 6) { toast('Password must be at least 6 characters', 'error'); return; }
    if (pwdForm.password !== pwdForm.confirm) { toast('Passwords do not match', 'error'); return; }
    setPwdLoading(true);
    try {
      const normalizedEmail = pwdModal.email.trim().toLowerCase();
      const res = await fetch(AUTH_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'set-team-password',
          email: normalizedEmail,
          password: pwdForm.password,
          ownerUserId: ownerId,
          teamMemberId: pwdModal.id
        })
      });
      const json = await res.json();
      if (res.ok) {
        toast(`Password set for ${pwdModal.name}!`, 'success');
        // Mark as having password
        await dbWrite(dbOp.update('teamMembers', pwdModal.id, { hasPassword: true }));
        setPwdModal(null);
        setPwdForm({ password: '', confirm: '' });
      } else {
        toast(json.error || 'Failed to set password', 'error');
      }
    } catch (e) {
      toast('Network error', 'error');
    } finally {
      setPwdLoading(false);
    }
  };

  return (
    <div>
      <div className="sh">
        <div><h2>Teams &amp; Roles</h2><div className="sub">Manage team access, attendance &amp; performance</div></div>
        {(tab === 'members' || tab === 'roles') && (
          <button className="btn btn-primary btn-sm" onClick={() => {
            if (tab === 'members') { setEditData(null); setForm({ ...EMPTY_MEMBER, role: roles[0]?.name || '' }); setModal(true); }
            else { setEditRole(null); setRoleForm(EMPTY_ROLE); setRoleModal(true); }
          }}>+ {tab === 'members' ? 'Add Member' : 'Add Role'}</button>
        )}
      </div>
      <div className="tabs">
        <div className={`tab${tab === 'members' ? ' active' : ''}`} onClick={() => setTab('members')}>Members</div>
        <div className={`tab${tab === 'roles' ? ' active' : ''}`} onClick={() => setTab('roles')}>Roles &amp; Permissions</div>
        <div className={`tab${tab === 'attendance' ? ' active' : ''}`} onClick={() => setTab('attendance')}>Attendance</div>
        <div className={`tab${tab === 'calllogs' ? ' active' : ''}`} onClick={() => setTab('calllogs')}>Call Logs</div>
        <div className={`tab${tab === 'performance' ? ' active' : ''}`} onClick={() => setTab('performance')}>Team Performance</div>
      </div>

      {/* Attendance Tab */}
      {tab === 'attendance' && (
        <div className="tw">
          <div style={{ display: 'flex', gap: 8, padding: '16px 20px', flexWrap: 'wrap', alignItems: 'center', borderBottom: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <input type="date" value={attDateFrom} onChange={e => setAttDateFrom(e.target.value)} style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13 }} />
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>to</span>
              <input type="date" value={attDateTo} onChange={e => setAttDateTo(e.target.value)} style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13 }} />
            </div>
            {(perms?.isOwner || perms?.isAdmin || perms?.isManager) && (
              <select value={attStaffFilter} onChange={e => setAttStaffFilter(e.target.value)} style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13 }}>
                <option value="">All Staff</option>
                {team.map(t => <option key={t.id} value={t.email}>{t.name}</option>)}
              </select>
            )}
            <span style={{ fontSize: 12, color: 'var(--muted)', marginLeft: 'auto' }}>{filteredAttendance.length} record{filteredAttendance.length !== 1 ? 's' : ''}</span>
          </div>

          {/* Attendance Summary */}
          {filteredAttendance.length > 0 && (
            <div style={{ display: 'flex', gap: 12, padding: '12px 20px', flexWrap: 'wrap', borderBottom: '1px solid var(--border)', background: 'var(--bg)' }}>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>Total Days: <strong style={{ color: 'var(--text)' }}>{new Set(filteredAttendance.map(r => `${r.staffEmail}-${r.date}`)).size}</strong></div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>Avg Hours: <strong style={{ color: 'var(--text)' }}>{(filteredAttendance.filter(r => r.totalHours).reduce((s, r) => s + r.totalHours, 0) / (filteredAttendance.filter(r => r.totalHours).length || 1)).toFixed(1)}h</strong></div>
            </div>
          )}

          <div className="tw-scroll">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Staff Name</th>
                  <th>Date</th>
                  <th>Check-in Time</th>
                  <th>Check-in Location</th>
                  <th>Check-out Time</th>
                  <th>Check-out Location</th>
                  <th>Total Hours</th>
                </tr>
              </thead>
              <tbody>
                {filteredAttendance.length === 0 ? (
                  <tr><td colSpan={8} style={{ textAlign: 'center', padding: 28, color: 'var(--muted)' }}>No attendance records found</td></tr>
                ) : filteredAttendance.map((r, i) => (
                  <tr key={r.id}>
                    <td style={{ color: 'var(--muted)', fontSize: 11 }}>{i + 1}</td>
                    <td><strong>{r.staffName || r.staffEmail}</strong></td>
                    <td style={{ fontSize: 12 }}>{r.date}</td>
                    <td style={{ fontSize: 12 }}>{r.checkInTime ? new Date(r.checkInTime).toLocaleTimeString() : '-'}</td>
                    <td style={{ fontSize: 12 }}>
                      {r.checkInLat && r.checkInLng ? (
                        <a
                          href={`https://www.google.com/maps?q=${r.checkInLat},${r.checkInLng}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ color: '#2563eb', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4 }}
                          title={r.checkInAddress || `${r.checkInLat}, ${r.checkInLng}`}
                        >
                          <svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" strokeWidth="2" fill="none"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" /><circle cx="12" cy="10" r="3" /></svg>
                          {r.checkInAddress || 'View Map'}
                        </a>
                      ) : '-'}
                    </td>
                    <td style={{ fontSize: 12 }}>{r.checkOutTime ? new Date(r.checkOutTime).toLocaleTimeString() : <span style={{ color: '#f59e0b', fontWeight: 500, fontSize: 11 }}>Active</span>}</td>
                    <td style={{ fontSize: 12 }}>
                      {r.checkOutLat && r.checkOutLng ? (
                        <a
                          href={`https://www.google.com/maps?q=${r.checkOutLat},${r.checkOutLng}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ color: '#2563eb', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4 }}
                          title={r.checkOutAddress || `${r.checkOutLat}, ${r.checkOutLng}`}
                        >
                          <svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" strokeWidth="2" fill="none"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" /><circle cx="12" cy="10" r="3" /></svg>
                          {r.checkOutAddress || 'View Map'}
                        </a>
                      ) : '-'}
                    </td>
                    <td style={{ fontSize: 12, fontWeight: 600 }}>
                      {r.totalHours != null ? (
                        <span style={{ color: r.totalHours >= 8 ? '#16a34a' : r.totalHours >= 4 ? '#f59e0b' : '#ef4444' }}>{r.totalHours}h</span>
                      ) : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Call Logs Tab */}
      {tab === 'calllogs' && (
        <Suspense fallback={<div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" style={{ width: 20, height: 20, margin: '0 auto' }} /></div>}>
          <CallLogs user={user} perms={perms} ownerId={ownerId} planEnforcement={planEnforcement} />
        </Suspense>
      )}

      {/* Team Performance Tab */}
      {tab === 'performance' && (
        <Suspense fallback={<div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" style={{ width: 20, height: 20, margin: '0 auto' }} /></div>}>
          <TeamReports user={user} ownerId={ownerId} perms={perms} planEnforcement={planEnforcement} />
        </Suspense>
      )}

      {tab === 'members' && (
        <div className="tw">
          <div className="tw-head"><h3>Team Members ({team.length})</h3></div>
          <div className="tw-scroll">
            <table>
              <thead><tr><th>#</th><th>Name</th><th>Email</th><th>Phone</th><th>Role</th><th>Status</th><th>Login</th><th>Actions</th></tr></thead>
              <tbody>
                {team.length === 0 ? <tr><td colSpan={8} style={{ textAlign: 'center', padding: 28, color: 'var(--muted)' }}>No team members yet</td></tr>
                  : team.map((m, i) => (
                    <tr key={m.id}>
                      <td style={{ color: 'var(--muted)', fontSize: 11 }}>{i + 1}</td>
                      <td style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ width: 28, height: 28, background: 'var(--accent)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 11, fontWeight: 700 }}>{m.name.charAt(0).toUpperCase()}</div>
                        <strong>{m.name}</strong>
                      </td>
                      <td style={{ fontSize: 12 }}>{m.email}</td>
                      <td style={{ fontSize: 12 }}>{m.phone || '-'}</td>
                      <td><span className="badge bg-blue">{m.role}</span></td>
                      <td>
                        <label className="toggle">
                          <input type="checkbox" checked={m.active !== false} onChange={() => toggleActive(m)} />
                          <span className="toggle-slider" />
                        </label>
                      </td>
                      <td>
                        <span
                          style={{ fontSize: 11, padding: '2px 8px', borderRadius: 9, background: m.hasPassword ? '#d1fae5' : '#fef3c7', color: m.hasPassword ? '#065f46' : '#92400e', fontWeight: 600, cursor: 'pointer' }}
                          onClick={() => { setPwdModal(m); setPwdForm({ password: '', confirm: '' }); }}
                          title={m.hasPassword ? 'Change Password' : 'Set Password to enable login'}
                        >
                          {m.hasPassword ? '🔑 Change Pwd' : '⚠ Set Password'}
                        </span>
                      </td>
                      <td>
                        <button className="btn btn-secondary btn-sm" onClick={() => { setEditData(m); setForm({ name: m.name, email: m.email, phone: m.phone || '', role: m.role, monthlyTarget: m.monthlyTarget ?? '', active: m.active !== false }); setModal(true); }}>Edit</button>{' '}
                        <button className="btn btn-sm" style={{ background: '#fee2e2', color: '#991b1b' }} onClick={() => del(m.id)}>Del</button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {tab === 'roles' && (
        <div className="tw">
          <div className="tw-head"><h3>Roles ({roles.length})</h3></div>
          <div className="tw-scroll">
            <table>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: '12px 16px' }}>Role Name</th>
                  <th style={{ textAlign: 'left', padding: '12px 16px' }}>Modules Accessible</th>
                  <th style={{ textAlign: 'right', padding: '12px 16px' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {roles.map((r, i) => {
                  const moduleCount = Object.keys(r.perms).length;
                  return (
                    <tr key={r.name}>
                      <td style={{ padding: '12px 16px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <strong style={{ fontSize: 14 }}>{r.name}</strong>
                          {r.name === 'Admin' && <span className="badge bg-gray" style={{ fontSize: 10 }}>System Role</span>}
                        </div>
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        <span className="badge bg-blue" style={{ fontSize: 11 }}>{moduleCount} Modules</span>
                        {moduleCount > 0 && (
                          <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--muted)' }}>
                            ({Object.keys(r.perms).slice(0, 3).join(', ')}{moduleCount > 3 ? '...' : ''})
                          </span>
                        )}
                      </td>
                      <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                        {r.name !== 'Admin' ? (
                          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                            <button className="btn btn-secondary btn-sm" onClick={() => { setEditRole(r); setRoleForm({ name: r.name, perms: { ...r.perms } }); setRoleModal(true); }}>Edit Permissions</button>
                            <button className="btn btn-sm" style={{ background: '#fee2e2', color: '#991b1b' }} onClick={() => delRole(r.name)}>Del</button>
                          </div>
                        ) : (
                          <span style={{ fontSize: 11, color: 'var(--muted)', fontStyle: 'italic' }}>Full System Access</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Add/Edit Team Member Modal */}
      {modal && (
        <div className="mo open">
          <div className="mo-box">
            <div className="mo-head"><h3>{editData ? 'Edit' : 'Add'} Team Member</h3><button className="btn-icon" onClick={() => setModal(false)}>✕</button></div>
            <div className="mo-body">
              <div className="fgrid">
                <div className="fg"><label>Full Name *</label><input value={form.name} onChange={f('name')} /></div>
                <div className="fg"><label>Email *</label><input type="email" value={form.email} onChange={f('email')} /></div>
                <div className="fg"><label>Phone</label><input value={form.phone} onChange={f('phone')} /></div>
                <div className="fg"><label>Role</label><select value={form.role} onChange={f('role')}>{roles.map(r => <option key={r.name}>{r.name}</option>)}</select></div>
                <div className="fg"><label>Monthly Target (leads won)</label><input type="number" min="0" placeholder="No target" value={form.monthlyTarget ?? ''} onChange={f('monthlyTarget')} /></div>
              </div>
            </div>
            <div className="mo-foot"><button className="btn btn-secondary btn-sm" onClick={() => setModal(false)}>Cancel</button><button className="btn btn-primary btn-sm" onClick={save}>Save</button></div>
          </div>
        </div>
      )}

      {/* Add/Edit Role Modal */}
      {roleModal && (
        <div className="mo open">
          <div className="mo-box wide">
            <div className="mo-head"><h3>{editRole ? 'Edit' : 'Add'} Role</h3><button className="btn-icon" onClick={() => setRoleModal(false)}>✕</button></div>
            <div className="mo-body">
              <div className="fgrid">
                <div className="fg span2"><label>Role Name *</label><input value={roleForm.name} onChange={e => setRoleForm(p => ({ ...p, name: e.target.value }))} disabled={editRole?.name === 'Admin'} /></div>
                <div className="fg span2">
                  <label>Module Permissions</label>
                  <div style={{ overflowX: 'auto', marginTop: 8 }}>
                    <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
                      <thead>
                        <tr style={{ background: 'var(--bg)' }}>
                          <th style={{ textAlign: 'left', padding: '8px 12px', borderBottom: '1px solid var(--border)' }}>Module</th>
                          <th style={{ textAlign: 'center', padding: '8px 10px', borderBottom: '1px solid var(--border)' }}>All</th>
                          {ALL_ACTIONS.map(a => (
                            <th key={a} style={{ textAlign: 'center', padding: '8px 10px', borderBottom: '1px solid var(--border)', textTransform: 'capitalize' }}>{a}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {visibleModules.map(m => {
                          const granted = roleForm.perms[m.key] || [];
                          const allGranted = m.actions.every(a => granted.includes(a));
                          return (
                            <tr key={m.key} style={{ borderBottom: '1px solid var(--border)' }}>
                              <td style={{ padding: '8px 12px', fontWeight: 600 }}>{m.key}</td>
                              <td style={{ textAlign: 'center', padding: '8px 10px' }}>
                                <input type="checkbox" checked={allGranted} onChange={e => toggleModule(m.key, m.actions, e.target.checked)} style={{ width: 15, height: 15, cursor: 'pointer' }} />
                              </td>
                              {ALL_ACTIONS.map(a => {
                                const supported = m.actions.includes(a);
                                return (
                                  <td key={a} style={{ textAlign: 'center', padding: '8px 10px' }}>
                                    {supported
                                      ? <input type="checkbox" checked={granted.includes(a)} onChange={e => togglePerm(m.key, a, e.target.checked)} style={{ width: 15, height: 15, cursor: 'pointer' }} />
                                      : <span style={{ color: 'var(--muted)' }}>—</span>
                                    }
                                  </td>
                                );
                              })}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
            <div className="mo-foot"><button className="btn btn-secondary btn-sm" onClick={() => setRoleModal(false)}>Cancel</button><button className="btn btn-primary btn-sm" onClick={saveRole}>Save Role</button></div>
          </div>
        </div>
      )}

      {/* Set Password Modal */}
      {pwdModal && (
        <div className="mo open">
          <div className="mo-box" style={{ width: 380 }}>
            <div className="mo-head">
              <h3>🔑 Set Password — {pwdModal.name}</h3>
              <button className="btn-icon" onClick={() => setPwdModal(null)}>✕</button>
            </div>
            <div className="mo-body">
              <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, padding: '10px 12px', marginBottom: 16, fontSize: 12, color: '#1d4ed8' }}>
                This team member will be able to log in with their email <strong>{pwdModal.email}</strong> and this password.
              </div>
              <div className="fgrid">
                <div className="fg span2"><label>New Password</label><input type="password" value={pwdForm.password} onChange={e => setPwdForm(p => ({ ...p, password: e.target.value }))} placeholder="Min. 6 characters" /></div>
                <div className="fg span2"><label>Confirm Password</label><input type="password" value={pwdForm.confirm} onChange={e => setPwdForm(p => ({ ...p, confirm: e.target.value }))} placeholder="Repeat password" /></div>
              </div>
            </div>
            <div className="mo-foot">
              <button className="btn btn-secondary btn-sm" onClick={() => setPwdModal(null)}>Cancel</button>
              <button className="btn btn-primary btn-sm" onClick={handleSetPassword} disabled={pwdLoading}>
                {pwdLoading ? 'Setting...' : '✅ Set Password'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
