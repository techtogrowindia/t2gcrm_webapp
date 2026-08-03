// Default lists for synchronization

// Normalize a person/assignee name: trim edges AND collapse internal runs of
// whitespace to a single space (so "Kanaka  Shree " -> "Kanaka Shree"). Keeps
// name-based assignment matching robust against stray/double spaces.
export const normalizeName = (s) => (s == null ? '' : String(s).trim().replace(/\s+/g, ' '));

export const DEFAULT_SOURCES = ['FB Ads', 'Direct', 'Broker', 'Google Ads', 'Referral', 'WhatsApp', 'Website', 'IndiaMART', 'JustDial', 'Other'];
export const DEFAULT_STAGES = ['New Enquiry', 'Enquiry Contacted', 'Quotation Created', 'Quotation Sent', 'Invoice Created', 'Invoice Sent', 'Budget Negotiation', 'Advance Paid', 'Won', 'Lost'];
export const DEFAULT_REQUIREMENTS = ['Hot', 'Warm', 'Cold', 'VIP', 'Pending'];
export const DEFAULT_PROD_CATS = ['Electronics', 'Home Appliances', 'Services', 'Furniture', 'General'];
export const DEFAULT_UNITS = ['Nos', 'Hours', 'Days', 'Months', 'Kgs', 'Ltrs', 'Meters', 'Other'];
export const SYSTEM_STAGES = ['Quotation Created', 'Quotation Sent', 'Invoice Created', 'Invoice Sent', 'Won'];

// Supported currencies for invoices/quotations
export const SUPPORTED_CURRENCIES = [
  { code: 'INR', symbol: '₹', name: 'Indian Rupee', locale: 'en-IN' },
  { code: 'USD', symbol: '$', name: 'US Dollar', locale: 'en-US' },
  { code: 'EUR', symbol: '€', name: 'Euro', locale: 'en-IE' },
  { code: 'GBP', symbol: '£', name: 'British Pound', locale: 'en-GB' },
  { code: 'AED', symbol: 'د.إ', name: 'UAE Dirham', locale: 'en-AE' },
  { code: 'SAR', symbol: '﷼', name: 'Saudi Riyal', locale: 'en-SA' },
  { code: 'SGD', symbol: 'S$', name: 'Singapore Dollar', locale: 'en-SG' },
  { code: 'AUD', symbol: 'A$', name: 'Australian Dollar', locale: 'en-AU' },
  { code: 'CAD', symbol: 'C$', name: 'Canadian Dollar', locale: 'en-CA' },
  { code: 'JPY', symbol: '¥', name: 'Japanese Yen', locale: 'ja-JP' },
  { code: 'CNY', symbol: '¥', name: 'Chinese Yuan', locale: 'zh-CN' },
  { code: 'ZAR', symbol: 'R', name: 'South African Rand', locale: 'en-ZA' },
];

export const currencySymbol = (code) =>
  SUPPORTED_CURRENCIES.find(c => c.code === code)?.symbol || '₹';

// Format currency — defaults to INR for backward compatibility
export const fmt = (n, currency = 'INR') => {
  const cfg = SUPPORTED_CURRENCIES.find(c => c.code === currency) || SUPPORTED_CURRENCIES[0];
  return new Intl.NumberFormat(cfg.locale, { style: 'currency', currency: cfg.code, minimumFractionDigits: 2 }).format(n || 0);
};

// Format date
export const fmtD = (d) => {
  if (!d) return '-';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};

// Format date and time
export const fmtDT = (d) => {
  if (!d) return '-';
  return new Date(d).toLocaleString('en-IN', { 
    day: '2-digit', 
    month: 'short', 
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  });
};

// Days left
export const daysLeft = (d) => Math.ceil((new Date(d) - new Date()) / (1000 * 60 * 60 * 24));

