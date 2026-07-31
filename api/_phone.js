// Canonical phone key for matching the same number across records regardless
// of how it was typed. Strips every non-digit and keeps the last 10, so
// `+91 98765 43210`, `098765 43210` and `9876543210` all collapse to one key.
// Returns '' for empty/garbage input.
//
// This is the ONE definition. Duplicating `.replace(/\D/g,'').slice(-10)` inline
// is how the call-log lead-matching and the lead-dedup single-mode drifted out
// of step with their own batch paths — fixed by routing every consumer here.
export const phoneKey = (p) => (p ? String(p).replace(/\D/g, '').slice(-10) : '');

// A key shorter than this can't reliably identify a person; guards against two
// stray short numbers (or two empty ones) colliding into a false match.
export const MIN_PHONE_KEY_LEN = 7;

// True when two phones refer to the same number, ignoring format. Both must
// carry at least MIN_PHONE_KEY_LEN digits — empty/garbage never matches.
export const samePhone = (a, b) => {
  const ka = phoneKey(a);
  return ka.length >= MIN_PHONE_KEY_LEN && ka === phoneKey(b);
};
