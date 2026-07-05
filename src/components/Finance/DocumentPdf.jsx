// ── React-PDF renderer for invoices/quotations (BETA) ──
//
// Additive, opt-in alternative to the HTML `DocumentTemplate.jsx` + window.print()
// flow. Produces a real downloadable PDF file (named by document number, no
// browser print dialog). Gated behind a beta flag in the caller; does NOT
// replace the existing print path.
//
// Templates supported: Classic, Modern, Minimal (shared body, different header)
// and Spreadsheet (bordered GST layout, its own structure). The variant is
// chosen the same way DocumentTemplate.jsx chooses it (profile.invoiceTemplate /
// profile.quotationTemplate, else data.template, else Classic).
//
// react-pdf constraints learned the hard way (keep applying):
//   - No HTML/CSS: Document/Page/View/Text/Image + flexbox subset only.
//   - Fonts must be registered TTF; Noto Sans is bundled because it has the ₹
//     glyph that react-pdf's default Helvetica lacks. No italic variant is
//     registered — never use fontStyle:'italic'.
//   - <Image> does not reserve flex width — always wrap it in a fixed-width View.
//   - Large <Text> needs an explicit lineHeight or it under-reserves its box and
//     the next line overlaps.
//   - Totals/GST math comes from the shared computeDocTotals() so this and the
//     HTML template can never drift.
import React from 'react';
// react-pdf's PDF engine (pdfkit) relies on Node's Buffer, which Vite does not
// polyfill for the browser. This module is lazy-loaded, so the polyfill only
// loads when a user actually generates a PDF.
import { Buffer } from 'buffer';
if (typeof window !== 'undefined' && !window.Buffer) window.Buffer = Buffer;
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

// Build the per-document derived values shared by every template.
function buildCtx(data, profile) {
  const items = Array.isArray(data.items) ? data.items : (typeof data.items === 'string' ? JSON.parse(data.items || '[]') : []);
  const docCurrency = data.currency || profile?.defaultCurrency || 'INR';
  const docSymbol = currencySymbol(docCurrency);
  const money = (n) => fmt(n, docCurrency);
  const moneyNo = (n) => fmt(n, docCurrency).replace(docSymbol, '').trim();
  const ptots = computeDocTotals(items, data);
  const clientMatch = data.clientDetails || {};
  const isInterState = profile?.bizState && clientMatch?.state && profile.bizState !== clientMatch.state;
  return { items, docCurrency, money, moneyNo, ptots, clientMatch, isInterState };
}

// ─────────────────────────── Standard templates (Classic / Modern / Minimal) ──
const s = StyleSheet.create({
  page: { paddingVertical: 40, paddingHorizontal: 42, fontFamily: 'NotoSans', fontSize: 9, color: '#000', lineHeight: 1.4 },
  bizName: { fontSize: 14, fontWeight: 'bold' },
  bizLine: { fontSize: 9, color: '#000', marginTop: 2 },
  docTitle: { fontSize: 24, fontWeight: 'bold', lineHeight: 1.1, marginBottom: 8 },
  docMeta: { fontSize: 10, marginTop: 3, lineHeight: 1.3 },
  sectionLabel: { fontSize: 8, fontWeight: 'bold', textTransform: 'uppercase', color: '#000' },
  clientName: { fontSize: 12, fontWeight: 'bold', marginTop: 3 },
  clientLine: { fontSize: 9, color: '#000', marginTop: 4 },
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
  totalsWrap: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 22 },
  notesCol: { width: '48%', fontSize: 9 },
  sumCol: { width: '42%' },
  sumRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3, fontSize: 10 },
  sumTotal: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: 8, marginTop: 6, borderTopWidth: 2, borderColor: '#000' },
  sumTotalText: { fontSize: 13, fontWeight: 'bold' },
  bankWrap: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 32, borderTopWidth: 1, borderColor: '#eee', paddingTop: 18 },
  qr: { height: 92, width: 92 },
  powered: { marginTop: 22, fontSize: 8, color: '#555' },
});

