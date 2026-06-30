import { init, id, tx } from '@instantdb/admin';
import { opU, runOpsByOwner, readData, readDataAll } from '../_write-ops.js';
import { getLeadsForOwner } from '../_leads-cache.js';

const APP_ID = process.env.VITE_INSTANT_APP_ID;
const ADMIN_TOKEN = process.env.INSTANT_ADMIN_TOKEN;

// ─────────────────────────────────────────────────────────────────────────────
// WhatsApp Lead Follow-up Reminder Cron
//
// Runs once per day (wired in server.mjs). Checks every lead across all
// workspaces. For each WhatsApp template with:
//   - autoTrigger === 'lead_followup'
//   - autoEnabled === true
//   - daysBeforeFollowup = N (default 1)
//
// Fires when Math.round((followupMs - todayMs) / 86400000) === N.
//
// Dedup key: wa-followup-<leadId>-<templateId>-<followupMs>-<N>
// so the same reminder fires ONCE per lead per follow-up date per milestone.
// If the follow-up date is updated (rescheduled), the new date fires fresh.
// ─────────────────────────────────────────────────────────────────────────────

const db = init({ appId: APP_ID, adminToken: ADMIN_TOKEN });

const fmtDate = (d) => {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()}`;
};

const fmtDateTime = (ms) => {
  const d = new Date(ms);
  return `${fmtDate(d)} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
};

const resolveDateVar = (varName) => {
  const today = new Date();
  if (varName === 'today')    return fmtDate(today);
  if (varName === 'tomorrow') { const d = new Date(today); d.setDate(d.getDate() + 1); return fmtDate(d); }
  const m = varName.match(/^\+(\d+)day$/i);
  if (m) { const d = new Date(today); d.setDate(d.getDate() + parseInt(m[1])); return fmtDate(d); }
  return null;
};

async function sendWaprochat(waApiToken, waPhoneId, templateId, phone, variables) {
  const formData = new URLSearchParams();
  formData.append('apiToken', waApiToken);
  formData.append('phone_number_id', waPhoneId);
  formData.append('template_id', templateId);
  formData.append('phone_number', phone);
  variables.forEach(v => {
    if (!v.name) return;
    formData.append(`templateVariable-${v.name}-${v.index}`, v.value || '');
  });
  const res = await fetch('https://portal.waprochat.in/api/v1/whatsapp/send/template', {
    method: 'POST', body: formData,
  });
  return res.json();
}

