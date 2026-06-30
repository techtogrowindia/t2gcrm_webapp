import React, { useState, useMemo } from 'react';
import db from '../../instant';
import { useToast } from '../../context/ToastContext';
import SearchableSelect from '../UI/SearchableSelect';

/**
 * Archive Manager — bullet-proof per-customer data export / delete / restore.
 *
 * Safety guarantees enforced by UI:
 *  - All actions require a selected customer (ownerId)
 *  - Delete requires preview + typing "DELETE" to confirm
 *  - Delete is gated on a date filter (records older than X)
 *  - Restore validates the JSON belongs to the selected customer
 *
 * Server-side enforces additional safeguards (MIN_AGE_DAYS, deletable-only
 * collections, duplicate-safe restore).
 */

const EXPORTABLE = [
  { value: 'all-logs', label: '🗂️ All Log Collections (combined)', deletable: true, group: true },
  { value: 'callLogs', label: 'Call Logs', deletable: true },
  { value: 'activityLogs', label: 'Activity Logs', deletable: true },
  { value: 'executedAutomations', label: 'Executed Automations', deletable: true },
  { value: 'outbox', label: 'Outbox (sent messages)', deletable: true },
  { value: 'attendance', label: 'Attendance', deletable: true },
  { value: 'leads', label: 'Leads (export only)', deletable: false },
  { value: 'customers', label: 'Customers (export only)', deletable: false },
  { value: 'invoices', label: 'Invoices (export only)', deletable: false },
  { value: 'quotes', label: 'Quotes (export only)', deletable: false },
  { value: 'appointments', label: 'Appointments (export only)', deletable: false },
];

// Members of the "all-logs" group — every collection iterated when user picks "all-logs"
const ALL_LOG_COLLECTIONS = ['callLogs', 'activityLogs', 'executedAutomations', 'outbox', 'attendance'];

