import React, { useState, useMemo, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import db from '../../instant';
import { fmt, fmtD, fmtDT } from '../../utils/helpers';
import { useToast } from '../../context/ToastContext';

const DATE_FILTERS = ['Today', 'Yesterday', 'This Month', 'This Year', 'Custom'];

export default function TeamReports({ user, ownerId, perms, planEnforcement }) {
  const mod = (key) => planEnforcement ? planEnforcement.isModuleEnabled(key) !== false : true;
  const showLeads = mod('leads');
  const showCustomers = mod('customers');
  const showQuotes = mod('quotations');
  const showInvoices = mod('invoices');
  const showAmc = mod('amc');
  const showAppointments = mod('appointments');
  const showCalls = mod('callLogs');
  const showTasks = mod('tasks');
  const { setActiveView } = useApp();
  const [filter, setFilter] = useState('This Month');
  const [customRange, setCustomRange] = useState({ start: '', end: '' });
  const [selectedId, setSelectedId] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDay, setSelectedDay] = useState(null);
  const toast = useToast();

  const { data, isLoading } = db.useQuery({
    teamMembers: { $: { where: { userId: ownerId } } },
    tasks: { $: { where: { userId: ownerId } } },
    projects: { $: { where: { userId: ownerId } } },
    customers: { $: { where: { userId: ownerId } } },
    userProfiles: { $: { where: { userId: ownerId } } },
    callLogs: { $: { where: { userId: ownerId }, limit: 5000 } }
  });

  // Activity logs are now server-driven (filtered by date range server-side).
  // The previous db.useQuery with limit:2000 returned arbitrary rows (no
  // ordering guarantee) and at scale also hit the InstantDB WebSocket timeout,
  // which is why every metric in this page was rendering as 0.
  const [logs, setLogs] = useState([]);
  const team = data?.teamMembers || [];
  const allTasks = data?.tasks || [];
  // Leads fetched via server — replaced unlimited subscription that hung at 11k
  const [allLeads, setAllLeads] = useState([]);
  useEffect(() => {
    if (!ownerId) return;
    fetch('/api/leads-page', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ownerId, mode: 'kanban', tab: 'all', page: 1, pageSize: 1000, isOwner: true, teamCanSeeAllLeads: true, boundaries: {} }),
    })
      .then(r => r.json())
      .then(json => setAllLeads(json.items || []))
      .catch(() => {});
  }, [ownerId]);
  const allProjects = data?.projects || [];
  const allCustomers = data?.customers || [];
  const allCallLogs = data?.callLogs || [];
  const profile = data?.userProfiles?.[0] || {};
  const wonStage = profile.wonStage || 'Won';

  const members = useMemo(() => [
    { id: ownerId, name: 'Business Owner', email: profile.email || '' },
    ...team.map(m => ({ id: m.id, name: m.name, email: m.email }))
  ], [ownerId, profile.email, team]);

  const memberMap = useMemo(() => {
    const map = {};
    members.forEach(m => {
      map[m.id] = m.name;
      if (m.email) map[m.email] = m.name; // Fallback to email mapping if actorId doesn't match
    });
    return map;
  }, [members]);

  const leadMap = useMemo(() => {
    const map = {};
    allLeads.forEach(l => { map[l.id] = l.name; });
    return map;
  }, [allLeads]);

  const taskMap = useMemo(() => {
    const map = {};
    allTasks.forEach(t => { map[t.id] = t; });
    return map;
  }, [allTasks]);

  const projectMap = useMemo(() => {
    const map = {};
    allProjects.forEach(p => { map[p.id] = p.name; });
    return map;
  }, [allProjects]);

  const customerMap = useMemo(() => {
    const map = {};
    allCustomers.forEach(c => { map[c.id] = c.name; });
    return map;
  }, [allCustomers]);

  const dateRange = useMemo(() => {
    const now = new Date();
    const start = new Date(now);
    const end = new Date(now);
    
    if (filter === 'Today') {
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);
    } else if (filter === 'Yesterday') {
      start.setDate(now.getDate() - 1);
      start.setHours(0, 0, 0, 0);
      end.setDate(now.getDate() - 1);
      end.setHours(23, 59, 59, 999);
    } else if (filter === 'This Month') {
      start.setHours(0, 0, 0, 0);
      start.setDate(1);
      end.setMonth(now.getMonth() + 1, 0);
      end.setHours(23, 59, 59, 999);
    } else if (filter === 'This Year') {
      start.setMonth(0, 1);
      start.setHours(0, 0, 0, 0);
      end.setMonth(11, 31);
      end.setHours(23, 59, 59, 999);
    } else if (filter === 'Custom' && customRange.start && customRange.end) {
      return { start: new Date(customRange.start).getTime(), end: new Date(customRange.end).getTime() + 86400000 };
    }
    
    return { start: start.getTime(), end: end.getTime() };
  }, [filter, customRange]);

  // Pull activity logs scoped to the selected date range
  useEffect(() => {
    if (!ownerId) return;
    fetch('/api/team-activity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ownerId, startMs: dateRange.start, endMs: dateRange.end }),
    })
      .then(r => r.json())
      .then(json => setLogs(json.logs || []))
      .catch(() => setLogs([]));
  }, [ownerId, dateRange.start, dateRange.end]);

  // Set of team-member emails to distinguish owner's logs from team members'
  const teamEmails = useMemo(() => new Set(team.map(t => (t.email || '').toLowerCase()).filter(Boolean)), [team]);

  // Helper: check if a log belongs to a given member.
  // Match priority: 1) explicit teamMemberId field (most reliable), 2) email fallback, 3) owner catches any unattributed log
  const isLogByMember = (log, member) => {
    if (member.id === ownerId) {
      // Owner row: claim logs that are NOT attributed to any team member
      if (log.teamMemberId) return false;
      const uname = (log.userName || '').toLowerCase();
      // If userName matches a team member's email, it belongs to that member, not owner
      if (uname && teamEmails.has(uname)) return false;
      return true;
    }
    // Team member: prefer teamMemberId match, fallback to email
    if (log.teamMemberId && log.teamMemberId === member.id) return true;
    if (!log.teamMemberId && member.email && log.userName && log.userName.toLowerCase() === member.email.toLowerCase()) return true;
    return false;
  };

  // Helper: attribute a call log to a member by staffEmail (team) or actorId/ownerId (owner)
  const isCallByMember = (cl, member) => {
    const staff = (cl.staffEmail || '').toLowerCase();
    if (member.id === ownerId) {
      if (staff && teamEmails.has(staff)) return false;
      if (staff && member.email && staff === member.email.toLowerCase()) return true;
      if (!staff && cl.actorId && cl.actorId === ownerId) return true;
      if (!staff) return true; // unattributed → owner
      return false;
    }
    if (member.email && staff === member.email.toLowerCase()) return true;
    return false;
  };

  const isHumanLog = (log) => {
    return log.userName !== 'API System' && 
           log.userName !== 'Automation Bot (Server)' && 
           !(log.text || '').includes('🤖');
  };

  const performanceData = useMemo(() => {
    return members.map(m => {
      const leadsAssigned = allLeads.filter(l => l.assign === m.name).length;
      const tasksAssigned = allTasks.filter(t => t.assignTo === m.name).length;

      // Filter logs for this member using email fallback
      const userLogs = logs.filter(l => 
        isLogByMember(l, m) && 
        l.createdAt >= dateRange.start && 
        l.createdAt <= dateRange.end &&
        isHumanLog(l)
      );

      const totalActivities = userLogs.length;

      // Derive all metrics from activity logs (single source of truth)
      // Accept both singular and plural entityType for backward compat with old log formats
      const isTypeLog = (l, t) => l.entityType === t || l.entityType === `${t}s`;
      const uniqueByEntity = (filterFn) =>
        new Set(userLogs.filter(filterFn).map(l => l.entityId)).size;

      // Per-module distinct entity counts (e.g. "5 leads worked" = 5 different leads)
      const leadsWorked = uniqueByEntity(l => isTypeLog(l, 'lead'));
      const tasksWorked = uniqueByEntity(l => isTypeLog(l, 'task'));
      const customersWorked = uniqueByEntity(l => isTypeLog(l, 'customer'));
      const quotesWorked = uniqueByEntity(l => isTypeLog(l, 'quotation'));
      const invoicesWorked = uniqueByEntity(l => isTypeLog(l, 'invoice'));
      const amcWorked = uniqueByEntity(l => isTypeLog(l, 'amc'));
      const projectsWorked = uniqueByEntity(l => isTypeLog(l, 'project'));
      const appointmentsWorked = uniqueByEntity(l => isTypeLog(l, 'appointment'));

      // Tasks completed: structured action='completed' OR text contains "completed"
      const tasksCompleted = uniqueByEntity(l =>
        isTypeLog(l, 'task') && (l.action === 'completed' || (l.text || '').toLowerCase().includes('completed'))
      );

      // Leads won: stage-change → wonStage OR action='converted' OR text contains won/converted
      const leadsWon = uniqueByEntity(l =>
        isTypeLog(l, 'lead') && (
          (l.action === 'stage-change' && l.toStage === wonStage) ||
          l.action === 'converted' ||
          (l.text || '').toLowerCase().includes('won') ||
          (l.text || '').toLowerCase().includes('converted')
        )
      );

      // Stage changes (any stage move counts as pipeline activity)
      const stageChanges = userLogs.filter(l => isTypeLog(l, 'lead') && l.action === 'stage-change').length;

      // Misc = logs from other tracked modules (expense, purchase order, product, vendor, campaign, etc.)
      const knownTypes = new Set(['lead', 'leads', 'task', 'tasks', 'customer', 'customers', 'quotation', 'quotations', 'invoice', 'invoices', 'amc', 'project', 'projects', 'appointment', 'appointments']);
      const otherWorks = userLogs.filter(l => !knownTypes.has(l.entityType)).length;

      // Calls made (from callLogs collection) in date range
      const callsMade = allCallLogs.filter(cl =>
        isCallByMember(cl, m) &&
        (cl.createdAt || 0) >= dateRange.start &&
        (cl.createdAt || 0) <= dateRange.end
      ).length;

      return {
        ...m,
        leadsAssigned,
        tasksAssigned,
        tasksCompleted,
        tasksWorked,
        leadsWorked,
        leadsWon,
        customersWorked,
        quotesWorked,
        invoicesWorked,
        amcWorked,
        projectsWorked,
        appointmentsWorked,
        stageChanges,
        otherWorks,
        callsMade,
        totalActivities
      };
    }).sort((a, b) => b.totalActivities - a.totalActivities);
  }, [members, logs, dateRange, allLeads, allTasks, allCallLogs, teamEmails, ownerId, wonStage]);

  const selectedMember = useMemo(() => performanceData.find(m => m.id === selectedId), [performanceData, selectedId]);

  const activeMemberLogs = useMemo(() => {
    if (!selectedMember) return [];
    let lgs = (logs || []).filter(l => 
      isLogByMember(l, selectedMember) && 
      isHumanLog(l)
    );
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      lgs = lgs.filter(l => {
        const textMatch = (l.text || '').toLowerCase().includes(q);
        const nameMatch = (l.entityName || '').toLowerCase().includes(q);
        const task = taskMap[l.entityId];
        const refName = l.entityType === 'lead' ? leadMap[l.entityId] : task?.title;
        const refMatch = refName && refName.toLowerCase().includes(q);
        const projMatch = task && projectMap[task.projectId]?.toLowerCase().includes(q);
        const cliMatch = task && (task.client || customerMap[task.customerId] || '').toLowerCase().includes(q);
        return textMatch || nameMatch || refMatch || projMatch || cliMatch;
      });
    }
    if (selectedDay) {
      lgs = lgs.filter(l => fmtD(l.createdAt) === selectedDay);
    }
    return lgs.sort((a,b) => b.createdAt - a.createdAt);
  }, [selectedMember, searchQuery, leadMap, taskMap, projectMap, customerMap, selectedDay, logs]);

  const dayWiseActivity = useMemo(() => {
    if (!selectedMember || !logs) return [];
    const groups = {};
    const memberLogs = logs.filter(l => 
      isLogByMember(l, selectedMember) && 
      isHumanLog(l)
    );
    memberLogs.forEach(l => {
      // Only group logs that fall within the current filter range
      if (l.createdAt < dateRange.start || l.createdAt > dateRange.end) return;
      
      const d = fmtD(l.createdAt);
      if (d === '-') return;
      groups[d] = (groups[d] || 0) + 1;
    });
    return Object.entries(groups).map(([date, count]) => ({ date, count }))
      .sort((a,b) => new Date(b.date) - new Date(a.date));
  }, [selectedMember, logs, dateRange]);

  const handleNavigate = (type, id) => {
    if (type === 'lead') {
      localStorage.setItem('tc_open_lead', id);
      setActiveView('leads');
    } else if (type === 'task') {
      localStorage.setItem('tc_open_task', id);
      setActiveView('alltasks');
    } else if (type === 'project') {
      localStorage.setItem('tc_open_project', id);
      setActiveView('projects');
    } else if (type === 'customer') {
      localStorage.setItem('tc_open_customer', id);
      setActiveView('customers');
    }
  };

  const exportActivityCSV = () => {
    try {
      toast('Preparing activity report...', 'info');

      // Use the global members list (includes emails for correct attribution)
      const allFilteredLogs = logs
        .filter(l =>
          l.createdAt >= dateRange.start &&
          l.createdAt <= dateRange.end &&
          isHumanLog(l) &&
          members.some(m => isLogByMember(l, m))
        )
        .sort((a, b) => b.createdAt - a.createdAt);

      if (allFilteredLogs.length === 0) return toast('No logs found for selected dates', 'info');

      const headers = ['Member', 'Date', 'Type', 'Activity', 'Reference', 'Project', 'Client'];
      const rows = allFilteredLogs.map(l => {
        const eType = (l.entityType === 'tasks') ? 'task' : (l.entityType === 'leads') ? 'lead' : l.entityType;
        const task = eType === 'task' ? taskMap[l.entityId] : null;
        const entName = eType === 'lead' ? leadMap[l.entityId] : (task?.title || l.entityName);
        const projectName = task ? projectMap[task.projectId] : (l.projectId ? projectMap[l.projectId] : '');
        const clientName = task ? (task.client || (task.customerId ? customerMap[task.customerId] : '')) : '';
        // Resolve member name using email fallback
        const matchedMember = members.find(m => isLogByMember(l, m));
        const memberName = matchedMember?.name || l.userName || 'Unknown';

        return [
          memberName,
          fmtDT(l.createdAt),
          (eType || '').toUpperCase(),
          (l.text || '').replace(/"/g, '""'),
          (entName || '').replace(/"/g, '""'),
          (projectName || '').replace(/"/g, '""'),
          (clientName || '').replace(/"/g, '""')
        ].map(v => `"${v}"`).join(',');
      });

      const csvContent = '\uFEFF' + [headers.join(','), ...rows].join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `Team_Activity_Report_${new Date().toISOString().split('T')[0]}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      toast('Activity Report Downloaded', 'success');
    } catch (err) {
      console.error(err);
      toast('Error generating report', 'error');
    }
  };

  if (isLoading) return <div className="p-xl">Loading Performance Data...</div>;

  return (
    <div className="reports-container">
      <div className="sh" style={{ marginBottom: 20 }}>
        <div>
          <h2 style={{ fontSize: 24, margin: 0, fontWeight: 700 }}>Team Performance</h2>
          <div className="sub" style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>Analyze member productivity and activity</div>
        </div>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <button className="btn btn-secondary btn-sm" onClick={exportActivityCSV}>
            Export Activity Report
          </button>
          <div className="tabs" style={{ marginBottom: 0, border: 'none' }}>
            {DATE_FILTERS.map(f => (
              <div 
                key={f} 
                className={`tab ${filter === f ? 'active' : ''}`} 
                onClick={() => setFilter(f)}
                style={{ padding: '6px 12px', fontSize: 12 }}
              >
                {f}
              </div>
            ))}
          </div>
        </div>
      </div>

      {filter === 'Custom' && (
        <div style={{ display: 'flex', gap: 15, marginBottom: 20, background: '#f8fafc', padding: 15, borderRadius: 10, border: '1px solid #e2e8f0' }}>
          <div className="fg" style={{ marginBottom: 0 }}>
            <label style={{ fontSize: 11 }}>Start Date</label>
            <input type="date" value={customRange.start} onChange={e => setCustomRange(p => ({ ...p, start: e.target.value }))} />
          </div>
          <div className="fg" style={{ marginBottom: 0 }}>
            <label style={{ fontSize: 11 }}>End Date</label>
            <input type="date" value={customRange.end} onChange={e => setCustomRange(p => ({ ...p, end: e.target.value }))} />
          </div>
        </div>
      )}

      {/* Summary Stats */}
      <div className="stat-grid" style={{ marginBottom: 25 }}>
        <div className="stat-card sc-blue">
          <div className="lbl">Total Activities</div>
          <div className="val">{performanceData.reduce((s, m) => s + m.totalActivities, 0)}</div>
        </div>
        {showTasks && (
          <div className="stat-card sc-green">
            <div className="lbl">Tasks Worked</div>
            <div className="val">{performanceData.reduce((s, m) => s + m.tasksWorked, 0)}</div>
          </div>
        )}
        {showLeads && (
          <div className="stat-card sc-teal">
            <div className="lbl">Leads Worked</div>
            <div className="val">{performanceData.reduce((s, m) => s + m.leadsWorked, 0)}</div>
          </div>
        )}
        {showLeads && (
          <div className="stat-card sc-yellow">
            <div className="lbl">Leads Won</div>
            <div className="val">{performanceData.reduce((s, m) => s + m.leadsWon, 0)}</div>
          </div>
        )}
        <div className="stat-card sc-blue" style={{ borderLeftColor: '#8b5cf6' }}>
          <div className="lbl">Other Activities</div>
          <div className="val">{performanceData.reduce((s, m) => s + m.otherWorks, 0)}</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: selectedId ? '450px 1fr' : '1fr', gap: 20, transition: 'all 0.3s' }}>
        <div className="tw">
          <div className="tw-head">
            <h3>Member Performance Tracker</h3>
          </div>
          <div className="tw-scroll">
            <table className="perf-table">
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>Team Member</th>
                  <th>Activity</th>
                  {showLeads && <th>Leads Assg.</th>}
                  {showLeads && <th>Leads Work.</th>}
                  {showLeads && <th>Leads Won</th>}
                  {showLeads && <th>Stage Δ</th>}
                  {showCustomers && <th>Customers</th>}
                  {showQuotes && <th>Quotes</th>}
                  {showInvoices && <th>Invoices</th>}
                  {showAmc && <th>AMC</th>}
                  {showAppointments && <th>Appts.</th>}
                  {showCalls && <th>Calls</th>}
                  {showTasks && <th>Tasks Work.</th>}
                  <th title="Other tracked modules: Expenses, Purchase Orders, Products, Vendors, Campaigns">Misc</th>
                </tr>
              </thead>
              <tbody>
                {performanceData.map((m, i) => {
                  const isActive = selectedId === m.id;
                  
                  return (
                    <tr key={m.id} onClick={() => setSelectedId(isActive ? null : m.id)} className={isActive ? 'active-row' : ''}>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div style={{ width: 32, height: 32, borderRadius: '50%', background: isActive ? 'var(--accent)' : '#94a3b8', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 12 }}>
                            {m.name.charAt(0)}
                          </div>
                          <div style={{ maxWidth: 120 }}>
                            <div style={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</div>
                            <div style={{ fontSize: 9, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.email}</div>
                          </div>
                        </div>
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <strong style={{ fontSize: 13 }}>{m.totalActivities}</strong>
                      </td>
                      {showLeads && (
                        <td style={{ textAlign: 'center' }}>
                          <span className="badge bg-gray" style={{ fontSize: 11 }}>{m.leadsAssigned}</span>
                        </td>
                      )}
                      {showLeads && (
                        <td style={{ textAlign: 'center' }}>
                          <span className="badge bg-teal" style={{ fontSize: 11 }}>{m.leadsWorked}</span>
                        </td>
                      )}
                      {showLeads && (
                        <td style={{ textAlign: 'center' }}>
                          <span className="badge bg-green" style={{ fontSize: 11 }}>{m.leadsWon}</span>
                        </td>
                      )}
                      {showLeads && (
                        <td style={{ textAlign: 'center' }}>
                          <span className={`badge ${m.stageChanges > 0 ? 'bg-yellow' : 'bg-gray'}`} style={{ fontSize: 11 }}>{m.stageChanges}</span>
                        </td>
                      )}
                      {showCustomers && (
                        <td style={{ textAlign: 'center' }}>
                          <span className={`badge ${m.customersWorked > 0 ? 'bg-teal' : 'bg-gray'}`} style={{ fontSize: 11 }}>{m.customersWorked}</span>
                        </td>
                      )}
                      {showQuotes && (
                        <td style={{ textAlign: 'center' }}>
                          <span className={`badge ${m.quotesWorked > 0 ? 'bg-blue' : 'bg-gray'}`} style={{ fontSize: 11 }}>{m.quotesWorked}</span>
                        </td>
                      )}
                      {showInvoices && (
                        <td style={{ textAlign: 'center' }}>
                          <span className={`badge ${m.invoicesWorked > 0 ? 'bg-green' : 'bg-gray'}`} style={{ fontSize: 11 }}>{m.invoicesWorked}</span>
                        </td>
                      )}
                      {showAmc && (
                        <td style={{ textAlign: 'center' }}>
                          <span className={`badge ${m.amcWorked > 0 ? 'bg-yellow' : 'bg-gray'}`} style={{ fontSize: 11 }}>{m.amcWorked}</span>
                        </td>
                      )}
                      {showAppointments && (
                        <td style={{ textAlign: 'center' }}>
                          <span className={`badge ${m.appointmentsWorked > 0 ? 'bg-teal' : 'bg-gray'}`} style={{ fontSize: 11 }}>{m.appointmentsWorked}</span>
                        </td>
                      )}
                      {showCalls && (
                        <td style={{ textAlign: 'center' }}>
                          <span className={`badge ${m.callsMade > 0 ? 'bg-blue' : 'bg-gray'}`} style={{ fontSize: 11 }}>{m.callsMade}</span>
                        </td>
                      )}
                      {showTasks && (
                        <td style={{ textAlign: 'center' }}>
                          <div className={`badge ${m.tasksWorked > 0 ? 'bg-blue' : 'bg-gray'}`}>{m.tasksWorked}</div>
                        </td>
                      )}
                      <td style={{ textAlign: 'center' }}>
                        <div className={`badge ${m.otherWorks > 0 ? 'bg-teal' : 'bg-gray'}`}>{m.otherWorks}</div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {selectedMember && (
          <div className="tw log-detail-view">
            <div className="sh" style={{ borderBottom: '1px solid var(--border)', padding: '15px 20px', background: '#f8fafc', position: 'sticky', top: 0, zIndex: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 16 }}>Activity Logs: {selectedMember.name}</h3>
                <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4, fontWeight: 500 }}>Only 30 days logs available, for historical data, select Export Logs CSV</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <button className="btn-icon" onClick={() => { setSelectedId(null); setSelectedDay(null); }}>✕</button>
              </div>
            </div>
            
            <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 10, background: '#fff' }}>
               <div style={{ flex: 1, position: 'relative' }}>
                  <input 
                    type="text" 
                    placeholder="Search activity, lead, project or client..." 
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    className="input-sm"
                    style={{ width: '100%', paddingLeft: 35, borderRadius: 20 }}
                  />
                  <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', opacity: 0.5, fontSize: 14 }}>🔍</span>
               </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', flex: 1, overflow: 'hidden' }}>
              {/* Day Wise Summary Sidebar */}
              <div style={{ borderRight: '1px solid var(--border)', overflowY: 'auto', background: '#fcfdfe' }}>
                <div style={{ padding: '12px 15px', fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Timeline</div>
                {dayWiseActivity.map(d => (
                  <div 
                    key={d.date} 
                    onClick={() => setSelectedDay(selectedDay === d.date ? null : d.date)}
                    style={{ 
                      padding: '12px 15px', 
                      borderBottom: '1px solid #f1f5f9', 
                      display: 'flex', 
                      justifyContent: 'space-between', 
                      alignItems: 'center',
                      cursor: 'pointer',
                      background: selectedDay === d.date ? '#eff6ff' : 'transparent',
                      borderLeft: selectedDay === d.date ? '3px solid var(--accent)' : 'none'
                    }}
                  >
                    <div style={{ fontSize: 11, fontWeight: 600, color: selectedDay === d.date ? 'var(--accent)' : '#475569' }}>{d.date.split(',')[0]}</div>
                    <div className="badge bg-gray" style={{ fontSize: 10, minWidth: 20, textAlign: 'center' }}>{d.count}</div>
                  </div>
                ))}
              </div>

              {/* Logs List Main Area */}
              <div style={{ overflowY: 'auto', padding: '20px', background: '#fff' }}>
                {activeMemberLogs.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '100px 40px', color: 'var(--muted)' }}>
                    <div style={{ fontSize: 40, marginBottom: 10 }}>📋</div>
                    <div>No activities found matching criteria</div>
                  </div>
                ) : (
                  <div className="activity-timeline">
                    {activeMemberLogs.map((l, i) => {
                      const eType = (l.entityType === 'tasks') ? 'task' : (l.entityType === 'leads') ? 'lead' : l.entityType;
                      const task = eType === 'task' ? taskMap[l.entityId] : null;
                      const entName = eType === 'lead' ? leadMap[l.entityId] : (task?.title || l.entityName);
                      const projectName = task ? projectMap[task.projectId] : (l.projectId ? projectMap[l.projectId] : null);
                      const clientName = task ? (task.client || (task.customerId ? customerMap[task.customerId] : null)) : null;
                      
                      const refLabel = eType === 'task' ? 'Task' : eType === 'lead' ? 'Lead' : 'Ref';

                      return (
                        <div key={l.id || i} className="activity-item">
                          <div className="activity-header">
                            <span className={`type-tag tag-${eType}`}>{eType}</span>
                            <span className="activity-time">{fmtDT(l.createdAt)}</span>
                          </div>
                          <div className="activity-text">{l.text}</div>
                          <div className="activity-meta">
                            {entName && (
                              <div className="meta-block">
                                <span className="meta-label">{refLabel}:</span>
                                <span className="meta-val meta-link" onClick={() => handleNavigate(l.entityType, l.entityId)}>
                                  {task?.taskNumber ? `T-${task.taskNumber}: ` : ''}{entName}
                                </span>
                              </div>
                            )}
                            {projectName && (
                              <div className="meta-block">
                                <span className="meta-label">Project:</span>
                                <span className="meta-val meta-link" onClick={() => handleNavigate('project', task?.projectId)}>{projectName}</span>
                              </div>
                            )}
                            {clientName && (
                              <div className="meta-block">
                                <span className="meta-label">Client:</span>
                                <span className="meta-val meta-link" onClick={() => {
                                  const custId = task?.customerId || allCustomers.find(c => c.name === clientName)?.id;
                                  if (custId) handleNavigate('customer', custId);
                                }}>{clientName}</span>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        .reports-container { padding: 5px; }
        .sc-blue { border-left: 4px solid #3b82f6; }
        .sc-green { border-left: 4px solid #22c55e; }
        .sc-teal { border-left: 4px solid #14b8a6; }
        .sc-yellow { border-left: 4px solid #eab308; }
        
        .stat-card {
          background: #fff;
          padding: 20px;
          border-radius: 12px;
          box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }
        .stat-card .lbl { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 5px; font-weight: 700; }
        .stat-card .val { font-size: 24px; font-weight: 800; color: var(--text); }
        
        .bg-green { background: #dcfce7; color: #166534; }
        .bg-blue { background: #dbeafe; color: #1e40af; }
        .bg-teal { background: #f0fdfa; color: #0f766e; }
        .bg-gray { background: #f1f5f9; color: #475569; }

        .input-sm {
          height: 36px;
          border-radius: 8px;
          border: 1px solid #e2e8f0;
          font-size: 14px;
          transition: all 0.2s;
        }
        .input-sm:focus { border-color: var(--accent); outline: none; box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1); }

        .perf-table { width: 100%; border-collapse: collapse; }
        .perf-table th { font-size: 10px; text-transform: uppercase; color: var(--muted); padding: 12px 8px; border-bottom: 2px solid #f1f5f9; white-space: nowrap; }
        .perf-table td { padding: 10px 8px; border-bottom: 1px solid #f1f5f9; }

        .perf-table tr { cursor: pointer; transition: background 0.2s; }
        .perf-table tr:hover { background: #f8fafc; }
        .perf-table tr.active-row { background: #f0f9ff !important; }

        .log-detail-view {
          display: flex;
          flex-direction: column;
          animation: slideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1);
          box-shadow: -10px 0 30px rgba(0,0,0,0.05);
          background: #fff;
          border-left: 1px solid var(--border);
        }

        .activity-timeline { display: flex; flex-direction: column; gap: 20px; }
        .activity-item { 
          padding: 15px; 
          border-radius: 12px; 
          background: #f8fafc; 
          border: 1px solid #edf2f7;
          transition: transform 0.2s;
        }
        .activity-item:hover { transform: translateY(-2px); border-color: #cbd5e1; }
        
        .activity-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
        .type-tag { padding: 2px 8px; border-radius: 4px; font-size: 9px; font-weight: 700; text-transform: uppercase; }
        .tag-task { background: #dbeafe; color: #1e40af; }
        .tag-lead { background: #f0fdfa; color: #0f766e; }
        .activity-time { font-size: 11px; color: var(--muted); }
        .activity-text { font-size: 13.5px; color: #334155; line-height: 1.5; font-weight: 500; margin-bottom: 10px; }
        
        .activity-meta { display: flex; flex-wrap: wrap; gap: 15px; padding-top: 10px; border-top: 1px dashed #e2e8f0; }
        .meta-block { display: flex; align-items: center; gap: 5px; }
        .meta-label { font-size: 10px; color: var(--muted); font-weight: 600; text-transform: uppercase; }
        .meta-val { font-size: 11px; color: var(--accent); font-weight: 600; }
        .meta-link { cursor: pointer; text-decoration: underline; color: #2563eb; }
        .meta-link:hover { color: #1e40af; }

        @keyframes slideIn {
          from { opacity: 0; transform: translateX(30px); }
          to { opacity: 1; transform: translateX(0); }
        }
      `}} />
    </div>
  );
}
