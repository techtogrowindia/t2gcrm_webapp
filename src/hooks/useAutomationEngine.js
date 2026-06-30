import { useEffect, useRef } from 'react';
import db from '../instant';
import { id } from '@instantdb/react';
import { renderTemplate, sendEmailMock, sendWhatsAppMock, sendWhatsApp, sendEmail } from '../utils/messaging';

/**
 * Calculates the delay offset in milliseconds from a delay config object.
 * Returns a NEGATIVE value when dir='before' so the engine fires early.
 * @param {{ value: number, unit: 'minutes'|'hours'|'days', dir?: 'immediately'|'after'|'before' }} delay
 */
const delayMs = (delay) => {
  if (!delay || !delay.value || delay.dir === 'immediately') return 0;
  const multipliers = { minutes: 60 * 1000, hours: 60 * 60 * 1000, days: 24 * 60 * 60 * 1000 };
  const ms = (delay.value || 0) * (multipliers[delay.unit] || 0);
  return delay.dir === 'before' ? -ms : ms;
};

const STALE_THRESHOLD = 24 * 60 * 60 * 1000; // Skip if due more than 24h ago


/**
 * Resolves a lead field value for condition matching.
 * Supports nested custom fields via "custom.FieldName" notation.
 */
const getLeadField = (lead, fieldId) => {
  if (!lead || !fieldId) return '';
  if (fieldId.startsWith('custom.')) {
    const cfName = fieldId.replace('custom.', '');
    return (lead.custom || {})[cfName] || '';
  }
  return lead[fieldId] || '';
};

/**
 * Returns true if the lead matches ALL conditions defined on the automation.
 * Supports operators: 'is', 'is not', 'contains'.
 */
const matchesConditions = (flow, lead) => {
  if (!flow.conditions || flow.conditions.length === 0) return true;
  return flow.conditions.every(cond => {
    const fieldVal = (getLeadField(lead, cond.field) || '').toLowerCase();
    const condVal  = (cond.value || '').toLowerCase();
    if (cond.op === 'is')       return fieldVal === condVal;
    if (cond.op === 'is not')   return fieldVal !== condVal;
    if (cond.op === 'contains') return fieldVal.includes(condVal);
    return true;
  });
};


export default function useAutomationEngine(user, ownerId) {
  // All data subscriptions disabled — server-side cron handles automations.
  // Removed leads (11k+) and all other queries to eliminate performance impact.
  const { data } = db.useQuery(null);

  const leads      = data?.leads      || [];
  const amc        = data?.amc        || [];
  const automations = data?.automations || [];
  const campaigns  = data?.campaigns  || [];
  const profile    = data?.userProfiles?.[0] || {};
  const executed    = data?.executedAutomations || [];
  const appts       = data?.appointments || [];
  const orders      = data?.orders || [];

  // Fallback reminders from profile settings (used for AMC days threshold)
  const reminders = profile.reminders || {
    amc:     { days: 30, msg: 'Hello {client}, your AMC contract is expiring on {date}.' },
    followup:{ days: 1,  msg: 'Reminder: Follow-up with {client} is scheduled on {date}.' },
  };

  // Track processed trigger+flow pairs to avoid re-firing
  const processedRef = useRef(new Set());

  // Poll every minute for time-based/delayed automations (Optional, kept for future use if needed)
  useEffect(() => {
    const interval = setInterval(() => {
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    // Client-side automation execution is DISABLED.
    // All automations are now handled by the server-side cron job (/api/cron/process-automations).
    console.log('[Automation] Client-side engine is idle. Server-side cron is active.');
  }, [leads, amc, automations, campaigns, appts, orders, user, profile, reminders]);
}