// Stage badge class
export const stageBadgeClass = (s, wonStage = 'Won') => {
  if (s === wonStage) return 'bg-green';
  const m = {
    'New Enquiry': 'bg-blue', 'Enquiry Contacted': 'bg-teal', 
    'Quotation Created': 'bg-gray', 'Quotation Sent': 'bg-purple', 
    'Invoice Created': 'bg-gray', 'Invoice Sent': 'bg-indigo',
    'Budget Negotiation': 'bg-yellow',
    'Advance Paid': 'bg-purple', 'Won': 'bg-green', 'Lost': 'bg-red',
    'In Progress': 'bg-blue', 'Planning': 'bg-teal', 'On Hold': 'bg-yellow', 'Completed': 'bg-green',
    'Paid': 'bg-green', 'Draft': 'bg-gray', 'Sent': 'bg-teal', 'Overdue': 'bg-red',
    'Active': 'bg-green', 'Expired': 'bg-red', 'Expiring Soon': 'bg-yellow',
    'Trial': 'bg-blue', 'Paused': 'bg-gray', 'Pending': 'bg-yellow',
    'Approved': 'bg-green', 'Rejected': 'bg-red', 'Success': 'bg-green', 'Failed': 'bg-red',
    'Open': 'bg-blue', 'Closed': 'bg-gray', 'Under Review': 'bg-yellow', 'Planned': 'bg-teal',
    'Cancelled': 'bg-gray', 'To Do': 'bg-gray', 'Review': 'bg-purple', 'Done': 'bg-green',
    'Created': 'bg-teal',
  };
  return m[s] || 'bg-gray';
};

export const prioBadgeClass = (p) => ({ High: 'bg-red', Medium: 'bg-yellow', Low: 'bg-green' }[p] || 'bg-gray');

// Generate a unique ID
export const uid = () => {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
};

// Generate next document number
export const nextNo = (prefix, count) => `${prefix}${new Date().getFullYear()}/${String(count).padStart(3, '0')}`;

// Tax options for line items
export const TAX_OPTIONS = [
  { label: 'None (0%)', rate: 0 },
  { label: 'GST 5%', rate: 5 },
  { label: 'GST 12%', rate: 12 },
  { label: 'GST 18%', rate: 18 },
  { label: 'GST 28%', rate: 28 },
  { label: 'IGST 5%', rate: 5 },
  { label: 'IGST 12%', rate: 12 },
  { label: 'IGST 18%', rate: 18 },
  { label: 'IGST 28%', rate: 28 },
];

// Get greeting based on time
export const getGreeting = () => {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
};

// Indian States List for GST calculation
export const INDIAN_STATES = [
  "Andaman and Nicobar Islands", "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", 
  "Chandigarh", "Chhattisgarh", "Dadra and Nagar Haveli and Daman and Diu", "Delhi", "Goa", 
  "Gujarat", "Haryana", "Himachal Pradesh", "Jammu and Kashmir", "Jharkhand", "Karnataka", 
  "Kerala", "Ladakh", "Lakshadweep", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya", 
  "Mizoram", "Nagaland", "Odisha", "Puducherry", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", 
  "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal"
];

// Official 2-digit GST state codes, keyed by the INDIAN_STATES names above.
// Used by the GST-format invoice/quote template to print the state code that
// Rule 46 requires alongside the state name and place of supply.
export const GST_STATE_CODES = {
  "Jammu and Kashmir": "01", "Himachal Pradesh": "02", "Punjab": "03",
  "Chandigarh": "04", "Uttarakhand": "05", "Haryana": "06", "Delhi": "07",
  "Rajasthan": "08", "Uttar Pradesh": "09", "Bihar": "10", "Sikkim": "11",
  "Arunachal Pradesh": "12", "Nagaland": "13", "Manipur": "14", "Mizoram": "15",
  "Tripura": "16", "Meghalaya": "17", "Assam": "18", "West Bengal": "19",
  "Jharkhand": "20", "Odisha": "21", "Chhattisgarh": "22", "Madhya Pradesh": "23",
  "Gujarat": "24", "Dadra and Nagar Haveli and Daman and Diu": "26",
  "Maharashtra": "27", "Karnataka": "29", "Goa": "30", "Lakshadweep": "31",
  "Kerala": "32", "Tamil Nadu": "33", "Puducherry": "34",
  "Andaman and Nicobar Islands": "35", "Telangana": "36", "Andhra Pradesh": "37",
  "Ladakh": "38",
};

const _normStateName = (s) => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();
const _GST_STATE_BY_NORM = Object.fromEntries(
  Object.entries(GST_STATE_CODES).map(([n, c]) => [_normStateName(n), c])
);

// 2-digit GST code for a state name (case/space-insensitive), or '' if unknown.
export function gstStateCode(name) {
  return _GST_STATE_BY_NORM[_normStateName(name)] || '';
}

