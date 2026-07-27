import { useMemo } from 'react';

/**
 * Hook to enforce plan-based module access and record limits.
 *
 * @param {Object} profile  - The owner's userProfile (contains `plan` name string)
 * @param {Object} settings - Global settings from App.jsx (contains `plans` array)
 * @returns {Object|null}   - Plan enforcement helpers, or null if data not ready
 */

// Mapping from sidebar nav-item id → plan module key
const VIEW_TO_MODULE = {
  leads: 'leads',
  customers: 'customers',
  quotations: 'quotations',
  invoices: 'invoices',
  // A receipt only exists against an invoice, so it rides the same plan module
  // and permission rather than introducing one nobody has enabled.
  'payments-received': 'invoices',
  pos: 'pos',
  amc: 'amc',
  expenses: 'expenses',
  products: 'products',
  vendors: 'vendors',
  'purchase-orders': 'purchaseOrders',
  projects: 'projects',
  alltasks: 'tasks',
  teams: 'teams',
  campaigns: 'campaigns',
  reports: 'reports',
  automation: 'automation',
  'ecom-settings': 'ecommerce',
  'ecom-orders': 'ecommerce',
  appointments: 'appointments',
  integrations: 'integrations',
  'messaging-logs': 'messagingLogs',
  performance: 'reports',
  distributors: 'distributors',
  distributor_performance: 'distributors',
  'call-logs': 'callLogs',
  'attendance': 'attendance',
};

// Always-allowed views (never blocked by plan)
const ALWAYS_ALLOWED = ['dashboard', 'userprofile', 'settings', 'admin', 'apidocs', 'manual', 'appointment-settings', 'wa-guide'];

export function usePlanEnforcement(profile, settings) {
  return useMemo(() => {
    if (!profile) return null;

    const planName = profile.plan || 'Trial';
    const allPlans = settings?.plans || [];
    const activePlan = allPlans.find(p => p.name === planName);

    // If no plan found in settings (old data / superadmin), allow everything
    if (!activePlan) {
      return {
        planName,
        isModuleEnabled: () => true,
        getLimit: () => -1,
        isWithinLimit: () => true,
        isViewAllowed: () => true,
        modules: null,
        limits: null,
      };
    }

    const modules = activePlan.modules || null; // null = all enabled (legacy)
    const limits = activePlan.limits || {};

    /**
     * Check if a plan module is enabled.
     * @param {string} moduleKey - e.g. 'leads', 'invoices', 'ecommerce'
     * @returns {boolean}
     */
    const isModuleEnabled = (moduleKey) => {
      if (!modules) return true; // Legacy plan without modules field at all = all enabled (e.g. fallback plans)
      // Plan's module list is authoritative: a module is enabled only if the
      // plan explicitly sets it to `true`. Missing keys are treated as
      // disabled — this is what the admin expects when they assign a plan
      // with only 9 modules ticked. Previously we used `!== false`, which
      // meant any module added after the plan was created (so absent from the
      // saved object) appeared enabled, leaking features across plans.
      return modules[moduleKey] === true;
    };

    /**
     * Get the numeric limit for a limit key.
     * @param {string} limitKey - e.g. 'maxLeads', 'maxUsers'
     * @returns {number} -1 means unlimited
     */
    const getLimit = (limitKey) => {
      const val = limits[limitKey];
      if (val !== undefined && val !== null) return +val;
      // Fallback: legacy/fallback plans store limits at top level (e.g. plan.maxLeads)
      const topVal = activePlan[limitKey];
      if (topVal !== undefined && topVal !== null) return +topVal;
      return -1; // No limit = unlimited
    };

    /**
     * Check if current count is within the plan limit.
     * @param {string} limitKey - e.g. 'maxLeads'
     * @param {number} currentCount - current number of records
     * @returns {boolean}
     */
    const isWithinLimit = (limitKey, currentCount) => {
      const limit = getLimit(limitKey);
      if (limit === -1) return true; // Unlimited
      return currentCount < limit;
    };

    /**
     * Check if a sidebar view/route is allowed by the plan.
     * @param {string} viewId - e.g. 'leads', 'ecom-settings', 'pos'
     * @returns {boolean}
     */
    const isViewAllowed = (viewId) => {
      if (ALWAYS_ALLOWED.includes(viewId)) return true;
      const moduleKey = VIEW_TO_MODULE[viewId];
      if (!moduleKey) return true; // Unknown view = allow (safety)
      return isModuleEnabled(moduleKey);
    };

    return {
      planName,
      isModuleEnabled,
      getLimit,
      isWithinLimit,
      isViewAllowed,
      modules,
      limits,
    };
  }, [profile, settings]);
}
