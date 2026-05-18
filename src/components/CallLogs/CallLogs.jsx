import React, { useState, useMemo, useEffect } from 'react';
import db from '../../instant';
import { id } from '@instantdb/react';
import { fmtD, fmtDT, DEFAULT_STAGES, DEFAULT_SOURCES, DEFAULT_REQUIREMENTS, DEFAULT_PROD_CATS } from '../../utils/helpers';
import { EMPTY_LEAD } from '../../utils/constants';
import { useToast } from '../../context/ToastContext';

const CALL_DIRECTIONS = ['Outgoing', 'Incoming', 'Missed'];
const CALL_OUTCOMES = ['Connected', 'No Answer', 'Busy', 'Voicemail', 'Wrong Number', 'Callback Requested'];

const PHONE_ICON = 'M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z';

const directionIcon = (dir) => {
  if (dir === 'Incoming') return { path: 'M16 3l-4 4-4-4 M12 7V1 M5 10v10a2 2 0 002 2h10a2 2 0 002-2V10', color: '#16a34a' };
  if (dir === 'Missed') return { path: 'M1 1l22 22 M16 3l-4 4-4-4 M12 7V1', color: '#ef4444' };
  return { path: 'M8 3l4-1 4 1 M12 2v6 M5 10v10a2 2 0 002 2h10a2 2 0 002-2V10', color: '#2563eb' };
};

const EMPTY_FORM = { phone: '', contactName: '', direction: 'Outgoing', outcome: 'Connected', duration: '', notes: '', leadId: '' };

// Repeat-attempt rollup: consecutive unpicked calls to the same number by the
// same staff within 24 hours collapse into one row showing "× N". A call is
// "not picked" when its duration is 0 — the only reliable signal, since the
// mobile app sometimes labels unpicked calls as outcome='Connected'. Calls
// with real duration always render as individual rows.
const REPEAT_GROUP_WINDOW_MS = 24 * 60 * 60 * 1000;
const isUnpickedCall = (l) => !l.duration || Number(l.duration) === 0;

