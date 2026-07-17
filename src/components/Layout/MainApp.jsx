import React, { useState, useMemo, useEffect, useRef, Suspense } from 'react';
import { dbWrite, dbOp } from '../../utils/dbWrite';
import db from '../../instant';
import { id } from '@instantdb/react';
import { useApp } from '../../context/AppContext';
import { usePermissions } from '../../hooks/usePermissions';
import { usePlanEnforcement } from '../../hooks/usePlanEnforcement';
import { useToast } from '../../context/ToastContext';
import { DEFAULT_STAGES, DEFAULT_SOURCES, DEFAULT_REQUIREMENTS, fmtDT } from '../../utils/helpers';
import Sidebar from './Sidebar';
import Topbar from './Topbar';
import NotifPanel from './NotifPanel';
import useAutomationEngine from '../../hooks/useAutomationEngine';

// Eagerly loaded (shown on first render)
import Dashboard from '../Dashboard/Dashboard';

// Wrapper to prevent "Failed to fetch dynamically imported module" crash upon new deployments
const lazyWithRetry = (importFunc) => {
  return React.lazy(() => {
    return new Promise((resolve, reject) => {
      importFunc()
        .then((module) => {
          sessionStorage.removeItem('tc_chunk_retry');
          resolve(module);
        })
        .catch((error) => {
          const isChunkLoadError = error?.message?.includes('dynamically imported module') || error?.name === 'ChunkLoadError';
          const hasRetried = sessionStorage.getItem('tc_chunk_retry');
          
          if (isChunkLoadError && !hasRetried) {
            sessionStorage.setItem('tc_chunk_retry', 'true');
            window.location.reload();
          } else {
            sessionStorage.removeItem('tc_chunk_retry');
            reject(error);
          }
        });
    });
  });
};

// Lazy loaded (loaded on-demand when navigated to)
const LeadsView = lazyWithRetry(() => import('../Leads/LeadsView'));
const Quotations = lazyWithRetry(() => import('../Finance/Quotations'));
const Invoices = lazyWithRetry(() => import('../Finance/Invoices'));
const POSBilling = lazyWithRetry(() => import('../Finance/POSBilling'));
const AMC = lazyWithRetry(() => import('../Clients/AMC'));
const Customers = lazyWithRetry(() => import('../Clients/Customers'));
const Expenses = lazyWithRetry(() => import('../Business/Expenses'));
const Products = lazyWithRetry(() => import('../Business/Products'));
const Vendors = lazyWithRetry(() => import('../Business/Vendors'));
const PurchaseOrders = lazyWithRetry(() => import('../Business/PurchaseOrders'));
const Campaigns = lazyWithRetry(() => import('../Marketing/Campaigns'));
const Projects = lazyWithRetry(() => import('../Work/Projects'));
const AllTasks = lazyWithRetry(() => import('../Work/AllTasks'));
const Teams = lazyWithRetry(() => import('../Work/Teams'));
const AutomationView = lazyWithRetry(() => import('../Automation/AutomationView'));
const Reports = lazyWithRetry(() => import('../Reports/Reports'));
const Settings = lazyWithRetry(() => import('../Settings/Settings'));
const MessagingLogs = lazyWithRetry(() => import('../System/MessagingLogs'));
const AdminPanel = lazyWithRetry(() => import('../Admin/AdminPanel'));
const ApiDocs = lazyWithRetry(() => import('../Admin/ApiDocs'));
const Integrations = lazyWithRetry(() => import('../System/Integrations'));
const UserManual = lazyWithRetry(() => import('../System/UserManual'));
const WAVariableGuide = lazyWithRetry(() => import('../Settings/WAVariableGuide'));
const UserProfile = lazyWithRetry(() => import('../Settings/UserProfile'));
const EcomSettings = lazyWithRetry(() => import('../Ecommerce/EcomSettings'));
const EcomOrders = lazyWithRetry(() => import('../Ecommerce/EcomOrders'));
const Appointments = lazyWithRetry(() => import('../Appointments/Appointments'));
const Distributors = lazyWithRetry(() => import('../Distributors/Distributors'));

const LazyFallback = () => (
  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 60, color: '#64748b', gap: 12 }}>
    <div className="spinner" style={{ width: 20, height: 20 }} />
    <span>Loading module...</span>
  </div>
);

// Short synthesized chime for new notifications — generated via Web Audio
// API rather than an audio file, so there's no asset to host/license.
function playNotifSound() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880; // A5
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.35);
    osc.onended = () => ctx.close();
  } catch (e) { /* autoplay/permission restrictions — fail silently */ }
}

const TRIAL_DAYS = 7;
const SUPERADMIN_KEY = 'santhanam.gokul@gmail.com';
const DEFAULT_PLANS = [
  { name: 'Trial', duration: 7, price: 0 },
  { name: 'Premium', duration: 30, price: 2999 },
  { name: 'START-UP', duration: 365, price: 24999 },
  { name: 'Premium Pro', duration: 365, price: 29999 },
];

