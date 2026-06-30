import { id } from '@instantdb/react';
import { dbWrite, dbOp } from './dbWrite';

/**
 * Centralized activity logger. Call from any module's CRUD/status-change handlers.
 *
 * @param {Object} opts
 * @param {string} opts.entityType  - 'lead'|'customer'|'quotation'|'invoice'|'amc'|'project'|'task'|'appointment'|'expense'|'purchaseOrder'|'product'|'vendor'|'campaign'
 * @param {string} opts.entityId    - Record ID
 * @param {string} [opts.entityName] - Human-friendly label (e.g. "INV-2024-001", "Gokul Sxdac")
 * @param {string} opts.action      - 'created'|'edited'|'deleted'|'stage-change'|'status-change'|'sent'|'paid'|'converted'|'renewed'
 * @param {string} opts.text        - Display text. Use **bold** to highlight key values.
 * @param {string} opts.userId      - Owner/tenant userId (data isolation)
 * @param {Object} opts.user        - Auth user object ({ id, email })
 * @param {string|null} [opts.teamMemberId] - teamMembers.id when actor is a team member; null for owner
 * @param {Object} [opts.meta]      - Optional structured fields: { fromStage, toStage, amount, fromValue, toValue, ... }
 */
export async function logActivity(opts) {
  if (!opts || !opts.entityType || !opts.entityId || !opts.userId) {
    console.warn('[activityLogger] Missing required field', opts);
    return;
  }
  const payload = {
    entityType: opts.entityType,
    entityId: opts.entityId,
    entityName: opts.entityName || '',
    action: opts.action || 'edited',
    text: opts.text || '',
    userId: opts.userId,
    actorId: opts.user?.id || null,
    userName: opts.user?.email || '',
    teamMemberId: opts.teamMemberId || null,
    createdAt: Date.now(),
    ...(opts.meta || {}),
  };
  try {
    await dbWrite(dbOp.update('activityLogs', id(), payload));
  } catch (err) {
    console.error('[activityLogger] Failed to write activity log', err, payload);
  }
}

/**
 * Compute a human-readable diff text from old vs new lead/record.
 * Returns null if no meaningful changes detected.
 *
 * @param {Object} oldRec
 * @param {Object} newRec
 * @param {string[]} fields - Fields to track. Format: 'field' or { key: 'field', label: 'Display Name' }
 * @returns {string|null} e.g. "Phone (98765 → 99999), Stage (New → Won)"
 */
export function diffFields(oldRec, newRec, fields) {
  if (!oldRec || !newRec) return null;
  const parts = [];
  for (const f of fields) {
    const key = typeof f === 'string' ? f : f.key;
    const label = typeof f === 'string' ? key : f.label;
    const oldV = oldRec[key] ?? '';
    const newV = newRec[key] ?? '';
    if (String(oldV).trim() !== String(newV).trim()) {
      parts.push(`${label} (${oldV || '—'} → ${newV || '—'})`);
    }
  }
  return parts.length ? parts.join(', ') : null;
}
