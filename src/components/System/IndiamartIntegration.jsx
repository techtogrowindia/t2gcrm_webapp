import React, { useState } from 'react';
import db from '../../instant';
import { id } from '@instantdb/react';
import { useToast } from '../../context/ToastContext';
import { DEFAULT_STAGES, DEFAULT_SOURCES, DEFAULT_REQUIREMENTS } from '../../utils/helpers';

// Known IndiaMART API response fields
const INDIAMART_COLUMNS = [
  'SENDER_NAME', 'SENDER_EMAIL', 'SENDER_MOBILE', 'SENDER_COMPANY',
  'SENDER_ADDRESS', 'SENDER_CITY', 'SENDER_STATE', 'SENDER_PINCODE',
  'SUBJECT', 'QUERY_MESSAGE', 'QUERY_PRODUCT_NAME', 'QUERY_TIME',
  'UNIQUE_QUERY_ID', 'CALL_DURATION', 'RECEIVER_MOBILE'
];

export default function IndiamartIntegration({ user, ownerId, onBack, existingConfig, editIndex }) {
  const toast = useToast();

  const { data: profileData } = db.useQuery({
    userProfiles: { $: { where: { userId: ownerId } } },
    teamMembers: { $: { where: { userId: ownerId } } },
    globalSettings: {}
  });
  const profile = profileData?.userProfiles?.[0] || {};
  const team = profileData?.teamMembers || [];
  const stages = profile.stages || DEFAULT_STAGES;
  const requirements = profile.requirements || DEFAULT_REQUIREMENTS;
  const activeSources = profile.sources || DEFAULT_SOURCES;
  const globalCustomFields = profile.customFields || [];
  const crmDomain = profileData?.globalSettings?.[0]?.crmDomain || window.location.origin;

  const columns = INDIAMART_COLUMNS;

  const DEFAULT_MAPPING = {
    name: { type: 'column', value: 'SENDER_NAME' },
    email: { type: 'column', value: 'SENDER_EMAIL' },
    phone: { type: 'column', value: 'SENDER_MOBILE' },
    requirement: { type: 'fixed', value: '' },  // user picks — never hardcode a category
    stage: { type: 'fixed', value: stages[0] || '' },
    source: { type: 'fixed', value: 'IndiaMART' },
    assign: { type: 'fixed', value: '' },
    notes: { type: 'column', value: 'QUERY_MESSAGE' },
    followup: { type: 'fixed', value: '' }
  };

  const fmtDateInput = (ts) => {
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
  const defaultFrom = fmtDateInput(
    existingConfig?.lastSyncAt
      ? Math.max(existingConfig.lastSyncAt, Date.now() - THIRTY_DAYS_MS)
      : Date.now() - THIRTY_DAYS_MS
  );
  const defaultTo = fmtDateInput(Date.now());

  const [configName, setConfigName] = useState(existingConfig?.configName || '');
  const [apiKey, setApiKey] = useState(existingConfig?.apiKey || '');
  const [disabled, setDisabled] = useState(existingConfig?.disabled || false);
  const [syncing, setSyncing] = useState(false);
  const [syncResults, setSyncResults] = useState(null);
  const [syncFrom, setSyncFrom] = useState(defaultFrom);
  const [syncTo, setSyncTo] = useState(defaultTo);
  const [mapping, setMapping] = useState(() => {
    let m = existingConfig?.mapping ? { ...existingConfig.mapping } : { ...DEFAULT_MAPPING };
    return { ...DEFAULT_MAPPING, ...m };
  });
  const [customMappings, setCustomMappings] = useState(existingConfig?.customMappings || []);

  const webhookUrl = `${crmDomain}/api/webhook/indiamart?userId=${ownerId}`;

  const handleSave = async () => {
    if (!configName) return toast('Please enter a name for this integration', 'error');
    if (!apiKey) return toast('Please enter your IndiaMART API Key', 'error');

    const config = { configName, apiKey, mapping, customMappings, columns, disabled, updatedAt: Date.now() };
    const current = profile.indiamart || [];
    let updated;
    if (editIndex !== null && editIndex !== undefined) {
      updated = current.map((g, i) => i === editIndex ? config : g);
    } else {
      updated = [...current, config];
    }
    await db.transact(db.tx.userProfiles[profile.id].update({ indiamart: updated }));
    toast('IndiaMART integration saved!', 'success');
    onBack();
  };

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to remove this IndiaMART integration?')) return;
    const current = profile.indiamart || [];
    const updated = current.filter((_, i) => i !== editIndex);
    await db.transact(db.tx.userProfiles[profile.id].update({ indiamart: updated }));
    toast('Integration removed', 'error');
    onBack();
  };

  const handleSync = async () => {
    if (!apiKey) return toast('Please enter your API key first', 'error');
    if (!syncFrom || !syncTo) return toast('Please select a date range', 'error');
    if (syncFrom > syncTo) return toast('From date cannot be after To date', 'error');
    setSyncing(true);
    setSyncResults(null);
    try {
      const idx = editIndex !== null && editIndex !== undefined ? editIndex : 0;
      const res = await fetch(`${crmDomain}/api/webhook/indiamart?userId=${ownerId}&action=sync&configIndex=${idx}&from_date=${syncFrom}&to_date=${syncTo}`);
      const data = await res.json();
      if (data.success) {
        setSyncResults(data);
        if ((data.added || 0) === 0 && (data.skipped || 0) === 0 && data.diagnostic) {
          toast('API returned no leads — see diagnostic below the button', 'warning');
          console.warn('[indiamart sync] diagnostic:', data.diagnostic);
        } else {
          toast(`Synced! ${data.added} new lead(s) added, ${data.skipped} skipped.`, 'success');
        }
      } else {
        setSyncResults(data);
        toast(data.message || 'Sync failed', 'error');
      }
    } catch (e) {
      toast('Failed to sync: ' + (e.message || 'Unknown error'), 'error');
    } finally {
      setSyncing(false);
    }
  };

  const handleSendTestLead = async () => {
    try {
      // Build a test lead from sample IndiaMART data
      const sampleData = {
        SENDER_NAME: 'Test Lead (IndiaMART)',
        SENDER_EMAIL: 'test-indiamart@example.com',
        SENDER_MOBILE: '9876543210',
        SENDER_COMPANY: 'Test Company',
        QUERY_MESSAGE: 'Test enquiry from IndiaMART integration',
        QUERY_PRODUCT_NAME: 'Sample Product',
        SENDER_CITY: 'Mumbai',
        SENDER_STATE: 'Maharashtra'
      };

      const lead = { userId: ownerId, actorId: user.id, createdAt: Date.now(), custom: {} };

      Object.entries(mapping).forEach(([field, m]) => {
        let val = '';
        if (m.type === 'column') {
          val = sampleData[m.value] != null ? String(sampleData[m.value]) : '';
        } else {
          val = m.value || '';
        }
        if (field === 'phone' && val) {
          const str = String(val);
          const hasPlus = str.includes('+');
          const digits = str.replace(/[^0-9]/g, '');
          val = (hasPlus ? '+' : '') + digits;
        }
        if (['name', 'email', 'phone', 'source', 'stage', 'requirement', 'notes', 'followup', 'assign', 'companyName', 'productCat'].includes(field)) {
          lead[field] = val;
        } else {
          lead.custom[field] = val;
        }
      });

      customMappings.forEach(m => {
        if (!m.field) return;
        let val = '';
        if (m.type === 'column') {
          val = sampleData[m.value] != null ? String(sampleData[m.value]) : '';
        } else {
          val = m.value || '';
        }
        lead.custom[m.field] = val;
      });

      if (!lead.name) lead.name = 'Test Lead (IndiaMART)';
      await db.transact(db.tx.leads[id()].update(lead));
      toast('Test lead added to your dashboard!', 'success');
    } catch (e) {
      console.error(e);
      toast('Failed to send test lead.', 'error');
    }
  };

  const renderMappingRow = (label, icon, field, options = null, type = 'text', isCustom = false, customIndex = null) => {
    const m = isCustom ? customMappings[customIndex] : mapping[field];

    const updateVal = (newVal) => {
      if (isCustom) {
        const updated = [...customMappings];
        updated[customIndex] = { ...m, ...newVal };
        setCustomMappings(updated);
      } else {
        setMapping({ ...mapping, [field]: { ...m, ...newVal } });
      }
    };

    return (
      <div className="mapping-row" key={isCustom ? `custom-${customIndex}` : field}>
        <div className="mapping-label">
          {isCustom ? (
            <div style={{ width: '100%' }}>
              <select
                value={m.field}
                onChange={e => updateVal({ field: e.target.value })}
                style={{ fontSize: 11, padding: '4px 8px', width: '100%', fontWeight: 600 }}
              >
                <option value="">(Select Custom Field)</option>
                {globalCustomFields.map(cf => (
                  <option key={cf.name} value={cf.name}>{cf.name}</option>
                ))}
                {!globalCustomFields.find(cf => cf.name === m.field) && m.field && (
                  <option value={m.field}>{m.field}</option>
                )}
                <option value="__other__">+ Custom Key...</option>
              </select>
              {m.field === '__other__' && (
                <input
                  autoFocus
                  placeholder="Enter key name..."
                  onBlur={e => e.target.value && updateVal({ field: e.target.value })}
                  style={{ fontSize: 10, marginTop: 4, width: '100%' }}
                />
              )}
            </div>
          ) : (
            <>
              <span style={{ fontSize: 16 }}>{icon}</span>
              <div>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{label}</div>
                <div style={{ fontSize: 10, color: 'var(--muted)' }}>{field === 'name' ? 'Required' : 'Optional'}</div>
              </div>
            </>
          )}
        </div>
        <div className="mapping-controls">
          <div className="toggle-group">
            <button className={m.type === 'column' ? 'active' : ''} onClick={() => updateVal({ type: 'column' })}>Column</button>
            <button className={m.type === 'fixed' ? 'active' : ''} onClick={() => updateVal({ type: 'fixed' })}>Fixed</button>
          </div>
          {m.type === 'column' ? (
            <select value={m.value} onChange={e => updateVal({ value: e.target.value })}>
              <option value="">(Select IndiaMART Field)</option>
              {columns.map((c, i) => <option key={i} value={c}>{c}</option>)}
            </select>
          ) : (
            options ? (
              <select value={m.value} onChange={e => updateVal({ value: e.target.value })}>
                <option value="">(None)</option>
                {options.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            ) : (
              <input type={type} value={m.value} onChange={e => updateVal({ value: e.target.value })} placeholder="Fixed value..." />
            )
          )}
          {isCustom && (
            <button className="btn-icon" onClick={() => setCustomMappings(customMappings.filter((_, i) => i !== customIndex))} style={{ color: '#ef4444' }}>✕</button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="sheet-config">
      <div className="sh" style={{ marginBottom: 20 }}>
        <button className="btn-icon" onClick={onBack} style={{ marginRight: 15 }}>←</button>
        <div>
          <h3>{editIndex !== null ? 'Edit' : 'New'} IndiaMART Integration</h3>
          <div className="sub">Map IndiaMART lead fields to your CRM fields</div>
        </div>
      </div>

      <div className="tw" style={{ padding: 25, marginBottom: 20 }}>
        <div className="fg" style={{ marginBottom: 15 }}>
          <label>Integration Name</label>
          <input
            value={configName}
            onChange={e => setConfigName(e.target.value)}
            placeholder="e.g. IndiaMART Leads 2024"
            style={{ width: '100%', marginBottom: 15 }}
          />

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20, padding: '10px 15px', background: 'var(--bg-soft)', borderRadius: 8 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>Enable Integration</div>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>Turn off to temporarily stop receiving leads from IndiaMART.</div>
            </div>
            <div className="toggle-group">
              <button className={!disabled ? 'active' : ''} onClick={() => setDisabled(false)}>Enabled</button>
              <button className={disabled ? 'active' : ''} onClick={() => setDisabled(true)} style={{ color: disabled ? '#ef4444' : '' }}>Disabled</button>
            </div>
          </div>

          <label>IndiaMART CRM API Key (GLUSR_CRMMOBILE_KEY)</label>
          <input
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            placeholder="Enter your IndiaMART API Key..."
            style={{ width: '100%', marginBottom: 15 }}
            type="password"
          />
          <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 15 }}>
            Get this from your IndiaMART Seller Dashboard → Lead Manager → CRM Integration Settings
          </div>

          <label>Webhook URL (for real-time push)</label>
          <div style={{ display: 'flex', gap: 10, marginBottom: 5 }}>
            <input
              value={webhookUrl}
              readOnly
              style={{ flex: 1, background: 'var(--bg-soft)', cursor: 'text' }}
              onClick={e => e.target.select()}
            />
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => { navigator.clipboard.writeText(webhookUrl); toast('Webhook URL copied!', 'success'); }}
            >
              📋 Copy
            </button>
          </div>
          <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 15 }}>
            Register this URL in your IndiaMART dashboard to receive leads automatically in real-time.
          </div>

          {existingConfig && (
            <div style={{ marginBottom: 15 }}>
              <div style={{ display: 'flex', gap: 10, marginBottom: 8 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 4, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>From Date</label>
                  <input
                    type="date"
                    value={syncFrom}
                    onChange={e => setSyncFrom(e.target.value)}
                    style={{ width: '100%', padding: '8px 10px', border: '1.5px solid var(--border)', borderRadius: 8, fontSize: 13 }}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 4, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>To Date</label>
                  <input
                    type="date"
                    value={syncTo}
                    onChange={e => setSyncTo(e.target.value)}
                    style={{ width: '100%', padding: '8px 10px', border: '1.5px solid var(--border)', borderRadius: 8, fontSize: 13 }}
                  />
                </div>
              </div>
              <button
                className="btn btn-primary btn-sm"
                onClick={handleSync}
                disabled={syncing}
                style={{ width: '100%' }}
              >
                {syncing ? '⟳ Syncing...' : '⟳ Sync Now (Pull Leads for Selected Range)'}
              </button>
              <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 5 }}>
                Manual date range sync will not move the auto-sync checkpoint. Dedup still prevents re-importing existing leads.
              </div>
            </div>
          )}

          {syncResults && (
            <div style={{
              background: syncResults.diagnostic ? '#fef3c7' : '#ecfdf5',
              border: `1px solid ${syncResults.diagnostic ? '#f59e0b' : '#10b981'}`,
              borderRadius: 8,
              padding: '10px 14px',
              marginBottom: 15,
              fontSize: 12,
              color: syncResults.diagnostic ? '#78350f' : '#065f46',
            }}>
              <strong>Sync Results</strong>
              <div style={{ marginTop: 4 }}>
                ✅ {syncResults.added || 0} added · ⏭ {syncResults.skipped || 0} skipped · {(syncResults.errors || 0) > 0 ? `❌ ${syncResults.errors} errors · ` : ''}📊 {syncResults.total || 0} total
              </div>

              {(syncResults.diagnostic?.requestUrl || syncResults.diagnostic?.responseSample || syncResults.diagnostic?.apiResponseSample) && (
                <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {syncResults.diagnostic?.requestUrl && (
                    <div>
                      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 2 }}>URL</div>
                      <div style={{ background: '#1e293b', color: '#93c5fd', padding: 8, borderRadius: 6, fontSize: 11, fontFamily: 'ui-monospace, monospace', wordBreak: 'break-all' }}>
                        {syncResults.diagnostic.requestUrl}
                      </div>
                    </div>
                  )}
                  <div>
                    <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 2 }}>Response</div>
                    <pre style={{
                      margin: 0, background: '#1e293b', color: '#e2e8f0', padding: 8,
                      borderRadius: 6, fontSize: 11, fontFamily: 'ui-monospace, monospace',
                      whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 220, overflow: 'auto',
                    }}>
{syncResults.diagnostic.responseSample || syncResults.diagnostic.apiResponseSample || '(empty)'}
                    </pre>
                  </div>
                  <button
                    type="button"
                    onClick={() => navigator.clipboard.writeText(
                      `URL: ${syncResults.diagnostic.requestUrl || ''}\n\nResponse: ${syncResults.diagnostic.responseSample || syncResults.diagnostic.apiResponseSample || ''}`
                    )}
                    style={{ alignSelf: 'flex-start', padding: '4px 10px', background: '#475569', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 11 }}
                  >
                    📋 Copy
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="gs-success-msg">
          <span style={{ fontSize: 20 }}>🏭</span>
          <div>
            <strong>IndiaMART — {columns.length} fields available for mapping</strong>
            <div style={{ fontSize: 11 }}>Map each CRM field below to an IndiaMART field or set a fixed value.</div>
          </div>
        </div>
      </div>

      <div className="tw" style={{ padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '15px 25px', borderBottom: '1px solid var(--border)', background: 'var(--bg-soft)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Field Mapping
        </div>
        <div style={{ padding: '10px 25px' }}>
          {renderMappingRow('Name', '👤', 'name')}
          {renderMappingRow('Email', '📧', 'email')}
          {renderMappingRow('Phone / Mobile', '📱', 'phone')}
          {renderMappingRow('Lead Requirement', '🏷️', 'requirement', requirements)}
          {renderMappingRow('Lead Stage', '📋', 'stage', stages)}
          {renderMappingRow('Source', '🔗', 'source', activeSources)}
          {renderMappingRow('Assigned To', '👤', 'assign', team.map(t => t.name))}
          {renderMappingRow('Notes', '📝', 'notes')}
          {renderMappingRow('Follow-up Date', '📅', 'followup', null, 'date')}

          {customMappings.length > 0 && (
            <div style={{ marginTop: 20, borderTop: '1px solid var(--border)', paddingTop: 20 }}>
              {customMappings.map((_, idx) => renderMappingRow(null, null, null, null, 'text', true, idx))}
            </div>
          )}

          <button
            className="btn btn-secondary btn-sm"
            type="button"
            style={{ marginTop: 15, width: '100%', borderStyle: 'dashed' }}
            onClick={() => setCustomMappings([...customMappings, { field: '', type: 'column', value: '' }])}
          >
            + Add Custom Field Mapping
          </button>
        </div>

        <div style={{ padding: 25, background: 'var(--bg-soft)', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          {editIndex !== null && (
            <button className="btn btn-secondary" onClick={handleDelete} style={{ marginRight: 'auto', color: '#dc2626' }}>Delete Integration</button>
          )}
          <button className="btn btn-secondary" onClick={onBack}>Cancel</button>
          <button className="btn btn-secondary" onClick={handleSendTestLead}>Send Test Lead</button>
          <button className="btn btn-primary" onClick={handleSave}>{editIndex !== null ? 'Update Settings' : 'Save & Enable'}</button>
        </div>
      </div>

      <style>{`
        .sheet-config { max-width: 800px; margin: 0 auto; }
        .gs-success-msg { background: #ecfdf5; border: 1px solid #10b981; color: #065f46; padding: 12px 20px; border-radius: 10px; display: flex; gap: 15px; align-items: center; }
        .mapping-row { display: flex; align-items: center; padding: 15px 0; border-bottom: 1px solid var(--bg-soft); gap: 30px; }
        .mapping-row:last-child { border-bottom: none; }
        .mapping-label { width: 180px; display: flex; gap: 12px; align-items: center; }
        .mapping-controls { flex: 1; display: flex; gap: 15px; align-items: center; }
        .toggle-group { display: flex; background: var(--bg-soft); border-radius: 8px; padding: 3px; border: 1px solid var(--border); }
        .toggle-group button { border: none; background: transparent; padding: 4px 12px; font-size: 11px; font-weight: 700; cursor: pointer; border-radius: 6px; color: var(--muted); }
        .toggle-group button.active { background: #fff; color: var(--accent); box-shadow: 0 2px 5px rgba(0,0,0,0.05); }
        .mapping-controls select, .mapping-controls input { flex: 1; padding: 8px 12px; border: 1.5px solid var(--border); border-radius: 8px; font-size: 13px; outline: none; transition: 0.2s; }
        .mapping-controls select:focus, .mapping-controls input:focus { border-color: var(--accent); }
      `}</style>
    </div>
  );
}
