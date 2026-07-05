// ── React-PDF renderer for invoices/quotations (BETA, Classic template) ──
//
// This is an ADDITIVE, opt-in alternative to the HTML `DocumentTemplate.jsx`
// + window.print() flow. It produces a real downloadable PDF file (named by
// document number, no browser print dialog). It is gated behind a beta flag in
// the caller and does NOT replace the existing print path.
//
// Constraints of @react-pdf/renderer (vs the HTML template):
//   - No HTML/CSS: uses Document/Page/View/Text/Image primitives + a flexbox
//     StyleSheet subset (no CSS grid, no @media print, no position:fixed).
//   - Fonts must be registered as TTF. We bundle Noto Sans locally because it
//     contains the ₹ (U+20B9) glyph, which react-pdf's default Helvetica lacks.
//   - Totals math is imported from the shared computeDocTotals() so this and
//     the HTML template can never drift on GST numbers.
//
// Only the "Classic" template is implemented here for the first increment;
// other variants still fall back to the HTML/print path in the caller.
import React from 'react';
import { Document, Page, View, Text, Image, StyleSheet, Font, pdf } from '@react-pdf/renderer';
import { fmt, fmtD, numberToWords, currencySymbol } from '../../utils/helpers';
import { computeDocTotals } from '../../utils/docTotals';
import NotoRegular from '../../assets/fonts/NotoSans-Regular.ttf';
import NotoBold from '../../assets/fonts/NotoSans-Bold.ttf';

Font.register({
  family: 'NotoSans',
  fonts: [
    { src: NotoRegular, fontWeight: 'normal' },
    { src: NotoBold, fontWeight: 'bold' },
  ],
});
// Long line items shouldn't break mid-word off the page edge.
Font.registerHyphenationCallback((word) => [word]);

const DEFAULT_ACCENT = '#22c55e';

const s = StyleSheet.create({
  page: { paddingVertical: 40, paddingHorizontal: 42, fontFamily: 'NotoSans', fontSize: 9, color: '#000', lineHeight: 1.4 },
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  // Header
  headerWrap: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28 },
  logo: { height: 54, width: 54, objectFit: 'contain', marginRight: 14 },
  docTitle: { fontSize: 26, fontWeight: 'bold' },
  docMeta: { fontSize: 10, marginTop: 4 },
  bizName: { fontSize: 14, fontWeight: 'bold' },
  bizLine: { fontSize: 9, color: '#000', marginTop: 2 },
  // Client
  sectionLabel: { fontSize: 8, fontWeight: 'bold', textTransform: 'uppercase', color: '#000' },
  clientName: { fontSize: 12, fontWeight: 'bold', marginTop: 3 },
  clientLine: { fontSize: 9, color: '#000', marginTop: 4 },
  // Items table
  th: { flexDirection: 'row', borderBottomWidth: 2, borderColor: '#000', paddingVertical: 7 },
  thText: { fontSize: 9, fontWeight: 'bold' },
  tr: { flexDirection: 'row', borderBottomWidth: 1, borderColor: '#eee', paddingVertical: 8 },
  cDesc: { flex: 1, paddingRight: 6 },
  cQty: { width: 55, textAlign: 'center' },
  cRate: { width: 70, textAlign: 'right' },
  cTax: { width: 45, textAlign: 'right' },
  cAmt: { width: 75, textAlign: 'right' },
  itemName: { fontSize: 10, fontWeight: 'bold' },
  itemSub: { fontSize: 8, color: '#000', marginTop: 2 },
  // Totals
  totalsWrap: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 22 },
  notesCol: { width: '48%', fontSize: 9 },
  sumCol: { width: '42%' },
  sumRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3, fontSize: 10 },
  sumTotal: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: 8, marginTop: 6, borderTopWidth: 2, borderColor: '#000' },
  sumTotalText: { fontSize: 13, fontWeight: 'bold' },
  // Bank
  bankWrap: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 32, borderTopWidth: 1, borderColor: '#eee', paddingTop: 18 },
  qr: { height: 92, width: 92 },
  powered: { marginTop: 22, fontSize: 8, color: '#555' },
});

