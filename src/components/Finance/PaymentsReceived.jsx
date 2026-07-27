import React, { useMemo, useState } from 'react';
import db from '../../instant';
import { fmt, fmtD } from '../../utils/helpers';
import { parseDateValue } from '../../../api/_shared-dates';
import { useToast } from '../../context/ToastContext';

// Every payment received, across all invoices, in one list.
//
// Payments live inside invoice.payments rather than in their own collection, so
// this flattens them out. That keeps a receipt attached to the invoice it
// settles (no orphan risk, per CLAUDE.md) at the cost of reading invoices to
// list payments — acceptable because invoices are a small collection, unlike
// leads or call logs.
export default function PaymentsReceived({ ownerId, perms }) {
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [modeFilter, setModeFilter] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 25;

  const { data, isLoading } = db.useQuery({
    invoices: { $: { where: { userId: ownerId } } },
    userProfiles: { $: { where: { userId: ownerId } } },
  });
  const profile = data?.userProfiles?.[0] || {};
  const invoices = data?.invoices || [];

  // Flatten invoice.payments into receipt rows, newest first.
  const rows = useMemo(() => {
    const out = [];
    for (const inv of invoices) {
      const pays = Array.isArray(inv.payments) ? inv.payments
        : (inv.payments ? (() => { try { return JSON.parse(inv.payments); } catch { return []; } })() : []);
      pays.forEach((p, i) => {
        out.push({
          key: `${inv.id}-${p.no || i}`,
          no: p.no || '',
          // Legacy payments stored the date as epoch ms; parseDateValue reads
          // both that and the 'YYYY-MM-DD' written since.
          at: parseDateValue(p.date) ?? 0,
          rawDate: p.date,
          amount: Number(p.amount) || 0,
          mode: p.mode || '',
          reference: p.reference || '',
          notes: p.notes || '',
          client: inv.client || '',
          invoiceNo: inv.no || '',
          currency: inv.currency || 'INR',
          invoice: inv,
          payment: p,
        });
      });
    }
    return out.sort((a, b) => b.at - a.at);
  }, [invoices]);

  const modes = useMemo(
    () => [...new Set(rows.map(r => r.mode).filter(Boolean))].sort(),
    [rows]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(r => {
      if (modeFilter && r.mode !== modeFilter) return false;
      if (!q) return true;
      return `${r.no} ${r.client} ${r.invoiceNo} ${r.reference}`.toLowerCase().includes(q);
    });
  }, [rows, search, modeFilter]);

  const total = useMemo(() => filtered.reduce((a, r) => a + r.amount, 0), [filtered]);
  const paged = useMemo(
    () => filtered.slice((page - 1) * pageSize, page * pageSize),
    [filtered, page]
  );
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));

  const download = async (row) => {
    try {
      const { downloadPaymentReceipt } = await import('./PaymentReceiptPdf');
      await downloadPaymentReceipt({ payment: row.payment, invoice: row.invoice, profile });
    } catch { toast('Could not generate the receipt', 'error'); }
  };

  return (
    <div>
      <div className="sh">
        <div>
          <h2>Payments Received</h2>
          <div className="sub">Every payment recorded against an invoice</div>
        </div>
      </div>

      <div className="stat-grid">
        <div className="stat-card sc-green">
          <div className="lbl">Total Received</div>
          <div className="val">{fmt(total)}</div>
        </div>
        <div className="stat-card sc-blue">
          <div className="lbl">Payments</div>
          <div className="val">{filtered.length}</div>
        </div>
      </div>

      <div className="tw">
        <div className="tw-head" style={{ gap: 10 }}>
          <h3>All Received Payments</h3>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
              placeholder="Search receipt, client, invoice, reference…"
              style={{ fontSize: 12, padding: '6px 10px', minWidth: 240 }}
            />
            <select value={modeFilter} onChange={e => { setModeFilter(e.target.value); setPage(1); }} style={{ fontSize: 12, padding: '6px 10px' }}>
              <option value="">All modes</option>
              {modes.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
        </div>

        <div className="tw-scroll">
          <table>
            <thead>
              <tr>
                <th>Date</th><th>Receipt #</th><th>Customer</th><th>Invoice #</th>
                <th>Mode</th><th>Reference</th><th style={{ textAlign: 'right' }}>Amount</th><th></th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td colSpan={8} style={{ textAlign: 'center', padding: 24, color: 'var(--muted)' }}>Loading…</td></tr>}
              {!isLoading && paged.map(r => (
                <tr key={r.key}>
                  <td>{r.at ? fmtD(new Date(r.at).toISOString().slice(0, 10)) : '—'}</td>
                  {/* Payments recorded before receipts had numbers show a dash
                      rather than a fabricated one. */}
                  <td><strong>{r.no || '—'}</strong></td>
                  <td>{r.client || '—'}</td>
                  <td>{r.invoiceNo || '—'}</td>
                  <td>{r.mode || '—'}</td>
                  <td style={{ color: 'var(--muted)' }}>{r.reference || '—'}</td>
                  <td style={{ textAlign: 'right', fontWeight: 700, color: '#16a34a' }}>{fmt(r.amount, r.currency)}</td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="btn btn-secondary btn-sm" onClick={() => download(r)} title="Download receipt">PDF</button>
                  </td>
                </tr>
              ))}
              {!isLoading && filtered.length === 0 && (
                <tr><td colSpan={8} style={{ textAlign: 'center', padding: 28, color: 'var(--muted)' }}>
                  {rows.length === 0 ? 'No payments recorded yet' : 'No payments match this filter'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>

        {pages > 1 && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8, padding: '10px 16px' }}>
            <button className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Prev</button>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>Page {page} of {pages}</span>
            <button className="btn btn-secondary btn-sm" disabled={page >= pages} onClick={() => setPage(p => p + 1)}>Next</button>
          </div>
        )}
      </div>
    </div>
  );
}
