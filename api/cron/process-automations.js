import { init, id, tx } from '@instantdb/admin';
import { opU, runOpsByOwner, readDataAll } from '../_write-ops.js';
import nodemailer from 'nodemailer';
import crypto from 'crypto';

// Shared helper — send one Waprochat template message.
// Used by both this file (Option B) and process-wa-amc.js (Option A).
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

const APP_ID = process.env.VITE_INSTANT_APP_ID;
const ADMIN_TOKEN = process.env.INSTANT_ADMIN_TOKEN;

if (!APP_ID || !ADMIN_TOKEN) {
  throw new Error('Missing environment variables: VITE_INSTANT_APP_ID or INSTANT_ADMIN_TOKEN');
}

const db = init({ appId: APP_ID, adminToken: ADMIN_TOKEN });

const generateId = () => crypto.randomUUID();

export default async function handler(req, res) {
  // --- MASTER SERVER SHIELD ---
  if (process.env.VITE_BLOCK_AUTOMATIONS === 'true') {
    console.log('[CRON] 🛡️ Automations are BLOCKED on this environment.');
    return res.status(200).json({ success: true, message: 'Automations blocked' });
  }

  // --- AUTOMATION TRIGGERS ---
  const { userProfiles, automations, leads, amcProfiles, appointments, ecommerceOrders } = await readDataAll(db, {
    userProfiles: { $: { where: { role: 'owner' } } },
    automations: { $: { where: { active: true } } },
    leads: { $: { where: { type: 'trig-stage' } } },
    amcProfiles: { $: { where: { type: 'trig-amc' } } },
    appointments: { $: { where: { type: 'trig-appt' } } },
    ecommerceOrders: { $: { where: { type: 'trig-ecom' } } }
  });

  const txs = [];
  console.log(`[CRON] Processing ${automations.length} active automations...`);

  for (const profile of userProfiles) {
    const ownerId = profile.userId;
    const biz = profile.businessName;
    const user = profile.emailUser;
    const pass = profile.emailPass;
    const host = profile.emailHost;
    const port = parseInt(profile.emailPort);

    if (!user || !pass || !host) continue;

    const myAutomations = automations.filter(a => a.userId === ownerId);
    if (!myAutomations.length) continue;

    const transporter = nodemailer.createTransport({
      host, port, secure: port === 465,
      auth: { user, pass },
      tls: { rejectUnauthorized: false }
    });

    for (const flow of myAutomations) {
      let entities = [];
      if (flow.triggerType === 'stage-change') entities = leads.filter(l => l.userId === ownerId && l.stageId === flow.triggerValue).map(e => ({ ...e, _table: 'leads' }));
      else if (flow.triggerType === 'amc-expiry') entities = amcProfiles.filter(p => p.userId === ownerId && p.daysToExpiry <= (flow.triggerValue || 0)).map(e => ({ ...e, _table: 'amcs' }));
      else if (flow.triggerType === 'new-appt') entities = appointments.filter(a => a.userId === ownerId && a.status === 'scheduled').map(e => ({ ...e, _table: 'appointments' }));
      else if (flow.triggerType === 'ecom-order') entities = ecommerceOrders.filter(o => o.userId === ownerId && o.status === 'confirmed').map(e => ({ ...e, _table: 'ecommerceOrders' }));

      for (const entity of entities) {
        const dedupeId = `${flow.id}-${entity.id}`;
        if (entity.processedAutomations?.includes(flow.id)) continue;

        try {
          // --- SEND EMAIL ---
          const recipientEmail = entity.email;
          if (!recipientEmail) continue;

          const subject = flow.subject.replace('{{name}}', entity.name);
          const body = flow.body.replace('{{name}}', entity.name);

          await transporter.sendMail({
            from: biz ? `"${biz}" <${user}>` : user,
            to: recipientEmail,
            subject,
            html: body.replace(/\n/g, '<br/>')
          });

          // --- LOGS (Unified Messaging Logs - Old Format Style) ---
          // Format based on User Screenshot Step 998 & Ground Truth Logs:
          // 🤖 [Auto] 🔄 Name has moved to stage: Stage. Assigned to: .
          const detail = `🔄 ${entity.name || 'Entity'} has moved to stage: ${flow.triggerValue}. Assigned to: ${entity.assignedTo || '.'}`;
          const cleanSubject = `Status Changed: ${entity.name || 'Entity'}`;

          txs.push(opU('outbox', id(), {
            userId: ownerId,
            recipient: recipientEmail,
            type: 'email',
            subject: cleanSubject, 
            content: `Subject: ${cleanSubject}\n\n${detail}`,
            status: 'Sent',
            sentAt: Date.now()
          }));

          // Mark as processed
          const currentProcessed = entity.processedAutomations || [];
          txs.push(opU(entity._table, entity.id, {
            processedAutomations: [...currentProcessed, flow.id], userId: ownerId
          }));

          txs.push(opU('activityLogs', id(), {
            userId: ownerId,
            text: `🤖 [Auto-Cron] Processed automation: ${flow.name} for ${entity.name}`,
            createdAt: Date.now()
          }));

          // ── Option B: also fire WhatsApp if the profile has matching templates ──
          // Only for amc-expiry email automations — fire alongside the email.
          if (flow.triggerType === 'amc-expiry') {
            const waApiToken = profile.waApiToken?.trim();
            const waPhoneId  = profile.waPhoneId?.trim();
            const entityPhone = entity.phone?.replace(/\D/g, '');
            if (waApiToken && waPhoneId && entityPhone) {
              const amcWaTpls = (profile.whatsappTemplates || []).filter(
                t => t.autoTrigger === 'amc_expiry' && t.autoEnabled === true
              );
              for (const tpl of amcWaTpls) {
                try {
                  const amcData = {
                    client: entity.client || entity.name || '',
                    contractNo: entity.contractNo || '',
                    endDate: entity.endDate || '',
                    daysLeft: String(entity.daysToExpiry || 0),
                    amount: entity.amount != null ? String(entity.amount) : '',
                    plan: entity.plan || '',
                    clientphoneno: entityPhone,
                    bizName: biz || '',
                    date: new Date().toLocaleDateString('en-GB').replace(/\//g, '/'),
                  };
                  const normalVars = tpl.body?.match(/#([a-zA-Z_][a-zA-Z0-9_]*)#/g) || [];
                  const variables  = normalVars
                    .filter(m => m !== '#phone#')
                    .map((m, i) => {
                      const n = m.replace(/#/g, '');
                      return { index: i + 1, name: n, value: amcData[n] ?? '' };
                    });
                  const recipientPhone = (tpl.recipientType === 'owner')
                    ? (profile.waNotifPhone || profile.phone || '').replace(/\D/g, '')
                    : entityPhone;
                  if (!recipientPhone) continue;

                  const waResult = await sendWaprochat(waApiToken, waPhoneId, tpl.templateId, recipientPhone, variables);
                  const ok = waResult?.status === 'success';
                  txs.push(opU('outbox', id(), {
                    userId: ownerId, recipient: recipientPhone, type: 'whatsapp',
                    subject: `AMC Expiry — ${entity.contractNo || entity.name}`,
                    content: `Template: ${tpl.name}\nBody: ${tpl.body}`,
                    status: ok ? 'Sent' : 'Failed',
                    error: ok ? null : (waResult?.message || 'Waprochat error'),
                    sentAt: Date.now(),
                  }));
                  console.log(`[CRON-WA] ${ok ? '✅' : '❌'} "${tpl.name}" for ${entity.name}`);
                } catch (waErr) {
                  console.error(`[CRON-WA] Error sending WA for ${entity.name}:`, waErr.message);
                }
              }
            }
          }

        } catch (err) {
          console.error(`[CRON] Workflow failure (${flow.name}):`, err);
        }
      }
    }
  }

  if (txs.length > 0) await runOpsByOwner(db, txs);
  return res.status(200).json({ success: true, processed: txs.length });
}