export default function MainApp({ user, settings }) {
  const { activeView, notifOpen, setActiveView, settingsTab } = useApp();
  const toast = useToast();
  
  // Profile Setup Gate
  const [setupForm, setSetupForm] = useState({ fullName: '', bizName: '', phone: '' });
  const [setupSaving, setSetupSaving] = useState(false);
  
  // 1. Initial State for Team Info
  const [teamInfo, setTeamInfo] = useState(() => {
    try {
      const stored = localStorage.getItem('tc_team_member');
      return stored ? JSON.parse(stored) : null;
    } catch { return null; }
  });

  // 2. Discovery: If no teamInfo, check if this user IS a team member somewhere
  const isSuperadmin = user.email === SUPERADMIN_KEY;
  const discQuery = (!teamInfo && user.email && !isSuperadmin) 
    ? { teamMembers: { $: { where: { email: String(user.email).toLowerCase() }, limit: 1 } } } 
    : null;
  const { data: discovery, isLoading: reqLoading } = db.useQuery(discQuery);
  const discoveryLoading = discQuery ? reqLoading : false;
  const isDiscovering = !teamInfo && !!user.email && discoveryLoading;

  // 2b. Partner Discovery: check if this user is a partner (defense-in-depth)
  const storedPartnerCheck = localStorage.getItem('tc_channel_partner');
  const partnerDiscQuery = (!storedPartnerCheck && user.email && !isSuperadmin)
    ? { partnerApplications: { $: { where: { email: String(user.email).toLowerCase() }, limit: 1 } } }
    : null;
  const { data: partnerDiscovery, isLoading: partnerDiscLoading } = db.useQuery(partnerDiscQuery);
  const isDiscoveringPartner = !!partnerDiscQuery && partnerDiscLoading;

  // 2c. Owner-precedence check: does this email own a business? If so this user
  // is the OWNER and must never be resolved as a team member — guards the case
  // where an owner also added themselves to teamMembers with their own email,
  // which otherwise flips isTeamMember=true and locks them out of Settings/Admin.
  const ownerCheckQuery = (user.email && !isSuperadmin)
    ? { userProfiles: { $: { where: { email: String(user.email).toLowerCase() }, limit: 1 } } }
    : null;
  const { data: ownerCheck } = db.useQuery(ownerCheckQuery);
  const isEmailOwner = !!ownerCheck?.userProfiles?.[0];

  // Sync discovered team info
  useEffect(() => {
    // Owner precedence — clear any stale/erroneous team-member state for an
    // owner so Settings/Admin unlock even if their email is also in teamMembers.
    if (isEmailOwner && teamInfo?.isTeamMember) {
      setTeamInfo(null);
      localStorage.removeItem('tc_team_member');
      return;
    }
    if (discovery?.teamMembers?.[0] && !teamInfo && !isEmailOwner) {
      const discovered = {
        isTeamMember: true,
        ownerUserId: discovery.teamMembers[0].userId,
        teamMemberId: discovery.teamMembers[0].id
      };
      console.log("🔍 [MainApp] Discovered team membership:", discovered);
      setTeamInfo(discovered);
      localStorage.setItem('tc_team_member', JSON.stringify(discovered));
    }
  }, [discovery, teamInfo, isEmailOwner]);

  // Redirect discovered partners back to the partner portal
  useEffect(() => {
    if (partnerDiscovery?.partnerApplications?.[0]) {
      const p = partnerDiscovery.partnerApplications[0];
      console.log("🔍 [MainApp] Discovered partner account, redirecting:", p.email, p.role, p.status);
      const partnerInfo = {
        isPartner: true,
        ownerUserId: p.userId,
        partnerId: p.id,
        role: p.role,
        status: p.status
      };
      if (p.status === 'Approved') {
        localStorage.setItem('tc_channel_partner', JSON.stringify(partnerInfo));
      }
      // Force reload so App.jsx picks up the partner and routes correctly
      window.location.reload();
    }
  }, [partnerDiscovery]);

  // 3. Main Data Fetch (target the owner's data)
  const targetUserId = (teamInfo?.isTeamMember && !isSuperadmin) ? teamInfo.ownerUserId : user.id;
  const isTeamMember = !!teamInfo?.isTeamMember && !isSuperadmin;

  const { isLoading: mainLoading, data, error } = db.useQuery({
    userProfiles: { $: { where: { userId: targetUserId } } },
    memberProfiles: user.id ? { $: { where: { userId: user.id }, limit: 1 } } : null,
    teamMembers: { $: { where: { userId: targetUserId } } },
    amc: { $: { where: { userId: targetUserId } } },
    subs: { $: { where: { userId: targetUserId } } },
    checkProfiles: { userProfiles: { $: { limit: 1 } } },
  });

  // Secondary lookup by email — used to adopt admin-created profiles that have a different userId
  const needsEmailLookup = !isTeamMember && !isSuperadmin && !!user.email && !data?.userProfiles?.[0];
  const { data: emailProfileData, isLoading: emailLookupLoading } = db.useQuery(
    needsEmailLookup
      ? { userProfiles: { $: { where: { email: user.email }, limit: 1 } } }
      : null
  );

  if (error) console.error("MainApp Query Error:", error);

  const amc = data?.amc || [];
  const subs = data?.subs || [];
  const teamMembers = data?.teamMembers || [];
  // Use userId-matched profile first; fall back to email-matched (admin-created with different userId)
  let profile = data?.userProfiles?.[0] || emailProfileData?.userProfiles?.[0];
  const memberProfile = data?.memberProfiles?.[0];



  // Security: Cleanse profile for team members (remove tokens/passwords)
  if (isTeamMember && profile) {
    const { 
      waToken, waPhoneNumberId, 
      smtpHost, smtpPort, smtpUser, smtpPass,
      ...safeProfile 
    } = profile;
    safeProfile.isWaEnabled = !!waToken && !!waPhoneNumberId;
    safeProfile.isSmtpEnabled = !!smtpHost && !!smtpUser && !!smtpPass;
    profile = safeProfile;
  }
  
  // Permissions hook
  const perms = usePermissions(user, profile, teamMembers);

  // Plan enforcement hook
  const planEnforcement = usePlanEnforcement(profile, settings);

  // 2. Load Automation Engine (for background checks)
  useAutomationEngine(user, targetUserId);

  // Lightweight overdue-follow-up data for notifications (replaces 11k+ lead subscription)
  const [notifLeadData, setNotifLeadData] = useState([]);
  // Every lead with a follow-up set (past or future) — used to compute the
  // "due soon" advance-notice bucket per profile.followupNotifyMinutes.
  const [followupLeadsData, setFollowupLeadsData] = useState([]);

  // Read/dismissed notification ids — persisted per-tenant so "Mark all
  // read" survives a reload instead of resetting on every mount (the
  // previous NotifPanel onMarkRead/onMarkAllRead were both no-ops, so
  // nothing ever left the unread state, which is why "Mark all read"
  // appeared broken and overdue follow-ups seemed to never go away).
  const readNotifsKey = targetUserId ? `tc_read_notifs_${targetUserId}` : null;
  const [readNotifIds, setReadNotifIds] = useState(() => {
    if (!readNotifsKey) return new Set();
    try { return new Set(JSON.parse(localStorage.getItem(readNotifsKey) || '[]')); } catch { return new Set(); }
  });
  useEffect(() => {
    if (!readNotifsKey) return;
    try { setReadNotifIds(new Set(JSON.parse(localStorage.getItem(readNotifsKey) || '[]'))); } catch { setReadNotifIds(new Set()); }
  }, [readNotifsKey]);
  const persistReadNotifIds = (nextSet) => {
    // Cap to the most-recent 2000 ack ids so localStorage can't grow unbounded
    // over a long-lived tenant. We intentionally do NOT prune ids just because
    // their notif isn't in the CURRENT liveNotifs — that was the bug that made
    // the overdue toast reappear on every refresh: liveNotifs starts without
    // the overdue bucket (its data is fetched async from /api/dashboard-stats),
    // so any "prune ids not currently present" step would wipe the acked ids
    // during the window before that fetch resolves, and the bucket would then
    // look brand-new and re-toast. A size cap achieves bounded growth without
    // ever racing the fetch.
    let arr = [...nextSet];
    if (arr.length > 2000) arr = arr.slice(arr.length - 2000);
    const capped = new Set(arr);
    setReadNotifIds(capped);
    if (readNotifsKey) localStorage.setItem(readNotifsKey, JSON.stringify(arr));
  };
  // Most notif types are 1 lead = 1 stable id, so ackIds is just [n.id]. The
  // combined overdue-follow-up row is the exception: it represents an entire
  // BUCKET of leads under one display id, so it carries its own _ackIds (one
  // per lead in the bucket) — marking read acks each lead individually, so a
  // single new/resolved lead doesn't make the whole bucket look brand new
  // again (see the comment above the overdue block in liveNotifs).
  const ackIdsOf = (n) => n._ackIds || [n.id];
  const markNotifRead = (notif) => persistReadNotifIds(new Set([...readNotifIds, ...ackIdsOf(notif)]));
  const markAllNotifsRead = () => persistReadNotifIds(new Set([...readNotifIds, ...liveNotifs.flatMap(ackIdsOf)]));

  useEffect(() => {
    if (!targetUserId || !profile) return;
    const fetchNotifs = () => {
      fetch('/api/dashboard-stats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ownerId: targetUserId,
          savedLeadStages: profile?.leadStages || null,
          disabledStages: profile?.disabledStages || [],
          nowMs: Date.now(),
          isOwner: !isTeamMember,
          userEmail: user.email || '',
          myName: perms?.name || '',
          teamCanSeeAllLeads: true,
        }),
      })
        .then(r => r.json())
        .then(d => {
          setNotifLeadData(d?.overdueReminders || []);
          setFollowupLeadsData(d?.followupLeads || []);
        })
        .catch(() => {});
    };
    fetchNotifs();
    const interval = setInterval(fetchNotifs, 60000);
    return () => clearInterval(interval);
  }, [targetUserId, profile?.id, isTeamMember]);

  const isExpired = profile?.planExpiry && profile.planExpiry < Date.now();

  // Strict guard to prevent infinite transaction loops
  const syncRef = useRef(false);

  useEffect(() => {
    // 1. Critical Guards: Wait for everything to settle
    if (discoveryLoading || mainLoading || !data) return;
    // Wait for email lookup to settle before deciding to create a profile
    if (needsEmailLookup && emailLookupLoading) return;

    // 2. Strong Team Member Protection: 
    // Always prioritize team discovery over accidental local profiles
    const discoveredMember = discovery?.teamMembers?.[0];
    const isActuallyAMember = isTeamMember || !!discoveredMember;

    if (isActuallyAMember) {
      // Create member profile if it doesn't exist
      if (!memberProfile && !syncRef.current && user.id) {
         syncRef.current = true;
         const memberId = id();
         const teamRec = discoveredMember || teamMembers.find(m => m.id === teamInfo?.teamMemberId);
         dbWrite(dbOp.update('memberProfiles', memberId, {
            userId: user.id,
            ownerUserId: targetUserId,
            email: user.email,
            name: teamRec?.name || '',
            phone: teamRec?.phone || '',
            createdAt: Date.now()
         })).then(() => syncRef.current = false).catch(() => syncRef.current = false);
      }
      return;
    }

    // HARD BLOCK: If partner discovery found this user is a partner, do NOT create a profile
    if (partnerDiscovery?.partnerApplications?.[0]) {
      console.log("🛡 [MainApp] Blocked profile creation for partner:", user.email);
      return;
    }

    const rawReg = localStorage.getItem('tc_reg_data');
    const regData = rawReg ? JSON.parse(rawReg) : {};

    if (!profile && !syncRef.current) {
      syncRef.current = true;
      const role = (user.email === SUPERADMIN_KEY) ? 'superadmin' : 'user';

      console.log("🛠 [MainApp] Creating user profile for:", user.email, "Role:", role);

      const profileId = id();
      dbWrite(dbOp.update('userProfiles', profileId, {
        userId: user.id,
        email: user.email,
        fullName: regData.fullName || '',
        phone: regData.phone || '',
        bizName: regData.bizName || '',
        role: role,
        plan: regData.selectedPlan || 'Trial',
        planExpiry: Date.now() + (TRIAL_DAYS * 24 * 60 * 60 * 1000),
        stages: DEFAULT_STAGES,
        sources: DEFAULT_SOURCES,
        requirements: DEFAULT_REQUIREMENTS,
        invoiceTemplate: 'Spreadsheet',
        quotationTemplate: 'Spreadsheet',
        createdAt: Date.now()
      })).then(() => {
        console.log("✅ [MainApp] Profile created successfully:", profileId);
        localStorage.removeItem('tc_reg_data');
      }).catch(e => {
        console.error("❌ [MainApp] Profile creation failed", e);
        syncRef.current = false; // Allow retry on failure
      });
    } else if (profile) {
      // Profile found — if it was admin-created with a different userId, adopt it by updating userId to current auth ID
      if (profile.userId !== user.id && !isTeamMember && !syncRef.current) {
        syncRef.current = true;
        console.log("🔗 [MainApp] Adopting admin-created profile — updating userId from", profile.userId, "to", user.id);
        dbWrite(dbOp.update('userProfiles', profile.id, { userId: user.id }))
          .then(() => { console.log("✅ [MainApp] Profile userId adopted successfully"); syncRef.current = false; })
          .catch(e => { console.error("❌ [MainApp] Profile adoption failed", e); syncRef.current = false; });
      }
      // Sync metadata if missing or incorrect
      const isUuid = profile.email && profile.email.length === 36 && !profile.email.includes('@');
      const needsEmail = !profile.email || profile.email === '' || isUuid;
      const needsPhone = !profile.phone && (user.phone || regData.phone); 
      const needsAdmin = user.email === SUPERADMIN_KEY && profile.role !== 'superadmin';
      const needsUserId = !profile.userId && user.id;
      const needsExpiry = !profile.planExpiry;

      if (needsEmail || needsPhone || needsAdmin || needsUserId || needsExpiry) {
        const updates = {};
        if (needsEmail) updates.email = user.email;
        if (needsPhone) updates.phone = user.phone || regData.phone;
        if (needsAdmin) updates.role = 'superadmin';
        if (needsUserId) updates.userId = user.id;
        if (needsExpiry) {
          const planDuration = DEFAULT_PLANS.find(p => p.name === (profile.plan || 'Trial'))?.duration || 7;
          updates.planExpiry = Date.now() + (planDuration * 24 * 60 * 60 * 1000);
        }
        
        console.log("⚡ [MainApp] Metadata Sync Required:", updates);
        dbWrite(dbOp.update('userProfiles', profile.id, updates))
          .then(() => console.log("✅ [MainApp] Metadata synced successfully"))
          .catch(e => console.error("❌ [MainApp] Metadata sync failed", e));
      }
    }

    // 3. Strict Role Cleanup: Demote unauthorized superadmins
    if (profile && profile.role === 'superadmin' && user.email !== SUPERADMIN_KEY) {
      console.warn("🛡 [MainApp] Unauthorized Superadmin detected. Demoting:", user.email);
      dbWrite(dbOp.update('userProfiles', profile.id, { role: 'user' }))
        .then(() => { toast('Profile role updated', 'info'); console.log("✅ [MainApp] User demoted to 'user'"); })
        .catch(e => console.error("❌ [MainApp] Demotion failed", e));
    }
  }, [discoveryLoading, mainLoading, data, profile, user.id, user.email, teamInfo, needsEmailLookup, emailLookupLoading]);

  // Notifications calculation
  const liveNotifs = useMemo(() => {
    const now = new Date();
    const notifs = [];
    const isTeam = perms && !perms.isOwner;

    amc.forEach(a => {
      if (isTeam && a.actorId !== user.id) return;
      const endMs = new Date(a.endDate).getTime();
      const diff = Math.ceil((endMs - now) / (1000 * 60 * 60 * 24));
      if (diff <= 30 && diff >= 0)
        notifs.push({ id: 'amc-' + a.id, unread: !readNotifIds.has('amc-' + a.id), title: `🛡 AMC Expiring: ${a.client}`, desc: `Contract ${a.contractNo} expires in ${diff} day${diff !== 1 ? 's' : ''}`, time: new Date().toLocaleString(), _sortKey: endMs });
    });

    subs.forEach(s => {
      if (isTeam && s.actorId !== user.id) return;
      const dueMs = new Date(s.nextPayment).getTime();
      const diff = Math.ceil((dueMs - now) / (1000 * 60 * 60 * 24));
      if (diff <= 7 && diff >= 0)
        notifs.push({ id: 'sub-' + s.id, unread: !readNotifIds.has('sub-' + s.id), title: `💰 Payment Due: ${s.client}`, desc: `₹${(s.amount || 0).toLocaleString()} for ${s.plan} due in ${diff} day${diff !== 1 ? 's' : ''}`, time: new Date().toLocaleString(), _sortKey: dueMs });
    });

    // The Settings > Business > "Follow-up Notification" interval is the master
    // switch for BOTH follow-up notifications below (overdue + advance "due
    // soon"). 0 = Off silences both — turning it off means the user wants no
    // follow-up alerts at all, not just the advance ones.
    const lookaheadMin = profile?.followupNotifyMinutes || 0;

    // Overdue follow-ups — sourced from server to avoid 11k+ lead subscription.
    // Sorted ascending (most overdue first) by dashboard-stats.js already, so
    // [0] is the earliest/most-overdue — use it to rank this entry among others.
    // This is ONE combined row for display, but tracks read-state PER LEAD via
    // _ackIds — hashing the whole set into a single id meant that whenever any
    // one lead entered/left the overdue bucket (which happens constantly as
    // leads get worked), the entire combined notification looked brand new
    // and re-toasted, even though most of its leads were already acknowledged.
    // Per-lead ack ids mean only the genuinely new lead(s) trigger a fresh
    // toast, and already-seen leads staying overdue don't re-trigger it.
    if (lookaheadMin > 0 && notifLeadData.length > 0) {
      const ackIds = notifLeadData.map(l => 'fu-overdue-lead-' + l.id);
      notifs.push({ id: 'fu-overdue-bucket', _ackIds: ackIds, unread: ackIds.some(aid => !readNotifIds.has(aid)), title: `⏰ ${notifLeadData.length} Overdue Follow-up${notifLeadData.length > 1 ? 's' : ''}`, desc: `Leads: ${notifLeadData.slice(0, 10).map(l => l.name).join(', ')}${notifLeadData.length > 10 ? '...' : ''}`, time: new Date().toLocaleString(), _sortKey: notifLeadData[0].followup });
    }

    // Advance-notice follow-ups — "due soon" within the same interval.
    // followupLeadsData already includes both past and future follow-ups,
    // pre-filtered server-side for team visibility (same as overdue above).
    // One notification PER LEAD (not a combined line) so the follow-up time
    // and phone number are visible for each.
    if (lookaheadMin > 0) {
      const lookaheadMs = lookaheadMin * 60 * 1000;
      const nowMs = now.getTime();
      const dueSoon = followupLeadsData
        .filter(l => l.followup && l.followup > nowMs && (l.followup - nowMs) <= lookaheadMs)
        .sort((a, b) => a.followup - b.followup)
        .slice(0, 20); // cap so a misconfigured long lookahead can't flood the panel
      dueSoon.forEach(l => {
        const dueSoonId = 'fu-due-soon-' + l.id;
        notifs.push({
          id: dueSoonId,
          unread: !readNotifIds.has(dueSoonId),
          leadId: l.id, // lets the click handler deep-link into this lead
          title: `🔔 Follow-up Due Soon: ${l.name}`,
          desc: `${l.phone ? l.phone + ' | ' : ''}Due ${fmtDT(l.followup)}${l.stage ? ' | ' + l.stage : ''}`,
          time: new Date().toLocaleString(),
          _sortKey: l.followup,
        });
      });
    }

    // Most urgent/soonest-due first, regardless of category (AMC/payment/
    // follow-up) — matches what the user should act on next.
    notifs.sort((a, b) => (a._sortKey ?? Infinity) - (b._sortKey ?? Infinity));
    return notifs;
  }, [amc, subs, notifLeadData, followupLeadsData, profile?.followupNotifyMinutes, perms, user, readNotifIds]);

  // Proactive alert (toast + sound) the moment a notification FIRST appears —
  // not just when the bell is manually opened. Dedup now uses the SAME
  // persisted readNotifIds set as the bell panel (not an in-memory ref that
  // reset on every mount): a notif toasts once, then is immediately marked
  // read (via its ackIds — see ackIdsOf above) so it won't re-toast on the
  // next page load.
  //
  // This also fixes a real bug: the old ref was seeded from `liveNotifs` on
  // the first run of this effect, but notifLeadData/followupLeadsData start
  // empty and only populate after the async /api/dashboard-stats fetch
  // resolves. So the seed (taken before the fetch resolved) never included
  // the overdue-follow-up entry; when the fetch then completed a moment
  // later, that entry looked "new" and re-toasted — on every single page
  // refresh. Reading from localStorage instead of the in-flight liveNotifs
  // snapshot removes that race entirely.
  useEffect(() => {
    const newOnes = liveNotifs.filter(n => ackIdsOf(n).some(aid => !readNotifIds.has(aid)));
    if (newOnes.length === 0) return; // nothing genuinely new — never re-toast

    newOnes.forEach(n => {
      // persistent: stays on screen until manually closed — a 3.5s
      // auto-dismiss risks the user missing a due-soon alert entirely.
      // Includes the desc line (due time / phone / stage) so the timing is
      // visible right in the popup, not just in the bell panel. Clickable
      // (deep-links via tc_open_lead, the same mechanism LeadsView already
      // uses) only when the notif is tied to a single lead.
      const msgNode = n.leadId ? (
        <span
          onClick={() => {
            localStorage.setItem('tc_open_lead', n.leadId);
            setActiveView('leads');
            // If LeadsView is already mounted (user already on Leads), its
            // localStorage-watching effect won't re-fire on its own — this
            // event tells it to open the lead immediately either way.
            window.dispatchEvent(new CustomEvent('tc-open-lead-request', { detail: n.leadId }));
          }}
          style={{ cursor: 'pointer', display: 'block' }}
        >
          <div>{n.title}</div>
          <div style={{ fontSize: 11, opacity: 0.85, marginTop: 2 }}>{n.desc}</div>
        </span>
      ) : (
        <span style={{ display: 'block' }}>
          <div>{n.title}</div>
          <div style={{ fontSize: 11, opacity: 0.85, marginTop: 2 }}>{n.desc}</div>
        </span>
      );
      toast(msgNode, 'warning', { persistent: true });
    });
    playNotifSound();
    // Mark the new ones read immediately so they can't re-toast on the next
    // refresh. No pruning of old ids here — that raced the async overdue fetch
    // and wiped acked ids (see persistReadNotifIds); bounded growth is handled
    // by the size cap there instead.
    persistReadNotifIds(new Set([...readNotifIds, ...newOnes.flatMap(ackIdsOf)]));
  }, [liveNotifs, toast, readNotifIds]);

  const amcExpiringCount = amc.filter(a => {
    const isTeam = perms && !perms.isOwner;
    if (isTeam && a.actorId !== user.id) return false;
    const d = Math.ceil((new Date(a.endDate) - new Date()) / (1000 * 60 * 60 * 24));
    return d <= 30 && d >= 0;
  }).length;

  const views = {
    dashboard: { component: <Dashboard user={user} ownerId={targetUserId} perms={perms} />, label: 'Dashboard' },
    leads: { component: <LeadsView user={user} perms={perms} ownerId={targetUserId} />, label: 'Leads' },
    quotations: { component: <Quotations user={user} perms={perms} ownerId={targetUserId} settings={settings} />, label: 'Quotations' },
    invoices: { component: <Invoices user={user} perms={perms} ownerId={targetUserId} settings={settings} />, label: 'Invoices' },
    pos: { component: <POSBilling user={user} perms={perms} ownerId={targetUserId} settings={settings} />, label: 'Invoices' }, 
    customers: { component: <Customers user={user} perms={perms} ownerId={targetUserId} />, label: 'Customers' },
    amc: { component: <AMC user={user} perms={perms} ownerId={targetUserId} />, label: 'AMC' },
    expenses: { component: <Expenses user={user} perms={perms} ownerId={targetUserId} />, label: 'Expenses' },
    products: { component: <Products user={user} perms={perms} ownerId={targetUserId} />, label: 'Products' },
    vendors: { component: <Vendors user={user} perms={perms} ownerId={targetUserId} />, label: 'Vendors' },
    'purchase-orders': { component: <PurchaseOrders user={user} perms={perms} ownerId={targetUserId} />, label: 'PurchaseOrders' },
    campaigns: { component: <Campaigns user={user} perms={perms} ownerId={targetUserId} />, label: 'Campaigns' },
    projects: { component: <Projects user={user} perms={perms} ownerId={targetUserId} />, label: 'Projects' },
    alltasks: { component: <AllTasks user={user} perms={perms} ownerId={targetUserId} />, label: 'Tasks' },
    teams: { component: <Teams user={user} ownerId={targetUserId} perms={perms} />, label: 'Teams' }, 
    automation: { component: <AutomationView user={user} perms={perms} ownerId={targetUserId} />, label: 'Automation' },
    integrations: { component: <Integrations user={user} ownerId={targetUserId} />, label: 'Integrations' },
    'messaging-logs': { component: <MessagingLogs user={user} ownerId={targetUserId} />, label: 'MessagingLogs' },
    reports: { component: <Reports user={user} perms={perms} ownerId={targetUserId} profile={profile} />, label: 'Reports' },
    'ecom-settings': { component: <EcomSettings ownerId={targetUserId} globalSettings={settings} perms={perms} />, label: 'Ecommerce' },
    'ecom-orders': { component: <EcomOrders ownerId={targetUserId} perms={perms} />, label: 'Ecommerce' },
    appointments: { component: <Appointments user={user} ownerId={targetUserId} perms={perms} settings={settings} />, label: 'Appointments' },
    'appointment-settings': { component: <Appointments user={user} ownerId={targetUserId} perms={perms} initialTab="settings" settings={settings} />, label: 'Appointments' },
    distributors: { component: <Distributors user={user} ownerId={targetUserId} perms={perms} />, label: 'Distributors' },
    distributor_performance: { component: <Distributors user={user} ownerId={targetUserId} perms={perms} initialTab="Reports" />, label: 'Distributors' },
    userprofile: { component: <UserProfile user={user} profile={profile} perms={perms} memberProfile={memberProfile} ownerId={targetUserId} />, label: 'Public' },
    manual: { component: <UserManual settings={settings} />, label: 'Public' },
    'wa-guide': { component: <WAVariableGuide onBack={() => setActiveView('settings')} />, label: 'WA Guide' },
    settings: { component: isTeamMember ? null : <Settings user={user} profile={profile} isExpired={isExpired} ownerId={targetUserId} initialTab={settingsTab} perms={perms} teamInfo={teamMembers.find(m => m.id === teamInfo?.teamMemberId)} memberProfile={memberProfile} settings={settings} />, label: 'Settings' },
    admin: { component: isSuperadmin ? <AdminPanel user={user} /> : null, label: 'Admin' },
    apidocs: { component: isSuperadmin ? <ApiDocs ownerId={targetUserId} /> : null, label: 'API Docs' },
  };

  // 1. Guard against unauthorised views for team members AND plan restrictions
  useEffect(() => {
    if (!perms) return;

    const viewConfig = views[activeView];
    const permKey = viewConfig?.label || '';

    // Plan-based guard (applies to owners AND team members, but not superadmin)
    if (planEnforcement && !isSuperadmin && !planEnforcement.isViewAllowed(activeView)) {
      const firstAllowed = Object.keys(views).find(key => {
        if (!views[key]) return false;
        if (key === 'dashboard' || key === 'userprofile') return true;
        return planEnforcement.isViewAllowed(key);
      });
      if (firstAllowed && firstAllowed !== activeView) setActiveView(firstAllowed);
      return;
    }

    // Role-based guard (team members only)
    if (perms.isOwner) return;

    const canSeeCurrent = activeView === 'dashboard' ? perms.can('Dashboard', 'view') : 
                        activeView === 'userprofile' ? true :
                        activeView === 'settings' ? false :
                        perms.can(permKey, 'list');

    if (!canSeeCurrent) {
      const firstAvailableKey = Object.keys(views).find(key => {
        const conf = views[key];
        if (!conf || !conf.label) return false;
        if (key === 'userprofile') return true;
        if (key === 'dashboard') return perms.can('Dashboard', 'view');
        if (key === 'settings') return false;
        // Also check plan enforcement
        if (planEnforcement && !isSuperadmin && !planEnforcement.isViewAllowed(key)) return false;
        return perms.can(conf.label, 'list');
      });

      if (firstAvailableKey && firstAvailableKey !== activeView) {
        setActiveView(firstAvailableKey);
      }
    }
  }, [perms, planEnforcement, activeView, setActiveView]);



  if (isDiscovering || isDiscoveringPartner || mainLoading || (profile && (!perms || !planEnforcement))) {
    return (
      <div className="loading-screen">
        <div className="logo">{settings?.brandShort || ''}</div>
        <div className="spinner" />
        <p>{(isDiscovering || isDiscoveringPartner) ? 'Discovering Workspace...' : `Loading ${settings?.brandName || ''}...`}</p>
      </div>
    );
  }

  const currentView = views[activeView] || views.dashboard;

  // ── MANDATORY PROFILE SETUP GATE ──
  // If profile exists but missing required fields, force the user to complete them
  const needsSetup = profile && !isTeamMember && !isSuperadmin && (!profile.fullName || !profile.bizName || !profile.phone);

  if (needsSetup) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', fontFamily: 'Inter, sans-serif' }}>
        <div style={{ width: '100%', maxWidth: 480, padding: 40, background: 'var(--card)', borderRadius: 16, border: '1px solid var(--border)', boxShadow: '0 8px 32px rgba(0,0,0,0.08)' }}>
          <div style={{ textAlign: 'center', marginBottom: 28 }}>
            <div style={{ fontSize: 40, marginBottom: 8 }}>👋</div>
            <h2 style={{ margin: '0 0 6px', fontSize: 22, fontWeight: 700 }}>Complete Your Profile</h2>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)' }}>Please fill in your details to get started with {settings?.brandName || 'the CRM'}.</p>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4, color: '#333' }}>Full Name <span style={{ color: '#ef4444' }}>*</span></label>
              <input
                value={setupForm.fullName || profile.fullName || ''}
                onChange={e => setSetupForm(f => ({ ...f, fullName: e.target.value }))}
                placeholder="Your full name"
                style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 14, boxSizing: 'border-box' }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4, color: '#333' }}>Business / Company Name <span style={{ color: '#ef4444' }}>*</span></label>
              <input
                value={setupForm.bizName || profile.bizName || ''}
                onChange={e => setSetupForm(f => ({ ...f, bizName: e.target.value }))}
                placeholder="Your business name"
                style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 14, boxSizing: 'border-box' }}
              />
            </div>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4, color: '#333' }}>Phone Number <span style={{ color: '#ef4444' }}>*</span></label>
              <input
                value={setupForm.phone || profile.phone || ''}
                onChange={e => setSetupForm(f => ({ ...f, phone: e.target.value }))}
                placeholder="+91 98765 43210"
                style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 14, boxSizing: 'border-box' }}
              />
            </div>
            <button
              disabled={setupSaving}
              onClick={async () => {
                const fn = (setupForm.fullName || profile.fullName || '').trim();
                const bn = (setupForm.bizName || profile.bizName || '').trim();
                const ph = (setupForm.phone || profile.phone || '').trim();
                if (!fn || !bn || !ph) { toast('All fields are required', 'error'); return; }
                setSetupSaving(true);
                try {
                  await dbWrite(dbOp.update('userProfiles', profile.id, { fullName: fn, bizName: bn, phone: ph }));
                  toast('Profile saved! Welcome! 🎉', 'success');
                } catch (e) { toast(e.message, 'error'); }
                finally { setSetupSaving(false); }
              }}
              style={{ width: '100%', padding: '12px', borderRadius: 8, background: 'var(--accent)', color: '#fff', fontSize: 14, fontWeight: 700, border: 'none', cursor: 'pointer', marginTop: 4 }}
            >
              {setupSaving ? 'Saving...' : 'Save & Continue →'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <Sidebar
        isSuperadmin={isSuperadmin}
        isExpired={isExpired} 
        perms={perms}
        settings={settings}
        planEnforcement={planEnforcement}
      />
      <div className="main">
        <Topbar user={{ ...user, profile }} notifCount={liveNotifs.filter(n => n.unread).length} isExpired={isExpired} teamInfo={teamInfo} teamMembers={teamMembers} />
        <div className="content">
          <Suspense fallback={<LazyFallback />}>
            {currentView.component ? React.cloneElement(currentView.component, { perms, planEnforcement }) : <div className="p-xl">View not found or access denied</div>}
          </Suspense>
        </div>
      </div>
      <NotifPanel notifications={liveNotifs} onMarkRead={markNotifRead} onMarkAllRead={markAllNotifsRead} />
    </div>
  );
}

