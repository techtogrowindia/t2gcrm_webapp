import React, { useState, useMemo, useEffect } from 'react';
import { dbWrite, dbOp } from '../../utils/dbWrite';
import db from '../../instant';
import { id } from '@instantdb/react';
import { useToast } from '../../context/ToastContext';
import { DEFAULT_STAGES, DEFAULT_SOURCES, DEFAULT_REQUIREMENTS } from '../../utils/helpers';

export default function SheetIntegration({ user, ownerId, onBack, existingConfig, editIndex }) {
  const [configName, setConfigName] = useState(existingConfig?.configName || '');
  const [sheetInput, setSheetInput] = useState(existingConfig?.sheetId || '');
  const [sheetId, setSheetId] = useState(existingConfig?.sheetId || '');
  const [loading, setLoading] = useState(false);
  const [columns, setColumns] = useState(existingConfig?.columns || []);
  const [sampleData, setSampleData] = useState(existingConfig?.sampleData || null);
  const [disabled, setDisabled] = useState(existingConfig?.disabled || false);
  const DEFAULT_MAPPING = {
    name: { type: 'column', value: '' },
    email: { type: 'column', value: '' },
    phone: { type: 'column', value: '' },
    requirement: { type: 'fixed', value: '' },  // user picks — never hardcode a category
    stage: { type: 'fixed', value: DEFAULT_STAGES[0] },
    source: { type: 'fixed', value: 'Google Sheets' },
    assign: { type: 'fixed', value: '' },
    notes: { type: 'fixed', value: '' },
    followup: { type: 'fixed', value: '' }
  };
  const [mapping, setMapping] = useState(() => {
    let m = existingConfig?.mapping ? { ...existingConfig.mapping } : { ...DEFAULT_MAPPING };
    // Migration: assignedTo -> assign
    if (m.assignedTo && !m.assign) {
      m.assign = m.assignedTo;
      delete m.assignedTo;
    }
    // Ensure all default keys are present
    return { ...DEFAULT_MAPPING, ...m };
  });
  const [customMappings, setCustomMappings] = useState(existingConfig?.customMappings || []); // [{ field: '', type: 'column', value: '' }]
  const toast = useToast();

  const { data: profileData } = db.useQuery({ 
    userProfiles: { $: { where: { userId: ownerId } } },
    teamMembers: { $: { where: { userId: ownerId } } },
    globalSettings: {}
  });
  const profile = profileData?.userProfiles?.[0] || {};
  const team = profileData?.teamMembers || [];
  const requirements = profile.requirements || DEFAULT_REQUIREMENTS;
  const stages = profile.stages || DEFAULT_STAGES;
  const activeSources = profile.sources || DEFAULT_SOURCES;
  const globalCustomFields = profile.customFields || [];
  const crmDomain = profileData?.globalSettings?.[0]?.crmDomain || window.location.origin;

  const extractSheetId = (input) => {
    const regex = /\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/;
    const match = input.match(regex);
    if (match) return match[1];
    return input; // If no URL match, assume it's the ID
  };

  const handleSheetInput = (val) => {
    setSheetInput(val);
    const id = extractSheetId(val);
    setSheetId(id);
  };

  const fetchSheetData = async () => {
    if (!sheetId) return toast('Please enter a Spreadsheet URL or ID', 'error');
    setLoading(true);
    try {
      // Using a proxy or public CSV export for simplicity in this demo
      // In a real app, this would use Google Drive/Sheets API with OAuth
      const url = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:json`;
      const res = await fetch(url);
      const text = await res.text();
      const json = JSON.parse(text.substring(47).slice(0, -2));
      
      const rows = json.table.rows.map(r => r.c.map(cell => cell?.f || cell?.v));
      let headersFound = false;
      const cols = json.table.cols.map((c, i) => {
        const label = c.label;
        if (label && label.length > 1) {
          headersFound = true;
          return label;
        }
        const firstRowVal = rows[0]?.[i];
        if (firstRowVal && typeof firstRowVal === 'string') {
          return firstRowVal;
        }
        return c.label || c.id;
      });
      
      const dataRows = headersFound ? rows : rows.slice(1);
      setColumns(cols);
      const lastRow = dataRows.length > 0 ? dataRows[dataRows.length - 1] : null;
      setSampleData(lastRow);

      // Auto-mapping logic
      const newMapping = { ...mapping };
      const fieldKeys = Object.keys(mapping);
      let autoMappedCount = 0;

      cols.forEach((colName) => {
        const cleanCol = colName.toLowerCase().replace(/[^a-z0-9]/g, '');
        fieldKeys.forEach(field => {
          // Skip if already mapped to a column (not fixed) or if field is "source" which defaults to fixed
          if (newMapping[field].type === 'column' && newMapping[field].value) return;
          if (field === 'source') return; 

          const cleanField = field.toLowerCase();
          const matches = [cleanField, cleanField + 'name', 'customer' + cleanField, 'lead' + cleanField];
          
          if (matches.includes(cleanCol) || cleanCol.includes(cleanField)) {
             newMapping[field] = { type: 'column', value: colName };
             autoMappedCount++;
          }
        });
      });

      setMapping(newMapping);
      toast(`Sheet connected! ${autoMappedCount > 0 ? `Auto-mapped ${autoMappedCount} fields.` : ''}`, 'success');
    } catch (e) {
      toast('Failed to fetch sheet. Ensure it is public or shared.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!configName) return toast('Please enter a name for this integration', 'error');
    const config = { configName, sheetId, mapping, customMappings, columns, sampleData, disabled, updatedAt: Date.now() };
    const current = profile.gsheets || [];
    let updated = [];
    if (editIndex !== null && editIndex !== undefined) {
      updated = current.map((g, i) => i === editIndex ? config : g);
    } else {
      updated = [...current, config];
    }
    await dbWrite(dbOp.update('userProfiles', profile.id, { gsheets: updated }));
    toast('Configuration saved!', 'success');
    onBack();
  };

  const handleDelete = async () => {
    if (!confirm('Are you sure you want to remove this sheet integration?')) return;
    const current = profile.gsheets || [];
    const updated = current.filter((_, i) => i !== editIndex);
    await dbWrite(dbOp.update('userProfiles', profile.id, { gsheets: updated }));
    toast('Integration removed', 'error');
    onBack();
  };

  const handleSendTestLead = async () => {
    if (!sampleData) return toast('No sample data found. Please fetch columns first.', 'error');
    if (!mapping.name.value && mapping.name.type === 'column') return toast('Please map the Name field first.', 'error');

    try {
      const lead = {
        userId: ownerId,
        actorId: user.id,
        createdAt: Date.now(),
        custom: {}
      };

      Object.entries(mapping).forEach(([field, m]) => {
        let val = '';
        if (m.type === 'column') {
          const idx = columns.indexOf(m.value);
          if (idx !== -1) val = sampleData[idx];
        } else {
          val = m.value;
        }

        // Phone sanitization: remove everything except digits and '+'
        if (field === 'phone' && val) {
          const str = String(val);
          const hasPlus = str.includes('+');
          const digits = str.replace(/[^0-9]/g, '');
          val = (hasPlus ? '+' : '') + digits;
        }

        if (['name', 'email', 'phone', 'source', 'stage', 'requirement', 'notes', 'followup', 'assign'].includes(field)) {
          lead[field] = val;
        } else {
          lead.custom[field] = val;
        }
      });

      // Add custom mappings
      customMappings.forEach(m => {
        if (!m.field) return;
        let val = '';
        if (m.type === 'column') {
          const idx = columns.indexOf(m.value);
          if (idx !== -1) val = sampleData[idx];
        } else {
          val = m.value;
        }
        lead.custom[m.field] = val;
      });

      if (!lead.name) lead.name = 'Test Lead (No Name)';
      
      await dbWrite(dbOp.update('leads', id(), lead));
      toast('Test lead added to your dashboard! 🚀', 'success');
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
              <option value="">(Select Column)</option>
              {columns.map((c, i) => <option key={i} value={c}>{i}. {c}</option>)}
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

  const appsScriptCode = `// ===== AUTO-PUSH LEADS TO CRM =====
// Step 1: Paste this script into Extensions > Apps Script
// Step 2: Click Save (💾)
// Step 3: Click the ⏰ Triggers icon (left sidebar, clock icon)
// Step 4: Click "+ Add Trigger" and set:
//         Function: onSheetChange
//         Event source: From spreadsheet
//         Event type: On change   ← IMPORTANT: use "On change", NOT "On edit"
// Step 5: Click Save & authorize the permissions

function onSheetChange(e) {
  // "On change" fires for edits, pastes, form submissions, and inserts
  if (!e) return;
  var changeType = e.changeType;
  // We only care about new content being added
  if (changeType !== "EDIT" && changeType !== "INSERT_ROW" && changeType !== "OTHER") return;

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) return; // Only header, no data

  // Track which row we last pushed so we don't send duplicates
  var props = PropertiesService.getScriptProperties();
  var lastPushed = parseInt(props.getProperty("LAST_PUSHED_ROW") || "1", 10);

  if (lastRow <= lastPushed) return; // Nothing new

  // Push all new rows (from lastPushed+1 to lastRow)
  var numCols = sheet.getLastColumn();

  for (var r = lastPushed + 1; r <= lastRow; r++) {
    var data = sheet.getRange(r, 1, 1, numCols).getValues()[0];
    // Skip empty rows (no name in first column)
    if (!data[0] || String(data[0]).trim() === "") continue;

    var payload = {
      "userId": "${ownerId}",
      "actorId": "${user.id}",
      "type": "gsheet_push",
      "data": data
    };

    var options = {
      "method": "post",
      "contentType": "application/json",
      "payload": JSON.stringify(payload),
      "muteHttpExceptions": true
    };

    try {
      var response = UrlFetchApp.fetch("${crmDomain}/api/webhook/gsheets", options);
      Logger.log("Row " + r + " → CRM: " + response.getContentText());
    } catch (err) {
      Logger.log("Row " + r + " FAILED: " + err);
    }
  }

  props.setProperty("LAST_PUSHED_ROW", String(lastRow));
}

// Optional: Run this once manually to push ALL existing rows
function pushAllRows() {
  var props = PropertiesService.getScriptProperties();
  props.setProperty("LAST_PUSHED_ROW", "1"); // Reset tracker
  onSheetChange({ changeType: "OTHER" });    // Trigger push
}
  `;

  return (
    <div className="sheet-config">
      <div className="sh" style={{ marginBottom: 20 }}>
        <button className="btn-icon" onClick={onBack} style={{ marginRight: 15 }}>←</button>
        <div>
          <h3>{editIndex !== null ? 'Edit' : 'New'} Google Sheets Integration</h3>
          <div className="sub">Map spreadsheet columns to CRM lead fields</div>
        </div>
      </div>

      <div className="tw" style={{ padding: 25, marginBottom: 20 }}>
        <div className="fg" style={{ marginBottom: 15 }}>
          <label>Integration Name</label>
          <input 
            value={configName} 
            onChange={e => setConfigName(e.target.value)} 
            placeholder="e.g. Website Leads 2024" 
            style={{ width: '100%', marginBottom: 15 }}
          />

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20, padding: '10px 15px', background: 'var(--bg-soft)', borderRadius: 8 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>Enable Integration</div>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>Turn off to temporarily stop syncing leads from this sheet.</div>
            </div>
            <div className="toggle-group">
               <button className={!disabled ? 'active' : ''} onClick={() => setDisabled(false)}>Enabled</button>
               <button className={disabled ? 'active' : ''} onClick={() => setDisabled(true)} style={{ color: disabled ? '#ef4444' : '' }}>Disabled</button>
            </div>
          </div>

          <label>Spreadsheet URL or ID</label>
          <div style={{ display: 'flex', gap: 10 }}>
            <input 
              value={sheetInput} 
              onChange={e => handleSheetInput(e.target.value)} 
              placeholder="Paste full Google Sheets URL here..." 
              style={{ flex: 1 }}
            />
            <button className="btn btn-primary" onClick={fetchSheetData} disabled={loading}>
              {loading ? 'Connecting...' : 'Fetch Columns'}
            </button>
          </div>
          <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 5 }}>
            Paste the full URL from your browser address bar. We'll handle the rest!
          </div>
        </div>

        {columns.length > 0 && (
          <div className="gs-success-msg">
             <span style={{ fontSize: 20 }}>✓</span>
             <div>
               <strong>Sheet connected — {columns.length} columns detected</strong>
               <div style={{ fontSize: 11 }}>Map each CRM field below to a sheet column or set a fixed value.</div>
             </div>
          </div>
        )}
      </div>

      {columns.length > 0 && (
        <div className="tw" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '15px 25px', borderBottom: '1px solid var(--border)', background: 'var(--bg-soft)', fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Column Mapping
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

            {/* Custom Fields Section */}
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
            <button className="btn btn-secondary" onClick={handleSendTestLead} disabled={!sampleData}>Send Test Lead</button>
            <button className="btn btn-primary" onClick={handleSave}>{editIndex !== null ? 'Update Settings' : 'Save & Enable Sync'}</button>
          </div>
        </div>
      )}

      {existingConfig && (
        <div className="tw" style={{ marginTop: 20, padding: 25 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15 }}>
            <h4 style={{ margin: 0 }}>Real-time Sync (Optional)</h4>
            <button 
              className="btn btn-secondary btn-sm" 
              onClick={() => {
                navigator.clipboard.writeText(appsScriptCode);
                toast('Script copied to clipboard!', 'success');
              }}
            >
              📋 Copy Script
            </button>
          </div>
          <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 15 }}>
            To push leads automatically when you add a row in Google Sheets, add this script to your Spreadsheet:
            <br /><em>Extensions &gt; Apps Script</em>
          </p>
          <pre style={{ background: '#1e293b', color: '#e2e8f0', padding: 15, borderRadius: 8, fontSize: 11, overflowX: 'auto', whiteSpace: 'pre-wrap' }}>
            {appsScriptCode.trim()}
          </pre>
        </div>
      )}

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
