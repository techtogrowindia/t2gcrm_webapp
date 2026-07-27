// ===================================================================
// api/_shared-dates.js — one tolerant date parser, shared by browser and server.
//
// Finance records don't all store dates the same way. Most writers use
// 'YYYY-MM-DD', but api/ecom/checkout.js wrote epoch milliseconds, and a couple
// of hand-entered expenses carry typo'd years like '52026-09-15'. Passing any
// of those to `new Date()` yields Invalid Date, and the usual range check
//
//     d >= from && d <= to
//
// is FALSE for Invalid Date — so those rows silently vanished from every
// date-filtered report. Not wrong totals; missing rows, which is much harder to
// notice. On production that was 8 invoices and 5 expenses absent from P&L, GST
// and Revenue by Source.
//
// Parsing here is deliberately forgiving about FORM and strict about PLAUSIBILITY:
// accept whatever shape the value arrives in, but reject a year that cannot be
// real so a typo can't drag a record into the far future.
// ===================================================================

const MIN_YEAR = 2000;
const MAX_YEAR = 2100;

/**
 * Parse a stored date value into epoch ms, or null if it can't be trusted.
 *
 * Handles: Date, epoch number, epoch numeric string, 'YYYY-MM-DD',
 * 'YYYY-MM-DDTHH:mm[:ss]', and typo'd years with extra leading digits
 * ('52026-09-15' -> 2026-09-15).
 *
 * @param {*} v
 * @param {{ endOfDay?: boolean }} [opts] date-only values resolve to 00:00
 *        local by default; endOfDay resolves them to 23:59:59.999 instead.
 * @returns {number|null}
 */
export function parseDateValue(v, opts = {}) {
  if (v == null || v === '') return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v.getTime();

  // Epoch milliseconds, as a number or a numeric string (ecom invoices).
  if (typeof v === 'number' || /^\d{10,14}$/.test(String(v).trim())) {
    const ms = Number(v);
    if (!isFinite(ms)) return null;
    const y = new Date(ms).getFullYear();
    return y >= MIN_YEAR && y <= MAX_YEAR ? ms : null;
  }

  const s = String(v).trim();

  // An explicit timezone designator ('...Z' or '...+05:30') makes the instant
  // unambiguous — hand it straight to the engine. Rebuilding it from its parts
  // as LOCAL time would silently shift it by the UTC offset, and callers do
  // pass such strings: Reports converts lead.createdAt with
  // `new Date(ms).toISOString()`, which always ends in Z.
  if (/(?:[Zz]|[+-]\d{2}:?\d{2})$/.test(s)) {
    const dz = new Date(s);
    if (isNaN(dz.getTime())) return null;
    const yz = dz.getFullYear();
    return yz >= MIN_YEAR && yz <= MAX_YEAR ? dz.getTime() : null;
  }

  // 'YYYY-MM-DD' [T HH:mm[:ss]] — including typo'd years with extra leading
  // digits. Built from the captured parts and constructed as LOCAL time:
  // `new Date('2026-07-27')` is parsed as UTC by the spec, which in +05:30
  // lands at 05:30 local and shifts every day boundary by 5.5 hours.
  const m = /^(\d{4,6})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(s);
  if (m) {
    let year = Number(m[1]);
    // Typo'd years carry an extra digit: '52026' and '20026' are both meant to
    // be 2026. Correct by deleting ONE digit and taking the first deletion that
    // yields a plausible year — truncating to the last four would turn '20026'
    // into '0026'. If no single deletion works, treat the value as unusable
    // rather than guess at it.
    if (year > MAX_YEAR) {
      const digits = String(m[1]);
      let fixed = null;
      for (let i = 0; i < digits.length && fixed === null; i++) {
        const cand = Number(digits.slice(0, i) + digits.slice(i + 1));
        if (cand >= MIN_YEAR && cand <= MAX_YEAR) fixed = cand;
      }
      if (fixed === null) return null;
      year = fixed;
    }
    if (year < MIN_YEAR || year > MAX_YEAR) return null;
    const mo = Number(m[2]) - 1, day = Number(m[3]);
    if (mo < 0 || mo > 11 || day < 1 || day > 31) return null;
    const hasTime = m[4] !== undefined;
    const d = hasTime
      ? new Date(year, mo, day, Number(m[4]), Number(m[5]), Number(m[6] || 0))
      : (opts.endOfDay ? new Date(year, mo, day, 23, 59, 59, 999) : new Date(year, mo, day));
    return isNaN(d.getTime()) ? null : d.getTime();
  }

  // Last resort: let the engine try (e.g. '15 Sep 2026').
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  return y >= MIN_YEAR && y <= MAX_YEAR ? d.getTime() : null;
}

/** Local start-of-day in ms for a 'YYYY-MM-DD' string. */
export function startOfDayMs(dateStr) {
  return parseDateValue(dateStr, { endOfDay: false });
}

/** Local end-of-day in ms for a 'YYYY-MM-DD' string. */
export function endOfDayMs(dateStr) {
  return parseDateValue(dateStr, { endOfDay: true });
}

/**
 * Inclusive range test that doesn't silently drop unparseable values.
 * Returns false for genuinely unusable dates — but callers should count those
 * separately rather than pretend they don't exist.
 */
export function inDateRange(value, fromMs, toMs) {
  const t = parseDateValue(value);
  return t != null && t >= fromMs && t <= toMs;
}
