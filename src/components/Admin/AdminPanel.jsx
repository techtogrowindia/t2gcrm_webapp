import React, { useState } from 'react';
import { dbWrite, dbOp } from '../../utils/dbWrite';
import db from '../../instant';
import { id } from '@instantdb/react';
import { fmt, fmtD } from '../../utils/helpers';
import { useToast } from '../../context/ToastContext';
import { AUTH_API } from '../../utils/authApi';
import ArchiveManager from './ArchiveManager';

const FALLBACK_PLANS = [
  { id: 'trial', name: 'Trial', duration: 7, price: 0, maxLeads: 50, maxUsers: 1, features: 'Leads, Quotations' },
  { id: 'premium', name: 'Premium', duration: 30, price: 2999, maxLeads: 500, maxUsers: 5, features: 'Leads, Quotations, Invoices, Projects' },
  { id: 'startup', name: 'START-UP', duration: 365, price: 24999, maxLeads: -1, maxUsers: 10, features: 'All Features' },
  { id: 'pro', name: 'Premium Pro', duration: 365, price: 29999, maxLeads: -1, maxUsers: -1, features: 'All Features + Priority Support' },
];

const ALL_MODULES = [
  { key: 'leads', label: 'Leads', hasLimit: true, limitKey: 'maxLeads', defaultLimit: 10000 },
  { key: 'customers', label: 'Customers', hasLimit: true, limitKey: 'maxCustomers', defaultLimit: 10000 },
  { key: 'quotations', label: 'Quotations', hasLimit: false },
  { key: 'invoices', label: 'Invoices', hasLimit: true, limitKey: 'maxInvoices', defaultLimit: -1 },
  { key: 'paymentsReceived', label: 'Payments Received', hasLimit: false },
  { key: 'pos', label: 'POS Billing', hasLimit: false },
  { key: 'amc', label: 'AMC', hasLimit: false },
  { key: 'expenses', label: 'Expenses', hasLimit: false },
  { key: 'products', label: 'Products', hasLimit: true, limitKey: 'maxProducts', defaultLimit: -1 },
  { key: 'vendors', label: 'Vendors', hasLimit: false },
  { key: 'purchaseOrders', label: 'Purchase Orders', hasLimit: false },
  { key: 'projects', label: 'Projects', hasLimit: true, limitKey: 'maxProjects', defaultLimit: 10 },
  { key: 'tasks', label: 'Tasks', hasLimit: true, limitKey: 'maxTasks', defaultLimit: 500 },
  { key: 'teams', label: 'Teams', hasLimit: true, limitKey: 'maxUsers', defaultLimit: 5 },
  { key: 'campaigns', label: 'Campaigns / Marketing', hasLimit: false },
  { key: 'reports', label: 'Reports', hasLimit: false },
  { key: 'automation', label: 'Automation', hasLimit: false },
  { key: 'ecommerce', label: 'E-Commerce Store', hasLimit: false },
  { key: 'appointments', label: 'Appointments', hasLimit: false },
  { key: 'integrations', label: 'Integrations', hasLimit: false },
  { key: 'callLogs', label: 'Call Logs', hasLimit: false },
  { key: 'attendance', label: 'Attendance', hasLimit: false },
  { key: 'messagingLogs', label: 'Messaging Logs', hasLimit: false },
  { key: 'distributors', label: 'Distributors & Retailers', hasLimit: false },
];

const DEFAULT_MODULES = Object.fromEntries(ALL_MODULES.map(m => [m.key, true]));
const DEFAULT_LIMITS = Object.fromEntries(ALL_MODULES.filter(m => m.hasLimit).map(m => [m.limitKey, m.defaultLimit]));

const EMPTY_PLAN = { name: '', duration: 30, price: 0, features: '', modules: { ...DEFAULT_MODULES }, limits: { ...DEFAULT_LIMITS } };

const EMPTY_BIZ = { fullName: '', email: '', phone: '', bizName: '', password: '', plan: 'Trial' };