// "Tamil Nadu (33)" when the code is known, else the raw name; '' for empty.
export function gstStateLabel(name) {
  const raw = String(name || '').trim();
  if (!raw) return '';
  const code = gstStateCode(raw);
  return code ? `${raw} (${code})` : raw;
}

// Common Countries
export const COUNTRIES = [
  "India", "United States", "United Kingdom", "Canada", "Australia", 
  "United Arab Emirates", "Singapore", "Malaysia", "Saudi Arabia", "Other"
];
export const numberToWords = (num, currency = 'INR') => {
  const currencyNames = {
    INR: { major: 'Indian Rupee', minor: 'Paise' },
    USD: { major: 'US Dollar', minor: 'Cents' },
    EUR: { major: 'Euro', minor: 'Cents' },
    GBP: { major: 'British Pound', minor: 'Pence' },
    AED: { major: 'UAE Dirham', minor: 'Fils' },
    SAR: { major: 'Saudi Riyal', minor: 'Halalas' },
    SGD: { major: 'Singapore Dollar', minor: 'Cents' },
    AUD: { major: 'Australian Dollar', minor: 'Cents' },
    CAD: { major: 'Canadian Dollar', minor: 'Cents' },
    JPY: { major: 'Japanese Yen', minor: 'Sen' },
    CNY: { major: 'Chinese Yuan', minor: 'Fen' },
    ZAR: { major: 'South African Rand', minor: 'Cents' },
  };
  const cur = currencyNames[currency] || currencyNames.INR;
  if (num === 0) return 'Zero';
  const a = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  
  const format = (n) => {
    if (n < 20) return a[n];
    if (n < 100) return b[Math.floor(n / 10)] + (n % 10 !== 0 ? ' ' + a[n % 10] : '');
    if (n < 1000) return a[Math.floor(n / 100)] + ' Hundred' + (n % 100 !== 0 ? ' and ' + format(n % 100) : '');
    return '';
  };

  const convert = (n) => {
    let res = '';
    if (n >= 10000000) {
      res += convert(Math.floor(n / 10000000)) + ' Crore ';
      n %= 10000000;
    }
    if (n >= 100000) {
      res += convert(Math.floor(n / 100000)) + ' Lakh ';
      n %= 100000;
    }
    if (n >= 1000) {
      res += convert(Math.floor(n / 1000)) + ' Thousand ';
      n %= 1000;
    }
    if (n > 0) {
      res += format(n);
    }
    return res.trim();
  };

  const [integer, decimal] = String(num).split('.');
  let result = cur.major + ' ' + convert(parseInt(integer)) + ' Only';
  if (decimal && parseInt(decimal) > 0) {
    result = cur.major + ' ' + convert(parseInt(integer)) + ' and ' + convert(parseInt(decimal)) + ' ' + cur.minor + ' Only';
  }
  return result;
};

export const getInvoiceStatus = (inv) => {
  if (!inv || !inv.status) return 'Draft';
  if (['Paid', 'Draft', 'Cancelled'].includes(inv.status)) return inv.status;
  
  if (inv.dueDate) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const due = new Date(inv.dueDate);
    due.setHours(0, 0, 0, 0);
    if (due < today) {
      return 'Overdue';
    }
  }
  return inv.status;
};

/**
 * Build a lead patch for an AUTOMATIC stage change, respecting the business's
 * disabled stages.
 *
 * Quotations and Invoices move a lead into 'Quotation Sent', 'Invoice Created'
 * and so on by themselves. If the business has switched that stage off in
 * Settings, the system must not put leads into it — doing so overrode an
 * explicit configuration, pulled the lead out of the pipeline its team works
 * from, and (because disabled stages are filtered out of reports) made the
 * lead vanish from analytics just as it became most valuable.
 *
 * Each transition is judged on its OWN target: disabling 'Quotation Sent'
 * doesn't stop 'Quotation Created' from applying. When every stage involved is
 * disabled, the lead simply keeps the stage it already has.
 *
 * Only the stage is withheld — any other fields (email/phone enrichment) still
 * apply, and the caller still writes its activity log, so nothing is lost.
 *
 * @param {string} targetStage      stage the system wants to set
 * @param {string[]} disabledStages profile.disabledStages
 * @param {object} [extra]          other fields to update regardless
 * @returns {{patch: object, changed: boolean}}
 */
