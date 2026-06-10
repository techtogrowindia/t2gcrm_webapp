import db from '../instant';
import { id } from '@instantdb/react';

/**
 * Replaces placeholders in a template string with actual data.
 * @param {string} template - e.g. "Hello {client}, your bill for {amount} is due on {date}"
 * @param {object} data - { client, date, amount, bizName, ... }
 */
export const renderTemplate = (template, data = {}) => {
  if (!template) return '';
  let msg = template;
  const placeholders = {
    '{client}': data.client || data.name || 'Customer',
    '{date}': data.date || new Date().toLocaleDateString('en-IN'),
    '{amount}': data.amount ? `₹${data.amount.toLocaleString()}` : '',
    '{bizName}': data.bizName || '',
    '{invoiceNo}': data.invoiceNo || '',
    '{contractNo}': data.contractNo || '',
    '{email}': data.email || '',
    '{phone}': data.phone || '',
    '{stage}': data.stage || '',
    '{source}': data.source || '',
    '{assignee}': data.assignee || data.assign || '',
    '{followupDate}': data.followupDate || data.followup || '',
  };

  Object.entries(placeholders).forEach(([key, val]) => {
    msg = msg.replaceAll(key, val);
  });

  return msg;
};

/**
 * Logs a message to the Outbox collection
 */
const logToOutbox = async (userId, type, recipient, content, metadata = {}) => {
  const outboxId = id();
  await db.transact(db.tx.outbox[outboxId].update({
    userId,
    type, // 'email' | 'whatsapp'
    recipient,
    content,
    status: metadata.status || 'Sent',
    sentAt: Date.now(),
    ...metadata
  })).catch(e => console.error("Outbox logging failed", e));
  
  console.log(`🚀 [Outbox] ${type.toUpperCase()} sent to ${recipient}:`, content);
};

/**
 * Sends an email via the Nodemailer serverless function at /api/send-email.
 * @param {string} to - recipient email
 * @param {string} subject
 * @param {string} body
 * @param {string} ownerId - used to fetch SMTP config from DB when no smtpConfig is provided
 * @param {string} bizName
 * @param {string} userId - for outbox logging
 * @param {object} [smtpConfig] - optional: pass raw SMTP creds to skip DB lookup (e.g. for "Test Connection")
 */
export const sendEmail = async (to, subject, body, ownerId, bizName, userId, smtpConfig = null) => {
  if (!ownerId && !smtpConfig) {
    throw new Error("Missing ownerId or smtpConfig for email sending.");
  }

  try {
    const payload = { to, subject, body, fromName: bizName || '' };
    if (smtpConfig) {
      payload.smtpConfig = smtpConfig; // bypass DB lookup
    } else {
      payload.ownerId = ownerId;
    }

    const resp = await fetch('/api/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, type: 'email' })
    });

    const data = await resp.json();

    if (resp.ok && data.success) {
      if (userId) await logToOutbox(userId, 'email', to, `Subject: ${subject}\n\n${body}`, { status: 'Sent' });
      return 'OK';
    } else {
      throw new Error(data.error || 'Failed to send email');
    }
  } catch (err) {
    const errMsg = err.message || JSON.stringify(err);
    if (userId) await logToOutbox(userId, 'email', to, `Subject: ${subject}\n\n${body}`, { status: 'Failed', error: errMsg });
    throw new Error(errMsg);
  }
};

export const sendEmailMock = async (userId, to, subject, body, metadata = {}) => {
  await logToOutbox(userId, 'email', to, `Subject: ${subject}\n\n${body}`, metadata);
};

/**
 * Sends a WhatsApp message via Meta Cloud API through /api/send-whatsapp.
 * Signature updated to use ownerId for server-side token fetching.
 */
