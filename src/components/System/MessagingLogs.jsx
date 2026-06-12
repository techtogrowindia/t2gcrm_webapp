import React, { useState, useMemo } from 'react';
import { dbWrite, dbOp } from '../../utils/dbWrite';
import db from '../../instant';
import { id } from '@instantdb/react';
import { fmtD, stageBadgeClass } from '../../utils/helpers';

export default function MessagingLogs({ user, ownerId }) {
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [dateFilter, setDateFilter] = useState('today');
  const [viewMessage, setViewMessage] = useState(null);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;

  const { data, isLoading } = db.useQuery({
    outbox: { $: { where: { userId: ownerId } } },
  });

  const allLogs = data?.outbox || [];

  // Only keep last 30 days for display
  const thirtyDaysAgo = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }, []);

  const logs = useMemo(() => allLogs.filter(l => (l.sentAt || 0) >= thirtyDaysAgo), [allLogs, thirtyDaysAgo]);
  const oldLogs = useMemo(() => allLogs.filter(l => (l.sentAt || 0) < thirtyDaysAgo), [allLogs, thirtyDaysAgo]);

  const filtered = useMemo(() => {
    return logs
      .filter(l => !typeFilter || l.type === typeFilter)
      .filter(l => !statusFilter || l.status === statusFilter)
      .filter(l => {
        if (!search) return true;
        const q = search.toLowerCase();
        return [l.recipient, l.content, l.type, l.status].some(v => (v || '').toLowerCase().includes(q));
      })
      .filter(l => {
        if (!dateFilter) return true;
        const sentDate = new Date(l.sentAt);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        const weekAgo = new Date(today);
        weekAgo.setDate(weekAgo.getDate() - 7);
        const monthAgo = new Date(today);
        monthAgo.setMonth(monthAgo.getMonth() - 1);
        
        if (dateFilter === 'today') return sentDate >= today;
        if (dateFilter === 'yesterday') return sentDate >= yesterday && sentDate < today;
        if (dateFilter === 'week') return sentDate >= weekAgo;
        if (dateFilter === 'month') return sentDate >= monthAgo;
        return true;
      })
      .sort((a, b) => (b.sentAt || 0) - (a.sentAt || 0));
  }, [logs, typeFilter, statusFilter, dateFilter, search]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paged = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  // Reset page on filter change
  useMemo(() => setPage(0), [typeFilter, statusFilter, dateFilter, search]);

  const stats = useMemo(() => {
    return {
      total: filtered.length,
      email: filtered.filter(l => l.type === 'email').length,
      whatsapp: filtered.filter(l => l.type === 'whatsapp').length,
      failed: filtered.filter(l => l.status === 'Failed').length,
    };
  }, [filtered]);

  const dateLabel = useMemo(() => {
    if (dateFilter === 'today') return 'Today';
    if (dateFilter === 'yesterday') return 'Yesterday';
    if (dateFilter === 'week') return 'Last 7 Days';
    if (dateFilter === 'month') return 'Last 30 Days';
    return 'Last 30 Days';
  }, [dateFilter]);

  const handleDeleteOldLogs = async () => {
    if (oldLogs.length === 0) return;
    if (!confirm(`Permanently delete ${oldLogs.length} logs older than 30 days? This will improve performance.`)) return;
    try {
      const batchSize = 50;
      for (let i = 0; i < oldLogs.length; i += batchSize) {
        const batch = oldLogs.slice(i, i + batchSize);
        await dbWrite(batch.map(l => dbOp.delete('outbox', l.id)));
      }
      alert(`Deleted ${oldLogs.length} old logs successfully.`);
    } catch (e) {
      alert('Error deleting old logs: ' + e.message);
    }
  };

  if (isLoading) return <div className="loading-screen"><div className="spinner" /></div>;

  return (
    <div className="messaging-logs">
      <div className="sh">
        <div>
          <h2>Messaging Logs</h2>
          <div className="sub">Track all outgoing emails and WhatsApp messages</div>
        </div>
        {oldLogs.length > 0 && (
          <button className="btn btn-secondary btn-sm" style={{ color: '#dc2626' }} onClick={handleDeleteOldLogs}>
            🗑 Delete {oldLogs.length} Old Logs (&gt;30 days)
          </button>
        )}
      </div>

      <div className="stat-grid" style={{ marginBottom: 25 }}>
        <div className="stat-card sc-blue">
          <div className="lbl">{dateLabel}</div>
          <div className="val">{stats.total}</div>
        </div>
        <div className="stat-card sc-purple">
          <div className="lbl">Emails Sent</div>
          <div className="val">{stats.email}</div>
        </div>
        <div className="stat-card sc-green">
          <div className="lbl">WhatsApp Sent</div>
          <div className="val">{stats.whatsapp}</div>
        </div>
        <div className="stat-card sc-red">
          <div className="lbl">Failed</div>
          <div className="val">{stats.failed}</div>
        </div>
      </div>

      <div className="tw">
        <div className="tw-head">
          <h3>Activity History ({filtered.length})</h3>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <div className="sw">
              <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
              <input className="si" placeholder="Search logs..." value={search} onChange={e => setSearch(e.target.value)} />
            </div>
            <select className="si" style={{ width: 130 }} value={dateFilter} onChange={e => setDateFilter(e.target.value)}>
              <option value="today">Today</option>
              <option value="yesterday">Yesterday</option>
              <option value="week">Last 7 Days</option>
              <option value="month">Last 30 Days</option>
            </select>
            <select className="si" style={{ width: 130 }} value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
              <option value="">All Types</option>
              <option value="email">Email</option>
              <option value="whatsapp">WhatsApp</option>
            </select>
            <select className="si" style={{ width: 130 }} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
              <option value="">All Status</option>
              <option value="Sent">Sent</option>
              <option value="Failed">Failed</option>
            </select>
          </div>
        </div>

        <div className="tw-scroll">
          <table>
            <thead>
              <tr>
                <th>Recipient</th>
                <th>Type</th>
                <th>Content Preview</th>
                <th>Status</th>
                <th>Sent At</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {paged.length === 0 ? (
                <tr><td colSpan={6} style={{ textAlign: 'center', padding: 28, color: 'var(--muted)' }}>No messaging logs found for this filter</td></tr>
              ) : (
                paged.map((l) => (
                  <tr key={l.id}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{l.recipient}</div>
                    </td>
                    <td>
                      <span className={`badge ${l.type === 'email' ? 'bg-blue' : 'bg-green'}`} style={{ fontSize: 10 }}>
                        {l.type === 'email' ? '✉ Email' : '🗨 WhatsApp'}
                      </span>
                    </td>
                    <td style={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12, color: 'var(--muted)' }}>
                      {l.content}
                    </td>
                    <td>
                      <span className={`badge ${stageBadgeClass(l.status)}`}>{l.status}</span>
                    </td>
                    <td style={{ fontSize: 11, color: 'var(--muted)' }}>
                      {new Date(l.sentAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button className="btn btn-secondary btn-sm" onClick={() => setViewMessage(l)}>View</button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderTop: '1px solid var(--border)', fontSize: 13 }}>
            <span style={{ color: 'var(--muted)' }}>
              Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, filtered.length)} of {filtered.length}
            </span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="btn btn-secondary btn-sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>← Prev</button>
              <span style={{ padding: '4px 10px', fontSize: 13, fontWeight: 600 }}>{page + 1} / {totalPages}</span>
              <button className="btn btn-secondary btn-sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>Next →</button>
            </div>
          </div>
        )}
      </div>

      {viewMessage && (
        <div className="mo open">
          <div className="mo-box" style={{ maxWidth: 500 }}>
            <div className="mo-head">
              <h3>Message Details</h3>
              <button className="btn-icon" onClick={() => setViewMessage(null)}>✕</button>
            </div>
            <div className="mo-body">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 15 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 15 }}>
                  <div>
                    <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Recipient</label>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{viewMessage.recipient}</div>
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Type</label>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{viewMessage.type === 'email' ? 'Email' : 'WhatsApp'}</div>
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Sent At</label>
                    <div style={{ fontSize: 13 }}>{new Date(viewMessage.sentAt).toLocaleString()}</div>
                  </div>
                  <div>
                    <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Status</label>
                    <span className={`badge ${stageBadgeClass(viewMessage.status)}`}>{viewMessage.status}</span>
                  </div>
                </div>
                <div>
                  <label style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Content</label>
                  <div style={{ 
                    fontSize: 13, 
                    background: 'var(--bg-soft)', 
                    padding: 15, 
                    borderRadius: 8, 
                    whiteSpace: 'pre-wrap', 
                    maxHeight: 300, 
                    overflowY: 'auto',
                    border: '1px solid var(--border)',
                    lineHeight: 1.5
                  }}>
                    {viewMessage.content}
                  </div>
                </div>
                {viewMessage.error && (
                  <div style={{ background: '#fee2e2', color: '#991b1b', padding: 12, borderRadius: 8, fontSize: 12 }}>
                    <strong>Error:</strong>
                    <pre style={{ margin: '6px 0 0', whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'inherit', fontSize: 12, lineHeight: 1.6 }}>
                      {(() => {
                        // Pretty-print if it's JSON, otherwise show as-is
                        try { return JSON.stringify(JSON.parse(viewMessage.error), null, 2); }
                        catch { return viewMessage.error; }
                      })()}
                    </pre>
                  </div>
                )}
              </div>
            </div>
            <div className="mo-foot">
              <button className="btn btn-primary btn-sm" onClick={() => setViewMessage(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