function ClassicDoc({ data, profile, type, settings }) {
  const accent = profile?.accentColor || DEFAULT_ACCENT;
  const items = Array.isArray(data.items) ? data.items : (typeof data.items === 'string' ? JSON.parse(data.items || '[]') : []);
  const docCurrency = data.currency || profile?.defaultCurrency || 'INR';
  const docSymbol = currencySymbol(docCurrency);
  const money = (n) => fmt(n, docCurrency);
  const moneyNo = (n) => fmt(n, docCurrency).replace(docSymbol, '').trim();
  const ptots = computeDocTotals(items, data);
  const clientMatch = data.clientDetails || {};
  const isInterState = profile?.bizState && clientMatch?.state && profile.bizState !== clientMatch.state;

  return (
    <Document title={`${type} ${data.no || ''}`.trim()}>
      <Page size="A4" style={s.page}>
        {/* Header */}
        <View style={s.headerWrap}>
          <View style={{ flexDirection: 'row', alignItems: 'center', maxWidth: '58%' }}>
            {profile?.logo ? <Image src={profile.logo} style={s.logo} /> : null}
            <View>
              <Text style={[s.docTitle, { color: accent }]}>{type.toUpperCase()}</Text>
              <Text style={s.docMeta}>No: {data.no}</Text>
              <Text style={s.docMeta}>Date: {fmtD(data.date)}</Text>
              {type === 'Invoice' && data.dueDate ? <Text style={s.docMeta}>Due: {fmtD(data.dueDate)}</Text> : null}
              {type !== 'Invoice' && data.validUntil ? <Text style={s.docMeta}>Valid Until: {fmtD(data.validUntil)}</Text> : null}
            </View>
          </View>
          <View style={{ maxWidth: '40%', alignItems: 'flex-end' }}>
            <Text style={s.bizName}>{profile?.bizName || 'Your Business'}</Text>
            {profile?.address ? <Text style={[s.bizLine, { textAlign: 'right' }]}>{profile.address}</Text> : null}
            {profile?.gstin ? <Text style={s.bizLine}>GSTIN: {profile.gstin}</Text> : null}
          </View>
        </View>

        {/* Client */}
        <View style={{ flexDirection: 'row', borderLeftWidth: 3, borderColor: accent, paddingLeft: 12, marginBottom: 24 }}>
          <View style={{ flex: 1 }}>
            <Text style={s.sectionLabel}>Billed To</Text>
            <Text style={s.clientName}>{clientMatch.companyName || data.companyName || data.client}</Text>
            {clientMatch.address ? <Text style={s.clientLine}>{clientMatch.address}</Text> : null}
            {clientMatch.gstin ? <Text style={s.clientLine}>GSTIN: {clientMatch.gstin}</Text> : null}
          </View>
          {data.shipTo ? (
            <View style={{ flex: 1 }}>
              <Text style={s.sectionLabel}>Ship To</Text>
              <Text style={s.clientLine}>{data.shipTo}</Text>
            </View>
          ) : null}
        </View>

        {/* Items */}
        <View style={s.th}>
          <Text style={[s.thText, s.cDesc]}>Description</Text>
          <Text style={[s.thText, s.cQty]}>Qty</Text>
          <Text style={[s.thText, s.cRate]}>Rate</Text>
          <Text style={[s.thText, s.cTax]}>Tax</Text>
          <Text style={[s.thText, s.cAmt]}>Amount</Text>
        </View>
        {items.map((it, i) => (
          <View style={s.tr} key={i} wrap={false}>
            <View style={s.cDesc}>
              <Text style={s.itemName}>{it.name}</Text>
              {it.sku ? <Text style={s.itemSub}>Code: {it.sku}</Text> : null}
              {it.desc ? <Text style={s.itemSub}>{it.desc}</Text> : null}
            </View>
            <Text style={s.cQty}>{Number(it.qty)} {it.unit || ''}</Text>
            <Text style={s.cRate}>{moneyNo(it.rate)}</Text>
            <Text style={s.cTax}>{it.taxRate || 0}%</Text>
            <Text style={[s.cAmt, { fontWeight: 'bold' }]}>{moneyNo((it.qty || 0) * (it.rate || 0))}</Text>
          </View>
        ))}

        {/* Totals */}
        <View style={s.totalsWrap} wrap={false}>
          <View style={s.notesCol}>
            {data.notes ? <Text><Text style={{ fontWeight: 'bold' }}>Notes: </Text>{data.notes}</Text> : null}
            {data.terms ? <Text style={{ marginTop: 8 }}><Text style={{ fontWeight: 'bold' }}>Terms: </Text>{data.terms}</Text> : null}
          </View>
          <View style={s.sumCol}>
            <View style={s.sumRow}><Text>Subtotal</Text><Text>{money(ptots.sub)}</Text></View>
            {ptots.discAmt > 0 ? (
              <View style={s.sumRow}><Text>Discount ({data.discType === '₹' ? 'Flat' : `${data.disc}%`})</Text><Text style={{ color: '#d97706' }}>(-) {money(ptots.discAmt)}</Text></View>
            ) : null}
            {Object.entries(ptots.taxesByRate).map(([rateStr, tAmt]) => {
              const rate = parseFloat(rateStr);
              if (isInterState) {
                return <View style={s.sumRow} key={`igst-${rate}`}><Text>IGST{rate} ({rate}%)</Text><Text>{money(tAmt)}</Text></View>;
              }
              const half = rate / 2;
              return (
                <React.Fragment key={`cs-${rate}`}>
                  <View style={s.sumRow}><Text>CGST{half} ({half}%)</Text><Text>{money(tAmt / 2)}</Text></View>
                  <View style={s.sumRow}><Text>SGST{half} ({half}%)</Text><Text>{money(tAmt / 2)}</Text></View>
                </React.Fragment>
              );
            })}
            {parseFloat(data.deliveryCharge) > 0 ? <View style={s.sumRow}><Text>Delivery Charges</Text><Text>{money(parseFloat(data.deliveryCharge))}</Text></View> : null}
            {parseFloat(data.deliveryCharge) > 0 && parseFloat(data.deliveryTaxRate) > 0 ? (
              <View style={s.sumRow}><Text>Delivery Tax ({data.deliveryTaxRate}%)</Text><Text>{money((parseFloat(data.deliveryCharge) || 0) * (parseFloat(data.deliveryTaxRate) || 0) / 100)}</Text></View>
            ) : null}
            {data.adj && Number(data.adj) !== 0 ? <View style={s.sumRow}><Text>Adjustment</Text><Text>{data.adj > 0 ? '(+) ' : '(-) '}{money(Math.abs(data.adj))}</Text></View> : null}
            <View style={s.sumTotal}><Text style={s.sumTotalText}>Total</Text><Text style={s.sumTotalText}>{money(ptots.total)}</Text></View>
            {type === 'Invoice' && ptots.paymentsTotal > 0 ? (
              <View style={[s.sumRow, { marginTop: 6 }]}><Text style={{ color: '#dc2626' }}>Payment Made</Text><Text style={{ color: '#dc2626' }}>(-) {money(ptots.paymentsTotal)}</Text></View>
            ) : null}
            {type === 'Invoice' ? (
              <View style={[s.sumRow, { marginTop: 4 }]}><Text style={{ fontWeight: 'bold', fontSize: 12 }}>Balance Due</Text><Text style={{ fontWeight: 'bold', fontSize: 12 }}>{money(ptots.balanceDue)}</Text></View>
            ) : null}
            <View style={{ marginTop: 8, borderTopWidth: 1, borderColor: '#ddd', paddingTop: 6 }}>
              <Text style={{ fontSize: 7, fontWeight: 'bold', textTransform: 'uppercase' }}>Total In Words</Text>
              <Text style={{ fontSize: 9, fontWeight: 'bold', fontStyle: 'italic' }}>{numberToWords(ptots.total, docCurrency)}</Text>
            </View>
          </View>
        </View>

        {/* Bank & QR */}
        {(profile?.bankName || profile?.qrCode) ? (
          <View style={s.bankWrap} wrap={false}>
            {profile?.bankName ? (
              <View style={{ fontSize: 9 }}>
                <Text style={[s.sectionLabel, { marginBottom: 6 }]}>Bank Details</Text>
                {profile.accHolder ? <Text style={s.clientLine}>Account: {profile.accHolder}</Text> : null}
                <Text style={s.clientLine}>Bank: {profile.bankName}</Text>
                <Text style={s.clientLine}>A/C No: {profile.accountNo}</Text>
                <Text style={s.clientLine}>IFSC: {profile.ifsc}</Text>
                {profile.bankExtra ? <Text style={[s.clientLine, { fontWeight: 'bold' }]}>{profile.bankExtra}</Text> : null}
              </View>
            ) : <View />}
            {profile?.qrCode ? <Image src={profile.qrCode} style={s.qr} /> : null}
          </View>
        ) : null}

        {settings?.showBranding !== false ? (
          <Text style={s.powered}>POWERED BY {settings?.brandName || 'T2GCRM'}</Text>
        ) : null}
      </Page>
    </Document>
  );
}

// Generates the PDF blob and triggers a browser download named by doc number.
// Returns true on success; caller can fall back to print on false.
export async function downloadDocumentPdf({ data, profile, type = 'Invoice', settings }) {
  const blob = await pdf(<ClassicDoc data={data} profile={profile} type={type} settings={settings} />).toBlob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${type}-${data.no || 'document'}.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return true;
}

export default ClassicDoc;
