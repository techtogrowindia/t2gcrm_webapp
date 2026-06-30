import React from 'react';
import { fmt, fmtD, numberToWords, currencySymbol } from '../../utils/helpers';

export default function DocumentTemplate({ data, profile, type = 'Invoice', preview = false, settings }) {
  const profileTemplate = type === 'Invoice' ? profile?.invoiceTemplate : profile?.quotationTemplate;
  const t = profileTemplate || data.template || 'Classic';
  const items = Array.isArray(data.items)
    ? data.items
    : (typeof data.items === 'string' ? JSON.parse(data.items) : []);

  const docCurrency = data.currency || profile?.defaultCurrency || 'INR';
  const docSymbol = currencySymbol(docCurrency);
  // Format with currency symbol
  const money = (n) => fmt(n, docCurrency);
  // Format without currency symbol (number only, keeps locale formatting)
  const moneyNo = (n) => fmt(n, docCurrency).replace(docSymbol, '').trim();

  const ptots = (() => {
    const sub = items.reduce((s, it) => s + (it.qty || 0) * (it.rate || 0), 0);
    const taxTotal = items.reduce((s, it) => s + (it.qty || 0) * (it.rate || 0) * (it.taxRate || 0) / 100, 0);
    const taxesByRate = items.reduce((acc, it) => {
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
    try { rawPayments = Array.isArray(data.payments) ? data.payments : JSON.parse(data.payments || '[]'); } catch(e) {}
    const paymentsTotal = rawPayments.reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0);
    const balanceDue = Math.max(0, total - paymentsTotal);

    return { sub, taxTotal, taxesByRate, discAmt, total, paymentsTotal, balanceDue };
  })();

  const clientMatch = data.clientDetails || {}; 
  const isInterState = profile?.bizState && clientMatch?.state && profile.bizState !== clientMatch.state;

  const A4_STYLE = preview ? {
    width: '210mm',
    minHeight: '297mm',
    padding: '15mm',
    background: '#fff',
    position: 'relative',
    boxSizing: 'border-box',
    color: '#000',
  } : {
    width: '210mm',
    minHeight: '297mm',
    padding: '15mm',
    margin: '0 auto', // Removed 10mm top/bottom margin for better print alignment
    background: '#fff',
    boxShadow: '0 0 10px rgba(0,0,0,0.1)',
    position: 'relative',
    boxSizing: 'border-box',
    color: '#000'
  };

  const renderContent = () => {
    if (t === 'Spreadsheet') {
      const colNo = '40px', colQty = '60px', colRate = '100px', colGst = '80px', colAmt = '120px';
      
      return (
        <>
          <style>{`
            @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');
            
            /* Screen / General Styles (Clean Modern B2B) */
            .z-table { width: 100%; border-collapse: collapse; margin-top: 20px; margin-bottom: 20px; }
            .z-table th { background: #f8f9fa; color: #000; padding: 12px 10px; text-transform: uppercase; font-size: 10px; font-weight: 700; text-align: left; border-bottom: 2px solid #ddd; }
            .z-table td { padding: 14px 10px; border-bottom: 1px solid #eee; vertical-align: top; color: #111; font-size: 11px; }
            
            .z-summary { width: 100%; border-collapse: collapse; }
            .z-summary td { padding: 8px 10px; font-size: 12px; text-align: right; border: none; }
            .z-summary td:first-child { color: #000; text-align: left; }
            .z-summary tr.z-total td { font-weight: 800; font-size: 16px; color: #000; border-top: 2px solid #000; border-bottom: 2px double #000; padding: 15px 10px; }
            /* Print Frame Box - Screen Mode */
            .print-frame { width: 100%; max-width: 210mm; margin: 0 auto; border-collapse: collapse; background: #fff; box-shadow: 0 5px 20px rgba(0,0,0,0.05); font-family: 'Inter', sans-serif; font-size: 11px; color: #111; border: 2px solid #000; }
            .print-frame-head td { height: 0; padding: 0; border: none; }
            .print-frame-foot td { height: 0; padding: 0; border: none; }
            .print-frame-body > tr > td { padding: 15px 30px; }
            .print-page-border { display: none; }

            /* Print-only Overrides */
            @media print {
              @page { size: A4; margin: 0; }
              body { -webkit-print-color-adjust: exact; print-color-adjust: exact; margin: 0; padding: 0; background: #fff; }
              .a4-container { padding: 0 11mm !important; margin: 0 !important; box-shadow: none !important; border: none !important; width: 100% !important; height: auto !important; overflow: visible !important; box-sizing: border-box !important; }
              .no-print { display: none !important; }
              
              /* FIXED BORDER: renders on EVERY printed page in Chrome */
              .print-page-border {
                display: block !important;
                position: fixed !important;
                top: 6mm !important;
                left: 6mm !important;
                right: 6mm !important;
                bottom: 6mm !important;
                border: 2px solid #000 !important;
                pointer-events: none !important;
                z-index: 9999 !important;
              }
              
              /* Table: content only, no border role */
              .print-frame { width: 100% !important; margin: 0 !important; border: none !important; border-collapse: collapse !important; }
              
              /* thead/tfoot as INVISIBLE SPACERS — they repeat on every page, 
                 pushing content below the top border and above the bottom border */
              .print-frame-head td { height: 10mm !important; padding: 0 !important; font-size: 0 !important; line-height: 0 !important; border: none !important; }
              .print-frame-foot td { height: 10mm !important; padding: 0 !important; font-size: 0 !important; line-height: 0 !important; border: none !important; }
              
              .print-frame-body > tr > td { border: none !important; padding: 0 2px !important; }

              .z-table { page-break-inside: auto; }
              .z-table tr { page-break-inside: avoid; page-break-after: auto; }
              .z-table th { background: #f0f0f0 !important; color: #000 !important; border-bottom: 2px solid #000 !important; border-top: 2px solid #000 !important; }
              .z-table td { border-bottom: 1px solid #000 !important; }
              .z-table thead { display: table-header-group; }
              
              .z-summary td { color: #111 !important; }
              .z-summary tr.z-total td { border-top: 2px solid #000 !important; border-bottom: 2px solid #000 !important; }
              
              .print-content-row { page-break-inside: auto; }
              .avoid-break { page-break-inside: avoid; }
              .bank-right-border { border-right: 1px solid #000 !important; }
              /* Spacer row expands to fill remaining page height, pushing bank/totals to bottom */
              .print-spacer td { height: 100% !important; padding: 0 !important; font-size: 0 !important; line-height: 0 !important; }
            }
          `}</style>

          {/* Fixed border frame — renders on EVERY printed page via position:fixed */}
          <div className="print-page-border" />

          <table className="print-frame">
            <thead className="print-frame-head">
              <tr><td>&nbsp;</td></tr>
            </thead>
            <tbody className="print-frame-body">
              
              {/* Header Row */}
              <tr className="print-content-row"><td style={{ padding: '0 20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '30px', alignItems: 'flex-start', paddingTop: '15px' }}>
                  <div style={{ width: '55%' }}>
                    {profile.logo && <img src={profile.logo} alt="Logo" style={{ height: '70px', maxWidth: '200px', objectFit: 'contain', marginBottom: '15px' }} />}
                    <div style={{ fontSize: '18px', fontWeight: '800', color: '#111', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '-0.5px' }}>{profile.bizName}</div>
                    <div style={{ fontSize: '12px', color: '#000', whiteSpace: 'pre-wrap', lineHeight: '1.6', maxWidth: '300px' }}>{profile.address}</div>
                    {profile.gstin && <div style={{ fontSize: '11px', marginTop: '8px', fontWeight: '700', color: '#333' }}>GSTIN: {profile.gstin}</div>}
                  </div>
                  <div style={{ width: '40%', textAlign: 'right' }}>
                    <h1 style={{ fontSize: '36px', fontWeight: '200', margin: '0 0 20px 0', color: '#000', textTransform: 'uppercase', letterSpacing: '1px' }}>{type === 'Invoice' ? 'TAX INVOICE' : 'QUOTATION'}</h1>
                    <div style={{ display: 'inline-block', textAlign: 'left', minWidth: '240px', borderTop: '2px solid #111', paddingTop: '10px' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #eee' }}>
                        <span style={{ color: '#000', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase' }}>Reference</span>
                        <strong style={{ fontSize: '12px', color: '#111' }}>{data.no}</strong>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #eee' }}>
                        <span style={{ color: '#000', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase' }}>Date</span>
                        <strong style={{ fontSize: '12px', color: '#111' }}>{fmtD(data.date)}</strong>
                      </div>
                      {(type === 'Invoice' && data.dueDate) && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #eee' }}>
                          <span style={{ color: '#000', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase' }}>Due Date</span>
                          <strong style={{ fontSize: '12px', color: '#111' }}>{fmtD(data.dueDate)}</strong>
                        </div>
                      )}
                      {(type !== 'Invoice' && data.validUntil) && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #eee' }}>
                          <span style={{ color: '#000', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase' }}>Valid Until</span>
                          <strong style={{ fontSize: '12px', color: '#111' }}>{fmtD(data.validUntil)}</strong>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </td></tr>

              {/* Bill To Row */}
              <tr className="print-content-row"><td className="print-content-cell" style={{ padding: '0 20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px', paddingTop: '15px', borderTop: '1px solid #eee' }}>
                  <div style={{ width: '45%' }}>
                    <div style={{ fontSize: '11px', color: '#000', textTransform: 'uppercase', fontWeight: '700', marginBottom: '8px', letterSpacing: '0.5px' }}>Bill To</div>
                    <div style={{ fontSize: '16px', fontWeight: '800', color: '#111', marginBottom: '6px' }}>{clientMatch.companyName || data.companyName || data.client}</div>
                    {clientMatch.address && <div style={{ fontSize: '12px', color: '#000', whiteSpace: 'pre-wrap', lineHeight: '1.6', marginTop: '6px' }}>{clientMatch.address}</div>}
                    {clientMatch.gstin && <div style={{ fontSize: '11px', marginTop: '10px', fontWeight: '700', color: '#333' }}>GSTIN: {clientMatch.gstin}</div>}
                  </div>
                  {data.shipTo ? (
                    <div style={{ width: '45%' }}>
                      <div style={{ fontSize: '11px', color: '#000', textTransform: 'uppercase', fontWeight: '700', marginBottom: '8px', letterSpacing: '0.5px' }}>Ship To</div>
                      <div style={{ fontSize: '13px', color: '#000', whiteSpace: 'pre-wrap', lineHeight: '1.6' }}>{data.shipTo}</div>
                    </div>
                  ) : null}
                </div>
              </td></tr>

              {/* Items Table Row */}
              <tr className="print-content-row"><td className="print-content-cell" style={{ padding: '0 20px' }}>
                <table className="z-table">
                  <thead>
                    <tr>
                      <th style={{ width: colNo, textAlign: 'center' }}>#</th>
                      <th>Item & Description</th>
                      <th style={{ width: colQty, textAlign: 'center' }}>Qty</th>
                      <th style={{ width: colRate, textAlign: 'right' }}>Rate</th>
                      {isInterState ? (
                        <th style={{ width: colGst, textAlign: 'right' }}>IGST</th>
                      ) : (
                        <>
                          <th style={{ width: colGst, textAlign: 'right' }}>CGST</th>
                          <th style={{ width: colGst, textAlign: 'right' }}>SGST</th>
                        </>
                      )}
                      <th style={{ width: colAmt, textAlign: 'right' }}>Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((it, i) => {
                      const itemTotal = (it.qty || 0) * (it.rate || 0);
                      const taxRate = it.taxRate || 0;
                      const taxAmt = itemTotal * taxRate / 100;
                      return (
                        <tr key={i}>
                          <td style={{ textAlign: 'center', color: '#000' }}>{i + 1}</td>
                          <td>
                            <div style={{ fontWeight: '700', fontSize: '12px' }}>{it.name}</div>
                            {it.sku && <div style={{ fontSize: '10px', fontWeight: '500', color: '#000', marginTop: '4px' }}>Code: {it.sku}</div>}
                            {it.desc && <div style={{ fontSize: '11px', color: '#000', marginTop: '4px', whiteSpace: 'pre-wrap', lineHeight: '1.5' }}>{it.desc}</div>}
                          </td>
                          <td style={{ textAlign: 'center' }}>{Number(it.qty)} {it.unit || ''}</td>
                          <td style={{ textAlign: 'right' }}>{moneyNo(it.rate)}</td>
                          {isInterState ? (
                            <td style={{ textAlign: 'right', color: '#000' }}>
                              <div>{itemTotal === 0 ? '-' : moneyNo(taxAmt)}</div>
                              <div style={{ fontSize: '9px', opacity: 0.7 }}>({taxRate}%)</div>
                            </td>
                          ) : (
                            <>
                              <td style={{ textAlign: 'right', color: '#000' }}>
                                <div>{itemTotal === 0 ? '-' : moneyNo(taxAmt / 2)}</div>
                                <div style={{ fontSize: '9px', opacity: 0.7 }}>({taxRate / 2}%)</div>
                              </td>
                              <td style={{ textAlign: 'right', color: '#000' }}>
                                <div>{itemTotal === 0 ? '-' : moneyNo(taxAmt / 2)}</div>
                                <div style={{ fontSize: '9px', opacity: 0.7 }}>({taxRate / 2}%)</div>
                              </td>
                            </>
                          )}
                          <td style={{ textAlign: 'right', fontWeight: '700' }}>{moneyNo(itemTotal)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </td></tr>

              {/* Notes and Terms Row */}
              {(data.notes || data.terms) && (
              <tr className="print-content-row avoid-break"><td style={{ padding: '0 20px' }}>
                <div style={{ padding: '10px 0 20px 0' }}>
                  {data.notes && (
                    <div style={{ marginBottom: '15px' }}>
                      <div style={{ fontSize: '11px', fontWeight: '700', color: '#111', marginBottom: '6px', textTransform: 'uppercase' }}>Notes</div>
                      <div style={{ fontSize: '11px', color: '#000', whiteSpace: 'pre-wrap', lineHeight: '1.6' }}>{data.notes}</div>
                    </div>
                  )}
                  {data.terms && (
                    <div>
                      <div style={{ fontSize: '11px', fontWeight: '700', color: '#111', marginBottom: '6px', textTransform: 'uppercase' }}>Terms & Conditions</div>
                      <div style={{ fontSize: '11px', color: '#000', whiteSpace: 'pre-wrap', lineHeight: '1.6' }}>{data.terms}</div>
                    </div>
                  )}
                </div>
              </td></tr>
              )}

              {/* Spacer row — expands to fill remaining page height, pushing bank/totals to page bottom */}
              <tr className="print-spacer"><td>&nbsp;</td></tr>

              {/* Footer Grid: Bank Details | Totals Summary */}
              <tr className="avoid-break"><td style={{ padding: '0' }}>
                <div style={{ display: 'flex', minHeight: '150px', borderTop: '1px solid #000' }}>
                  {/* Left Side: Bank Details */}
                  <div className="bank-right-border" style={{ width: '50%', padding: '20px', borderRight: '1px solid #ddd' }}>
                    {profile.accHolder ? (
                      <div>
                        <div style={{ fontSize: '12px', fontWeight: '800', color: '#111', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Bank Details</div>
                        <div style={{ display: 'grid', gridTemplateColumns: '110px 10px 1fr', gap: '8px', fontSize: '11px', color: '#000' }}>
                          <span style={{ color: '#000' }}>Bank Name</span><span>:</span><strong style={{ color: '#000' }}>{profile.bankName}</strong>
                          <span style={{ color: '#000' }}>Account Name</span><span>:</span><strong style={{ color: '#000' }}>{profile.accHolder}</strong>
                          <span style={{ color: '#000' }}>Account No.</span><span>:</span><strong style={{ color: '#000' }}>{profile.accountNo}</strong>
                          <span style={{ color: '#000' }}>IFSC Code</span><span>:</span><strong style={{ color: '#000' }}>{profile.ifsc}</strong>
                          {profile.accType && <><span style={{ color: '#000' }}>Account Type</span><span>:</span><strong style={{ color: '#000' }}>{profile.accType}</strong></>}
                          {profile.bankExtra && <><span style={{ color: '#000' }}>Branch</span><span>:</span><strong style={{ color: '#000' }}>{profile.bankExtra}</strong></>}
                        </div>
                      </div>
                    ) : (
                      <div style={{ color: '#aaa', fontStyle: 'italic', fontSize: '11px' }}>No bank details configured.</div>
                    )}
                  </div>

                  {/* Right Side: Totals Summary */}
                  <div style={{ width: '50%', padding: '20px' }}>
                    <table className="z-summary">
                      <tbody>
                        <tr><td>Sub Total</td><td style={{ fontWeight: '600' }}>{moneyNo(ptots.sub)}</td></tr>
                        {ptots.discAmt > 0 && <tr><td>Discount ({data.discType === '₹' ? 'Flat' : `${data.disc}%`})</td><td style={{ color: '#d97706', fontWeight: '600' }}>(-) {moneyNo(ptots.discAmt)}</td></tr>}
                        
                        {Object.entries(ptots.taxesByRate).map(([rateStr, tAmt]) => {
                          const rate = parseFloat(rateStr);
                          if (isInterState) {
                            return <tr key={`igst-${rate}`}><td>IGST{rate} ({rate}%)</td><td style={{ fontWeight: '600' }}>{moneyNo(tAmt)}</td></tr>;
                          } else {
                            const half = rate / 2;
                            return (
                              <React.Fragment key={`cgst-sgst-${rate}`}>
                                <tr><td>CGST{half} ({half}%)</td><td style={{ fontWeight: '600' }}>{moneyNo(tAmt / 2)}</td></tr>
                                <tr><td>SGST{half} ({half}%)</td><td style={{ fontWeight: '600' }}>{moneyNo(tAmt / 2)}</td></tr>
                              </React.Fragment>
                            );
                          }
                        })}

                        {parseFloat(data.deliveryCharge) > 0 && <tr><td>Delivery Charges</td><td style={{ fontWeight: '600' }}>{moneyNo(parseFloat(data.deliveryCharge))}</td></tr>}
                        {parseFloat(data.deliveryCharge) > 0 && parseFloat(data.deliveryTaxRate) > 0 && <tr><td>Delivery Tax ({data.deliveryTaxRate}%)</td><td style={{ fontWeight: '600' }}>{moneyNo((parseFloat(data.deliveryCharge) || 0) * (parseFloat(data.deliveryTaxRate) || 0) / 100)}</td></tr>}
                        {data.adj !== 0 && <tr><td>Adjustment</td><td style={{ fontWeight: '600' }}>{data.adj > 0 ? '(+) ' : '(-) '}{moneyNo(Math.abs(data.adj))}</td></tr>}
                        <tr className="z-total"><td>Total</td><td style={{ whiteSpace: 'nowrap' }}>{money(ptots.total)}</td></tr>
                        
                        {type === 'Invoice' && ptots.paymentsTotal > 0 && (
                          <tr><td style={{ paddingTop: '10px', color: '#000' }}>Payment Made</td><td style={{ paddingTop: '10px', color: '#dc2626', fontWeight: '600' }}>(-) {moneyNo(ptots.paymentsTotal)}</td></tr>
                        )}
                        {type === 'Invoice' && (
                          <tr><td style={{ paddingTop: ptots.paymentsTotal > 0 ? '8px' : '15px', color: '#111', fontWeight: '800' }}>Balance Due</td><td style={{ paddingTop: ptots.paymentsTotal > 0 ? '8px' : '15px', color: '#111', fontWeight: '800', fontSize: '16px' }}>{money(ptots.balanceDue)}</td></tr>
                        )}
                      </tbody>
                    </table>
                    <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px solid #ddd' }}>
                      <div style={{ fontSize: '9px', color: '#000', textTransform: 'uppercase', fontWeight: '700', marginBottom: '2px' }}>Total In Words</div>
                      <div style={{ fontSize: '11px', fontWeight: '700', color: '#111', fontStyle: 'italic' }}>{numberToWords(ptots.total, docCurrency)}</div>
                    </div>
                  </div>
                </div>
              </td></tr>

              {settings?.showBranding !== false && (
              <tr><td style={{ padding: '8px 20px' }}>
                <div style={{ fontSize: '10px', fontWeight: '600', color: '#555' }}>POWERED BY <strong style={{ color: '#000' }}>{settings?.brandName || 'T2GCRM'}</strong></div>
              </td></tr>
              )}

            </tbody>
            <tfoot className="print-frame-foot">
              <tr><td>&nbsp;</td></tr>
            </tfoot>
          </table>
        </>
      );
    }

    // Standard Template Wrapper for others
    return (
      <div style={{ fontFamily: t === 'Modern' ? 'Outfit, sans-serif' : 'sans-serif' }}>
        <style>{`
          @media print {
            @page { size: A4; margin: 0; }
            body { margin: 0; padding: 0; background: #fff; -webkit-print-color-adjust: exact; }
            .a4-container { box-shadow: none !important; margin: 0 !important; border: none !important; padding: 15mm !important; width: auto !important; height: auto !important; min-height: auto !important; }
            .no-print { display: none !important; }
          }
        `}</style>
        {/* Header Section */}
        {t === 'Modern' ? (
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 50, background: 'var(--accent)', color: '#fff', padding: 30, borderRadius: 12, alignItems: 'center' }}>
             <div><h1 style={{ margin: 0, fontSize: 42, letterSpacing: -1 }}>{type.toUpperCase()}</h1><div style={{ opacity: 0.8, fontSize: 13, marginTop: 4 }}>No: {data.no} | {fmtD(data.date)}</div></div>
             <div style={{ textAlign: 'right', display: 'flex', alignItems: 'center', gap: 20 }}>
               {profile.logo && <img src={profile.logo} alt="Logo" style={{ height: 60, width: 60, objectFit: 'contain', background: '#fff', padding: 5, borderRadius: 8 }} />}
               <div>
                 <h2 style={{ margin: 0 }}>{profile.bizName}</h2>
                 <div style={{ fontSize: 12, opacity: 0.9 }}>{profile.email} | {profile.phone}</div>
               </div>
             </div>
          </div>
        ) : t === 'Minimal' ? (
        <div style={{ marginBottom: 60, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
           <div>
             <h1 style={{ fontSize: 24, fontWeight: 300, margin: '0 0 10px 0' }}>{type} <span>#{data.no}</span></h1>
             <div style={{ fontSize: 12, color: '#555' }}>Issued on {fmtD(data.date)}</div>
           </div>
           {profile.logo && <img src={profile.logo} alt="Logo" style={{ height: 50, width: 50, objectFit: 'contain' }} />}
        </div>
        ) : (
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 40, alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: 20, alignItems: 'center' }}>
              {profile.logo && <img src={profile.logo} alt="Logo" style={{ height: 70, width: 70, objectFit: 'contain' }} />}
              <div>
                <h1 style={{ margin: 0, fontSize: 32, fontWeight: 800, color: 'var(--accent)' }}>{type.toUpperCase()}</h1>
                <div style={{ fontSize: 13, color: '#000', marginTop: 5 }}>No: <strong>{data.no}</strong></div>
                <div style={{ fontSize: 13, color: '#000' }}>Date: {fmtD(data.date)}</div>
                {data.dueDate && <div style={{ fontSize: 13, color: '#000' }}>Due Date: {fmtD(data.date)}</div>}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <h2 style={{ margin: 0, fontSize: 20 }}>{profile.bizName || 'Your Business'}</h2>
              <div style={{ fontSize: 13, color: '#000', marginTop: 4, whiteSpace: 'pre-wrap' }}>{profile.address}</div>
              {profile.gstin && <div style={{ fontSize: 13, color: '#000' }}>GSTIN: {profile.gstin}</div>}
            </div>
          </div>
        )}

        {/* Client Section */}
        <div style={{ marginBottom: 40, borderLeft: t === 'Classic' ? '3px solid var(--accent)' : 'none', paddingLeft: t === 'Classic' ? 15 : 0, display: 'flex', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: 60 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#000', textTransform: 'uppercase' }}>Billed To</div>
              <div style={{ fontSize: t === 'Modern' ? 20 : 16, fontWeight: 700, marginTop: 4 }}>
                {clientMatch.companyName || data.companyName || data.client}
              </div>
              {clientMatch?.address && <div style={{ fontSize: 12, color: '#000', marginTop: 10, whiteSpace: 'pre-wrap' }}>{clientMatch.address}</div>}
              {clientMatch?.gstin && <div style={{ fontSize: 12, color: '#000', marginTop: 4 }}>GSTIN: {clientMatch.gstin}</div>}
            </div>
            {data.shipTo && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#000', textTransform: 'uppercase' }}>Ship To</div>
                <div style={{ fontSize: 13, color: '#333', marginTop: 4, whiteSpace: 'pre-wrap' }}>{data.shipTo}</div>
              </div>
            )}
          </div>
        </div>

        {/* Items Table */}
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 30 }}>
          <thead>
            <tr style={{ background: t === 'Modern' ? '#f8fafc' : 'transparent', borderBottom: t === 'Minimal' ? '1px solid #eee' : '2px solid #000' }}>
              <th style={{ textAlign: 'left', padding: '12px 8px', fontSize: 12 }}>Description</th>
              <th style={{ textAlign: 'center', padding: '12px 8px', fontSize: 12 }}>Qty</th>
              <th style={{ textAlign: 'right', padding: '12px 8px', fontSize: 12 }}>Rate</th>
              <th style={{ textAlign: 'right', padding: '12px 8px', fontSize: 12 }}>Tax</th>
              <th style={{ textAlign: 'right', padding: '12px 8px', fontSize: 12 }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, i) => (
              <tr key={i} style={{ borderBottom: '1px solid #eee' }}>
                <td style={{ padding: '14px 8px', fontSize: 13 }}>
                  <div><strong>{it.name}</strong></div>
                  {it.sku && <div style={{ fontSize: 10, color: '#000', marginTop: 2 }}>Code: {it.sku}</div>}
                  {it.desc && <div style={{ fontSize: 11, color: '#000', marginTop: 2 }}>{it.desc}</div>}
                </td>
                <td style={{ padding: '14px 8px', fontSize: 13, textAlign: 'center' }}>{it.qty} {it.unit || ''}</td>
                <td style={{ padding: '14px 8px', fontSize: 13, textAlign: 'right' }}>{money(it.rate)}</td>
                <td style={{ padding: '14px 8px', fontSize: 13, textAlign: 'right' }}>{it.taxRate}%</td>
                <td style={{ padding: '14px 8px', fontSize: 13, textAlign: 'right', fontWeight: 600 }}>{money(it.qty * it.rate)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Totals Section */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ width: '45%', fontSize: 12, color: '#000' }}>
            {data.notes && <div style={{ marginBottom: 15 }}><strong>Notes:</strong><br/>{data.notes}</div>}
            {data.terms && <div><strong>Terms:</strong><br/>{data.terms}</div>}
          </div>
          <div style={{ width: '40%', background: t === 'Modern' ? '#f8fafc' : 'transparent', padding: t === 'Modern' ? 20 : 0, borderRadius: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: 13 }}>
              <span style={{ color: '#000' }}>Subtotal</span><span>{money(ptots.sub)}</span>
            </div>
            {ptots.discAmt > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: 13, color: '#d97706' }}><span>Discount ({data.discType === '₹' ? 'Flat' : `${data.disc}%`})</span><span>(-) {money(ptots.discAmt)}</span></div>}
            
            {Object.entries(ptots.taxesByRate).map(([rateStr, tAmt]) => {
              const rate = parseFloat(rateStr);
              if (isInterState) {
                return <div key={`igst-${rate}`} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: 13 }}><span>IGST{rate} ({rate}%)</span><span>{money(tAmt)}</span></div>;
              } else {
                const half = rate / 2;
                return (
                  <React.Fragment key={`cgst-sgst-${rate}`}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: 13 }}><span>CGST{half} ({half}%)</span><span>{money(tAmt / 2)}</span></div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: 13 }}><span>SGST{half} ({half}%)</span><span>{money(tAmt / 2)}</span></div>
                  </React.Fragment>
                );
              }
            })}

            {parseFloat(data.deliveryCharge) > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: 13 }}><span>Delivery Charges</span><span>{money(parseFloat(data.deliveryCharge))}</span></div>}
            {parseFloat(data.deliveryCharge) > 0 && parseFloat(data.deliveryTaxRate) > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: 13 }}><span>Delivery Tax ({data.deliveryTaxRate}%)</span><span>{money((parseFloat(data.deliveryCharge) || 0) * (parseFloat(data.deliveryTaxRate) || 0) / 100)}</span></div>}
            {data.adj !== 0 && <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: 13 }}><span>Adjustment</span><span>{data.adj > 0 ? '(+) ' : '(-) '}{money(Math.abs(data.adj))}</span></div>}
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '15px 0 0 0', fontSize: 16, fontWeight: 800, borderTop: t === 'Minimal' ? '1px solid #eee' : '2px solid #000', marginTop: 10 }}>
              <span>Total</span><span style={{ color: '#000' }}>{money(ptots.total)}</span>
            </div>
            
            {type === 'Invoice' && ptots.paymentsTotal > 0 && (
               <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0 0 0', fontSize: 13, color: '#dc2626', fontWeight: 600 }}>
                 <span>Payment Made</span><span>(-) {money(ptots.paymentsTotal)}</span>
               </div>
            )}
            {type === 'Invoice' && (
               <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0 0 0', fontSize: 16, fontWeight: 800, color: '#111' }}>
                 <span>Balance Due</span><span>{money(ptots.balanceDue)}</span>
               </div>
            )}
          </div>
        </div>

        {/* Bank & QR Section */}
        {(profile.bankName || profile.qrCode) && (
          <div style={{ marginTop: 40, borderTop: '1px solid #eee', paddingTop: 24, display: 'flex', justifyContent: 'space-between' }}>
            {profile.bankName && (
              <div style={{ fontSize: 12 }}>
                <div style={{ fontWeight: 700, color: '#000', marginBottom: 8, textTransform: 'uppercase' }}>Bank Details</div>
                <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr', rowGap: 4 }}>
                  <span style={{ color: '#000' }}>Account:</span><span style={{ fontWeight: 600 }}>{profile.accHolder}</span>
                  <span style={{ color: '#000' }}>Bank:</span><span>{profile.bankName}</span>
                  <span style={{ color: '#000' }}>A/C No:</span><span style={{ fontWeight: 600 }}>{profile.accountNo}</span>
                  <span style={{ color: '#000' }}>IFSC:</span><span>{profile.ifsc}</span>
                </div>
                {profile.bankExtra && (
                  <div style={{ marginTop: '12px', color: '#000', whiteSpace: 'pre-wrap', borderTop: '1px solid #eee', paddingTop: '8px', fontWeight: '700', fontSize: '12px' }}>
                    {profile.bankExtra}
                  </div>
                )}
              </div>
            )}
            {profile.qrCode && (
              <div style={{ textAlign: 'right' }}>
                <img src={profile.qrCode} alt="Payment QR" style={{ height: 100, width: 100, borderRadius: 4 }} />
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="a4-container" style={A4_STYLE}>
      {renderContent()}
    </div>
  );
}
