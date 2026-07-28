// ===================================================================
// api/_lead-config.js — single source of truth for the business-defined
// lead-form dropdown lists (stages, sources, requirements, custom fields).
//
// Used by:
//   - api/lead-form-config.js  (mobile fetches the lists)
//   - api/data.js CREATE lead  (validates submitted values against the lists,
//     so leads can only be created with configured values, never free text)
//
// Keeping both on this module guarantees the fetch and the validation can
// never disagree.
// ===================================================================
import { readData } from './_write-ops.js';

// First-run defaults — mirror DEFAULT_* in src/utils/helpers.js.
export const DEFAULT_SOURCES = ['FB Ads', 'Direct', 'Broker', 'Google Ads', 'Referral', 'WhatsApp', 'Website', 'IndiaMART', 'JustDial', 'Other'];
export const DEFAULT_STAGES = ['New Enquiry', 'Enquiry Contacted', 'Quotation Created', 'Quotation Sent', 'Invoice Created', 'Invoice Sent', 'Budget Negotiation', 'Advance Paid', 'Won', 'Lost'];
export const DEFAULT_REQUIREMENTS = ['Hot', 'Warm', 'Cold', 'VIP', 'Pending'];

const nonEmpty = (v, fallback) => (Array.isArray(v) && v.length) ? v : fallback;

// Resolve the dropdown config from a userProfiles/accounts doc (pure).
export function resolveLeadFormConfig(p = {}) {
  const allStages = nonEmpty(p.stages, DEFAULT_STAGES);
  const base = nonEmpty(p.leadStages, allStages);
  const disabled = new Set(p.disabledStages || []);
  const stages = base.filter(s => !disabled.has(s));
  return {
    stages,
    sources: nonEmpty(p.sources, DEFAULT_SOURCES),
    requirements: nonEmpty(p.requirements, DEFAULT_REQUIREMENTS),
    productCats: Array.isArray(p.productCats) ? p.productCats : [],
    customFields: Array.isArray(p.customFields) ? p.customFields : [],
    // Falling straight back to the LAST stage is wrong: businesses append
    // stages over time, so the last one is usually whatever was added most
    // recently ("Subsidy", "Competitors", "Lost") rather than the winning one.
    // ARS had no wonStage set, so mobile counted its 6 "Subsidy" leads as won
    // and ignored the 129 actually in "Won", while the web read it correctly.
    // Look for a stage literally named Won first — same order as the web
    // (src/components/Reports/Reports.jsx) so the two can never disagree.
    wonStage: p.wonStage || allStages.find(s => /^won$/i.test(String(s).trim())) || allStages[allStages.length - 1] || 'Won',
    lostStage: p.lostStage || allStages.find(s => /^lost$/i.test(String(s).trim())) || 'Lost',
  };
}

// Fetch the owner's profile + team and resolve the config (PG/InstantDB via
// readData). `assignees` = this business's team member names, so the mobile
// lead form gets a per-business assignee dropdown from the same call (the
// dropdown lists here are ALL tenant-scoped by ownerId — nothing is shared
// across businesses).
export async function getLeadFormConfig(db, ownerId) {
  const { userProfiles, teamMembers } = await readData(db, ownerId, {
    userProfiles: { $: { where: { userId: ownerId } } },
    teamMembers: { $: { where: { userId: ownerId } } },
  });
  const cfg = resolveLeadFormConfig(userProfiles?.[0] || {});
  cfg.assignees = (teamMembers || [])
    .map(t => t.name)
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
  return cfg;
}

// Validate a lead payload's dropdown fields against the config. Returns an array
// of human-readable problems (empty = valid). Only NON-EMPTY fields are checked
// so optional fields can be omitted. `source` is normalised (Retailer →
// Channel Partners) to match the read path before checking.
export function validateLeadAgainstConfig(payload, cfg) {
  const problems = [];
  const inList = (v, list) => list.some(x => String(x).toLowerCase() === String(v).toLowerCase());

  // wonStage/lostStage are always valid targets even when hidden from the
  // visible kanban subset — the web moves leads there on Won/Lost, so the API
  // must accept them too.
  const allowedStages = [...cfg.stages, cfg.wonStage, cfg.lostStage].filter(Boolean);
  if (payload.stage && !inList(payload.stage, allowedStages)) {
    problems.push(`stage "${payload.stage}" is not an allowed stage`);
  }
  let source = payload.source;
  if (source === 'Retailer' || source === 'Retailers') source = 'Channel Partners';
  if (source && !inList(source, cfg.sources)) {
    problems.push(`source "${payload.source}" is not an allowed source`);
  }
  if (payload.requirement && !inList(payload.requirement, cfg.requirements)) {
    problems.push(`requirement "${payload.requirement}" is not an allowed requirement`);
  }
  return problems;
}

/**
 * Coerce a webhook-supplied stage to one the business actually uses.
 *
 * Integration payloads (IndiaMART, JustDial, TradeIndia, Google Sheets) are
 * mapped straight onto the lead — whatever the remote source sends lands in
 * `stage`. Those writes bypass the validation /api/data applies on create and
 * update, so an incoming value could be a stage the business has DISABLED, or
 * one that doesn't exist at all. Either way the lead is stranded: invisible in
 * reports, sitting outside the pipeline the team works from.
 *
 * Rejecting the lead would be worse than a wrong stage — an inbound enquiry
 * must never be dropped over a bad field. So the value is coerced to the
 * business's first enabled stage instead, and the caller notes the swap.
 *
 * @returns {{stage: string, coerced: boolean, from: string}}
 */
export function coerceLeadStage(stage, cfg) {
  const allowed = [...cfg.stages, cfg.wonStage, cfg.lostStage].filter(Boolean);
  const hit = allowed.find(s => String(s).toLowerCase() === String(stage || '').toLowerCase());
  if (hit) return { stage: hit, coerced: false, from: stage };
  const fallback = cfg.stages[0] || 'New';
  return { stage: fallback, coerced: !!stage, from: stage || '' };
}
