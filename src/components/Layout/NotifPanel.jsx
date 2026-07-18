import React from 'react';
import { useApp } from '../../context/AppContext';

export default function NotifPanel({ notifications, onMarkRead, onMarkAllRead }) {
  const { notifOpen, setNotifOpen } = useApp();

  // Only unread notifications are shown — marking one read (via "Mark all
  // read" or the per-item ✕) removes it from the panel. Read state is
  // persisted in MainApp, so a cleared notification stays cleared across
  // refreshes and only reappears if something genuinely new happens.
  const items = (notifications || []).filter(n => n.unread);

  return (
    <div className={`notif-panel${notifOpen ? ' open' : ''}`}>
      <div className="notif-head">
        <strong style={{ fontSize: 13 }}>Notifications</strong>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {items.length > 0 && (
            <span style={{ fontSize: 11, color: 'var(--accent)', cursor: 'pointer' }} onClick={onMarkAllRead}>Mark all read</span>
          )}
          <button className="btn-icon btn-sm" onClick={() => setNotifOpen(false)}>✕</button>
        </div>
      </div>
      <div>
        {items.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px', color: 'var(--muted)', fontSize: 13 }}>
            ✓ No new notifications
          </div>
        ) : (
          items.map(n => (
            <div key={n.id} className="notif-item unread" style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="ni-title">{n.title}</div>
                <div className="ni-desc">{n.desc}</div>
                <div className="ni-time">{n.time}</div>
              </div>
              <button
                title="Clear"
                onClick={(e) => { e.stopPropagation(); onMarkRead(n); }}
                style={{ flexShrink: 0, border: 'none', background: 'transparent', color: 'var(--muted)', cursor: 'pointer', fontSize: 15, lineHeight: 1, padding: '2px 4px', borderRadius: 4 }}
              >✕</button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
