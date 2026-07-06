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
    wonStage: p.wonStage || allStages[allStages.length - 1] || 'Won',
    lostStage: p.lostStage || 'Lost',
  };
}

// Fetch the owner's profile and resolve the config (PG/InstantDB via readData).
export async function getLeadFormConfig(db, ownerId) {
  const { userProfiles } = await readData(db, ownerId, {
    userProfiles: { $: { where: { userId: ownerId } } },
  });
  return resolveLeadFormConfig(userProfiles?.[0] || {});
}

// Validate a lead payload's dropdown fields against the config. Returns an array
// of human-readable problems (empty = valid). Only NON-EMPTY fields are checked
// so optional fields can be omitted. `source` is normalised (Retailer →
// Channel Partners) to match the read path before checking.
export function validateLeadAgainstConfig(payload, cfg) {
  const problems = [];
  const inList = (v, list) => list.some(x => String(x).toLowerCase() === String(v).toLowerCase());

  if (payload.stage && !inList(payload.stage, cfg.stages)) {
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
