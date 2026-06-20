import { init } from '@instantdb/admin';
import { opU, runOps, readData } from '../_write-ops.js';

// Initialize InstantDB Admin SDK
// We must use the Admin SDK for backend/serverless environments
const APP_ID = process.env.VITE_INSTANT_APP_ID;
const ADMIN_TOKEN = process.env.INSTANT_ADMIN_TOKEN;

if (!APP_ID || !ADMIN_TOKEN) {
  console.warn('Missing VITE_INSTANT_APP_ID or INSTANT_ADMIN_TOKEN in environment variables');
}

const db = init({ appId: APP_ID, adminToken: ADMIN_TOKEN });

export default async function handler(req, res) {
  // CORS configuration for webhook receiver
  res.setHeader('Access-Control-Allow-Credentials', true)
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'OPTIONS,POST')
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version')

  // Handle preflight OPTIONS request
  if (req.method === 'OPTIONS') {
    res.status(200).end()
    return
  }

  // Ensure this is a POST request
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method Not Allowed' });
  }

  try {
    const { userId, actorId, type, data } = req.body;

    // Validate payload
    if (!userId || !data || !Array.isArray(data)) {
      return res.status(400).json({ success: false, message: 'Invalid payload structure' });
    }

    // 1. Fetch the user's profile to get their Google Sheets mapping configuration
    console.log(`Fetching profile for user: ${userId}`);
    const profileResponse = await readData(db, userId, {
      userProfiles: {
        $: { where: { userId: userId } }
      }
    });

    const profile = profileResponse.userProfiles?.[0];
    
    if (!profile) {
      return res.status(404).json({ success: false, message: 'User profile not found' });
    }

    // 2. Find the active Google Sheets integration mapping
    const gsheetsConfig = profile.gsheets;
    const gsheetsDisabled = profile.gsheetsDisabled === true;

    if (gsheetsDisabled) {
      console.log(`Sync skipped for user ${userId}: Global gsheetsDisabled flag is set.`);
      return res.status(200).json({ success: true, message: 'Sync skipped: Integration is globally disabled' });
    }

    if (!gsheetsConfig || gsheetsConfig.length === 0) {
      return res.status(400).json({ success: false, message: 'No active Google Sheets mapping found for this user' });
    }

    // Use the first active mapping (or could be enhanced to match a specific sheetId passes in payload)
    const activeConfig = gsheetsConfig[0];
    const { mapping, customMappings, columns, disabled } = activeConfig;

    if (disabled === true) {
      console.log(`Sync skipped for user ${userId}: Individual integration is disabled.`);
      return res.status(200).json({ success: true, message: 'Sync skipped: This specific integration is disabled' });
    }

    if (!mapping || !columns) {
      return res.status(400).json({ success: false, message: 'Incomplete integration configuration' });
    }

    console.log(`Processing lead with ${columns.length} expected columns`);

    // 3. Construct the lead object based on the mapping and incoming data
    // Generate a unique ID for the new lead
    const leadId = crypto.randomUUID();
    
    const lead = {
      id: leadId,
      userId: userId,
      actorId: actorId || null,
      createdAt: Date.now(),
      custom: {}
    };

    // Process standard mappings
    Object.entries(mapping).forEach(([field, m]) => {
      let val = '';
      if (m.type === 'column') {
        const idx = columns.indexOf(m.value);
        if (idx !== -1 && idx < data.length) {
          val = data[idx];
        }
      } else if (m.type === 'fixed') {
        val = m.value;
      }

      // Format/sanitize specific fields perfectly
      if (field === 'phone' && val) {
        const str = String(val);
        const hasPlus = str.includes('+');
        const digits = str.replace(/[^0-9]/g, '');
        val = (hasPlus ? '+' : '') + digits;
      }

      // Add to core fields or custom fields container
      if (['name', 'email', 'phone', 'source', 'stage', 'label', 'notes', 'followup'].includes(field)) {
        lead[field] = val;
      } else {
        lead.custom[field] = val;
      }
    });

    // Process extended custom mappings
    if (customMappings && Array.isArray(customMappings)) {
      customMappings.forEach(m => {
        if (!m.field) return;
        let val = '';
        if (m.type === 'column') {
          const idx = columns.indexOf(m.value);
          if (idx !== -1 && idx < data.length) {
            val = data[idx];
          }
        } else if (m.type === 'fixed') {
          val = m.value;
        }
        lead.custom[m.field] = val;
      });
    }

    // Fallback if name mapping fails
    if (!lead.name) lead.name = 'New Lead via webhooks';

    console.log('Constructed Payload:', JSON.stringify(lead, null, 2));

    let existingLead = null;
    if (lead.email || lead.phone) {
      // Find matching existing lead
      const leadsRes = await readData(db, userId, {
        leads: { $: { where: { userId: userId } } }
      });
      const allLeads = leadsRes.leads || [];
      existingLead = allLeads.find(l => 
        (lead.email && l.email && l.email.toLowerCase() === lead.email.toLowerCase()) || 
        (lead.phone && l.phone && l.phone === lead.phone)
      );
    }

    const txs = [];
    if (existingLead) {
      const logId = crypto.randomUUID();
      const createDateStr = new Date(existingLead.createdAt || Date.now()).toLocaleString();
      
      txs.push(
        opU('activityLogs', logId, {
          entityId: existingLead.id,
          entityType: 'lead',
          text: `Lead submitted again from Google Sheets.\nOriginal creation date: ${createDateStr}\n**Resubmitted on: ${new Date().toLocaleString()}**`,
          userId: userId,
          actorId: actorId || null,
          userName: 'System (Webhook)',
          createdAt: Date.now()
        }),
        opU('leads', existingLead.id, { updatedAt: Date.now() })
      );
      console.log(`Lead already exists (${existingLead.id}). Added activity log instead.`);
    } else {
      // Create-with-assignee → stamp assignedAt so dated "assigned" reports count it
      if ((lead.assign || '').trim()) lead.assignedAt = lead.createdAt;
      txs.push(opU('leads', leadId, lead));
      console.log(`Successfully added lead ${leadId} for user ${userId}`);
    }

    // 4. Save the lead or activity log directly into InstantDB using the Admin SDK
    await runOps(db, userId, txs);

    // Return success response to Apps Script
    return res.status(200).json({ 
      success: true, 
      message: existingLead ? 'Lead already exists, added log' : 'Lead processed and added to CRM',
      leadId: existingLead ? existingLead.id : leadId
    });

  } catch (error) {
    console.error('Webhook Error:', error);
    return res.status(500).json({ 
      success: false, 
      message: 'Internal server error processing webhook',
      error: error.message || String(error)
    });
  }
}
