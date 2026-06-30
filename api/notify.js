import { createRequire } from 'module';
const require = createRequire(import.meta.url);
import { init, tx, id as generateId } from '@instantdb/admin';
import nodemailer from 'nodemailer';
import crypto from 'crypto';
import { rawQuery, tenantQuery } from './db-pg.js';
import { opU, runOps, USE_PG_DATA } from './_write-ops.js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const env = req.env || process.env;
    const APP_ID = env.VITE_INSTANT_APP_ID;
    const ADMIN_TOKEN = env.INSTANT_ADMIN_TOKEN;
    const { type, to, subject, body, message, ownerId, fromName, smtpConfig, processedKey } = req.body || {};

    if (!to || (!body && !message) || !ownerId) return res.status(400).json({ error: 'Missing required fields' });

    // --- LEGACY BLOCK & DEDUPLICATION GUARD ---
    // If the request doesn't have a processedKey, it's from an OLD UNREFRESHED TAB.
    // We strictly block these to stop the "Duplicate Storm".
    if (!processedKey && !type) {
      console.log(`[NOTIFY] 🛡️ Blocked Legacy Request from unrefreshed tab (Recipient: ${to})`);
      return res.status(200).json({ success: true, skipped: true, message: 'Legacy request blocked. Please refresh your browser tabs.' });
    }

    const db = init({ appId: APP_ID, adminToken: ADMIN_TOKEN });

    // Generate a stable UUID from the processedKey (if provided) or a hash of content
    const baseKey = processedKey || `${ownerId}-${to}-${subject}`;
    const minuteWindow = Math.floor(Date.now() / (60 * 1000));
    const dedupeKeyString = `notify-v2-${baseKey}-${minuteWindow}`;
    
    const dedupeId = crypto.createHash('md5').update(dedupeKeyString).digest('hex');
    const dedupeUUID = `${dedupeId.slice(0,8)}-${dedupeId.slice(8,12)}-${dedupeId.slice(12,16)}-${dedupeId.slice(16,20)}-${dedupeId.slice(20,32)}`;

    let alreadySent = false;
    if (USE_PG_DATA) {
      const r = await tenantQuery(ownerId, 'SELECT id FROM executed_automations WHERE id = $1', [dedupeUUID]);
      alreadySent = r.rows.length > 0;
    } else {
      const { executedAutomations } = await db.query({ executedAutomations: { $: { where: { id: dedupeUUID } } } });
      alreadySent = executedAutomations?.length > 0;
    }

    if (alreadySent) {
      console.log(`[NOTIFY] 🛡️ Dedupe: Skipping duplicate notification (ID: ${dedupeUUID})`);
      return res.status(200).json({ success: true, skipped: true, message: 'Duplicate blocked by server-side guard' });
    }

    await runOps(db, ownerId, [opU('executedAutomations', dedupeUUID, {
      key: dedupeKeyString,
      userId: ownerId,
      createdAt: Date.now()
    })]);
    // ------------------------------------------------

    const profile = USE_PG_DATA
      ? (await rawQuery('SELECT doc FROM accounts WHERE id = $1', [ownerId])).rows[0]?.doc
      : (await db.query({ userProfiles: { $: { where: { userId: ownerId }, limit: 1 } } })).userProfiles?.[0];

    if (type === 'whatsapp') {
      const waApiToken = profile?.waApiToken;
      const waPhoneId = profile?.waPhoneId;
      const { templateId, variables } = req.body || {};

      if (!waApiToken || !waPhoneId) return res.status(400).json({ error: 'WhatsApp not configured' });
      
      const phone = to.replace(/\D/g, '');
      const formattedPhone = phone.startsWith('91') ? `+${phone}` : phone.length === 10 ? `+91${phone}` : `+${phone}`;

      if (templateId) {
        const formData = new URLSearchParams();
        formData.append('apiToken', waApiToken);
        formData.append('phone_number_id', waPhoneId);
        formData.append('template_id', templateId);
        formData.append('phone_number', formattedPhone);
        
        if (variables && Array.isArray(variables)) {
          variables.forEach(v => {
            // variables are built with `name` not `field` — use name with field as fallback
            const key = v.name || v.field;
            if (!key) return;
            formData.append(`templateVariable-${key}-${v.index}`, v.value || '');
          });
        }

        const response = await fetch('https://portal.waprochat.in/api/v1/whatsapp/send/template', {
          method: 'POST',
          body: formData
        });
        const data = await response.json();
        // Waprochat returns status:"1" or status:"success" on success,
        // and includes wa_message_id. Accept both forms.
        const success = response.ok && (
          data.status === 'success' ||
          data.status === '1' ||
          data.status === 1 ||
          !!data.wa_message_id
        );
        const tplIdForLog = req.body?.templateId || templateId;
        const rawBody = req.body?.body || req.body?.message || `Template: ${tplIdForLog}`;

        // Resolve #variable# placeholders in the body so the log shows actual
        // values (e.g. "Hi SWATHI" not "Hi #client#")
        let resolvedBody = rawBody;
        if (variables && Array.isArray(variables)) {
          variables.forEach(v => {
            if (v.name && v.value != null) {
              resolvedBody = resolvedBody.replace(new RegExp(`#${v.name}#`, 'g'), v.value);
            }
          });
        }

        // On failure store the full Waprochat response for debugging
        const errorDetail = success
          ? null
          : (typeof data === 'object'
              ? JSON.stringify(data)
              : String(data || 'Waprochat error'));

        // Log to outbox (both success and failure) — server is the sole logger
        await runOps(db, ownerId, [opU('outbox', generateId(), {
          userId: ownerId,
          recipient: formattedPhone,
          type: 'whatsapp',
          subject: `WhatsApp Template: ${tplIdForLog}`,
          content: resolvedBody,
          status: success ? 'Sent' : 'Failed',
          error: errorDetail,
          sentAt: Date.now(),
        })]);

        if (success) return res.status(200).json({ success: true, messageId: data.message_id });
        return res.status(400).json({ error: data.message || 'Waprochat template fail', detail: data });
      } else {
        return res.status(400).json({ error: 'Template ID required for WhatsApp' });
      }
    }

    // Default: Email
    let host = smtpConfig?.smtpHost || profile?.smtpHost;
    let port = parseInt(smtpConfig?.smtpPort || profile?.smtpPort || '587');
    let user = smtpConfig?.smtpUser || profile?.smtpUser;
    let pass = smtpConfig?.smtpPass || profile?.smtpPass;
    let biz = smtpConfig?.bizName || profile?.bizName || fromName || '';

    if (!host || !user || !pass) return res.status(400).json({ error: 'SMTP not configured' });

    const transporter = nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass }, tls: { rejectUnauthorized: false } });
    const info = await transporter.sendMail({ from: biz ? `"${biz}" <${user}>` : user, to, subject: subject || 'Notification', text: body || message, html: (body || message).replace(/\n/g, '<br/>') });
    
    // Log to Outbox for UI visibility
    await runOps(db, ownerId, [opU('outbox', generateId(), {
      userId: ownerId,
      recipient: to,
      type: 'email',
      subject: subject || 'Notification',
      content: body || message,
      status: 'Sent',
      sentAt: Date.now()
    })]);

    return res.status(200).json({ success: true, messageId: info.messageId });

  } catch (err) {
    console.error('Notify API error:', err);
    
    // Attempt to log failure to outbox if we have enough info
    try {
      if (db && ownerId && to) {
        await runOps(db, ownerId, [opU('outbox', generateId(), {
          userId: ownerId,
          recipient: to,
          type: type === 'whatsapp' ? 'whatsapp' : 'email',
          subject: type === 'whatsapp' ? `WhatsApp Template: ${req.body?.templateId || ''}` : (subject || 'Notification'),
          content: body || message || req.body?.body || '',
          status: 'Failed',
          error: err.message,
          sentAt: Date.now()
        })]);
      }
    } catch (logErr) {
      console.error('Failed to log error to outbox:', logErr);
    }

    return res.status(500).json({ error: err.message });
  }
}
