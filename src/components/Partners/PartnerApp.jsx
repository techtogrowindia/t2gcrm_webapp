import React, { useState, useMemo } from 'react';
import { dbWrite, dbOp } from '../../utils/dbWrite';
import db from '../../instant';
import { id } from '@instantdb/react';
import { useToast } from '../../context/ToastContext';
import { fmtD, DEFAULT_STAGES } from '../../utils/helpers';

const PARTNER_NAV = [
  { group: 'Main' },
  { id: 'NewRequirement', label: 'New Requirement', icon: 'M12 5v14 M5 12h14' },
  { id: 'MyCustomers', label: 'My Customers', icon: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2 M9 7a4 4 0 1 0 0-8 4 4 0 0 0 0 8z' },
  { id: 'MyEarnings', label: 'My Earnings', icon: 'M12 1v22 M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6' },
  { group: 'Account' },
  { id: 'Profile', label: 'My Profile', icon: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z' },
];

const VIEW_TITLES = {
  NewRequirement: 'New Requirement',
  MyCustomers: 'My Customers',
  MyEarnings: 'My Earnings',
  Profile: 'My Profile',
};

export default function PartnerApp({ user, settings, partnerInfo }) {
  const { ownerUserId, partnerId, role } = partnerInfo;
  const [activeTab, setActiveTab] = useState('NewRequirement');
  const [sidebarExpanded, setSidebarExpanded] = useState(true);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const toast = useToast();

  const handleLogout = () => {
    localStorage.removeItem('tc_channel_partner');
    db.auth.signOut().then(() => {
      window.location.href = '/';
    });
  };

  return (
    <div className="app">
      {/* Mobile Overlay */}
      <div className={`sidebar-overlay ${mobileSidebarOpen ? 'mobile-open' : ''}`} onClick={() => setMobileSidebarOpen(false)} />

      {/* Sidebar — same as CRM */}
      <aside className={`sidebar${sidebarExpanded ? ' expanded' : ''}${mobileSidebarOpen ? ' mobile-open' : ''}`}>
        <div className="sidebar-logo" onClick={() => setSidebarExpanded(v => !v)}>
          {settings?.brandLogo ? (
            <img src={settings.brandLogo} alt="Logo" style={{ width: '28px', height: '28px', objectFit: 'contain' }} />
          ) : settings?.brandShort ? (
            <span>{settings.brandShort}</span>
          ) : (
            <svg style={{ width: 20, height: 20 }} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
            </svg>
          )}
          <span className="nav-label" style={{ fontWeight: 800, fontSize: 13 }}>{settings?.brandName || 'T2G CRM'}</span>
        </div>
        <nav style={{ width: '100%', flex: 1, overflowY: 'auto' }}>
          {PARTNER_NAV.map((item, i) => {
            if (item.group) {
              const nextGroupIdx = PARTNER_NAV.findIndex((next, idx) => idx > i && next.group);
              const nextItemIdx = PARTNER_NAV.findIndex((next, idx) => idx > i && !next.group);
              const groupHasItems = nextItemIdx !== -1 && (nextGroupIdx === -1 || nextItemIdx < nextGroupIdx);
              if (!groupHasItems) return null;
              return <div key={i} className="nav-group-label">{item.group}</div>;
            }
            return (
              <div
                key={item.id}
                className={`nav-item${activeTab === item.id ? ' active' : ''}`}
                onClick={() => { setActiveTab(item.id); setMobileSidebarOpen(false); }}
              >
                <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{ width: 17, height: 17, flexShrink: 0 }}>
                  {item.icon.split(' M').map((d, j) => (
                    <path key={j} d={j === 0 ? d : 'M' + d} />
                  ))}
                </svg>
                <span className="nav-label">{item.label}</span>
              </div>
            );
          })}
        </nav>
      </aside>

      {/* Main Content */}
      <div className="main">
        {/* Topbar — same as CRM */}
        <div className="topbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button className="menu-toggle" onClick={() => {
              if (window.innerWidth <= 768) setMobileSidebarOpen(v => !v);
              else setSidebarExpanded(v => !v);
            }}>
              <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            </button>
            <span className="topbar-title">{VIEW_TITLES[activeTab] || 'Partner Portal'}</span>
          </div>
          <div className="topbar-right">
            <div style={{ background: role === 'Distributor' ? '#ede9fe' : '#dbeafe', color: role === 'Distributor' ? '#6d28d9' : '#1e40af', padding: '4px 10px', borderRadius: 20, fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>
              🤝 {role}
            </div>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', background: 'var(--bg-soft, #f0f4f1)', padding: '4px 10px', borderRadius: 6 }}>
              Partner Portal
            </div>
            <div className="av" onClick={() => setActiveTab('Profile')} style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--accent)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
              {(user?.email || 'P').charAt(0).toUpperCase()}
            </div>
            <button className="btn-icon" onClick={handleLogout} title="Logout" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text)', padding: 4 }}>
              <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Content Area */}
        <div className="content">
          {activeTab === 'NewRequirement' ? (
            <NewRequirementForm ownerId={ownerUserId} partnerId={partnerId} user={user} />
          ) : activeTab === 'MyCustomers' ? (
            <MyCustomersView ownerId={ownerUserId} partnerId={partnerId} />
          ) : activeTab === 'MyEarnings' ? (
            <MyEarningsView ownerId={ownerUserId} partnerId={partnerId} />
          ) : (
            <ProfileSettingsView ownerId={ownerUserId} partnerId={partnerId} />
          )}
        </div>
      </div>
    </div>
  );
}

