import { init, tx, id } from '@instantdb/admin';

const APP_ID = process.env.VITE_INSTANT_APP_ID;
const ADMIN_TOKEN = process.env.INSTANT_ADMIN_TOKEN;

// Mapping of module keys to InstantDB collection names
const COLLECTION_MAP = {
  'leads': 'leads',
  'customers': 'customers',
  'quotations': 'quotes',
  'invoices': 'invoices',
  'amc': 'amc',
  'expenses': 'expenses',
  'products': 'products',
  'vendors': 'vendors',
  'purchase-orders': 'purchaseOrders',
  'projects': 'projects',
  'tasks': 'tasks',
  'teams': 'teamMembers',
  'subs': 'subs',
  'logs': 'activityLogs',
  'ecomSettings': 'ecomSettings',
  'orders': 'orders',
  'appointments': 'appointments',
  'appointmentSettings': 'appointmentSettings',
  'ecomCustomers': 'ecomCustomers',
  'memberStats': 'memberStats',
  'call-logs': 'callLogs',
  'callLogs': 'callLogs',
  'attendance': 'attendance',
};

// Normalize module keys to singular entity types for activity logs
const ENTITY_TYPE_MAP = {
  'leads': 'lead',
  'customers': 'customer',
  'quotations': 'quotation',
  'invoices': 'invoice',
  'amc': 'amc',
  'expenses': 'expense',
  'products': 'product',
  'vendors': 'vendor',
  'purchase-orders': 'purchaseOrder',
  'projects': 'project',
  'tasks': 'task',
  'teams': 'team',
  'subs': 'sub',
  'orders': 'order',
  'appointments': 'appointment',
  'call-logs': 'callLog',
  'callLogs': 'callLog',
  'attendance': 'attendance',
};