function StandardHeader({ t, data, profile, type, accent }) {
  if (t === 'Modern') {
    return (
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: accent, padding: 24, borderRadius: 10, marginBottom: 28, color: '#fff' }}>
        <View style={{ maxWidth: '55%' }}>
          <Text style={{ fontSize: 28, fontWeight: 'bold', color: '#fff', lineHeight: 1.1 }}>{type.toUpperCase()}</Text>
          <Text style={{ fontSize: 10, color: '#fff', marginTop: 4 }}>No: {data.no} | {fmtD(data.date)}</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', maxWidth: '45%' }}>
          {profile?.logo ? (
            <View style={{ width: 46, marginRight: 10, backgroundColor: '#fff', borderRadius: 6, padding: 3 }}>
              <Image src={profile.logo} style={{ height: 40, width: 40, objectFit: 'contain' }} />
            </View>
          ) : null}
          <View>
            <Text style={{ fontSize: 13, fontWeight: 'bold', color: '#fff', textAlign: 'right' }}>{profile?.bizName || 'Your Business'}</Text>
            <Text style={{ fontSize: 9, color: '#fff', marginTop: 2, textAlign: 'right' }}>{[profile?.email, profile?.phone].filter(Boolean).join(' | ')}</Text>
          </View>
        </View>
      </View>
    );
  }
  if (t === 'Minimal') {
    return (
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 34 }}>
        <View>
          <Text style={{ fontSize: 22, fontWeight: 'normal', lineHeight: 1.1 }}>{type} #{data.no}</Text>
          <Text style={{ fontSize: 10, color: '#555', marginTop: 6 }}>Issued on {fmtD(data.date)}</Text>
        </View>
        {profile?.logo ? (
          <View style={{ width: 44 }}>
            <Image src={profile.logo} style={{ height: 44, width: 44, objectFit: 'contain' }} />
          </View>
        ) : null}
      </View>
    );
  }
  // Classic
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', width: '58%' }}>
        {profile?.logo ? (
          <View style={{ width: 54, marginRight: 14 }}>
            <Image src={profile.logo} style={{ height: 54, width: 54, objectFit: 'contain' }} />
          </View>
        ) : null}
        <View style={{ flex: 1 }}>
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
  );
}

function TotalsSummary({ ctx, data, type, boxed }) {
  const { money, ptots, isInterState } = ctx;
  return (
    <View style={[s.sumCol, boxed ? { backgroundColor: '#f8fafc', padding: 14, borderRadius: 8 } : null]}>
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
        <Text style={{ fontSize: 9, fontWeight: 'bold' }}>{numberToWords(ptots.total, ctx.docCurrency)}</Text>
      </View>
    </View>
  );
}

function BankBlock({ profile }) {
  if (!(profile?.bankName || profile?.qrCode)) return null;
  return (
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
      {profile?.qrCode ? (
        <View style={{ width: 92 }}><Image src={profile.qrCode} style={s.qr} /></View>
      ) : null}
    </View>
  );
}

function StandardDoc({ t, data, profile, type, settings }) {
  const accent = profile?.accentColor || DEFAULT_ACCENT;
  const ctx = buildCtx(data, profile);
  const { items, moneyNo } = ctx;
  return (
    <Document title={`${type} ${data.no || ''}`.trim()}>
      <Page size="A4" style={s.page}>
        <StandardHeader t={t} data={data} profile={profile} type={type} accent={accent} />

        {/* Client */}
        <View style={{ flexDirection: 'row', borderLeftWidth: t === 'Classic' ? 3 : 0, borderColor: accent, paddingLeft: t === 'Classic' ? 12 : 0, marginBottom: 24 }}>
          <View style={{ flex: 1 }}>
            <Text style={s.sectionLabel}>Billed To</Text>
            <Text style={s.clientName}>{ctx.clientMatch.companyName || data.companyName || data.client}</Text>
            {ctx.clientMatch.address ? <Text style={s.clientLine}>{ctx.clientMatch.address}</Text> : null}
            {ctx.clientMatch.gstin ? <Text style={s.clientLine}>GSTIN: {ctx.clientMatch.gstin}</Text> : null}
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
          <TotalsSummary ctx={ctx} data={data} type={type} boxed={t === 'Modern'} />
        </View>

        <BankBlock profile={profile} />

        {settings?.showBranding !== false ? (
          <Text style={s.powered}>POWERED BY {settings?.brandName || 'T2GCRM'}</Text>
        ) : null}
      </Page>
    </Document>
  );
}