// ------ NEW REQUIREMENT FORM COMPONENT ------
function NewRequirementForm({ ownerId, partnerId, user }) {
  const [form, setForm] = useState({ name: '', phone: '', email: '', address: '', notes: '', selectedRequirement: '' });
  const [selectedProducts, setSelectedProducts] = useState(new Set());
  const [submitting, setSubmitting] = useState(false);
  const toast = useToast();

  const { data, isLoading } = db.useQuery({
    products: { $: { where: { userId: ownerId, isPartnerAvailable: true } } },
    userProfiles: { $: { where: { userId: ownerId } } },
    partnerApplications: { $: { where: { id: partnerId } } }
  });

  const products = data?.products || [];
  const ownerProfile = data?.userProfiles?.[0] || {};
  const partnerApp = data?.partnerApplications?.[0];
  const allRequirements = ownerProfile?.requirements || [];
  const visibleRequirements = (ownerProfile?.partnerVisibleRequirements || []).filter(r => allRequirements.includes(r));
  const ownerStages = ownerProfile?.stages || DEFAULT_STAGES;
  const firstStage = ownerStages[0] || 'New Enquiry';
  
  const handleToggleProduct = (pId) => {
    setSelectedProducts(prev => {
      const next = new Set(prev);
      if (next.has(pId)) next.delete(pId); else next.add(pId);
      return next;
    });
  };

  const checkConflict = async () => {
    const checkPhone = form.phone.trim();
    const checkEmail = form.email.trim();
    if (!checkPhone && !checkEmail) return null;

    try {
      const res = await fetch('/api/lead-lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerId, phone: checkPhone, email: checkEmail }),
      });
      const result = await res.json();
      const match = result.lead || result.customer;
      if (match && match.partnerId !== partnerId) return match;
    } catch (e) { console.warn('Conflict check failed:', e); }
    return null;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name || (!form.phone && !form.email)) {
      return toast('Name and at least phone or email is required.', 'error');
    }

    const conflict = await checkConflict();
    if (conflict) {
      toast('Oops! This customer is already assigned to another partner or the company directly.', 'error');
      return;
    }

    setSubmitting(true);
    try {
      const selectedProductNames = products.filter(p => selectedProducts.has(p.id)).map(p => p.name);
      const requirementNotes = [
        form.notes,
        selectedProductNames.length > 0 ? `\n--- Products Interested ---\n${selectedProductNames.join('\n')}` : ''
      ].filter(Boolean).join('\n\n');

      let distributorId = '';
      let retailerId = '';
      if (partnerApp?.role === 'Distributor') {
        distributorId = partnerId;
      } else if (partnerApp?.role === 'Retailer') {
        retailerId = partnerId;
        distributorId = partnerApp?.parentDistributorId || '';
      }

      const leadId = id();
      await dbWrite([
        dbOp.update('leads', leadId, {
          name: form.name.trim(),
          phone: form.phone.trim(),
          email: form.email.trim(),
          custom: { address: form.address.trim() },
          notes: requirementNotes,
          requirement: form.selectedRequirement || '',
          source: ownerProfile?.partnerLeadSource || 'Channel Partners',
          stage: firstStage,
          userId: ownerId,
          partnerId,
          distributorId,
          retailerId,
          actorId: user.id,
          createdAt: Date.now(),
          updatedAt: Date.now()
        }),
        dbOp.update('activityLogs', id(), {
          entityId: leadId,
          entityType: 'lead',
          text: `Requirement added by Channel Partner`,
          userId: ownerId,
          createdAt: Date.now()
        })
      ]);

      toast('Requirement submitted successfully!', 'success');
      setForm({ name: '', phone: '', email: '', address: '', notes: '', selectedRequirement: '' });
      setSelectedProducts(new Set());
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  if (isLoading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>Loading products catalog...</div>;

  return (
    <div style={{ display: 'flex', gap: 22, alignItems: 'flex-start', flexWrap: 'wrap' }}>
      <div className="card" style={{ flex: '1 1 380px', padding: 24 }}>
        <h3 style={{ fontSize: 16, marginBottom: 4 }}>Onboard Customer</h3>
        <p style={{ color: 'var(--muted)', fontSize: 12, marginBottom: 20 }}>Enter customer details to register them under your account.</p>
        
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="fg">
            <label>Customer Name *</label>
            <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="E.g. Acme Corp" required />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div className="fg">
              <label>Phone Number *</label>
              <input value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))} placeholder="+91..." />
            </div>
            <div className="fg">
              <label>Email Address</label>
              <input type="email" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} placeholder="email@..." />
            </div>
          </div>
          <div className="fg">
            <label>Address</label>
            <input value={form.address} onChange={e => setForm(p => ({ ...p, address: e.target.value }))} placeholder="City, Region..." />
          </div>
          <div className="fg">
            <label>Additional Notes</label>
            <textarea value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} placeholder="Specific color, variant, urgency..." rows={2} />
          </div>

          {visibleRequirements.length > 0 && (
            <div className="fg">
              <label>Requirement Type</label>
              <select value={form.selectedRequirement} onChange={e => setForm(p => ({ ...p, selectedRequirement: e.target.value }))}>
                <option value="">-- Select Requirement --</option>
                {visibleRequirements.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
          )}

          <button type="submit" className="btn btn-primary" disabled={submitting} style={{ marginTop: 8 }}>
            {submitting ? 'Submitting...' : '+ Submit Requirement'}
          </button>
        </form>
      </div>

      <div className="card" style={{ flex: '1 1 380px', padding: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div>
            <h3 style={{ fontSize: 16, marginBottom: 4 }}>Product Catalog</h3>
            <p style={{ color: 'var(--muted)', fontSize: 12, margin: 0 }}>Select requested products (Optional)</p>
          </div>
          <span className="badge" style={{ background: 'var(--bg)', fontWeight: 700 }}>
            {selectedProducts.size} Selected
          </span>
        </div>

        {products.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 40, border: '2px dashed var(--border)', borderRadius: 12 }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>📦</div>
            <div style={{ color: 'var(--muted)', fontWeight: 600 }}>No products available</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>Company hasn't configured partner products yet.</div>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
            {products.map(p => (
              <div 
                key={p.id} 
                onClick={() => handleToggleProduct(p.id)}
                className="card"
                style={{ 
                  border: `2px solid ${selectedProducts.has(p.id) ? 'var(--accent)' : 'var(--border)'}`, 
                  padding: 12, 
                  cursor: 'pointer',
                  background: selectedProducts.has(p.id) ? 'rgba(34,197,94,0.05)' : '#fff',
                  transition: 'all 0.2s'
                }}
              >
                {p.imageUrl ? (
                  <img src={p.imageUrl} alt={p.name} style={{ width: '100%', height: 80, objectFit: 'contain', marginBottom: 10, background: 'var(--bg)', borderRadius: 6 }} />
                ) : (
                  <div style={{ width: '100%', height: 80, background: 'var(--bg)', borderRadius: 6, marginBottom: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--border)' }}>
                    <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{ width: 28, height: 28 }}>
                      <path d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path>
                    </svg>
                  </div>
                )}
                <div style={{ fontWeight: 600, color: 'var(--text)', fontSize: 13 }}>{p.name}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{p.unit}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ------ MY CUSTOMERS VIEW ------
function MyCustomersView({ ownerId, partnerId }) {
  const [search, setSearch] = useState('');
  const [allLeads, setAllLeads] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  // Fetch only this partner's leads from server (avoids 11k+ subscription)
  React.useEffect(() => {
    if (!ownerId || !partnerId) return;
    setIsLoading(true);
    fetch('/api/leads-page', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ownerId, mode: 'kanban', tab: 'all', page: 1, pageSize: 50000, isOwner: true, teamCanSeeAllLeads: true, boundaries: {} }),
    })
      .then(r => r.json())
      .then(json => {
        const leads = (json.items || [])
          .filter(l => l.partnerId === partnerId || l.distributorId === partnerId || l.retailerId === partnerId)
          .sort((a, b) => b.createdAt - a.createdAt);
        setAllLeads(leads);
      })
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, [ownerId, partnerId]);

  const filtered = useMemo(() => {
    if (!search) return allLeads;
    const q = search.toLowerCase();
    return allLeads.filter(l =>
      (l.name || '').toLowerCase().includes(q) ||
      (l.phone || '').toLowerCase().includes(q) ||
      (l.email || '').toLowerCase().includes(q) ||
      (l.stage || '').toLowerCase().includes(q)
    );
  }, [allLeads, search]);

  if (isLoading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>Loading...</div>;

  return (
    <div>
      {/* Summary Card */}
      <div className="stat-grid" style={{ marginBottom: 22 }}>
        <div className="card" style={{ padding: 18, display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: '#dbeafe', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>📋</div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase' }}>Total Leads</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: '#1e40af' }}>{allLeads.length}</div>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="card" style={{ overflow: 'hidden' }}>
        <div style={{ padding: '14px 22px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <h3 style={{ fontSize: 16, margin: 0 }}>My Leads</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 12px', maxWidth: 280, flex: 1 }}>
            <svg viewBox="0 0 24 24" width="14" height="14" stroke="var(--muted)" strokeWidth="2" fill="none"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input
              placeholder="Search by name, phone, email..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ border: 'none', outline: 'none', background: 'transparent', fontSize: 13, width: '100%', color: 'var(--text)' }}
            />
            {search && <button onClick={() => setSearch('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: 14, padding: 0 }}>✕</button>}
          </div>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table className="data-table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr>
                <th>Date</th>
                <th>Client Name</th>
                <th>Phone</th>
                <th>Email</th>
                <th>Stage</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ padding: '40px 22px', textAlign: 'center', color: 'var(--muted)' }}>
                    {search ? 'No leads match your search.' : 'You haven\'t created any leads yet. Use "New Requirement" to add your first lead.'}
                  </td>
                </tr>
              ) : filtered.map(r => (
                <tr key={r.id}>
                  <td style={{ fontSize: 12 }}>{fmtD(r.createdAt)}</td>
                  <td style={{ fontWeight: 600 }}>{r.name}</td>
                  <td style={{ fontSize: 13 }}>{r.phone || '-'}</td>
                  <td style={{ fontSize: 13 }}>{r.email || '-'}</td>
                  <td>
                    <span className="badge" style={{ background: '#dbeafe', color: '#1e40af' }}>{r.stage || 'New'}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ------ MY EARNINGS VIEW ------
function MyEarningsView({ ownerId, partnerId }) {
  const { data, isLoading } = db.useQuery({
    partnerCommissions: { $: { where: { userId: ownerId, partnerId } } }
  });

  const commissions = useMemo(() => {
    return (data?.partnerCommissions || []).sort((a, b) => b.updatedAt - a.updatedAt);
  }, [data]);

  const totalEarned = commissions.filter(c => c.status === 'Paid').reduce((s, c) => s + c.amount, 0);
  const totalPending = commissions.filter(c => c.status === 'Pending Payout').reduce((s, c) => s + c.amount, 0);

  if (isLoading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>Loading...</div>;

  return (
    <div>
      {/* Stat Cards */}
      <div className="stat-grid" style={{ marginBottom: 22 }}>
        <div className="card" style={{ padding: 18, display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: '#fef9c3', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>⏳</div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase' }}>Pending Payout</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: '#854d0e' }}>₹{totalPending.toLocaleString()}</div>
          </div>
        </div>
        <div className="card" style={{ padding: 18, display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: '#dcfce7', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>✅</div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase' }}>Total Paid</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: '#166534' }}>₹{totalEarned.toLocaleString()}</div>
          </div>
        </div>
        <div className="card" style={{ padding: 18, display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: '#e0e7ff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>📊</div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase' }}>Total Records</div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{commissions.length}</div>
          </div>
        </div>
      </div>

      <div className="card" style={{ overflow: 'hidden' }}>
        <div style={{ padding: '18px 22px', borderBottom: '1px solid var(--border)' }}>
          <h3 style={{ fontSize: 16, margin: 0 }}>Commission History</h3>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="data-table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
            <thead>
              <tr>
                <th>Updated</th>
                <th>Invoice No</th>
                <th>Client</th>
                <th>Amount</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {commissions.length === 0 ? (
                <tr>
                  <td colSpan={5} style={{ padding: '40px 22px', textAlign: 'center', color: 'var(--muted)' }}>
                    You haven't earned any commissions yet.
                  </td>
                </tr>
              ) : commissions.map(c => (
                <tr key={c.id}>
                  <td style={{ fontSize: 13 }}>{fmtD(c.updatedAt || c.createdAt)}</td>
                  <td style={{ fontWeight: 600 }}>{c.invoiceNo || '-'}</td>
                  <td>{c.clientName || '-'}</td>
                  <td style={{ fontWeight: 700 }}>₹{(c.amount || 0).toLocaleString()}</td>
                  <td>
                    {c.status === 'Paid' ? (
                      <span className="badge" style={{ background: '#dcfce7', color: '#166534' }}>Paid</span>
                    ) : c.status === 'Pending Payout' ? (
                      <span className="badge" style={{ background: '#fef9c3', color: '#854d0e' }}>Pending Payout</span>
                    ) : (
                      <span className="badge" style={{ background: 'var(--bg)', color: 'var(--muted)' }} title="Waiting for client to pay the invoice">Awaiting Payment</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ------ PROFILE SETTINGS VIEW ------
function ProfileSettingsView({ ownerId, partnerId }) {
  const { data, isLoading } = db.useQuery({
    partnerApplications: { $: { where: { userId: ownerId, status: 'Approved' } } },
    userProfiles: { $: { where: { userId: ownerId } } }
  });

  const partner = data?.partnerApplications?.find(p => p.id === partnerId);
  const ownerProfile = data?.userProfiles?.[0] || {};
  const allPartners = data?.partnerApplications || [];
  const parentDistributor = partner?.role === 'Retailer' && partner?.parentDistributorId 
    ? allPartners.find(p => p.id === partner.parentDistributorId) 
    : null;
  const myRetailers = partner?.role === 'Distributor' 
    ? allPartners.filter(p => p.role === 'Retailer' && p.parentDistributorId === partnerId) 
    : [];

  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [newPass, setNewPass] = useState('');
  const [confirmPass, setConfirmPass] = useState('');
  const [resetting, setResetting] = useState(false);
  const toast = useToast();

  React.useEffect(() => {
    if (partner && !form) {
      setForm({
        companyName: partner.companyName || '',
        email: partner.email || '',
        phone: partner.phone || '',
        village: partner.village || '',
        city: partner.city || '',
        district: partner.district || '',
        pincode: partner.pincode || '',
        state: partner.state || '',
        address: partner.address || '',
        taxId: partner.taxId || ''
      });
    }
  }, [partner, form]);

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const fieldLabels = {
        companyName: 'Company Name', village: 'Village', city: 'City',
        district: 'District', pincode: 'Pincode', state: 'State',
        address: 'Address', taxId: 'Tax ID'
      };
      const changes = [];
      Object.entries(fieldLabels).forEach(([key, label]) => {
        const oldVal = (partner[key] || '').trim();
        const newVal = (form[key] || '').trim();
        if (oldVal !== newVal) {
          changes.push(`${label}: "${oldVal || '—'}" → "${newVal || '—'}"`);
        }
      });

      const logText = changes.length > 0
        ? `Profile updated by partner: ${changes.join(', ')}`
        : 'Profile updated by partner (no field changes detected)';

      await dbWrite([
        dbOp.update('partnerApplications', partnerId, {
          ...form,
          updatedAt: Date.now()
        }),
        dbOp.update('activityLogs', id(), {
          entityId: partnerId,
          entityType: 'partner',
          text: logText,
          userId: ownerId,
          createdAt: Date.now()
        })
      ]);
      toast('Profile updated successfully!', 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleUpdatePassword = async () => {
    if (!newPass || newPass.length < 6) return toast('Password must be at least 6 characters', 'error');
    if (newPass !== confirmPass) return toast('Passwords do not match', 'error');
    
    setResetting(true);
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'set-partner-password',
          email: partner.email,
          password: newPass,
          ownerUserId: ownerId,
          partnerId: partnerId
        })
      });
      const resData = await res.json();
      if (!res.ok) throw new Error(resData.error || 'Failed to update password');
      
      toast('Password updated successfully!', 'success');
      setNewPass('');
      setConfirmPass('');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setResetting(false);
    }
  };

  if (isLoading || !form) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>Loading profile...</div>;

  const f = k => e => setForm(p => ({ ...p, [k]: e.target.value }));
  const dAlias = ownerProfile?.distributorAlias || 'Distributor';
  const rAlias = ownerProfile?.retailerAlias || 'Retailer';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>

      {/* Company Info (from owner) */}
      <div className="card" style={{ padding: 24 }}>
        <h3 style={{ fontSize: 16, marginBottom: 4 }}>🏢 Company Information</h3>
        <p style={{ color: 'var(--muted)', fontSize: 12, marginBottom: 16 }}>Details of the company you are partnered with.</p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: 'var(--muted)', letterSpacing: 0.5, marginBottom: 4 }}>Your Name</div>
            <div style={{ fontSize: 17, fontWeight: 700 }}>{partner.name}</div>
          </div>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: 'var(--muted)', letterSpacing: 0.5, marginBottom: 4 }}>Your Role</div>
            <span className="badge" style={{ background: partner.role === 'Distributor' ? '#ede9fe' : '#dbeafe', color: partner.role === 'Distributor' ? '#6d28d9' : '#1e40af', fontSize: 12 }}>{partner.role === 'Distributor' ? dAlias : rAlias}</span>
          </div>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: 'var(--muted)', letterSpacing: 0.5, marginBottom: 4 }}>Company Name</div>
            <div style={{ fontSize: 15, fontWeight: 600 }}>{ownerProfile.bizName || ownerProfile.businessName || '-'}</div>
          </div>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: 'var(--muted)', letterSpacing: 0.5, marginBottom: 4 }}>Commission Rate</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--accent)' }}>{partner.commission || 0}%</div>
          </div>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: 'var(--muted)', letterSpacing: 0.5, marginBottom: 4 }}>Member Since</div>
            <div style={{ fontSize: 14 }}>{fmtD(partner.approvedAt || partner.appliedAt)}</div>
          </div>
        </div>
      </div>

      {/* Parent Distributor (for Retailers only) */}
      {partner.role === 'Retailer' && (
        <div className="card" style={{ padding: 24 }}>
          <h3 style={{ fontSize: 16, marginBottom: 4 }}>👤 My {dAlias}</h3>
          <p style={{ color: 'var(--muted)', fontSize: 12, marginBottom: 16 }}>Your assigned {dAlias.toLowerCase()} who manages your account.</p>
          {parentDistributor ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, background: 'var(--bg)', padding: 18, borderRadius: 10, border: '1px solid var(--border)' }}>
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: 'var(--muted)', letterSpacing: 0.5, marginBottom: 4 }}>{dAlias} Name</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: '#6d28d9' }}>{parentDistributor.name}</div>
              </div>
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: 'var(--muted)', letterSpacing: 0.5, marginBottom: 4 }}>Company</div>
                <div style={{ fontSize: 14 }}>{parentDistributor.companyName || 'Independent'}</div>
              </div>
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: 'var(--muted)', letterSpacing: 0.5, marginBottom: 4 }}>Phone</div>
                <div style={{ fontSize: 14 }}>{parentDistributor.phone || '-'}</div>
              </div>
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: 'var(--muted)', letterSpacing: 0.5, marginBottom: 4 }}>Email</div>
                <div style={{ fontSize: 14 }}>{parentDistributor.email || '-'}</div>
              </div>
              {parentDistributor.city && (
                <div style={{ gridColumn: 'span 2' }}>
                  <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: 'var(--muted)', letterSpacing: 0.5, marginBottom: 4 }}>Location</div>
                  <div style={{ fontSize: 14 }}>{[parentDistributor.city, parentDistributor.district, parentDistributor.state].filter(Boolean).join(', ')}</div>
                </div>
              )}
            </div>
          ) : (
            <div style={{ background: '#dbeafe', color: '#1e40af', padding: '12px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600 }}>
              Direct Partner — You report directly to the company.
            </div>
          )}
        </div>
      )}

      {/* My Retailers (for Distributors only) */}
      {partner.role === 'Distributor' && (
        <div className="card" style={{ overflow: 'hidden' }}>
          <div style={{ padding: '18px 22px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <h3 style={{ fontSize: 16, margin: 0 }}>👥 My {rAlias}s</h3>
              <p style={{ color: 'var(--muted)', fontSize: 12, margin: '4px 0 0' }}>{rAlias}s assigned under your distribution network.</p>
            </div>
            <span className="badge" style={{ background: '#ede9fe', color: '#6d28d9', fontWeight: 700 }}>{myRetailers.length} {rAlias}{myRetailers.length !== 1 ? 's' : ''}</span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Name</th>
                  <th>Company</th>
                  <th>Phone</th>
                  <th>Email</th>
                  <th>Location</th>
                </tr>
              </thead>
              <tbody>
                {myRetailers.length === 0 ? (
                  <tr>
                    <td colSpan={6} style={{ padding: '30px 22px', textAlign: 'center', color: 'var(--muted)' }}>
                      No {rAlias.toLowerCase()}s assigned under you yet.
                    </td>
                  </tr>
                ) : myRetailers.map((r, i) => (
                  <tr key={r.id}>
                    <td style={{ color: 'var(--muted)', fontSize: 11 }}>{i + 1}</td>
                    <td style={{ fontWeight: 600 }}>{r.name}</td>
                    <td style={{ fontSize: 13 }}>{r.companyName || 'Independent'}</td>
                    <td style={{ fontSize: 13 }}>{r.phone || '-'}</td>
                    <td style={{ fontSize: 13 }}>{r.email || '-'}</td>
                    <td style={{ fontSize: 12, color: 'var(--muted)' }}>{[r.city, r.district].filter(Boolean).join(', ') || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Business Info Card */}
      <div className="card" style={{ padding: 24 }}>
        <h3 style={{ fontSize: 16, marginBottom: 4 }}>Business Profile</h3>
        <p style={{ color: 'var(--muted)', fontSize: 12, marginBottom: 20 }}>Manage your business information and contact details.</p>

        <form onSubmit={handleSave}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <div className="fg">
              <label>Company Name</label>
              <input value={form.companyName} onChange={f('companyName')} />
            </div>
            <div className="fg">
              <label>Tax ID / GSTIN</label>
              <input value={form.taxId} onChange={f('taxId')} placeholder="22AAAAA0000A1Z5" />
            </div>
            <div className="fg">
              <label style={{ color: 'var(--muted)' }}>Official Email (Fixed)</label>
              <input value={form.email} readOnly style={{ background: 'var(--bg)', color: 'var(--muted)', cursor: 'not-allowed' }} />
            </div>
            <div className="fg">
              <label style={{ color: 'var(--muted)' }}>Official Phone (Fixed)</label>
              <input value={form.phone} readOnly style={{ background: 'var(--bg)', color: 'var(--muted)', cursor: 'not-allowed' }} />
            </div>
          </div>
          <p style={{ fontSize: 11, color: 'var(--muted)', margin: '8px 0 14px', fontStyle: 'italic' }}>Note: Email and Phone are managed by the company. Please contact support to update these.</p>

          <div style={{ background: 'var(--bg)', padding: 18, borderRadius: 10, marginBottom: 14 }}>
            <h4 style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 12, fontWeight: 600 }}>📍 Location Details</h4>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div className="fg"><label>Village / Area</label><input value={form.village} onChange={f('village')} /></div>
              <div className="fg"><label>City / Town</label><input value={form.city} onChange={f('city')} /></div>
              <div className="fg"><label>District</label><input value={form.district} onChange={f('district')} /></div>
              <div className="fg"><label>Pincode</label><input value={form.pincode} onChange={f('pincode')} /></div>
              <div className="fg" style={{ gridColumn: 'span 2' }}><label>State</label><input value={form.state} onChange={f('state')} /></div>
              <div className="fg" style={{ gridColumn: 'span 2' }}><label>Full Postal Address</label><textarea value={form.address} onChange={f('address')} rows={2} /></div>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving...' : 'Save Profile Changes'}
            </button>
          </div>
        </form>
      </div>

      {/* Security Card */}
      <div className="card" style={{ padding: 24 }}>
        <h3 style={{ fontSize: 16, marginBottom: 4 }}>🔒 Security & Password</h3>
        <p style={{ color: 'var(--muted)', fontSize: 12, marginBottom: 20 }}>Update your portal login password.</p>
        
        <div style={{ maxWidth: 380, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="fg">
            <label>New Password</label>
            <input type="password" value={newPass} onChange={e => setNewPass(e.target.value)} placeholder="Min 6 characters" />
          </div>
          <div className="fg">
            <label>Confirm New Password</label>
            <input type="password" value={confirmPass} onChange={e => setConfirmPass(e.target.value)} placeholder="Repeat password" />
          </div>
          <button 
            className="btn btn-secondary" 
            onClick={handleUpdatePassword}
            disabled={resetting || !newPass}
            style={{ alignSelf: 'flex-start' }}
          >
            {resetting ? 'Updating...' : 'Update Password'}
          </button>
        </div>
      </div>
    </div>
  );
}
