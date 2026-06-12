import { init } from '@instantdb/admin';
import { opU, runOps, readData } from '../_write-ops.js';

const APP_ID = process.env.VITE_INSTANT_APP_ID;
const ADMIN_TOKEN = process.env.INSTANT_ADMIN_TOKEN;

if (!APP_ID || !ADMIN_TOKEN) {
  console.warn('Missing VITE_INSTANT_APP_ID or INSTANT_ADMIN_TOKEN in environment variables');
}

const db = init({ appId: APP_ID, adminToken: ADMIN_TOKEN });

// Known IndiaMART API response fields (used as "columns" for mapping)
const INDIAMART_COLUMNS = [
  'SENDER_NAME', 'SENDER_EMAIL', 'SENDER_MOBILE', 'SENDER_COMPANY',
  'SENDER_ADDRESS', 'SENDER_CITY', 'SENDER_STATE', 'SENDER_PINCODE',
  'SUBJECT', 'QUERY_MESSAGE', 'QUERY_PRODUCT_NAME', 'QUERY_TIME',
  'UNIQUE_QUERY_ID', 'CALL_DURATION', 'RECEIVER_MOBILE'
];

function applyMapping(incomingData, mapping, customMappings, columns) {
  const lead = { custom: {} };

  // Process standard mappings
  Object.entries(mapping).forEach(([field, m]) => {
    let val = '';
    if (m.type === 'column') {
      // For IndiaMART, the "column" value is the field key in the incoming JSON
      val = incomingData[m.value] != null ? String(incomingData[m.value]) : '';
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
    // Accept either userId (legacy) or ownerId (new). Caller picks one.
    const userId = req.query?.userId || req.query?.ownerId || req.body?.userId || req.body?.ownerId;
    // Which config index to sync. Default 0 for backward compat with old webhook senders.
    const configIndex = req.query?.configIndex != null ? parseInt(req.query.configIndex, 10) : 0;

    if (!userId) {
      return res.status(400).json({ success: false, message: 'Missing userId / ownerId parameter' });
    }

    // Fetch user profile
    const profileResponse = await readData(db, userId, {
      userProfiles: { $: { where: { userId } } }
    });
    const profile = profileResponse.userProfiles?.[0];

    if (!profile) {
      return res.status(404).json({ success: false, message: 'User profile not found' });
    }

    const indiamartConfigs = profile.indiamart || [];
    if (indiamartConfigs.length === 0) {
      return res.status(400).json({ success: false, message: 'No IndiaMART integration configured for this user' });
    }
    if (configIndex < 0 || configIndex >= indiamartConfigs.length) {
      return res.status(400).json({ success: false, message: `configIndex ${configIndex} out of range (have ${indiamartConfigs.length} configs)` });
    }

    const activeConfig = indiamartConfigs[configIndex];
    if (activeConfig.disabled) {
      return res.status(200).json({ success: true, message: 'Sync skipped: Integration is disabled' });
    }

    const { mapping, customMappings, columns } = activeConfig;
    if (!mapping) {
      return res.status(400).json({ success: false, message: 'Incomplete integration configuration (no mapping)' });
    }

    // ==================== POST: Receive webhook push ====================
    if (req.method === 'POST') {
      // IndiaMART may send a single lead or an array of leads
      let leads = req.body?.RESPONSE || req.body?.leads || req.body;
      if (!Array.isArray(leads)) leads = [leads];

      // Fetch existing leads for dedup
      const leadsRes = await readData(db, userId, { leads: { $: { where: { userId } } } });
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
          const lead = applyMapping(incomingLead, mapping, customMappings, columns);
          lead.userId = userId;
          lead.actorId = null;
          lead.createdAt = Date.now();
          const uniqueId = incomingLead.UNIQUE_QUERY_ID || incomingLead.unique_query_id;
          if (uniqueId) lead.sourceLeadId = String(uniqueId);

          if (!lead.name || !lead.name.trim()) {
            lead.name = 'New Lead via IndiaMART';
          }

          // Triple-layer dedup: sourceLeadId (strongest) > email > phone
          const dupSource = lead.sourceLeadId && sourceIdSet.has(lead.sourceLeadId);
          const dupEmail = lead.email && emailSet.has(lead.email.toLowerCase());
          const dupPhone = lead.phone && phoneSet.has(lead.phone);

          if (dupSource || dupEmail || dupPhone) {
            // Find existing lead for activity log
            const existingLead = allLeads.find(l =>
              (lead.email && l.email && l.email.toLowerCase() === lead.email.toLowerCase()) ||
              (lead.phone && l.phone && l.phone === lead.phone)
            );
            if (existingLead) {
              const logId = crypto.randomUUID();
              txs.push(
                opU('activityLogs', logId, {
                  entityId: existingLead.id,
                  entityType: 'lead',
                  text: `Lead submitted again from IndiaMART.\nOriginal creation: ${new Date(existingLead.createdAt || Date.now()).toLocaleString()}\n**Resubmitted on: ${new Date().toLocaleString()}**`,
                  userId,
                  actorId: null,
                  userName: 'System (IndiaMART Webhook)',
                  createdAt: Date.now()
                }),
                opU('leads', existingLead.id, { updatedAt: Date.now() })
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
          txs.push(opU('leads', leadId, lead));
          added++;
        } catch {
          errors++;
        }
      }

      // Flush all writes (Postgres or InstantDB)
      await runOps(db, userId, txs);

      return res.status(200).json({
        success: true,
        message: `Processed: ${added} added, ${skipped} skipped, ${errors} errors`,
        added, skipped, errors
      });
    }

    // ==================== GET: Pull sync from IndiaMART API ====================
    if (req.method === 'GET' && req.query?.action === 'sync') {
      const apiKey = activeConfig.apiKey;
      if (!apiKey) {
        return res.status(400).json({ success: false, message: 'No API key configured for IndiaMART' });
      }

      // Manual sync: caller passes from_date/to_date → don't update lastSyncAt
      const isManualSync = !!(req.query.from_date && req.query.to_date);
      const syncDateRange = isManualSync
        ? { from: req.query.from_date, to: req.query.to_date }
        : null;

      try {
        // IndiaMART CRM Lead API
        const apiUrl = `https://mapi.indiamart.com/wservce/enquiry/listing/JEESSION_ID/KEY/${apiKey}/`;
        const maskedUrl = apiUrl.replace(apiKey, '***');
        const apiRes = await fetch(apiUrl);

        // Read as text first so we can include it in the diagnostic response
        // if IndiaMART returns HTML / error string instead of JSON
        const rawText = await apiRes.text();
        let apiData;
        try {
          apiData = JSON.parse(rawText);
        } catch (parseErr) {
          console.error('IndiaMART API returned non-JSON:', rawText.slice(0, 500));
          return res.status(200).json({
            success: false,
            message: 'IndiaMART API returned a non-JSON response. Check your API Key.',
            added: 0, skipped: 0, total: 0,
            diagnostic: { httpStatus: apiRes.status, responseSample: rawText.slice(0, 400), requestUrl: maskedUrl },
          });
        }

        let leads = apiData?.RESPONSE || apiData?.leads || [];
        if (!Array.isArray(leads)) leads = [];

        if (leads.length === 0) {
          const sample = JSON.stringify(apiData).slice(0, 400);
          return res.status(200).json({
            success: true,
            message: 'No new leads found',
            added: 0, skipped: 0, total: 0,
            diagnostic: {
              httpStatus: apiRes.status,
              apiResponseKeys: Object.keys(apiData || {}),
              apiResponseSample: sample,
              requestUrl: maskedUrl,
            },
          });
        }

        const successResponseSample = JSON.stringify(apiData).slice(0, 400);

        // Fetch existing leads for dedup
        const leadsRes = await readData(db, userId, { leads: { $: { where: { userId } } } });
        const allLeads = leadsRes.leads || [];
        const emailSet = new Set(allLeads.filter(l => l.email).map(l => l.email.toLowerCase()));
        const phoneSet = new Set(allLeads.filter(l => l.phone).map(l => l.phone));
        // sourceLeadId set — IndiaMART's UNIQUE_QUERY_ID. Bulletproof dedup:
        // even if phone/email change, the same UNIQUE_QUERY_ID = same enquiry.
        const sourceIdSet = new Set(
          allLeads.filter(l => l.sourceLeadId).map(l => String(l.sourceLeadId))
        );

        let added = 0, skipped = 0, errors = 0;
        const txs = [];

        for (const incomingLead of leads) {
          try {
            const lead = applyMapping(incomingLead, mapping, customMappings, columns);
            lead.userId = userId;
            lead.actorId = null;
            lead.createdAt = Date.now();
            // Record the source's unique ID for future syncs
            const uniqueId = incomingLead.UNIQUE_QUERY_ID || incomingLead.unique_query_id;
            if (uniqueId) lead.sourceLeadId = String(uniqueId);

            if (!lead.name || !lead.name.trim()) {
              lead.name = 'New Lead via IndiaMART';
            }

            // Triple-layer dedup: sourceLeadId (strongest) > email > phone
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
            txs.push(opU('leads', leadId, lead));
            added++;
          } catch {
            errors++;
          }
        }

        await runOps(db, userId, txs);

        // Update lastSyncAt only for auto sync (not manual date-range pulls)
        if (!isManualSync) {
          const updatedConfigs = indiamartConfigs.map((c, i) =>
            i === configIndex ? { ...c, lastSyncAt: Date.now() } : c
          );
          await runOps(db, userId, [opU('userProfiles', profile.id, { indiamart: updatedConfigs })]);
        }

        return res.status(200).json({
          success: true,
          message: `Synced: ${added} added, ${skipped} skipped, ${errors} errors`,
          added, skipped, errors, total: leads.length,
          ...(syncDateRange ? { dateRange: syncDateRange, isManualSync: true } : {}),
          diagnostic: {
            httpStatus: apiRes.status,
            requestUrl: maskedUrl,
            responseSample: successResponseSample,
            leadsReturned: leads.length,
          },
        });
      } catch (e) {
        console.error('IndiaMART Sync Error:', e);
        return res.status(500).json({ success: false, message: 'Failed to sync from IndiaMART API: ' + (e.message || String(e)) });
      }
    }

    return res.status(405).json({ success: false, message: 'Method Not Allowed' });

  } catch (error) {
    console.error('IndiaMART Webhook Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error processing IndiaMART webhook',
      error: error.message || String(error)
    });
  }
}
