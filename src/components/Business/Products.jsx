import React, { useState, useRef, useMemo, useEffect } from 'react';
import { dbWrite, dbOp } from '../../utils/dbWrite';
import db from '../../instant';
import { id } from '@instantdb/react';
import { fmt, stageBadgeClass, DEFAULT_UNITS, SUPPORTED_CURRENCIES, currencySymbol } from '../../utils/helpers';
import { useToast } from '../../context/ToastContext';
import StockLog from './StockLog';

const EMPTY = { name: '', code: '', hsn: '', type: 'Product', category: 'General', unit: 'Nos', rate: '', purchasePrice: '', tax: 18, desc: '', stock: 0, lowStockThreshold: 5, trackStock: true, listInEcom: false, isPartnerAvailable: false, imageUrl: '', description: '', currency: 'INR' };
const generateSKU = () => 'P-' + Math.random().toString(36).substring(2, 8).toUpperCase();

const CSV_HEADERS = ['Name', 'Code', 'HSN', 'Category', 'Type', 'Unit', 'Rate', 'PurchasePrice', 'Tax', 'Stock', 'LowStockThreshold', 'TrackStock', 'Description', 'ListInEcom', 'ImageUrl', 'FullDescription'];

function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.trim());
  return lines.slice(1).map(line => {
    const vals = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''));
    const row = {};
    headers.forEach((h, i) => { row[h] = vals[i] || ''; });
    return row;
  }).filter(r => r['Name']);
}

function downloadCSVTemplate() {
  const sampleRow = ['LED Bulb 9W', 'SKU-001', '85395000', 'Electronics', 'Product', 'Nos', '250', '150', '18', '100', '10', 'true', 'Energy efficient LED bulb', 'false', 'https://example.com/image.jpg', 'High efficiency LED bulb - saves 80% energy'];
  const csv = [CSV_HEADERS.join(','), sampleRow.join(',')].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'products_template.csv'; a.click();
  URL.revokeObjectURL(url);
}

