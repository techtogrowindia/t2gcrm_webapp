import React, { useState } from 'react';
import db from '../../instant';
import { id } from '@instantdb/react';
import { useToast } from '../../context/ToastContext';
import { DEFAULT_STAGES, DEFAULT_SOURCES, DEFAULT_REQUIREMENTS } from '../../utils/helpers';

// Known JustDial lead fields
const JUSTDIAL_COLUMNS = [
  'leadid', 'name', 'mobile', 'phone', 'email', 'date', 'time',
  'category', 'city', 'area', 'brancharea', 'company', 'pincode'
];

export default function JustdialIntegration({ user, ownerId, onBack, existingConfig, editIndex }) {
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

  const columns = JUSTDIAL_COLUMNS;

  const DEFAULT_MAPPING = {
    name: { type: 'column', value: 'name' },
    email: { type: 'column', value: 'email' },
    phone: { type: 'column', value: 'mobile' },
    requirement: { type: 'fixed', value: requirements[0] || '' },
    stage: { type: 'fixed', value: stages[0] || '' },
    source: { type: 'fixed', value: 'JustDial' },
    assign: { type: 'fixed', value: '' },
    notes: { type: 'column', value: 'category' },
    followup: { type: 'fixed', value: '' }
  };

  const [configName, setConfigName] = useState(existingConfig?.configName || '');
  const [apiKey, setApiKey] = useState(existingConfig?.apiKey || '');
  const [disabled, setDisabled] = useState(existingConfig?.disabled || false);
  const [syncing, setSyncing] = useState(false);
  const [syncResults, setSyncResults] = useState(null);
  const [mapping, setMapping] = useState(() => {
    let m = existingConfig?.mapping ? { ...existingConfig.mapping } : { ...DEFAULT_MAPPING };
    return { ...DEFAULT_MAPPING, ...m };
  });
  const [customMappings, setCustomMappings] = useState(existingConfig?.customMappings || []);

  const webhookUrl = `${crmDomain}/api/webhook/justdial?userId=${ownerId}`;

  const handleSave = async () => {
    if (!configName) return toast('Please enter a name for this integration', 'error');

    const config = { configName, apiKey, mapping, customMappings, columns, disabled, updatedAt: Date.now() };
    const current = profile.justdial || [];
    let updated;
    if (editIndex !== null && editIndex !== undefined) {
      updated = current.map((g, i) => i === editIndex ? config : g);
    } else {
      updated = [...current, config];
    }
    await db.transact(db.tx.userProfiles[profile.id].update({ justdial: updated }));
    toast('JustDial integration saved!', 'success');
    onBack();
  };

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to remove this JustDial integration?')) return;
    const current = profile.justdial || [];
    const updated = current.filter((_, i) => i !== editIndex);
    await db.transact(db.tx.userProfiles[profile.id].update({ justdial: updated }));
    toast('Integration removed', 'error');
    onBack();
  };

  const handleSync = async () => {
    if (!apiKey) return toast('Please enter your API key first', 'error');
    setSyncing(true);
    setSyncResults(null);
    try {
      const idx = editIndex !== null && editIndex !== undefined ? editIndex : 0;
      const res = await fetch(`${crmDomain}/api/webhook/justdial?userId=${ownerId}&action=sync&configIndex=${idx}`);
      const data = await res.json();
      if (data.success) {
        setSyncResults(data);
        if ((data.added || 0) === 0 && (data.skipped || 0) === 0 && data.diagnostic) {
          toast('API returned no leads — see diagnostic below the button', 'warning');
          console.warn('[justdial sync] diagnostic:', data.diagnostic);
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
      const sampleData = {
        leadid: 'JD-TEST-001',
        name: 'Test Lead (JustDial)',
        mobile: '9876543210',
        phone: '02212345678',
        email: 'test-justdial@example.com',
        date: new Date().toLocaleDateString(),
        time: new Date().toLocaleTimeString(),
        category: 'Test Category',
        city: 'Mumbai',
        area: 'Andheri',
        brancharea: 'Andheri West',
        company: 'Test Company',
        pincode: '400053'
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

      if (!lead.name) lead.name = 'Test Lead (JustDial)';
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
              <option value="">(Select JustDial Field)</option>
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
          <h3>{editIndex !== null ? 'Edit' : 'New'} JustDial Integration</h3>
          <div className="sub">Map JustDial lead fields to your CRM fields</div>
        </div>
      </div>

      <div className="tw" style={{ padding: 25, marginBottom: 20 }}>
        <div className="fg" style={{ marginBottom: 15 }}>
          <label>Integration Name</label>
          <input
            value={configName}
            onChange={e => setConfigName(e.target.value)}
            placeholder="e.g. JustDial Leads 2024"
            style={{ width: '100%', marginBottom: 15 }}
          />

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20, padding: '10px 15px', background: 'var(--bg-soft)', borderRadius: 8 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>Enable Integration</div>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>Turn off to temporarily stop receiving leads from JustDial.</div>
            </div>
            <div className="toggle-group">
              <button className={!disabled ? 'active' : ''} onClick={() => setDisabled(false)}>Enabled</button>
              <button className={disabled ? 'active' : ''} onClick={() => setDisabled(true)} style={{ color: disabled ? '#ef4444' : '' }}>Disabled</button>
            </div>
          </div>

          <label>JustDial API Key (Optional)</label>
          <input
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            placeholder="Enter your JustDial API Key if available..."
            style={{ width: '100%', marginBottom: 15 }}
            type="password"
          />
          <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 15 }}>
            Contact JustDial for API access. If using webhook-only mode, this field is optional.
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
            Register this URL with JustDial to receive leads automatically in real-time.
          </div>

          {existingConfig && (
            <div style={{ display: 'flex', gap: 10, marginBottom: 15 }}>
              <button
                className="btn btn-primary btn-sm"
                onClick={handleSync}
                disabled={syncing}
                style={{ flex: 1 }}
              >
                {syncing ? '⟳ Syncing...' : '⟳ Sync Now (Pull Latest Leads)'}
              </button>
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

              <details style={{ marginTop: 10 }} open={!!syncResults.diagnostic}>
                <summary style={{ cursor: 'pointer', fontWeight: 600, userSelect: 'none' }}>
                  📋 Raw API Response (click to {syncResults.diagnostic ? 'collapse' : 'expand'})
                </summary>
                <pre style={{
                  marginTop: 8,
                  background: '#1e293b',
                  color: '#e2e8f0',
                  padding: 12,
                  borderRadius: 6,
                  fontSize: 11,
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  overflow: 'auto',
                  maxHeight: 400,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}>
{JSON.stringify(syncResults, null, 2)}
                </pre>
                <button
                  type="button"
                  onClick={() => navigator.clipboard.writeText(JSON.stringify(syncResults, null, 2))}
                  style={{
                    marginTop: 6, padding: '4px 10px', background: '#475569',
                    color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 11,
                  }}
                >
                  📋 Copy Full Response
                </button>
              </details>

              {syncResults.diagnostic && (
                <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid #fcd34d' }}>
                  <strong>⚠️ Why 0 leads?</strong>
                  <ul style={{ margin: '6px 0 0 18px', padding: 0, fontSize: 11 }}>
                    <li>If <code>apiResponseSample</code> shows an error message → wrong API Key</li>
                    <li>If it shows an empty array → JustDial really has 0 new enquiries</li>
                    <li>If it shows unfamiliar keys → API response format changed</li>
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="gs-success-msg">
          <span style={{ fontSize: 20 }}>📞</span>
          <div>
            <strong>JustDial — {columns.length} fields available for mapping</strong>
            <div style={{ fontSize: 11 }}>Map each CRM field below to a JustDial field or set a fixed value.</div>
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
