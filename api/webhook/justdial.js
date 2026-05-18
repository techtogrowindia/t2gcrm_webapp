import { init } from '@instantdb/admin';

const APP_ID = process.env.VITE_INSTANT_APP_ID;
const ADMIN_TOKEN = process.env.INSTANT_ADMIN_TOKEN;

if (!APP_ID || !ADMIN_TOKEN) {
  console.warn('Missing VITE_INSTANT_APP_ID or INSTANT_ADMIN_TOKEN in environment variables');
}

const db = init({ appId: APP_ID, adminToken: ADMIN_TOKEN });

// Known JustDial lead fields (used as "columns" for mapping)
const JUSTDIAL_COLUMNS = [
  'leadid', 'name', 'mobile', 'phone', 'email', 'date', 'time',
  'category', 'city', 'area', 'brancharea', 'company', 'pincode'
];

function applyMapping(incomingData, mapping, customMappings) {
  const lead = { custom: {} };

  // Process standard mappings
  Object.entries(mapping).forEach(([field, m]) => {
    let val = '';
    if (m.type === 'column') {
      // Try exact key, then case-insensitive lookup
      val = incomingData[m.value] != null
        ? String(incomingData[m.value])
        : '';
      if (!val) {
        const lowerKey = m.value.toLowerCase();
        const foundKey = Object.keys(incomingData).find(k => k.toLowerCase() === lowerKey);
        if (foundKey) val = String(incomingData[foundKey]);
      }
    } else if (m.type === 'fixed') {
      val = m.value || '';
    }

    // Phone sanitization
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

  // Process custom mappings
  if (customMappings && Array.isArray(customMappings)) {
    customMappings.forEach(m => {
      if (!m.field) return;
      let val = '';
      if (m.type === 'column') {
        val = incomingData[m.value] != null ? String(incomingData[m.value]) : '';
        if (!val) {
          const lowerKey = m.value.toLowerCase();
          const foundKey = Object.keys(incomingData).find(k => k.toLowerCase() === lowerKey);
          if (foundKey) val = String(incomingData[foundKey]);
        }
      } else if (m.type === 'fixed') {
        val = m.value || '';
      }
      lead.custom[m.field] = val;
    });
  }

  return lead;
}

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'OPTIONS,POST,GET');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  try {
    const userId = req.query?.userId || req.query?.ownerId || req.body?.userId || req.body?.ownerId;
    const configIndex = req.query?.configIndex != null ? parseInt(req.query.configIndex, 10) : 0;

    if (!userId) {
      return res.status(400).json({ success: false, message: 'Missing userId / ownerId parameter' });
    }

    // Fetch user profile
    const profileResponse = await db.query({
      userProfiles: { $: { where: { userId } } }
    });
    const profile = profileResponse.userProfiles?.[0];

    if (!profile) {
      return res.status(404).json({ success: false, message: 'User profile not found' });
    }

    const justdialConfigs = profile.justdial || [];
    if (justdialConfigs.length === 0) {
      return res.status(400).json({ success: false, message: 'No JustDial integration configured for this user' });
    }

    if (configIndex < 0 || configIndex >= justdialConfigs.length) {
      return res.status(400).json({ success: false, message: `configIndex ${configIndex} out of range (have ${justdialConfigs.length} configs)` });
    }

    const activeConfig = justdialConfigs[configIndex];
    if (activeConfig.disabled) {
      return res.status(200).json({ success: true, message: 'Sync skipped: Integration is disabled' });
    }

    const { mapping, customMappings } = activeConfig;
    if (!mapping) {
      return res.status(400).json({ success: false, message: 'Incomplete integration configuration (no mapping)' });
    }

    // ==================== POST: Receive webhook push ====================
    if (req.method === 'POST') {
      // JustDial may send a single lead or an array
      let leads = req.body?.leads || req.body;
      if (!Array.isArray(leads)) leads = [leads];

      // Fetch existing leads for dedup
      const leadsRes = await db.query({ leads: { $: { where: { userId } } } });
      const allLeads = leadsRes.leads || [];
      const emailSet = new Set(allLeads.filter(l => l.email).map(l => l.email.toLowerCase()));
      const phoneSet = new Set(allLeads.filter(l => l.phone).map(l => l.phone));
      const sourceIdSet = new Set(
        allLeads.filter(l => l.sourceLeadId).map(l => String(l.sourceLeadId))
      );

      let added = 0, skipped = 0, errors = 0;
      const txs = [];

      for (const incomingLead of leads) {
        try {
          const lead = applyMapping(incomingLead, mapping, customMappings);
          lead.userId = userId;
          lead.actorId = null;
          lead.createdAt = Date.now();
          const uniqueId = incomingLead.leadid || incomingLead.lead_id;
          if (uniqueId) lead.sourceLeadId = String(uniqueId);

          if (!lead.name || !lead.name.trim()) {
            lead.name = 'New Lead via JustDial';
          }

          // Triple-layer dedup: sourceLeadId (strongest) > email > phone
          const dupSource = lead.sourceLeadId && sourceIdSet.has(lead.sourceLeadId);
          const dupEmail = lead.email && emailSet.has(lead.email.toLowerCase());
          const dupPhone = lead.phone && phoneSet.has(lead.phone);

          if (dupSource || dupEmail || dupPhone) {
            const existingLead = allLeads.find(l =>
              (lead.email && l.email && l.email.toLowerCase() === lead.email.toLowerCase()) ||
              (lead.phone && l.phone && l.phone === lead.phone)
            );
            if (existingLead) {
              const logId = crypto.randomUUID();
              txs.push(
                db.tx.activityLogs[logId].update({
                  entityId: existingLead.id,
                  entityType: 'lead',
                  text: `Lead submitted again from JustDial.\nOriginal creation: ${new Date(existingLead.createdAt || Date.now()).toLocaleString()}\n**Resubmitted on: ${new Date().toLocaleString()}**`,
                  userId,
                  actorId: null,
                  userName: 'System (JustDial Webhook)',
                  createdAt: Date.now()
                }),
                db.tx.leads[existingLead.id].update({ updatedAt: Date.now() })
              );
            }
            skipped++;
            continue;
          }

          // Add to dedup sets
          if (lead.email) emailSet.add(lead.email.toLowerCase());
          if (lead.phone) phoneSet.add(lead.phone);
          if (lead.sourceLeadId) sourceIdSet.add(lead.sourceLeadId);

          const leadId = crypto.randomUUID();
          txs.push(db.tx.leads[leadId].update(lead));
          added++;
        } catch {
          errors++;
        }
      }

      // Flush all transactions in batches of 50
      if (txs.length > 0) {
        for (let i = 0; i < txs.length; i += 50) {
          await db.transact(txs.slice(i, i + 50));
        }
      }

      return res.status(200).json({
        success: true,
        message: `Processed: ${added} added, ${skipped} skipped, ${errors} errors`,
        added, skipped, errors
      });
    }

    // ==================== GET: Pull sync from JustDial API ====================
    if (req.method === 'GET' && req.query?.action === 'sync') {
      const apiKey = activeConfig.apiKey;
      if (!apiKey) {
        return res.status(400).json({ success: false, message: 'No API key configured for JustDial. Pull sync requires an API key.' });
      }

      try {
        // JustDial API endpoint — contact JustDial for your specific endpoint URL
        const apiUrl = `https://api.justdial.com/leads?key=${encodeURIComponent(apiKey)}`;
        const apiRes = await fetch(apiUrl);
        const apiData = await apiRes.json();

        let leads = apiData?.leads || apiData?.RESPONSE || [];
        if (!Array.isArray(leads)) leads = [];

        if (leads.length === 0) {
          return res.status(200).json({ success: true, message: 'No new leads found', added: 0, skipped: 0, total: 0 });
        }

        // Fetch existing leads for dedup
        const leadsRes = await db.query({ leads: { $: { where: { userId } } } });
        const allLeads = leadsRes.leads || [];
        const emailSet = new Set(allLeads.filter(l => l.email).map(l => l.email.toLowerCase()));
        const phoneSet = new Set(allLeads.filter(l => l.phone).map(l => l.phone));
        const sourceIdSet = new Set(
          allLeads.filter(l => l.sourceLeadId).map(l => String(l.sourceLeadId))
        );

        let added = 0, skipped = 0, errors = 0;
        const txs = [];

        for (const incomingLead of leads) {
          try {
            const lead = applyMapping(incomingLead, mapping, customMappings);
            lead.userId = userId;
            lead.actorId = null;
            lead.createdAt = Date.now();
            const uniqueId = incomingLead.leadid || incomingLead.lead_id;
            if (uniqueId) lead.sourceLeadId = String(uniqueId);

            if (!lead.name || !lead.name.trim()) {
              lead.name = 'New Lead via JustDial';
            }

            const dupSource = lead.sourceLeadId && sourceIdSet.has(lead.sourceLeadId);
            const dupEmail = lead.email && emailSet.has(lead.email.toLowerCase());
            const dupPhone = lead.phone && phoneSet.has(lead.phone);

            if (dupSource || dupEmail || dupPhone) {
              skipped++;
              continue;
            }

            if (lead.email) emailSet.add(lead.email.toLowerCase());
            if (lead.phone) phoneSet.add(lead.phone);
            if (lead.sourceLeadId) sourceIdSet.add(lead.sourceLeadId);

            const leadId = crypto.randomUUID();
            txs.push(db.tx.leads[leadId].update(lead));
            added++;
          } catch {
            errors++;
          }
        }

        if (txs.length > 0) {
          for (let i = 0; i < txs.length; i += 50) {
            await db.transact(txs.slice(i, i + 50));
          }
        }

        // Update lastSyncAt
        const updatedConfigs = justdialConfigs.map((c, i) =>
          i === configIndex ? { ...c, lastSyncAt: Date.now() } : c
        );
        await db.transact(db.tx.userProfiles[profile.id].update({ justdial: updatedConfigs }));

        return res.status(200).json({
          success: true,
          message: `Synced: ${added} added, ${skipped} skipped, ${errors} errors`,
          added, skipped, errors, total: leads.length
        });
      } catch (e) {
        console.error('JustDial Sync Error:', e);
        return res.status(500).json({ success: false, message: 'Failed to sync from JustDial API: ' + (e.message || String(e)) });
      }
    }

    return res.status(405).json({ success: false, message: 'Method Not Allowed' });

  } catch (error) {
    console.error('JustDial Webhook Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error processing JustDial webhook',
      error: error.message || String(error)
    });
  }
}
