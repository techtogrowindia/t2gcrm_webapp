import React from 'react';
import { useApp } from '../../context/AppContext';
const NAV_ITEMS = [
  { group: 'Main' },
  { id: 'dashboard', label: 'Dashboard', icon: 'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z', permKey: 'Dashboard' },
  { id: 'leads', label: 'Leads', icon: 'M12 8a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm0 2c-4.4 0-8 2.7-8 6v1h16v-1c0-3.3-3.6-6-8-6z', permKey: 'Leads' },
  { id: 'customers', label: 'Customers', icon: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2 M23 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75', permKey: 'Customers' },
  { group: 'Finance' },
  { id: 'quotations', label: 'Quotations', icon: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M16 13H8 M16 17H8 M10 9H8', permKey: 'Quotations' },
  { id: 'invoices', label: 'Invoices', icon: 'M3 3h18v18H3V3z M3 9h18 M9 21V9', permKey: 'Invoices' },
  { id: 'pos', label: 'POS Billing', icon: 'M16 6h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2 M9 3h6a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z M12 11h.01 M12 14h.01 M12 17h.01', permKey: 'Invoices' },
  { id: 'amc', label: 'AMC', icon: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z', permKey: 'AMC' },
  { id: 'expenses', label: 'Expenses', icon: 'M12 1v22 M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6', permKey: 'Expenses' },
  { id: 'products', label: 'Products', icon: 'M20 7H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16', permKey: 'Products' },
  { id: 'vendors', label: 'Vendors', icon: 'M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z M9 22V12h6v10', permKey: 'Vendors' },
  { id: 'purchase-orders', label: 'Purchase Orders', icon: 'M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z M3 6h18 M16 10a4 4 0 0 1-8 0', permKey: 'PurchaseOrders' },
  { group: 'Work' },
  { id: 'projects', label: 'Projects', icon: 'M3 3h18v18H3V3z M3 9h18 M9 21V9', permKey: 'Projects' },
  { id: 'alltasks', label: 'All Tasks', icon: 'M9 11l3 3L22 4 M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11', permKey: 'Tasks' },
  { id: 'teams', label: 'Teams', icon: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2 M23 21v-2a4 4 0 0 0-3-3.87 M9 7a4 4 0 1 0 0-8 4 4 0 0 0 0 8z', permKey: 'Teams' },
  { group: 'Marketing' },
  { id: 'campaigns', label: 'Campaigns', icon: 'M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7 M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z', permKey: 'Campaigns' },
  { group: 'E-Commerce' },
  { id: 'ecom-settings', label: 'Website Settings', icon: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z M2 12h20 M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z', permKey: 'Ecommerce' },
  { id: 'ecom-orders', label: 'Orders', icon: 'M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z M3 6h18 M16 10a4 4 0 0 1-8 0', permKey: 'Ecommerce' },
  { group: 'Partners' },
  { id: 'distributors', label: 'Channel Partners', icon: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2 M23 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75 M7 10h14 M7 14h14 M7 18h14', permKey: 'Distributors' },
  { group: 'Appointments' },
  { id: 'appointments', label: 'Appointments', icon: 'M8 6h13 M8 12h13 M8 18h13 M3 6h.01 M3 12h.01 M3 18h.01', permKey: 'Appointments' },
  { group: 'System' },
  { id: 'reports', label: 'Reports', icon: 'M21 21H3V3h18v18z M9 17v-6 M12 17V9 M15 17v-4', permKey: 'Reports' },
  { id: 'automation', label: 'Automation', icon: 'M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z M13 2v7h7 M12 14v4 M15 17l-3 3-3-3', permKey: 'Automation' },
  { id: 'integrations', label: 'Integrations', icon: 'M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2 M7 9l5-5 5 5 M12 4v12', permKey: 'Integrations' },
  { id: 'messaging-logs', label: 'Messaging Logs', icon: 'M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 1 1-7.6-11.7 8.5 8.5 0 0 1 8.5 7.9 M16 7h.01 M12 7h.01 M8 7h.01', permKey: 'MessagingLogs' },
  { id: 'userprofile', label: 'My Profile', icon: 'M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z', permKey: 'Public' },
  { id: 'settings', label: 'Business Settings', icon: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z', permKey: 'Settings' },
];

export default function Sidebar({ isSuperadmin, isExpired, perms, settings, planEnforcement }) {
  const { activeView, setActiveView, setSettingsTab, sidebarExpanded, setSidebarExpanded, mobileSidebarOpen, setMobileSidebarOpen } = useApp();


  // Filter NAV_ITEMS based on permissions AND plan module access
  // Show sidebar immediately while loading. Once perms/planEnforcement loads,
  // filter by actual permissions. No permission = visible by default (optimistic).
  const filteredItems = NAV_ITEMS.filter(item => {
    if (item.group) return true;
    if (item.id === 'userprofile') return true; // Everyone can see their profile

    // If perms/planEnforcement not yet loaded, show item (optimistic)
    if (!perms || !planEnforcement) return true;

    // Plan-level module check for owners too
    if (perms?.isOwner) {
      if (!isSuperadmin && !planEnforcement.isViewAllowed(item.id)) return false;
      return true;
    }

    // Plan-level module check (team members only — owners bypass)
    if (!isSuperadmin && !planEnforcement.isViewAllowed(item.id)) return false;
    if (item.id === 'dashboard') return perms?.can('Dashboard', 'view') !== false;
    return perms?.can(item.permKey, 'list') !== false;
  });

  return (
    <>
      <div className={`sidebar-overlay ${mobileSidebarOpen ? 'mobile-open' : ''}`} onClick={() => setMobileSidebarOpen(false)} />
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
          <span className="nav-label" style={{ fontWeight: 800, fontSize: 13 }}>{settings?.brandName || ''}</span>
        </div>
      <nav style={{ width: '100%', flex: 1, overflowY: 'auto' }}>
        {filteredItems.map((item, i) => {
          if (item.group) {
            // Only show group label if it has accessible items directly below it (before the next group)
            const nextGroupIdx = filteredItems.findIndex((next, idx) => idx > i && next.group);
            const nextItemIdx = filteredItems.findIndex((next, idx) => idx > i && !next.group);
            // Group has items only if a nav item exists before the next group header (or at end of list)
            const groupHasItems = nextItemIdx !== -1 && (nextGroupIdx === -1 || nextItemIdx < nextGroupIdx);
            if (!groupHasItems) return null;
            return <div key={i} className="nav-group-label">{item.group}</div>;
          }
          return (
            <div
              key={item.id}
              className={`nav-item${activeView === item.id ? ' active' : ''}`}
              onClick={() => {
                setActiveView(item.id);
                if (item.id === 'settings') setSettingsTab('Business');
                setMobileSidebarOpen(false);
              }}
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
        {isSuperadmin && (
          <>
            <div className="nav-group-label">Platform</div>
            <div
              className={`nav-item${activeView === 'admin' ? ' active' : ''}`}
              onClick={() => {
                setActiveView('admin');
                setMobileSidebarOpen(false);
              }}
            >
              <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{ width: 17, height: 17, flexShrink: 0 }}>
                <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span className="nav-label">Admin Panel</span>
            </div>
            <div
              className={`nav-item${activeView === 'apidocs' ? ' active' : ''}`}
              onClick={() => {
                setActiveView('apidocs');
                setMobileSidebarOpen(false);
              }}
            >
              <svg fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" style={{ width: 17, height: 17, flexShrink: 0 }}>
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /><polyline points="10 9 9 9 8 9" />
              </svg>
              <span className="nav-label">API Docs</span>
            </div>
          </>
        )}
      </nav>
      </aside>
    </>
  );
}
