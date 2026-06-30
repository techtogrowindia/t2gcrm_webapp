import React, { useState, useMemo } from 'react';
import { logActivity } from '../../utils/activityLogger';
import { dbWrite, dbOp } from '../../utils/dbWrite';
import db from '../../instant';
import { id } from '@instantdb/react';
import { fmtD } from '../../utils/helpers';
import { useApp } from '../../context/AppContext';
import { useToast } from '../../context/ToastContext';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const DEFAULT_HOURS = Object.fromEntries(DAYS.map(d => [d, { 
  enabled: d !== 'Sunday', 
  slots: [{ start: '09:00', end: '18:00' }] 
}]));
const STATUSES = ['Pending', 'Confirmed', 'Completed', 'Cancelled', 'No Show'];
const STATUS_COLORS = {
  Pending: { bg: '#fef3c7', color: '#92400e' },
  Confirmed: { bg: '#dbeafe', color: '#1e40af' },
  Completed: { bg: '#dcfce7', color: '#166534' },
  Cancelled: { bg: '#fee2e2', color: '#991b1b' },
  'No Show': { bg: '#f3f4f6', color: '#374151' },
};

export default function Appointments({ user, ownerId, perms, initialTab, settings }) {
  const toast = useToast();
  const [tab, setTab] = useState(initialTab || 'list'); // list | settings
  const [dateFilter, setDateFilter] = useState('today');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [customRange, setCustomRange] = useState({ 
    start: new Date().toISOString().split('T')[0], 
    end: new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0] 
  });
  const [confModal, setConfModal] = useState(false);
  const [tempConf, setTempConf] = useState({ dateFilter: 'today', statusFilter: 'All' });
  const [initialized, setInitialized] = useState(false);
  const [rescheduleModal, setRescheduleModal] = useState(null);
  const [rsForm, setRsForm] = useState({ date: '', time: '' });
  const [editModal, setEditModal] = useState(null);
  const [editForm, setEditForm] = useState({ notes: '', status: '' });
  const [newNote, setNewNote] = useState('');

  const { data } = db.useQuery({
    appointments: { $: { where: { userId: ownerId } } },
    appointmentSettings: { $: { where: { userId: ownerId } } },
    ecomSettings: { $: { where: { userId: ownerId } } },
    userProfiles: { $: { where: { userId: ownerId } } },
    customers: { $: { where: { userId: ownerId } } },
    teamMembers: { $: { where: { userId: ownerId } } },
  });
  const profile = data?.userProfiles?.[0];
  const ecom = data?.ecomSettings?.[0];
  const appointments = data?.appointments || [];
  const customers = data?.customers || [];
  // leads data fetched on-demand via /api/lead-lookup (avoids 11k+ subscription)
  const [matchedLead, setMatchedLead] = useState(null);
  const team = data?.teamMembers || [];
  const myMember = useMemo(() => user ? team.find(t => t.email === user.email) : null, [team, user]);
  const settingsRecord = data?.appointmentSettings?.[0];
  const settingsId = settingsRecord?.id || id();
  const settingsLogId = settingsRecord?.id || null;
  const { data: settingsLogsData } = db.useQuery(settingsLogId ? {
    activityLogs: { $: { where: { entityId: settingsLogId } } },
  } : {});

  // Fetch matching lead when edit modal opens (server-side lookup avoids 11k+ subscription)
  React.useEffect(() => {
    if (!editModal) { setMatchedLead(null); return; }
    const phone = editModal.customerPhone;
    const email = editModal.customerEmail;
    if (!phone && !email) return;
    fetch('/api/lead-lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ownerId, phone, email }),
    })
      .then(r => r.json())
      .then(d => setMatchedLead(d.lead || null))
      .catch(() => setMatchedLead(null));
  }, [editModal?.id, ownerId]);

  const [settingsForm, setSettingsForm] = useState(null);
  React.useEffect(() => {
    if (settingsRecord && !settingsForm) {
      const parsedHours = settingsRecord.workingHours ? JSON.parse(settingsRecord.workingHours) : DEFAULT_HOURS;
      
      // Migrate old start/end format to slots array
      const migratedHours = {};
      DAYS.forEach(day => {
        const h = parsedHours[day] || { enabled: false };
        if (h.start && h.end && !h.slots) {
          migratedHours[day] = { enabled: h.enabled, slots: [{ start: h.start, end: h.end }] };
        } else if (!h.slots) {
          migratedHours[day] = { enabled: h.enabled, slots: [{ start: '09:00', end: '18:00' }] };
        } else {
          migratedHours[day] = h;
        }
      });

      setSettingsForm({
        workingHours: migratedHours,
        holidays: settingsRecord.holidays ? JSON.parse(settingsRecord.holidays) : [],
        slotDuration: settingsRecord.slotDuration || 30,
        maxPerSlot: settingsRecord.maxPerSlot || 1,
        bookingWindow: settingsRecord.bookingWindow || 1,
        slug: profile?.slug || settingsRecord.slug || '',
        services: settingsRecord.services 
          ? JSON.parse(settingsRecord.services).map(s => typeof s === 'string' ? { name: s, duration: '' } : s) 
          : [{ name: 'General Appointment', duration: '' }],
      });
    } else if (!settingsRecord && !settingsForm) {
      setSettingsForm({ workingHours: DEFAULT_HOURS, holidays: [], slotDuration: 30, maxPerSlot: 1, bookingWindow: 1, slug: profile?.slug || '', services: [{ name: 'General Appointment', duration: '' }] });
    }
  }, [settingsRecord, profile?.slug]);

  // Sync slug if it was initially empty but profile loaded
  React.useEffect(() => {
    if (profile?.slug && settingsForm && !settingsForm.slug) {
      setSettingsForm(p => ({ ...p, slug: profile.slug }));
    }
  }, [profile?.slug, settingsForm?.slug === '']);

  // Load saved default view filters once profile loads
  React.useEffect(() => {
    if (profile && !initialized) {
      if (profile.apptConfig?.dateFilter) setDateFilter(profile.apptConfig.dateFilter);
      if (profile.apptConfig?.statusFilter) setStatusFilter(profile.apptConfig.statusFilter);
      setInitialized(true);
    }
  }, [profile, initialized]);

  const saveConfig = async () => {
    if (profile) {
      await dbWrite(dbOp.update('userProfiles', profile.id, { apptConfig: tempConf }));
      setDateFilter(tempConf.dateFilter);
      setStatusFilter(tempConf.statusFilter);
    }
    setConfModal(false);
    toast('Default view saved!', 'success');
  };

  const saveSettings = async () => {
    const cleanSlug = (settingsForm.slug || '').toLowerCase().trim().replace(/[^a-z0-9-]/g, '-');
    const txs = [
      dbOp.update('appointmentSettings', settingsId, {
        userId: ownerId,
        workingHours: JSON.stringify(settingsForm.workingHours),
        holidays: JSON.stringify(settingsForm.holidays),
        slotDuration: settingsForm.slotDuration,
        maxPerSlot: settingsForm.maxPerSlot,
        bookingWindow: settingsForm.bookingWindow,
        slug: cleanSlug,
        services: JSON.stringify(settingsForm.services),
        updatedAt: Date.now(),
      })
    ];

    if (profile?.id) {
      txs.push(dbOp.update('userProfiles', profile.id, { slug: cleanSlug }));
    }
    if (ecom?.id) {
      txs.push(dbOp.update('ecomSettings', ecom.id, { ecomName: cleanSlug }));
    }

    let logText = [];
    if (settingsRecord) {
      const oldHolidays = settingsRecord.holidays ? JSON.parse(settingsRecord.holidays) : [];
      const newHolidays = settingsForm.holidays;
      const addedHolidays = newHolidays.filter(h => !oldHolidays.includes(h));
      const removedHolidays = oldHolidays.filter(h => !newHolidays.includes(h));

      if (addedHolidays.length > 0) logText.push(`Added holiday(s): ${addedHolidays.join(', ')}`);
      if (removedHolidays.length > 0) logText.push(`Removed holiday(s): ${removedHolidays.join(', ')}`);

      const oldHours = settingsRecord.workingHours || '{}';
      if (oldHours !== JSON.stringify(settingsForm.workingHours)) {
        logText.push('Updated working hours');
      }

      const oldServices = settingsRecord.services || '[]';
      if (oldServices !== JSON.stringify(settingsForm.services)) {
        logText.push('Updated services');
      }
      
      const oldSlotDuration = settingsRecord.slotDuration || 30;
      if (oldSlotDuration !== settingsForm.slotDuration) logText.push(`Changed slot duration to ${settingsForm.slotDuration}m`);
    } else {
      logText.push('Initial appointment settings configured');
    }

    if (logText.length > 0) {
      txs.push(dbOp.update('activityLogs', id(), {
        entityId: settingsId,
        entityType: 'appointmentSettings',
        text: logText.join(' | '),
        userId: ownerId,
        createdAt: Date.now()
      }));
    }

    await dbWrite(txs);
    toast('Availability settings saved!', 'success');
  };

  const updateStatus = async (apptId, status) => {
    if (!status) return true;
    const appt = appointments.find(a => a.id === apptId);
    
    if (appt && appt.status !== status) {
      if (!window.confirm(`Are you sure you want to change the appointment status to ${status}?`)) {
        setTab(tab); // trigger re-render
        return false;
      }
    } else if (appt && appt.status === status) {
      return true; // No status change needed
    }

    const txs = [dbOp.update('appointments', apptId, { status, updatedAt: Date.now() })];
    
    if (status === 'Completed' && appt) {
      const existingCustomer = customers.find(c => c.phone === appt.customerPhone || (c.email && c.email === appt.customerEmail));
      if (!existingCustomer && appt.customerPhone) {
        const newCustomerId = id();
        txs.push(dbOp.update('customers', newCustomerId, {
          userId: ownerId,
          name: appt.customerName || 'Unknown',
          phone: appt.customerPhone || '',
          email: appt.customerEmail || '',
          createdAt: Date.now()
        }));
        
        txs.push(dbOp.update('activityLogs', id(), {
          entityId: newCustomerId, entityType: 'customer', text: `Auto-converted from Appointment (${apptId.slice(0,8)}) upon completion.`,
          userId: ownerId, createdAt: Date.now()
        }));
      }
      
      // Look up matching lead server-side (avoids 11k+ subscription)
      try {
        const lookupRes = await fetch('/api/lead-lookup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ownerId, phone: appt.customerPhone, email: appt.customerEmail }),
        });
        const lookupData = await lookupRes.json();
        const existingLead = lookupData.lead;
        if (existingLead && existingLead.stage !== 'Converted') {
          txs.push(dbOp.update('leads', existingLead.id, { stage: 'Converted', updatedAt: Date.now() }));
        }
      } catch (e) { console.warn('Lead lookup failed:', e); }
    }

    await dbWrite(txs);
    if (appt && appt.status !== status) {
      await logActivity({
        entityType: 'appointment', entityId: apptId,
        entityName: appt.customerName || '',
        action: 'edited',
        text: `Appointment status changed to **${status}** for ${appt.customerName || 'customer'}`,
        userId: ownerId, user, teamMemberId: myMember?.id || null,
        meta: { status },
      });
    }
    if (appt?.status !== status) toast(`Status updated to ${status}`, 'success');
    return true;
  };

  const reschedule = async () => {
    if (!rsForm.date || !rsForm.time) { toast('Date and time required', 'error'); return; }
    await dbWrite(dbOp.update('appointments', rescheduleModal.id, { date: rsForm.date, time: rsForm.time, updatedAt: Date.now() }));
    toast('Appointment rescheduled', 'success');
    setRescheduleModal(null);
  };

  const saveAppointment = async () => {
    if (!editModal) return;
    const proceed = await updateStatus(editModal.id, editForm.status);
    if (!proceed) return;
    
    // Use pre-fetched lead data from edit modal (via /api/lead-lookup)
    const matchingLead = matchedLead;

    let apptNotes = editModal.notes || '';
    let masterNotes = matchingLead?.notes || '';
    
    if (newNote.trim()) {
      const ts = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
      const entry = `[${ts}] ${newNote.trim()}`;
      
      apptNotes = apptNotes ? `${apptNotes}\n${entry}` : entry;
      masterNotes = masterNotes ? `${masterNotes}\n${entry}` : entry;
    }

    const txs = [dbOp.update('appointments', editModal.id, { 
      notes: apptNotes,
      updatedAt: Date.now() 
    })];

    if (matchingLead && newNote.trim()) {
      txs.push(dbOp.update('leads', matchingLead.id, {
        notes: masterNotes,
        updatedAt: Date.now()
      }));
    }

    await dbWrite(txs);
    if (newNote.trim()) {
      await logActivity({
        entityType: 'appointment', entityId: editModal.id,
        entityName: editModal.customerName || '',
        action: 'note',
        text: `Note added on appointment for ${editModal.customerName || 'customer'}: ${newNote.trim()}`,
        userId: ownerId, user, teamMemberId: myMember?.id || null,
      });
    }
    toast('Appointment and Lead updated', 'success');
    setEditModal(null);
    setNewNote('');
  };

  const copyLink = () => {
    const s = settingsForm?.slug || ownerId;
    const link = `${window.location.origin}/book/${s}`;
    navigator.clipboard.writeText(link);
    toast('Booking link copied!', 'success');
  };

  const now = new Date();
  const todayStr = now.toISOString().split('T')[0];
  const tomorrowStr = new Date(now.getTime() + 86400000).toISOString().split('T')[0];
  const weekEnd = new Date(now.getTime() + 7 * 86400000).toISOString().split('T')[0];

  const filtered = useMemo(() => {
    let list = [...appointments].sort((a, b) => {
      const da = `${a.date}T${a.time}`;
      const db2 = `${b.date}T${b.time}`;
      return da > db2 ? -1 : 1; // newest first
    });
    if (dateFilter === 'today') list = list.filter(a => a.date === todayStr);
    else if (dateFilter === 'tomorrow') list = list.filter(a => a.date === tomorrowStr);
    else if (dateFilter === 'week') list = list.filter(a => a.date >= todayStr && a.date <= weekEnd);
    else if (dateFilter === 'overdue') {
      list = list.filter(a => a.date < todayStr && a.status === 'Pending');
    }
    else if (dateFilter === 'custom') list = list.filter(a => a.date >= customRange.start && a.date <= customRange.end);
    if (statusFilter !== 'All') list = list.filter(a => a.status === statusFilter);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(a => [a.customerName, a.customerPhone, a.service].some(v => String(v || '').toLowerCase().includes(q)));
    }
    return list;
  }, [appointments, dateFilter, statusFilter, search, todayStr, tomorrowStr, weekEnd, customRange.start, customRange.end]);

  const overdueCount = appointments.filter(a => a.date < todayStr && a.status === 'Pending').length;

  const todayCount = appointments.filter(a => a.date === todayStr).length;
  const tomorrowCount = appointments.filter(a => a.date === tomorrowStr).length;
  const weekCount = appointments.filter(a => a.date >= todayStr && a.date <= weekEnd).length;
  const pending = appointments.filter(a => a.status === 'Pending').length;
  const upcoming = appointments.filter(a => a.date >= todayStr && a.status !== 'Cancelled').length;

  return (
    <div>
      <div className="sh">
        <div>
          <h2>📅 Appointments</h2>
          <div className="sub" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span>Manage bookings for your services</span>
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', background: '#f8fafc', padding: '10px 14px', borderRadius: 10, border: '1.5px solid var(--border)', boxShadow: '0 2px 4px rgba(0,0,0,0.02)', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 9, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 2 }}>🔗 PUBLIC BOOKING URL</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <a href={`${(settings?.crmDomain || window.location.origin).replace(/\/$/, '')}/${settingsForm?.slug || profile?.slug || ownerId}/book`} target="_blank" rel="noopener noreferrer" 
                    style={{ fontSize: 13, fontWeight: 700, color: '#16a34a', textDecoration: 'none', fontFamily: 'var(--font-mono, monospace)', background: '#f0fdf4', padding: '2px 6px', borderRadius: 4 }}>
                    {(settings?.crmDomain || window.location.origin).replace(/\/$/, '')}/{settingsForm?.slug || profile?.slug || ownerId}/book
                  </a>
                  <button className="btn-icon" style={{ padding: '6px', background: '#fff', borderRadius: 6, border: '1px solid #e2e8f0', cursor: 'pointer', boxShadow: '0 1px 2px rgba(0,0,0,0.05)', fontSize: 14 }} 
                    title="Copy Link" onClick={() => {
                    const lnk = `${(settings?.crmDomain || window.location.origin).replace(/\/$/, '')}/${settingsForm?.slug || profile?.slug || ownerId}/book`;
                    navigator.clipboard.writeText(lnk);
                    toast('Booking link copied!', 'success');
                  }}>📋</button>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className={`btn btn-sm ${tab === 'list' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('list')}>📋 List</button>
          <button className={`btn btn-sm ${tab === 'settings' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setTab('settings')}>⚙️ Settings & Availability</button>
        </div>
      </div>

      {tab === 'list' && (
        <>
          <div className="stat-grid" style={{ marginBottom: 18 }}>
            <div className="stat-card sc-blue"><div className="lbl">Today</div><div className="val">{todayCount}</div></div>
            <div className="stat-card sc-yellow"><div className="lbl">Pending</div><div className="val">{pending}</div></div>
            <div className="stat-card sc-green"><div className="lbl">Upcoming (7 days)</div><div className="val">{upcoming}</div></div>
            <div className="stat-card sc-purple"><div className="lbl">Total</div><div className="val">{appointments.length}</div></div>
          </div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <div className="tabs" style={{ marginBottom: 0 }}>
              {[
                ['all', `All (${appointments.length})`],
                ['today', `Today (${todayCount})`],
                ['overdue', `Overdue (${overdueCount})`],
                ['tomorrow', `Tomorrow (${tomorrowCount})`],
                ['week', `This Week (${weekCount})`],
                ['custom', 'Custom Range']
              ].map(([v, l]) => (
                <div key={v} className={`tab${dateFilter === v ? ' active' : ''}`} onClick={() => setDateFilter(v)}>{l}</div>
              ))}
            </div>
            
            {dateFilter === 'custom' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#fff', padding: '6px 12px', borderRadius: 8, border: '1px solid var(--border)' }}>
                <input type="date" className="si" style={{ padding: '4px 8px', margin: 0 }} value={customRange.start} onChange={e => setCustomRange(p => ({ ...p, start: e.target.value }))} />
                <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>to</span>
                <input type="date" className="si" style={{ padding: '4px 8px', margin: 0 }} value={customRange.end} onChange={e => setCustomRange(p => ({ ...p, end: e.target.value }))} />
              </div>
            )}
          </div>

          <div className="tw" style={{ marginTop: 16 }}>
            <div className="tw-head" style={{ flexWrap: 'wrap', gap: 10 }}>
              <div style={{ flex: 1 }}></div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className="btn btn-secondary btn-sm" onClick={() => {
                  setTempConf({
                    dateFilter: profile?.apptConfig?.dateFilter || 'today',
                    statusFilter: profile?.apptConfig?.statusFilter || 'All'
                  });
                  setConfModal(true);
                }}>⚙️ Configure View</button>
                <div className="sw">
                  <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
                  <input className="si" placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} />
                </div>
                <select className="si" style={{ width: 140 }} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
                  <option value="All">All Statuses</option>
                  {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
            <div className="tw-scroll">
              <table>
                <thead><tr><th>#</th><th>Customer</th><th>Service</th><th>Date & Time</th><th>Status</th><th>Actions</th></tr></thead>
                <tbody>
                  {filtered.length === 0 && (
                    <tr><td colSpan={6} style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>No appointments {dateFilter !== 'all' ? `for ${dateFilter}` : ''}.</td></tr>
                  )}
                  {filtered.map((a, i) => {
                    const sc = STATUS_COLORS[a.status] || STATUS_COLORS.Pending;
                    return (
                      <tr key={a.id}>
                        <td style={{ fontSize: 11, color: 'var(--muted)' }}>{i + 1}</td>
                        <td>
                          <div style={{ fontWeight: 600 }}>{a.customerName}</div>
                          <div style={{ fontSize: 11, color: 'var(--muted)' }}>{a.customerPhone}</div>
                        </td>
                        <td style={{ fontSize: 13 }}>{a.service || '—'}</td>
                        <td>
                          <div style={{ fontWeight: 600 }}>{a.date}</div>
                          <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                            {a.time} - {(() => {
                              try {
                                if (!a.time) return '?';
                                const [t, p] = a.time.split(' ');
                                let [h, m] = t.split(':').map(Number);
                                if (p === 'PM' && h !== 12) h += 12;
                                if (p === 'AM' && h === 12) h = 0;
                                const svc = (settingsRecord?.services ? JSON.parse(settingsRecord.services) : []).find(s => (typeof s === 'string' ? s : s.name) === a.service);
                                const dur = (typeof svc === 'object' && svc.duration) ? Number(svc.duration) : (settingsRecord?.slotDuration || 30);
                                const d = new Date(2000, 0, 1, h, m + dur);
                                return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
                              } catch(e) { return ''; }
                            })()}
                          </div>
                        </td>
                        <td>
                          <select value={a.status || 'Pending'} onChange={e => updateStatus(a.id, e.target.value)}
                            style={{ fontSize: 11, padding: '3px 6px', borderRadius: 6, border: '1.5px solid', borderColor: sc.color, background: sc.bg, color: sc.color, fontWeight: 700 }}>
                            {STATUSES.map(s => <option key={s}>{s}</option>)}
                          </select>
                        </td>

                        <td>
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button className="btn btn-secondary btn-sm" style={{ padding: '4px 8px' }} onClick={() => { setEditModal(a); setEditForm({ notes: a.notes || '', status: a.status || 'Pending' }); }}>📝 Edit</button>
                            <button className="btn btn-secondary btn-sm" style={{ padding: '4px 8px' }} onClick={() => { setRescheduleModal(a); setRsForm({ date: a.date, time: a.time }); }}>📅 Reschedule</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {tab === 'settings' && settingsForm && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(450px, 1fr))', gap: 24 }}>
          <div className="tw" style={{ padding: 24 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h4 style={{ margin: 0, fontSize: 14 }}>🕐 Working Hours</h4>
              <button className="btn btn-primary btn-sm" onClick={saveSettings}>💾 Save</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 12, marginBottom: 14 }}>
              <div className="fg" style={{ marginBottom: 0 }}>
                <label>Slot Duration</label>
                <select value={settingsForm.slotDuration} onChange={e => setSettingsForm(p => ({ ...p, slotDuration: +e.target.value }))}>
                  {[15, 30, 45, 60, 90, 120].map(d => <option key={d} value={d}>{d} mins</option>)}
                </select>
              </div>
              <div className="fg" style={{ marginBottom: 0 }}>
                <label>Max bookings/slot</label>
                <input type="number" min={1} max={20} value={settingsForm.maxPerSlot} onChange={e => setSettingsForm(p => ({ ...p, maxPerSlot: +e.target.value }))} />
              </div>
              <div className="fg" style={{ marginBottom: 0 }}>
                <label>Booking Window</label>
                <select value={settingsForm.bookingWindow} onChange={e => setSettingsForm(p => ({ ...p, bookingWindow: +e.target.value }))}>
                  {[1, 2, 3, 4, 5, 6, 12].map(m => <option key={m} value={m}>{m} {m === 1 ? 'Month' : 'Months'}</option>)}
                </select>
              </div>
            </div>

            <div className="fg" style={{ marginBottom: 16 }}>
              {settingsForm.slug && (
                <div>
                  <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 8 }}>
                    To change your URL, visit <span style={{ color: 'var(--accent)', cursor: 'pointer', fontWeight: 600 }} onClick={() => useApp().setActiveView?.('settings')}>Business Profile Settings</span>
                  </div>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center', background: '#fff', padding: '10px 14px', borderRadius: 8, border: '1px solid var(--border)' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 4 }}>Public Booking URL</div>
                      <a href={`${(settings?.crmDomain || window.location.origin).replace(/\/$/, '')}/${settingsForm.slug}/book`} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent)', textDecoration: 'none', display: 'block', wordBreak: 'break-all' }}>
                        {(settings?.crmDomain || window.location.origin).replace(/\/$/, '')}/{settingsForm.slug}/book
                      </a>
                    </div>
                    <button className="btn-icon" style={{ padding: '8px', background: 'var(--bg-soft)', borderRadius: 6, border: '1px solid var(--border)', cursor: 'pointer', flexShrink: 0 }} title="Copy URL" onClick={() => { navigator.clipboard.writeText(`${(settings?.crmDomain || window.location.origin).replace(/\/$/, '')}/${settingsForm.slug}/book`); toast('Link copied!', 'success'); }}>
                      📋
                    </button>
                  </div>
                </div>
              )}
            </div>
            {DAYS.map(day => {
              const hours = settingsForm.workingHours[day] || { enabled: false, slots: [{ start: '09:00', end: '18:00' }] };
              return (
                <div key={day} style={{ marginBottom: 10, padding: '12px', background: hours.enabled ? 'var(--bg-soft)' : '#fef2f2', borderRadius: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: hours.enabled ? 8 : 0 }}>
                    <input type="checkbox" checked={hours.enabled} onChange={e => setSettingsForm(p => ({ ...p, workingHours: { ...p.workingHours, [day]: { ...hours, enabled: e.target.checked } } }))} style={{ width: 15, height: 15 }} />
                    <span style={{ fontWeight: 600, fontSize: 13, width: 90 }}>{day}</span>
                    {!hours.enabled && <span style={{ fontSize: 11, color: '#991b1b' }}>Closed</span>}
                    {hours.enabled && <button className="btn btn-secondary btn-sm" style={{ marginLeft: 'auto', padding: '2px 8px', fontSize: 10 }} onClick={() => setSettingsForm(p => ({ ...p, workingHours: { ...p.workingHours, [day]: { ...hours, slots: [...hours.slots, { start: '14:00', end: '17:00' }] } } }))}>+ Add Slot</button>}
                  </div>
                  
                  {hours.enabled && hours.slots.map((slot, si) => (
                    <div key={si} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, marginLeft: 25 }}>
                       <input type="time" value={slot.start} onChange={e => setSettingsForm(p => {
                         const newSlots = [...hours.slots];
                         newSlots[si] = { ...slot, start: e.target.value };
                         return { ...p, workingHours: { ...p.workingHours, [day]: { ...hours, slots: newSlots } } };
                       })} style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)', fontSize: 12 }} />
                       <span style={{ fontSize: 11, color: 'var(--muted)' }}>to</span>
                       <input type="time" value={slot.end} onChange={e => setSettingsForm(p => {
                         const newSlots = [...hours.slots];
                         newSlots[si] = { ...slot, end: e.target.value };
                         return { ...p, workingHours: { ...p.workingHours, [day]: { ...hours, slots: newSlots } } };
                       })} style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)', fontSize: 12 }} />
                       {hours.slots.length > 1 && (
                         <button onClick={() => setSettingsForm(p => ({ ...p, workingHours: { ...p.workingHours, [day]: { ...hours, slots: hours.slots.filter((_, i) => i !== si) } } }))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8' }}>✕</button>
                       )}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div className="tw" style={{ padding: 24 }}>
              <h4 style={{ marginBottom: 14, fontSize: 14 }}>💼 Services Offered</h4>
              {settingsForm.services.map((svc, i) => {
                const sName = typeof svc === 'string' ? svc : svc.name;
                const sDur = typeof svc === 'string' ? '' : (svc.duration || '');
                return (
                  <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
                    <input 
                      className="si"
                      value={sName} 
                      onChange={e => setSettingsForm(p => ({ ...p, services: p.services.map((s, j) => j === i ? { ...s, name: e.target.value } : s) }))} 
                      placeholder="Service Name" 
                      style={{ flex: 2, margin: 0 }} 
                    />
                    <input 
                      className="si"
                      type="number"
                      value={sDur} 
                      onChange={e => setSettingsForm(p => ({ ...p, services: p.services.map((s, j) => j === i ? { ...s, name: sName, duration: e.target.value ? Number(e.target.value) : '' } : s) }))} 
                      placeholder="Mins (Optional)" 
                      style={{ flex: 1, margin: 0 }} 
                    />
                    <button className="btn btn-sm" style={{ background: '#fee2e2', color: '#991b1b', padding: '8px 12px' }} onClick={() => setSettingsForm(p => ({ ...p, services: p.services.filter((_, j) => j !== i) }))}>✕</button>
                  </div>
                );
              })}
              <button className="btn btn-secondary btn-sm" style={{ marginTop: 4 }} onClick={() => setSettingsForm(p => ({ ...p, services: [...p.services, { name: '', duration: '' }] }))}>+ Add Service</button>
            </div>

            <div className="tw" style={{ padding: 24 }}>
              <h4 style={{ marginBottom: 14, fontSize: 14 }}>🚫 Holidays / Off Days</h4>
              <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center' }}>
                <input className="si" type="date" id="holiday-input" style={{ flex: 1, margin: 0 }} />
                <button className="btn btn-secondary btn-sm" onClick={async () => {
                  const el = document.getElementById('holiday-input');
                  const val = el.value;
                  if (val && !settingsForm.holidays.includes(val)) {
                    const newHolidays = [...settingsForm.holidays, val].sort();
                    setSettingsForm(p => ({ ...p, holidays: newHolidays }));
                    el.value = '';
                    await dbOp.update('appointmentSettings', settingsId, { holidays: JSON.stringify(newHolidays) });
                    await dbOp.update('activityLogs', id(), { entityId: settingsId, entityType: 'appointmentSettings', text: `Added holiday: ${val}`, userId: ownerId, createdAt: Date.now() });
                    toast('Holiday added & saved!', 'success');
                  }
                }}>Add</button>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {(() => {
                  const todayStr = new Date().toISOString().split('T')[0];
                  const upcoming = settingsForm.holidays.filter(h => h >= todayStr).sort();
                  const past = settingsForm.holidays.filter(h => h < todayStr);
                  
                  if (upcoming.length === 0) return <span style={{ fontSize: 12, color: 'var(--muted)' }}>No upcoming holidays set</span>;
                  
                  return upcoming.map(h => (
                    <span key={h} style={{ display: 'flex', alignItems: 'center', gap: 4, background: '#fee2e2', color: '#991b1b', padding: '3px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600 }}>
                      {h}
                      <button onClick={async () => {
                        const newHolidays = settingsForm.holidays.filter(x => x !== h);
                        setSettingsForm(p => ({ ...p, holidays: newHolidays }));
                        await dbOp.update('appointmentSettings', settingsId, { holidays: JSON.stringify(newHolidays) });
                        await dbOp.update('activityLogs', id(), { entityId: settingsId, entityType: 'appointmentSettings', text: `Removed holiday: ${h}`, userId: ownerId, createdAt: Date.now() });
                        toast('Holiday removed!', 'success');
                      }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#991b1b', fontWeight: 800, lineHeight: 1 }}>✕</button>
                    </span>
                  ));
                })()}
              </div>
            </div>
          </div>

          <div style={{ gridColumn: '1 / -1' }}>
            <button className="btn btn-primary" onClick={saveSettings}>💾 Save Availability Settings</button>
          </div>

          <div style={{ gridColumn: '1 / -1', marginTop: 10, paddingTop: 20, borderTop: '1px solid var(--border)' }}>
            <h4 style={{ marginBottom: 14, fontSize: 14 }}>📜 Settings Change History</h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxHeight: 300, overflowY: 'auto', background: '#fff', padding: 16, borderRadius: 8, border: '1px solid var(--border)' }}>
              {(() => {
                const logs = (settingsLogsData?.activityLogs || []).filter(l => l.entityType === 'appointmentSettings').sort((a,b) => b.createdAt - a.createdAt);
                if (logs.length === 0) return <div style={{ fontSize: 12, color: 'var(--muted)', fontStyle: 'italic' }}>No changes logged yet. Your changes will be recorded here.</div>;
                return logs.map(l => (
                  <div key={l.id} style={{ fontSize: 13, borderBottom: '1px solid var(--bg-soft)', paddingBottom: 8, marginBottom: 8 }}>
                    <span style={{ color: 'var(--muted)', width: 140, display: 'inline-block', fontWeight: 600 }}>{new Date(l.createdAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</span>
                    <span style={{ color: 'var(--text)' }}>{l.text}</span>
                  </div>
                ));
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {editModal && (
        <div className="mo open">
          <div className="mo-box" style={{ maxWidth: 500 }}>
            <div className="mo-head">
              <h3>📝 Edit Appointment</h3>
              <button onClick={() => setEditModal(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18 }}>✕</button>
            </div>
            
            <div className="mo-body">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
                <div>
                  <label className="lbl" style={{ marginBottom: 4, display: 'block' }}>Customer</label>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{editModal.customerName}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>{editModal.customerPhone}</div>
                </div>
                <div>
                  <label className="lbl" style={{ marginBottom: 4, display: 'block' }}>Booking</label>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{editModal.service}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>{editModal.date} at {editModal.time}</div>
                </div>
              </div>

              <div className="fg">
                <label>Status</label>
                <select value={editForm.status} onChange={e => setEditForm(p => ({ ...p, status: e.target.value }))}>
                  {STATUSES.map(s => <option key={s}>{s}</option>)}
                </select>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                <div className="fg">
                  <label>Past Bookings</label>
                  <div style={{ 
                    height: 140, 
                    fontSize: 12, 
                    padding: 10, 
                    background: 'var(--bg-soft)', 
                    borderRadius: 8, 
                    overflowY: 'auto', 
                    border: '1px solid var(--border)',
                    color: 'var(--text)'
                  }}>
                    {(() => {
                      const past = appointments.filter(a => 
                        a.id !== editModal.id && 
                        ((editModal.customerEmail && a.customerEmail === editModal.customerEmail) || 
                         (editModal.customerPhone && a.customerPhone === editModal.customerPhone))
                      ).sort((a,b) => `${b.date}T${b.time}`.localeCompare(`${a.date}T${a.time}`));

                      if (past.length === 0) return <div style={{ color: 'var(--muted)', fontStyle: 'italic' }}>No past bookings found.</div>;
                      
                      return past.map(p => (
                        <div key={p.id} style={{ marginBottom: 8, paddingBottom: 8, borderBottom: '1px solid var(--border)' }}>
                          <span style={{ fontWeight: 600 }}>{p.date}</span> at <span style={{ fontWeight: 600 }}>{p.time}</span><br />
                          Service: {p.service || 'N/A'} <br />
                          Status: <span style={{ color: STATUS_COLORS[p.status]?.color || 'var(--text)', fontWeight: 600 }}>{p.status}</span>
                        </div>
                      ));
                    })()}
                  </div>
                </div>

                <div className="fg">
                  <label>Master CRM Notes</label>
                  <div style={{ 
                    height: 140, 
                    fontSize: 12, 
                    padding: 10, 
                    background: 'var(--bg-soft)', 
                    borderRadius: 8, 
                    overflowY: 'auto', 
                    whiteSpace: 'pre-wrap',
                    border: '1px solid var(--border)',
                    color: 'var(--muted)'
                  }}>
                    {matchedLead?.notes || editModal.notes || 'No history yet.'}
                  </div>
                </div>
              </div>

              <div className="fg">
                <label>Add New Note</label>
                <textarea 
                  value={newNote} 
                  onChange={e => setNewNote(e.target.value)}
                  placeholder="Type a new update here..."
                  style={{ height: 80, fontSize: 13 }}
                />
              </div>
            </div>

            <div className="mo-foot">
              <button className="btn btn-secondary" onClick={() => { setEditModal(null); setNewNote(''); }}>Cancel</button>
              <button className="btn btn-primary" onClick={saveAppointment}>Save & Sync to CRM</button>
            </div>
          </div>
        </div>
      )}

      {/* Reschedule Modal */}
      {rescheduleModal && (
        <div className="mo open">
          <div className="mo-box" style={{ maxWidth: 400 }}>
            <div className="mo-head">
              <h3>📅 Reschedule</h3>
              <button onClick={() => setRescheduleModal(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18 }}>✕</button>
            </div>
            <div className="mo-body">
              <div className="fg"><label>New Date</label><input type="date" value={rsForm.date} onChange={e => setRsForm({ ...rsForm, date: e.target.value })} /></div>
              <div className="fg"><label>New Time</label><input type="time" value={rsForm.time} onChange={e => setRsForm({ ...rsForm, time: e.target.value })} /></div>
            </div>
            <div className="mo-foot">
              <button className="btn btn-secondary" onClick={() => setRescheduleModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={reschedule}>Confirm</button>
            </div>
          </div>
        </div>
      )}

      {/* Configure View Modal */}
      {confModal && (
        <div className="mo open">
          <div className="mo-box" style={{ maxWidth: 400 }}>
            <div className="mo-head">
              <h3>⚙️ Configure Default View</h3>
              <button onClick={() => setConfModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18 }}>✕</button>
            </div>
            <div className="mo-body">
              <div className="fg">
                <label>Default Date Filter</label>
                <select value={tempConf.dateFilter} onChange={e => setTempConf(p => ({ ...p, dateFilter: e.target.value }))}>
                  <option value="all">All</option>
                  <option value="today">Today</option>
                  <option value="tomorrow">Tomorrow</option>
                  <option value="week">This Week</option>
                </select>
              </div>
              <div className="fg">
                <label>Default Status Filter</label>
                <select value={tempConf.statusFilter} onChange={e => setTempConf(p => ({ ...p, statusFilter: e.target.value }))}>
                  <option value="All">All Statuses</option>
                  {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
            <div className="mo-foot">
              <button className="btn btn-secondary" onClick={() => setConfModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={saveConfig}>💾 Save Defaults</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