// ─────────────────────────────────────────────── Spreadsheet template ──
const z = StyleSheet.create({
  page: { paddingVertical: 26, paddingHorizontal: 26, fontFamily: 'NotoSans', fontSize: 9, color: '#000', lineHeight: 1.4, flexDirection: 'column' },
  frame: { position: 'absolute', top: 16, left: 16, right: 16, bottom: 16, borderWidth: 2, borderColor: '#000' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 22 },
  bizName: { fontSize: 15, fontWeight: 'bold', textTransform: 'uppercase', marginBottom: 3 },
  bizLine: { fontSize: 10, color: '#000', lineHeight: 1.5 },
  title: { fontSize: 26, fontWeight: 'normal', textTransform: 'uppercase', marginBottom: 10, textAlign: 'right' },
  metaBox: { borderTopWidth: 2, borderColor: '#000', paddingTop: 8, minWidth: 200 },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, borderBottomWidth: 1, borderColor: '#eee' },
  metaKey: { fontSize: 9, fontWeight: 'bold', textTransform: 'uppercase', color: '#000' },
  metaVal: { fontSize: 10, fontWeight: 'bold' },
  billRow: { flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, borderColor: '#eee', paddingTop: 14, marginBottom: 18 },
  label: { fontSize: 9, fontWeight: 'bold', textTransform: 'uppercase', marginBottom: 6 },
  th: { flexDirection: 'row', backgroundColor: '#f0f0f0', borderTopWidth: 2, borderBottomWidth: 2, borderColor: '#000', paddingVertical: 8 },
  thText: { fontSize: 9, fontWeight: 'bold', textTransform: 'uppercase' },
  tr: { flexDirection: 'row', borderBottomWidth: 1, borderColor: '#000', paddingVertical: 9 },
  cNo: { width: 24, textAlign: 'center' },
  cItem: { flex: 1, paddingRight: 6 },
  cQty: { width: 52, textAlign: 'center' },
  cRate: { width: 66, textAlign: 'right' },
  cGst: { width: 58, textAlign: 'right' },
  cAmt: { width: 74, textAlign: 'right' },
  footWrap: { flexDirection: 'row', borderTopWidth: 1, borderColor: '#000', marginTop: 10 },
  bankCell: { width: '50%', padding: 14, borderRightWidth: 1, borderColor: '#ddd' },
  sumCell: { width: '50%', padding: 14 },
  sumRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3, fontSize: 10 },
  sumTotal: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, marginTop: 4, borderTopWidth: 2, borderBottomWidth: 2, borderColor: '#000' },
  sumTotalText: { fontSize: 14, fontWeight: 'bold' },
  bankGrid: { flexDirection: 'row', marginTop: 3 },
});