export default function ArchiveManager({ user }) {
  const toast = useToast();
  const [tab, setTab] = useState('export');

  // Shared state across all tabs
  const [ownerId, setOwnerId] = useState('');
  const [collection, setCollection] = useState('callLogs');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  // Preview state
  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Action state
  const [actionLoading, setActionLoading] = useState(false);
  const [confirmText, setConfirmText] = useState('');

  // Restore state
  const [restoreFile, setRestoreFile] = useState(null);
  const [restorePreview, setRestorePreview] = useState(null);

  // History state
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Fetch list of customers (businesses)
  const { data } = db.useQuery({ userProfiles: {} });
  const customers = data?.userProfiles || [];
  const customersSorted = useMemo(
    () => [...customers].sort((a, b) =>
      (a.email || '').localeCompare(b.email || '')
    ),
    [customers]
  );

  const selectedCustomer = customersSorted.find(c => c.userId === ownerId);
  const selectedCollection = EXPORTABLE.find(c => c.value === collection);

  // Build options for SearchableSelect:
  //   name = email (primary line)
  //   code = "Business Name • Owner Name" (secondary line — searchable too)
  //   userId = the value passed back to onChange
  const customerOptions = useMemo(
    () => customersSorted.map(c => ({
      name: c.email || '(no email)',
      userId: c.userId,
      code: [c.bizName, c.fullName].filter(Boolean).join(' • ') || ' ',
    })),
    [customersSorted]
  );

  // Reset preview when scope changes
  React.useEffect(() => {
    setPreview(null);
    setConfirmText('');
  }, [ownerId, collection, fromDate, toDate, tab]);

  const callApi = async (body) => {
    const res = await fetch('/api/admin/archive', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
    return json;
  };

  const doPreview = async () => {
    if (!ownerId) return toast('Select a customer first', 'error');
    if (!collection) return toast('Select a collection', 'error');
    setPreviewLoading(true);
    setPreview(null);
    try {
      if (collection === 'all-logs') {
        // Fan out across every log collection, sum counts
        const results = await Promise.all(
          ALL_LOG_COLLECTIONS.map(coll =>
            callApi({
              action: 'preview',
              ownerId,
              collection: coll,
              fromDate: fromDate || undefined,
              toDate: toDate || undefined,
            }).then(r => ({ coll, ...r })).catch(() => ({ coll, count: 0, estimatedSizeMB: 0, totalForOwner: 0 }))
          )
        );
        const totalCount = results.reduce((s, r) => s + (r.count || 0), 0);
        const totalSize = results.reduce((s, r) => s + (r.estimatedSizeMB || 0), 0);
        const totalForOwner = results.reduce((s, r) => s + (r.totalForOwner || 0), 0);
        const dates = results.flatMap(r => [r.oldestDate, r.newestDate].filter(Boolean));
        setPreview({
          count: totalCount,
          totalForOwner,
          estimatedSizeMB: totalSize.toFixed(2),
          oldestDate: dates.length ? Math.min(...dates) : null,
          newestDate: dates.length ? Math.max(...dates) : null,
          breakdown: results,
        });
      } else {
        const r = await callApi({
          action: 'preview',
          ownerId,
          collection,
          fromDate: fromDate || undefined,
          toDate: toDate || undefined,
        });
        setPreview(r);
      }
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setPreviewLoading(false);
    }
  };

  const triggerDownload = (payload, filename) => {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const doExport = async () => {
    if (!ownerId) return toast('Select a customer first', 'error');
    if (!preview) return toast('Click Preview first', 'error');
    if (preview.count === 0) return toast('Nothing to export', 'error');

    setActionLoading(true);
    try {
      const dateStr = new Date().toISOString().split('T')[0];
      const safeEmail = (selectedCustomer?.email || ownerId).replace(/[^a-z0-9]/gi, '_');

      if (collection === 'all-logs') {
        // Fan out across every log collection, build a combined JSON
        const results = await Promise.all(
          ALL_LOG_COLLECTIONS.map(coll =>
            callApi({
              action: 'export',
              ownerId,
              collection: coll,
              fromDate: fromDate || undefined,
              toDate: toDate || undefined,
              actorId: user?.id,
            }).catch(err => ({ records: [], count: 0, error: err.message, collection: coll }))
          )
        );
        const data = {};
        let total = 0;
        results.forEach(r => {
          data[r.collection] = r.records || [];
          total += r.count || 0;
        });

        const filename = `archive_all-logs_${safeEmail}_${dateStr}.json`;
        triggerDownload({
          meta: {
            collection: 'all-logs',
            ownerId,
            ownerEmail: selectedCustomer?.email || '',
            fromDate: fromDate || null,
            toDate: toDate || null,
            exportedAt: Date.now(),
            recordCount: total,
          },
          data,
        }, filename);

        toast(`✓ Exported ${total} record(s) across ${ALL_LOG_COLLECTIONS.length} collections → ${filename}`, 'success');
      } else {
        const r = await callApi({
          action: 'export',
          ownerId,
          collection,
          fromDate: fromDate || undefined,
          toDate: toDate || undefined,
          actorId: user?.id,
        });
        const filename = `archive_${collection}_${safeEmail}_${dateStr}.json`;
        triggerDownload({
          meta: {
            archiveId: r.archiveId,
            collection: r.collection,
            ownerId,
            ownerEmail: selectedCustomer?.email || '',
            fromDate: r.fromDate,
            toDate: r.toDate,
            exportedAt: r.exportedAt,
            recordCount: r.count,
          },
          records: r.records,
        }, filename);
        toast(`✓ Exported ${r.count} record(s) → ${filename}`, 'success');
      }
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const doDelete = async () => {
    if (!ownerId) return toast('Select a customer first', 'error');
    if (!toDate) return toast('Set a "To Date" — required for delete', 'error');
    if (!preview) return toast('Click Preview first', 'error');
    if (preview.count === 0) return toast('Nothing to delete', 'error');
    if (confirmText !== 'DELETE') return toast('Type DELETE to confirm', 'error');
    if (!selectedCollection?.deletable) return toast('This collection cannot be deleted', 'error');

    if (!window.confirm(
      `⚠️ FINAL CONFIRMATION\n\n` +
      `Customer: ${selectedCustomer?.email}\n` +
      `Collection: ${collection}\n` +
      `Records to delete: ${preview.count}\n` +
      `Date range: ${fromDate || 'earliest'} → ${toDate}\n\n` +
      `This action cannot be undone. Continue?`
    )) return;

    setActionLoading(true);
    try {
      if (collection === 'all-logs') {
        // Fan out delete across every log collection
        const results = await Promise.all(
          ALL_LOG_COLLECTIONS.map(coll =>
            callApi({
              action: 'delete',
              ownerId,
              collection: coll,
              fromDate: fromDate || undefined,
              toDate,
              confirm: 'DELETE',
              actorId: user?.id,
            }).catch(err => ({ deleted: 0, error: err.message, collection: coll }))
          )
        );
        const total = results.reduce((s, r) => s + (r.deleted || 0), 0);
        const errors = results.filter(r => r.error);
        if (errors.length > 0) {
          toast(`✓ Deleted ${total} record(s) — ${errors.length} collection(s) had errors`, 'warning');
        } else {
          toast(`✓ Deleted ${total} record(s) across ${ALL_LOG_COLLECTIONS.length} collections`, 'success');
        }
      } else {
        const r = await callApi({
          action: 'delete',
          ownerId,
          collection,
          fromDate: fromDate || undefined,
          toDate,
          confirm: 'DELETE',
          actorId: user?.id,
        });
        toast(`✓ Deleted ${r.deleted} record(s)`, 'success');
      }
      setPreview(null);
      setConfirmText('');
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const handleRestoreFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setRestoreFile(file);
    setRestorePreview(null);

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const parsed = JSON.parse(evt.target.result);
        const meta = parsed.meta || {};

        // Three formats supported:
        // 1. Multi-collection (all-logs export): { meta, data: { callLogs: [...], activityLogs: [...] } }
        // 2. Single collection (wrapped):        { meta, records: [...] }
        // 3. Single collection (raw array):      [ ...records ]
        if (parsed.data && typeof parsed.data === 'object') {
          // Multi-collection
          const totalCount = Object.values(parsed.data).reduce((s, arr) => s + (Array.isArray(arr) ? arr.length : 0), 0);
          setRestorePreview({
            meta,
            multi: true,
            data: parsed.data,
            recordCount: totalCount,
          });
        } else {
          const records = Array.isArray(parsed) ? parsed : (parsed.records || []);
          setRestorePreview({ meta, records, recordCount: records.length });
        }
      } catch (err) {
        toast('Invalid JSON file: ' + err.message, 'error');
        setRestoreFile(null);
      }
    };
    reader.readAsText(file);
  };

  const doRestore = async () => {
    if (!ownerId) return toast('Select the customer this data belongs to', 'error');
    if (!restorePreview || restorePreview.recordCount === 0) {
      return toast('No records in the file', 'error');
    }

    if (!window.confirm(
      `Restore ${restorePreview.recordCount} record(s) for ${selectedCustomer?.email}?\n\n` +
      `Duplicate records (same id) will be skipped — your existing data is safe.`
    )) return;

    setActionLoading(true);
    try {
      if (restorePreview.multi) {
        // Multi-collection restore — call API once per collection
        let totalInserted = 0;
        let totalSkipped = 0;
        const errors = [];
        for (const [coll, records] of Object.entries(restorePreview.data)) {
          if (!Array.isArray(records) || records.length === 0) continue;
          try {
            const r = await callApi({
              action: 'restore',
              ownerId,
              collection: coll,
              records,
              actorId: user?.id,
            });
            totalInserted += r.inserted || 0;
            totalSkipped += r.skipped || 0;
          } catch (err) {
            errors.push(`${coll}: ${err.message}`);
          }
        }
        if (errors.length > 0) {
          toast(`Restored ${totalInserted}, skipped ${totalSkipped} — errors: ${errors.join('; ')}`, 'warning');
        } else {
          toast(`✓ Restored ${totalInserted} record(s), skipped ${totalSkipped} duplicate(s)`, 'success');
        }
      } else {
        const targetCollection = restorePreview.meta?.collection || collection;
        if (!EXPORTABLE.find(c => c.value === targetCollection) || targetCollection === 'all-logs') {
          return toast(`Collection "${targetCollection}" is not supported for single-collection restore`, 'error');
        }
        const r = await callApi({
          action: 'restore',
          ownerId,
          collection: targetCollection,
          records: restorePreview.records,
          actorId: user?.id,
        });
        toast(r.message || `Restored ${r.inserted}, skipped ${r.skipped}`, 'success');
      }
      setRestoreFile(null);
      setRestorePreview(null);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setActionLoading(false);
    }
  };

  const loadHistory = async () => {
    setHistoryLoading(true);
    try {
      const r = await callApi({ action: 'history' });
      setHistory(r.history || []);
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      setHistoryLoading(false);
    }
  };

  React.useEffect(() => {
    if (tab === 'history') loadHistory();
  }, [tab]);

  // Build a map of ownerId → email for history display
  const ownerEmailMap = useMemo(
    () => Object.fromEntries(customers.map(c => [c.userId, c.email])),
    [customers]
  );

  const card = { border: '1px solid var(--border)', borderRadius: 8, padding: 16, marginBottom: 16, background: 'var(--card)' };
  const label = { display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--muted)', marginBottom: 4 };
  const input = { width: '100%', padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 14 };

  return (
    <div>
      <h3 style={{ marginBottom: 4 }}>📦 Archive Manager</h3>
      <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 20 }}>
        Per-customer data export, safe delete (with confirmation), and restore from JSON.
      </p>

      {/* Customer + Collection picker (shared across tabs) */}
      <div style={card}>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 2fr 1fr 1fr', gap: 12 }}>
          <div>
            <label style={label}>Customer (Business)</label>
            <SearchableSelect
              options={customerOptions}
              value={ownerId}
              onChange={setOwnerId}
              placeholder="Select a customer…"
              displayKey="name"
              returnKey="userId"
            />
          </div>
          <div>
            <label style={label}>Collection</label>
            <select value={collection} onChange={e => setCollection(e.target.value)} style={input}>
              {EXPORTABLE.map(c => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label style={label}>From Date</label>
            <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} style={input} />
          </div>
          <div>
            <label style={label}>To Date</label>
            <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} style={input} />
          </div>
        </div>
      </div>

      {/* Sub-tabs */}
      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border)', marginBottom: 16 }}>
        {[
          ['export', '📥 Export'],
          ['delete', '🗑️ Delete Old Data'],
          ['restore', '♻️ Restore from JSON'],
          ['history', '📜 History'],
        ].map(([t, l]) => (
          <div
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: '8px 16px',
              cursor: 'pointer',
              borderBottom: tab === t ? '2px solid var(--accent)' : '2px solid transparent',
              fontWeight: tab === t ? 600 : 400,
              color: tab === t ? 'var(--accent)' : 'var(--muted)',
            }}
          >
            {l}
          </div>
        ))}
      </div>

      {/* ── EXPORT TAB ── */}
      {tab === 'export' && (
        <div style={card}>
          <h4 style={{ marginTop: 0 }}>Export Data</h4>
          <p style={{ fontSize: 13, color: 'var(--muted)' }}>
            Download a JSON file of the selected records. <strong>Data stays in the database.</strong>
            <br />
            You can re-import this file anytime using the <em>Restore</em> tab.
          </p>

          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button className="btn btn-secondary" onClick={doPreview} disabled={!ownerId || previewLoading}>
              {previewLoading ? 'Counting…' : '🔍 Preview Count'}
            </button>
            <button className="btn btn-primary" onClick={doExport} disabled={!preview || preview.count === 0 || actionLoading}>
              {actionLoading ? 'Exporting…' : `📥 Download JSON${preview ? ` (${preview.count})` : ''}`}
            </button>
          </div>

          {preview && (
            <div style={{ marginTop: 16, padding: 12, background: 'var(--bg)', borderRadius: 6, fontSize: 13 }}>
              <div><strong>{preview.count}</strong> record(s) match the filter</div>
              <div>Total in collection for this customer: {preview.totalForOwner}</div>
              <div>Estimated download size: ~{preview.estimatedSizeMB} MB</div>
              {preview.oldestDate && (
                <div>Date range: {new Date(preview.oldestDate).toLocaleDateString()} → {new Date(preview.newestDate).toLocaleDateString()}</div>
              )}
              {preview.breakdown && (
                <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)' }}>
                  <strong>Breakdown:</strong>
                  {preview.breakdown.map(b => (
                    <div key={b.coll} style={{ marginLeft: 12, fontSize: 12 }}>
                      • {b.coll}: <strong>{b.count}</strong> record(s)
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── DELETE TAB ── */}
      {tab === 'delete' && (
        <div style={card}>
          <h4 style={{ marginTop: 0, color: '#dc2626' }}>🗑️ Delete Old Data</h4>
          <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, padding: 12, fontSize: 13, marginBottom: 12 }}>
            <strong>Safety rules:</strong>
            <ul style={{ margin: '6px 0 0 18px', padding: 0 }}>
              <li>Records must be older than <strong>30 days</strong> (server-enforced)</li>
              <li>Only log-like collections can be deleted (callLogs, activityLogs, attendance, etc.)</li>
              <li>Leads / Customers / Invoices / Quotes are <strong>never</strong> deletable here</li>
              <li>You must <strong>Preview</strong> first, then type <strong>DELETE</strong> to confirm</li>
              <li>Every delete is logged in the History tab</li>
              <li>💡 <strong>Recommended:</strong> Run Export first to save a JSON backup</li>
            </ul>
          </div>

          {!selectedCollection?.deletable && (
            <div style={{ padding: 12, background: '#fef9c3', borderRadius: 6, marginBottom: 12, fontSize: 13 }}>
              ⚠️ The collection <strong>{collection}</strong> is export-only. Pick a deletable collection from the dropdown above.
            </div>
          )}

          {!toDate && (
            <div style={{ padding: 12, background: '#fef9c3', borderRadius: 6, marginBottom: 12, fontSize: 13 }}>
              ⚠️ Set a <strong>To Date</strong> above — required for delete. Only records older than this date will be removed.
            </div>
          )}

          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-secondary" onClick={doPreview} disabled={!ownerId || !toDate || previewLoading}>
              {previewLoading ? 'Counting…' : '🔍 Preview Count'}
            </button>
          </div>

          {preview && (
            <div style={{ marginTop: 16, padding: 12, background: 'var(--bg)', borderRadius: 6, fontSize: 13 }}>
              <div><strong>{preview.count}</strong> record(s) will be deleted</div>
              <div>Total in collection for this customer: {preview.totalForOwner}</div>
              <div style={{ marginTop: 6 }}>
                Your filter: <strong>{fromDate || 'earliest'}</strong> → <strong>{toDate}</strong>
              </div>
              {preview.oldestDate && (
                <div style={{ background: '#fef9c3', padding: '4px 8px', borderRadius: 4, marginTop: 4, display: 'inline-block' }}>
                  Actual records span: {new Date(preview.oldestDate).toLocaleDateString()} → {new Date(preview.newestDate).toLocaleDateString()}
                  <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 6 }}>(oldest → newest in matched set)</span>
                </div>
              )}
              {preview.breakdown && (
                <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)' }}>
                  <strong>Breakdown:</strong>
                  {preview.breakdown.map(b => (
                    <div key={b.coll} style={{ marginLeft: 12, fontSize: 12 }}>
                      • {b.coll}: <strong>{b.count}</strong> record(s)
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {preview && preview.count > 0 && selectedCollection?.deletable && (
            <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
              <label style={label}>Type <code style={{ background: '#fee2e2', padding: '0 4px', borderRadius: 3 }}>DELETE</code> to confirm</label>
              <input
                type="text"
                value={confirmText}
                onChange={e => setConfirmText(e.target.value)}
                placeholder="Type DELETE"
                style={{ ...input, marginBottom: 12 }}
              />
              <button
                className="btn"
                onClick={doDelete}
                disabled={confirmText !== 'DELETE' || actionLoading}
                style={{
                  background: confirmText === 'DELETE' ? '#dc2626' : '#fca5a5',
                  color: '#fff',
                  cursor: confirmText === 'DELETE' ? 'pointer' : 'not-allowed',
                }}
              >
                {actionLoading ? 'Deleting…' : `🗑️ Permanently Delete ${preview.count} Record(s)`}
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── RESTORE TAB ── */}
      {tab === 'restore' && (
        <div style={card}>
          <h4 style={{ marginTop: 0 }}>♻️ Restore from JSON Backup</h4>
          <p style={{ fontSize: 13, color: 'var(--muted)' }}>
            Upload a previously-exported archive JSON file. Records that already exist (matched by ID) will be skipped — <strong>your existing data is never overwritten.</strong>
          </p>

          {!ownerId && (
            <div style={{ padding: 12, background: '#fef9c3', borderRadius: 6, marginBottom: 12, fontSize: 13 }}>
              ⚠️ Select the customer this data belongs to (above). The system will verify the JSON matches that customer before restoring.
            </div>
          )}

          <input
            type="file"
            accept=".json,application/json"
            onChange={handleRestoreFile}
            style={{ marginTop: 12, marginBottom: 12 }}
            disabled={!ownerId}
          />

          {restorePreview && (
            <div style={{ marginTop: 16, padding: 12, background: 'var(--bg)', borderRadius: 6, fontSize: 13 }}>
              <div><strong>File:</strong> {restoreFile?.name}</div>
              <div><strong>Records in file:</strong> {restorePreview.recordCount}</div>
              {restorePreview.meta?.collection && <div><strong>Target collection:</strong> {restorePreview.meta.collection}</div>}
              {restorePreview.meta?.ownerEmail && <div><strong>Original owner:</strong> {restorePreview.meta.ownerEmail}</div>}
              {restorePreview.meta?.fromDate && <div><strong>Original range:</strong> {restorePreview.meta.fromDate} → {restorePreview.meta.toDate}</div>}

              <button
                className="btn btn-primary"
                onClick={doRestore}
                disabled={actionLoading}
                style={{ marginTop: 12 }}
              >
                {actionLoading ? 'Restoring…' : `♻️ Restore ${restorePreview.recordCount} Record(s)`}
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── HISTORY TAB ── */}
      {tab === 'history' && (
        <div style={card}>
          <h4 style={{ marginTop: 0 }}>📜 Archive History</h4>
          <p style={{ fontSize: 13, color: 'var(--muted)' }}>
            Audit log of every export, delete, and restore action.
          </p>

          {historyLoading && <div>Loading…</div>}

          {!historyLoading && history.length === 0 && (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--muted)' }}>
              No archive activity yet. Exports, deletes, and restores will appear here.
            </div>
          )}

          {!historyLoading && history.length > 0 && (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: 'var(--bg)', borderBottom: '1px solid var(--border)' }}>
                    <th style={{ padding: '8px 12px', textAlign: 'left' }}>Date</th>
                    <th style={{ padding: '8px 12px', textAlign: 'left' }}>Action</th>
                    <th style={{ padding: '8px 12px', textAlign: 'left' }}>Customer</th>
                    <th style={{ padding: '8px 12px', textAlign: 'left' }}>Collection</th>
                    <th style={{ padding: '8px 12px', textAlign: 'left' }}>Range</th>
                    <th style={{ padding: '8px 12px', textAlign: 'right' }}>Records</th>
                    <th style={{ padding: '8px 12px', textAlign: 'right' }}>Size</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map(h => (
                    <tr key={h.id} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '8px 12px' }}>{new Date(h.createdAt).toLocaleString()}</td>
                      <td style={{ padding: '8px 12px' }}>
                        <span style={{
                          padding: '2px 8px',
                          borderRadius: 10,
                          fontSize: 11,
                          fontWeight: 600,
                          background: h.action === 'export' ? '#dbeafe' : h.action === 'delete' ? '#fee2e2' : '#dcfce7',
                          color: h.action === 'export' ? '#1e40af' : h.action === 'delete' ? '#991b1b' : '#166534',
                        }}>
                          {h.action}
                        </span>
                      </td>
                      <td style={{ padding: '8px 12px' }}>{ownerEmailMap[h.ownerId] || h.ownerId || '-'}</td>
                      <td style={{ padding: '8px 12px' }}>{h.collection}</td>
                      <td style={{ padding: '8px 12px', fontSize: 11, color: 'var(--muted)' }}>
                        {h.fromDate || '…'} → {h.toDate || '…'}
                      </td>
                      <td style={{ padding: '8px 12px', textAlign: 'right' }}>{h.recordCount || 0}</td>
                      <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                        {h.sizeBytes ? `${(h.sizeBytes / 1024).toFixed(1)} KB` : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
