import React, { useState, useEffect, useRef } from 'react';
import db from '../../instant';
import { id as genId } from '@instantdb/react';
import { useToast } from '../../context/ToastContext';
import SheetIntegration from './SheetIntegration';
import IndiamartIntegration from './IndiamartIntegration';
import JustdialIntegration from './JustdialIntegration';
import TradeindiaIntegration from './TradeindiaIntegration';

const COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes

export default function Integrations({ user, ownerId }) {
  const toast = useToast();
  const [syncing, setSyncing] = useState(null);
  const [syncResults, setSyncResults] = useState(null);
  const [showConfig, setShowConfig] = useState(null);
  const [activeTab, setActiveTab] = useState('all');
  const [cooldownEnd, setCooldownEnd] = useState(() => {
    const stored = localStorage.getItem('tc_sync_cooldown');
    return stored ? parseInt(stored, 10) : 0;
  });
  const [cooldownLeft, setCooldownLeft] = useState(0);

  useEffect(() => {
    const tick = () => {
      const remaining = Math.max(0, cooldownEnd - Date.now());
      setCooldownLeft(remaining);
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [cooldownEnd]);

  const isCoolingDown = cooldownLeft > 0;
  const cooldownMinutes = Math.ceil(cooldownLeft / 60000);

  const { data } = db.useQuery({ 
    userProfiles: { $: { where: { userId: ownerId } } },
  });
  const profile = data?.userProfiles?.[0];
  const gsheets = profile?.gsheets || [];
  const indiamartConfigs = profile?.indiamart || [];
  const justdialConfigs = profile?.justdial || [];
  const tradeindiaConfigs = profile?.tradeindia || [];
  // leads fetched on-demand during sync via /api/lead-check-duplicate (avoids 11k+ subscription)

  const integrations = [
    {
      id: 'gsheets',
      name: 'Google Sheets',
      desc: 'Import leads directly from a shared Google Spreadsheet.',
      icon: '📊',
      connected: gsheets.length > 0,
      count: gsheets.length
    },
    {
      id: 'indiamart',
      name: 'IndiaMART',
      desc: 'Receive leads from IndiaMART enquiries automatically via webhook or manual sync.',
      icon: '🏭',
      connected: indiamartConfigs.length > 0,
      count: indiamartConfigs.length
    },
    {
      id: 'justdial',
      name: 'JustDial',
      desc: 'Capture JustDial leads via webhook in real-time.',
      icon: '📞',
      connected: justdialConfigs.length > 0,
      count: justdialConfigs.length
    },
    {
      id: 'tradeindia',
      name: 'TradeIndia',
      desc: 'Receive leads from TradeIndia enquiries automatically via webhook or manual sync.',
      icon: '🏢',
      connected: tradeindiaConfigs.length > 0,
      count: tradeindiaConfigs.length
    }
  ];

  const syncGoogleSheet = async (configIndex) => {
    if (isCoolingDown) {
      return toast(`Please wait ${cooldownMinutes} min before syncing again.`, 'warning');
    }
    const config = gsheets[configIndex];
    if (config?.disabled || profile?.gsheetsDisabled) {
      return toast('Integration is disabled. Please enable it first.', 'warning');
    }
    if (!config?.sheetId || !config?.mapping || !config?.columns) {
      return toast('Integration is not fully configured. Please edit and fetch columns first.', 'error');
    }

    setSyncing('gsheets');
    setSyncResults(null);

    try {
      const url = `https://docs.google.com/spreadsheets/d/${config.sheetId}/gviz/tq?tqx=out:json`;
      const res = await fetch(url);
      const text = await res.text();
      const json = JSON.parse(text.substring(47).slice(0, -2));

      const rawRows = json.table.rows.map(r => r.c.map(cell => cell?.f || cell?.v || ''));

      const cols = json.table.cols.map((c, i) => {
        const label = c.label;
        if (label && label.length > 1) return label;
        const firstRowVal = rawRows[0]?.[i];
        if (firstRowVal && typeof firstRowVal === 'string') return firstRowVal;
        return c.label || c.id;
      });

      const headersFound = json.table.cols.some(c => c.label && c.label.length > 1);
      const dataRows = headersFound ? rawRows : rawRows.slice(1);

      if (dataRows.length === 0) {
        setSyncing(null);
        return toast('Sheet has no data rows.', 'error');
      }

      // Fetch latest leads from server for dedup (replaces removed subscription)
      let existingLeads = [];
      try {
        const leadsRes = await fetch('/api/leads-page', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ownerId, mode: 'kanban', tab: 'all', page: 1, pageSize: 50000, isOwner: true, teamCanSeeAllLeads: true, boundaries: {} }),
        });
        const leadsJson = await leadsRes.json();
        existingLeads = leadsJson.items || [];
      } catch (e) { console.warn('Failed to fetch leads for dedup:', e); }

      // Build dedup Sets for O(1) lookups
      const emailSet = new Set(existingLeads.filter(l => l.email).map(l => l.email.toLowerCase()));
      const phoneSet = new Set(existingLeads.filter(l => l.phone).map(l => l.phone));

      const { mapping, customMappings } = config;
      let added = 0, skipped = 0, errors = 0;
      let batch = [];

      for (const row of dataRows) {
        try {
          const lead = { userId: ownerId, actorId: user.id, createdAt: Date.now(), custom: {} };

          Object.entries(mapping).forEach(([field, m]) => {
            let val = '';
            if (m.type === 'column') {
              const idx = cols.indexOf(m.value);
              if (idx !== -1 && idx < row.length) val = row[idx] != null ? String(row[idx]) : '';
            } else {
              val = m.value;
            }
            if (field === 'phone' && val) {
              const str = String(val);
              const hasPlus = str.includes('+');
              const digits = str.replace(/[^0-9]/g, '');
              val = (hasPlus ? '+' : '') + digits;
            }
            if (['name', 'email', 'phone', 'source', 'stage', 'label', 'notes', 'followup'].includes(field)) {
              lead[field] = val;
            } else {
              lead.custom[field] = val;
            }
          });

          if (customMappings && Array.isArray(customMappings)) {
            customMappings.forEach(m => {
              if (!m.field) return;
              let val = '';
              if (m.type === 'column') {
                const idx = cols.indexOf(m.value);
                if (idx !== -1 && idx < row.length) val = row[idx] != null ? String(row[idx]) : '';
              } else {
                val = m.value;
              }
              lead.custom[m.field] = val;
            });
          }

          if (!lead.name || !lead.name.trim()) { skipped++; continue; }

          // O(1) dedup check
          const dupEmail = lead.email && emailSet.has(lead.email.toLowerCase());
          const dupPhone = lead.phone && phoneSet.has(lead.phone);
          if (dupEmail || dupPhone) { skipped++; continue; }

          // Add to dedup sets immediately
          if (lead.email) emailSet.add(lead.email.toLowerCase());
          if (lead.phone) phoneSet.add(lead.phone);

          batch.push(db.tx.leads[genId()].update(lead));
          added++;

          // Flush batch every 50 leads
          if (batch.length >= 50) {
            await db.transact(batch);
            batch = [];
          }
        } catch {
          errors++;
        }
      }

      // Flush remaining batch
      if (batch.length > 0) await db.transact(batch);

      // Start cooldown
      const end = Date.now() + COOLDOWN_MS;
      setCooldownEnd(end);
      localStorage.setItem('tc_sync_cooldown', String(end));

      setSyncResults({ total: dataRows.length, added, skipped, errors, configName: config.configName });
      toast(`Synced! ${added} new lead(s) added, ${skipped} skipped.`, 'success');
    } catch (e) {
      console.error('Sync Error:', e);
      toast('Failed to sync. Ensure the sheet is shared or public.', 'error');
    } finally {
      setSyncing(null);
    }
  };

  const handleDeleteSheet = async (index) => {
    if (!confirm('Are you sure you want to delete this sheet integration?')) return;
    const updated = gsheets.filter((_, i) => i !== index);
    await db.transact(db.tx.userProfiles[profile.id].update({ gsheets: updated }));
    toast('Integration deleted', 'error');
  };

  const handleToggleSheet = async (index) => {
    const updated = gsheets.map((gs, i) => i === index ? { ...gs, disabled: !gs.disabled } : gs);
    await db.transact(db.tx.userProfiles[profile.id].update({ gsheets: updated }));
    toast(updated[index].disabled ? 'Integration disabled' : 'Integration enabled', 'info');
  };

  const handlePlatformAction = async (pid, action) => {
    if (!profile?.id) return;
    const profileId = profile.id;

    // Handle array-based integrations (gsheets, indiamart, justdial)
    if (pid === 'indiamart' || pid === 'justdial' || pid === 'tradeindia') {
      const configs = profile[pid] || [];
      if (action === 'delete') {
        if (!confirm(`Are you sure you want to disconnect all ${pid} integrations?`)) return;
        await db.transact(db.tx.userProfiles[profileId].update({ [pid]: [] }));
        toast('Disconnected', 'error');
      } else if (action === 'toggle') {
        const updated = configs.map(c => ({ ...c, disabled: !c.disabled }));
        await db.transact(db.tx.userProfiles[profileId].update({ [pid]: updated }));
        toast(configs[0]?.disabled ? 'Enabled' : 'Disabled', 'info');
      }
      return;
    }

    const field = pid === 'fbads' ? 'fbAds' : 'googleAds';
    const current = profile[field] || { connected: false, disabled: false };

    if (action === 'delete') {
      if (!confirm(`Are you sure you want to disconnect ${pid}?`)) return;
      if (pid === 'gsheets') {
        await db.transact(db.tx.userProfiles[profileId].update({ gsheets: [], gsheetsDisabled: false }));
      } else {
        await db.transact(db.tx.userProfiles[profileId].update({ [field]: { connected: false, disabled: false } }));
      }
      toast('Disconnected', 'error');
    } else if (action === 'toggle') {
      if (pid === 'gsheets') {
        await db.transact(db.tx.userProfiles[profileId].update({ gsheetsDisabled: !profile.gsheetsDisabled }));
        toast(profile.gsheetsDisabled ? 'Enabled' : 'Disabled', 'info');
      } else {
        await db.transact(db.tx.userProfiles[profileId].update({ [field]: { ...current, disabled: !current.disabled } }));
        toast(current.disabled ? 'Enabled' : 'Disabled', 'info');
      }
    } else if (action === 'connect') {
      setSyncing(pid);
      setTimeout(async () => {
        await db.transact(db.tx.userProfiles[profileId].update({ [field]: { connected: true, disabled: false } }));
        setSyncing(null);
        toast(`Connected!`, 'success');
      }, 1500);
    }
  };

  const handleSync = (item) => {
    if (item.id === 'gsheets' && gsheets.length > 0) {
      syncGoogleSheet(0);
      return;
    }
    if (item.id === 'indiamart' || item.id === 'justdial' || item.id === 'tradeindia') {
      setShowConfig({ type: item.id, index: null });
      return;
    }
    handlePlatformAction(item.id, 'connect');
  };

  // Manual sync for IndiaMART / JustDial / TradeIndia configs.
  // Calls the server webhook endpoint which:
  //   1. Pulls from third-party API (using lastSyncAt to filter where supported)
  //   2. Dedups by phone + email + sourceLeadId
  //   3. Inserts only NEW leads (never updates existing — so stage changes are preserved)
  //   4. Updates that config's lastSyncAt
  const syncIntegration = async (type, configIndex) => {
    if (isCoolingDown) {
      return toast(`Please wait ${cooldownMinutes} min before syncing again.`, 'warning');
    }
    const cfg = (profile?.[type] || [])[configIndex];
    if (cfg?.disabled) {
      return toast('Integration is disabled. Please enable it first.', 'warning');
    }

    setSyncing(`${type}-${configIndex}`);
    setSyncResults(null);
    try {
      const url = `/api/webhook/${type}?action=sync&ownerId=${encodeURIComponent(ownerId)}&configIndex=${configIndex}`;
      const r = await fetch(url, { method: 'GET' });
      const json = await r.json();

      if (!r.ok || !json.success) {
        throw new Error(json.message || `HTTP ${r.status}`);
      }

      // Start cooldown
      const end = Date.now() + COOLDOWN_MS;
      setCooldownEnd(end);
      localStorage.setItem('tc_sync_cooldown', String(end));

      setSyncResults({
        configName: cfg?.configName || type,
        added: json.added || 0,
        skipped: json.skipped || 0,
        errors: json.errors || 0,
        total: json.total || (json.added || 0) + (json.skipped || 0),
        diagnostic: json.diagnostic || null,
      });

      // If 0 added AND 0 skipped, the API likely returned no leads —
      // surface the diagnostic so the user can debug auth / response format.
      if ((json.added || 0) === 0 && (json.skipped || 0) === 0 && json.diagnostic) {
        toast(
          `${type}: API returned no leads. Check Console / sync card for details.`,
          'warning'
        );
        console.warn(`[${type} sync] diagnostic:`, json.diagnostic);
      } else {
        toast(`Synced! ${json.added || 0} new lead(s), ${json.skipped || 0} skipped.`, 'success');
      }
    } catch (e) {
      toast(`Sync failed: ${e.message}`, 'error');
    } finally {
      setSyncing(null);
    }
  };

  const handleToggleIntConfig = async (type, index) => {
    const configs = profile[type] || [];
    const updated = configs.map((c, i) => i === index ? { ...c, disabled: !c.disabled } : c);
    await db.transact(db.tx.userProfiles[profile.id].update({ [type]: updated }));
    toast(updated[index].disabled ? 'Integration disabled' : 'Integration enabled', 'info');
  };

  const handleDeleteIntConfig = async (type, index) => {
    if (!confirm('Are you sure you want to delete this integration?')) return;
    const configs = profile[type] || [];
    const updated = configs.filter((_, i) => i !== index);
    await db.transact(db.tx.userProfiles[profile.id].update({ [type]: updated }));
    toast('Integration deleted', 'error');
  };

  if (showConfig?.type === 'gsheets') {
    return (
      <SheetIntegration
        user={user}
        ownerId={ownerId}
        onBack={() => setShowConfig(null)}
        existingConfig={showConfig.index !== null ? gsheets[showConfig.index] : null}
        editIndex={showConfig.index}
      />
    );
  }

  if (showConfig?.type === 'indiamart') {
    return (
      <IndiamartIntegration
        user={user}
        ownerId={ownerId}
        onBack={() => setShowConfig(null)}
        existingConfig={showConfig.index !== null ? indiamartConfigs[showConfig.index] : null}
        editIndex={showConfig.index}
      />
    );
  }

  if (showConfig?.type === 'justdial') {
    return (
      <JustdialIntegration
        user={user}
        ownerId={ownerId}
        onBack={() => setShowConfig(null)}
        existingConfig={showConfig.index !== null ? justdialConfigs[showConfig.index] : null}
        editIndex={showConfig.index}
      />
    );
  }

  if (showConfig?.type === 'tradeindia') {
    return (
      <TradeindiaIntegration
        user={user}
        ownerId={ownerId}
        onBack={() => setShowConfig(null)}
        existingConfig={showConfig.index !== null ? tradeindiaConfigs[showConfig.index] : null}
        editIndex={showConfig.index}
      />
    );
  }

  return (
    <div className="integrations">
      <div className="sh">
        <div>
          <h2>Integrations</h2>
          <div className="sub">Connect your lead sources and fetch data automatically</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 20, marginTop: 20 }}>
        {integrations.map(item => (
          <div key={item.id} className="tw" style={{ padding: 24, display: 'flex', flexDirection: 'column', height: '100%' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
              <span style={{ fontSize: 32 }}>{item.icon}</span>
              <div>
                <h3 style={{ margin: 0 }}>{item.name}</h3>
                <span className={`badge ${item.connected ? 'bg-green' : 'bg-gray'}`} style={{ fontSize: 10, marginTop: 4 }}>
                  {item.connected ? 'Connected' : 'Not Connected'}
                </span>
              </div>
            </div>
            <p style={{ fontSize: 13, color: 'var(--muted)', flex: 1, lineHeight: 1.5, marginBottom: 20 }}>
              {item.desc}
            </p>
            {item.id === 'gsheets' && gsheets.length > 0 && (
              <div style={{ marginTop: -10, marginBottom: 15 }}>
                {gsheets.map((gs, idx) => (
                  <div key={idx} style={{ padding: '10px 12px', background: 'var(--bg)', borderRadius: 8, marginBottom: 8, fontSize: 12, border: '1px solid var(--border)' }}>
                    <div style={{ fontWeight: 600, marginBottom: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', opacity: (gs.disabled || profile?.gsheetsDisabled) ? 0.5 : 1 }}>
                      {(gs.disabled || profile?.gsheetsDisabled) ? '⏸ ' : '📄 '}{gs.configName || gs.sheetId.substring(0, 8) + '...'}
                    </div>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                      <button 
                        className={`btn ${gs.disabled ? 'btn-secondary' : 'btn-primary'} btn-sm`} 
                        style={{ padding: '2px 8px', fontSize: 10, flex: 1, minWidth: 'fit-content' }} 
                        onClick={() => handleToggleSheet(idx)}
                      >
                        {gs.disabled ? 'Enable' : 'Disable'}
                      </button>
                      <button 
                        className="btn btn-primary btn-sm" 
                        style={{ padding: '2px 10px', fontSize: 10, flex: 1.5, minWidth: 'fit-content' }} 
                        onClick={() => syncGoogleSheet(idx)} 
                        disabled={syncing !== null || isCoolingDown || gs.disabled || profile?.gsheetsDisabled}
                      >
                        {syncing === 'gsheets' ? '⟳ Syncing...' : isCoolingDown ? `⏳ ${cooldownMinutes}m` : '⟳ Sync'}
                      </button>
                      <button className="btn btn-secondary btn-sm" style={{ padding: '2px 8px', fontSize: 10 }} onClick={() => setShowConfig({ type: 'gsheets', index: idx })}>Edit</button>
                      <button className="btn btn-secondary btn-sm" style={{ padding: '2px 8px', fontSize: 10, color: '#ef4444' }} onClick={() => handleDeleteSheet(idx)}>Disconnect</button>
                    </div>
                  </div>
                ))}
                {syncResults && (
                  <div style={{ background: '#ecfdf5', border: '1px solid #10b981', borderRadius: 8, padding: '10px 14px', marginTop: 10, fontSize: 11, color: '#065f46' }}>
                    <strong>Last Sync: {syncResults.configName}</strong>
                    <div style={{ marginTop: 4 }}>
                      ✅ {syncResults.added} added · ⏭ {syncResults.skipped} skipped · ❌ {syncResults.errors} errors · 📊 {syncResults.total} total rows
                    </div>
                  </div>
                )}
              </div>
            )}
            {/* IndiaMART / JustDial connected configs */}
            {(item.id === 'indiamart' || item.id === 'justdial' || item.id === 'tradeindia') && (profile?.[item.id] || []).length > 0 && (
              <div style={{ marginTop: -10, marginBottom: 15 }}>
                {(profile[item.id] || []).map((cfg, idx) => (
                  <div key={idx} style={{ padding: '10px 12px', background: 'var(--bg)', borderRadius: 8, marginBottom: 8, fontSize: 12, border: '1px solid var(--border)' }}>
                    <div style={{ fontWeight: 600, marginBottom: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', opacity: cfg.disabled ? 0.5 : 1 }}>
                      {cfg.disabled ? '⏸ ' : item.id === 'indiamart' ? '🏭 ' : item.id === 'tradeindia' ? '🏢 ' : '📞 '}{cfg.configName || item.name}
                    </div>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                      <button
                        className={`btn ${cfg.disabled ? 'btn-secondary' : 'btn-primary'} btn-sm`}
                        style={{ padding: '2px 8px', fontSize: 10, flex: 1, minWidth: 'fit-content' }}
                        onClick={() => handleToggleIntConfig(item.id, idx)}
                      >
                        {cfg.disabled ? 'Enable' : 'Disable'}
                      </button>
                      <button
                        className="btn btn-primary btn-sm"
                        style={{ padding: '2px 10px', fontSize: 10, flex: 1.5, minWidth: 'fit-content' }}
                        onClick={() => syncIntegration(item.id, idx)}
                        disabled={syncing !== null || isCoolingDown || cfg.disabled}
                        title={cfg.lastSyncAt ? `Last synced: ${new Date(cfg.lastSyncAt).toLocaleString()}` : 'Never synced'}
                      >
                        {syncing === `${item.id}-${idx}` ? '⟳ Syncing...' : isCoolingDown ? `⏳ ${cooldownMinutes}m` : '⟳ Sync'}
                      </button>
                      <button className="btn btn-secondary btn-sm" style={{ padding: '2px 8px', fontSize: 10 }} onClick={() => setShowConfig({ type: item.id, index: idx })}>Edit</button>
                      <button className="btn btn-secondary btn-sm" style={{ padding: '2px 8px', fontSize: 10, color: '#ef4444' }} onClick={() => handleDeleteIntConfig(item.id, idx)}>Disconnect</button>
                    </div>
                    {cfg.lastSyncAt && (
                      <div style={{ marginTop: 6, fontSize: 10, color: 'var(--muted)' }}>
                        Last synced: {new Date(cfg.lastSyncAt).toLocaleString()}
                      </div>
                    )}
                  </div>
                ))}
                {syncResults && syncing === null && (
                  <div style={{
                    background: syncResults.diagnostic ? '#fef3c7' : '#ecfdf5',
                    border: `1px solid ${syncResults.diagnostic ? '#f59e0b' : '#10b981'}`,
                    borderRadius: 8,
                    padding: '10px 14px',
                    marginTop: 6,
                    fontSize: 11,
                    color: syncResults.diagnostic ? '#78350f' : '#065f46',
                  }}>
                    <strong>Last Sync: {syncResults.configName}</strong>
                    <div style={{ marginTop: 4 }}>
                      ✅ {syncResults.added} added · ⏭ {syncResults.skipped} skipped · ❌ {syncResults.errors} errors
                    </div>
                    {syncResults.diagnostic && (
                      <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid #fcd34d' }}>
                        <strong>⚠️ Diagnostic — API returned no leads</strong>
                        <div style={{ marginTop: 4, fontFamily: 'monospace', fontSize: 10 }}>
                          HTTP: {syncResults.diagnostic.httpStatus}<br/>
                          Keys: {(syncResults.diagnostic.apiResponseKeys || []).join(', ') || '(none)'}<br/>
                          Sample: <span style={{ wordBreak: 'break-all' }}>{(syncResults.diagnostic.apiResponseSample || syncResults.diagnostic.responseSample || '').slice(0, 200)}</span>
                        </div>
                        <div style={{ marginTop: 6 }}>
                          Likely cause: wrong API credentials, or TradeIndia has no new inquiries. Verify credentials in Edit.
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
            {item.id === 'gsheets' && gsheets.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <button className="btn btn-primary btn-sm" style={{ width: '100%' }} onClick={() => setShowConfig({ type: 'gsheets', index: null })}>
                  + Add Another Sheet
                </button>
                <div style={{ display: 'flex', gap: 10 }}>
                  <button className="btn btn-secondary btn-sm" style={{ flex: 1 }} onClick={() => handlePlatformAction('gsheets', 'toggle')}>
                    {profile?.gsheetsDisabled ? 'Enable Sync' : 'Disable Sync'}
                  </button>
                  <button className="btn btn-secondary btn-sm" style={{ padding: '0 12px', color: '#ef4444' }} onClick={() => handlePlatformAction('gsheets', 'delete')}>
                    Disconnect
                  </button>
                </div>
              </div>
            ) : (item.id === 'indiamart' || item.id === 'justdial' || item.id === 'tradeindia') && (profile?.[item.id] || []).length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <button className="btn btn-primary btn-sm" style={{ width: '100%' }} onClick={() => setShowConfig({ type: item.id, index: null })}>
                  + Add Another
                </button>
                <div style={{ display: 'flex', gap: 10 }}>
                  <button className="btn btn-secondary btn-sm" style={{ flex: 1 }} onClick={() => handlePlatformAction(item.id, 'toggle')}>
                    {(profile[item.id] || [])[0]?.disabled ? 'Enable All' : 'Disable All'}
                  </button>
                  <button className="btn btn-secondary btn-sm" style={{ padding: '0 12px', color: '#ef4444' }} onClick={() => handlePlatformAction(item.id, 'delete')}>
                    Disconnect All
                  </button>
                </div>
              </div>
            ) : item.connected ? (
              <div style={{ display: 'flex', gap: 10 }}>
                 <button className={`btn btn-secondary btn-sm`} style={{ flex: 1 }} onClick={() => handlePlatformAction(item.id, 'toggle')}>
                  {item.disabled ? 'Enable Sync' : 'Disable Sync'}
                </button>
                <button className={`btn btn-secondary btn-sm`} style={{ padding: '0 12px', color: '#ef4444' }} onClick={() => handlePlatformAction(item.id, 'delete')}>
                  Disconnect
                </button>
              </div>
            ) : (
              <button 
                className={`btn ${syncing === item.id ? 'btn-secondary' : 'btn-primary'} btn-sm`} 
                style={{ width: '100%' }}
                onClick={() => (item.id === 'gsheets' || item.id === 'indiamart' || item.id === 'justdial' || item.id === 'tradeindia') ? setShowConfig({ type: item.id, index: null }) : handleSync(item)}
                disabled={syncing !== null}
              >
                {syncing === item.id ? 'Connecting...' : 'Connect Now'}
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="tw" style={{ marginTop: 30, padding: 24, background: '#f8fafc', borderStyle: 'dashed' }}>
        <h4 style={{ margin: '0 0 12px 0' }}>💡 How it works</h4>
        <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.6 }}>
          Once you connect an integration, T2GCRM will periodically check for new leads. 
          New entries will automatically appear in your <strong>Leads</strong> dashboard with the source tag set (e.g., "FB Ads").
          You can also set up <strong>Automations</strong> to trigger follow-up emails as soon as a lead is fetched.
        </p>
      </div>
    </div>
  );
}