export default async function handler(req, res) {
  if (process.env.VITE_BLOCK_AUTOMATIONS === 'true') {
    return res.status(200).json({ success: true, message: 'Automations blocked' });
  }

  try {
    const { userProfiles } = await readDataAll(db, { userProfiles: {} });

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayMs = today.getTime();

    const txs = [];
    let sent = 0;
    let skipped = 0;

    for (const profile of userProfiles) {
      const ownerId = profile.userId;
      const waApiToken = profile.waApiToken?.trim();
      const waPhoneId  = profile.waPhoneId?.trim();
      if (!waApiToken || !waPhoneId) continue;

      // Find templates configured for lead_followup
      const followupTemplates = (profile.whatsappTemplates || []).filter(
        t => t.autoTrigger === 'lead_followup' && t.autoEnabled === true
      );
      if (!followupTemplates.length) continue;

      // Get all leads via shared cache (no extra DB call)
      const leads = await getLeadsForOwner(ownerId);
      const leadsWithFollowup = leads.filter(l => l.followup);

      // Team members — only fetched if a follow-up template targets the assignee
      let teamMembers = null;
      const needsAssignee = followupTemplates.some(t => t.recipientType === 'assignee');
      if (needsAssignee) {
        const r = await readData(db, ownerId, { teamMembers: { $: { where: { userId: ownerId } } } });
        teamMembers = r.teamMembers || [];
      }
      const resolveAssigneePhone = (lead) => {
        if (!teamMembers) return '';
        const m = teamMembers.find(t => t.name === lead.assign || (t.email && t.email === lead.assign));
        return m?.phone || '';
      };

      for (const lead of leadsWithFollowup) {
        // followup can be a number (ms) or date string — normalise
        const followupMs = typeof lead.followup === 'number'
          ? lead.followup
          : new Date(lead.followup).getTime();

        if (isNaN(followupMs)) continue;

        // Align to start-of-day for comparison
        const followupDay = new Date(followupMs);
        followupDay.setHours(0, 0, 0, 0);
        const daysLeft = Math.round((followupDay.getTime() - todayMs) / (1000 * 60 * 60 * 24));

        for (const tpl of followupTemplates) {
          const threshold = Number(tpl.daysBeforeFollowup) || 1;
          if (daysLeft !== threshold) continue;

          // Dedup key — unique per lead + template + followup timestamp + milestone
          const dedupeKey = `wa-followup-${lead.id}-${tpl.templateId}-${followupMs}-${threshold}`;

          const { executedAutomations } = await readData(db, ownerId, {
            executedAutomations: { $: { where: { id: dedupeKey } } },
          });
          if (executedAutomations?.length > 0) {
            skipped++;
            continue;
          }

          // Determine recipient phone
          const recipientType = tpl.recipientType || 'client';
          let rawPhone = '';
          if (recipientType === 'owner') {
            rawPhone = profile.waNotifPhone || profile.phone || '';
          } else if (recipientType === 'assignee') {
            // Send to the assigned staff member's phone (resolved from teamMembers)
            rawPhone = resolveAssigneePhone(lead);
          } else {
            rawPhone = lead.phone || '';
          }
          const phone = rawPhone.replace(/\D/g, '');
          if (!phone) {
            console.warn(`[WA-FOLLOWUP] No phone for lead "${lead.name}", skipping`);
            continue;
          }

          // Data object for variable resolution
          const leadData = {
            lead:          lead.name || '',
            client:        lead.name || '',
            phone:         lead.phone || '',
            leadphoneno:   lead.phone || '',
            clientphoneno: lead.phone || '',
            email:         lead.email || '',
            stage:         lead.stage || '',
            source:        lead.source || '',
            requirement:   lead.requirement || '',
            assignee:      lead.assign || '',
            followupdate:  fmtDateTime(followupMs),
            daysLeft:      String(Math.max(0, daysLeft)),
            date:          fmtDate(today),
            bizName:       profile.bizName || profile.businessName || '',
          };

          // Build variables from template body
          const normalVars = tpl.body?.match(/#([a-zA-Z_][a-zA-Z0-9_]*)#/g) || [];
          const dateVars   = tpl.body?.match(/#(\+\d+day)#/gi) || [];
          const variables = [...normalVars, ...dateVars]
            .filter(m => m !== '#phone#')
            .map((m, i) => {
              const varName = m.replace(/#/g, '');
              const dateVal = resolveDateVar(varName);
              return {
                index: i + 1,
                name: varName,
                value: dateVal !== null ? dateVal : (leadData[varName] ?? ''),
              };
            });

          try {
            const result = await sendWaprochat(waApiToken, waPhoneId, tpl.templateId, phone, variables);
            const success = result?.status === 'success';

            // Mark as sent
            txs.push(opU('executedAutomations', dedupeKey, {
              key: dedupeKey, userId: ownerId, createdAt: Date.now(),
            }));

            // Log to outbox
            txs.push(opU('outbox', id(), {
              userId: ownerId,
              recipient: phone,
              type: 'whatsapp',
              subject: `Follow-up Reminder — ${lead.name}`,
              content: `Template: ${tpl.name}\nBody: ${tpl.body}`,
              status: success ? 'Sent' : 'Failed',
              error: success ? null : (result?.message || 'Waprochat error'),
              sentAt: Date.now(),
            }));

            if (success) {
              sent++;
              console.log(`[WA-FOLLOWUP] ✅ Sent "${tpl.name}" to ${phone} — "${lead.name}" follow-up in ${daysLeft} day(s)`);
            } else {
              console.error(`[WA-FOLLOWUP] ❌ Failed "${tpl.name}" for lead "${lead.name}":`, result?.message);
            }
          } catch (err) {
            console.error(`[WA-FOLLOWUP] ❌ Error for lead "${lead.name}":`, err.message);
          }
        }
      }
    }

    if (txs.length > 0) await runOpsByOwner(db, txs);
    console.log(`[WA-FOLLOWUP] Done — sent: ${sent}, skipped (dedup): ${skipped}`);
    return res.status(200).json({ success: true, sent, skipped });
  } catch (err) {
    console.error('[WA-FOLLOWUP] Cron error:', err);
    return res.status(500).json({ error: err.message });
  }
}
