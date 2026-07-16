import React, { useState, useMemo, useRef, useEffect } from 'react';
import db from '../../instant';
import { id } from '@instantdb/react';
import { dbWrite, dbOp } from '../../utils/dbWrite';
import { fmtD, fmtDT, stageBadgeClass, uid, normalizeName, DEFAULT_STAGES, DEFAULT_SOURCES, DEFAULT_REQUIREMENTS, DEFAULT_PROD_CATS } from '../../utils/helpers';
import { useToast } from '../../context/ToastContext';
import { EMPTY_LEAD } from '../../utils/constants';
import { fireAutoNotifications } from '../../utils/messaging';
import SearchableSelect from '../UI/SearchableSelect';



const DEFAULT_IMPORT_MAPPING = {
  name: { type: 'column', value: '' },
  companyName: { type: 'column', value: '' },
  email: { type: 'column', value: '' },
  phone: { type: 'column', value: '' },
  source: { type: 'fixed', value: '' },
  stage: { type: 'fixed', value: '' },
  requirement: { type: 'fixed', value: '' },
  label: { type: 'fixed', value: '' },
  assign: { type: 'fixed', value: '' },
  notes: { type: 'fixed', value: '' },
  followup: { type: 'fixed', value: '' }
};

export default function LeadsView({ user, perms, ownerId, planEnforcement }) {
  const canCreate = perms?.can('Leads', 'create') === true;
  const canEdit = perms?.can('Leads', 'edit') === true;
  const canDelete = perms?.can('Leads', 'delete') === true;
  const showPartners = planEnforcement?.isModuleEnabled('distributors') !== false;

  const [view, setView] = useState('list'); // 'list' | 'kanban'
  const [tab, setTab] = useState('all');
  const [dateMode, setDateMode] = useState(() => localStorage.getItem('tc_leads_date_mode') || 'followup'); // 'followup' | 'created'
  const [sortOrder, setSortOrder] = useState(() => {
    try { return JSON.parse(localStorage.getItem(`leadView_${user.email}`))?.sortOrder || 'newest'; }
    catch { return 'newest'; }
  }); // 'newest' | 'oldest' — sorts by the active dateMode dimension
  const [customFrom, setCustomFrom] = useState(() => localStorage.getItem('tc_leads_custom_from') || '');
  const [customTo, setCustomTo] = useState(() => localStorage.getItem('tc_leads_custom_to') || '');
  const [search, setSearch] = useState('');
  const [srcFilter, setSrcFilter] = useState('');
  const [stgFilter, setStgFilter] = useState('');
  const [reqFilter, setReqFilter] = useState('');
  // Owners see all leads by default; team members default to their own leads.
  const [staffFilter, setStaffFilter] = useState(() => perms?.isOwner ? '' : 'my');
  const [modal, setModal] = useState(false);
  const [editData, setEditData] = useState(null);
  const [form, setForm] = useState(EMPTY_LEAD);
  const [saving, setSaving] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [pendingBulkAssign, setPendingBulkAssign] = useState('');
  const [pendingBulkStage, setPendingBulkStage] = useState('');
  const [colModal, setColModal] = useState(false);
  const [tempCols, setTempCols] = useState([]);
  const [tempStages, setTempStages] = useState([]);
  const [tempPageSize, setTempPageSize] = useState(25);
  const [tempSortOrder, setTempSortOrder] = useState('newest');
  const [viewLead, setViewLead] = useState(null);
  const [noteText, setNoteText] = useState('');
  const [dragOverStage, setDragOverStage] = useState(null);
  const [importMappingModal, setImportMappingModal] = useState(false);
  const [importMapping, setImportMapping] = useState(DEFAULT_IMPORT_MAPPING);
  const [importHeaders, setImportHeaders] = useState([]);
  const [importData, setImportData] = useState([]); // Raw rows from CSV
  const [importSample, setImportSample] = useState(null); // First data row for preview
  const [importing, setImporting] = useState(false); // true while performImport is validating/inserting
  const [importProgress, setImportProgress] = useState({ phase: '', current: 0, total: 0 }); // live import progress
  const [importSummary, setImportSummary] = useState(null); // { invalidFields, duplicates, toAdd } — shown as in-app confirm before commit
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const dragLeadId = useRef(null);
  const toast = useToast();

  // SCALE NOTE: At 11k+ leads the leads subscription hits InstantDB's
  // handle-receive timeout. We trade live table sync for correctness and fetch
  // the current page + counts via /api/leads-page. Secondary collections stay
  // on the live subscription — they're small enough to be safe.
  const { data, isLoading, error } = db.useQuery({
    customers: { $: { where: { userId: ownerId }, limit: 500 } },
    teamMembers: { $: { where: { userId: ownerId } } },
    userProfiles: { $: { where: { userId: ownerId } } },
    partnerApplications: { $: { where: { userId: ownerId, status: 'Approved' } } },
  });
  // Drawer data: only loads when a lead detail is open — avoids fetching logs for the whole list
  const drawerLeadId = viewLead?.id || editData?.id || null;
  const { data: drawerData } = db.useQuery(drawerLeadId ? {
    activityLogs: { $: { where: { entityId: drawerLeadId } } },
    callLogs: { $: { where: { leadId: drawerLeadId } } },
  } : {});
  const teamCanSeeAllLeads = data?.userProfiles?.[0]?.teamCanSeeAllLeads !== false;
  const teamCanSeeUnassignedLeads = data?.userProfiles?.[0]?.teamCanSeeUnassignedLeads !== false;
  const myTeamMember = (data?.teamMembers || []).find(t => (t.email || '').toLowerCase() === (user.email || '').toLowerCase());
  // perms.name is the authoritative team-member name (usePermissions resolves it
  // from the owner's member list). On the Postgres/JWT path user.name is empty,
  // so without this fallback myName can be '' — which silently zeroes the
  // name-based lead visibility filter and hides all of a member's assigned leads.
  const myName = myTeamMember?.name || perms?.name || user.name || '';

  // Server-driven page state — { items, counts, totalFiltered }
  const [pageData, setPageData] = useState(null);
  const [pageLoading, setPageLoading] = useState(true);
  // `leads` is ONLY the current page after server filtering. Duplicate checks
  // that used to scan a full in-memory list now go through /api/lead-check-duplicate.
  const leads = pageData?.items || [];
  const customers = data?.customers || [];
  const teamRaw = data?.teamMembers || [];
  // Persist last known team list so the dropdown never flashes empty while the
  // subscription reconnects (e.g. on tab-switch or brief network hiccup).
  const teamCacheRef = useRef([]);
  if (teamRaw.length > 0) teamCacheRef.current = teamRaw;
  const team = teamCacheRef.current;
  const customFields = data?.userProfiles?.[0]?.customFields || [];
  const disabledStages = data?.userProfiles?.[0]?.disabledStages || [];
  const wonStage = data?.userProfiles?.[0]?.wonStage || 'Won';
  const activeSources = data?.userProfiles?.[0]?.sources || DEFAULT_SOURCES;
  const activeRequirements = data?.userProfiles?.[0]?.requirements || DEFAULT_REQUIREMENTS;
  const productCats = data?.userProfiles?.[0]?.productCats || DEFAULT_PROD_CATS;
  const allStages = data?.userProfiles?.[0]?.stages || DEFAULT_STAGES;
  const partners = data?.partnerApplications || [];
  const partnerLeadSource = data?.userProfiles?.[0]?.partnerLeadSource || 'Channel Partners';
  
  useEffect(() => {
    const openId = localStorage.getItem('tc_open_lead');
    if (!openId || !ownerId) return;
    // Try current page first. If not there, fetch by id — necessary because
    // the server-paginated table only holds ~25 rows.
    const target = leads.find(l => l.id === openId);
    if (target) {
      setViewLead(target);
      localStorage.removeItem('tc_open_lead');
      return;
    }
    (async () => {
      try {
        const r = await fetch(`/api/data/leads?id=${encodeURIComponent(openId)}`, { method: 'GET' });
        if (!r.ok) return;
        const json = await r.json();
        const found = Array.isArray(json?.items) ? json.items.find(l => l.id === openId) : (json?.item || null);
        if (found) {
          setViewLead(found);
          localStorage.removeItem('tc_open_lead');
        }
      } catch { /* ignore */ }
    })();
  }, [leads, ownerId]);

  // Fetch saved settings from localStorage (per user)
  const profile = data?.userProfiles?.[0];
  const profileId = profile?.id;
  const myViewConfig = useMemo(() => {
    try { return JSON.parse(localStorage.getItem(`leadView_${user.email}`)); } catch { return null; }
  }, [user.email]);
  const savedCols = myViewConfig?.leadCols;
  const savedLeadStages = myViewConfig?.leadStages;
  const savedDefaultPageSize = myViewConfig?.defaultPageSize || 25;

  // Sync pageSize with profile default ONLY when profile loads or default changes
  useEffect(() => {
    if (savedDefaultPageSize) {
      setPageSize(savedDefaultPageSize);
      setTempPageSize(savedDefaultPageSize);
    }
  }, [savedDefaultPageSize]);

  const allPossibleCols = ['Created', 'Phone', 'Source', 'Stage', 'Assigned', 'Follow Up', 'Requirement', 'Reminder', ...(showPartners ? ['Distributor', 'Retailer'] : []), ...customFields.map(c => c.name)];
  const activeCols = savedCols || allPossibleCols;

  // activeStages is for visual components (Kanban/List), should exclude deleted & disabled
  const activeStages = (savedLeadStages?.length > 0 
    ? allStages.filter(s => savedLeadStages.includes(s)) 
    : allStages
  ).filter(s => !disabledStages.includes(s));
  
  // allEnabledStages is for Dropdowns (Create/Edit Form), should include ALL current settings stages except disabled
  const allEnabledStages = allStages.filter(s => !disabledStages.includes(s));
  
  const isWon = (s) => s === wonStage;

  // Initialize EMPTY_LEAD values if empty (only when editing, not creating)
  useEffect(() => {
    if (editData && form.source === '' && activeSources.length > 0) {
      setForm(prev => ({ ...prev, source: activeSources[0], stage: activeStages[0], requirement: activeRequirements[0] }));
    }
  }, [activeSources, activeStages, activeRequirements, form.source, editData]);

  // Debounced search — avoids hammering /api/leads-page on every keystroke
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const totalFiltered = pageData?.totalFiltered || 0;
  const totalPages = pageSize === 'all' ? 1 : Math.max(1, Math.ceil(totalFiltered / (pageSize || 25)));
  // Server has already sliced to current page — no client-side pagination.
  const paginated = leads;
  const filtered = leads; // kept for export/bulk-select; export now uses current page only

  useEffect(() => { setCurrentPage(1); }, [tab, debouncedSearch, srcFilter, stgFilter, reqFilter, staffFilter, pageSize]);

  // Build the /api/leads-page request body. Extracted so mutations can re-use it.
  const buildPageBody = () => {
    const now = new Date();
    const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(now); todayEnd.setHours(23, 59, 59, 999);
    const yStart = new Date(todayStart); yStart.setDate(yStart.getDate() - 1);
    const yEnd = new Date(todayEnd); yEnd.setDate(yEnd.getDate() - 1);
    const tStart = new Date(todayStart); tStart.setDate(tStart.getDate() + 1);
    const tEnd = new Date(todayEnd); tEnd.setDate(tEnd.getDate() + 1);
    const weekStart = new Date(todayStart); weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const next7End = new Date(todayStart); next7End.setDate(next7End.getDate() + 7); next7End.setHours(23,59,59,999);
    const customFromMs = customFrom ? new Date(customFrom + 'T00:00:00').getTime() : null;
    const customToMs = customTo ? new Date(customTo + 'T23:59:59.999').getTime() : null;

    return {
      ownerId,
      userEmail: user.email,
      myName,
      teamCanSeeAllLeads,
      isOwner: !!perms?.isOwner,
      teamCanSeeUnassignedLeads,
      mode: view,
      dateMode,
      sortOrder,
      tab,
      customFromMs,
      customToMs,
      staffFilter,
      srcFilter,
      stgFilter,
      reqFilter,
      search: debouncedSearch,
      visibleStages: (savedLeadStages && savedLeadStages.length > 0) ? savedLeadStages : null,
      disabledStages,
      page: currentPage,
      pageSize: pageSize === 'all' ? 10000 : pageSize,
      boundaries: {
        nowMs: now.getTime(),
        todayStartMs: todayStart.getTime(), todayEndMs: todayEnd.getTime(),
        yesterdayStartMs: yStart.getTime(), yesterdayEndMs: yEnd.getTime(),
        tomorrowStartMs: tStart.getTime(), tomorrowEndMs: tEnd.getTime(),
        weekStartMs: weekStart.getTime(),
        monthStartMs: monthStart.getTime(),
        next7EndMs: next7End.getTime(),
      },
    };
  };

  // Re-fetch helper exposed to mutations (save/delete/bulk/import)
  const [refetchCounter, setRefetchCounter] = useState(0);
  const refetchPage = () => setRefetchCounter(c => c + 1);

  useEffect(() => {
    if (!ownerId) return;
    const controller = new AbortController();
    let cancelled = false;
    setPageLoading(true);
    (async () => {
      try {
        const r = await fetch('/api/leads-page', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(buildPageBody()),
          signal: controller.signal,
        });
        if (!r.ok) return;
        const json = await r.json();
        if (!cancelled) setPageData(json);
      } catch { /* swallow — keep previous pageData so UI doesn't flash */ }
      finally { if (!cancelled) setPageLoading(false); }
    })();
    return () => { cancelled = true; controller.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    ownerId, view, tab, dateMode, sortOrder, customFrom, customTo,
    debouncedSearch, srcFilter, stgFilter, reqFilter, staffFilter,
    currentPage, pageSize, myName, teamCanSeeAllLeads, perms?.isOwner,
    // savedLeadStages is serialised to detect changes
    JSON.stringify(savedLeadStages || []),
    JSON.stringify(disabledStages),
    refetchCounter,
  ]);

  // Server-driven counts. Persist last counts in a ref so tabs keep showing
  // numbers during a filter-change refetch instead of going blank.
  const countsRef = useRef(null);
  if (pageData?.counts) countsRef.current = pageData.counts;
  const fullCounts = countsRef.current;
  const customCount = fullCounts?.custom || 0;

  const openCreate = () => {
    setEditData(null);
    setForm({
      ...EMPTY_LEAD,
      source: '',
      stage: '',
      requirement: '',
      productCat: ''
    });
    setModal(true);
  };
  const openEdit = (l) => { 
    setEditData(l); 
    setForm({ 
      ...EMPTY_LEAD,
      ...l,
      custom: { ...EMPTY_LEAD.custom, ...(l.custom || {}) },
      retailerId: l.retailerId || '',
      distributorId: l.distributorId || ''
    }); 
    setModal(true); 
  };

  const logActivity = async (leadId, text, extra = {}) => {
    const lead = leads.find(l => l.id === leadId);
    const logId = id();
    const logData = {
      entityId: leadId, entityType: 'lead',
      entityName: lead?.companyName || lead?.name || '',
      action: extra.action || 'edited',
      text, userId: ownerId, actorId: user.id,
      userName: user.email, teamMemberId: myTeamMember?.id || null,
      createdAt: Date.now(), ...extra,
    };
    await dbWrite(dbOp.update('activityLogs', logId, logData));
  };

  const logCall = async (lead) => {
    if (!lead?.phone) return;
    const myMember = team.find(t => t.email === user.email);
    await dbWrite(dbOp.update('callLogs', id(), {
      phone: lead.phone, contactName: lead.name || '',
      direction: 'Outgoing', outcome: 'Connected', duration: 0, notes: '',
      leadId: lead.id, leadName: lead.name || '',
      staffEmail: user.email, staffName: myMember?.name || user.email,
      userId: ownerId, actorId: user.id,
      createdAt: Date.now(), updatedAt: Date.now(),
    }));
    await logActivity(lead.id, `📞 Outgoing call to ${lead.phone}`);
    window.location.href = `tel:${lead.phone}`;
  };

  const saveLead = async () => {
    if (editData && !canEdit) { toast('Permission denied: cannot edit leads', 'error'); return; }
    if (!editData && !canCreate) { toast('Permission denied: cannot create leads', 'error'); return; }
    // Plan-limit check uses planTotal — the raw business-wide count BEFORE
    // any filters (stage, team, search). This prevents team members from
    // bypassing the limit by only seeing their own assigned leads.
    const currentLeadCount = pageData?.planTotal ?? pageData?.counts?.total ?? leads.length;
    if (!editData && planEnforcement && !planEnforcement.isWithinLimit('maxLeads', currentLeadCount)) { toast('Lead limit reached for your plan. Please upgrade to add more leads.', 'error'); return; }
    if (!form.name.trim()) { toast('Name is required', 'error'); return; }
    if (!form.source) { toast('Please select a source', 'error'); return; }
    if (!form.stage) { toast('Please select a stage', 'error'); return; }

    // Duplicate phone/email check — table is server-paginated now, so we
    // can't scan an in-memory list. Delegate to the server endpoint.
    const checkPhone = (form.phone || '').trim();
    const checkEmail = (form.email || '').trim();
    if (checkPhone || checkEmail) {
      try {
        const r = await fetch('/api/lead-check-duplicate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ownerId,
            phone: checkPhone,
            email: checkEmail,
            excludeLeadId: editData?.id || null,
          }),
        });
        if (!r.ok) {
          // Block save if we can't verify — better to reject than allow a duplicate
          toast('Could not verify duplicate — please try again.', 'error');
          return;
        }
        const { duplicate } = await r.json();
        if (duplicate) {
          toast(`Duplicate! A record with this ${duplicate.matchedOn === 'phone' ? 'phone number' : 'email'} already exists (${duplicate.name}).`, 'error');
          return;
        }
      } catch {
        // Network error — block save to prevent duplicates
        toast('Network error during duplicate check. Please try again.', 'error');
        return;
      }
    }

    setSaving(true);
    try {
      if (editData) {
        const changes = [];
        const fields = { name: 'Name', phone: 'Phone', email: 'Email', source: 'Source', stage: 'Stage', assign: 'Assignee', followup: 'Follow Up', requirement: 'Requirement', notes: 'Notes', productCat: 'Product Category' };
        Object.entries(fields).forEach(([k, label]) => {
          if (editData[k] !== form[k]) {
            let oldVal = editData[k] || 'None';
            let newVal = form[k] || 'None';
            if (k === 'followup') {
              oldVal = oldVal === 'None' ? 'None' : fmtDT(oldVal);
              newVal = newVal === 'None' ? 'None' : fmtDT(newVal);
            }
            changes.push(`${label} changed from "${oldVal}" to "${newVal}"`);
          }
        });

        // Custom fields check
        const oldCustom = editData.custom || {};
        const newCustom = form.custom || {};
        customFields.forEach(cf => {
          if (oldCustom[cf.name] !== newCustom[cf.name]) {
            changes.push(`${cf.name} (Custom) changed from "${oldCustom[cf.name] || 'None'}" to "${newCustom[cf.name] || 'None'}"`);
          }
        });
        
        const updates = { ...form, userId: ownerId, actorId: user.id, updatedAt: Date.now() };
        if (editData.stage !== form.stage) {
          updates.stageChangedAt = Date.now();
        }
        if (form.assign && form.assign !== editData.assign) {
          updates.assignedAt = Date.now();
        }
        await dbWrite(dbOp.update('leads', editData.id, updates));

        if (isWon(form.stage) && editData.stage !== form.stage) {
          await convertToCustomer({ ...editData, ...form }, true);
        }

        if (changes.length > 0) {
          await logActivity(editData.id, changes.join(' | '), { action: 'edited' });
        }

        // Structured stage-change log for analytics (Stage Transition Report)
        if (editData.stage !== form.stage && editData.stage && form.stage) {
          await dbWrite(dbOp.update('activityLogs', id(), {
            entityId: editData.id, entityType: 'lead',
            entityName: form.companyName || form.name || '',
            action: 'stage-change', fromStage: editData.stage, toStage: form.stage,
            text: `Stage: ${editData.stage} → ${form.stage}`,
            userId: ownerId, actorId: user.id, userName: user.email,
            teamMemberId: myTeamMember?.id || null, createdAt: Date.now()
          }));
        }

        toast('Lead updated!', 'success');
        refetchPage();

        // Fire WhatsApp notifications for lead updates
        const profileForNotif = data?.userProfiles?.[0];
        if (profileForNotif) {
          // Resolve the assigned staff member's phone (assign stores name or email)
          const assignedMember = team.find(t =>
            t.name === form.assign || (t.email && t.email === form.assign)
          );
          const commonData = {
            client: form.name, lead: form.name,
            phone: form.phone, leadphoneno: form.phone, clientphoneno: form.phone,
            email: form.email || '', stage: form.stage || '',
            source: form.source || '', assignee: form.assign || '',
            requirement: form.requirement || '',
            assigneePhone: assignedMember?.phone || '',
            date: new Date().toISOString().split('T')[0],
            bizName: profileForNotif.bizName || profileForNotif.businessName || '',
            ownerPhone: profileForNotif.waNotifPhone || profileForNotif.phone || '',
            entityId: editData.id,
          };
          // Stage changed
          if (editData.stage !== form.stage && form.stage) {
            fireAutoNotifications('lead_stage_changed', {
              ...commonData,
              fromstage: editData.stage || '',
              tostage: form.stage,
            }, profileForNotif, ownerId).catch(() => {});
          }
          // Assigned / reassigned
          if (form.assign && form.assign !== editData.assign) {
            fireAutoNotifications('lead_assigned', {
              ...commonData,
              assignee: form.assign,
            }, profileForNotif, ownerId).catch(() => {});
          }
          // Converted to customer
          if (isWon(form.stage) && editData.stage !== form.stage) {
            fireAutoNotifications('customer_created', commonData, profileForNotif, ownerId).catch(() => {});
          }
        }
      } else {
        const newId = id();
        const newLeadPayload = { ...form, userId: ownerId, actorId: user.id, createdAt: Date.now() };
        if (form.assign) newLeadPayload.assignedAt = newLeadPayload.createdAt;
        await dbWrite([
          dbOp.update('leads', newId, newLeadPayload),
          dbOp.update('activityLogs', id(), {
            entityId: newId, entityType: 'lead',
            entityName: form.companyName || form.name || '',
            action: 'created',
            text: `Created lead **${form.name}**${form.followup ? ` | Follow Up set to ${fmtDT(form.followup)}` : ''}`,
            userId: ownerId, actorId: user.id, userName: user.email,
            teamMemberId: myTeamMember?.id || null, createdAt: Date.now(),
          }),
        ]);
        toast(`Lead "${form.name}" created!`, 'success');
        refetchPage();
        
        // Fire WhatsApp auto-notification for new lead
        const profile = data?.userProfiles?.[0];
        if (profile && form.phone) {
          fireAutoNotifications('lead_created', {
            client: form.name,
            lead: form.name,
            phone: form.phone,
            leadphoneno: form.phone,
            clientphoneno: form.phone,
            email: form.email || '',
            stage: form.stage || '',
            source: form.source || '',
            requirement: form.requirement || '',
            date: new Date().toISOString().split('T')[0],
            bizName: profile.bizName || profile.businessName || '',
            ownerPhone: profile.waNotifPhone || profile.phone || '',
            entityId: form.phone || form.email || form.name,
          }, profile, ownerId).catch(() => {});
        }
      }
      setModal(false);
    } catch (e) { toast('Error saving lead', 'error'); }
    finally { setSaving(false); }
  };

  const deleteLead = async (leadId) => {
    if (!canDelete) { toast('Permission denied: cannot delete leads', 'error'); return; }
    if (!confirm('Delete this lead? All associated activity logs and tasks will be removed permanently.')) return;
    try {
      const res = await fetch('/api/data', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          module: 'leads',
          ownerId,
          actorId: user.id,
          userName: user.email,
          id: leadId,
          logText: 'Lead deleted from CRM'
        })
      });
      if (!res.ok) throw new Error('Failed to delete lead');
      toast('Lead deleted', 'error');
      refetchPage();
    } catch (e) {
      toast('Error deleting lead', 'error');
    }
  };

  const downloadLeadsTemplate = () => {
    const headers = ['Name', 'Company Name', 'Email', 'Phone', 'Source', 'Stage', 'Requirement', 'Notes'];
    const sample = ['John Doe', 'Acme Corp', 'john@example.com', '9876543210', 'Website', 'New', 'Enterprise Plan', 'Interested in annual plan'];
    const csv = [headers.join(','), sample.join(',')].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'leads_import_template.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  const handleBulkImport = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (evt) => {
      const text = evt.target.result;
      const lines = text.split(/\r?\n/).filter(Boolean);
      if (lines.length < 2) return toast('CSV is empty or missing data', 'error');
      
      const parseLine = (line) => {
        const row = [];
        let cur = '', inQuotes = false;
        for (let i = 0; i < line.length; i++) {
          if (line[i] === '"') inQuotes = !inQuotes;
          else if (line[i] === ',' && !inQuotes) { row.push(cur); cur = ''; }
          else cur += line[i];
        }
        row.push(cur);
        return row.map(v => v.trim().replace(/^"|"$/g, ''));
      };

      const headers = parseLine(lines[0]);
      setImportHeaders(headers);
      setImportData(lines.slice(1).map(parseLine));
      setImportSample(parseLine(lines[1]));

      // Auto-mapping using explicit aliases (prevents false positives like "Company Name" → "name")
      const HEADER_ALIASES = {
        name: ['name', 'leadname', 'contactname', 'fullname', 'firstname', 'person'],
        companyName: ['companyname', 'company', 'organization', 'org', 'business', 'businessname', 'firm'],
        email: ['email', 'emailaddress', 'mail', 'emailid'],
        phone: ['phone', 'phonenumber', 'mobile', 'mobilenumber', 'contact', 'tel', 'telephone', 'contactnumber'],
        source: ['source', 'leadsource', 'channel', 'medium'],
        stage: ['stage', 'status', 'leadstage', 'leadstatus'],
        requirement: ['requirement', 'requirements', 'need', 'product', 'interest'],
        notes: ['notes', 'note', 'comment', 'comments', 'description', 'remark', 'remarks'],
        followup: ['followup', 'followupdate', 'nextfollowup', 'callback', 'callbackdate'],
        assign: ['assign', 'assignedto', 'assigned', 'staff', 'agent', 'owner', 'salesperson'],
        label: ['label', 'tag', 'priority'],
      };
      const newMapping = JSON.parse(JSON.stringify(DEFAULT_IMPORT_MAPPING));
      headers.forEach(h => {
        const cleanH = h.toLowerCase().replace(/[^a-z0-9]/g, '');
        for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
          if (newMapping[field] && !newMapping[field].value) {
            if (aliases.includes(cleanH)) {
              newMapping[field] = { type: 'column', value: h };
              break;
            }
          }
        }
      });
      setImportMapping(newMapping);
      setImportSummary(null);
      setImporting(false);
      setImportProgress({ phase: '', current: 0, total: 0 });
      setImportMappingModal(true);
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const performImport = async () => {
    if (importing) return; // guard against double-clicks
    if (!importMapping.name.value && importMapping.name.type === 'column') return toast('Please map the Name field', 'error');

    setImporting(true);
    setImportProgress({ phase: 'validating', current: 0, total: importData.length });
    // Yield a frame so the progress panel paints before the (synchronous) parse loop blocks the thread
    await new Promise(r => setTimeout(r, 30));
    const toAdd = [];
    const duplicates = [];
    const invalidFields = [];
    let rowIndex = 2; // Data starts at row 2 assuming row 1 is headers

    // O(1) dedup lookups against the FULL database via server endpoint.
    // Note: `leads` is only the current page (~25 rows) — scanning it would miss 99%+ of records.
    // We build the index by calling /api/lead-check-duplicate for each candidate row below.
    // Also include the current page + customers as a fast in-memory pre-filter to avoid
    // unnecessary API calls for obviously clean rows.
    const emailIndexLocal = new Map();
    const phoneIndexLocal = new Map();
    for (const r of leads) {
      if (r.email) emailIndexLocal.set(String(r.email).toLowerCase().trim(), true);
      if (r.phone) phoneIndexLocal.set(String(r.phone).replace(/\D/g, ''), true);
    }
    for (const r of customers) {
      if (r.email) emailIndexLocal.set(String(r.email).toLowerCase().trim(), true);
      if (r.phone) phoneIndexLocal.set(String(r.phone).replace(/\D/g, ''), true);
    }
    // Validation sets for O(1) membership checks
    const stageSet = new Set(allStages);
    const sourceSet = new Set(activeSources);
    const reqSet = new Set(activeRequirements);
    // Assignee must match a current team member. Map normalized (trim + collapse
    // spaces + lowercase) name -> the member's exact stored name, so we can
    // canonicalize case/space variants and reject unknown assignees.
    const memberByNorm = new Map(
      (team || []).filter(m => m.name).map(m => [normalizeName(m.name).toLowerCase(), m.name])
    );

    // PASS 1 — parse + validate + intra-file dedup (all synchronous, no network).
    // Build a list of clean candidates; the expensive cross-database dedup runs
    // ONCE as a batch after this loop (not per-row, which froze the browser at
    // thousands of rows). `candidates[]` keeps the row index + keys for the
    // batch result mapping.
    const candidates = []; // { lead, rowIndex, phone, email }
    for (const vals of importData) {
      const lead = {
        userId: ownerId,
        actorId: user.id,
        createdAt: Date.now(),
        custom: {}
      };

      Object.entries(importMapping).forEach(([field, m]) => {
        let val = '';
        if (m.type === 'column') {
          const idx = importHeaders.indexOf(m.value);
          if (idx !== -1) val = vals[idx] || '';
        } else {
          val = m.value;
        }

        if (['name', 'companyName', 'email', 'phone', 'source', 'stage', 'label', 'requirement', 'notes', 'followup', 'assign'].includes(field)) {
          lead[field] = val;
        } else {
          lead.custom[field] = val;
        }
      });

      if (!lead.name) {
        rowIndex++;
        continue;
      }

      let hasInvalidField = false;

      // Validate Stage
      if (!lead.stage || !stageSet.has(lead.stage)) {
        invalidFields.push(`Row ${rowIndex}: ${lead.name} (Stage '${lead.stage || 'Empty'}' not found in business settings)`);
        hasInvalidField = true;
      }

      // Validate Source
      if (lead.source && !sourceSet.has(lead.source)) {
        invalidFields.push(`Row ${rowIndex}: ${lead.name} (Source '${lead.source}' not found in business settings)`);
        hasInvalidField = true;
      }

      // Validate Requirement
      if (lead.requirement && !reqSet.has(lead.requirement)) {
        invalidFields.push(`Row ${rowIndex}: ${lead.name} (Requirement '${lead.requirement}' not found in business settings)`);
        hasInvalidField = true;
      }

      // Validate Assignee — must be a current team member. Canonicalize case/space
      // variants to the member's exact name; reject a non-empty unknown assignee
      // so we never import a lead assigned to someone who isn't on the team.
      if (lead.assign && String(lead.assign).trim()) {
        const canonical = memberByNorm.get(normalizeName(lead.assign).toLowerCase());
        if (canonical) lead.assign = canonical;
        else {
          invalidFields.push(`Row ${rowIndex}: ${lead.name} (Assignee '${lead.assign}' is not a team member)`);
          hasInvalidField = true;
        }
      }

      if (hasInvalidField) {
        rowIndex++;
        continue;
      }

      const emailKey = lead.email ? String(lead.email).toLowerCase().trim() : '';
      const phoneKey = lead.phone ? String(lead.phone).replace(/\D/g, '') : '';

      // Fast local pre-check: current page + customers already in memory, plus
      // keys already reserved by earlier rows in THIS file (intra-file dedup).
      const dupEmailLocal = emailKey && emailIndexLocal.has(emailKey);
      const dupPhoneLocal = phoneKey && phoneIndexLocal.has(phoneKey);

      if (dupEmailLocal || dupPhoneLocal) {
        const matchedOn = dupEmailLocal ? 'Email' : 'Phone';
        const matchedVal = dupEmailLocal ? lead.email : lead.phone;
        duplicates.push(`Row ${rowIndex}: ${lead.name} (${matchedOn} '${matchedVal}' already exists)`);
        rowIndex++;
        continue;
      }

      // Reserve keys so later rows in the same file dedup against this one
      if (emailKey) emailIndexLocal.set(emailKey, true);
      if (phoneKey) phoneIndexLocal.set(phoneKey, true);

      // Create-with-assignee (bulk import) → stamp assignedAt so dated "assigned" reports count it
      if ((lead.assign || '').trim()) lead.assignedAt = lead.createdAt;
      candidates.push({ lead, rowIndex, phone: lead.phone || '', email: lead.email || '' });
      rowIndex++;
    }

    // PASS 2 — single batched cross-database dedup check (one request, one DB
    // scan) for all candidates that have a phone or email. Rows flagged as
    // duplicates are moved to `duplicates[]`; the rest go to `toAdd`.
    const dupByIndex = {};
    const checkable = candidates.filter(c => c.phone || c.email);
    if (checkable.length > 0) {
      setImportProgress({ phase: 'checking', current: 0, total: checkable.length });
      await new Promise(r => setTimeout(r, 30));
      try {
        const dupRes = await fetch('/api/lead-check-duplicate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ownerId,
            candidates: checkable.map(c => ({ phone: c.phone, email: c.email })),
          }),
        });
        if (dupRes.ok) {
          const { duplicates: dupMap } = await dupRes.json();
          // dupMap is keyed by the index within `checkable`
          Object.entries(dupMap || {}).forEach(([k, v]) => {
            const cand = checkable[Number(k)];
            if (cand) dupByIndex[cand.rowIndex] = v;
          });
        }
      } catch { /* network hiccup — fall through, let the insert attempt the rows */ }
    }

    for (const c of candidates) {
      const hit = dupByIndex[c.rowIndex];
      if (hit) {
        duplicates.push(`Row ${c.rowIndex}: ${c.lead.name} (${hit.matchedOn === 'phone' ? 'Phone' : 'Email'} already exists as "${hit.name}")`);
      } else {
        toAdd.push(c.lead);
      }
    }

    // If anything was skipped, pause and show a single clean in-app summary
    // (counts + a few examples) instead of a noisy native popup listing every
    // row. The user reviews once and clicks "Import N" to commit.
    if (invalidFields.length > 0 || duplicates.length > 0) {
      setImporting(false);
      setImportProgress({ phase: '', current: 0, total: 0 });
      setImportSummary({ invalidFields, duplicates, toAdd });
      return;
    }

    if (toAdd.length === 0) {
      setImporting(false);
      setImportMappingModal(false);
      return toast(`No new leads imported.`, 'warning');
    }

    await commitImport(toAdd, duplicates.length);
  };

  // Inserts the validated rows. Separated from performImport so the in-app
  // summary panel can call it after the user confirms skipping invalid/dupes.
  const commitImport = async (toAdd, duplicateCount = 0) => {
    setImportSummary(null);
    setImporting(true);

    // Plan limit check — enforce maxLeads before committing any records
    if (planEnforcement) {
      const maxLeads = planEnforcement.getLimit('maxLeads');
      if (maxLeads !== -1) {
        const currentTotal = pageData?.planTotal ?? pageData?.counts?.total ?? 0;
        const remaining = maxLeads - currentTotal;
        if (remaining <= 0) {
          setImporting(false);
          return toast(`Lead limit reached (${maxLeads.toLocaleString()} max on your plan). Upgrade to import more leads.`, 'error');
        }
        if (toAdd.length > remaining) {
          const skipped = toAdd.length - remaining;
          if (!window.confirm(`Your plan allows ${maxLeads.toLocaleString()} leads. You have ${currentTotal.toLocaleString()} and are trying to import ${toAdd.length.toLocaleString()}.\n\nOnly ${remaining.toLocaleString()} slot${remaining === 1 ? '' : 's'} remaining — ${skipped.toLocaleString()} lead${skipped === 1 ? '' : 's'} will be skipped.\n\nImport first ${remaining.toLocaleString()} leads?`)) {
            setImporting(false);
            return;
          }
          toAdd.splice(remaining); // trim to fit within limit
        }
      }
    }

    // Keep the modal open and show a live progress bar while inserting, so the
    // user can see exactly how far the import has got.
    setImportProgress({ phase: 'importing', current: 0, total: toAdd.length });

    // Bigger batches + parallel chunks — at 9k leads, serial batches of 50 meant 180 round-trips
    const BATCH_SIZE = 200;     // rows per transaction
    const PARALLEL = 4;         // transactions in flight at once
    const batches = [];
    for (let i = 0; i < toAdd.length; i += BATCH_SIZE) {
      batches.push(toAdd.slice(i, i + BATCH_SIZE));
    }
    let ok = 0;
    let failed = 0;
    let processed = 0;
    for (let i = 0; i < batches.length; i += PARALLEL) {
      const group = batches.slice(i, i + PARALLEL);
      const results = await Promise.allSettled(
        group.map(batch => dbWrite(batch.map(ld => dbOp.update('leads', id(), ld))))
      );
      results.forEach((r, idx) => {
        if (r.status === 'fulfilled') ok += group[idx].length;
        else failed += group[idx].length;
      });
      processed += group.reduce((s, b) => s + b.length, 0);
      setImportProgress({ phase: 'importing', current: processed, total: toAdd.length });
    }
    // Done — show the completion state briefly so the user sees it, then close
    setImportProgress({ phase: 'done', current: ok, total: toAdd.length });
    await new Promise(r => setTimeout(r, 900));
    setImportMappingModal(false);
    // Single summary activity log for the entire import
    // (one row per bulk import instead of one-per-lead — saves thousands of rows at CSV scale)
    if (ok > 0) {
      try {
        await dbWrite(dbOp.update('activityLogs', id(), {
          entityType: 'lead', entityId: 'bulk',
          entityName: `Bulk import: ${ok} leads`, action: 'bulk-import',
          text: `Imported ${ok} leads from CSV${failed > 0 ? ` (${failed} failed)` : ''}${duplicateCount > 0 ? ` (${duplicateCount} duplicates skipped)` : ''}`,
          count: ok, failedCount: failed, duplicateCount,
          userId: ownerId, actorId: user.id, userName: user.email,
          teamMemberId: myTeamMember?.id || null, createdAt: Date.now(),
        }));
      } catch {}
    }

    if (failed === 0) toast(`Imported ${ok} leads.`, 'success');
    else if (ok > 0) toast(`Imported ${ok} leads. ${failed} failed — please retry.`, 'warning');
    else toast(`Import failed. No leads were saved.`, 'error');
    setImporting(false);
    refetchPage();
  };

  const getExcelCol = (idx) => {
    let name = '';
    let i = idx;
    while (i >= 0) {
      name = String.fromCharCode((i % 26) + 65) + name;
      i = Math.floor(i / 26) - 1;
    }
    return name;
  };

  const handleExportExcel = () => {
    if (leads.length === 0) return toast('No leads to export', 'error');
    
    const escapeCSV = (val) => {
      if (val === null || val === undefined) return '';
      const str = String(val).replace(/"/g, '""');
      return str.includes(',') || str.includes('"') || str.includes('\n') ? `"${str}"` : str;
    };

    // Build columns dynamically to match the UI table exactly
    const customFieldNames = customFields.map(cf => cf.name);

    // Column definitions: { header, getValue(lead) }
    const columnDefs = [
      { header: 'Name', getValue: l => l.companyName || l.name },
      { header: 'Contact Name', getValue: l => l.companyName ? l.name : '' },
    ];

    // Add columns in the same order as the UI table
    if (activeCols.includes('Created')) columnDefs.push({ header: 'Created At', getValue: l => l.createdAt ? new Date(l.createdAt).toLocaleString() : '' });
    if (activeCols.includes('Phone')) columnDefs.push({ header: 'Phone', getValue: l => l.phone || '' });
    columnDefs.push({ header: 'Email', getValue: l => l.email || '' }); // Always include email
    if (activeCols.includes('Source')) columnDefs.push({ header: 'Source', getValue: l => l.source || '' });
    if (activeCols.includes('Stage')) columnDefs.push({ header: 'Stage', getValue: l => l.stage || '' });
    if (activeCols.includes('Assigned')) columnDefs.push({ header: 'Assigned', getValue: l => l.assign || '' });
    if (activeCols.includes('Follow Up')) columnDefs.push({ header: 'Follow Up', getValue: l => l.followup ? new Date(l.followup).toLocaleString() : '' });
    if (activeCols.includes('Requirement')) columnDefs.push({ header: 'Requirement', getValue: l => l.requirement || '' });
    if (activeCols.includes('Reminder')) columnDefs.push({ header: 'Reminder', getValue: l => [l.remWA && 'WhatsApp', l.remEmail !== false && 'Email', l.remSMS && 'SMS'].filter(Boolean).join(', ') || '' });
    if (activeCols.includes('Distributor')) columnDefs.push({ header: 'Distributor', getValue: l => l.distributorId ? (partners.find(p => p.id === l.distributorId)?.companyName || partners.find(p => p.id === l.distributorId)?.name || '') : '' });
    if (activeCols.includes('Retailer')) columnDefs.push({ header: 'Retailer', getValue: l => l.retailerId ? (partners.find(p => p.id === l.retailerId)?.companyName || partners.find(p => p.id === l.retailerId)?.name || '') : '' });

    // Add custom fields that are visible in the UI
    customFields.filter(cf => activeCols.includes(cf.name)).forEach(cf => {
      columnDefs.push({ header: cf.name, getValue: l => l.custom?.[cf.name] || '' });
    });

    // Always include notes at the end
    columnDefs.push({ header: 'Notes', getValue: l => l.notes || '' });

    const headers = columnDefs.map(c => c.header);
    const csvRows = [headers.join(',')];
    
    filtered.forEach(l => {
      const row = columnDefs.map(c => escapeCSV(c.getValue(l)));
      csvRows.push(row.join(','));
    });

    const csvString = csvRows.join('\n');
    const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `leads_export_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast('Export successful!', 'success');
  };

  const bulkDelete = async () => {
    if (!selectedIds.size || !confirm(`Delete ${selectedIds.size} leads? This will also remove all their activity logs and tasks.`)) return;
    try {
      await Promise.all([...selectedIds].map(lid => 
        fetch('/api/data', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            module: 'leads',
            ownerId,
            actorId: user.id,
            userName: user.email,
            id: lid,
            logText: 'Bulk lead deletion'
          })
        })
      ));
      setSelectedIds(new Set());
      toast(`${selectedIds.size} leads deleted`, 'error');
      refetchPage();
    } catch (e) {
      toast('Error during bulk deletion', 'error');
    }
  };

  const bulkApply = async () => {
    if (!selectedIds.size || (!pendingBulkAssign && !pendingBulkStage)) return;
    const ids = [...selectedIds];
    const count = ids.length;
    const msgs = [];

    // Build the shared update payload once
    const updates = {};
    if (pendingBulkAssign) { updates.assign = pendingBulkAssign; updates.assignedAt = Date.now(); }
    if (pendingBulkStage) { updates.stage = pendingBulkStage; updates.stageChangedAt = Date.now(); }

    // Track leads that need Won-stage customer conversion (rare, only for subset)
    const wonConversions = [];
    if (pendingBulkStage && isWon(pendingBulkStage)) {
      for (const lid of ids) {
        const lead = leads.find(l => l.id === lid);
        if (lead && lead.stage !== pendingBulkStage) wonConversions.push(lead);
      }
    }

    // Chunk the lead updates — parallel batches of 200, 4 in flight
    const BATCH_SIZE = 200;
    const PARALLEL = 4;
    const batches = [];
    for (let i = 0; i < ids.length; i += BATCH_SIZE) batches.push(ids.slice(i, i + BATCH_SIZE));
    for (let i = 0; i < batches.length; i += PARALLEL) {
      const group = batches.slice(i, i + PARALLEL);
      await Promise.all(group.map(batch =>
        dbWrite(batch.map(lid => dbOp.update('leads', lid, updates)))
      ));
    }

    // Single summary activity log for the entire bulk operation
    // (replaces the previous 2N per-lead log writes — at 1000 leads that's 2000 → 1 row)
    const summaryParts = [];
    if (pendingBulkAssign) summaryParts.push(`assigned to **${pendingBulkAssign}**`);
    if (pendingBulkStage) summaryParts.push(`stage set to **${pendingBulkStage}**`);
    await dbWrite(dbOp.update('activityLogs', id(), {
      entityType: 'lead', entityId: 'bulk',
      entityName: `Bulk: ${count} leads`, action: 'bulk-update',
      text: `Bulk updated ${count} leads — ${summaryParts.join(', ')}`,
      count,
      bulkFields: {
        ...(pendingBulkAssign ? { assign: pendingBulkAssign } : {}),
        ...(pendingBulkStage ? { stage: pendingBulkStage } : {}),
      },
      userId: ownerId, actorId: user.id, userName: user.email,
      teamMemberId: myTeamMember?.id || null, createdAt: Date.now(),
    }));

    // Run Won-stage customer conversions (these still log individually because each creates a customer)
    for (const lead of wonConversions) {
      await convertToCustomer(lead, true);
    }

    if (pendingBulkAssign) msgs.push(`Assigned to ${pendingBulkAssign}`);
    if (pendingBulkStage) msgs.push(`Stage → ${pendingBulkStage}`);
    setPendingBulkAssign('');
    setPendingBulkStage('');
    setSelectedIds(new Set());
    toast(`${count} leads: ${msgs.join(', ')}`, 'success');
    refetchPage();
  };

  const convertToCustomer = async (l, skipConfirm = false) => {
    if (!canEdit) { toast('Permission denied: cannot convert leads', 'error'); return; }
    if (!skipConfirm && !confirm(`Convert ${l.name} to a Customer?`)) return;
    try {
      // Check if already a customer by name or phone/email
      const exists = customers.find(c => 
        (l.email && c.email === l.email) || 
        (l.phone && c.phone === l.phone) ||
        (c.name.trim().toLowerCase() === l.name.trim().toLowerCase())
      );
      if (exists) {
        if (!skipConfirm) toast(`${l.name} is already a customer!`, 'warning');
        return;
      }

      const payload = {
        name: l.name,
        email: l.email || '',
        phone: l.phone || '',
        userId: ownerId,
        leadId: l.id, // link back to source lead for dedup/reporting
        createdAt: Date.now(),
        partnerId: l.partnerId || '',
        distributorId: l.distributorId || '',
        retailerId: l.retailerId || ''
      };
      // Assuming 'lMatch' refers to 'l' from the function parameter, and 'data' is available in scope.
      // If 'data' is not available, this will cause a runtime error.
      const wonStageName = (data?.userProfiles?.[0]?.wonStage || 'Won');
      const txs = [
        dbOp.update('customers', id(), payload),
        dbOp.update('leads', l.id, {
          stage: wonStageName, stageChangedAt: Date.now(),
          email: l.email || '', phone: l.phone || ''
        }),
        dbOp.update('activityLogs', id(), {
          entityId: l.id, entityType: 'lead',
          entityName: l.companyName || l.name || '',
          action: 'converted',
          text: `Manually converted **${l.name}** to Customer. Stage changed to ${wonStageName}.`,
          userId: ownerId, actorId: user.id, userName: user.email,
          teamMemberId: myTeamMember?.id || null, createdAt: Date.now()
        }),
      ];
      if (l.stage && l.stage !== wonStageName) {
        txs.push(dbOp.update('activityLogs', id(), {
          entityId: l.id, entityType: 'lead',
          entityName: l.companyName || l.name || '',
          action: 'stage-change', fromStage: l.stage, toStage: wonStageName,
          text: `Stage: ${l.stage} → ${wonStageName}`,
          userId: ownerId, actorId: user.id, userName: user.email,
          teamMemberId: myTeamMember?.id || null, createdAt: Date.now()
        }));
      }
      await dbWrite(txs);
      toast(`${l.name} is now a Customer!`, 'success');
    } catch {
      toast('Error converting to customer', 'error');
    }
  };

  const saveViewConfig = (colsToSave, stagesVisible, defaultSize, sortOrderToSave) => {
    localStorage.setItem(`leadView_${user.email}`, JSON.stringify({
      leadCols: colsToSave,
      leadStages: stagesVisible,
      defaultPageSize: defaultSize,
      sortOrder: sortOrderToSave,
    }));
    setPageSize(defaultSize);
    setSortOrder(sortOrderToSave);
    setCurrentPage(1);
    setColModal(false);
    toast('View configuration saved', 'success');
  };

  const resetViewConfig = () => {
    localStorage.removeItem(`leadView_${user.email}`);
    setPageSize(25);
    setSortOrder('newest');
    setCurrentPage(1);
    setColModal(false);
    toast('View reset to default', 'success');
  };

  const f = (k) => (e) => setForm(p => ({ ...p, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const cf = (k) => (e) => setForm(p => ({ ...p, custom: { ...(p.custom || {}), [k]: e.target.value } }));

  if (error) return <div className="p-xl text-red-500">Error loading leads: {error.message}</div>;
  if (isLoading || (pageLoading && !pageData)) return (
    <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>
      <div className="spinner" style={{ margin: '0 auto 10px', borderColor: 'var(--muted)', borderTopColor: 'transparent' }} />
      Loading leads...
    </div>
  );

  if (viewLead) {
    const l = viewLead;
    const lLogs = (drawerData?.activityLogs || []).sort((a,b) => b.createdAt - a.createdAt);

    const addNote = async () => {
      if (!noteText.trim()) return;
      await logActivity(l.id, noteText.trim());
      setNoteText('');
      toast('Note added', 'success');
    };

    return (
      <div>
        <div className="sh" style={{ marginBottom: 15 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button className="btn-icon" onClick={() => setViewLead(null)}>← Back</button>
            <div>
              <h2 style={{ fontSize: 24, margin: 0 }}>{l.companyName || l.name}</h2>
              {l.companyName && <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 2 }}>Contact: {l.name}</div>}
              <div className="sub" style={{ fontSize: 13, marginTop: 4 }}>
                {l.email && <span style={{ marginRight: 15 }}>✉ {l.email}</span>}
                {l.phone && <span>☏ {l.phone}</span>}
                <span className={`badge ${stageBadgeClass(l.stage, wonStage)}`} style={{ marginLeft: 15 }}>{l.stage}</span>
              </div>
              <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                {l.phone && (
                  <>
                    <button onClick={() => logCall(l)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, borderRadius: '50%', background: '#eff6ff', color: '#2563eb', border: 'none', cursor: 'pointer' }} title="Call & Log">
                      <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>
                    </button>
                    <a href={`https://wa.me/${l.phone.replace(/\D/g, '')}`} target="_blank" rel="noreferrer" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, borderRadius: '50%', background: '#e8fdf0', color: '#16a34a', textDecoration: 'none' }} title="WhatsApp">
                      <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.888-.788-1.489-1.761-1.663-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 0 0-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/></svg>
                    </a>
                    <a href={`sms:${l.phone}`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, borderRadius: '50%', background: '#f5f3ff', color: '#7c3aed', textDecoration: 'none' }} title="SMS">
                      <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
                    </a>
                  </>
                )}
                {l.email && (
                  <a href={`mailto:${l.email}`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, borderRadius: '50%', background: '#f3f4f6', color: '#4b5563', textDecoration: 'none' }} title="Email">
                    <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg>
                  </a>
                )}
              </div>
            </div>
          </div>
          {canEdit && <button className="btn btn-secondary btn-sm" onClick={() => openEdit(l)}>Edit Lead</button>}
        </div>

        <div className="stat-grid" style={{ marginBottom: 25 }}>
          <div className="stat-card sc-blue"><div className="lbl">Source</div><div className="val" style={{ fontSize: 16 }}>{l.source}</div></div>
          <div className="stat-card sc-green"><div className="lbl">Assigned To</div><div className="val" style={{ fontSize: 16 }}>{l.assign || 'Unassigned'}</div></div>
          <div className="stat-card sc-yellow"><div className="lbl">Requirement</div><div className="val" style={{ fontSize: 16 }}>{l.requirement}</div></div>
          <div className="stat-card sc-purple"><div className="lbl">Follow Up</div><div className="val" style={{ fontSize: 13 }}>{l.followup ? fmtDT(l.followup) : 'None'}</div></div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          <div className="tw" style={{ padding: 20 }}>
            <h3>Lead Details</h3>
            <div style={{ marginTop: 15, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {customFields.map(cf => (
                <div key={cf.name} style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>{cf.name}</span>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>{l.custom?.[cf.name] || '-'}</span>
                </div>
              ))}
              <div style={{ marginTop: 10 }}>
                <span style={{ fontSize: 12, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>Internal Notes</span>
                <div style={{ fontSize: 13, background: 'var(--bg)', padding: 12, borderRadius: 8, minHeight: 60, whiteSpace: 'pre-wrap' }}>{l.notes || 'No notes provided during creation.'}</div>
              </div>
            </div>
          </div>

          <div className="tw" style={{ padding: 20 }}>
            <h3>Activity Logs & Timeline</h3>
            <div style={{ marginTop: 15 }}>
              <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
                <input value={noteText} onChange={e => setNoteText(e.target.value)} placeholder="Type a note or record an activity..." style={{ flex: 1, padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13 }} />
                <button className="btn btn-primary btn-sm" onClick={addNote}>Post</button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxHeight: 400, overflowY: 'auto' }}>
                {lLogs.length === 0 ? <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 13, padding: 20 }}>No activity recorded yet in timeline.</div> : 
                  lLogs.map(log => (
                    <div key={log.id} style={{ display: 'flex', gap: 12, paddingBottom: 12, borderBottom: '1px solid var(--border)' }}>
                      <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)', marginTop: 6, flexShrink: 0 }} />
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                          <span style={{ fontSize: 12, fontWeight: 700 }}>{log.userName}</span>
                          <span style={{ fontSize: 10, color: 'var(--muted)' }}>{new Date(log.createdAt).toLocaleString()}</span>
                        </div>
                        <div style={{ fontSize: 12, color: '#444' }}>
                          {log.text?.split('\n').map((line, i) => (
                            <div key={i} style={{ marginBottom: line ? 2 : 0 }}>
                              {line.split('**').map((part, j) => 
                                j % 2 === 1 ? <mark key={j} style={{ background: '#fef08a', color: '#854d0e', padding: '0 4px', borderRadius: 4, fontWeight: 600 }}>{part}</mark> : part
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  ))
                }
              </div>
            </div>
          </div>
        </div>

        {/* Call History for this lead */}
        {(() => {
          const leadCalls = (drawerData?.callLogs || []).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
          return leadCalls.length > 0 && (
            <div className="tw" style={{ padding: 20, marginTop: 20 }}>
              <h3 style={{ marginBottom: 12 }}>📞 Call History ({leadCalls.length})</h3>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid var(--border)' }}>
                      <th style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 600 }}>Direction</th>
                      <th style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 600 }}>Outcome</th>
                      <th style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 600 }}>Duration</th>
                      <th style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 600 }}>Staff</th>
                      <th style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 600 }}>Date & Time</th>
                      <th style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 600 }}>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leadCalls.map(c => (
                      <tr key={c.id} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '8px 10px' }}>
                          <span style={{ color: c.direction === 'Incoming' ? '#16a34a' : c.direction === 'Missed' ? '#ef4444' : '#2563eb', fontWeight: 600, fontSize: 12 }}>{c.direction}</span>
                        </td>
                        <td style={{ padding: '8px 10px' }}>
                          <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: c.outcome === 'Connected' ? '#f0fdf4' : '#fef2f2', color: c.outcome === 'Connected' ? '#16a34a' : '#ef4444', fontWeight: 500 }}>{c.outcome}</span>
                        </td>
                        <td style={{ padding: '8px 10px', fontSize: 12 }}>{c.duration ? `${c.duration}s` : '-'}</td>
                        <td style={{ padding: '8px 10px', fontSize: 12 }}>{c.staffName || '-'}</td>
                        <td style={{ padding: '8px 10px', fontSize: 12 }}>{fmtDT(c.createdAt)}</td>
                        <td style={{ padding: '8px 10px', fontSize: 12, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.notes || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })()}

        {modal && (
          <div className="mo open">
            <div className="mo-box">
              <div className="mo-head">
                <h3>Edit Lead</h3>
                <button className="btn-icon" onClick={() => setModal(false)}>✕</button>
              </div>
              <div className="mo-body">
                <div className="fgrid">
                  <div className="fg"><label>Name *</label><input value={form.name} onChange={f('name')} placeholder="Lead name" /></div>
                  <div className="fg"><label>Company Name (Optional)</label><input value={form.companyName} onChange={f('companyName')} placeholder="Business name" /></div>
                  <div className="fg"><label>Phone</label><input value={form.phone} onChange={f('phone')} placeholder="+91..." /></div>
                  <div className="fg"><label>Email</label><input type="email" value={form.email} onChange={f('email')} /></div>
                  <div className="fg"><label>Source</label>
                    <select value={form.source} onChange={f('source')}>
                      {!form.source && <option value="">Select Source</option>}
                      {activeSources.map(s => <option key={s}>{s}</option>)}
                    </select>
                  </div>
                  <div className="fg"><label>Stage</label>
                    <select value={form.stage} onChange={f('stage')}>
                      {!form.stage && <option value="">Select Stage</option>}
                      {activeStages.map(s => <option key={s}>{s}</option>)}
                    </select>
                  </div>
                  <div className="fg"><label>Assign To</label>
                    <select value={form.assign} onChange={f('assign')}>
                      <option value="">Unassigned</option>
                      {team.map(t => <option key={t.id}>{t.name}</option>)}
                    </select>
                  </div>
                  <div className="fg"><label>Follow Up</label><input type="datetime-local" value={form.followup} onChange={f('followup')} /></div>
                  <div className="fg"><label>Requirement</label>
                    <select value={form.requirement} onChange={f('requirement')}>
                      {!form.requirement && <option value="">Select Requirement</option>}
                      {activeRequirements.map(l => <option key={l}>{l}</option>)}
                    </select>
                  </div>
                  <div className="fg"><label>Product Category</label>
                    <select value={form.productCat} onChange={f('productCat')}>
                      <option value="">None</option>
                      {productCats.map(c => <option key={c}>{c}</option>)}
                    </select>
                  </div>
                  <div className="fg span2"><label>Notes</label><textarea value={form.notes} onChange={f('notes')} /></div>

                  {showPartners && (
                  <>
                  <div className="fg" style={{ zIndex: 8 }}><label>Distributor (Optional)</label>
                    <SearchableSelect
                      options={[{ id: '', name: '-- None --' }, ...partners.filter(p => p.role === 'Distributor').map(p => ({ id: p.id, name: p.companyName || p.name }))]}
                      displayKey="name" returnKey="id" value={form.distributorId}
                      onChange={val => {
                        setForm(p => ({ ...p, distributorId: val, retailerId: '' }));
                        if (val) setForm(p => ({ ...p, distributorId: val, retailerId: '', source: partnerLeadSource }));
                        else setForm(p => ({ ...p, distributorId: val, retailerId: '' }));
                      }}
                      placeholder="Search distributor..."
                    />
                  </div>
                  <div className="fg" style={{ zIndex: 7 }}><label>Retailer (Optional)</label>
                    <SearchableSelect
                      options={[{ id: '', name: '-- None --' }, ...partners.filter(p => p.role === 'Retailer').map(p => ({ id: p.id, name: `${p.companyName || p.name}${p.parentDistributorId ? ` (${partners.find(d => d.id === p.parentDistributorId)?.companyName || partners.find(d => d.id === p.parentDistributorId)?.name || ''})` : ''}` }))]}
                      displayKey="name" returnKey="id" value={form.retailerId}
                      onChange={val => {
                        const retailer = partners.find(p => p.id === val);
                        setForm(p => ({ ...p, retailerId: val, distributorId: retailer?.parentDistributorId || p.distributorId, ...(val ? { source: partnerLeadSource } : {}) }));
                      }}
                      placeholder="Search retailer..."
                    />
                  </div>
                  </>
                  )}
                </div>
              </div>
              {editData && (
                <div style={{ padding: '16px 20px', borderTop: '1px solid var(--border)' }}>
                  <h3 style={{ fontSize: 14, marginBottom: 12 }}>Activity Logs & Timeline</h3>
                  <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
                    <input value={noteText} onChange={e => setNoteText(e.target.value)} placeholder="Type a note or record an activity..." style={{ flex: 1, padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13 }} />
                    <button className="btn btn-primary btn-sm" onClick={async () => { if (!noteText.trim()) return; await logActivity(editData.id, noteText.trim()); setNoteText(''); toast('Note added', 'success'); }}>Post</button>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxHeight: 300, overflowY: 'auto' }}>
                    {lLogs.length === 0 ? <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 13, padding: 20 }}>No activity recorded yet in timeline.</div> :
                      lLogs.map(log => (
                        <div key={log.id} style={{ display: 'flex', gap: 12, paddingBottom: 12, borderBottom: '1px solid var(--border)' }}>
                          <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)', marginTop: 6, flexShrink: 0 }} />
                          <div style={{ flex: 1 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                              <span style={{ fontSize: 12, fontWeight: 700 }}>{log.userName}</span>
                              <span style={{ fontSize: 10, color: 'var(--muted)' }}>{new Date(log.createdAt).toLocaleString()}</span>
                            </div>
                            <div style={{ fontSize: 12, color: '#444' }}>
                              {log.text?.split('\n').map((line, i) => (
                                <div key={i} style={{ marginBottom: line ? 2 : 0 }}>
                                  {line.split('**').map((part, j) =>
                                    j % 2 === 1 ? <mark key={j} style={{ background: '#fef08a', color: '#854d0e', padding: '0 4px', borderRadius: 4, fontWeight: 600 }}>{part}</mark> : part
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      ))
                    }
                  </div>
                </div>
              )}
              <div className="mo-foot">
                <button className="btn btn-secondary btn-sm" onClick={() => setModal(false)}>Cancel</button>
                <button className="btn btn-primary btn-sm" onClick={saveLead} disabled={saving}>
                  {saving ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ position: 'relative' }}>
      {/* Refetch overlay — only shown during subsequent fetches (filter/search/
          pagination/date change). Initial load is handled by the page-spinner
          guard above so users don't see two spinners stacked. */}
      {pageLoading && pageData && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'rgba(255, 255, 255, 0.6)',
            backdropFilter: 'blur(1px)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
            zIndex: 10,
            pointerEvents: 'all',
          }}
          aria-live="polite"
          aria-busy="true"
        >
          <div
            style={{
              width: 36,
              height: 36,
              border: '3px solid #e2e8f0',
              borderTopColor: 'var(--accent, #16a34a)',
              borderRadius: '50%',
              animation: 'tr-spin 0.7s linear infinite',
            }}
          />
          <div style={{ fontSize: 13, color: '#475569', fontWeight: 600 }}>Loading leads…</div>
        </div>
      )}
      <style>{`@keyframes tr-spin { to { transform: rotate(360deg); } }`}</style>
      {/* Header */}
      <div className="sh">
        <div><h2>Leads</h2><div className="sub">Manage and track all leads</div></div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className={`btn btn-sm ${view === 'list' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setView('list')}>☰ List</button>
          <button className={`btn btn-sm ${view === 'kanban' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setView('kanban')}>⊞ Kanban</button>
          {canCreate && (
            <>
              <button className="btn btn-secondary btn-sm" onClick={downloadLeadsTemplate}>⬇ Sample CSV</button>
              <button className="btn btn-secondary btn-sm" onClick={() => document.getElementById('bulk-import').click()}>⇪ Bulk Import</button>
              <input type="file" id="bulk-import" accept=".csv" style={{ display: 'none' }} onChange={handleBulkImport} />
            </>
          )}
          {canCreate && <button className="btn btn-primary btn-sm" onClick={openCreate}>+ Create Lead</button>}
          <button className="btn btn-secondary btn-sm" onClick={handleExportExcel}>📊 Export Excel</button>
        </div>
      </div>

      {/* Date Mode Toggle: Filter by Follow-up vs Created Date */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600 }}>Filter by:</span>
        <div style={{ display: 'inline-flex', background: 'var(--bg)', borderRadius: 6, padding: 2, border: '1px solid var(--border)' }}>
          {[['followup', 'Follow-up Date'], ['created', 'Created Date'], ['assigned', 'Assigned Date']].map(([mode, label]) => (
            <button
              key={mode}
              onClick={() => {
                setDateMode(mode);
                localStorage.setItem('tc_leads_date_mode', mode);
                setTab('all');
              }}
              style={{
                padding: '4px 12px',
                fontSize: 12,
                fontWeight: 600,
                border: 'none',
                borderRadius: 4,
                cursor: 'pointer',
                background: dateMode === mode ? 'var(--accent)' : 'transparent',
                color: dateMode === mode ? '#fff' : 'var(--muted)',
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="tabs">
        {(() => {
          // Always show counts. Before first server response fullCounts is null
          // (ref not yet populated) — show (0) as placeholder so tabs never
          // look like bare text. Once counts arrive they update instantly.
          const c = fullCounts;
          const suffix = (key) => ` (${c?.[key] ?? 0})`;
          if (dateMode === 'followup') {
            return [
              ['all', `All${suffix('total')}`],
              ['today', `Today${suffix('today')}`],
              ['tomorrow', `Tomorrow${suffix('tomorrow')}`],
              ['next7days', `Next 7 Days${suffix('next7days')}`],
              ['overdue', `Overdue${suffix('overdue')}`],
              ['custom', `Custom${(customFrom || customTo) ? suffix('custom') : ''}`],
            ];
          }
          // 'created' and 'assigned' share the same tab set
          return [
            ['all', `All${suffix('total')}`],
            ['today', `Today${suffix('today')}`],
            ['yesterday', `Yesterday${suffix('yesterday')}`],
            ['thisweek', `This Week${suffix('thisweek')}`],
            ['thismonth', `This Month${suffix('thismonth')}`],
            ['custom', `Custom${(customFrom || customTo) ? suffix('custom') : ''}`],
          ];
        })().map(([t, label]) => (
          <div key={t} className={`tab${tab === t ? ' active' : ''}`} onClick={() => setTab(t)}>{label}</div>
        ))}
      </div>

      {tab === 'custom' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8, marginBottom: 8, flexWrap: 'wrap', padding: '10px 12px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6 }}>
          <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600 }}>
            {dateMode === 'created' ? 'Created between:' : dateMode === 'assigned' ? 'Assigned between:' : 'Follow-up between:'}
          </span>
          <input
            type="date"
            value={customFrom}
            onChange={e => { setCustomFrom(e.target.value); localStorage.setItem('tc_leads_custom_from', e.target.value); }}
            style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid var(--border)', fontSize: 12 }}
          />
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>to</span>
          <input
            type="date"
            value={customTo}
            onChange={e => { setCustomTo(e.target.value); localStorage.setItem('tc_leads_custom_to', e.target.value); }}
            style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid var(--border)', fontSize: 12 }}
          />
          {(customFrom || customTo) && (
            <button
              onClick={() => { setCustomFrom(''); setCustomTo(''); localStorage.removeItem('tc_leads_custom_from'); localStorage.removeItem('tc_leads_custom_to'); }}
              style={{ padding: '4px 10px', fontSize: 12, fontWeight: 600, border: '1px solid var(--border)', borderRadius: 4, background: 'transparent', color: 'var(--muted)', cursor: 'pointer' }}
            >
              Clear
            </button>
          )}
          <span style={{ fontSize: 12, color: 'var(--muted)', marginLeft: 'auto' }}>
            {customFrom || customTo ? `${customCount} lead${customCount === 1 ? '' : 's'} match` : 'Pick a date range'}
          </span>
        </div>
      )}



      {view === 'list' ? (
        <div>
          {/* Bulk Bar */}
          {selectedIds.size > 0 && (
            <div className="bulk-bar" style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent)' }}>{selectedIds.size} selected</span>
              <select style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)', fontSize: 12 }} value={pendingBulkAssign} onChange={e => setPendingBulkAssign(e.target.value)}>
                <option value="">Assign To...</option>
                {team.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
              </select>
              <select style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border)', fontSize: 12 }} value={pendingBulkStage} onChange={e => setPendingBulkStage(e.target.value)}>
                <option value="">Change Stage...</option>
                {activeStages.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              {(pendingBulkAssign || pendingBulkStage) && <button className="btn btn-primary btn-sm" onClick={bulkApply}>Apply</button>}
              {canDelete && <button className="btn btn-sm" style={{ background: '#fee2e2', color: '#991b1b' }} onClick={bulkDelete}>🗑 Delete Selected</button>}
              <button className="btn btn-secondary btn-sm" onClick={() => { setSelectedIds(new Set()); setPendingBulkAssign(''); setPendingBulkStage(''); }}>✕ Clear</button>
            </div>
          )}

          <div className="tw">
            <div className="tw-head">
               <div style={{ flex: 1 }}></div>
               <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <div className="sw" style={{ width: 220 }}>
                    <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
                    <input className="si" placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} />
                  </div>
                  <select className="si" style={{ width: 130 }} value={srcFilter} onChange={e => setSrcFilter(e.target.value)}>
                    <option value="">All Sources</option>
                    {activeSources.map(s => <option key={s}>{s}</option>)}
                  </select>
                  <select className="si" style={{ width: 130 }} value={stgFilter} onChange={e => setStgFilter(e.target.value)}>
                    <option value="">All Stages</option>
                    {allEnabledStages.map(s => <option key={s}>{s}</option>)}
                  </select>
                  <select className="si" style={{ width: 150 }} value={reqFilter} onChange={e => setReqFilter(e.target.value)}>
                    <option value="">All Requirements</option>
                    {activeRequirements.map(r => <option key={r}>{r}</option>)}
                  </select>
                  <select className="si" style={{ width: 130 }} value={staffFilter} onChange={e => setStaffFilter(e.target.value)}>
                    {(perms?.isOwner || teamCanSeeAllLeads) ? (
                      <>
                        <option value="">All Staff</option>
                        <option value="my">My Leads</option>
                        <option value="unassigned">Unassigned</option>
                        {team.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
                      </>
                    ) : (
                      <>
                        <option value="">All</option>
                        <option value="my">My Leads</option>
                        {teamCanSeeUnassignedLeads && <option value="unassigned">Unassigned</option>}
                      </>
                    )}
                  </select>
                  <button className="btn btn-secondary btn-sm" onClick={() => {
                    setTempCols(activeCols);
                    setTempStages(savedLeadStages || allStages);
                    setTempPageSize(pageSize);
                    setTempSortOrder(sortOrder);
                    setColModal(true);
                  }}>⚙ Configure View</button>
               </div>
            </div>
            {/* Top Pagination & Show Dropdown */}
            <div style={{ padding: '8px 25px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border)', background: 'var(--bg-soft)', gap: 15 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                <span style={{ color: 'var(--muted)', fontWeight: 600 }}>Show</span>
                <select 
                  style={{ border: '1px solid var(--border)', background: 'var(--surface)', fontWeight: 700, outline: 'none', cursor: 'pointer', color: 'var(--accent)', padding: '2px 4px', borderRadius: 4, fontSize: 11 }}
                  value={pageSize}
                  onChange={e => setPageSize(e.target.value === 'all' ? 'all' : parseInt(e.target.value, 10))}
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

            <div className="tw-scroll" style={{ maxHeight: 'calc(100vh - 330px)', overflowY: 'auto' }}>
              <table style={{ minWidth: 800 }}>
                <thead>
                  <tr>
                    <th style={{ width: 36 }}><input type="checkbox" onChange={e => { if (e.target.checked) setSelectedIds(new Set(filtered.map(l => l.id))); else setSelectedIds(new Set()); }} /></th>
                    <th>#</th>
                    <th>Name</th>
                    {activeCols.includes('Created') && <th>Created</th>}
                    {activeCols.includes('Phone') && <th>Phone</th>}
                    {activeCols.includes('Source') && <th>Source</th>}
                    {activeCols.includes('Stage') && <th>Stage</th>}
                    {activeCols.includes('Assigned') && <th>Assigned</th>}
                    {activeCols.includes('Follow Up') && <th>Follow Up</th>}
                    {activeCols.includes('Requirement') && <th>Requirement</th>}
                    {activeCols.includes('Reminder') && <th>Reminder</th>}
                    {activeCols.includes('Distributor') && <th>Distributor</th>}
                    {activeCols.includes('Retailer') && <th>Retailer</th>}
                    {customFields.filter(cf => activeCols.includes(cf.name)).map(cf => <th key={cf.name}>{cf.name}</th>)}
                    <th style={{ textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
              <tbody>
                {paginated.length === 0 ? (
                  <tr><td colSpan={activeCols.length + 4} style={{ textAlign: 'center', padding: 28, color: 'var(--muted)' }}>No leads found</td></tr>
                ) : paginated.map((l, i) => (
                  <tr key={l.id}>
                    <td><input type="checkbox" checked={selectedIds.has(l.id)} onChange={e => { const s = new Set(selectedIds); e.target.checked ? s.add(l.id) : s.delete(l.id); setSelectedIds(s); }} style={{ width: 14, height: 14, accentColor: 'var(--accent)' }} /></td>
                    <td style={{ color: 'var(--muted)', fontSize: 11 }}>{(currentPage - 1) * (pageSize === 'all' ? 0 : pageSize) + i + 1}</td>
                    <td>
                      <strong style={{ cursor: canEdit ? 'pointer' : 'default', color: 'var(--accent2)', textDecoration: canEdit ? 'underline' : 'none' }} onClick={() => canEdit ? openEdit(l) : setViewLead(l)} title={canEdit ? 'Click to edit' : 'Click to view'}>{l.companyName || l.name}</strong>
                      {l.companyName && <div style={{ fontSize: 10, color: 'var(--muted)' }}>Contact: {l.name}</div>}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        {l.phone && (
                          <>
                            <button onClick={(e) => { e.stopPropagation(); logCall(l); }} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 24, height: 24, borderRadius: '50%', background: '#eff6ff', color: '#2563eb', border: 'none', cursor: 'pointer', padding: 0 }} title="Call & Log">
                              <svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>
                            </button>
                            <a href={`https://wa.me/${l.phone.replace(/\D/g, '')}`} target="_blank" rel="noreferrer" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 24, height: 24, borderRadius: '50%', background: '#e8fdf0', color: '#16a34a', textDecoration: 'none' }} title="WhatsApp">
                              <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.888-.788-1.489-1.761-1.663-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 0 0-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/></svg>
                            </a>
                            <a href={`sms:${l.phone}`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 24, height: 24, borderRadius: '50%', background: '#f5f3ff', color: '#7c3aed', textDecoration: 'none' }} title="SMS">
                              <svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
                            </a>
                          </>
                        )}
                        {l.email && (
                          <a href={`mailto:${l.email}`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 24, height: 24, borderRadius: '50%', background: '#f3f4f6', color: '#4b5563', textDecoration: 'none' }} title="Email">
                            <svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg>
                          </a>
                        )}
                      </div>
                    </td>
                    {activeCols.includes('Created') && <td style={{ fontSize: 11 }}>{l.createdAt ? fmtD(l.createdAt) : '-'}</td>}
                    {activeCols.includes('Phone') && <td style={{ fontSize: 12 }}>{l.phone || '-'}</td>}
                    {activeCols.includes('Source') && <td><span style={{ fontSize: 11 }}>{l.source}</span></td>}
                    {activeCols.includes('Stage') && <td><span className={`badge ${stageBadgeClass(l.stage, wonStage)}`}>{l.stage}</span></td>}
                    {activeCols.includes('Assigned') && <td style={{ fontSize: 12 }}>{l.assign || <span style={{ color: 'var(--muted)' }}>-</span>}</td>}
                    {activeCols.includes('Follow Up') && <td style={{ fontSize: 11 }}>{l.followup ? fmtDT(l.followup) : '-'}</td>}
                    {activeCols.includes('Requirement') && <td><span className="badge bg-gray" style={{ fontSize: 10 }}>{l.requirement || '-'}</span></td>}
                    {activeCols.includes('Reminder') && <td>
                      <div style={{ display: 'flex', gap: 3 }}>
                        {l.remWA && <span style={{ fontSize: 10, background: '#e8fdf0', color: '#25d366', borderRadius: 20, padding: '2px 6px', fontWeight: 700 }}>WA</span>}
                        {l.remEmail !== false && <span style={{ fontSize: 10, background: '#eff6ff', color: '#2563eb', borderRadius: 20, padding: '2px 6px', fontWeight: 700 }}>Mail</span>}
                        {l.remSMS && <span style={{ fontSize: 10, background: '#f5f3ff', color: '#7c3aed', borderRadius: 20, padding: '2px 6px', fontWeight: 700 }}>SMS</span>}
                      </div>
                    </td>}
                    {activeCols.includes('Distributor') && <td style={{ fontSize: 12 }}>{l.distributorId ? (partners.find(p => p.id === l.distributorId)?.companyName || partners.find(p => p.id === l.distributorId)?.name || '-') : '-'}</td>}
                    {activeCols.includes('Retailer') && <td style={{ fontSize: 12 }}>{l.retailerId ? (partners.find(p => p.id === l.retailerId)?.companyName || partners.find(p => p.id === l.retailerId)?.name || '-') : '-'}</td>}
                    {customFields.filter(cf => activeCols.includes(cf.name)).map(cf => (
                      <td key={cf.name} style={{ fontSize: 11 }}>{l.custom?.[cf.name] || '-'}</td>
                    ))}
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }}>
                        <button className="btn btn-secondary btn-sm" onClick={() => setViewLead(l)}>View</button>
                        <button className="btn-icon" onClick={(e) => {
                          const dm = e.currentTarget.nextElementSibling;
                          document.querySelectorAll('.dd-menu').forEach(el => el !== dm && (el.style.display = 'none'));
                          dm.style.display = dm.style.display === 'block' ? 'none' : 'block';
                        }}>⋮</button>
                        <div className="dd-menu" style={{ display: 'none', position: 'absolute', right: 0, top: 28, background: '#fff', border: '1px solid var(--border)', borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,0.1)', zIndex: 100, width: 160, overflow: 'hidden', textAlign: 'left' }}>
                          {canEdit && <div style={{ padding: '8px 12px', fontSize: 12, cursor: 'pointer', borderBottom: '1px solid var(--border)' }} onClick={() => { openEdit(l); document.querySelectorAll('.dd-menu').forEach(el => el.style.display = 'none'); }}>✎ Edit</div>}
                          {canEdit && <div style={{ padding: '8px 12px', fontSize: 12, cursor: 'pointer', borderBottom: '1px solid var(--border)' }} onClick={() => { convertToCustomer(l); document.querySelectorAll('.dd-menu').forEach(el => el.style.display = 'none'); }}>👤 Convert to Customer</div>}
                          {canDelete && <div style={{ padding: '8px 12px', fontSize: 12, cursor: 'pointer', color: '#dc2626' }} onClick={() => { deleteLead(l.id); document.querySelectorAll('.dd-menu').forEach(el => el.style.display = 'none'); }}>🗑 Delete</div>}
                        </div>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>

            {pageSize !== 'all' && totalPages > 1 && (
              <div style={{ padding: '15px 25px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--border)', background: 'var(--bg-soft)', flexWrap: 'wrap', gap: 15 }}>
                <div style={{ fontSize: 13, color: 'var(--muted)' }}>
                  Showing <strong>{(currentPage - 1) * pageSize + 1}</strong> to <strong>{Math.min(currentPage * pageSize, totalFiltered)}</strong> of <strong>{totalFiltered}</strong> leads
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
                  <button 
                    className="btn btn-secondary btn-sm" 
                    disabled={currentPage === 1}
                    onClick={() => setCurrentPage(prev => prev - 1)}
                    style={{ padding: '4px 10px' }}
                  >
                    Prev
                  </button>
                  {[...Array(totalPages)].map((_, i) => {
                    const page = i + 1;
                    const isNear = Math.abs(currentPage - page) <= 2;
                    const isEdge = page === 1 || page === totalPages;
                    if (!isNear && !isEdge) return null;
                    
                    return (
                      <React.Fragment key={page}>
                        {isEdge && page === totalPages && Math.abs(currentPage - page) > 3 && <span style={{ color: 'var(--muted)', alignSelf: 'center' }}>...</span>}
                        <button 
                          className={`btn btn-sm ${currentPage === page ? 'btn-primary' : 'btn-secondary'}`}
                          style={{ minWidth: 32, padding: 0 }}
                          onClick={() => setCurrentPage(page)}
                        >
                          {page}
                        </button>
                        {isEdge && page === 1 && Math.abs(currentPage - page) > 3 && <span style={{ color: 'var(--muted)', alignSelf: 'center' }}>...</span>}
                      </React.Fragment>
                    );
                  })}
                  <button 
                    className="btn btn-secondary btn-sm" 
                    disabled={currentPage === totalPages}
                    onClick={() => setCurrentPage(prev => prev + 1)}
                    style={{ padding: '4px 10px' }}
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        /* KANBAN */
        <div className="kanban-wrapper" style={{ height: 'calc(100vh - 220px)' }}>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginBottom: 15, flexWrap: 'wrap', alignItems: 'center' }}>
              <div className="sw" style={{ width: 200 }}>
                <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></svg>
                <input className="si" placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} />
              </div>
              <select className="si" style={{ width: 120, padding: '4px 8px' }} value={srcFilter} onChange={e => setSrcFilter(e.target.value)}>
                <option value="">All Sources</option>
                {activeSources.map(s => <option key={s}>{s}</option>)}
              </select>
              <select className="si" style={{ width: 120, padding: '4px 8px' }} value={stgFilter} onChange={e => setStgFilter(e.target.value)}>
                <option value="">All Stages</option>
                {allEnabledStages.map(s => <option key={s}>{s}</option>)}
              </select>
              <select className="si" style={{ width: 145, padding: '4px 8px' }} value={reqFilter} onChange={e => setReqFilter(e.target.value)}>
                <option value="">All Requirements</option>
                {activeRequirements.map(r => <option key={r}>{r}</option>)}
              </select>
              <select className="si" style={{ width: 120, padding: '4px 8px' }} value={staffFilter} onChange={e => setStaffFilter(e.target.value)}>
                {(perms?.isOwner || teamCanSeeAllLeads) ? (
                  <>
                    <option value="">All Staff</option>
                    <option value="my">My Leads</option>
                    <option value="unassigned">Unassigned</option>
                    {team.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
                  </>
                ) : (
                  <>
                    <option value="">All</option>
                    <option value="my">My Leads</option>
                    {teamCanSeeUnassignedLeads && <option value="unassigned">Unassigned</option>}
                  </>
                )}
              </select>
          </div>
          <div className="kanban">
          {activeStages.map(stage => {
            const cards = filtered.filter(l => l.stage === stage);
            const isOver = dragOverStage === stage;
            return (
              <div
                key={stage}
                className="kb-col"
                style={{ background: isOver ? 'rgba(99,102,241,0.06)' : undefined, outline: isOver ? '2px dashed var(--accent)' : undefined, borderRadius: 8, transition: 'background 0.15s' }}
                onDragOver={e => { e.preventDefault(); setDragOverStage(stage); }}
                onDragLeave={() => setDragOverStage(null)}
                onDrop={async e => {
                  e.preventDefault();
                  setDragOverStage(null);
                  const lid = dragLeadId.current;
                  if (!lid) return;
                  const lead = leads.find(l => l.id === lid);
                  if (!lead || lead.stage === stage) return;
                  await dbWrite(dbOp.update('leads', lid, { stage, stageChangedAt: Date.now() }));
                  await logActivity(lid, `Stage changed from "${lead.stage}" to "${stage}" (drag & drop)`, { action: 'edited' });
                  await dbWrite(dbOp.update('activityLogs', id(), {
                    entityId: lid, entityType: 'lead',
                    entityName: lead.companyName || lead.name || '',
                    action: 'stage-change', fromStage: lead.stage, toStage: stage,
                    text: `Stage: ${lead.stage} → ${stage} (drag)`,
                    userId: ownerId, actorId: user.id, userName: user.email,
                    teamMemberId: myTeamMember?.id || null, createdAt: Date.now()
                  }));
                  if (isWon(stage)) {
                    await convertToCustomer(lead, true);
                  }
                  toast(`Moved to ${stage}`, 'success');
                }}
              >
                <div className="kb-col-head">{stage} <span>{cards.length}</span></div>
                <div className="kb-col-cards">
                {cards.map(l => (
                  <div
                    key={l.id}
                    className="kb-card"
                    draggable
                    onDragStart={e => { dragLeadId.current = l.id; e.dataTransfer.effectAllowed = 'move'; }}
                    onDragEnd={() => { dragLeadId.current = null; setDragOverStage(null); }}
                    style={{ cursor: 'grab' }}
                  >
                    <div className="nm" onClick={() => openEdit(l)} style={{ cursor: 'pointer' }}>{l.companyName || l.name}</div>
                    {l.companyName && <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 4 }}>Contact: {l.name}</div>}
                    <div className="mt" style={{ marginBottom: 4 }}>{l.source} · {l.phone || '-'}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      {l.phone && (
                        <>
                          <button onClick={(e) => { e.stopPropagation(); logCall(l); }} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 24, height: 24, borderRadius: '50%', background: '#eff6ff', color: '#2563eb', border: 'none', cursor: 'pointer', padding: 0 }} title="Call & Log">
                            <svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>
                          </button>
                          <a href={`https://wa.me/${l.phone.replace(/\D/g, '')}`} target="_blank" rel="noreferrer" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 24, height: 24, borderRadius: '50%', background: '#e8fdf0', color: '#16a34a', textDecoration: 'none' }} title="WhatsApp">
                            <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.888-.788-1.489-1.761-1.663-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 0 0-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/></svg>
                          </a>
                          <a href={`sms:${l.phone}`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 24, height: 24, borderRadius: '50%', background: '#f5f3ff', color: '#7c3aed', textDecoration: 'none' }} title="SMS">
                            <svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
                          </a>
                        </>
                      )}
                      {l.email && (
                        <a href={`mailto:${l.email}`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 24, height: 24, borderRadius: '50%', background: '#f3f4f6', color: '#4b5563', textDecoration: 'none' }} title="Email">
                          <svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg>
                        </a>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 4, marginTop: 7, flexWrap: 'wrap' }}>
                      {canEdit && <button className="btn btn-secondary btn-sm" style={{ fontSize: 10, padding: '2px 6px' }} onClick={() => openEdit(l)}>Edit</button>}
                      {canEdit && <button className="btn btn-secondary btn-sm" style={{ fontSize: 10, padding: '2px 6px' }} onClick={() => convertToCustomer(l)}>→ Customer</button>}
                      {canDelete && <button className="btn btn-sm" style={{ fontSize: 10, padding: '2px 6px', background: '#fee2e2', color: '#991b1b' }} onClick={() => deleteLead(l.id)}>Del</button>}
                    </div>
                  </div>
                ))}
                </div>
              </div>
            );
          })}
          </div>
        </div>
      )}

      {/* MODAL */}
      {modal && (
        <div className="mo open">
          <div className="mo-box wide">
            <div className="mo-head">
              <h3>{editData ? 'Edit Lead' : 'Create Lead'}</h3>
              <button className="btn-icon" onClick={() => setModal(false)}>✕</button>
            </div>
            <div className="mo-body">
              <div className="fgrid">
                <div className="fg"><label>Name *</label><input value={form.name} onChange={f('name')} placeholder="Lead name" /></div>
                <div className="fg"><label>Company Name (Optional)</label><input value={form.companyName} onChange={f('companyName')} placeholder="Business name" /></div>
                <div className="fg"><label>Phone</label><input value={form.phone} onChange={f('phone')} placeholder="+91..." /></div>
                <div className="fg"><label>Email</label><input type="email" value={form.email} onChange={f('email')} /></div>
                <div className="fg"><label>Source</label>
                  <select value={form.source} onChange={f('source')}>
                    {!form.source && <option value="">Select Source</option>}
                    {activeSources.map(s => <option key={s}>{s}</option>)}
                  </select>
                </div>
                <div className="fg"><label>Stage</label>
                  <select value={form.stage} onChange={f('stage')}>
                    {!form.stage && <option value="">Select Stage</option>}
                    {allEnabledStages.map(s => <option key={s}>{s}</option>)}
                  </select>
                </div>
                <div className="fg"><label>Assign To</label>
                  <select value={form.assign} onChange={f('assign')}>
                    <option value="">Unassigned</option>
                    {team.map(t => <option key={t.id}>{t.name}</option>)}
                  </select>
                </div>
                <div className="fg"><label>Follow Up</label><input type="datetime-local" value={form.followup} onChange={f('followup')} /></div>
                <div className="fg"><label>Requirement</label>
                  <select value={form.requirement} onChange={f('requirement')}>
                    {!form.requirement && <option value="">Select Requirement</option>}
                    {activeRequirements.map(l => <option key={l}>{l}</option>)}
                  </select>
                </div>
                <div className="fg span2"><label>Notes</label><textarea value={form.notes} onChange={f('notes')} /></div>
                
                {/* Dynamic Custom Fields */}
                {customFields.length > 0 && <div className="fg span2" style={{ borderTop: '1px solid var(--border)', paddingTop: 16, marginTop: 4 }}><h4 style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 12 }}>Custom Fields</h4><div className="fgrid">
                  {customFields.map(field => (
                    <div key={field.name} className="fg">
                      <label>{field.name}</label>
                      {field.type === 'dropdown' ? (
                        <select value={form.custom[field.name] || ''} onChange={cf(field.name)}>
                          <option value="">Select...</option>
                          {field.options.split(',').map(o => <option key={o.trim()}>{o.trim()}</option>)}
                        </select>
                      ) : (
                        <input type={field.type === 'number' ? 'number' : 'text'} value={form.custom[field.name] || ''} onChange={cf(field.name)} />
                      )}
                    </div>
                  ))}
                </div></div>}

                <div className="fg span2">
                  <label>Reminder Channels</label>
                  <div style={{ display: 'flex', gap: 16, alignItems: 'center', marginTop: 6, padding: 12, background: 'var(--bg)', borderRadius: 8, flexWrap: 'wrap' }}>
                    {[['remWA', 'WhatsApp', '#25d366'], ['remEmail', 'Email', '#3b82f6'], ['remSMS', 'SMS', '#8b5cf6']].map(([k, label, color]) => (
                      <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>
                        <input type="checkbox" checked={form[k]} onChange={f(k)} style={{ width: 15, height: 15, accentColor: color }} />
                        <span style={{ color }}>{label}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {showPartners && (
                <>
                <div className="fg" style={{ zIndex: 8 }}><label>Distributor (Optional)</label>
                  <SearchableSelect
                    options={[{ id: '', name: '-- None --' }, ...partners.filter(p => p.role === 'Distributor').map(p => ({ id: p.id, name: p.companyName || p.name }))]}
                    displayKey="name" returnKey="id" value={form.distributorId}
                    onChange={val => {
                      if (val) setForm(p => ({ ...p, distributorId: val, retailerId: '', source: partnerLeadSource }));
                      else setForm(p => ({ ...p, distributorId: val, retailerId: '' }));
                    }}
                    placeholder="Search distributor..."
                  />
                </div>
                <div className="fg" style={{ zIndex: 7 }}><label>Retailer (Optional)</label>
                  <SearchableSelect
                    options={[{ id: '', name: '-- None --' }, ...partners.filter(p => p.role === 'Retailer').map(p => ({ id: p.id, name: `${p.companyName || p.name}${p.parentDistributorId ? ` (${partners.find(d => d.id === p.parentDistributorId)?.companyName || partners.find(d => d.id === p.parentDistributorId)?.name || ''})` : ''}` }))]}
                    displayKey="name" returnKey="id" value={form.retailerId}
                    onChange={val => {
                      const retailer = partners.find(p => p.id === val);
                      setForm(p => ({ ...p, retailerId: val, distributorId: retailer?.parentDistributorId || p.distributorId, ...(val ? { source: partnerLeadSource } : {}) }));
                    }}
                    placeholder="Search retailer..."
                  />
                </div>
                </>
                )}
              </div>
            </div>
            {editData && (() => {
              const eLogs = (drawerData?.activityLogs || []).slice().sort((a,b) => b.createdAt - a.createdAt);
              const addEditNote = async () => {
                if (!noteText.trim()) return;
                await logActivity(editData.id, noteText.trim());
                setNoteText('');
                toast('Note added', 'success');
              };
              return (
                <div style={{ padding: '16px 20px', borderTop: '1px solid var(--border)' }}>
                  <h3 style={{ fontSize: 14, marginBottom: 12 }}>Activity Logs & Timeline</h3>
                  <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
                    <input value={noteText} onChange={e => setNoteText(e.target.value)} placeholder="Type a note or record an activity..." style={{ flex: 1, padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13 }} />
                    <button className="btn btn-primary btn-sm" onClick={addEditNote}>Post</button>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxHeight: 300, overflowY: 'auto' }}>
                    {eLogs.length === 0 ? <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 13, padding: 20 }}>No activity recorded yet in timeline.</div> :
                      eLogs.map(log => (
                        <div key={log.id} style={{ display: 'flex', gap: 12, paddingBottom: 12, borderBottom: '1px solid var(--border)' }}>
                          <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)', marginTop: 6, flexShrink: 0 }} />
                          <div style={{ flex: 1 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                              <span style={{ fontSize: 12, fontWeight: 700 }}>{log.userName}</span>
                              <span style={{ fontSize: 10, color: 'var(--muted)' }}>{new Date(log.createdAt).toLocaleString()}</span>
                            </div>
                            <div style={{ fontSize: 12, color: '#444' }}>
                              {log.text?.split('\n').map((line, i) => (
                                <div key={i} style={{ marginBottom: line ? 2 : 0 }}>
                                  {line.split('**').map((part, j) =>
                                    j % 2 === 1 ? <mark key={j} style={{ background: '#fef08a', color: '#854d0e', padding: '0 4px', borderRadius: 4, fontWeight: 600 }}>{part}</mark> : part
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      ))
                    }
                  </div>
                </div>
              );
            })()}
            <div className="mo-foot">
              <button className="btn btn-secondary btn-sm" onClick={() => setModal(false)}>Cancel</button>
              <button className="btn btn-primary btn-sm" onClick={saveLead} disabled={saving}>
                {saving ? 'Saving...' : 'Save Lead'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* BULK IMPORT MAPPING MODAL */}
      {importMappingModal && (
        <div className="mo open">
          <div className="mo-box" style={{ width: 680, position: 'relative' }}>
            {/* In-app review summary — replaces the noisy native confirm popup */}
            {importSummary && !importing && (
              <div style={{
                position: 'absolute', inset: 0, zIndex: 6, background: '#fff',
                display: 'flex', flexDirection: 'column', borderRadius: 12, padding: 24,
              }}>
                <h3 style={{ margin: '0 0 4px' }}>Review before import</h3>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16 }}>Some rows can't be imported. Review and continue with the rest.</div>

                <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
                  <div style={{ flex: 1, background: '#ecfdf5', border: '1px solid #a7f3d0', borderRadius: 8, padding: '12px 14px' }}>
                    <div style={{ fontSize: 22, fontWeight: 800, color: '#065f46' }}>{importSummary.toAdd.length.toLocaleString()}</div>
                    <div style={{ fontSize: 11, color: '#047857', fontWeight: 600 }}>Will be imported</div>
                  </div>
                  <div style={{ flex: 1, background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '12px 14px' }}>
                    <div style={{ fontSize: 22, fontWeight: 800, color: '#92400e' }}>{importSummary.duplicates.length.toLocaleString()}</div>
                    <div style={{ fontSize: 11, color: '#b45309', fontWeight: 600 }}>Duplicates (skipped)</div>
                  </div>
                  <div style={{ flex: 1, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '12px 14px' }}>
                    <div style={{ fontSize: 22, fontWeight: 800, color: '#991b1b' }}>{importSummary.invalidFields.length.toLocaleString()}</div>
                    <div style={{ fontSize: 11, color: '#b91c1c', fontWeight: 600 }}>Invalid (skipped)</div>
                  </div>
                </div>

                <div style={{ flex: 1, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px', fontSize: 11, color: 'var(--muted)', minHeight: 0 }}>
                  {importSummary.invalidFields.slice(0, 5).map((s, i) => <div key={`inv${i}`} style={{ marginBottom: 4 }}>⚠️ {s}</div>)}
                  {importSummary.duplicates.slice(0, 5).map((s, i) => <div key={`dup${i}`} style={{ marginBottom: 4 }}>♻️ {s}</div>)}
                  {(importSummary.invalidFields.length + importSummary.duplicates.length) > 10 && (
                    <div style={{ fontStyle: 'italic', marginTop: 4 }}>…and {(importSummary.invalidFields.length + importSummary.duplicates.length - 10).toLocaleString()} more</div>
                  )}
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
                  <button className="btn btn-secondary btn-sm" onClick={() => { setImportSummary(null); setImportMappingModal(false); }}>Cancel import</button>
                  <button
                    className="btn btn-primary btn-sm"
                    disabled={importSummary.toAdd.length === 0}
                    onClick={() => commitImport(importSummary.toAdd, importSummary.duplicates.length)}
                  >
                    {importSummary.toAdd.length > 0 ? `Skip & import ${importSummary.toAdd.length.toLocaleString()} leads` : 'Nothing to import'}
                  </button>
                </div>
              </div>
            )}
            {/* Live progress overlay — covers the mapping UI while the import runs */}
            {importing && (
              <div style={{
                position: 'absolute', inset: 0, zIndex: 5, background: 'rgba(255,255,255,0.97)',
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                borderRadius: 12, padding: 30, textAlign: 'center',
              }}>
                <div style={{
                  width: 48, height: 48, border: '4px solid var(--bg-soft)', borderTopColor: 'var(--accent)',
                  borderRadius: '50%', animation: 'spin 0.8s linear infinite', marginBottom: 18,
                }} />
                <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
                <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>
                  {importProgress.phase === 'validating' && 'Validating rows…'}
                  {importProgress.phase === 'checking' && 'Checking for duplicates…'}
                  {importProgress.phase === 'importing' && `Importing ${importProgress.current.toLocaleString()} of ${importProgress.total.toLocaleString()} leads…`}
                  {importProgress.phase === 'done' && '✓ Import complete'}
                </div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16 }}>
                  {importProgress.phase === 'validating' && `Checking ${importProgress.total.toLocaleString()} rows against your business settings`}
                  {importProgress.phase === 'checking' && `Scanning the database for ${importProgress.total.toLocaleString()} possible duplicates`}
                  {importProgress.phase === 'importing' && 'Please keep this window open until it finishes'}
                  {importProgress.phase === 'done' && `${importProgress.current.toLocaleString()} leads added`}
                </div>
                {/* Progress bar — determinate during the importing phase */}
                <div style={{ width: '70%', maxWidth: 360, height: 8, background: 'var(--bg-soft)', borderRadius: 99, overflow: 'hidden' }}>
                  <div style={{
                    height: '100%', borderRadius: 99, background: 'var(--accent)', transition: 'width 0.3s ease',
                    width: importProgress.phase === 'importing' && importProgress.total > 0
                      ? `${Math.round((importProgress.current / importProgress.total) * 100)}%`
                      : (importProgress.phase === 'done' ? '100%' : '40%'),
                  }} />
                </div>
              </div>
            )}
            <div className="mo-head">
              <h3>Bulk Import Column Mapping</h3>
              <button className="btn-icon" onClick={() => setImportMappingModal(false)} disabled={importing}>✕</button>
            </div>
            <div className="mo-body" style={{ maxHeight: '70vh', overflowY: 'auto', padding: '0 25px' }}>
              <div style={{ padding: '15px 0', borderBottom: '1px solid var(--border)', display: 'flex', gap: 15, alignItems: 'center' }}>
                <div style={{ background: '#ecfdf5', color: '#065f46', padding: '8px 12px', borderRadius: 8, fontSize: 12, flex: 1 }}>
                  <strong>{importData.length} leads detected.</strong> Select which CSV column matches each CRM field below.
                </div>
              </div>

              {[
                { label: 'Name', icon: '👤', field: 'name' },
                { label: 'Company Name', icon: '🏢', field: 'companyName' },
                { label: 'Email', icon: '📧', field: 'email' },
                { label: 'Phone', icon: '📱', field: 'phone' },
                { label: 'Source', icon: '🔗', field: 'source', options: activeSources },
                { label: 'Stage', icon: '📋', field: 'stage', options: allStages },
                { label: 'Requirement', icon: '🏷️', field: 'requirement', options: activeRequirements },
                { label: 'Assigned To', icon: '👤', field: 'assign', options: team.map(t => t.name) },
                { label: 'Notes', icon: '📝', field: 'notes' },
                { label: 'Follow-up Date', icon: '📅', field: 'followup', type: 'datetime-local' }
              ].map(row => {
                const m = importMapping[row.field] || { type: 'column', value: '' };
                const setM = (val) => setImportMapping({ ...importMapping, [row.field]: { ...m, ...val } });
                
                return (
                  <div key={row.field} style={{ display: 'flex', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid var(--bg-soft)', gap: 20 }}>
                    <div style={{ width: 140, display: 'flex', gap: 10, alignItems: 'center' }}>
                      <span style={{ fontSize: 16 }}>{row.icon}</span>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 12 }}>{row.label}</div>
                        <div style={{ fontSize: 10, color: 'var(--muted)' }}>{row.field === 'name' ? 'Required' : 'Optional'}</div>
                      </div>
                    </div>
                    
                    <div style={{ display: 'flex', background: 'var(--bg-soft)', borderRadius: 6, padding: 2 }}>
                       <button className={`btn-toggle ${m.type === 'column' ? 'active' : ''}`} onClick={() => setM({ type: 'column' })}>Column</button>
                       <button className={`btn-toggle ${m.type === 'fixed' ? 'active' : ''}`} onClick={() => setM({ type: 'fixed' })}>Fixed</button>
                    </div>

                    {m.type === 'column' ? (
                      <select style={{ flex: 1, padding: '6px 10px', fontSize: 12, borderRadius: 6, border: '1px solid var(--border)' }} value={m.value} onChange={e => setM({ value: e.target.value })}>
                        <option value="">(Select Column)</option>
                        {importHeaders.map((h, idx) => (
                           <option key={idx} value={h}>[Col. {getExcelCol(idx)}] {h} {importSample?.[idx] ? `(e.g. ${importSample[idx]})` : ''}</option>
                        ))}
                      </select>
                    ) : (
                      row.options ? (
                        <select style={{ flex: 1, padding: '6px 10px', fontSize: 12, borderRadius: 6, border: '1px solid var(--border)' }} value={m.value} onChange={e => setM({ value: e.target.value })}>
                          <option value="">(None)</option>
                          {row.options.map(o => <option key={o} value={o}>{o}</option>)}
                        </select>
                      ) : (
                        <input type={row.type || 'text'} style={{ flex: 1, padding: '6px 10px', fontSize: 12, borderRadius: 6, border: '1px solid var(--border)' }} value={m.value} onChange={e => setM({ value: e.target.value })} placeholder="Fixed value..." />
                      )
                    )}
                  </div>
                );
              })}

              {/* Custom Fields Mapping */}
              {customFields.map(cf => {
                const m = importMapping[cf.name] || { type: 'column', value: '' };
                const setM = (val) => setImportMapping({ ...importMapping, [cf.name]: { ...m, ...val } });
                
                return (
                  <div key={cf.name} style={{ display: 'flex', alignItems: 'center', padding: '12px 0', borderBottom: '1px solid var(--bg-soft)', gap: 20 }}>
                     <div style={{ width: 140, fontWeight: 600, fontSize: 12 }}>{cf.name}</div>
                     <div style={{ display: 'flex', background: 'var(--bg-soft)', borderRadius: 6, padding: 2 }}>
                        <button className={`btn-toggle ${m.type === 'column' ? 'active' : ''}`} onClick={() => setM({ type: 'column' })}>Column</button>
                        <button className={`btn-toggle ${m.type === 'fixed' ? 'active' : ''}`} onClick={() => setM({ type: 'fixed' })}>Fixed</button>
                     </div>
                     {m.type === 'column' ? (
                       <select style={{ flex: 1, padding: '6px 10px', fontSize: 12, borderRadius: 6, border: '1px solid var(--border)' }} value={m.value} onChange={e => setM({ value: e.target.value })}>
                         <option value="">(Select Column)</option>
                         {importHeaders.map((h, idx) => (
                            <option key={idx} value={h}>[Col. {getExcelCol(idx)}] {h} {importSample?.[idx] ? `(e.g. ${importSample[idx]})` : ''}</option>
                         ))}
                       </select>
                     ) : (
                       <input type="text" style={{ flex: 1, padding: '6px 10px', fontSize: 12, borderRadius: 6, border: '1px solid var(--border)' }} value={m.value} onChange={e => setM({ value: e.target.value })} placeholder="Fixed value..." />
                     )}
                  </div>
                );
              })}
            </div>
            <div className="mo-foot">
              <button className="btn btn-secondary btn-sm" onClick={() => setImportMappingModal(false)} disabled={importing}>Cancel</button>
              <button className="btn btn-primary btn-sm" onClick={performImport} disabled={importing} style={importing ? { opacity: 0.7, cursor: 'wait' } : undefined}>
                {importing ? '⏳ Checking & importing…' : 'Complete Import'}
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .btn-toggle { border: none; background: transparent; padding: 4px 10px; font-size: 10px; font-weight: 700; cursor: pointer; border-radius: 4px; color: var(--muted); }
        .btn-toggle.active { background: #fff; color: var(--accent); box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
      `}</style>
      {colModal && (
        <div className="mo open">
          <div className="mo-box" style={{ width: 480 }}>
            <div className="mo-head">
              <h3>Configure View</h3>
              <button className="btn-icon" onClick={() => setColModal(false)}>✕</button>
            </div>
            <div className="mo-body" style={{ display: 'flex', flexDirection: 'column', gap: 20, maxHeight: '60vh', overflowY: 'auto' }}>

              {/* Visible Stages */}
              <div>
                <strong style={{ fontSize: 13, color: 'var(--text)', marginBottom: 12, display: 'block' }}>Visible Stages</strong>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  {allStages.map(s => (
                    <label key={s} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
                      <input type="checkbox" checked={tempStages.includes(s)} onChange={e => {
                        if (e.target.checked) setTempStages([...tempStages, s]);
                        else setTempStages(tempStages.filter(x => x !== s));
                      }} style={{ width: 16, height: 16, accentColor: 'var(--accent)' }} />
                      {s}
                    </label>
                  ))}
                </div>
              </div>

              {/* Visible Columns */}
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
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
                <strong style={{ fontSize: 13, color: 'var(--text)', marginBottom: 12, display: 'block' }}>Default Leads per Page</strong>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {[15, 25, 50, 100].map(size => (
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

              {/* Sort Order */}
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
                <strong style={{ fontSize: 13, color: 'var(--text)', marginBottom: 6, display: 'block' }}>Sort by date</strong>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 12 }}>
                  Sorts by the active date tab ({dateMode === 'created' ? 'Created Date' : dateMode === 'assigned' ? 'Assigned Date' : 'Follow-up Date'}).
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {[['newest', 'Newest first'], ['oldest', 'Oldest first']].map(([val, label]) => (
                    <button
                      key={val}
                      className={`btn btn-sm ${tempSortOrder === val ? 'btn-primary' : 'btn-secondary'}`}
                      onClick={() => setTempSortOrder(val)}
                      style={{ padding: '6px 12px' }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

            </div>
            <div className="mo-foot" style={{ justifyContent: 'space-between' }}>
              <button className="btn btn-secondary btn-sm" onClick={resetViewConfig}>Reset to Default</button>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-secondary btn-sm" onClick={() => setColModal(false)}>Cancel</button>
                <button className="btn btn-primary btn-sm" onClick={() => saveViewConfig(tempCols, tempStages, tempPageSize, tempSortOrder)}>Save View</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