export function autoStagePatch(targetStage, disabledStages, extra = {}) {
  const off = Array.isArray(disabledStages) && disabledStages.includes(targetStage);
  if (off) return { patch: { ...extra }, changed: false };
  return { patch: { ...extra, stage: targetStage, stageChangedAt: Date.now() }, changed: true };
}

/**
 * Keep a lead out of a stage the business has switched off in Settings.
 *
 * The stage dropdowns already exclude disabled stages, but CSV import maps a
 * `stage` column straight from the file, bulk actions pass a raw value, and
 * the API and webhooks write whatever they are given. Any of those could park
 * a lead in a disabled stage, where it disappears from reports — so the value
 * is checked at the point of WRITE rather than only in the picker.
 *
 * @param {string} stage           the stage being written
 * @param {string[]} disabledStages profile.disabledStages
 * @param {string} [fallback]      used when the requested stage is disabled;
 *                                 pass the lead's current stage to leave it
 *                                 where it is, or omit to drop the field
 * @returns {string|null} the stage to write, or null to write nothing
 */
export function sanitizeStage(stage, disabledStages, fallback) {
  if (!stage) return fallback ?? null;
  const off = Array.isArray(disabledStages) && disabledStages.includes(stage);
  if (!off) return stage;
  // Requested stage is disabled — keep the lead where it is rather than
  // silently moving it somewhere it will not be reported.
  if (fallback && !(Array.isArray(disabledStages) && disabledStages.includes(fallback))) return fallback;
  return null;
}

// Payment modes offered when recording a payment. A business list, so it is
// overridable via userProfiles.paymentModes — these are only the first-run
// defaults (CLAUDE.md "No Hardcoded Configuration").
export const DEFAULT_PAYMENT_MODES = ['Bank Transfer', 'Cash', 'UPI', 'Cheque', 'Card', 'Other'];

/**
 * Next payment receipt number for a business.
 *
 * Receipts are numbered in one sequence across every invoice, the way Zoho
 * does it — a receipt is a document in its own right, not a child of the
 * invoice it settles. Older payments were recorded with no number at all, so
 * the max is taken over whatever numbers exist and gaps are left alone rather
 * than renumbering history.
 *
 * @param {Array} invoices    every invoice for the business
 * @param {string} [prefix]   profile.payPrefix
 * @param {number} [startAt]  profile.payNextNum
 */
export function nextPaymentNo(invoices, prefix = 'PAY-', startAt = 1) {
  let max = 0;
  for (const inv of invoices || []) {
    const pays = Array.isArray(inv.payments) ? inv.payments : [];
    for (const p of pays) {
      const m = String(p?.no || '').match(/(\d+)\s*$/);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
  }
  const n = Math.max(Number(startAt) || 1, max + 1);
  return `${prefix}${String(n).padStart(3, '0')}`;
}

/**
 * Decide CGST+SGST vs IGST for a document.
 *
 * The split used to be worked out at PRINT time from whichever customer record
 * currently matched the client NAME. Two consequences, both bad on a tax
 * document: if no customer matched (a lead, a renamed client, a one-off sale)
 * the state was unknown and it silently fell through to CGST+SGST even on an
 * inter-state sale; and editing a customer's state later re-rendered an already
 * issued invoice with a different tax split.
 *
 * A GST invoice must be fixed at the moment it is issued, so placeOfSupply and
 * supplierState are stored ON the document. The live customer lookup is only a
 * fallback for documents saved before those fields existed.
 *
 * `known` is false when neither side can be established — the caller should say
 * so rather than presenting a confident split it cannot justify.
 */
export function resolveGstSplit(doc = {}, profile = {}, clientMatch = null) {
  const norm = (v) => String(v || '').trim().toLowerCase();
  const supplier = doc.supplierState || profile.bizState || '';
  const buyer = doc.placeOfSupply || clientMatch?.state || '';
  if (!norm(supplier) || !norm(buyer)) {
    // Unknown: keep the historical CGST+SGST presentation so nothing changes
    // shape unexpectedly, but report known:false so the UI can flag it.
    return { isInterState: false, supplier, buyer, known: false };
  }
  return { isInterState: norm(supplier) !== norm(buyer), supplier, buyer, known: true };
}