export const sendWhatsApp = async (to, message, ownerId, userId) => {
  if (!ownerId) {
    throw new Error("Missing ownerId for WhatsApp message.");
  }

  try {
    const payload = { to, message, ownerId, type: 'whatsapp' };
    if (typeof message === 'object' && message.templateId) {
      payload.templateId = message.templateId;
      payload.variables = message.variables;
      payload.message = message.body || 'Template Message';
    }

    const resp = await fetch('/api/notify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await resp.json();

    if (resp.ok && data.success) {
      const content = typeof message === 'object' ? `Template: ${message.name || message.templateId}\nBody: ${message.body}` : message;
      if (userId) await logToOutbox(userId, 'whatsapp', to, content, { status: 'Sent', templateId: message?.templateId });
      return 'OK';
    } else {
      throw new Error(data.error || 'Failed to send WhatsApp message');
    }
  } catch (err) {
    const errMsg = err.message || JSON.stringify(err);
    const content = typeof message === 'object' ? `Template: ${message.name || message.templateId}` : message;
    if (userId) await logToOutbox(userId, 'whatsapp', to, content, { status: 'Failed', error: errMsg });
    throw new Error(errMsg);
  }
};

export const sendWhatsAppMock = async (userId, to, body, metadata = {}) => {
  await logToOutbox(userId, 'whatsapp', to, body, metadata);
};

/**
 * Auto-trigger event types for WhatsApp template notifications.
 */
export const AUTO_TRIGGER_EVENTS = [
  { value: '', label: 'None (Manual Only)' },
  // Leads
  { value: 'lead_created', label: 'Lead Created' },
  { value: 'lead_stage_changed', label: 'Lead Stage Changed' },
  { value: 'lead_assigned', label: 'Lead Assigned to Staff' },
  { value: 'customer_created', label: 'Lead Converted to Customer' },
  // Finance
  { value: 'quotation_created', label: 'Quotation Created' },
  { value: 'invoice_created', label: 'Invoice Created' },
  { value: 'payment_received', label: 'Payment Received' },
  // Operations
  { value: 'appointment_booked', label: 'Appointment Booked' },
  { value: 'task_assigned', label: 'Task Assigned to Staff' },
  { value: 'amc_expiry', label: 'AMC Expiry Alert' },
  // E-commerce
  { value: 'order_placed', label: 'Order Placed (E-commerce)' },
];

/**
 * Fires WhatsApp notifications for all templates that have autoEnabled=true
 * and match the given eventType.
 *
 * @param {string} eventType - e.g. 'invoice_created', 'appointment_booked'
 * @param {object} data - Variables to substitute: { client, phone, invoiceNo, amount, date, bizName, ... }
 * @param {object} profile - The userProfile object (contains whatsappTemplates, waApiToken, waPhoneId)
 * @param {string} ownerId - The business owner's userId
 */
// ─── Date variable resolution ─────────────────────────────────────────────────
// Resolves built-in date tokens at send time (IST-aware):
//   #today#      → today's date  e.g. 10/06/2026
//   #tomorrow#   → tomorrow      e.g. 11/06/2026
//   #+1day#      → today + 1 day
//   #+7day#      → today + 7 days  (any positive integer)
const _fmtDate = (d) => {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getFullYear()}`;
};
const resolveDateVar = (varName) => {
  const today = new Date();
  if (varName === 'today')    return _fmtDate(today);
  if (varName === 'tomorrow') { const d = new Date(today); d.setDate(d.getDate() + 1); return _fmtDate(d); }
  const m = varName.match(/^\+(\d+)day$/i);
  if (m) { const d = new Date(today); d.setDate(d.getDate() + parseInt(m[1])); return _fmtDate(d); }
  return null; // not a date var
};

export const fireAutoNotifications = async (eventType, data, profile, ownerId) => {
  if (!profile || !ownerId || !eventType) return;

  const templates = profile.whatsappTemplates || [];
  const matching = templates.filter(t => t.autoTrigger === eventType && t.autoEnabled === true);

  if (matching.length === 0) return;

  // Must have WhatsApp credentials configured
  const hasCredentials = !!(profile.waApiToken?.trim() && profile.waPhoneId?.trim());
  if (!hasCredentials) {
    console.warn(`[AutoNotify] WhatsApp credentials not configured. Skipping ${matching.length} template(s) for event: ${eventType}`);
    return;
  }

  for (const tpl of matching) {
    try {
      // Determine recipient phone based on template's recipientType:
      //   'owner'  → send to the WhatsApp Notification Number (profile.waNotifPhone),
      //              falling back to profile.phone then data.ownerPhone
      //   'client' → send to the client/lead phone from the event data (default)
      const recipientType = tpl.recipientType || 'client';
      const rawPhone = recipientType === 'owner'
        ? (profile.waNotifPhone || profile.phone || data.ownerPhone || '')
        : (data.phone || '');

      const phone = rawPhone.replace(/\D/g, '');
      if (!phone) {
        console.warn(`[AutoNotify] No phone number for recipientType="${recipientType}" on event: ${eventType}. Skipping "${tpl.name}".`);
        continue;
      }

      // Build variables from template body using #variable# syntax.
      // Also handles built-in date tokens: #today#, #tomorrow#, #+Nday#.
      // Exclude #phone# — it is the recipient field (phone_number), not a
      // template variable. Sending it as templateVariable-phone-N too would
      // duplicate it and confuse Waprochat.
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
            value: dateVal !== null ? dateVal : (data[varName] ?? ''),
          };
        });

      const message = {
        templateId: tpl.templateId,
        name: tpl.name,
        body: tpl.body,
        variables,
      };

      // Stable processedKey so the server dedup guard works correctly
      const processedKey = `wa-auto-${ownerId}-${eventType}-${tpl.templateId}-${phone}-${data.entityId || data.invoiceno || data.apptDate || Date.now()}`;

      const resp = await fetch('/api/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: phone,
          message: message.body || 'Template Message',
          ownerId,
          type: 'whatsapp',
          templateId: message.templateId,
          variables: message.variables,
          processedKey,
          body: message.body, // needed for dedup fallback
        }),
      });

      const result = await resp.json();
      if (result?.skipped) {
        console.log(`[AutoNotify] ⏭️ Skipped duplicate "${tpl.name}" for event: ${eventType}`);
      } else if (resp.ok && result?.success) {
        console.log(`[AutoNotify] ✅ Sent "${tpl.name}" to ${phone} for event: ${eventType}`);
        // Server-side (notify.js) logs to outbox — do NOT log again here
      } else {
        console.error(`[AutoNotify] ❌ Failed "${tpl.name}" for event: ${eventType}`, result?.error);
      }
    } catch (err) {
      console.error(`[AutoNotify] ❌ Failed to send "${tpl.name}" for event: ${eventType}`, err);
    }
  }
};
