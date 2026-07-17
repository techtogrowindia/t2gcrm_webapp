import React from 'react';
import { useApp } from '../../context/AppContext';
import { fmtD, daysLeft } from '../../utils/helpers';

export default function NotifPanel({ notifications, onMarkRead, onMarkAllRead }) {
  const { notifOpen, setNotifOpen } = useApp();

  return (
    <div className={`notif-panel${notifOpen ? ' open' : ''}`}>
      <div className="notif-head">
        <strong style={{ fontSize: 13 }}>Notifications</strong>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 11, color: 'var(--accent)', cursor: 'pointer' }} onClick={onMarkAllRead}>Mark all read</span>
          <button className="btn-icon btn-sm" onClick={() => setNotifOpen(false)}>✕</button>
        </div>
      </div>
      <div>
        {!notifications?.length ? (
          <div style={{ textAlign: 'center', padding: '40px', color: 'var(--muted)', fontSize: 13 }}>
            ✓ No new notifications
          </div>
        ) : (
          notifications.map(n => (
            <div key={n.id} className={`notif-item${n.unread ? ' unread' : ''}`} onClick={() => onMarkRead(n)}>
              <div className="ni-title">{n.title}</div>
              <div className="ni-desc">{n.desc}</div>
              <div className="ni-time">{n.time}</div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
