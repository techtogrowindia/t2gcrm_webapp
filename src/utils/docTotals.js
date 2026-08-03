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
  const flatDiscTypes = ['₹', '$', '€', '£'];
  const discAmt = flatDiscTypes.includes(data.discType) ? (parseFloat(data.disc) || 0) : (sub * (parseFloat(data.disc) || 0) / 100);
  // GST is charged on the post-discount taxable value (standard treatment: a
  // trade discount reduces the taxable amount). The document-level discount is
  // apportioned across line items proportionally via this factor, so each
  // item's tax — and the per-rate CGST/SGST/IGST breakdown — is computed on its
  // share of the discounted subtotal rather than the gross line amount.
  const discountFactor = sub > 0 ? Math.max(0, (sub - discAmt) / sub) : 1;
  const taxTotal = list.reduce((s, it) => s + (it.qty || 0) * (it.rate || 0) * discountFactor * (it.taxRate || 0) / 100, 0);
  const taxesByRate = list.reduce((acc, it) => {
    const r = it.taxRate || 0;
    if (r === 0) return acc;
    const taxAmt = (it.qty || 0) * (it.rate || 0) * discountFactor * r / 100;
    acc[r] = (acc[r] || 0) + taxAmt;
    return acc;
  }, {});
  // Per-line taxable value (post-apportioned-discount) and tax — computed with
  // the SAME discountFactor as the totals so the GST-format template's HSN-wise
  // summary reconciles to the invoice total exactly. Grouped by HSN + rate,
  // which is how a GST tax invoice's HSN summary must be presented.
  const perItem = list.map(it => {
    const taxable = (it.qty || 0) * (it.rate || 0) * discountFactor;
    const rate = it.taxRate || 0;
    return { hsn: it.hsn || '', taxRate: rate, taxable, tax: taxable * rate / 100 };
  });
  const hsnSummary = Object.values(perItem.reduce((acc, li) => {
    const key = `${li.hsn}|${li.taxRate}`;
    if (!acc[key]) acc[key] = { hsn: li.hsn, taxRate: li.taxRate, taxable: 0, tax: 0 };
    acc[key].taxable += li.taxable;
    acc[key].tax += li.tax;
    return acc;
  }, {}));

  const deliveryAmt = parseFloat(data.deliveryCharge) || 0;
  const deliveryTax = deliveryAmt * (parseFloat(data.deliveryTaxRate) || 0) / 100;
  const total = Math.round(sub - discAmt + taxTotal + deliveryAmt + deliveryTax + (parseFloat(data.adj) || 0));
  // Rounding adjustment GST invoices display as a "Round Off" line.
  const roundOff = total - (sub - discAmt + taxTotal + deliveryAmt + deliveryTax + (parseFloat(data.adj) || 0));

  let rawPayments = [];
  try { rawPayments = Array.isArray(data.payments) ? data.payments : JSON.parse(data.payments || '[]'); } catch (e) {}
  const paymentsTotal = rawPayments.reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0);
  const balanceDue = Math.max(0, total - paymentsTotal);

  return { sub, taxTotal, taxesByRate, discAmt, total, paymentsTotal, balanceDue, perItem, hsnSummary, roundOff };
}
