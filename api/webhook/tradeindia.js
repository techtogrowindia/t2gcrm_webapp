import { init } from '@instantdb/admin';

const APP_ID = process.env.VITE_INSTANT_APP_ID;
const ADMIN_TOKEN = process.env.INSTANT_ADMIN_TOKEN;

if (!APP_ID || !ADMIN_TOKEN) {
  console.warn('Missing VITE_INSTANT_APP_ID or INSTANT_ADMIN_TOKEN in environment variables');
}

const db = init({ appId: APP_ID, adminToken: ADMIN_TOKEN });

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

    const tradeindiaConfigs = profile.tradeindia || [];
    if (tradeindiaConfigs.length === 0) {
      return res.status(400).json({ success: false, message: 'No TradeIndia integration configured for this user' });
    }

    if (configIndex < 0 || configIndex >= tradeindiaConfigs.length) {
      return res.status(400).json({ success: false, message: `configIndex ${configIndex} out of range (have ${tradeindiaConfigs.length} configs)` });
    }

    const activeConfig = tradeindiaConfigs[configIndex];
    if (activeConfig.disabled) {
      return res.status(200).json({ success: true, message: 'Sync skipped: Integration is disabled' });
    }

    const { mapping, customMappings } = activeConfig;
    if (!mapping) {
      return res.status(400).json({ success: false, message: 'Incomplete integration configuration (no mapping)' });
    }

    // ==================== POST: Receive webhook push ====================
    if (req.method === 'POST') {
      // TradeIndia may send a single lead or an array of leads
      let leads = req.body?.leads || req.body?.RESPONSE || req.body;
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
          const uniqueId = incomingLead.inquiry_id || incomingLead.INQUIRY_ID;
          if (uniqueId) lead.sourceLeadId = String(uniqueId);

          if (!lead.name || !lead.name.trim()) {
            lead.name = 'New Lead via TradeIndia';
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
                db.tx.activityLogs[logId].update({
                  entityId: existingLead.id,
                  entityType: 'lead',
                  text: `Lead submitted again from TradeIndia.\nOriginal creation: ${new Date(existingLead.createdAt || Date.now()).toLocaleString()}\n**Resubmitted on: ${new Date().toLocaleString()}**`,
                  userId,
                  actorId: null,
                  userName: 'System (TradeIndia Webhook)',
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

    // ==================== GET: Pull sync from TradeIndia API ====================
    if (req.method === 'GET' && req.query?.action === 'sync') {
      const { tiUserId, profileId: tiProfileId, apiKey } = activeConfig;
      if (!tiUserId || !tiProfileId || !apiKey) {
        return res.status(400).json({ success: false, message: 'Incomplete TradeIndia API credentials (need User ID, Profile ID, and API Key)' });
      }

      try {
        // TradeIndia My Inquiry API.
        // Required params: userid, profile_id, key, from_date, to_date (YYYY-MM-DD).
        // Without from_date/to_date TradeIndia returns:
        //   "Sorry! Please provide all the required parameters."
        // Manual sync: caller passes from_date/to_date as query params → use directly,
        //   don't update lastSyncAt (it's a targeted re-pull, not an auto-checkpoint).
        // Auto sync: compute window from lastSyncAt (or last 30 days), update lastSyncAt.
        const isManualSync = !!(req.query.from_date && req.query.to_date);
        let fromDate, toDate;
        if (isManualSync) {
          fromDate = req.query.from_date;
          toDate = req.query.to_date;
        } else {
          const fmtDate = (ts) => {
            const d = new Date(ts);
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
          };
          const now = Date.now();
          const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000;
          const fromTs = activeConfig.lastSyncAt
            ? Math.max(activeConfig.lastSyncAt, now - THIRTY_DAYS)
            : (now - THIRTY_DAYS);
          fromDate = fmtDate(fromTs);
          toDate = fmtDate(now);
        }

        const apiUrl =
          `https://www.tradeindia.com/utils/my_inquiry.html` +
          `?userid=${encodeURIComponent(tiUserId)}` +
          `&profile_id=${encodeURIComponent(tiProfileId)}` +
          `&key=${encodeURIComponent(apiKey)}` +
          `&from_date=${encodeURIComponent(fromDate)}` +
          `&to_date=${encodeURIComponent(toDate)}`;
        const apiRes = await fetch(apiUrl);

        // Read as text first so we can include it in the diagnostic response
        // if TradeIndia returns HTML / error string instead of JSON
        const rawText = await apiRes.text();
        let apiData;
        try {
          apiData = JSON.parse(rawText);
        } catch (parseErr) {
          console.error('TradeIndia API returned non-JSON:', rawText.slice(0, 500));
          return res.status(200).json({
            success: false,
            message: 'TradeIndia API returned a non-JSON response. Check your User ID / Profile ID / API Key.',
            added: 0, skipped: 0, total: 0,
            diagnostic: {
              httpStatus: apiRes.status,
              responseSample: rawText.slice(0, 400),
              requestUrl: apiUrl.replace(apiKey, '***'),  // mask the key for safety
              dateRange: { from: fromDate, to: toDate },
            },
          });
        }

        // TradeIndia typically returns an array of inquiry objects
        let leads = Array.isArray(apiData)
          ? apiData
          : (apiData?.leads || apiData?.RESPONSE || apiData?.inquiries || apiData?.data || []);
        if (!Array.isArray(leads)) leads = [];

        if (leads.length === 0) {
          // Return what TradeIndia actually sent so you can see if it's an
          // auth error / empty payload / unrecognised format.
          const sample = JSON.stringify(apiData).slice(0, 400);
          return res.status(200).json({
            success: true,
            message: 'No new leads found',
            added: 0, skipped: 0, total: 0,
            diagnostic: {
              httpStatus: apiRes.status,
              apiResponseKeys: Object.keys(apiData || {}),
              apiResponseSample: sample,
              requestUrl: apiUrl.replace(apiKey, '***'),
              dateRange: { from: fromDate, to: toDate },
            },
          });
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
            const uniqueId = incomingLead.inquiry_id || incomingLead.INQUIRY_ID;
            if (uniqueId) lead.sourceLeadId = String(uniqueId);

            if (!lead.name || !lead.name.trim()) {
              lead.name = 'New Lead via TradeIndia';
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

        // Update lastSyncAt only for auto sync (not manual date-range pulls)
        if (!isManualSync) {
          const updatedConfigs = tradeindiaConfigs.map((c, i) =>
            i === configIndex ? { ...c, lastSyncAt: Date.now() } : c
          );
          await db.transact(db.tx.userProfiles[profile.id].update({ tradeindia: updatedConfigs }));
        }

        return res.status(200).json({
          success: true,
          message: `Synced: ${added} added, ${skipped} skipped, ${errors} errors`,
          added, skipped, errors, total: leads.length,
          dateRange: { from: fromDate, to: toDate },
          isManualSync,
        });
      } catch (e) {
        console.error('TradeIndia Sync Error:', e);
        return res.status(500).json({ success: false, message: 'Failed to sync from TradeIndia API: ' + (e.message || String(e)) });
      }
    }

    return res.status(405).json({ success: false, message: 'Method Not Allowed' });

  } catch (error) {
    console.error('TradeIndia Webhook Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error processing TradeIndia webhook',
      error: error.message || String(error)
    });
  }
}
