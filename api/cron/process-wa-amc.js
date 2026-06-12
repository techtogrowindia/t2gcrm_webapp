import { init, id, tx } from '@instantdb/admin';
import { opU, runOpsByOwner } from '../_write-ops.js';

const APP_ID = process.env.VITE_INSTANT_APP_ID;
const ADMIN_TOKEN = process.env.INSTANT_ADMIN_TOKEN;

// ─────────────────────────────────────────────────────────────────────────────
// WhatsApp AMC Expiry Reminder Cron (Option A)
//
// Runs once per day (wired in server.mjs). Checks every AMC across all
// workspaces. For each WhatsApp template with:
//   - autoTrigger === 'amc_expiry'
//   - autoEnabled === true
//   - daysBeforeExpiry = N (default 7)
//
// It fires the Waprochat API when Math.ceil((endDate - today) / 86400000) === N.
//
// Deduplication: executedAutomations keyed as
//   wa-amc-<amcId>-<templateId>-<endDate>-<N>
// so the same milestone (e.g. 7-day warning) fires exactly ONCE per AMC
// per endDate. If the AMC is renewed (new endDate) the new milestones fire fresh.
//
// This cron is separate from process-automations.js (email) so neither
// touches the other's logic.
// ─────────────────────────────────────────────────────────────────────────────

const db = init({ appId: APP_ID, adminToken: ADMIN_TOKEN });

// Shared date formatter DD/MM/YYYY
const fmtDate = (d) => {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()}`;
};

// Built-in date var resolver (mirrors messaging.js)
const resolveDateVar = (varName) => {
  const today = new Date();
  if (varName === 'today')    return fmtDate(today);
  if (varName === 'tomorrow') { const d = new Date(today); d.setDate(d.getDate() + 1); return fmtDate(d); }
  const m = varName.match(/^\+(\d+)day$/i);
  if (m) { const d = new Date(today); d.setDate(d.getDate() + parseInt(m[1])); return fmtDate(d); }
  return null;
};

// Send one WhatsApp template message via Waprochat
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
    method: 'POST',
    body: formData,
  });
  return res.json();
}

export default async function handler(req, res) {
  if (process.env.VITE_BLOCK_AUTOMATIONS === 'true') {
    return res.status(200).json({ success: true, message: 'Automations blocked' });
  }

  try {
    // Fetch all workspaces + their AMCs
    const { userProfiles, amc: allAmcs } = await db.query({
      userProfiles: {},
      amc: {},
    });

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const txs = [];
    let sent = 0;
    let skipped = 0;

    for (const profile of userProfiles) {
      const ownerId = profile.userId;
      const waApiToken = profile.waApiToken?.trim();
      const waPhoneId = profile.waPhoneId?.trim();
      if (!waApiToken || !waPhoneId) continue;

      // Find templates configured for amc_expiry
      const amcTemplates = (profile.whatsappTemplates || []).filter(
        t => t.autoTrigger === 'amc_expiry' && t.autoEnabled === true
      );
      if (!amcTemplates.length) continue;

      // Get this workspace's AMC contracts
      const amcs = (allAmcs || []).filter(a => a.userId === ownerId);
      if (!amcs.length) continue;

      for (const amc of amcs) {
        if (!amc.endDate || !amc.phone) continue;

        const end = new Date(amc.endDate);
        end.setHours(0, 0, 0, 0);
        const daysLeft = Math.round((end - today) / (1000 * 60 * 60 * 24));

        for (const tpl of amcTemplates) {
          const threshold = Number(tpl.daysBeforeExpiry) || 7;
          if (daysLeft !== threshold) continue; // only fire on exact milestone day

          // Dedup key — unique per AMC + template + endDate + milestone
          const dedupeKey = `wa-amc-${amc.id}-${tpl.templateId}-${amc.endDate}-${threshold}`;

          const { executedAutomations } = await db.query({
            executedAutomations: { $: { where: { id: dedupeKey } } },
          });
          if (executedAutomations?.length > 0) {
            skipped++;
            console.log(`[WA-AMC] ⏭️  Already sent: ${dedupeKey}`);
            continue;
          }

          // Resolve phone
          const recipientType = tpl.recipientType || 'client';
          const rawPhone = recipientType === 'owner'
            ? (profile.waNotifPhone || profile.phone || '')
            : (amc.phone || '');
          const phone = rawPhone.replace(/\D/g, '');
          if (!phone) {
            console.warn(`[WA-AMC] No phone for AMC ${amc.contractNo}, skipping`);
            continue;
          }

          // AMC data object for variable resolution
          const amcData = {
            client: amc.client || '',
            contractNo: amc.contractNo || '',
            endDate: amc.endDate || '',
            daysLeft: String(Math.max(0, daysLeft)),
            amount: amc.amount != null ? String(amc.amount) : '',
            plan: amc.plan || '',
            clientphoneno: amc.phone || '',
            leadphoneno: amc.phone || '',
            bizName: profile.bizName || profile.businessName || '',
            date: fmtDate(today),
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
                value: dateVal !== null ? dateVal : (amcData[varName] ?? ''),
              };
            });

          try {
            const result = await sendWaprochat(waApiToken, waPhoneId, tpl.templateId, phone, variables);
            const success = result?.status === 'success';

            // Mark as sent (dedup)
            txs.push(opU('executedAutomations', dedupeKey, {
              key: dedupeKey,
              userId: ownerId,
              createdAt: Date.now(),
            }));

            // Log to outbox
            txs.push(opU('outbox', id(), {
              userId: ownerId,
              recipient: phone,
              type: 'whatsapp',
              subject: `AMC Expiry Alert — ${amc.contractNo}`,
              content: `Template: ${tpl.name}\nBody: ${tpl.body}`,
              status: success ? 'Sent' : 'Failed',
              error: success ? null : (result?.message || 'Waprochat error'),
              sentAt: Date.now(),
            }));

            if (success) {
              sent++;
              console.log(`[WA-AMC] ✅ Sent "${tpl.name}" to ${phone} — AMC ${amc.contractNo} expires in ${daysLeft} days`);
            } else {
              console.error(`[WA-AMC] ❌ Failed "${tpl.name}" for ${amc.contractNo}:`, result?.message);
            }
          } catch (err) {
            console.error(`[WA-AMC] ❌ Error sending for AMC ${amc.contractNo}:`, err.message);
          }
        }
      }
    }

    if (txs.length > 0) await runOpsByOwner(db, txs);
    console.log(`[WA-AMC] Done — sent: ${sent}, skipped (dedup): ${skipped}`);
    return res.status(200).json({ success: true, sent, skipped });
  } catch (err) {
    console.error('[WA-AMC] Cron error:', err);
    return res.status(500).json({ error: err.message });
  }
}