async function getStatsTx(db, ownerId, actorId, type) {
  const today = new Date().toISOString().split('T')[0];
  const { memberStats } = await db.query({ 
    memberStats: { $: { where: { userId: ownerId, memberId: actorId, date: today } } } 
  });
  
  let statsId;
  let current = { leadsWorked: 0, leadsWon: 0, tasksWorked: 0, tasksCompleted: 0, otherWorks: 0 };
  
  if (memberStats?.length > 0) {
    statsId = memberStats[0].id;
    current = memberStats[0];
  } else {
    statsId = id();
  }
  
  const updates = { 
    leadsWorked: current.leadsWorked || 0,
    leadsWon: current.leadsWon || 0,
    tasksWorked: current.tasksWorked || 0,
    tasksCompleted: current.tasksCompleted || 0,
    otherWorks: current.otherWorks || 0,
    [type]: (current[type] || 0) + 1, 
    updatedAt: Date.now() 
  };
  return tx.memberStats[statsId].update({
    ...updates,
    userId: ownerId,
    memberId: actorId,
    date: today
  });
}

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (!APP_ID || !ADMIN_TOKEN) {
      return res.status(500).json({ error: 'Missing InstantDB configuration in backend' });
    }

    const db = init({ appId: APP_ID, adminToken: ADMIN_TOKEN });
    const { method } = req;
    
    // Merge query and body params to support both URL rewrites and JSON bodies
    const params = { ...req.query, ...(req.body || {}) };
    const { module, ownerId, actorId, userName, teamMemberId, projectId, logText, ...data } = params;

    if (!module || !COLLECTION_MAP[module]) {
      // If no module provided in GET request, return empty data instead of error
      if (method === 'GET' && !module) {
        return res.status(200).json({ success: true, data: [] });
      }
      return res.status(400).json({ error: `Invalid or missing module. Received: ${module}. Allowed: ${Object.keys(COLLECTION_MAP).join(', ')}` });
    }


    if (!ownerId) {
      return res.status(400).json({ error: 'ownerId is required to identify the workspace context' });
    }

    const collection = COLLECTION_MAP[module];

    /* ──────────── READ (GET) ──────────── */
    if (method === 'GET') {
      // Special handling for `leads`: apply staff visibility + assignee
      // filtering. Previously this endpoint returned ALL leads to anyone
      // who hit it (the mobile app showed every team member the full 11k
      // dataset because it relies on this endpoint).
      if (module === 'leads') {
        const { leads, userProfiles, teamMembers: teamFromDb } = await db.query({
          leads: { $: { where: { userId: ownerId } } },
          userProfiles: { $: { where: { userId: ownerId } } },
          teamMembers: { $: { where: { userId: ownerId } } },
        });
        let result = leads || [];
        const profile = userProfiles?.[0] || {};
        const teamMembers = teamFromDb || [];
        const teamCanSeeAllLeads = params.teamCanSeeAllLeads !== undefined
          ? (params.teamCanSeeAllLeads === true || params.teamCanSeeAllLeads === 'true')
          : (profile.teamCanSeeAllLeads !== false);

        // Auto-detect caller: owner vs team member
        // - actorId === ownerId  → owner (sees all)
        // - actorId matches a teamMember.id → team member identity resolved
        // - else fall back to explicit isOwner / userEmail / myName params
        let isOwner = false;
        let userEmail = params.userEmail || '';
        let myName = params.myName || '';
        if (!actorId || actorId === ownerId) {
          isOwner = true;
        } else {
          const tm = teamMembers.find(t => t.id === actorId);
          if (tm) {
            userEmail = userEmail || tm.email || '';
            myName = myName || tm.name || '';
          } else if (params.isOwner === true || params.isOwner === 'true') {
            isOwner = true;
          }
        }

        // Team visibility: if not owner AND workspace forbids team-wide view,
        // limit to leads assigned to this user (or unassigned)
        if (!isOwner && !teamCanSeeAllLeads) {
          result = result.filter(l => !l.assign || l.assign === userEmail || l.assign === myName);
        }

        // Optional explicit filters (mirrors /api/leads-page)
        const { staffFilter = '', srcFilter = '', stgFilter = '' } = params;
        result = result.filter(l => {
          if (srcFilter && l.source !== srcFilter) return false;
          if (stgFilter && l.stage !== stgFilter) return false;
          if (staffFilter) {
            if (staffFilter === 'unassigned') {
              if (l.assign) return false;
            } else if (staffFilter === 'my') {
              if (l.assign !== userEmail && l.assign !== myName) return false;
            } else if (l.assign !== staffFilter) {
              return false;
            }
          }
          return true;
        });

        return res.status(200).json({ success: true, data: result, count: result.length });
      }

      const query = { [collection]: { $: { where: { userId: ownerId } } } };
      const result = await db.query(query);
      return res.status(200).json({ success: true, data: result[collection] || [] });
    }

    /* ──────────── CREATE (POST) ──────────── */
    if (method === 'POST') {
      const newId = id();
      let payload = { ...data, userId: ownerId, actorId: actorId || ownerId, createdAt: Date.now() };

      // Handle Task Numbering
      if (module === 'tasks') {
        const { tasks } = await db.query({ tasks: { $: { where: { userId: ownerId } } } });
        const maxNum = tasks?.reduce((max, t) => Math.max(max, t.taskNumber || 0), 0) || 0;
        const nextNum = maxNum < 100 ? 101 : maxNum + 1;
        payload.taskNumber = nextNum;
      }
      
      const txs = [
        tx[collection][newId].update(payload),
        tx.activityLogs[id()].update({
          entityId: newId,
          entityType: ENTITY_TYPE_MAP[module] || module,
          text: (module === 'tasks' && !logText) ? `Task T-${payload.taskNumber} created: "${payload.title}"` : (logText || `Created new ${module} via API.`),
          userId: ownerId,
          actorId: actorId || ownerId,
          userName: userName || 'API System',
          teamMemberId: teamMemberId || null,
          projectId: projectId || null,
          createdAt: Date.now()
        })
      ];

      // Auto-won lead conversion for projects
      if (module === 'projects') {
        const profileQuery = await db.query({ userProfiles: { $: { where: { userId: ownerId } } } });
        const wonStage = profileQuery.userProfiles?.[0]?.wonStage || 'Won';
        const { leads } = await db.query({ leads: { $: { where: { userId: ownerId } } } });
        const lMatch = leads?.find(l => (l.name || '').trim().toLowerCase() === (data.client || '').trim().toLowerCase() && l.stage !== wonStage);
        if (lMatch) {
          txs.push(tx.leads[lMatch.id].update({ stage: wonStage }));
          txs.push(tx.activityLogs[id()].update({
            entityId: lMatch.id, entityType: 'lead', text: `Project "${data.name}" started. Lead automatically marked as Won.`,
            userId: ownerId, actorId: actorId || ownerId, userName: userName || 'API System', createdAt: Date.now()
          }));
        }
      }

      const statsType = module === 'tasks' ? 'tasksWorked' : (module === 'leads' ? 'leadsWorked' : 'otherWorks');
      txs.push(await getStatsTx(db, ownerId, payload.actorId, statsType));

      await db.transact(txs);

      return res.status(200).json({ success: true, id: newId, message: 'Record created successfully' });
    }

    if (method === 'PATCH') {
      const { id: targetId, ...updates } = data;
      if (!targetId) return res.status(400).json({ error: 'Record ID is required for updates' });

      const txs = [
        tx[collection][targetId].update(updates),
        tx.activityLogs[id()].update({
          entityId: targetId,
          entityType: module,
          text: logText || `Updated ${module} via API.`,
          userId: ownerId,
          actorId: actorId || ownerId,
          userName: userName || 'API System',
          teamMemberId: teamMemberId || null,
          projectId: projectId || null,
          createdAt: Date.now()
        })
      ];

      // Update Stats for Completions/Wins
      if (module === 'tasks' && updates.status === 'Completed') {
        txs.push(await getStatsTx(db, ownerId, actorId || ownerId, 'tasksCompleted'));
      }
      if (module === 'leads' && (updates.stage === 'Won' || (updates.stage || '').toLowerCase().includes('won'))) {
        txs.push(await getStatsTx(db, ownerId, actorId || ownerId, 'leadsWon'));
      }

      await db.transact(txs);

      return res.status(200).json({ success: true, message: 'Record updated successfully' });
    }

    /* ──────────── DELETE (DELETE) ──────────── */
    // HARD delete policy: permanently remove record + all orphanable children
    // (No soft deletes. No orphaned records. Keeps DB clean & performant.)
    if (method === 'DELETE') {
      const { id: targetId } = data;
      if (!targetId) return res.status(400).json({ error: 'Record ID is required for deletion' });

      const txs = [
        tx[collection][targetId].delete()
      ];

      // 1. Universal: activity logs referencing this entity
      const { activityLogs } = await db.query({ activityLogs: { $: { where: { entityId: targetId } } } });
      (activityLogs || []).forEach(log => txs.push(tx.activityLogs[log.id].delete()));

      // 2. Universal: appointments referencing this entity
      try {
        const { appointments } = await db.query({ appointments: { $: { where: { entityId: targetId } } } });
        (appointments || []).forEach(a => txs.push(tx.appointments[a.id].delete()));
      } catch {}

      // 3. Leads/Customers: tasks (entityId), callLogs (leadId)
      if (module === 'leads' || module === 'customers') {
        const { tasks } = await db.query({ tasks: { $: { where: { entityId: targetId } } } });
        (tasks || []).forEach(t => txs.push(tx.tasks[t.id].delete()));
        try {
          const { callLogs } = await db.query({ callLogs: { $: { where: { leadId: targetId } } } });
          (callLogs || []).forEach(c => txs.push(tx.callLogs[c.id].delete()));
        } catch {}
      }

      // 4. Customers: linked AMC contracts
      if (module === 'customers') {
        try {
          const { amc } = await db.query({ amc: { $: { where: { customerId: targetId } } } });
          (amc || []).forEach(a => txs.push(tx.amc[a.id].delete()));
        } catch {}
      }

      // 5. Projects: child tasks + expenses
      if (module === 'projects') {
        const { tasks } = await db.query({ tasks: { $: { where: { projectId: targetId } } } });
        (tasks || []).forEach(t => txs.push(tx.tasks[t.id].delete()));
        try {
          const { expenses } = await db.query({ expenses: { $: { where: { projectId: targetId } } } });
          (expenses || []).forEach(e => txs.push(tx.expenses[e.id].delete()));
        } catch {}
      }

      // 6. Vendors: linked purchase orders
      if (module === 'vendors') {
        try {
          const { purchaseOrders } = await db.query({ purchaseOrders: { $: { where: { vendorId: targetId } } } });
          (purchaseOrders || []).forEach(po => txs.push(tx.purchaseOrders[po.id].delete()));
        } catch {}
      }

      // 7. Team members: credentials, attendance, stats, activity logs
      if (module === 'teams') {
        try {
          const { teamMembers } = await db.query({ teamMembers: { $: { where: { id: targetId } } } });
          const member = (teamMembers || [])[0];
          if (member?.email) {
            const email = member.email.trim().toLowerCase();
            const { userCredentials } = await db.query({ userCredentials: { $: { where: { email } } } });
            (userCredentials || []).forEach(c => txs.push(tx.userCredentials[c.id].delete()));
            const { attendance } = await db.query({ attendance: { $: { where: { staffEmail: email } } } });
            (attendance || []).forEach(a => txs.push(tx.attendance[a.id].delete()));
          }
          const { memberStats } = await db.query({ memberStats: { $: { where: { memberId: targetId } } } });
          (memberStats || []).forEach(s => txs.push(tx.memberStats[s.id].delete()));
        } catch {}
      }

      // Batch in chunks of 100 to stay within transaction limits
      const batchSize = 100;
      for (let i = 0; i < txs.length; i += batchSize) {
        await db.transact(txs.slice(i, i + batchSize));
      }

      return res.status(200).json({ success: true, message: 'Record deleted successfully', cascadedCount: txs.length });
    }

    return res.status(405).json({ error: 'Method not allowed' });

  } catch (err) {
    console.error(`API Error [${req.method} ${req.query.module}]:`, err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
}
