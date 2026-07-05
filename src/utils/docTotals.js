// Shared invoice/quotation totals math.
//
// Extracted verbatim from DocumentTemplate.jsx so the HTML template and the
// react-pdf template compute identical numbers — GST correctness is the
// highest-stakes part of the document, and duplicating this logic across two
// renderers would let them silently drift. Any change to how a document total
// is derived must happen HERE and nowhere else.
//
// `items` is the already-parsed line-item array; `data` is the invoice/quote
// record (discType, disc, deliveryCharge, deliveryTaxRate, adj, payments).
export function computeDocTotals(items, data) {
  const list = Array.isArray(items) ? items : [];
  const sub = list.reduce((s, it) => s + (it.qty || 0) * (it.rate || 0), 0);
  const taxTotal = list.reduce((s, it) => s + (it.qty || 0) * (it.rate || 0) * (it.taxRate || 0) / 100, 0);
  const taxesByRate = list.reduce((acc, it) => {
    const r = it.taxRate || 0;
    if (r === 0) return acc;
    const taxAmt = (it.qty || 0) * (it.rate || 0) * r / 100;
    acc[r] = (acc[r] || 0) + taxAmt;
    return acc;
  }, {});
  const flatDiscTypes = ['₹', '$', '€', '£'];
  const discAmt = flatDiscTypes.includes(data.discType) ? (parseFloat(data.disc) || 0) : (sub * (parseFloat(data.disc) || 0) / 100);
  const deliveryAmt = parseFloat(data.deliveryCharge) || 0;
  const deliveryTax = deliveryAmt * (parseFloat(data.deliveryTaxRate) || 0) / 100;
  const total = Math.round(sub - discAmt + taxTotal + deliveryAmt + deliveryTax + (parseFloat(data.adj) || 0));

  let rawPayments = [];
  try { rawPayments = Array.isArray(data.payments) ? data.payments : JSON.parse(data.payments || '[]'); } catch (e) {}
  const paymentsTotal = rawPayments.reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0);
  const balanceDue = Math.max(0, total - paymentsTotal);

  return { sub, taxTotal, taxesByRate, discAmt, total, paymentsTotal, balanceDue };
}
