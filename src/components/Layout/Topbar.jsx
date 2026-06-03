import React, { useMemo } from 'react';
import db from '../../instant';
import { useApp } from '../../context/AppContext';

const VIEW_TITLES = {
  dashboard: 'Dashboard', leads: 'Leads',  quotations: 'Quotations',
  invoices: 'Invoices', amc: 'AMC Contracts',
  expenses: 'Expenses', products: 'Products & Services',
  projects: 'Projects & Tasks', alltasks: 'All Tasks', teams: 'Teams',
  automation: 'Automation', reports: 'Reports & Analytics', settings: 'Settings',
  admin: 'Admin Panel', pos: 'POS Billing',
};

export default function Topbar({ user, notifCount, isExpired, teamInfo, teamMembers }) {
  const { activeView, setActiveView, setSidebarExpanded, mobileSidebarOpen, setMobileSidebarOpen, setNotifOpen, setSettingsTab } = useApp();

  // Find team member role if applicable
  const roleName = useMemo(() => {
    if (!teamInfo?.isTeamMember || !teamMembers) return null;
    const member = teamMembers.find(m => m.id === teamInfo.teamMemberId);
    return member?.role || 'Team';
  }, [teamInfo, teamMembers]);

  // Name of the logged-in user — team member's name, else owner's full /
  // business name, else the email. Shown next to the avatar so it's always
  // clear who is logged in.
  const displayName = useMemo(() => {
    if (teamInfo?.isTeamMember && teamMembers) {
      const member = teamMembers.find(m => m.id === teamInfo.teamMemberId);
      if (member?.name) return member.name;
    }
    return user?.profile?.fullName || user?.profile?.bizName || user?.email || 'User';
  }, [teamInfo, teamMembers, user]);

  return (
    <div className="topbar">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button className="menu-toggle" onClick={() => {
          if (window.innerWidth <= 768) {
            setMobileSidebarOpen(v => !v);
          } else {
            setSidebarExpanded(v => !v);
          }
        }}>
          <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        <span className="topbar-title">{VIEW_TITLES[activeView] || activeView}</span>
      </div>

      <div className="topbar-right">
        {/* Team Badge */}
        {roleName && (
          <div className="role-badge" style={{ background: '#dcfce7', color: '#166534', padding: '4px 10px', borderRadius: 20, fontSize: 10, fontWeight: 700, border: '1px solid #bbf7d0', textTransform: 'uppercase' }}>
            👥 {roleName}
          </div>
        )}

        {/* Notification Bell */}
        <div className="notif-btn-wrap">
          <button className="btn-icon" onClick={() => setNotifOpen(v => !v)}>
            <svg width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
          </button>
          {notifCount > 0 && <span className="notif-dot" />}
        </div>

        {/* Plan badge & Expiry Notification */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {isExpired && (
            <div style={{ background: '#fee2e2', color: '#991b1b', padding: '4px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700, border: '1px solid #fecaca' }}>
              ⚠️ PLAN EXPIRED
            </div>
          )}
          <div 
            style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', background: 'var(--bg-soft)', padding: '4px 10px', borderRadius: 6, cursor: 'pointer' }}
            onClick={() => {
              if (setSettingsTab) setSettingsTab('Billing');
              setActiveView('settings');
            }}
            title="Go to Billing Settings"
          >
            <span className="plan-badge-text">{user?.profile?.plan || 'Free'}</span>
          </div>
        </div>

        {/* Avatar + logged-in name */}
        <div
          onClick={() => setActiveView('userprofile')}
          title={`Logged in as ${displayName}${user?.email ? ` (${user.email})` : ''}`}
          style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}
        >
          <div className="av">
            {(displayName || user?.email || 'U').charAt(0).toUpperCase()}
          </div>
          <span
            className="topbar-username"
            style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >
            {displayName}
          </span>
        </div>

        {/* Logout */}
        <button className="btn-icon" onClick={() => {
          // Clear all session-specific localStorage before signing out
          // so the next user doesn't see stale data
          const keysToRemove = [];
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && (
              key.startsWith('tc_') ||
              key.startsWith('leads_cache_') ||
              key.startsWith('leadView_') ||
              key.startsWith('callLogView_')
            )) keysToRemove.push(key);
          }
          keysToRemove.forEach(k => localStorage.removeItem(k));
          db.auth.signOut();
        }} title="Logout">
          <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" />
          </svg>
        </button>
      </div>
    </div>
  );
}