function SpreadsheetDoc({ data, profile, type, settings }) {
  const ctx = buildCtx(data, profile);
  const { items, money, moneyNo, ptots, clientMatch, isInterState } = ctx;
  return (
    <Document title={`${type} ${data.no || ''}`.trim()}>
      <Page size="A4" style={z.page}>
        {/* Border frame repeats on every page */}
        <View style={z.frame} fixed />

        {/* Header */}
        <View style={z.header}>
          <View style={{ width: '55%' }}>
            {profile?.logo ? (
              <View style={{ width: 120, marginBottom: 10 }}>
                <Image src={profile.logo} style={{ height: 54, width: 120, objectFit: 'contain' }} />
              </View>
            ) : null}
            <Text style={z.bizName}>{profile?.bizName}</Text>
            {profile?.address ? <Text style={z.bizLine}>{profile.address}</Text> : null}
            {profile?.gstin ? <Text style={[z.bizLine, { fontWeight: 'bold', marginTop: 4 }]}>GSTIN: {profile.gstin}</Text> : null}
          </View>
          <View style={{ width: '42%', alignItems: 'flex-end' }}>
            <Text style={z.title}>{type === 'Invoice' ? 'Tax Invoice' : 'Quotation'}</Text>
            <View style={z.metaBox}>
              <View style={z.metaRow}><Text style={z.metaKey}>Reference</Text><Text style={z.metaVal}>{data.no}</Text></View>
              <View style={z.metaRow}><Text style={z.metaKey}>Date</Text><Text style={z.metaVal}>{fmtD(data.date)}</Text></View>
              {type === 'Invoice' && data.dueDate ? <View style={z.metaRow}><Text style={z.metaKey}>Due Date</Text><Text style={z.metaVal}>{fmtD(data.dueDate)}</Text></View> : null}
              {type !== 'Invoice' && data.validUntil ? <View style={z.metaRow}><Text style={z.metaKey}>Valid Until</Text><Text style={z.metaVal}>{fmtD(data.validUntil)}</Text></View> : null}
            </View>
          </View>
        </View>

        {/* Bill To / Ship To */}
        <View style={z.billRow}>
          <View style={{ width: '48%' }}>
            <Text style={z.label}>Bill To</Text>
            <Text style={{ fontSize: 13, fontWeight: 'bold' }}>{clientMatch.companyName || data.companyName || data.client}</Text>
            {clientMatch.address ? <Text style={[z.bizLine, { marginTop: 4 }]}>{clientMatch.address}</Text> : null}
            {clientMatch.gstin ? <Text style={[z.bizLine, { fontWeight: 'bold', marginTop: 4 }]}>GSTIN: {clientMatch.gstin}</Text> : null}
          </View>
          {data.shipTo ? (
            <View style={{ width: '48%' }}>
              <Text style={z.label}>Ship To</Text>
              <Text style={z.bizLine}>{data.shipTo}</Text>
            </View>
          ) : null}
        </View>

        {/* Items */}
        <View style={z.th}>
          <Text style={[z.thText, z.cNo]}>#</Text>
          <Text style={[z.thText, z.cItem]}>Item &amp; Description</Text>
          <Text style={[z.thText, z.cQty]}>Qty</Text>
          <Text style={[z.thText, z.cRate]}>Rate</Text>
          {isInterState ? (
            <Text style={[z.thText, z.cGst]}>IGST</Text>
          ) : (
            <>
              <Text style={[z.thText, z.cGst]}>CGST</Text>
              <Text style={[z.thText, z.cGst]}>SGST</Text>
            </>
          )}
          <Text style={[z.thText, z.cAmt]}>Amount</Text>
        </View>
        {items.map((it, i) => {
          const itemTotal = (it.qty || 0) * (it.rate || 0);
          const taxRate = it.taxRate || 0;
          const taxAmt = itemTotal * taxRate / 100;
          return (
            <View style={z.tr} key={i} wrap={false}>
              <Text style={z.cNo}>{i + 1}</Text>
              <View style={z.cItem}>
                <Text style={{ fontSize: 10, fontWeight: 'bold' }}>{it.name}</Text>
                {it.sku ? <Text style={{ fontSize: 8, marginTop: 3 }}>Code: {it.sku}</Text> : null}
                {it.desc ? <Text style={{ fontSize: 9, marginTop: 3 }}>{it.desc}</Text> : null}
              </View>
              <Text style={z.cQty}>{Number(it.qty)} {it.unit || ''}</Text>
              <Text style={z.cRate}>{moneyNo(it.rate)}</Text>
              {isInterState ? (
                <View style={z.cGst}><Text>{itemTotal === 0 ? '-' : moneyNo(taxAmt)}</Text><Text style={{ fontSize: 7, color: '#555' }}>({taxRate}%)</Text></View>
              ) : (
                <>
                  <View style={z.cGst}><Text>{itemTotal === 0 ? '-' : moneyNo(taxAmt / 2)}</Text><Text style={{ fontSize: 7, color: '#555' }}>({taxRate / 2}%)</Text></View>
                  <View style={z.cGst}><Text>{itemTotal === 0 ? '-' : moneyNo(taxAmt / 2)}</Text><Text style={{ fontSize: 7, color: '#555' }}>({taxRate / 2}%)</Text></View>
                </>
              )}
              <Text style={[z.cAmt, { fontWeight: 'bold' }]}>{moneyNo(itemTotal)}</Text>
            </View>
          );
        })}

        {/* Notes / Terms — allowed to wrap so it fills the space right after the
            items instead of jumping to the next page and leaving a gap. */}
        {(data.notes || data.terms) ? (
          <View style={{ paddingVertical: 12 }}>
            {data.notes ? <><Text style={z.label}>Notes</Text><Text style={{ fontSize: 9, marginBottom: 8 }}>{data.notes}</Text></> : null}
            {data.terms ? <><Text style={z.label}>Terms &amp; Conditions</Text><Text style={{ fontSize: 9 }}>{data.terms}</Text></> : null}
          </View>
        ) : null}

        {/* Spacer pushes the bank/totals block to the bottom of the page */}
        <View style={{ flexGrow: 1 }} />

        {/* Footer: Bank Details | Totals */}
        <View style={z.footWrap} wrap={false}>
          <View style={z.bankCell}>
            {profile?.accHolder ? (
              <>
                <Text style={z.label}>Bank Details</Text>
                <Text style={{ fontSize: 10, marginTop: 3 }}>Bank Name : <Text style={{ fontWeight: 'bold' }}>{profile.bankName}</Text></Text>
                <Text style={{ fontSize: 10, marginTop: 3 }}>Account Name : <Text style={{ fontWeight: 'bold' }}>{profile.accHolder}</Text></Text>
                <Text style={{ fontSize: 10, marginTop: 3 }}>Account No. : <Text style={{ fontWeight: 'bold' }}>{profile.accountNo}</Text></Text>
                <Text style={{ fontSize: 10, marginTop: 3 }}>IFSC Code : <Text style={{ fontWeight: 'bold' }}>{profile.ifsc}</Text></Text>
                {profile.accType ? <Text style={{ fontSize: 10, marginTop: 3 }}>Account Type : <Text style={{ fontWeight: 'bold' }}>{profile.accType}</Text></Text> : null}
                {profile.bankExtra ? <Text style={{ fontSize: 10, marginTop: 3 }}>Branch : <Text style={{ fontWeight: 'bold' }}>{profile.bankExtra}</Text></Text> : null}
              </>
            ) : <Text style={{ fontSize: 9, color: '#aaa' }}>No bank details configured.</Text>}
            {profile?.qrCode ? (
              <View style={{ width: 84, marginTop: 10 }}><Image src={profile.qrCode} style={{ height: 84, width: 84 }} /></View>
            ) : null}
          </View>
          <View style={z.sumCell}>
            <View style={z.sumRow}><Text>Sub Total</Text><Text>{moneyNo(ptots.sub)}</Text></View>
            {ptots.discAmt > 0 ? <View style={z.sumRow}><Text>Discount ({data.discType === '₹' ? 'Flat' : `${data.disc}%`})</Text><Text style={{ color: '#d97706' }}>(-) {moneyNo(ptots.discAmt)}</Text></View> : null}
            {Object.entries(ptots.taxesByRate).map(([rateStr, tAmt]) => {
              const rate = parseFloat(rateStr);
              if (isInterState) return <View style={z.sumRow} key={`i-${rate}`}><Text>IGST{rate} ({rate}%)</Text><Text>{moneyNo(tAmt)}</Text></View>;
              const half = rate / 2;
              return (
                <React.Fragment key={`c-${rate}`}>
                  <View style={z.sumRow}><Text>CGST{half} ({half}%)</Text><Text>{moneyNo(tAmt / 2)}</Text></View>
                  <View style={z.sumRow}><Text>SGST{half} ({half}%)</Text><Text>{moneyNo(tAmt / 2)}</Text></View>
                </React.Fragment>
              );
            })}
            {parseFloat(data.deliveryCharge) > 0 ? <View style={z.sumRow}><Text>Delivery Charges</Text><Text>{moneyNo(parseFloat(data.deliveryCharge))}</Text></View> : null}
            {parseFloat(data.deliveryCharge) > 0 && parseFloat(data.deliveryTaxRate) > 0 ? <View style={z.sumRow}><Text>Delivery Tax ({data.deliveryTaxRate}%)</Text><Text>{moneyNo((parseFloat(data.deliveryCharge) || 0) * (parseFloat(data.deliveryTaxRate) || 0) / 100)}</Text></View> : null}
            {data.adj && Number(data.adj) !== 0 ? <View style={z.sumRow}><Text>Adjustment</Text><Text>{data.adj > 0 ? '(+) ' : '(-) '}{moneyNo(Math.abs(data.adj))}</Text></View> : null}
            <View style={z.sumTotal}><Text style={z.sumTotalText}>Total</Text><Text style={z.sumTotalText}>{money(ptots.total)}</Text></View>
            {type === 'Invoice' && ptots.paymentsTotal > 0 ? <View style={[z.sumRow, { marginTop: 6 }]}><Text style={{ color: '#dc2626' }}>Payment Made</Text><Text style={{ color: '#dc2626' }}>(-) {moneyNo(ptots.paymentsTotal)}</Text></View> : null}
            {type === 'Invoice' ? <View style={[z.sumRow, { marginTop: 4 }]}><Text style={{ fontWeight: 'bold', fontSize: 12 }}>Balance Due</Text><Text style={{ fontWeight: 'bold', fontSize: 12 }}>{money(ptots.balanceDue)}</Text></View> : null}
            <View style={{ marginTop: 8, borderTopWidth: 1, borderColor: '#ddd', paddingTop: 6 }}>
              <Text style={{ fontSize: 7, fontWeight: 'bold', textTransform: 'uppercase' }}>Total In Words</Text>
              <Text style={{ fontSize: 9, fontWeight: 'bold' }}>{numberToWords(ptots.total, ctx.docCurrency)}</Text>
            </View>
          </View>
        </View>

        {settings?.showBranding !== false ? (
          <Text style={{ fontSize: 8, color: '#555', paddingHorizontal: 14, paddingTop: 6 }}>POWERED BY {settings?.brandName || 'T2GCRM'}</Text>
        ) : null}
      </Page>
    </Document>
  );
}

// Resolve the template variant exactly like DocumentTemplate.jsx does.
function resolveTemplate(data, profile, type) {
  const profileTemplate = type === 'Invoice' ? profile?.invoiceTemplate : profile?.quotationTemplate;
  return profileTemplate || data.template || 'Classic';
}

function DocumentPdf({ data, profile, type, settings }) {
  const t = resolveTemplate(data, profile, type);
  if (t === 'Spreadsheet') return <SpreadsheetDoc data={data} profile={profile} type={type} settings={settings} />;
  return <StandardDoc t={t} data={data} profile={profile} type={type} settings={settings} />;
}

// Generates the PDF blob and triggers a browser download named by doc number.
// Returns true on success; caller can fall back to print on false.
export async function downloadDocumentPdf({ data, profile, type = 'Invoice', settings }) {
  const blob = await pdf(<DocumentPdf data={data} profile={profile} type={type} settings={settings} />).toBlob();
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

export default DocumentPdf;