export default function AdminPanel({ user }) {
  const [tab, setTab] = useState('users');
  const [analyticsData, setAnalyticsData] = useState(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [cleanupLoading, setCleanupLoading] = useState(false);
  const [selectedBizIds, setSelectedBizIds] = useState(new Set());
  const [cleanupDays, setCleanupDays] = useState(90);
  const [orphanReport, setOrphanReport] = useState(null);
  const [orphanLoading, setOrphanLoading] = useState(false);
  const [couponModal, setCouponModal] = useState(false);
  const [couponForm, setCouponForm] = useState({ code: '', discount: 20, type: 'Percentage', maxUses: 100 });
  const [settingsForm, setSettingsForm] = useState({ brandName: '', brandShort: '', brandLogo: '', title: '', favicon: '', crmDomain: '', showBranding: true, mobileAppIcon: '' });
  const [planModal, setPlanModal] = useState(false);
  const [planForm, setPlanForm] = useState(EMPTY_PLAN);
  const [editPlanIdx, setEditPlanIdx] = useState(null);
  const [editUserModal, setEditUserModal] = useState(false);
  const [editUserData, setEditUserData] = useState(null);
  const [editUserForm, setEditUserForm] = useState({ newPassword: '', expiry: '', role: '' });
  const [editUserLoading, setEditUserLoading] = useState(false);
  // Create Business
  const [createBizModal, setCreateBizModal] = useState(false);
  const [createBizForm, setCreateBizForm] = useState(EMPTY_BIZ);
  const [createBizLoading, setCreateBizLoading] = useState(false);
  // Delete Business
  const [deleteModal, setDeleteModal] = useState(null); // holds user object
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleteLoading, setDeleteLoading] = useState(false);

  const hasSettingsLoaded = React.useRef(false);
  const toast = useToast();

  const { data, error } = db.useQuery({
    userProfiles: {},
    coupons: { $: { where: { createdBy: user.id } } },
    globalSettings: {},
  });
  // Lazy: only subscribe to transactions when on that tab (avoids loading all transactions upfront)
  const { data: txData } = db.useQuery(tab === 'transactions' ? { transactions: {} } : {});

  if (error) console.error('AdminPanel Query Error:', error);

  const users = data?.userProfiles || [];
  const coupons = data?.coupons || [];
  const transactions = txData?.transactions || [];
  const globalSettings = data?.globalSettings?.[0] || {};
  const settingsId = globalSettings.id || '73f6063d-4c3d-4d51-9f93-111111111111';
  const plans = globalSettings.plans ? JSON.parse(globalSettings.plans) : FALLBACK_PLANS;

  React.useEffect(() => {
    if (data?.globalSettings?.[0] && !hasSettingsLoaded.current) {
        hasSettingsLoaded.current = true;
        const s = data.globalSettings[0];
        setSettingsForm({
          brandName: s.brandName || '',
          brandShort: s.brandShort || '',
          brandLogo: s.brandLogo || '',
          title: s.title || '',
          favicon: s.favicon || '',
          crmDomain: s.crmDomain || '',
          showBranding: s.showBranding !== false,
          mobileAppIcon: s.mobileAppIcon || ''
        });
    }
  }, [data]);

  /* ──────────── COUPON ──────────── */
  const saveCoupon = async () => {
    if (!couponForm.code.trim()) { toast('Code required', 'error'); return; }
    await dbWrite(dbOp.update('coupons', id(), { ...couponForm, createdBy: user.id, active: true, usedCount: 0 }));
    toast('Coupon created', 'success');
    setCouponModal(false);
  };
  const delCoupon = async (cid) => { await dbWrite(dbOp.delete('coupons', cid)); toast('Deleted', 'error'); };

  /* ──────── ORPHAN SCAN / CLEANUP ──────── */
  const scanOrphans = async () => {
    setOrphanLoading(true);
    setOrphanReport(null);
    try {
      const r = await fetch(AUTH_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'scan-orphans' })
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Scan failed');
      setOrphanReport(data);
      toast(`Found ${data.totalOrphans} orphaned records`, data.totalOrphans > 0 ? 'success' : 'success');
    } catch (e) { toast(e.message, 'error'); }
    finally { setOrphanLoading(false); }
  };

  const cleanupOrphans = async () => {
    if (!orphanReport || orphanReport.totalOrphans === 0) { toast('Run scan first', 'error'); return; }
    if (!window.confirm(`Permanently delete ${orphanReport.totalOrphans} orphaned records from the database?\n\nThis action cannot be undone.`)) return;
    setOrphanLoading(true);
    try {
      const r = await fetch(AUTH_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cleanup-orphans' })
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Cleanup failed');
      setOrphanReport(data);
      toast(`Deleted ${data.totalOrphans} orphaned records`, 'success');
    } catch (e) { toast(e.message, 'error'); }
    finally { setOrphanLoading(false); }
  };

  /* ──────────── USERS ──────────── */
  const updateUserPlan = async (uid, planName) => {
    if (!window.confirm(`Change user plan to ${planName}?`)) return;
    const planObj = plans.find(p => p.name === planName);
    const duration = planObj?.duration || 7;
    const newExpiry = Date.now() + (duration * 24 * 60 * 60 * 1000);
    await dbWrite(dbOp.update('userProfiles', uid, { plan: planName, planExpiry: newExpiry }));
    toast(`Plan updated to ${planName}`, 'success');
  };

  const banUser = async (uid, banned) => {
    await dbWrite(dbOp.update('userProfiles', uid, { banned: !banned }));
    toast(!banned ? 'User banned' : 'User reinstated', !banned ? 'error' : 'success');
  };

  const openEditUser = (u) => {
    setEditUserData(u);
    setEditUserForm({
      newPassword: '',
      expiry: u.planExpiry ? new Date(u.planExpiry).toISOString().split('T')[0] : '',
      role: u.role || 'user',
    });
    setEditUserModal(true);
  };

  const resetUserPassword = async () => {
    if (!editUserData || !editUserForm.newPassword.trim()) { toast('Enter a new password', 'error'); return; }
    if (editUserForm.newPassword.length < 6) { toast('Password must be at least 6 characters', 'error'); return; }
    if (!window.confirm(`Reset password for ${editUserData.email}?`)) return;
    setEditUserLoading(true);
    try {
      // AUTH_API routes to /api/auth-pg when VITE_USE_PG_AUTH=true, so the new
      // password lands in Postgres (which login reads) instead of only
      // InstantDB. Hardcoding /api/auth here was why admin resets silently did
      // nothing on the PG stack.
      const res = await fetch(AUTH_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'change-password', email: editUserData.email, newPassword: editUserForm.newPassword })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      toast(`Password reset for ${editUserData.email}`, 'success');
      setEditUserForm(f => ({ ...f, newPassword: '' }));
    } catch (e) { toast(e.message, 'error'); }
    finally { setEditUserLoading(false); }
  };

  const updateUserExpiry = async () => {
    if (!editUserData || !editUserForm.expiry) { toast('Select an expiry date', 'error'); return; }
    const newExpiry = new Date(editUserForm.expiry).getTime();
    if (!window.confirm(`Set plan expiry for ${editUserData.email} to ${editUserForm.expiry}?`)) return;
    await dbWrite(dbOp.update('userProfiles', editUserData.id, { planExpiry: newExpiry }));
    toast('Expiry updated', 'success');
  };

  const updateUserRole = async () => {
    if (!editUserData) return;
    if (!window.confirm(`Change role of ${editUserData.email} to "${editUserForm.role}"?`)) return;
    await dbWrite(dbOp.update('userProfiles', editUserData.id, { role: editUserForm.role }));
    toast(`Role updated to ${editUserForm.role}`, 'success');
  };

  const repairData = async () => {
    const txs = users.map(u => {
      const updates = {};
      if (!u.planExpiry) {
        const dur = plans.find(p => p.name === (u.plan || 'Trial'))?.duration || 7;
        updates.planExpiry = Date.now() + (dur * 24 * 60 * 60 * 1000);
      }
      return Object.keys(updates).length ? dbOp.update('userProfiles', u.id, updates) : null;
    }).filter(Boolean);
    if (txs.length) { await dbWrite(txs); toast(`Repaired ${txs.length} profiles`, 'success'); }
    else toast('All profiles look healthy', 'info');
  };

  const updateEmail = async (uid, email) => {
    if (!email.includes('@')) return;
    await dbWrite(dbOp.update('userProfiles', uid, { email: email.trim() }));
    toast('Email updated', 'success');
  };

  const updatePhone = async (uid, phone) => {
    if (!phone?.trim()) return;
    await dbWrite(dbOp.update('userProfiles', uid, { phone: phone.trim() }));
    toast('Phone updated', 'success');
  };

  /* ──────────── CREATE BUSINESS ──────────── */
  const createBusiness = async () => {
    if (!createBizForm.email.trim() || !createBizForm.password.trim()) { toast('Email and password are required', 'error'); return; }
    if (createBizForm.password.length < 6) { toast('Password must be at least 6 characters', 'error'); return; }
    setCreateBizLoading(true);
    try {
      const planObj = plans.find(p => p.name === createBizForm.plan);
      // AUTH_API → /api/auth-pg on the PG stack, which creates the accounts +
      // credential rows in Postgres so the new owner can actually log in.
      const res = await fetch(AUTH_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'admin-create-user',
          email: createBizForm.email.trim(),
          password: createBizForm.password,
          fullName: createBizForm.fullName.trim(),
          bizName: createBizForm.bizName.trim(),
          phone: createBizForm.phone.trim(),
          selectedPlan: createBizForm.plan,
          duration: planObj?.duration || 7
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create business');
      toast(data.message || 'Business created!', 'success');
      setCreateBizModal(false);
      setCreateBizForm(EMPTY_BIZ);
    } catch (e) { toast(e.message, 'error'); }
    finally { setCreateBizLoading(false); }
  };

  /* ──────────── DELETE BUSINESS ──────────── */
  const deleteBusiness = async () => {
    if (!deleteModal) return;
    const expectedText = (deleteModal.bizName || deleteModal.email || '').trim();
    if (deleteConfirmText.trim().toLowerCase() !== expectedText.toLowerCase()) {
      toast('Confirmation text does not match. Please type the exact business name.', 'error');
      return;
    }
    setDeleteLoading(true);
    try {
      // AUTH_API → /api/auth-pg on the PG stack, which hard-deletes the tenant
      // rows + credentials + accounts row in Postgres (where the data lives).
      const res = await fetch(AUTH_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'admin-delete-user',
          profileId: deleteModal.id,
          targetUserId: deleteModal.userId,
          ownerEmail: deleteModal.email
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to delete');
      toast(`Business deleted. ${data.deletedCount || 0} records removed.`, 'success');
      setDeleteModal(null);
      setDeleteConfirmText('');
    } catch (e) { toast(e.message, 'error'); }
    finally { setDeleteLoading(false); }
  };

  /* ──────────── PLANS ──────────── */
  const savePlan = async () => {
    if (!planForm.name.trim()) { toast('Plan name required', 'error'); return; }
    // Normalize modules: every ALL_MODULES key must be present with an explicit
    // true/false value. Otherwise usePlanEnforcement can't tell "not yet
    // configured" from "intentionally disabled" after a new module is added.
    const normalizedModules = Object.fromEntries(
      ALL_MODULES.map(m => [m.key, planForm.modules?.[m.key] === true])
    );
    const normalizedLimits = { ...DEFAULT_LIMITS, ...(planForm.limits || {}) };
    const newPlans = [...plans];
    const planEntry = {
      ...planForm,
      modules: normalizedModules,
      limits: normalizedLimits,
      price: +planForm.price,
      duration: +planForm.duration,
      id: planForm.id || id(),
    };
    if (editPlanIdx !== null) newPlans[editPlanIdx] = planEntry;
    else newPlans.push(planEntry);
    await dbWrite(dbOp.update('globalSettings', settingsId, { plans: JSON.stringify(newPlans) }));
    toast(editPlanIdx !== null ? 'Plan updated' : 'Plan created', 'success');
    setPlanModal(false); setEditPlanIdx(null); setPlanForm(EMPTY_PLAN);
  };

  const deletePlan = async (idx) => {
    if (!window.confirm(`Delete plan "${plans[idx].name}"?`)) return;
    const newPlans = plans.filter((_, i) => i !== idx);
    await dbWrite(dbOp.update('globalSettings', settingsId, { plans: JSON.stringify(newPlans) }));
    toast('Plan deleted', 'error');
  };

  const togglePlanVisibility = async (idx) => {
    const newPlans = [...plans];
    newPlans[idx] = { ...newPlans[idx], hidden: !newPlans[idx].hidden };
    await dbWrite(dbOp.update('globalSettings', settingsId, { plans: JSON.stringify(newPlans) }));
    toast(newPlans[idx].hidden ? `"${newPlans[idx].name}" is now hidden from users` : `"${newPlans[idx].name}" is now visible to all`, 'success');
  };

  /* ──────────── SETTINGS ──────────── */
  const saveSettings = async () => {
    try {
      await dbWrite(dbOp.update('globalSettings', settingsId, {
        brandName: settingsForm.brandName || '',
        brandShort: settingsForm.brandShort || '',
        brandLogo: settingsForm.brandLogo || '',
        title: settingsForm.title || '',
        favicon: settingsForm.favicon || '',
        crmDomain: settingsForm.crmDomain || '',
        showBranding: settingsForm.showBranding !== false,
        mobileAppIcon: settingsForm.mobileAppIcon || '',
      }));
      toast('Platform Settings Updated', 'success');
    } catch (err) {
      toast(`Save Failed: ${err.message || 'Unknown Error'}`, 'error');
    }
  };

  const totalRevenue = transactions.filter(t => t.status === 'Success').reduce((s, t) => s + (t.amount || 0), 0);
  const activeUsers = users.filter(u => !u.banned).length;

  return (
    <div>
      <div className="sh">
        <div><h2>Admin Panel</h2><div className="sub" style={{ color: '#ef4444' }}>Platform management — restricted access</div></div>
      </div>

      <div className="stat-grid" style={{ marginBottom: 18 }}>
        <div className="stat-card sc-blue"><div className="lbl">Total Users</div><div className="val">{users.length}</div></div>
        <div className="stat-card sc-green"><div className="lbl">Active Users</div><div className="val">{activeUsers}</div></div>
        <div className="stat-card sc-yellow"><div className="lbl">Revenue</div><div className="val" style={{ fontSize: 16 }}>{fmt(totalRevenue)}</div></div>
        <div className="stat-card sc-purple"><div className="lbl">Coupons</div><div className="val">{coupons.length}</div></div>
      </div>

      <div className="tabs">
        {[
          ['users', 'Users'], 
          ['plans', 'Plans'], 
          ['coupons', 'Coupons'], 
          ['transactions', 'Transactions'], 
          ['analytics', '📊 Business Report'],
          ['archive', '📦 Archive Manager'],
          ['settings', 'Platform Branding']
        ].map(([t, l]) => (
          <div key={t} className={`tab${tab === t ? ' active' : ''}`} onClick={() => setTab(t)}>{l}</div>
        ))}
      </div>

      {/* ── USERS ── */}
      {tab === 'users' && (
        <div className="tw">
          <div className="tw-head">
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <h3>All Registered Profiles ({users.length})</h3>
              <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 400 }}>Manage business accounts, plans, and access.</div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-primary btn-sm" onClick={() => { setCreateBizForm({ ...EMPTY_BIZ, plan: plans[0]?.name || 'Trial' }); setCreateBizModal(true); }}>➕ Create Business</button>
              <button className="btn btn-secondary btn-sm" onClick={repairData}>🛠 Repair All</button>
            </div>
          </div>
          <div className="tw-scroll">
            <table>
              <thead><tr><th>#</th><th>User Contact</th><th>Phone</th><th>Business</th><th>Plan</th><th>Expiry</th><th>Created</th><th>Role</th><th>Status</th><th>Actions</th></tr></thead>
              <tbody>
                {users.length === 0 ? <tr><td colSpan={10} style={{ textAlign: 'center', padding: 28, color: 'var(--muted)' }}>No users yet</td></tr>
                  : users.map((u, i) => (
                    <tr key={u.id}>
                      <td style={{ color: 'var(--muted)', fontSize: 11 }}>{i + 1}</td>
                      <td>
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                          {u.fullName && <div style={{ fontSize: 13, fontWeight: 700 }}>{u.fullName}</div>}
                          {u.email?.includes('@') ? <div style={{ fontSize: 11, color: 'var(--muted)' }}>{u.email}</div>
                            : (<div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                <input placeholder="Add Email..." defaultValue={u.email && !u.email.includes('@') ? '' : u.email} onBlur={e => updateEmail(u.id, e.target.value)} style={{ fontSize: 11, padding: '4px 8px', border: '1px solid #fee2e2', background: '#fffafb', borderRadius: 6, width: 140 }} />
                                <span title="Invalid or Missing Email" style={{ cursor: 'help' }}>⚠️</span>
                              </div>)}
                        </div>
                      </td>
                      <td style={{ fontSize: 12 }}>
                        {u.phone ? <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{u.phone}</span>
                          : (<input placeholder="Add Phone..." defaultValue={u.phone} onBlur={e => updatePhone(u.id, e.target.value)} style={{ fontSize: 11, padding: '4px 8px', border: '1px solid #fee2e2', background: '#fffafb', borderRadius: 6, width: 100 }} />)}
                      </td>
                      <td style={{ fontSize: 12 }}>{u.bizName || '-'}</td>
                      <td>
                        <select value={u.plan || 'Trial'} onChange={e => updateUserPlan(u.id, e.target.value)} style={{ padding: '4px 8px', border: '1.5px solid var(--border)', borderRadius: 7, fontSize: 12, fontFamily: 'inherit' }}>
                          {plans.map(p => <option key={p.name} value={p.name}>{p.name}{p.hidden ? ' 🔒' : ''}</option>)}
                        </select>
                      </td>
                      <td style={{ fontSize: 11 }}>{u.planExpiry ? fmtD(u.planExpiry) : '-'}</td>
                      <td style={{ fontSize: 11 }}>{u.createdAt ? fmtD(u.createdAt) : '-'}</td>
                      <td><span className={`badge ${u.role === 'superadmin' ? 'bg-purple' : 'bg-gray'}`}>{u.role || 'user'}</span></td>
                      <td><span className={`badge ${u.banned ? 'bg-red' : 'bg-green'}`}>{u.banned ? 'Banned' : 'Active'}</span></td>
                      <td>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button className="btn btn-secondary btn-sm" onClick={() => openEditUser(u)}>✏️ Edit</button>
                          <button className="btn btn-sm" style={{ background: u.banned ? '#dcfce7' : '#fee2e2', color: u.banned ? '#166534' : '#991b1b' }} onClick={() => banUser(u.id, u.banned)}>
                            {u.banned ? '✓ Reinstate' : '⊘ Ban'}
                          </button>
                          <button className="btn btn-sm" style={{ background: '#fee2e2', color: '#991b1b' }} onClick={() => { setDeleteModal(u); setDeleteConfirmText(''); }} title="Delete Business">🗑</button>
                        </div>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── PLANS ── */}
      {tab === 'plans' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>
              <span style={{ background: '#fef3c7', color: '#92400e', padding: '3px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600 }}>🔒 Hidden</span>
              <span style={{ marginLeft: 8 }}>plans are only visible to assigned businesses</span>
            </div>
            <button className="btn btn-primary btn-sm" onClick={() => { setEditPlanIdx(null); setPlanForm(EMPTY_PLAN); setPlanModal(true); }}>+ Add Plan</button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(280px,1fr))', gap: 14 }}>
            {plans.map((p, i) => {
              // Must match usePlanEnforcement.isModuleEnabled exactly (strict
              // === true). Anything looser makes this panel claim a module is
              // enabled while the business can't see it.
              const enabledMods = ALL_MODULES.filter(m => p.modules ? p.modules[m.key] === true : true);
              // Keys added to ALL_MODULES after this plan was last saved. They
              // enforce as OFF, so the plan has to be re-saved to pick them up.
              const unconfigured = p.modules ? ALL_MODULES.filter(m => p.modules[m.key] === undefined) : [];
              const isHidden = !!p.hidden;
              const assignedCount = users.filter(u => u.plan === p.name).length;
              return (
                <div key={p.id || p.name} className={`plan-card${i === 1 && !isHidden ? ' featured' : ''}`} style={{ position: 'relative', opacity: isHidden ? 0.7 : 1, border: isHidden ? '2px dashed #fbbf24' : undefined }}>
                  {i === 1 && !isHidden && <div className="plan-badge">Popular</div>}
                  {unconfigured.length > 0 && (
                    <div style={{ background: '#fef3c7', color: '#92400e', border: '1px solid #fcd34d', borderRadius: 6, padding: '6px 8px', fontSize: 11, fontWeight: 600, marginBottom: 8 }}>
                      ⚠ {unconfigured.length} new module{unconfigured.length === 1 ? '' : 's'} not configured on this plan ({unconfigured.map(m => m.label).join(', ')}).
                      They are switched OFF for {assignedCount === 1 ? 'the business' : 'businesses'} on this plan until you press Edit → Update.
                    </div>
                  )}
                  {isHidden && <div style={{ position: 'absolute', top: -10, right: 10, background: '#fef3c7', color: '#92400e', padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700 }}>🔒 Hidden</div>}
                  <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 5 }}>{p.name}</div>
                  <div style={{ fontSize: 26, fontWeight: 800, color: 'var(--accent)', marginBottom: 4 }}>
                    {+(p.price || 0) === 0 ? 'Free' : `₹${(+(p.price || 0)).toLocaleString()}`}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 10 }}>per {p.duration} days</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 10 }}>
                    {enabledMods.map(m => (
                      <span key={m.key} style={{ fontSize: 10, padding: '2px 6px', background: 'var(--bg-soft)', borderRadius: 4, border: '1px solid var(--border)' }}>{m.label}</span>
                    ))}
                  </div>
                  {p.limits && Object.entries(p.limits).some(([, v]) => +v !== -1) && (
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8 }}>
                      {ALL_MODULES.filter(m => m.hasLimit && p.modules?.[m.key] === true).map(m => (
                        <div key={m.limitKey}>{m.label}: {p.limits?.[m.limitKey] === -1 || p.limits?.[m.limitKey] === undefined ? 'Unlimited' : p.limits[m.limitKey]}</div>
                      ))}
                    </div>
                  )}
                  {assignedCount > 0 && (
                    <div style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 600, marginBottom: 8 }}>
                      👥 {assignedCount} business{assignedCount !== 1 ? 'es' : ''} using this plan
                    </div>
                  )}

                  {/* Visibility Toggle */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, padding: '6px 0', borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12, fontWeight: 500, flex: 1 }}>
                      <div
                        onClick={() => togglePlanVisibility(i)}
                        style={{
                          width: 38, height: 20, borderRadius: 10,
                          background: isHidden ? '#fbbf24' : '#22c55e',
                          position: 'relative', cursor: 'pointer',
                          transition: 'background 0.2s'
                        }}
                      >
                        <div style={{
                          width: 16, height: 16, borderRadius: '50%', background: '#fff',
                          position: 'absolute', top: 2,
                          left: isHidden ? 2 : 20,
                          transition: 'left 0.2s',
                          boxShadow: '0 1px 3px rgba(0,0,0,0.2)'
                        }} />
                      </div>
                      <span style={{ color: isHidden ? '#92400e' : '#166534' }}>
                        {isHidden ? 'Hidden from users' : 'Visible to all'}
                      </span>
                    </label>
                  </div>

                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn btn-secondary btn-sm" style={{ flex: 1 }} onClick={() => { setEditPlanIdx(i); setPlanForm({ name: p.name, duration: p.duration, price: p.price, features: p.features || '', modules: { ...DEFAULT_MODULES, ...(p.modules || {}) }, limits: { ...DEFAULT_LIMITS, ...(p.limits || { maxLeads: p.maxLeads, maxUsers: p.maxUsers }) }, hidden: p.hidden || false }); setPlanModal(true); }}>Edit</button>
                    <button className="btn btn-sm" style={{ background: '#fee2e2', color: '#991b1b' }} onClick={() => deletePlan(i)}>Del</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── COUPONS ── */}
      {tab === 'coupons' && (
        <div>
          <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'flex-end' }}>
            <button className="btn btn-primary btn-sm" onClick={() => { setCouponForm({ code: '', discount: 20, type: 'Percentage', maxUses: 100 }); setCouponModal(true); }}>+ Create Coupon</button>
          </div>
          <div className="tw">
            <div className="tw-head"><h3>Discount Coupons ({coupons.length})</h3></div>
            <div className="tw-scroll">
              <table>
                <thead><tr><th>Code</th><th>Type</th><th>Discount</th><th>Max Uses</th><th>Used</th><th>Status</th><th>Actions</th></tr></thead>
                <tbody>
                  {coupons.length === 0 ? <tr><td colSpan={7} style={{ textAlign: 'center', padding: 28, color: 'var(--muted)' }}>No coupons</td></tr>
                    : coupons.map(c => (
                      <tr key={c.id}>
                        <td><strong style={{ fontFamily: 'monospace', background: '#f3f4f6', padding: '2px 7px', borderRadius: 5 }}>{c.code}</strong></td>
                        <td>{c.type}</td>
                        <td style={{ fontWeight: 700 }}>{c.type === 'Percentage' ? `${c.discount}%` : fmt(c.discount)}</td>
                        <td>{c.maxUses}</td>
                        <td>{c.usedCount || 0}</td>
                        <td><span className={`badge ${c.active ? 'bg-green' : 'bg-gray'}`}>{c.active ? 'Active' : 'Inactive'}</span></td>
                        <td><button className="btn btn-sm" style={{ background: '#fee2e2', color: '#991b1b' }} onClick={() => delCoupon(c.id)}>Del</button></td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── TRANSACTIONS ── */}
      {tab === 'transactions' && (
        <div className="tw">
          <div className="tw-head"><h3>Transactions ({transactions.length})</h3></div>
          <div className="tw-scroll">
            <table>
              <thead><tr><th>#</th><th>User</th><th>Plan</th><th>Amount</th><th>Status</th><th>Date</th></tr></thead>
              <tbody>
                {transactions.length === 0 ? <tr><td colSpan={6} style={{ textAlign: 'center', padding: 28, color: 'var(--muted)' }}>No transactions yet</td></tr>
                  : transactions.map((t, i) => (
                    <tr key={t.id}>
                      <td style={{ color: 'var(--muted)', fontSize: 11 }}>{i + 1}</td>
                      <td style={{ fontSize: 12 }}>{t.userEmail || t.userId || '-'}</td>
                      <td>{t.plan || '-'}</td>
                      <td style={{ fontWeight: 700 }}>{fmt(t.amount)}</td>
                      <td><span className={`badge ${t.status === 'Success' ? 'bg-green' : t.status === 'Failed' ? 'bg-red' : 'bg-yellow'}`}>{t.status}</span></td>
                      <td style={{ fontSize: 12 }}>{fmtD(t.createdAt)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── ARCHIVE MANAGER ── */}
      {tab === 'archive' && (
        <ArchiveManager user={user} />
      )}

      {/* ── PLATFORM BRANDING SETTINGS ── */}
      {tab === 'settings' && (
        <div className="tw">
          <div className="tw-head"><h3>White-labeling &amp; Platform Branding</h3></div>
          <div style={{ padding: 20, maxWidth: 620 }}>
            <div className="form-group" style={{ marginBottom: 14 }}>
              <label>CRM Brand Name</label>
              <input value={settingsForm.brandName} onChange={e => setSettingsForm({ ...settingsForm, brandName: e.target.value })} placeholder="e.g. T2G CRM" />
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>Shown on login screen and sidebar logo.</div>
            </div>
            <div className="fgrid">
              <div className="form-group" style={{ marginBottom: 14 }}>
                <label>Brand Initials (Short Logo)</label>
                <input value={settingsForm.brandShort} onChange={e => setSettingsForm({ ...settingsForm, brandShort: e.target.value })} placeholder="e.g. T2G" maxLength={4} />
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>2-4 initials shown if logo is missing.</div>
              </div>
              <div className="form-group" style={{ marginBottom: 14 }}>
                <label>Brand Logo URL</label>
                <input value={settingsForm.brandLogo} onChange={e => setSettingsForm({ ...settingsForm, brandLogo: e.target.value })} placeholder="https://example.com/logo.png" />
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>Logo used in sidebar and docs.</div>
              </div>
            </div>
            <div className="form-group" style={{ marginBottom: 14 }}>
              <label>Website Document Title</label>
              <input value={settingsForm.title} onChange={e => setSettingsForm({ ...settingsForm, title: e.target.value })} placeholder="e.g. T2G CRM | Lead & Sales Management" />
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>The text shown on the browser tab.</div>
            </div>
            <div className="form-group" style={{ marginBottom: 14 }}>
              <label>Favicon URL</label>
              <input value={settingsForm.favicon} onChange={e => setSettingsForm({ ...settingsForm, favicon: e.target.value })} placeholder="https://example.com/favicon.ico" />
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>Icon image for the browser tab (.ico or .png).</div>
            </div>
            <div className="form-group" style={{ marginBottom: 14 }}>
              <label>Mobile App Icon URL</label>
              <input value={settingsForm.mobileAppIcon} onChange={e => setSettingsForm({ ...settingsForm, mobileAppIcon: e.target.value })} placeholder="https://example.com/app-icon-512x512.png" />
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>PNG icon for mobile app (recommended: 512x512px, no transparency for Android).</div>
              {settingsForm.mobileAppIcon && (
                <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 12 }}>
                  <img src={settingsForm.mobileAppIcon} alt="App Icon Preview" style={{ width: 48, height: 48, borderRadius: 10, border: '1px solid var(--border)', objectFit: 'cover' }} onError={e => { e.target.style.display = 'none'; }} />
                  <span style={{ fontSize: 11, color: 'var(--muted)' }}>Preview</span>
                </div>
              )}
            </div>
            <div className="form-group" style={{ marginBottom: 18, borderTop: '1px solid var(--border)', paddingTop: 18 }}>
              <label>CRM Domain URL</label>
              <input value={settingsForm.crmDomain} onChange={e => setSettingsForm({ ...settingsForm, crmDomain: e.target.value })} placeholder="https://mycrm.t2gcrm.in" />
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>Your deployed CRM domain.</div>
            </div>
            
            <div className="form-group" style={{ marginBottom: 20 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                <input 
                  type="checkbox" 
                  checked={settingsForm.showBranding} 
                  onChange={e => setSettingsForm({ ...settingsForm, showBranding: e.target.checked })}
                  style={{ width: 18, height: 18 }} 
                />
                <span style={{ fontWeight: 600 }}>Show "Powered By" branding in Documents (Invoices/Quotes)</span>
              </label>
            </div>
            
            <button className="btn btn-primary" onClick={saveSettings}>Save Branding Settings</button>
          </div>
        </div>
      )}


      {planModal && (
        <div className="mo open">
          <div className="mo-box" style={{ maxWidth: 680 }}>
            <div className="mo-head"><h3>{editPlanIdx !== null ? 'Edit' : 'Add'} Plan</h3><button className="btn-icon" onClick={() => setPlanModal(false)}>✕</button></div>
            <div className="mo-body">
              <div className="fgrid">
                <div className="fg span2"><label>Plan Name *</label><input value={planForm.name} onChange={e => setPlanForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g. Lead Management, Billing Plan, Parlour Plan" /></div>
                <div className="fg"><label>Duration (days)</label><input type="number" value={planForm.duration} onChange={e => setPlanForm(p => ({ ...p, duration: e.target.value }))} /></div>
                <div className="fg"><label>Price (₹) — 0 for Free</label><input type="number" value={planForm.price} onChange={e => setPlanForm(p => ({ ...p, price: e.target.value }))} /></div>
                <div className="fg span2"><label>Plan Description (optional)</label><input value={planForm.features} onChange={e => setPlanForm(p => ({ ...p, features: e.target.value }))} placeholder="e.g. Best for retail businesses" /></div>
              </div>
              
              <div style={{ marginTop: 18, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
                <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                  🗂️ Module Access & Limits
                  <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 400 }}>(-1 = Unlimited)</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  {ALL_MODULES.map(m => (
                    <div key={m.key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: planForm.modules?.[m.key] === true ? 'var(--bg-soft)' : '#fef2f2', borderRadius: 8, border: `1px solid ${planForm.modules?.[m.key] === true ? 'var(--border)' : '#fca5a5'}` }}>
                      <input
                        type="checkbox"
                        checked={planForm.modules?.[m.key] === true}
                        onChange={e => setPlanForm(p => ({ ...p, modules: { ...p.modules, [m.key]: e.target.checked } }))}
                        style={{ width: 15, height: 15, flexShrink: 0 }}
                      />
                      <span style={{ fontSize: 12, flex: 1, fontWeight: 500, color: planForm.modules?.[m.key] === false ? '#991b1b' : undefined }}>{m.label}</span>
                      {m.hasLimit && planForm.modules?.[m.key] === true && (
                        <input
                          type="number"
                          value={planForm.limits?.[m.limitKey] ?? m.defaultLimit}
                          onChange={e => setPlanForm(p => ({ ...p, limits: { ...p.limits, [m.limitKey]: parseInt(e.target.value) } }))}
                          style={{ width: 72, fontSize: 11, padding: '3px 6px', border: '1px solid var(--border)', borderRadius: 5, textAlign: 'center' }}
                          title={`${m.label} limit (-1 = unlimited)`}
                        />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="mo-foot">
              <button className="btn btn-secondary btn-sm" onClick={() => setPlanModal(false)}>Cancel</button>
              <button className="btn btn-primary btn-sm" onClick={savePlan}>{editPlanIdx !== null ? 'Update Plan' : 'Create Plan'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── COUPON MODAL ── */}
      {couponModal && (
        <div className="mo open">
          <div className="mo-box">
            <div className="mo-head"><h3>Create Coupon</h3><button className="btn-icon" onClick={() => setCouponModal(false)}>✕</button></div>
            <div className="mo-body">
              <div className="fgrid">
                <div className="fg span2"><label>Coupon Code</label><input value={couponForm.code} onChange={e => setCouponForm(p => ({ ...p, code: e.target.value.toUpperCase() }))} placeholder="e.g. LAUNCH50" style={{ textTransform: 'uppercase', fontFamily: 'monospace', letterSpacing: '.05em' }} /></div>
                <div className="fg"><label>Type</label><select value={couponForm.type} onChange={e => setCouponForm(p => ({ ...p, type: e.target.value }))}><option>Percentage</option><option>Fixed</option></select></div>
                <div className="fg"><label>Discount ({couponForm.type === 'Percentage' ? '%' : '₹'})</label><input type="number" value={couponForm.discount} onChange={e => setCouponForm(p => ({ ...p, discount: parseFloat(e.target.value) || 0 }))} /></div>
                <div className="fg"><label>Max Uses</label><input type="number" value={couponForm.maxUses} onChange={e => setCouponForm(p => ({ ...p, maxUses: parseInt(e.target.value) || 1 }))} /></div>
              </div>
            </div>
            <div className="mo-foot"><button className="btn btn-secondary btn-sm" onClick={() => setCouponModal(false)}>Cancel</button><button className="btn btn-primary btn-sm" onClick={saveCoupon}>Create Coupon</button></div>
          </div>
        </div>
      )}

      {/* ── CREATE BUSINESS MODAL ── */}
      {createBizModal && (
        <div className="mo open">
          <div className="mo-box" style={{ maxWidth: 550 }}>
            <div className="mo-head"><h3>➕ Create New Business</h3><button className="btn-icon" onClick={() => setCreateBizModal(false)}>✕</button></div>
            <div className="mo-body">
              <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 12, color: '#1e40af' }}>
                This creates a fully verified business account. The user can log in immediately with the credentials you set.
              </div>
              <div className="fgrid">
                <div className="fg"><label>Full Name *</label><input value={createBizForm.fullName} onChange={e => setCreateBizForm(f => ({ ...f, fullName: e.target.value }))} placeholder="John Doe" /></div>
                <div className="fg"><label>Business Name</label><input value={createBizForm.bizName} onChange={e => setCreateBizForm(f => ({ ...f, bizName: e.target.value }))} placeholder="Acme Corp" /></div>
                <div className="fg"><label>Email *</label><input type="email" value={createBizForm.email} onChange={e => setCreateBizForm(f => ({ ...f, email: e.target.value }))} placeholder="user@business.com" /></div>
                <div className="fg"><label>Phone</label><input value={createBizForm.phone} onChange={e => setCreateBizForm(f => ({ ...f, phone: e.target.value }))} placeholder="+91..." /></div>
                <div className="fg"><label>Password *</label><input type="text" value={createBizForm.password} onChange={e => setCreateBizForm(f => ({ ...f, password: e.target.value }))} placeholder="Min. 6 characters" /></div>
                <div className="fg"><label>Assign Plan</label>
                  <select value={createBizForm.plan} onChange={e => setCreateBizForm(f => ({ ...f, plan: e.target.value }))}>
                    {plans.map(p => <option key={p.name} value={p.name}>{p.name}{p.hidden ? ' 🔒' : ''} — ₹{p.price || 0}</option>)}
                  </select>
                </div>
              </div>
            </div>
            <div className="mo-foot">
              <button className="btn btn-secondary btn-sm" onClick={() => setCreateBizModal(false)}>Cancel</button>
              <button className="btn btn-primary btn-sm" onClick={createBusiness} disabled={createBizLoading}>
                {createBizLoading ? 'Creating...' : 'Create Business'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── DELETE BUSINESS MODAL ── */}
      {deleteModal && (
        <div className="mo open">
          <div className="mo-box" style={{ maxWidth: 500 }}>
            <div className="mo-head"><h3 style={{ color: '#dc2626' }}>⚠️ Delete Business</h3><button className="btn-icon" onClick={() => setDeleteModal(null)}>✕</button></div>
            <div className="mo-body">
              <div style={{ background: '#fef2f2', border: '1.5px solid #fca5a5', borderRadius: 10, padding: 16, marginBottom: 16 }}>
                <div style={{ fontWeight: 700, color: '#991b1b', fontSize: 14, marginBottom: 8 }}>🚨 This action is PERMANENT and IRREVERSIBLE!</div>
                <div style={{ fontSize: 12, color: '#7f1d1d', lineHeight: 1.6 }}>
                  Deleting <strong>"{deleteModal.bizName || deleteModal.email}"</strong> will permanently remove:
                </div>
                <ul style={{ fontSize: 12, color: '#7f1d1d', margin: '8px 0 0 16px', lineHeight: 1.8 }}>
                  <li>All <strong>leads, customers, invoices, quotes</strong></li>
                  <li>All <strong>tasks, projects, expenses, products</strong></li>
                  <li>All <strong>team member accounts & credentials</strong></li>
                  <li>All <strong>partner/distributor accounts & credentials</strong></li>
                  <li>All <strong>automation flows, campaigns, appointments</strong></li>
                  <li>The <strong>business owner's login credentials</strong></li>
                </ul>
              </div>
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 12, fontWeight: 700, marginBottom: 6, display: 'block' }}>
                  To confirm, type <strong style={{ color: '#dc2626', background: '#fef2f2', padding: '1px 6px', borderRadius: 4 }}>{deleteModal.bizName || deleteModal.email}</strong> below:
                </label>
                <input
                  value={deleteConfirmText}
                  onChange={e => setDeleteConfirmText(e.target.value)}
                  placeholder="Type business name to confirm..."
                  style={{ width: '100%', border: '2px solid #fca5a5', borderRadius: 8, padding: '10px 14px', fontSize: 13, fontFamily: 'inherit' }}
                  autoFocus
                />
              </div>
            </div>
            <div className="mo-foot">
              <button className="btn btn-secondary btn-sm" onClick={() => setDeleteModal(null)}>Cancel</button>
              <button
                className="btn btn-sm"
                style={{ background: '#dc2626', color: '#fff', opacity: deleteConfirmText.trim().toLowerCase() === (deleteModal.bizName || deleteModal.email || '').trim().toLowerCase() ? 1 : 0.4 }}
                onClick={deleteBusiness}
                disabled={deleteLoading || deleteConfirmText.trim().toLowerCase() !== (deleteModal.bizName || deleteModal.email || '').trim().toLowerCase()}
              >
                {deleteLoading ? 'Deleting...' : '🗑 Delete Everything Permanently'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── EDIT USER MODAL ── */}
      {editUserModal && editUserData && (
        <div className="mo open">
          <div className="mo-box" style={{ maxWidth: 520 }}>
            <div className="mo-head"><h3>✏️ Edit User — {editUserData.fullName || editUserData.email}</h3><button className="btn-icon" onClick={() => setEditUserModal(false)}>✕</button></div>
            <div className="mo-body">
              {/* Section 1: Reset Password */}
              <div style={{ marginBottom: 20, padding: 16, background: 'var(--bg-soft)', borderRadius: 10, border: '1px solid var(--border)' }}>
                <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>🔑 Reset Password</div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: 11, fontWeight: 600, marginBottom: 4, display: 'block' }}>New Password</label>
                    <input type="password" value={editUserForm.newPassword} onChange={e => setEditUserForm(f => ({ ...f, newPassword: e.target.value }))} placeholder="Min. 6 characters" style={{ width: '100%' }} />
                  </div>
                  <button className="btn btn-primary btn-sm" onClick={resetUserPassword} disabled={editUserLoading}>{editUserLoading ? 'Saving...' : 'Reset Password'}</button>
                </div>
              </div>

              {/* Section 2: Edit Expiry */}
              <div style={{ marginBottom: 20, padding: 16, background: 'var(--bg-soft)', borderRadius: 10, border: '1px solid var(--border)' }}>
                <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>📅 Plan Expiry</div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: 11, fontWeight: 600, marginBottom: 4, display: 'block' }}>Expiry Date</label>
                    <input type="date" value={editUserForm.expiry} onChange={e => setEditUserForm(f => ({ ...f, expiry: e.target.value }))} style={{ width: '100%' }} />
                  </div>
                  <button className="btn btn-primary btn-sm" onClick={updateUserExpiry}>Update Expiry</button>
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>Current: {editUserData.planExpiry ? fmtD(editUserData.planExpiry) : 'Not set'}</div>
              </div>

              {/* Section 3: Change Role */}
              <div style={{ padding: 16, background: 'var(--bg-soft)', borderRadius: 10, border: '1px solid var(--border)' }}>
                <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>👤 User Role</div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ fontSize: 11, fontWeight: 600, marginBottom: 4, display: 'block' }}>Role</label>
                    <select value={editUserForm.role} onChange={e => setEditUserForm(f => ({ ...f, role: e.target.value }))} style={{ width: '100%' }}>
                      <option value="user">User</option>
                      <option value="superadmin">Superadmin</option>
                    </select>
                  </div>
                  <button className="btn btn-primary btn-sm" onClick={updateUserRole}>Update Role</button>
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>Current: {editUserData.role || 'user'}</div>
              </div>
            </div>
            <div className="mo-foot"><button className="btn btn-secondary btn-sm" onClick={() => setEditUserModal(false)}>Close</button></div>
          </div>
        </div>
      )}

      {/* ── BUSINESS REPORT ── */}
      {tab === 'analytics' && (
        <div className="tw">
          <div className="tw-head">
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <h3>📊 Business Report</h3>
              <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 400 }}>Database consumption, growth, and performance analysis per business.</div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-primary btn-sm" disabled={analyticsLoading} onClick={async () => {
                setAnalyticsLoading(true);
                try {
                  const r = await fetch(AUTH_API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'business-analytics' }) });
                  const d = await r.json();
                  if (!r.ok) throw new Error(d.error);
                  setAnalyticsData(d.analytics);
                } catch (e) { toast(e.message, 'error'); }
                finally { setAnalyticsLoading(false); }
              }}>
                {analyticsLoading ? 'Loading...' : '🔄 Load Report'}
              </button>
            </div>
          </div>

          {/* Orphan Cleanup Panel — always visible on Business Report tab */}
          <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 10, padding: 16, marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#991b1b', marginBottom: 4 }}>🗑️ Orphaned Records Cleanup</div>
                <div style={{ fontSize: 11, color: '#7f1d1d' }}>Finds records left behind by old broken deletions (deleted businesses, leads, etc.) and permanently removes them.</div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-secondary btn-sm" onClick={scanOrphans} disabled={orphanLoading}>
                  {orphanLoading && !orphanReport ? 'Scanning...' : '🔍 Scan for Orphans'}
                </button>
                {orphanReport && orphanReport.totalOrphans > 0 && orphanReport.dryRun && (
                  <button className="btn btn-primary btn-sm" onClick={cleanupOrphans} disabled={orphanLoading} style={{ background: '#dc2626' }}>
                    {orphanLoading ? 'Deleting...' : `🧹 Delete ${orphanReport.totalOrphans} Records`}
                  </button>
                )}
              </div>
            </div>
            {orphanReport && (
              <div style={{ marginTop: 12, padding: 12, background: '#fff', borderRadius: 6, border: '1px solid #fecaca' }}>
                {orphanReport.totalOrphans === 0 ? (
                  <div style={{ fontSize: 12, color: '#166534', fontWeight: 600 }}>✅ No orphaned records found. Database is clean.</div>
                ) : (
                  <>
                    <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8, color: orphanReport.dryRun ? '#991b1b' : '#166534' }}>
                      {orphanReport.dryRun
                        ? `⚠️ Found ${orphanReport.totalOrphans} orphaned records across ${Object.keys(orphanReport.report).length} collections:`
                        : `✅ Deleted ${orphanReport.totalOrphans} orphaned records.`}
                    </div>
                    <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
                      <tbody>
                        {Object.entries(orphanReport.report).map(([col, count]) => (
                          <tr key={col} style={{ borderBottom: '1px solid #fee2e2' }}>
                            <td style={{ padding: '4px 8px', fontFamily: 'monospace', color: '#7f1d1d' }}>{col}</td>
                            <td style={{ padding: '4px 8px', textAlign: 'right', fontWeight: 700, color: '#dc2626' }}>{count.toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                )}
              </div>
            )}
          </div>

          {!analyticsData && !analyticsLoading && (
            <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--muted)' }}>
              <div style={{ fontSize: 48, marginBottom: 12 }}>📊</div>
              <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>Click "Load Report" to generate analytics</div>
              <div style={{ fontSize: 12 }}>This scans all businesses and calculates database consumption, growth metrics, and health indicators.</div>
            </div>
          )}

          {analyticsLoading && (
            <div style={{ textAlign: 'center', padding: '60px 20px', color: 'var(--muted)' }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>⏳</div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>Scanning all businesses... This may take a moment.</div>
            </div>
          )}

          {analyticsData && (() => {
            const totalRecordsAll = analyticsData.reduce((s, a) => s + a.totalRecords, 0);
            const totalLogs = analyticsData.reduce((s, a) => s + (a.counts.activityLogs || 0), 0);
            const totalMsgLogs = analyticsData.reduce((s, a) => s + (a.counts.messagingLogs || 0), 0);
            const avgRecords = analyticsData.length ? Math.round(totalRecordsAll / analyticsData.length) : 0;
            const heaviestBiz = analyticsData[0];
            const activeBiz = analyticsData.filter(a => a.recentActivity > 0).length;
            const estSizeKB = (totalRecordsAll * 0.5).toFixed(0); // ~0.5KB per record estimate
            
            return (
              <>
                {/* Summary Cards */}
                <div className="stat-grid" style={{ marginBottom: 20 }}>
                  <div className="stat-card sc-blue"><div className="lbl">Total Records</div><div className="val">{totalRecordsAll.toLocaleString()}</div></div>
                  <div className="stat-card sc-green"><div className="lbl">Active Businesses (30d)</div><div className="val">{activeBiz}/{analyticsData.length}</div></div>
                  <div className="stat-card sc-yellow"><div className="lbl">Est. DB Size</div><div className="val" style={{ fontSize: 16 }}>{(estSizeKB / 1024).toFixed(1)} MB</div></div>
                  <div className="stat-card sc-purple"><div className="lbl">Activity Logs</div><div className="val">{totalLogs.toLocaleString()}</div></div>
                </div>

                {/* Alert for high log counts */}
                {totalLogs > 5000 && (
                  <div style={{ background: '#fef3c7', border: '1px solid #fbbf24', borderRadius: 8, padding: '12px 16px', marginBottom: 16, fontSize: 12, color: '#92400e', fontWeight: 500 }}>
                    ⚠️ <strong>{totalLogs.toLocaleString()}</strong> activity logs + <strong>{totalMsgLogs.toLocaleString()}</strong> messaging logs in database. Consider running "Cleanup Old Logs" to remove records older than 3 months.
                  </div>
                )}

                {/* Per-Business Table */}
                <div style={{ overflowX: 'auto' }}>
                  <table className="mod-table" style={{ fontSize: 11 }}>
                    <thead>
                      <tr>
                        <th style={{ textAlign: 'center', width: 36 }}>
                          <input type="checkbox" checked={analyticsData && selectedBizIds.size === analyticsData.length} onChange={e => {
                            if (e.target.checked) setSelectedBizIds(new Set(analyticsData.map(a => a.userId)));
                            else setSelectedBizIds(new Set());
                          }} style={{ accentColor: 'var(--accent)' }} />
                        </th>
                        <th style={{ textAlign: 'left' }}>#</th>
                        <th style={{ textAlign: 'left' }}>Business</th>
                        <th style={{ textAlign: 'left' }}>Plan</th>
                        <th>Total Records</th>
                        <th>Activity Logs</th>
                        <th>Msg Logs</th>
                        <th>Team Size</th>
                        <th>30d Activity</th>
                        <th>Health</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analyticsData.map((a, i) => {
                        const isExpired = a.planExpiry && a.planExpiry < Date.now();
                        const logPct = totalRecordsAll > 0 ? ((a.totalRecords / totalRecordsAll) * 100).toFixed(1) : 0;
                        const healthScore = a.recentActivity > 50 ? '🟢' : a.recentActivity > 10 ? '🟡' : a.recentActivity > 0 ? '🟠' : '🔴';
                        const isHeavy = a.totalRecords > avgRecords * 2;
                        return (
                          <tr key={a.id} style={{ background: selectedBizIds.has(a.userId) ? '#eff6ff' : isHeavy ? '#fff7ed' : undefined }}>
                            <td style={{ textAlign: 'center' }}>
                              <input type="checkbox" checked={selectedBizIds.has(a.userId)} onChange={() => {
                                const next = new Set(selectedBizIds);
                                if (next.has(a.userId)) next.delete(a.userId);
                                else next.add(a.userId);
                                setSelectedBizIds(next);
                              }} style={{ accentColor: 'var(--accent)' }} />
                            </td>
                            <td style={{ color: 'var(--muted)' }}>{i + 1}</td>
                            <td>
                              <div style={{ fontWeight: 600, color: '#111' }}>{a.bizName || '(unnamed)'}</div>
                              <div style={{ fontSize: 10, color: 'var(--muted)' }}>{a.email}</div>
                            </td>
                            <td>
                              <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, fontWeight: 600, background: isExpired ? '#fee2e2' : '#dcfce7', color: isExpired ? '#991b1b' : '#166534' }}>
                                {a.plan}{isExpired ? ' ⏰' : ''}
                              </span>
                            </td>
                            <td style={{ textAlign: 'center', fontWeight: 700, color: isHeavy ? '#c2410c' : '#111' }}>
                              {a.totalRecords.toLocaleString()}
                              <div style={{ fontSize: 9, color: 'var(--muted)', fontWeight: 400 }}>{logPct}% of DB</div>
                            </td>
                            <td style={{ textAlign: 'center', color: (a.counts.activityLogs || 0) > 1000 ? '#c2410c' : undefined, fontWeight: (a.counts.activityLogs || 0) > 1000 ? 700 : 400 }}>
                              {(a.counts.activityLogs || 0).toLocaleString()}
                            </td>
                            <td style={{ textAlign: 'center' }}>{(a.counts.messagingLogs || 0).toLocaleString()}</td>
                            <td style={{ textAlign: 'center' }}>{a.teamSize}</td>
                            <td style={{ textAlign: 'center', fontWeight: 600 }}>{a.recentActivity}</td>
                            <td style={{ textAlign: 'center', fontSize: 16 }}>{healthScore}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Cleanup Action Bar */}
                {selectedBizIds.size > 0 && (
                  <div style={{ marginTop: 16, padding: '14px 18px', background: '#eff6ff', borderRadius: 10, border: '1px solid #93c5fd', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#1e40af' }}>
                      🧹 {selectedBizIds.size} business{selectedBizIds.size > 1 ? 'es' : ''} selected
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>
                      <label style={{ fontSize: 12, fontWeight: 600, color: '#1e40af', whiteSpace: 'nowrap' }}>Delete logs older than</label>
                      <input
                        type="number"
                        value={cleanupDays}
                        onChange={e => setCleanupDays(Math.max(1, parseInt(e.target.value) || 1))}
                        min={1}
                        style={{ width: 70, padding: '6px 10px', borderRadius: 6, border: '1px solid #93c5fd', fontSize: 13, fontWeight: 700, textAlign: 'center' }}
                      />
                      <span style={{ fontSize: 12, color: '#1e40af', fontWeight: 600 }}>days</span>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="btn btn-sm" style={{ background: '#fff', color: '#64748b', border: '1px solid #cbd5e1' }} onClick={() => setSelectedBizIds(new Set())}>Cancel</button>
                      <button className="btn btn-sm" disabled={cleanupLoading} onClick={async () => {
                        const bizNames = analyticsData.filter(a => selectedBizIds.has(a.userId)).map(a => a.bizName || a.email).join(', ');
                        if (!window.confirm(`Delete activity logs & messaging logs older than ${cleanupDays} days for:\n\n${bizNames}\n\nThis action cannot be undone. Continue?`)) return;
                        setCleanupLoading(true);
                        try {
                          let totalDeleted = 0;
                          for (const uid of selectedBizIds) {
                            const r = await fetch(AUTH_API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'cleanup-old-logs', months: cleanupDays / 30, targetUserId: uid }) });
                            const d = await r.json();
                            if (r.ok) totalDeleted += (d.deleted || 0);
                          }
                          toast(`🧹 Cleaned up ${totalDeleted} old records from ${selectedBizIds.size} business(es)`, 'success');
                          setSelectedBizIds(new Set());
                          setAnalyticsData(null);
                        } catch (e) { toast(e.message, 'error'); }
                        finally { setCleanupLoading(false); }
                      }} style={{ background: '#dc2626', color: '#fff', border: 'none', fontWeight: 700 }}>
                        {cleanupLoading ? 'Cleaning...' : `🧹 Cleanup Now`}
                      </button>
                    </div>
                  </div>
                )}

                {/* Legend */}
                <div style={{ marginTop: 16, padding: '12px 16px', background: 'var(--card)', borderRadius: 8, border: '1px solid var(--border)', fontSize: 11, color: 'var(--muted)' }}>
                  <strong style={{ color: '#111' }}>Legend:</strong>&nbsp;
                  🟢 Highly active (50+ actions/30d) &nbsp;·&nbsp;
                  🟡 Active (10-50) &nbsp;·&nbsp;
                  🟠 Low activity (1-10) &nbsp;·&nbsp;
                  🔴 Inactive &nbsp;·&nbsp;
                  <span style={{ background: '#fff7ed', padding: '1px 6px', borderRadius: 3 }}>Orange row</span> = consuming 2×  avg records
                </div>
              </>
            );
          })()}
        </div>
      )}

    </div>
  );
}