export default function Products({ user, perms, ownerId, planEnforcement }) {
  const canCreate = perms?.can('Products', 'create') === true;
  const canEdit = perms?.can('Products', 'edit') === true;
  const canDelete = perms?.can('Products', 'delete') === true;

  const [modal, setModal] = useState(false);
  const [editData, setEditData] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [stockModal, setStockModal] = useState(null);
  const [adjustForm, setAdjustForm] = useState({ delta: 0, reason: 'Purchase' });
  const [showLog, setShowLog] = useState(null);
  const [bulkModal, setBulkModal] = useState(false);
  const [csvPreview, setCsvPreview] = useState([]);
  const [importing, setImporting] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const fileRef = useRef();
  const toast = useToast();

  // Only products + profile needed for the list. The migration backfill
  // (amcs/invoices/quotes/purchaseOrders) loaded 4 large collections on every
  // page open — moved to a lazy fetch inside the migration effect instead.
  const { data } = db.useQuery({
    products: { $: { where: { userId: ownerId } } },
    userProfiles: { $: { where: { userId: ownerId } } }
  });
  const products = data?.products || [];
  const profile = data?.userProfiles?.[0] || {};
  const productCats = profile.productCats || ['Electronics', 'Home Appliances', 'Services', 'Furniture', 'General'];
  const taxRates = profile.taxRates || [{ label: 'None (0%)', rate: 0 }, { label: 'GST @ 5%', rate: 5 }, { label: 'GST @ 12%', rate: 12 }, { label: 'GST @ 18%', rate: 18 }, { label: 'GST @ 28%', rate: 28 }];
  const productUnits = profile.productUnits || DEFAULT_UNITS;
  
  const [search, setSearch] = useState('');
  const filtered = useMemo(() => {
    return products.filter(p => {
      if (!search) return true;
      const q = search.toLowerCase();
      return [p.name, p.code, p.type, p.unit, p.desc].some(v => String(v || '').toLowerCase().includes(q));
    }).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)); // newest first
  }, [products, search]);

  const totalPages = pageSize === 'all' ? 1 : Math.ceil(filtered.length / pageSize);
  const paginated = useMemo(() => {
    if (pageSize === 'all') return filtered;
    const start = (currentPage - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, currentPage, pageSize]);

  useEffect(() => { setCurrentPage(1); }, [search, pageSize]);
  
  // Migration: backfill productId/sku on related records. Runs once per session
  // after products load; fetches the heavy collections lazily so the Products
  // list doesn't wait for 4 extra queries on every page open.
  useEffect(() => {
    if (!data?.products || !data.products.length) return;
    if (window._migDone) return;
    window._migDone = true;

    const db2 = db; // same client, queried imperatively
    const productsByName = Object.fromEntries(products.map(p => [p.name, p]));

    (async () => {
      const txs = [];
      const { amcs, invoices, quotes, purchaseOrders } = (await db2.queryOnce({
        amcs:           { $: { where: { userId: ownerId } } },
        invoices:       { $: { where: { userId: ownerId } } },
        quotes:         { $: { where: { userId: ownerId } } },
        purchaseOrders: { $: { where: { userId: ownerId } } },
      }));

      (amcs || []).filter(a => !a.productId).forEach(a => {
        const p = productsByName[a.plan];
        if (p) txs.push(dbOp.update('amc', a.id, { productId: p.id, sku: p.code }));
      });
      (invoices || []).forEach(inv => {
        const rawItems = Array.isArray(inv.items) ? inv.items : JSON.parse(inv.items || '[]');
        let changed = false;
        const items = rawItems.map(it => { if (!it.productId && productsByName[it.name]) { changed = true; const p = productsByName[it.name]; return { ...it, productId: p.id, sku: p.code }; } return it; });
        if (changed) txs.push(dbOp.update('invoices', inv.id, { items: Array.isArray(inv.items) ? items : JSON.stringify(items) }));
      });
      (quotes || []).forEach(q => {
        const rawItems = Array.isArray(q.items) ? q.items : JSON.parse(q.items || '[]');
        let changed = false;
        const items = rawItems.map(it => { if (!it.productId && productsByName[it.name]) { changed = true; const p = productsByName[it.name]; return { ...it, productId: p.id, sku: p.code }; } return it; });
        if (changed) txs.push(dbOp.update('quotes', q.id, { items: Array.isArray(q.items) ? items : JSON.stringify(items) }));
      });
      (purchaseOrders || []).forEach(po => {
        let changed = false;
        const items = (po.items || []).map(it => { if (!it.productId && productsByName[it.name]) { changed = true; const p = productsByName[it.name]; return { ...it, productId: p.id, sku: p.code }; } return it; });
        if (changed) txs.push(dbOp.update('purchaseOrders', po.id, { items }));
      });

      for (let i = 0; i < txs.length; i += 25) dbWrite(txs.slice(i, i + 25));
    })().catch(() => { window._migDone = false; }); // retry next session on error
  }, [!!data?.products?.length]);

  const f = (k) => (e) => setForm(p => ({ ...p, [k]: e.target.value }));

  const margin = (rate, purchase) => {
    const r = parseFloat(rate) || 0;
    const p = parseFloat(purchase) || 0;
    if (!p || !r) return null;
    return Math.round(((r - p) / r) * 100);
  };

  const save = async () => {
    if (editData && !canEdit) { toast('Permission denied: cannot edit products', 'error'); return; }
    if (!editData && !canCreate) { toast('Permission denied: cannot create products', 'error'); return; }
    if (!editData && planEnforcement && !planEnforcement.isWithinLimit('maxProducts', products.length)) { toast('Product limit reached for your plan. Please upgrade.', 'error'); return; }
    if (!form.name.trim()) { toast('Name required', 'error'); return; }

    const sku = form.code?.trim();
    if (sku) {
      const isDuplicate = products.some(p => p.code?.trim().toLowerCase() === sku.toLowerCase() && p.id !== editData?.id);
      if (isDuplicate) { toast(`Item Code "${sku}" is already in use in your business`, 'error'); return; }
    }

    const payload = { 
      ...form, 
      rate: parseFloat(form.rate) || 0, 
      purchasePrice: parseFloat(form.purchasePrice) || 0,
      tax: parseFloat(form.tax) || 0, 
      stock: parseFloat(form.stock) || 0,
      lowStockThreshold: parseFloat(form.lowStockThreshold) || 5,
      isPartnerAvailable: !!form.isPartnerAvailable,
      hsn: (form.hsn || '').trim(),
      userId: ownerId 
    };
    if (!payload.code) payload.code = '';
    if (editData) { await dbWrite(dbOp.update('products', editData.id, payload)); toast('Updated', 'success'); }
    else { await dbWrite(dbOp.update('products', id(), payload)); toast('Product created', 'success'); }
    setModal(false);
  };

  const adjustStock = async () => {
    if (!stockModal) return;
    const delta = parseFloat(adjustForm.delta) || 0;
    if (delta === 0) return;
    const newStock = (stockModal.stock || 0) + delta;
    const txs = [
      dbOp.update('products', stockModal.id, { stock: newStock }),
      dbOp.update('activityLogs', id(), {
        entityId: stockModal.id, entityType: 'product',
        text: `Stock adjusted by ${delta > 0 ? '+' : ''}${delta} (${adjustForm.reason}). New stock: ${newStock}`,
        userId: ownerId, actorId: user.id, userName: user.email, createdAt: Date.now()
      })
    ];
    await dbWrite(txs);
    toast('Stock updated', 'success');
    setStockModal(null);
    setAdjustForm({ delta: 0, reason: 'Purchase' });
  };

  const del = async (pid) => { 
    if (!canDelete) { toast('Permission denied: cannot delete products', 'error'); return; }
    if (!confirm('Delete?')) return; 
    await dbWrite(dbOp.delete('products', pid)); 
    toast('Deleted', 'error'); 
  };

  const handleCSVFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const rows = parseCSV(ev.target.result);
      setCsvPreview(rows);
    };
    reader.readAsText(file);
  };

  const bulkEcomAction = async (enable) => {
    if (selectedIds.size === 0) return toast('Select products first', 'error');
    const txs = [...selectedIds].map(pid => dbOp.update('products', pid, { listInEcom: enable }));
    await dbWrite(txs);
    toast(`${selectedIds.size} products ${enable ? 'added to' : 'removed from'} E-com store`, 'success');
    setSelectedIds(new Set());
  };

  const toggleSelect = (pid) => setSelectedIds(prev => {
    const next = new Set(prev);
    if (next.has(pid)) next.delete(pid); else next.add(pid);
    return next;
  });

  const toggleSelectAll = () => {
    if (selectedIds.size === paginated.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(paginated.map(p => p.id)));
  };

  const importCSV = async () => {
    if (!csvPreview.length) return;
    setImporting(true);
    try {
      const txs = csvPreview.map(row => {
        const newId = id();
        return dbOp.update('products', newId, {
          name: row['Name'] || '',
          category: row['Category'] || 'General',
          type: row['Type'] || 'Product',
          unit: row['Unit'] || 'Nos',
          rate: parseFloat(row['Rate']) || 0,
          purchasePrice: parseFloat(row['PurchasePrice']) || 0,
          tax: parseFloat(row['Tax']) || 18,
          stock: parseFloat(row['Stock']) || 0,
          lowStockThreshold: parseFloat(row['LowStockThreshold']) || 5,
          trackStock: String(row['TrackStock']).toLowerCase() !== 'false',
          desc: row['Description'] || '',
          listInEcom: String(row['ListInEcom']).toLowerCase() === 'true',
          isPartnerAvailable: String(row['ListInEcom']).toLowerCase() === 'true',
          imageUrl: row['ImageUrl'] || '',
          description: row['FullDescription'] || '',
          userId: ownerId,
          code: row['Code'] || '',
          hsn: row['HSN'] || ''
        });
      });
      // Batch in chunks of 25
      for (let i = 0; i < txs.length; i += 25) {
        await dbWrite(txs.slice(i, i + 25));
      }
      toast(`✅ Imported ${csvPreview.length} products successfully`, 'success');
      setBulkModal(false);
      setCsvPreview([]);
      if (fileRef.current) fileRef.current.value = '';
    } catch (err) {
      toast('Import failed: ' + err.message, 'error');
    } finally {
      setImporting(false);
    }
  };

  const handleExport = () => {
    if (filtered.length === 0) return toast('No products to export', 'error');
    const headers = ['Name', 'Code', 'HSN/SAC', 'Category', 'Type', 'Unit', 'Purchase Price', 'Selling Rate', 'GST %', 'Stock', 'Low Stock Threshold', 'Description', 'ListInEcom', 'ImageUrl', 'FullDescription'];
    const escapeCSV = (val) => {
      if (val === null || val === undefined) return '';
      const str = String(val).replace(/"/g, '""');
      return str.includes(',') || str.includes('"') || str.includes('\n') ? `"${str}"` : str;
    };
    const rows = [headers.join(',')];
    filtered.forEach(p => {
      const row = [
        escapeCSV(p.name), escapeCSV(p.code), escapeCSV(p.hsn || ''), escapeCSV(p.category), escapeCSV(p.type),
        escapeCSV(p.unit), escapeCSV(p.purchasePrice), escapeCSV(p.rate), escapeCSV(p.tax),
        escapeCSV(p.stock), escapeCSV(p.lowStockThreshold), escapeCSV(p.desc),
        escapeCSV(p.listInEcom || false), escapeCSV(p.imageUrl || ''), escapeCSV(p.description || '')
      ];
      rows.push(row.join(','));
    });
    const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `products_export_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    toast('Export successful!', 'success');
  };

  return (
    <div>
      <div className="sh">
        <div><h2>Products &amp; Services</h2></div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {selectedIds.size > 0 && (
            <>
              <span style={{ fontSize: 12, color: 'var(--muted)', alignSelf: 'center' }}>{selectedIds.size} selected</span>
              <button className="btn btn-secondary btn-sm" style={{ background: '#ecfdf5', color: '#065f46', border: '1px solid #6ee7b7' }} onClick={() => bulkEcomAction(true)}>🛒 Add to E-com</button>
              <button className="btn btn-secondary btn-sm" style={{ background: '#fef2f2', color: '#991b1b', border: '1px solid #fca5a5' }} onClick={() => bulkEcomAction(false)}>Remove from E-com</button>
            </>
          )}
          <button className="btn btn-secondary btn-sm" onClick={handleExport}>📊 Export CSV</button>
          {canCreate && <button className="btn btn-secondary btn-sm" onClick={() => setBulkModal(true)}>📤 Bulk Upload</button>}
          {canCreate && <button className="btn btn-primary btn-sm" onClick={() => { setEditData(null); setForm({ ...EMPTY, currency: profile?.defaultCurrency || 'INR' }); setModal(true); }}>+ Create</button>}
        </div>
      </div>
      <div className="tw">
        <div className="tw-head">
          <h3>Products &amp; Services ({filtered.length})</h3>
          <div className="sw">
            <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
            <input className="si" placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>

        {/* Top Pagination & Show Dropdown */}
        <div style={{ padding: '8px 25px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)', background: 'var(--bg-soft)', gap: 15 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
            <span style={{ color: 'var(--muted)', fontWeight: 600 }}>Show</span>
            <select 
              style={{ border: '1px solid var(--border)', background: 'var(--surface)', fontWeight: 700, outline: 'none', cursor: 'pointer', color: 'var(--accent)', padding: '2px 4px', borderRadius: 4, fontSize: 11 }}
              value={pageSize}
              onChange={e => setPageSize(parseInt(e.target.value, 10))}
            >
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
              <option value={500}>500</option>
            </select>
          </div>

          {pageSize !== 'all' && totalPages > 1 && (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <button 
                className="btn btn-secondary btn-sm" 
                disabled={currentPage === 1}
                onClick={() => setCurrentPage(prev => prev - 1)}
                style={{ padding: '2px 8px', fontSize: 11 }}
              >
                Prev
              </button>
              <div style={{ display: 'flex', gap: 4 }}>
                {[...Array(totalPages)].map((_, i) => {
                  const page = i + 1;
                  if (Math.abs(currentPage - page) > 1 && page !== 1 && page !== totalPages) return null;
                  return (
                    <React.Fragment key={page}>
                      {page === totalPages && Math.abs(currentPage - page) > 2 && <span style={{ color: 'var(--muted)', fontSize: 10 }}>...</span>}
                      <button 
                        className={`btn btn-sm ${currentPage === page ? 'btn-primary' : 'btn-secondary'}`}
                        style={{ minWidth: 26, height: 26, padding: 0, fontSize: 11 }}
                        onClick={() => setCurrentPage(page)}
                      >
                        {page}
                      </button>
                      {page === 1 && Math.abs(currentPage - page) > 2 && <span style={{ color: 'var(--muted)', fontSize: 10 }}>...</span>}
                    </React.Fragment>
                  );
                })}
              </div>
              <button 
                className="btn btn-secondary btn-sm" 
                disabled={currentPage === totalPages}
                onClick={() => setCurrentPage(prev => prev + 1)}
                style={{ padding: '2px 8px', fontSize: 11 }}
              >
                Next
              </button>
            </div>
          )}
        </div>

        <div className="tw-scroll">
          <table>
            <thead><tr>
              <th><input type="checkbox" checked={paginated.length > 0 && selectedIds.size === paginated.length} onChange={toggleSelectAll} /></th>
              <th>#</th><th>Name</th><th>Category</th><th>Code</th><th>HSN/SAC</th><th>Stock</th><th>Unit</th><th>Purchase Price</th><th>Selling Rate</th><th>GST %</th><th>E-com</th><th>Partners</th><th>Actions</th>
            </tr></thead>
            <tbody>
              {paginated.length === 0 ? <tr><td colSpan={12} style={{ textAlign: 'center', padding: 28, color: 'var(--muted)' }}>No products found.</td></tr>
                : paginated.map((p, i) => (
                  <React.Fragment key={p.id}>
                    <tr style={{ background: selectedIds.has(p.id) ? 'rgba(99,102,241,0.05)' : undefined }}>
                      <td><input type="checkbox" checked={selectedIds.has(p.id)} onChange={() => toggleSelect(p.id)} /></td>
                      <td style={{ color: 'var(--muted)', fontSize: 11 }}>{(currentPage - 1) * (pageSize === 'all' ? 0 : pageSize) + i + 1}</td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          {p.imageUrl && <img src={p.imageUrl} alt="" style={{ width: 32, height: 32, objectFit: 'cover', borderRadius: 4, border: '1px solid var(--border)' }} onError={e => e.target.style.display='none'} />}
                          <div>
                            <strong>{p.name}</strong>
                            <div style={{ fontSize: 10, color: 'var(--muted)' }}>{p.desc}</div>
                          </div>
                        </div>
                      </td>
                      <td><span style={{ fontSize: 11, background: 'var(--bg-soft)', padding: '2px 8px', borderRadius: 4 }}>{p.category || 'General'}</span></td>
                      <td style={{ fontSize: 12, fontFamily: 'monospace' }}>{p.code || '-'}</td>
                      <td style={{ fontSize: 11, fontFamily: 'monospace', color: p.hsn ? '#334155' : 'var(--muted)' }}>{p.hsn || '—'}</td>
                      <td>
                        {p.trackStock ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span className={`badge ${p.stock <= 0 ? 'bg-red' : p.stock <= (p.lowStockThreshold || 5) ? 'bg-yellow' : 'bg-green'}`}>
                              {p.stock} {p.unit}
                            </span>
                            <button className="btn-icon btn-sm" style={{ background: 'var(--bg-soft)', fontSize: 10, padding: '2px 6px' }} onClick={() => { setStockModal(p); setAdjustForm({ delta: 0, reason: 'Purchase' }); }} title="Adjust Stock">±</button>
                          </div>
                        ) : <span style={{ color: 'var(--muted)', fontSize: 11 }}>Service</span>}
                      </td>
                      <td style={{ fontSize: 12 }}>{p.unit}</td>
                      <td style={{ fontSize: 12, color: 'var(--muted)' }}>{p.purchasePrice ? fmt(p.purchasePrice, p.currency) : '—'}</td>
                      <td>
                        <div style={{ fontWeight: 700 }}>{fmt(p.rate, p.currency)}</div>
                        {(() => { const m = margin(p.rate, p.purchasePrice); return m !== null ? <div style={{ fontSize: 10, color: m >= 0 ? '#16a34a' : '#dc2626' }}>{m >= 0 ? '▲' : '▼'} {Math.abs(m)}% margin</div> : null; })()}
                      </td>
                      <td>{p.tax}%</td>
                      <td>
                        <button
                          onClick={() => dbWrite(dbOp.update('products', p.id, { listInEcom: !p.listInEcom }))}
                          style={{ background: p.listInEcom ? '#ecfdf5' : 'var(--bg-soft)', color: p.listInEcom ? '#065f46' : 'var(--muted)', border: `1px solid ${p.listInEcom ? '#6ee7b7' : 'var(--border)'}`, borderRadius: 6, padding: '3px 10px', fontSize: 11, cursor: 'pointer', fontWeight: 600 }}
                          title={p.listInEcom ? 'Listed in E-com Store' : 'Not listed in E-com'}
                        >
                          {p.listInEcom ? '🛒 Live' : '+ Add'}
                        </button>
                      </td>
                      <td>
                        <button
                          onClick={() => dbWrite(dbOp.update('products', p.id, { isPartnerAvailable: !p.isPartnerAvailable }))}
                          style={{ background: p.isPartnerAvailable ? '#eff6ff' : 'var(--bg-soft)', color: p.isPartnerAvailable ? '#1d4ed8' : 'var(--muted)', border: `1px solid ${p.isPartnerAvailable ? '#93c5fd' : 'var(--border)'}`, borderRadius: 6, padding: '3px 10px', fontSize: 11, cursor: 'pointer', fontWeight: 600 }}
                          title={p.isPartnerAvailable ? 'Available to Partners' : 'Hidden from Partners'}
                        >
                          {p.isPartnerAvailable ? '🤝 Enabled' : 'Off'}
                        </button>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 4 }}>
                          {canEdit && <button className="btn btn-secondary btn-sm" onClick={() => { setEditData(p); setForm({ name: p.name, code: p.code || '', hsn: p.hsn || '', type: p.type, category: p.category || 'General', unit: p.unit, rate: p.rate, purchasePrice: p.purchasePrice || '', tax: p.tax, desc: p.desc || '', stock: p.stock || 0, lowStockThreshold: p.lowStockThreshold || 5, trackStock: p.trackStock !== false, listInEcom: p.listInEcom || false, isPartnerAvailable: p.isPartnerAvailable || false, imageUrl: p.imageUrl || '', description: p.description || '', currency: p.currency || profile?.defaultCurrency || 'INR' }); setModal(true); }}>Edit</button>}
                          {p.trackStock && <button className="btn btn-secondary btn-sm" onClick={() => setShowLog(showLog === p.id ? null : p.id)}>History</button>}
                          {canDelete && <button className="btn btn-sm" style={{ background: '#fee2e2', color: '#991b1b' }} onClick={() => del(p.id)}>Del</button>}
                        </div>
                      </td>
                    </tr>
                    {showLog === p.id && (
                      <tr key={`${p.id}-log`}>
                        <td colSpan={10} style={{ padding: 0, background: 'var(--bg-soft)' }}>
                          <div style={{ padding: 15, border: '1px solid var(--border)', margin: '10px 15px', borderRadius: 8, background: '#fff' }}>
                            <StockLog productId={p.id} ownerId={ownerId} productName={p.name} />
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create/Edit Modal */}
      {modal && (
        <div className="mo open">
          <div className="mo-box">
            <div className="mo-head"><h3>{editData ? 'Edit' : 'Create'} Product/Service</h3><button className="btn-icon" onClick={() => setModal(false)}>✕</button></div>
            <div className="mo-body">
              <div className="fgrid">
                <div className="fg span2"><label>Name *</label><input value={form.name} onChange={f('name')} /></div>
                <div className="fg"><label>Item Code</label><input value={form.code} onChange={f('code')} placeholder="SKU-001" /></div>
                <div className="fg"><label>HSN/SAC Code <span style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 400 }}>(Optional - for GST filing)</span></label><input value={form.hsn} onChange={f('hsn')} placeholder="e.g. 85395000" /></div>
                <div className="fg"><label>Category</label>
                  <select value={form.category} onChange={f('category')}>
                    {productCats.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div className="fg"><label>Type</label><select value={form.type} onChange={f('type')}>{['Service', 'Product'].map(s => <option key={s}>{s}</option>)}</select></div>
                <div className="fg"><label>Unit</label><select value={form.unit} onChange={f('unit')}>{productUnits.map(s => <option key={s}>{s}</option>)}</select></div>
                <div className="fg">
                  <label>Currency</label>
                  <select value={form.currency || 'INR'} onChange={f('currency')}>
                    {SUPPORTED_CURRENCIES.map(c => <option key={c.code} value={c.code}>{c.symbol} {c.code} — {c.name}</option>)}
                  </select>
                </div>
                <div className="fg"><label>Purchase Price ({currencySymbol(form.currency)})</label><input type="number" value={form.purchasePrice} onChange={f('purchasePrice')} placeholder="Cost price" /></div>
                <div className="fg"><label>Selling Rate ({currencySymbol(form.currency)})</label><input type="number" value={form.rate} onChange={f('rate')} /></div>
                {form.purchasePrice && form.rate && (() => { const m = margin(form.rate, form.purchasePrice); return m !== null ? <div className="fg" style={{ background: m >= 0 ? '#f0fdf4' : '#fff5f5', borderRadius: 8, padding: '10px 12px', display: 'flex', alignItems: 'center' }}><span style={{ fontSize: 13, color: m >= 0 ? '#16a34a' : '#dc2626', fontWeight: 700 }}>{m >= 0 ? '▲' : '▼'} Margin: {Math.abs(m)}%</span></div> : null; })()}
                <div className="fg"><label>GST %</label><select value={form.tax} onChange={f('tax')}>{taxRates.map(t => <option key={t.label} value={t.rate}>{t.label}</option>)}</select></div>
                <div className="fg span2" style={{ background: 'var(--bg-soft)', padding: 12, borderRadius: 8, marginTop: 5 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginBottom: form.trackStock ? 12 : 0 }}>
                    <input type="checkbox" checked={form.trackStock} onChange={e => {
                      const checked = e.target.checked;
                      setForm(p => ({ ...p, trackStock: checked, type: checked ? 'Product' : 'Service' }));
                    }} style={{ width: 16, height: 16 }} />
                    Track Inventory for this item
                  </label>
                  {form.trackStock && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 15 }}>
                      <div className="fg" style={{ marginBottom: 0 }}><label>Initial Stock</label><input type="number" value={form.stock} onChange={f('stock')} /></div>
                      <div className="fg" style={{ marginBottom: 0 }}><label>Low Stock Alert Level</label><input type="number" value={form.lowStockThreshold} onChange={f('lowStockThreshold')} /></div>
                    </div>
                  )}
                </div>
                <div className="fg span2"><label>Short Description</label><textarea value={form.desc} onChange={f('desc')} style={{ minHeight: 55 }} placeholder="Brief description (shown in product list)" /></div>
                
                <div className="fg span2" style={{ borderTop: '2px dashed var(--border)', paddingTop: 16, marginTop: 4 }}>
                  <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 12, color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: 6 }}>🛒 E-Commerce Settings</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', background: form.listInEcom ? '#ecfdf5' : 'var(--bg-soft)', padding: 12, borderRadius: 8, border: `1.5px solid ${form.listInEcom ? '#6ee7b7' : 'var(--border)'}` }}>
                        <input type="checkbox" checked={form.listInEcom} onChange={e => setForm(p => ({ ...p, listInEcom: e.target.checked }))} style={{ width: 18, height: 18 }} />
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 13 }}>List in E-commerce Store</div>
                          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>Public URL catalog</div>
                        </div>
                      </label>
                      
                      <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', background: form.isPartnerAvailable ? '#eff6ff' : 'var(--bg-soft)', padding: 12, borderRadius: 8, border: `1.5px solid ${form.isPartnerAvailable ? '#93c5fd' : 'var(--border)'}` }}>
                        <input type="checkbox" checked={form.isPartnerAvailable} onChange={e => setForm(p => ({ ...p, isPartnerAvailable: e.target.checked }))} style={{ width: 18, height: 18 }} />
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 13 }}>Enable for Channel Partners</div>
                          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>Distributors & Retailers can sell this</div>
                        </div>
                      </label>
                    </div>

                    <div className="fg" style={{ marginBottom: 0 }}>
                      <label>Product Image URL
                        <span style={{ fontSize: 10, color: 'var(--muted)', marginLeft: 8, fontWeight: 400 }}>Recommended: 800×800px, PNG/JPG, max 200KB</span>
                      </label>
                      <input value={form.imageUrl} onChange={f('imageUrl')} placeholder="https://example.com/product.jpg" />
                      {form.imageUrl && <img src={form.imageUrl} alt="Preview" style={{ marginTop: 8, width: 80, height: 80, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--border)' }} onError={e => e.target.style.display='none'} />}
                    </div>
                    <div className="fg" style={{ marginBottom: 0 }}>
                      <label>Full Product Description <span style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 400 }}>(shown on product detail page in store)</span></label>
                      <textarea value={form.description} onChange={f('description')} style={{ minHeight: 80 }} placeholder="Detailed product description, features, specifications..." />
                    </div>

                </div>
              </div>
            </div>
            <div className="mo-foot"><button className="btn btn-secondary btn-sm" onClick={() => setModal(false)}>Cancel</button><button className="btn btn-primary btn-sm" onClick={save}>Save</button></div>
          </div>
        </div>
      )}

      {/* Bulk Upload Modal */}
      {bulkModal && (
        <div className="mo open">
          <div className="mo-box" style={{ maxWidth: 750 }}>
            <div className="mo-head"><h3>📤 Bulk Product Upload (CSV)</h3><button className="btn-icon" onClick={() => { setBulkModal(false); setCsvPreview([]); }}>✕</button></div>
            <div className="mo-body" style={{ padding: 20 }}>
              <div style={{ background: 'var(--bg-soft)', padding: 14, borderRadius: 8, marginBottom: 18, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>Step 1: Download the template</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>Fill the CSV with your products, then upload below.</div>
                </div>
                <button className="btn btn-secondary btn-sm" onClick={downloadCSVTemplate}>⬇ Download Template</button>
              </div>
              <div style={{ marginBottom: 18 }}>
                <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Step 2: Upload your CSV file</div>
                <input ref={fileRef} type="file" accept=".csv" onChange={handleCSVFile} style={{ fontSize: 13 }} />
              </div>
              {csvPreview.length > 0 && (
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Step 3: Preview ({csvPreview.length} rows found)</div>
                  <div style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 6 }}>
                    <table style={{ fontSize: 11, width: '100%' }}>
                      <thead><tr style={{ background: 'var(--bg-soft)' }}><th style={{ padding: '6px 10px', textAlign: 'left' }}>Name</th><th style={{ padding: '6px 10px', textAlign: 'left' }}>Code</th><th style={{ padding: '6px 10px', textAlign: 'left' }}>Category</th><th style={{ padding: '6px 10px', textAlign: 'left' }}>Rate</th><th style={{ padding: '6px 10px', textAlign: 'left' }}>Purchase</th><th style={{ padding: '6px 10px', textAlign: 'left' }}>Stock</th></tr></thead>
                      <tbody>
                        {csvPreview.map((r, i) => (
                          <tr key={i} style={{ borderTop: '1px solid var(--bg-soft)' }}>
                            <td style={{ padding: '5px 10px' }}>{r['Name']}</td>
                            <td style={{ padding: '5px 10px', fontFamily: 'monospace' }}>{r['Code'] || '—'}</td>
                            <td style={{ padding: '5px 10px' }}>{r['Category']}</td>
                            <td style={{ padding: '5px 10px' }}>₹{r['Rate']}</td>
                            <td style={{ padding: '5px 10px' }}>₹{r['PurchasePrice'] || '—'}</td>
                            <td style={{ padding: '5px 10px' }}>{r['Stock']}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
            <div className="mo-foot">
              <button className="btn btn-secondary btn-sm" onClick={() => { setBulkModal(false); setCsvPreview([]); }}>Cancel</button>
              <button className="btn btn-primary btn-sm" onClick={importCSV} disabled={!csvPreview.length || importing}>
                {importing ? 'Importing...' : `Import ${csvPreview.length} Products`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Stock Adjust Modal */}
      {stockModal && (
        <div className="mo open">
          <div className="mo-box" style={{ width: 360 }}>
            <div className="mo-head"><h3>Adjust Stock</h3><button className="btn-icon" onClick={() => setStockModal(null)}>✕</button></div>
            <div className="mo-body" style={{ padding: 20 }}>
              <div style={{ background: 'var(--bg-soft)', padding: 12, borderRadius: 8, marginBottom: 20, textAlign: 'center' }}>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>Product</div>
                <div style={{ fontWeight: 700 }}>{stockModal.name}</div>
                <div style={{ fontSize: 13, marginTop: 8 }}>Current: <strong>{stockModal.stock} {stockModal.unit}</strong></div>
              </div>
              <div className="fgrid" style={{ gridTemplateColumns: '1fr' }}>
                <div className="fg">
                  <label>Adjustment (+ or -)</label>
                  <input type="number" value={adjustForm.delta} onChange={e => setAdjustForm(p => ({ ...p, delta: e.target.value }))} placeholder="e.g. 10 or -5" autoFocus />
                </div>
                <div className="fg">
                  <label>Reason</label>
                  <select value={adjustForm.reason} onChange={e => setAdjustForm(p => ({ ...p, reason: e.target.value }))}>
                    {['Purchase', 'Return', 'Damaged', 'Correction', 'Consumption'].map(r => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
              </div>
            </div>
            <div className="mo-foot">
              <button className="btn btn-secondary btn-sm" onClick={() => setStockModal(null)}>Cancel</button>
              <button className="btn btn-primary btn-sm" onClick={adjustStock}>Save Adjustment</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