export default function CallLogs({ user, perms, ownerId, planEnforcement }) {
  const canCreate = perms?.can('CallLogs', 'create') === true;
  const canEdit = perms?.can('CallLogs', 'edit') === true;
  const canDelete = perms?.can('CallLogs', 'delete') === true;
  const toast = useToast();

  const [modal, setModal] = useState(false);
  const [editData, setEditData] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [search, setSearch] = useState('');
  const [dirFilter, setDirFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [staffFilter, setStaffFilter] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [colModal, setColModal] = useState(false);
  const [tempCols, setTempCols] = useState([]);
  const [tempPageSize, setTempPageSize] = useState(25);
  const [addLeadModal, setAddLeadModal] = useState(false);
  const [addLeadLog, setAddLeadLog] = useState(null);
  const [addLeadForm, setAddLeadForm] = useState({ ...EMPTY_LEAD });
  const [savingLead, setSavingLead] = useState(false);
  const [groupRepeats, setGroupRepeats] = useState(() => {
    try { return localStorage.getItem(`callLogGroupRepeats_${user.email}`) !== 'false'; } catch { return true; }
  });

  // FIX 1: Split into critical (immediate) + deferred (background) queries
  // Critical data — callLogs + profile must load before table can render
  const { data: coreData, isLoading: coreLoading } = db.useQuery({
    callLogs: { $: { where: { userId: ownerId } } },
    userProfiles: { $: { where: { userId: ownerId } } },
  });

  // Deferred data — team only; leads moved to server fetch below
  const { data: deferredData } = db.useQuery({
    teamMembers: { $: { where: { userId: ownerId } } },
  });

  const callLogs = useMemo(() => (coreData?.callLogs || []).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)), [coreData?.callLogs]);
  const profile = coreData?.userProfiles?.[0];

  // Leads: localStorage cache (5-min TTL) + server fetch on mount.
  // Replaced the limit:10000 subscription that timed out at 11k leads.
  const LEADS_CACHE_KEY = `leads_cache_${ownerId}`;
  const [fetchedLeads, setFetchedLeads] = useState(() => {
    try {
      const raw = localStorage.getItem(`leads_cache_${ownerId}`);
      if (!raw) return [];
      const { data: cached, timestamp } = JSON.parse(raw);
      if (Date.now() - timestamp < 5 * 60 * 1000) return cached;
    } catch { /* ignore */ }
    return [];
  });

  useEffect(() => {
    if (!ownerId) return;
    fetch('/api/leads-page', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ownerId, mode: 'kanban', tab: 'all', page: 1, pageSize: 1000, isOwner: true, teamCanSeeAllLeads: true, boundaries: {} }),
    })
      .then(r => r.json())
      .then(json => {
        const items = json.items || [];
        setFetchedLeads(items);
        try { localStorage.setItem(LEADS_CACHE_KEY, JSON.stringify({ data: items, timestamp: Date.now() })); } catch { /* ignore */ }
      })
      .catch(() => { /* keep cached */ });
  }, [ownerId]);

  const allLeads = fetchedLeads;
  const team = deferredData?.teamMembers || [];

  const allStages = profile?.stages || DEFAULT_STAGES;
  const disabledStages = profile?.disabledStages || [];
  const activeStages = allStages.filter(s => !disabledStages.includes(s));
  const activeSources = profile?.sources || DEFAULT_SOURCES;
  const activeRequirements = profile?.requirements || DEFAULT_REQUIREMENTS;
  const productCats = profile?.productCats || DEFAULT_PROD_CATS;
  const customFields = profile?.customFields || [];

  // Configure View — column visibility & page size persistence
  const allPossibleCols = ['Direction', 'Phone', 'Contact', 'Lead', 'Outcome', 'Duration', 'Staff', 'Date & Time', 'Notes'];
  const myViewConfig = useMemo(() => {
    try { return JSON.parse(localStorage.getItem(`callLogView_${user.email}`)); } catch { return null; }
  }, [user.email]);
  const savedCols = myViewConfig?.callLogCols;
  const savedDefaultPageSize = myViewConfig?.defaultPageSize;
  const activeCols = savedCols && savedCols.length > 0 ? savedCols : allPossibleCols;

  // Sync saved page size on mount
  useMemo(() => {
    if (savedDefaultPageSize && savedDefaultPageSize !== pageSize) {
      setPageSize(savedDefaultPageSize);
      setTempPageSize(savedDefaultPageSize);
    }
  }, [savedDefaultPageSize]);

  const saveViewConfig = (colsToSave, defaultSize) => {
    localStorage.setItem(`callLogView_${user.email}`, JSON.stringify({ callLogCols: colsToSave, defaultPageSize: defaultSize }));
    setPageSize(defaultSize);
    setColModal(false);
    toast('View configuration saved', 'success');
  };

  const resetViewConfig = () => {
    localStorage.removeItem(`callLogView_${user.email}`);
    setPageSize(25);
    setColModal(false);
    toast('View reset to default', 'success');
  };

  // Normalize phone to last 10 digits (handles +91, 091, plain formats)
  const normalize = (p) => p ? p.replace(/\D/g, '').slice(-10) : '';

  // FIX 2: Pre-build phone index for O(1) lookups (was O(n) linear scan through 1390+ leads)
  const leadPhoneIndex = useMemo(() => {
    const index = {};
    allLeads.forEach(l => {
      if (l.phone) {
        const n = normalize(l.phone);
        if (n.length >= 7) index[n] = l;
      }
    });
    return index;
  }, [allLeads]);

  // Also build id index for fast leadId lookups in table rows
  const leadIdIndex = useMemo(() => {
    const index = {};
    allLeads.forEach(l => { index[l.id] = l; });
    return index;
  }, [allLeads]);

  // Auto-match phone to lead — O(1) instead of O(n)
  const matchLead = (phone) => {
    const n = normalize(phone);
    if (n.length < 7) return null;
    return leadPhoneIndex[n] || null;
  };

  const openAddAsLead = (log) => {
    setAddLeadLog(log);
    setAddLeadForm({
      ...EMPTY_LEAD,
      name: log.contactName || '',
      phone: log.phone || '',
      productCat: productCats[0] || '',
    });
    setAddLeadModal(true);
  };

  const lf = (key) => (e) => {
    const val = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setAddLeadForm(f => ({ ...f, [key]: val }));
  };
  const lcf = (fieldName) => (e) => setAddLeadForm(f => ({ ...f, custom: { ...f.custom, [fieldName]: e.target.value } }));

  const saveAsLead = async () => {
    if (!addLeadForm.name.trim()) { toast('Name is required', 'error'); return; }
    if (!addLeadForm.source) { toast('Please select a source', 'error'); return; }
    if (!addLeadForm.stage) { toast('Please select a stage', 'error'); return; }
    setSavingLead(true);
    try {
      // Duplicate check before creating
      const dupRes = await fetch('/api/lead-check-duplicate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerId, phone: addLeadForm.phone, email: addLeadForm.email }),
      });
      const dupData = await dupRes.json();
      if (dupData.duplicate) {
        const d = dupData.duplicate;
        const proceed = window.confirm(
          `A ${d.type} with the same ${d.matchedOn} already exists:\n\n` +
          `Name: ${d.name}\nPhone: ${d.phone}\nEmail: ${d.email}\n\n` +
          `Do you still want to create this lead?`
        );
        if (!proceed) { setSavingLead(false); return; }
      }

      const newLeadId = id();
      await db.transact([
        db.tx.leads[newLeadId].update({
          ...addLeadForm,
          userId: ownerId,
          actorId: user.id,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }),
        db.tx.callLogs[addLeadLog.id].update({
          leadId: newLeadId,
          leadName: addLeadForm.name,
          updatedAt: Date.now(),
        }),
      ]);
      toast('Lead created and call log linked', 'success');
      setAddLeadModal(false);
    } catch (e) { toast(e.message, 'error'); }
    finally { setSavingLead(false); }
  };

  const today = new Date().toISOString().split('T')[0];

  // Per-team-member call breakdown — filtered by active date range (defaults to today)
  const summaryDateLabel = dateFrom && dateTo && dateFrom === dateTo
    ? dateFrom
    : dateFrom && dateTo
      ? `${dateFrom} – ${dateTo}`
      : dateFrom
        ? `From ${dateFrom}`
        : dateTo
          ? `Up to ${dateTo}`
          : `Today (${today})`;

  const teamCallStats = useMemo(() => {
    return team.map(m => {
      const allMemberLogs = callLogs.filter(l => l.staffEmail === m.email);
      // Apply date filter if set, otherwise default to today
      const memberLogs = allMemberLogs.filter(l => {
        const d = l.createdAt ? new Date(l.createdAt).toISOString().split('T')[0] : null;
        if (!d) return false;
        if (dateFrom || dateTo) {
          if (dateFrom && d < dateFrom) return false;
          if (dateTo && d > dateTo) return false;
          return true;
        }
        return d === today;
      });
      return {
        name: m.name,
        email: m.email,
        total: memberLogs.length,
        // Duration is the only honest signal — outcome label is unreliable
        connected: memberLogs.filter(l => l.duration && Number(l.duration) > 0).length,
        toLeads: memberLogs.filter(l => l.leadId).length,
        toUnknown: memberLogs.filter(l => !l.leadId).length,
        outgoing: memberLogs.filter(l => l.direction === 'Outgoing').length,
        incoming: memberLogs.filter(l => l.direction === 'Incoming').length,
        missed: memberLogs.filter(l => l.direction === 'Missed').length,
        notPicked: memberLogs.filter(l => l.direction === 'Outgoing' && (!l.duration || Number(l.duration) === 0)).length,
      };
    });
  }, [team, callLogs, today, dateFrom, dateTo]);

  // Filtered logs
  const filtered = useMemo(() => {
    let list = callLogs;
    if (search) {
      const s = search.toLowerCase();
      list = list.filter(l => (l.phone || '').toLowerCase().includes(s) || (l.contactName || '').toLowerCase().includes(s) || (l.notes || '').toLowerCase().includes(s));
    }
    if (dirFilter) list = list.filter(l => l.direction === dirFilter);
    if (staffFilter) list = list.filter(l => l.staffEmail === staffFilter);
    if (dateFrom) list = list.filter(l => l.createdAt && new Date(l.createdAt).toISOString().split('T')[0] >= dateFrom);
    if (dateTo) list = list.filter(l => l.createdAt && new Date(l.createdAt).toISOString().split('T')[0] <= dateTo);
    setCurrentPage(1);
    return list;
  }, [callLogs, search, dirFilter, staffFilter, dateFrom, dateTo]);

  // Collapse consecutive unpicked attempts to the same number/staff/direction
  // within 24h into a single synthetic row with an attemptCount. Connected
  // calls always stay as individual rows.
  const grouped = useMemo(() => {
    if (!groupRepeats) return filtered;
    const result = [];
    let i = 0;
    while (i < filtered.length) {
      const log = filtered[i];
      if (!isUnpickedCall(log)) { result.push(log); i++; continue; }
      const phone = normalize(log.phone);
      const group = [log];
      let j = i + 1;
      while (j < filtered.length) {
        const next = filtered[j];
        if (!isUnpickedCall(next)) break;
        if (normalize(next.phone) !== phone) break;
        if ((next.staffEmail || '') !== (log.staffEmail || '')) break;
        if ((next.direction || '') !== (log.direction || '')) break;
        const last = group[group.length - 1];
        if (Math.abs((last.createdAt || 0) - (next.createdAt || 0)) > REPEAT_GROUP_WINDOW_MS) break;
        group.push(next);
        j++;
      }
      if (group.length === 1) {
        result.push(log);
      } else {
        result.push({
          ...log,
          attemptCount: group.length,
          firstAttemptAt: Math.min(...group.map(g => g.createdAt || 0)),
          lastAttemptAt: Math.max(...group.map(g => g.createdAt || 0)),
          groupedIds: group.map(g => g.id),
        });
      }
      i = j;
    }
    return result;
  }, [filtered, groupRepeats]);

  const totalPages = pageSize === 'all' ? 1 : Math.ceil(grouped.length / pageSize);
  const paged = useMemo(() => {
    if (pageSize === 'all') return grouped;
    const start = (currentPage - 1) * pageSize;
    return grouped.slice(start, start + pageSize);
  }, [grouped, currentPage, pageSize]);

  const toggleGroupRepeats = () => {
    const next = !groupRepeats;
    setGroupRepeats(next);
    try { localStorage.setItem(`callLogGroupRepeats_${user.email}`, String(next)); } catch { /* ignore */ }
  };


  const openNew = () => { setForm(EMPTY_FORM); setEditData(null); setModal(true); };
  const openEdit = (log) => {
    setEditData(log);
    setForm({ phone: log.phone || '', contactName: log.contactName || '', direction: log.direction || 'Outgoing', outcome: log.outcome || 'Connected', duration: log.duration || '', notes: log.notes || '', leadId: log.leadId || '' });
    setModal(true);
  };

  const save = async () => {
    if (!form.phone) { toast('Phone number is required', 'error'); return; }
    const matched = matchLead(form.phone);
    const payload = {
      ...form,
      duration: form.duration ? Number(form.duration) : 0,
      contactName: form.contactName || matched?.name || '',
      leadId: form.leadId || matched?.id || '',
      leadName: matched?.name || form.contactName || '',
      staffEmail: user.email,
      staffName: team.find(t => t.email === user.email)?.name || user.email,
      userId: ownerId,
      updatedAt: Date.now(),
    };
    try {
      if (editData) {
        await db.transact(db.tx.callLogs[editData.id].update(payload));
        toast('Call log updated', 'success');
      } else {
        payload.createdAt = Date.now();
        payload.actorId = user.id;
        await db.transact(db.tx.callLogs[id()].update(payload));
        toast('Call logged', 'success');
      }
      setModal(false);
    } catch (e) { toast(e.message, 'error'); }
  };

  const remove = async (logIdOrIds) => {
    // Accepts either a single id or an array (grouped row → delete all attempts)
    const ids = Array.isArray(logIdOrIds) ? logIdOrIds : [logIdOrIds];
    const msg = ids.length === 1 ? 'Delete this call log?' : `Delete all ${ids.length} grouped attempts?`;
    if (!window.confirm(msg)) return;
    try {
      // Hard delete (per CLAUDE.md rule) — also runs as a single transaction
      // so the rows disappear atomically.
      await db.transact(ids.map(id => db.tx.callLogs[id].delete()));
      toast(ids.length === 1 ? 'Call log deleted' : `${ids.length} attempts deleted`, 'success');
    } catch (e) { toast(e.message, 'error'); }
  };

  // Only block render on critical data (callLogs + profile), not on leads/team
  if (coreLoading) return <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" style={{ width: 20, height: 20, margin: '0 auto' }} /><p style={{ color: 'var(--muted)', marginTop: 8 }}>Loading call logs...</p></div>;

  return (
    <div style={{ padding: '20px 24px', maxWidth: 1200 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Call Logs</h2>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--muted)' }}>Track all incoming and outgoing calls</p>
        </div>
        {canCreate && (
          <button onClick={openNew} className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 600 }}>
            <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" strokeWidth="2.5" fill="none"><path d={PHONE_ICON} /></svg>
            Log Call
          </button>
        )}
      </div>

      {/* Team Member Call Summary */}
      {(perms?.isOwner || perms?.isAdmin || perms?.isManager) && team.length > 0 && (
        <div style={{ border: '1px solid var(--border)', borderRadius: 10, background: 'var(--card)', overflow: 'hidden', marginBottom: 20 }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', background: 'var(--bg)' }}>
            <h4 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>Team Member Call Summary</h4>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', fontSize: 13 }}>
              <thead>
                <tr style={{ background: 'var(--bg)' }}>
                  <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 600 }}>Member</th>
                  <th style={{ padding: '8px 12px', textAlign: 'center', fontWeight: 600 }}>Total</th>
                  <th style={{ padding: '8px 12px', textAlign: 'center', fontWeight: 600 }}>Connected</th>
                  <th style={{ padding: '8px 12px', textAlign: 'center', fontWeight: 600 }}>To Leads</th>
                  <th style={{ padding: '8px 12px', textAlign: 'center', fontWeight: 600 }}>Unknown</th>
                  <th style={{ padding: '8px 12px', textAlign: 'center', fontWeight: 600 }}>Outgoing</th>
                  <th style={{ padding: '8px 12px', textAlign: 'center', fontWeight: 600 }}>Incoming</th>
                  <th style={{ padding: '8px 12px', textAlign: 'center', fontWeight: 600 }}>Missed</th>
                  <th style={{ padding: '8px 12px', textAlign: 'center', fontWeight: 600 }}>Not Picked</th>
                </tr>
              </thead>
              <tbody>
                {teamCallStats.map(m => (
                  <tr key={m.email} style={{ borderTop: '1px solid var(--border)', cursor: 'pointer' }} onClick={() => setStaffFilter(m.email)}>
                    <td style={{ padding: '8px 12px', fontWeight: 600 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ width: 26, height: 26, background: 'var(--accent)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 11, fontWeight: 700 }}>{m.name.charAt(0).toUpperCase()}</div>
                        {m.name}
                      </div>
                    </td>
                    <td style={{ padding: '8px 12px', textAlign: 'center', fontWeight: 600 }}>{m.total}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'center', color: '#16a34a', fontWeight: 600 }}>{m.connected}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'center', color: '#8b5cf6', fontWeight: 600 }}>{m.toLeads}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'center', color: '#f59e0b', fontWeight: 600 }}>{m.toUnknown}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'center', color: '#2563eb' }}>{m.outgoing}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'center', color: '#16a34a' }}>{m.incoming}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'center', color: '#ef4444' }}>{m.missed}</td>
                    <td style={{ padding: '8px 12px', textAlign: 'center', color: '#f97316', fontWeight: 600 }}>{m.notPicked}</td>
                  </tr>
                ))}

                <tr style={{ borderTop: '2px solid var(--border)', background: 'var(--bg)', fontWeight: 700 }}>
                  <td style={{ padding: '8px 12px', fontWeight: 700 }}>Total</td>
                  <td style={{ padding: '8px 12px', textAlign: 'center', fontWeight: 700 }}>{teamCallStats.reduce((s, m) => s + m.total, 0)}</td>
                  <td style={{ padding: '8px 12px', textAlign: 'center', color: '#16a34a', fontWeight: 700 }}>{teamCallStats.reduce((s, m) => s + m.connected, 0)}</td>
                  <td style={{ padding: '8px 12px', textAlign: 'center', color: '#8b5cf6', fontWeight: 700 }}>{teamCallStats.reduce((s, m) => s + m.toLeads, 0)}</td>
                  <td style={{ padding: '8px 12px', textAlign: 'center', color: '#f59e0b', fontWeight: 700 }}>{teamCallStats.reduce((s, m) => s + m.toUnknown, 0)}</td>
                  <td style={{ padding: '8px 12px', textAlign: 'center', color: '#2563eb', fontWeight: 700 }}>{teamCallStats.reduce((s, m) => s + m.outgoing, 0)}</td>
                  <td style={{ padding: '8px 12px', textAlign: 'center', color: '#16a34a', fontWeight: 700 }}>{teamCallStats.reduce((s, m) => s + m.incoming, 0)}</td>
                  <td style={{ padding: '8px 12px', textAlign: 'center', color: '#ef4444', fontWeight: 700 }}>{teamCallStats.reduce((s, m) => s + m.missed, 0)}</td>
                  <td style={{ padding: '8px 12px', textAlign: 'center', color: '#f97316', fontWeight: 700 }}>{teamCallStats.reduce((s, m) => s + m.notPicked, 0)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          placeholder="Search phone, name, notes..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ padding: '7px 12px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13, width: 220 }}
        />
        <select value={dirFilter} onChange={e => setDirFilter(e.target.value)} style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13 }}>
          <option value="">All Directions</option>
          {CALL_DIRECTIONS.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13 }} title="From date" />
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>to</span>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13 }} title="To date" />
        </div>
        {(perms?.isOwner || perms?.isAdmin || perms?.isManager) && (
          <select value={staffFilter} onChange={e => setStaffFilter(e.target.value)} style={{ padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13 }}>
            <option value="">All Staff</option>
            {team.map(t => <option key={t.id} value={t.email}>{t.name}</option>)}
          </select>
        )}
        {(search || dirFilter || dateFrom || dateTo || staffFilter) && (
          <button onClick={() => { setSearch(''); setDirFilter(''); setDateFrom(''); setDateTo(''); setStaffFilter(''); }} style={{ padding: '7px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--card)', fontSize: 12, cursor: 'pointer' }}>Clear</button>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>
            {filtered.length} record{filtered.length !== 1 ? 's' : ''}
            {groupRepeats && grouped.length !== filtered.length && (
              <> · <strong>{grouped.length}</strong> rows (grouped)</>
            )}
          </span>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--muted)', cursor: 'pointer' }} title="Collapse consecutive unanswered calls to the same number into one row">
            <input type="checkbox" checked={groupRepeats} onChange={toggleGroupRepeats} style={{ margin: 0 }} />
            Group repeats
          </label>
          <button className="btn btn-secondary btn-sm" onClick={() => {
            setTempCols(activeCols);
            setTempPageSize(pageSize);
            setColModal(true);
          }}>⚙ Configure View</button>
        </div>
      </div>

      {/* Table Container */}
      <div style={{ border: '1px solid var(--border)', borderRadius: 10, background: 'var(--card)', overflow: 'hidden' }}>

        {/* Top Pagination Bar */}
        <div style={{ padding: '8px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)', background: 'var(--bg)', gap: 15 }}>
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
              <button className="btn btn-secondary btn-sm" disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)} style={{ padding: '2px 8px', fontSize: 11 }}>Prev</button>
              <div style={{ display: 'flex', gap: 4 }}>
                {[...Array(totalPages)].map((_, i) => {
                  const pg = i + 1;
                  if (Math.abs(currentPage - pg) > 1 && pg !== 1 && pg !== totalPages) return null;
                  return (
                    <React.Fragment key={pg}>
                      {pg === totalPages && Math.abs(currentPage - pg) > 2 && <span style={{ color: 'var(--muted)', fontSize: 10 }}>...</span>}
                      <button className={`btn btn-sm ${currentPage === pg ? 'btn-primary' : 'btn-secondary'}`} style={{ minWidth: 26, height: 26, padding: 0, fontSize: 11 }} onClick={() => setCurrentPage(pg)}>{pg}</button>
                      {pg === 1 && Math.abs(currentPage - pg) > 2 && <span style={{ color: 'var(--muted)', fontSize: 10 }}>...</span>}
                    </React.Fragment>
                  );
                })}
              </div>
              <button className="btn btn-secondary btn-sm" disabled={currentPage === totalPages} onClick={() => setCurrentPage(p => p + 1)} style={{ padding: '2px 8px', fontSize: 11 }}>Next</button>
            </div>
          )}
        </div>

        {/* Table */}
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--bg)', borderBottom: '1px solid var(--border)' }}>
                <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, whiteSpace: 'nowrap', width: 36 }}>#</th>
                {activeCols.includes('Direction') && <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, whiteSpace: 'nowrap' }}>Direction</th>}
                {activeCols.includes('Phone') && <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, whiteSpace: 'nowrap' }}>Phone</th>}
                {activeCols.includes('Contact') && <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, whiteSpace: 'nowrap' }}>Contact</th>}
                {activeCols.includes('Lead') && <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, whiteSpace: 'nowrap' }}>Lead</th>}
                {activeCols.includes('Outcome') && <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, whiteSpace: 'nowrap' }}>Outcome</th>}
                {activeCols.includes('Duration') && <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, whiteSpace: 'nowrap' }}>Duration</th>}
                {activeCols.includes('Staff') && <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, whiteSpace: 'nowrap' }}>Staff</th>}
                {activeCols.includes('Date & Time') && <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, whiteSpace: 'nowrap' }}>Date & Time</th>}
                {activeCols.includes('Notes') && <th style={{ padding: '10px 12px', textAlign: 'left', fontWeight: 600, whiteSpace: 'nowrap' }}>Notes</th>}
                <th style={{ padding: '10px 12px', textAlign: 'center', fontWeight: 600, width: 80 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {paged.length === 0 && (
                <tr><td colSpan={activeCols.length + 2} style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>
                  {filtered.length === 0 && callLogs.length === 0 ? 'No call logs yet. Click "Log Call" to add one.' : 'No matching records.'}
                </td></tr>
              )}
              {paged.map((log, i) => {
                const di = directionIcon(log.direction);
                // FIX 2: O(1) index lookups instead of O(n) array scans
                const matchedLead = log.leadId
                  ? (leadIdIndex[log.leadId] || matchLead(log.phone))
                  : matchLead(log.phone);
                const rowNum = (currentPage - 1) * (pageSize === 'all' ? 0 : pageSize) + i + 1;
                return (
                  <tr key={log.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '10px 12px', fontSize: 11, color: 'var(--muted)' }}>{rowNum}</td>
                    {activeCols.includes('Direction') && (
                      <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: di.color, fontWeight: 600, fontSize: 12 }}>
                          <svg viewBox="0 0 24 24" width="14" height="14" stroke={di.color} strokeWidth="2" fill="none"><path d={PHONE_ICON} /></svg>
                          {log.direction || 'Outgoing'}
                        </span>
                      </td>
                    )}
                    {activeCols.includes('Phone') && <td style={{ padding: '10px 12px', fontFamily: 'monospace', fontSize: 12 }}>{log.phone}</td>}
                    {activeCols.includes('Contact') && (
                      <td style={{ padding: '10px 12px' }}>
                        {log.contactName || '-'}
                        {log.attemptCount > 1 && (
                          <span style={{ marginLeft: 8, fontSize: 10, padding: '2px 7px', borderRadius: 10, background: '#fef3c7', color: '#92400e', fontWeight: 700 }} title={`First: ${fmtDT(log.firstAttemptAt)}\nLast: ${fmtDT(log.lastAttemptAt)}`}>
                            × {log.attemptCount}
                          </span>
                        )}
                      </td>
                    )}
                    {activeCols.includes('Lead') && (
                      <td style={{ padding: '10px 12px' }}>
                        {matchedLead ? (
                          <span style={{ color: '#2563eb', fontSize: 12, fontWeight: 500 }}>{matchedLead.name}</span>
                        ) : (
                          <span style={{ fontSize: 11, color: '#f59e0b', fontWeight: 500 }}>Unmatched</span>
                        )}
                      </td>
                    )}
                    {activeCols.includes('Outcome') && (
                      <td style={{ padding: '10px 12px' }}>
                        {(() => {
                          // Duration is the source of truth — outcome label is unreliable
                          const isConnected = log.duration && Number(log.duration) > 0;
                          const isNotPicked = !isConnected && log.direction === 'Outgoing';
                          const label = isConnected ? 'Connected' : isNotPicked ? 'Not Picked' : log.outcome || 'No Answer';
                          const bg = isConnected ? '#f0fdf4' : (isNotPicked || log.outcome === 'No Answer' || log.direction === 'Missed') ? '#fef2f2' : '#f8fafc';
                          const fg = isConnected ? '#16a34a' : (isNotPicked || log.outcome === 'No Answer' || log.direction === 'Missed') ? '#ef4444' : '#64748b';
                          return <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: bg, color: fg, fontWeight: 500 }}>{label}</span>;
                        })()}
                      </td>
                    )}
                    {activeCols.includes('Duration') && <td style={{ padding: '10px 12px', fontSize: 12 }}>{log.duration && Number(log.duration) > 0 ? `${Math.floor(Number(log.duration) / 60)}:${String(Number(log.duration) % 60).padStart(2, '0')}` : '-'}</td>}
                    {activeCols.includes('Staff') && <td style={{ padding: '10px 12px', fontSize: 12 }}>{log.staffName || '-'}</td>}
                    {activeCols.includes('Date & Time') && (
                      <td style={{ padding: '10px 12px', fontSize: 12, whiteSpace: 'nowrap' }}>
                        {log.attemptCount > 1
                          ? <span title={`First: ${fmtDT(log.firstAttemptAt)}\nLast: ${fmtDT(log.lastAttemptAt)}`}>Last: {fmtDT(log.lastAttemptAt)}</span>
                          : fmtDT(log.createdAt)}
                      </td>
                    )}
                    {activeCols.includes('Notes') && <td style={{ padding: '10px 12px', fontSize: 12, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={log.notes}>{log.notes || '-'}</td>}
                    <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                      <div style={{ display: 'flex', gap: 4, justifyContent: 'center' }}>
                        {canCreate && !matchedLead && (
                          <button onClick={() => openAddAsLead(log)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#16a34a', padding: 4 }} title="Add as Lead">
                            <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" strokeWidth="2" fill="none"><path d="M16 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="8.5" cy="7" r="4" /><line x1="20" y1="8" x2="20" y2="14" /><line x1="23" y1="11" x2="17" y2="11" /></svg>
                          </button>
                        )}
                        {canEdit && (
                          <button onClick={() => openEdit(log)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#2563eb', padding: 4 }} title="Edit">
                            <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" strokeWidth="2" fill="none"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                          </button>
                        )}
                        {canDelete && (
                          <button onClick={() => remove(log.groupedIds || log.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', padding: 4 }} title={log.attemptCount > 1 ? `Delete all ${log.attemptCount} attempts` : 'Delete'}>
                            <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" strokeWidth="2" fill="none"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" /></svg>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Bottom Pagination */}
        {pageSize !== 'all' && totalPages > 1 && (
          <div style={{ padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--border)', background: 'var(--bg)', flexWrap: 'wrap', gap: 15 }}>
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>
              Showing <strong>{(currentPage - 1) * pageSize + 1}</strong> to <strong>{Math.min(currentPage * pageSize, filtered.length)}</strong> of <strong>{filtered.length}</strong> records
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
              <button className="btn btn-secondary btn-sm" disabled={currentPage === 1} onClick={() => setCurrentPage(p => p - 1)} style={{ padding: '4px 10px' }}>Prev</button>
              {[...Array(totalPages)].map((_, i) => {
                const pg = i + 1;
                const isNear = Math.abs(currentPage - pg) <= 2;
                const isEdge = pg === 1 || pg === totalPages;
                if (!isNear && !isEdge) return null;
                return (
                  <React.Fragment key={pg}>
                    {isEdge && pg === totalPages && Math.abs(currentPage - pg) > 3 && <span style={{ color: 'var(--muted)', alignSelf: 'center' }}>...</span>}
                    <button className={`btn btn-sm ${currentPage === pg ? 'btn-primary' : 'btn-secondary'}`} style={{ minWidth: 32, padding: 0 }} onClick={() => setCurrentPage(pg)}>{pg}</button>
                    {isEdge && pg === 1 && Math.abs(currentPage - pg) > 3 && <span style={{ color: 'var(--muted)', alignSelf: 'center' }}>...</span>}
                  </React.Fragment>
                );
              })}
              <button className="btn btn-secondary btn-sm" disabled={currentPage === totalPages} onClick={() => setCurrentPage(p => p + 1)} style={{ padding: '4px 10px' }}>Next</button>
            </div>
          </div>
        )}
      </div>

      {/* Configure View Modal */}
      {colModal && (
        <div className="mo open">
          <div className="mo-box" style={{ width: 480 }}>
            <div className="mo-head">
              <h3>Configure View</h3>
              <button className="btn-icon" onClick={() => setColModal(false)}>✕</button>
            </div>
            <div className="mo-body" style={{ display: 'flex', flexDirection: 'column', gap: 20, maxHeight: '60vh', overflowY: 'auto' }}>
              {/* Visible Columns */}
              <div>
                <strong style={{ fontSize: 13, color: 'var(--text)', marginBottom: 12, display: 'block' }}>Visible Columns</strong>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  {allPossibleCols.map(c => (
                    <label key={c} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
                      <input type="checkbox" checked={tempCols.includes(c)} onChange={e => {
                        if (e.target.checked) setTempCols([...tempCols, c]);
                        else setTempCols(tempCols.filter(x => x !== c));
                      }} style={{ width: 16, height: 16, accentColor: 'var(--accent)' }} />
                      {c}
                    </label>
                  ))}
                </div>
              </div>

              {/* Default Page Size */}
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
                <strong style={{ fontSize: 13, color: 'var(--text)', marginBottom: 12, display: 'block' }}>Default Records per Page</strong>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {[25, 50, 100, 500].map(size => (
                    <button
                      key={size}
                      className={`btn btn-sm ${tempPageSize === size ? 'btn-primary' : 'btn-secondary'}`}
                      onClick={() => setTempPageSize(size)}
                      style={{ padding: '6px 12px' }}
                    >
                      {size}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="mo-foot" style={{ justifyContent: 'space-between' }}>
              <button className="btn btn-secondary btn-sm" onClick={resetViewConfig}>Reset to Default</button>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-secondary btn-sm" onClick={() => setColModal(false)}>Cancel</button>
                <button className="btn btn-primary btn-sm" onClick={() => saveViewConfig(tempCols, tempPageSize)}>Save View</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add as Lead Modal — same form as LeadsView create */}
      {addLeadModal && (
        <div className="mo open">
          <div className="mo-box wide">
            <div className="mo-head">
              <h3>Add as Lead</h3>
              <button className="btn-icon" onClick={() => setAddLeadModal(false)}>✕</button>
            </div>
            <div className="mo-body">
              <div className="fgrid">
                <div className="fg"><label>Name *</label><input value={addLeadForm.name} onChange={lf('name')} placeholder="Lead name" autoFocus /></div>
                <div className="fg"><label>Company Name (Optional)</label><input value={addLeadForm.companyName} onChange={lf('companyName')} placeholder="Business name" /></div>
                <div className="fg"><label>Phone</label><input value={addLeadForm.phone} onChange={lf('phone')} placeholder="+91..." /></div>
                <div className="fg"><label>Email</label><input type="email" value={addLeadForm.email} onChange={lf('email')} /></div>
                <div className="fg"><label>Source *</label>
                  <select value={addLeadForm.source} onChange={lf('source')}>
                    {!addLeadForm.source && <option value="">Select Source</option>}
                    {activeSources.map(s => <option key={s}>{s}</option>)}
                  </select>
                </div>
                <div className="fg"><label>Stage *</label>
                  <select value={addLeadForm.stage} onChange={lf('stage')}>
                    {!addLeadForm.stage && <option value="">Select Stage</option>}
                    {activeStages.map(s => <option key={s}>{s}</option>)}
                  </select>
                </div>
                <div className="fg"><label>Assign To</label>
                  <select value={addLeadForm.assign} onChange={lf('assign')}>
                    <option value="">Unassigned</option>
                    {team.map(t => <option key={t.id}>{t.name}</option>)}
                  </select>
                </div>
                <div className="fg"><label>Follow Up</label><input type="datetime-local" value={addLeadForm.followup} onChange={lf('followup')} /></div>
                <div className="fg"><label>Requirement</label>
                  <select value={addLeadForm.requirement} onChange={lf('requirement')}>
                    {!addLeadForm.requirement && <option value="">Select Requirement</option>}
                    {activeRequirements.map(r => <option key={r}>{r}</option>)}
                  </select>
                </div>
                <div className="fg"><label>Product Category</label>
                  <select value={addLeadForm.productCat} onChange={lf('productCat')}>
                    {productCats.map(p => <option key={p}>{p}</option>)}
                  </select>
                </div>
                <div className="fg span2"><label>Notes</label><textarea value={addLeadForm.notes} onChange={lf('notes')} /></div>

                {/* Dynamic Custom Fields */}
                {customFields.length > 0 && <div className="fg span2" style={{ borderTop: '1px solid var(--border)', paddingTop: 16, marginTop: 4 }}><h4 style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 12 }}>Custom Fields</h4><div className="fgrid">
                  {customFields.map(field => (
                    <div key={field.name} className="fg">
                      <label>{field.name}</label>
                      {field.type === 'dropdown' ? (
                        <select value={addLeadForm.custom?.[field.name] || ''} onChange={lcf(field.name)}>
                          <option value="">Select...</option>
                          {field.options.split(',').map(o => <option key={o.trim()}>{o.trim()}</option>)}
                        </select>
                      ) : (
                        <input type={field.type === 'number' ? 'number' : 'text'} value={addLeadForm.custom?.[field.name] || ''} onChange={lcf(field.name)} />
                      )}
                    </div>
                  ))}
                </div></div>}

                <div className="fg span2">
                  <label>Reminder Channels</label>
                  <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginTop: 6, padding: 12, background: 'var(--bg)', borderRadius: 8, flexWrap: 'wrap' }}>
                    {[['remWA', 'WhatsApp', '#25d366'], ['remEmail', 'Email', '#3b82f6'], ['remSMS', 'SMS', '#8b5cf6']].map(([k, label, color]) => (
                      <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>
                        <input type="checkbox" checked={addLeadForm[k]} onChange={lf(k)} style={{ width: 15, height: 15, accentColor: color }} />
                        <span style={{ color }}>{label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            </div>
            <div className="mo-foot">
              <button className="btn btn-secondary btn-sm" onClick={() => setAddLeadModal(false)}>Cancel</button>
              <button className="btn btn-primary btn-sm" onClick={saveAsLead} disabled={savingLead}>
                {savingLead ? 'Saving...' : 'Create Lead'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Log Call / Edit Modal */}
      {modal && (
        <div className="mo open">
          <div className="mo-box" style={{ width: 600 }}>
            <div className="mo-head">
              <h3>{editData ? 'Edit Call Log' : 'Log a Call'}</h3>
              <button className="btn-icon" onClick={() => setModal(false)}>✕</button>
            </div>
            <div className="mo-body">
              <div className="fgrid">
                <div className="fg">
                  <label>Phone Number *</label>
                  <input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="+91..." />
                  {form.phone && matchLead(form.phone) && (
                    <div style={{ fontSize: 11, color: '#16a34a', marginTop: 2 }}>Matched lead: {matchLead(form.phone).name}</div>
                  )}
                </div>
                <div className="fg">
                  <label>Contact Name</label>
                  <input value={form.contactName} onChange={e => setForm(f => ({ ...f, contactName: e.target.value }))} placeholder="Contact name" />
                </div>
                <div className="fg">
                  <label>Direction</label>
                  <select value={form.direction} onChange={e => setForm(f => ({ ...f, direction: e.target.value }))}>
                    {CALL_DIRECTIONS.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>
                <div className="fg">
                  <label>Outcome</label>
                  <select value={form.outcome} onChange={e => setForm(f => ({ ...f, outcome: e.target.value }))}>
                    {CALL_OUTCOMES.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                </div>
                <div className="fg">
                  <label>Duration (seconds)</label>
                  <input type="number" min="0" value={form.duration} onChange={e => setForm(f => ({ ...f, duration: e.target.value }))} placeholder="0" />
                </div>
                <div className="fg">
                  <label>Link to Lead</label>
                  <select value={form.leadId} onChange={e => setForm(f => ({ ...f, leadId: e.target.value }))}>
                    <option value="">Auto-match or select...</option>
                    {allLeads.map(l => <option key={l.id} value={l.id}>{l.name} {l.phone ? `(${l.phone})` : ''}</option>)}
                  </select>
                </div>
                <div className="fg span2">
                  <label>Notes</label>
                  <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Call notes..." rows={3} />
                </div>
              </div>
            </div>
            <div className="mo-foot">
              <button className="btn btn-secondary btn-sm" onClick={() => setModal(false)}>Cancel</button>
              <button className="btn btn-primary btn-sm" onClick={save}>{editData ? 'Update' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
