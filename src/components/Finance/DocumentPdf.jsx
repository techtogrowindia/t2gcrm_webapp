// ── React-PDF renderer for invoices/quotations (BETA) ──
//
// Produces a real downloadable PDF file (named by document number, no browser
// print dialog). Wired as the "Download PDF" action in Invoices/Quotations; the
// "Print / Save PDF" (window.print of the HTML `DocumentTemplate.jsx`) path
// remains as a fallback.
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
import { fmt, fmtD, numberToWords, currencySymbol, resolveGstSplit, gstStateLabel } from '../../utils/helpers';
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
  // Prefer the split frozen onto the document at issue time; the live customer
  // lookup is only a fallback for documents saved before those fields existed.
  const { isInterState, known: gstKnown } = resolveGstSplit(data, profile, clientMatch);
  return { items, docCurrency, money, moneyNo, ptots, clientMatch, isInterState, gstKnown };
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

// Logo watermark — must be the FIRST child inside <Page>: react-pdf draws
// elements in render order (like a canvas, no CSS stacking context), so
// anything rendered after this paints on top of it. `fixed` repeats it on
// every physical page for documents that span more than one.
function LogoWatermark({ profile }) {
  if (!profile?.logoWatermark || !profile?.logo) return null;
  return (
    <View style={{ position: 'absolute', top: '32%', left: 0, right: 0, alignItems: 'center', opacity: 0.08 }} fixed>
      <Image src={profile.logo} style={{ width: 280, objectFit: 'contain' }} />
    </View>
  );
}

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
        <LogoWatermark profile={profile} />
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

        {/* A proforma is a pre-sale document, not a tax invoice — saying so on
            the page is what keeps it from being treated as one. */}
        {String(type).toLowerCase().includes('proforma') ? (
          <View style={{ marginBottom: 6 }}>
            <Text style={{ fontSize: 8, color: '#92400e' }}>
              This is a proforma invoice, not a tax invoice. No GST is payable against this document.
            </Text>
          </View>
        ) : null}
        {/* Required GST declaration — printed whether or not it applies. */}
        <View style={{ marginBottom: 6 }}>
          <Text style={{ fontSize: 8, color: '#555' }}>
            {data.placeOfSupply ? `Place of Supply: ${data.placeOfSupply}   ` : ''}
            Tax payable under reverse charge: {data.reverseCharge ? 'Yes' : 'No'}
          </Text>
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
              {/* HSN/SAC is mandatory on a GST invoice. Placed under the item
                  name rather than as its own column — the row is already tight
                  and this matches how Indian invoice layouts present it. */}
              {it.hsn ? <Text style={s.itemSub}>HSN/SAC: {it.hsn}</Text> : null}
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
  // lineHeight is required: without it react-pdf under-reserves the title's box
  // and the metaBox top border draws up through the text as a strikethrough.
  title: { fontSize: 26, fontWeight: 'normal', textTransform: 'uppercase', lineHeight: 1.1, marginBottom: 12, textAlign: 'right' },
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
        <LogoWatermark profile={profile} />
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

        {/* Notes / Terms */}
        {(data.notes || data.terms) ? (
          <View style={{ paddingVertical: 12 }} wrap={false}>
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

// ─────────────────────────────────────────────────── Formal Quote template ──
const f = StyleSheet.create({
  // paddingTop/Bottom reserve room for the fixed (repeating) header + footer so
  // body content never slides underneath them — on page 1 or any later page.
  page: { paddingTop: 176, paddingBottom: 74, paddingHorizontal: 40, fontFamily: 'NotoSans', fontSize: 10, color: '#000', lineHeight: 1.4 },
  headerFixed: { position: 'absolute', top: 30, left: 40, right: 40 },
  headerBox: { borderWidth: 1, borderColor: '#000', paddingHorizontal: 14, paddingTop: 8, paddingBottom: 18 },
  topBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  logoWrap: { width: 70, alignSelf: 'center', marginBottom: 6 },
  bizName: { fontSize: 22, fontWeight: 'bold', color: '#b91c1c', textAlign: 'center' },
  footerFixed: { position: 'absolute', bottom: 18, left: 40, right: 40, borderTopWidth: 1, borderColor: '#93c5fd', paddingTop: 6 },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 14 },
  // Border-collapse trick: the table wrapper draws the top+left edges once;
  // every cell only draws its own right+bottom edge. Adjacent cells then
  // share a single 1px line instead of each contributing their own border
  // (which doubled the thickness on every internal row/column line).
  table: { borderTopWidth: 1, borderLeftWidth: 1, borderColor: '#000' },
  th: { flexDirection: 'row' },
  thCell: { borderRightWidth: 1, borderBottomWidth: 1, borderColor: '#000', padding: 6, fontSize: 9, fontWeight: 'bold', color: '#b91c1c' },
  tr: { flexDirection: 'row' },
  td: { borderRightWidth: 1, borderBottomWidth: 1, borderColor: '#000', padding: 6, fontSize: 9 },
  cNo: { width: 30, textAlign: 'center' },
  cName: { flex: 1 },
  cQty: { width: 55, textAlign: 'center' },
  cRate: { width: 70, textAlign: 'right' },
  cAmt: { width: 80, textAlign: 'right' },
});

function FormalDoc({ data, profile, type, settings }) {
  const ctx = buildCtx(data, profile);
  const { items, money, moneyNo, ptots, clientMatch } = ctx;
  // Strip any enumerator the user typed (e.g. "1. ", "2) ") so the template's
  // own numbering doesn't produce "1. 1. …" double numbers.
  // No auto-numbering — each line is shown exactly as typed.
  const termsLines = (data.terms || '').split('\n').map(l => l.trim()).filter(Boolean);
  // Collapse the multi-line address into a single compact line so the repeating
  // page footer stays 1–2 lines tall and doesn't spill onto its own page.
  const compactAddress = (profile?.address || '').replace(/\s*\n\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();
  return (
    <Document title={`${type} ${data.no || ''}`.trim()}>
      <Page size="A4" style={f.page}>
        <LogoWatermark profile={profile} />

        {/* Boxed header — `fixed` so the box repeats at the top of every page */}
        <View style={f.headerFixed} fixed>
          <View style={f.headerBox}>
            {/* Top bar: GSTIN | Phone */}
            <View style={f.topBar}>
              <Text style={{ fontSize: 9 }}>{profile?.gstin ? `GSTIN : ${profile.gstin}` : ''}</Text>
              <Text style={{ fontSize: 9 }}>{profile?.bizPhone || ''}</Text>
            </View>

            {/* Centered logo + business name */}
            {profile?.logo ? (
              <View style={f.logoWrap}>
                <Image src={profile.logo} style={{ height: 50, width: 70, objectFit: 'contain' }} />
              </View>
            ) : null}
            <Text style={f.bizName}>{profile?.bizName || ''}</Text>
          </View>
        </View>

        {/* M/s. / Date row */}
        <View style={f.row}>
          <View>
            <Text>M/s. {clientMatch.companyName || data.companyName || ''}</Text>
            <Text style={{ marginTop: 3 }}>MOB: {clientMatch.phone || ''}</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text>Date- {fmtD(data.date)}</Text>
            <Text style={{ marginTop: 3 }}>{type === 'Invoice' ? 'Invoice No.' : 'Quote No.'}: {data.no}</Text>
          </View>
        </View>
        <Text style={{ marginBottom: 14 }}>CONTACT PERSON : {data.client || ''}</Text>

        <Text style={{ marginBottom: 18 }}>
          {(data.quoteFor && data.quoteFor.trim()) ? data.quoteFor : `Dear Mam/Sir,\nAs per the discussion we had, we are happy to provide our best ${type === 'Invoice' ? 'invoice' : 'quote'} for.`}
        </Text>

        {/* Items table */}
        <View style={f.table}>
        <View style={f.th}>
          <Text style={[f.thCell, f.cNo]}>S.NO</Text>
          <Text style={[f.thCell, f.cName]}>PRODUCT NAME</Text>
          <Text style={[f.thCell, f.cQty]}>QTY</Text>
          <Text style={[f.thCell, f.cRate]}>RATE</Text>
          <Text style={[f.thCell, f.cAmt]}>AMOUNT</Text>
        </View>
        {items.map((it, i) => {
          const descLines = (it.desc || '').split('\n').map(l => l.trim()).filter(Boolean);
          const itemTotal = (it.qty || 0) * (it.rate || 0);
          return (
            <View style={f.tr} key={i} wrap={false}>
              <Text style={[f.td, f.cNo]}>{i + 1}.</Text>
              <View style={[f.td, f.cName]}>
                <Text style={{ fontWeight: 'bold' }}>{it.name}</Text>
                {descLines.map((line, li) => (
                  <Text key={li} style={{ color: '#b91c1c', fontWeight: 'bold', marginTop: 2 }}>• {line}</Text>
                ))}
              </View>
              <Text style={[f.td, f.cQty]}>{it.qty} {it.unit || 'No'}</Text>
              <Text style={[f.td, f.cRate]}>{moneyNo(it.rate)}</Text>
              <Text style={[f.td, f.cAmt]}>{moneyNo(itemTotal)}</Text>
            </View>
          );
        })}
        {ptots.discAmt > 0 ? (
          <View style={f.tr} wrap={false}>
            <Text style={[f.td, f.cNo]}></Text>
            <Text style={[f.td, f.cName, { fontWeight: 'bold' }]}>Discount ({data.discType === '₹' ? 'Flat' : `${data.disc}%`})</Text>
            <Text style={[f.td, f.cQty]}></Text>
            <Text style={[f.td, f.cRate]}></Text>
            <Text style={[f.td, f.cAmt, { color: '#d97706' }]}>(-) {moneyNo(ptots.discAmt)}</Text>
          </View>
        ) : null}
        {ptots.taxTotal > 0 ? (
          <View style={f.tr} wrap={false}>
            <Text style={[f.td, f.cNo]}></Text>
            <Text style={[f.td, f.cName, { fontWeight: 'bold' }]}>GST{items[0]?.taxRate ? ` -${items[0].taxRate}%` : ''}</Text>
            <Text style={[f.td, f.cQty]}></Text>
            <Text style={[f.td, f.cRate]}></Text>
            <Text style={[f.td, f.cAmt]}>{moneyNo(ptots.taxTotal)}</Text>
          </View>
        ) : null}
        {parseFloat(data.deliveryCharge) > 0 ? (
          <View style={f.tr} wrap={false}>
            <Text style={[f.td, f.cNo]}></Text>
            <Text style={[f.td, f.cName, { fontWeight: 'bold' }]}>Delivery Charges</Text>
            <Text style={[f.td, f.cQty]}></Text>
            <Text style={[f.td, f.cRate]}></Text>
            <Text style={[f.td, f.cAmt]}>{moneyNo(parseFloat(data.deliveryCharge))}</Text>
          </View>
        ) : null}
        {parseFloat(data.deliveryCharge) > 0 && parseFloat(data.deliveryTaxRate) > 0 ? (
          <View style={f.tr} wrap={false}>
            <Text style={[f.td, f.cNo]}></Text>
            <Text style={[f.td, f.cName, { fontWeight: 'bold' }]}>Delivery Tax ({data.deliveryTaxRate}%)</Text>
            <Text style={[f.td, f.cQty]}></Text>
            <Text style={[f.td, f.cRate]}></Text>
            <Text style={[f.td, f.cAmt]}>{moneyNo((parseFloat(data.deliveryCharge) || 0) * (parseFloat(data.deliveryTaxRate) || 0) / 100)}</Text>
          </View>
        ) : null}
        {data.adj && Number(data.adj) !== 0 ? (
          <View style={f.tr} wrap={false}>
            <Text style={[f.td, f.cNo]}></Text>
            <Text style={[f.td, f.cName, { fontWeight: 'bold' }]}>Adjustment</Text>
            <Text style={[f.td, f.cQty]}></Text>
            <Text style={[f.td, f.cRate]}></Text>
            <Text style={[f.td, f.cAmt]}>{data.adj > 0 ? '(+) ' : '(-) '}{moneyNo(Math.abs(data.adj))}</Text>
          </View>
        ) : null}
        <View style={f.tr} wrap={false}>
          <Text style={[f.td, f.cNo]}></Text>
          <Text style={[f.td, f.cName, { textAlign: 'right', fontWeight: 'bold', color: '#b91c1c' }]}>Total</Text>
          <Text style={[f.td, f.cQty]}></Text>
          <Text style={[f.td, f.cRate]}></Text>
          <Text style={[f.td, f.cAmt, { fontWeight: 'bold', color: '#b91c1c' }]}>{money(ptots.total)}</Text>
        </View>
        </View>
        <Text style={{ fontSize: 8, marginBottom: 4, marginTop: 4 }}>Total In Words: {numberToWords(ptots.total, ctx.docCurrency)}</Text>

        {/* Terms and Conditions */}
        {termsLines.length > 0 ? (
          <View style={{ marginTop: 18, marginBottom: 18 }} wrap={false}>
            <Text style={{ fontWeight: 'bold', marginBottom: 6 }}>TERMS AND CONDITIONS</Text>
            {termsLines.map((line, i) => (
              <Text key={i} style={{ marginBottom: 3 }}>{line}</Text>
            ))}
          </View>
        ) : null}

        {data.notes ? <Text style={{ marginBottom: 18 }}>{data.notes}</Text> : null}

        <Text style={{ marginBottom: 20 }}>
          Thank you for giving us the opportunity to serve you. As always, it's a pleasure doing business with you.
        </Text>

        {/* Bank Details | Signature */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }} wrap={false}>
          <View style={{ maxWidth: '55%' }}>
            {profile?.bankName ? (
              <>
                <Text style={{ fontWeight: 'bold', marginBottom: 5 }}>BANK DETAILS:</Text>
                <Text>Bank Name: {profile.bankName}</Text>
                <Text style={{ marginTop: 2 }}>A/C Holder Name: {profile.accHolder}</Text>
                <Text style={{ marginTop: 2 }}>A/C No.: {profile.accountNo}</Text>
                {profile.bankExtra ? <Text style={{ marginTop: 2 }}>Branch: {profile.bankExtra}</Text> : null}
                <Text style={{ marginTop: 2 }}>IFSC Code: {profile.ifsc}</Text>
              </>
            ) : null}
          </View>
          <View style={{ alignItems: 'center' }}>
            <Text>For {profile?.bizName || ''}</Text>
            {profile?.signature ? (
              <View style={{ width: 100, marginVertical: 8 }}>
                <Image src={profile.signature} style={{ height: 45, width: 100, objectFit: 'contain' }} />
              </View>
            ) : <View style={{ height: 53 }} />}
            <Text style={{ fontWeight: 'bold' }}>Authorised Signatory</Text>
          </View>
        </View>

        {/* Footer — `fixed` + absolute bottom so it sits at the page bottom and
            repeats on every page */}
        <View style={f.footerFixed} fixed>
          {compactAddress ? <Text style={{ textAlign: 'center', color: '#1e40af', fontSize: 9 }}>{compactAddress}{profile?.bizEmail ? `  |  E-mail : ${profile.bizEmail}` : ''}</Text> : (
            profile?.bizEmail ? <Text style={{ textAlign: 'center', color: '#1e40af', fontSize: 9 }}>E-mail : {profile.bizEmail}</Text> : null
          )}
          {settings?.showBranding !== false ? (
            <Text style={{ fontSize: 8, color: '#555', textAlign: 'center', marginTop: 3 }}>POWERED BY {settings?.brandName || 'T2GCRM'}</Text>
          ) : null}
        </View>
      </Page>
    </Document>
  );
}

// ───────────────────────────────────────── GST-compliant tax invoice ──
// Mirrors the `GST` branch in DocumentTemplate.jsx. Uses the border-collapse
// trick (frame draws the outer box; each cell draws only its right/bottom edge)
// for clean single-line rules. Carries every Rule 46 field the audit found
// missing from the other templates: place of supply + state codes, reverse
// charge, HSN-wise tax summary, amount in words, declaration + signatory.
const gz = StyleSheet.create({
  page: { padding: 22, fontFamily: 'NotoSans', fontSize: 9, color: '#000', lineHeight: 1.35 },
  frame: { borderWidth: 1, borderColor: '#000' },
  band: { textAlign: 'center', fontSize: 7, paddingVertical: 2, borderBottomWidth: 1, borderColor: '#000' },
  title: { textAlign: 'center', fontSize: 14, fontWeight: 'bold', paddingVertical: 5, borderBottomWidth: 1, borderColor: '#000' },
  row: { flexDirection: 'row' },
  bizBox: { width: '58%', borderRightWidth: 1, borderColor: '#000', padding: 6 },
  metaBox: { width: '42%' },
  metaRow: { flexDirection: 'row', borderBottomWidth: 1, borderColor: '#000' },
  metaKey: { width: '45%', padding: 4, fontWeight: 'bold', borderRightWidth: 1, borderColor: '#000' },
  metaVal: { width: '55%', padding: 4 },
  partyRow: { flexDirection: 'row', borderTopWidth: 1, borderBottomWidth: 1, borderColor: '#000' },
  partyCell: { width: '50%', padding: 6 },
  label: { fontSize: 7, fontWeight: 'bold', textTransform: 'uppercase', marginBottom: 2 },
  bizName: { fontSize: 12, fontWeight: 'bold' },
  line: { fontSize: 9, marginTop: 1 },
  thead: { flexDirection: 'row', backgroundColor: '#eee', borderBottomWidth: 1, borderColor: '#000' },
  th: { borderRightWidth: 1, borderColor: '#000', padding: 4, fontSize: 7.5, fontWeight: 'bold', textAlign: 'center' },
  tr: { flexDirection: 'row', borderBottomWidth: 1, borderColor: '#000' },
  td: { borderRightWidth: 1, borderColor: '#000', padding: 4, fontSize: 8.5 },
  cNo: { width: 20, textAlign: 'center' },
  cDesc: { flex: 1 },
  cHsn: { width: 50, textAlign: 'center' },
  cQty: { width: 40, textAlign: 'center' },
  cRate: { width: 50, textAlign: 'right' },
  cTaxable: { width: 55, textAlign: 'right' },
  cGst: { width: 50, textAlign: 'right' },
  cAmt: { width: 58, textAlign: 'right' },
  sub: { fontSize: 7, color: '#555' },
  totWrap: { flexDirection: 'row', borderBottomWidth: 1, borderColor: '#000' },
  wordsCell: { width: '58%', borderRightWidth: 1, borderColor: '#000', padding: 6 },
  sumCell: { width: '42%' },
  sumRow: { flexDirection: 'row', justifyContent: 'space-between', padding: 4, borderBottomWidth: 1, borderColor: '#000' },
  sumTotal: { flexDirection: 'row', justifyContent: 'space-between', padding: 5, fontWeight: 'bold', fontSize: 11 },
  footRow: { flexDirection: 'row', borderTopWidth: 1, borderColor: '#000' },
  bankCell: { width: '50%', borderRightWidth: 1, borderColor: '#000', padding: 6 },
  signCell: { width: '50%', padding: 6 },
});

function GstDoc({ data, profile, type, settings }) {
  const ctx = buildCtx(data, profile);
  const { items, money, moneyNo, ptots, clientMatch, isInterState, docCurrency, gstKnown } = ctx;
  const isInv = type === 'Invoice';
  // Bill of Supply (composition/exempt) charges no GST — suppress tax columns,
  // per-rate lines and the HSN tax summary. Title is user-selectable.
  const isBoS = isInv && profile?.invoiceDocTitle === 'Bill of Supply';
  const docTitle = isInv ? String(profile?.invoiceDocTitle || 'Tax Invoice').toUpperCase() : 'QUOTATION';
  const showTax = !isBoS;
  const supplierStateLabel = gstStateLabel(data.supplierState || profile?.bizState || '');
  const buyerState = data.placeOfSupply || clientMatch.state || '';
  const posLabel = gstStateLabel(buyerState);
  const billStateLabel = gstStateLabel(clientMatch.state || buyerState);
  const rateSummary = Object.entries(ptots.taxesByRate).sort((a, b) => Number(a[0]) - Number(b[0]));
  const shipToText = data.shipTo
    ? data.shipTo
    : [(clientMatch.companyName || data.companyName || data.client), clientMatch.address].filter(Boolean).join('\n');
  return (
    <Document title={`${type} ${data.no || ''}`.trim()}>
      <Page size="A4" style={gz.page}>
        <LogoWatermark profile={profile} />
        <View style={[gz.frame, { flexGrow: 1 }]}>
          <Text style={gz.band}>ORIGINAL FOR RECIPIENT</Text>
          <Text style={gz.title}>{docTitle}</Text>
          {showTax && !gstKnown ? (
            <Text style={{ textAlign: 'center', fontSize: 8, padding: 3, borderBottomWidth: 1, borderColor: '#000', backgroundColor: '#fff7ed', color: '#9a3412' }}>Place of supply not set — tax split defaulted to CGST/SGST. Set the client&#39;s state before issuing.</Text>
          ) : null}

          {/* Supplier + document meta */}
          <View style={gz.row}>
            <View style={gz.bizBox}>
              {profile?.logo ? <Image src={profile.logo} style={{ height: 40, width: 120, objectFit: 'contain', marginBottom: 5 }} /> : null}
              <Text style={gz.bizName}>{profile?.bizName}</Text>
              {profile?.address ? <Text style={gz.line}>{profile.address}</Text> : null}
              {profile?.gstin ? <Text style={[gz.line, { fontWeight: 'bold', marginTop: 2 }]}>GSTIN: {profile.gstin}</Text> : null}
              {supplierStateLabel ? <Text style={gz.line}>State: {supplierStateLabel}</Text> : null}
              {(profile?.phone || profile?.email) ? <Text style={gz.line}>{[profile?.phone, profile?.email].filter(Boolean).join('  •  ')}</Text> : null}
            </View>
            <View style={gz.metaBox}>
              {[
                [isInv ? 'Invoice No.' : 'Quote No.', data.no],
                ['Date', fmtD(data.date)],
                ...(isInv && data.dueDate ? [['Due Date', fmtD(data.dueDate)]] : []),
                ...(!isInv && data.validUntil ? [['Valid Until', fmtD(data.validUntil)]] : []),
                ['Place of Supply', posLabel || '—'],
                ...(showTax ? [['Reverse Charge', data.reverseCharge ? 'Yes' : 'No']] : []),
              ].map(([k, v], i) => (
                <View style={gz.metaRow} key={i}><Text style={gz.metaKey}>{k}</Text><Text style={gz.metaVal}>{v}</Text></View>
              ))}
            </View>
          </View>

          {/* Bill To / Ship To */}
          <View style={gz.partyRow}>
            <View style={[gz.partyCell, { borderRightWidth: 1, borderColor: '#000' }]}>
              <Text style={gz.label}>Bill To</Text>
              <Text style={{ fontSize: 11, fontWeight: 'bold' }}>{clientMatch.companyName || data.companyName || data.client}</Text>
              {clientMatch.address ? <Text style={gz.line}>{clientMatch.address}</Text> : null}
              {clientMatch.gstin ? <Text style={[gz.line, { fontWeight: 'bold', marginTop: 2 }]}>GSTIN: {clientMatch.gstin}</Text> : null}
              {billStateLabel ? <Text style={gz.line}>State: {billStateLabel}</Text> : null}
            </View>
            <View style={gz.partyCell}>
              <Text style={gz.label}>Ship To</Text>
              <Text style={gz.line}>{shipToText}</Text>
            </View>
          </View>

          {/* Line items */}
          <View style={gz.thead}>
            <Text style={[gz.th, gz.cNo]}>#</Text>
            <Text style={[gz.th, gz.cDesc, { textAlign: 'left' }]}>Description</Text>
            <Text style={[gz.th, gz.cHsn]}>HSN/SAC</Text>
            <Text style={[gz.th, gz.cQty]}>Qty</Text>
            <Text style={[gz.th, gz.cRate]}>Rate</Text>
            {showTax ? <Text style={[gz.th, gz.cTaxable]}>Taxable</Text> : null}
            {showTax ? (isInterState ? <Text style={[gz.th, gz.cGst]}>IGST</Text> : (<><Text style={[gz.th, gz.cGst]}>CGST</Text><Text style={[gz.th, gz.cGst]}>SGST</Text></>)) : null}
            <Text style={[gz.th, gz.cAmt, { borderRightWidth: 0 }]}>Amount</Text>
          </View>
          {items.map((it, i) => {
            const li = ptots.perItem[i] || { taxable: 0, tax: 0, taxRate: 0 };
            return (
              <View style={gz.tr} key={i} wrap={false}>
                <Text style={[gz.td, gz.cNo]}>{i + 1}</Text>
                <View style={[gz.td, gz.cDesc]}>
                  <Text style={{ fontWeight: 'bold' }}>{it.name}</Text>
                  {it.desc ? <Text style={gz.sub}>{it.desc}</Text> : null}
                </View>
                <Text style={[gz.td, gz.cHsn]}>{it.hsn || '-'}</Text>
                <Text style={[gz.td, gz.cQty]}>{Number(it.qty)} {it.unit || ''}</Text>
                <Text style={[gz.td, gz.cRate]}>{moneyNo(it.rate)}</Text>
                {showTax ? <Text style={[gz.td, gz.cTaxable]}>{moneyNo(li.taxable)}</Text> : null}
                {showTax ? (isInterState ? (
                  <View style={[gz.td, gz.cGst]}><Text>{li.tax === 0 ? '-' : moneyNo(li.tax)}</Text>{li.tax !== 0 ? <Text style={gz.sub}>({li.taxRate}%)</Text> : null}</View>
                ) : (<>
                  <View style={[gz.td, gz.cGst]}><Text>{li.tax === 0 ? '-' : moneyNo(li.tax / 2)}</Text>{li.tax !== 0 ? <Text style={gz.sub}>({li.taxRate / 2}%)</Text> : null}</View>
                  <View style={[gz.td, gz.cGst]}><Text>{li.tax === 0 ? '-' : moneyNo(li.tax / 2)}</Text>{li.tax !== 0 ? <Text style={gz.sub}>({li.taxRate / 2}%)</Text> : null}</View>
                </>)) : null}
                <Text style={[gz.td, gz.cAmt, { borderRightWidth: 0, fontWeight: 'bold' }]}>{moneyNo(li.taxable + li.tax)}</Text>
              </View>
            );
          })}

          {/* Notes & Terms — below items, above totals */}
          {(data.notes || data.terms) ? (
            <View style={{ padding: 6, borderBottomWidth: 1, borderColor: '#000' }} wrap={false}>
              {data.notes ? (<><Text style={gz.label}>Notes</Text><Text style={{ fontSize: 9, marginBottom: data.terms ? 5 : 0 }}>{data.notes}</Text></>) : null}
              {data.terms ? (<><Text style={gz.label}>Terms &amp; Conditions</Text><Text style={{ fontSize: 9 }}>{data.terms}</Text></>) : null}
            </View>
          ) : null}

          {/* Amount in words + totals */}
          <View style={gz.totWrap}>
            <View style={gz.wordsCell}>
              <Text style={gz.label}>Amount in words</Text>
              <Text style={{ fontSize: 9 }}>{numberToWords(ptots.total, docCurrency)}</Text>
            </View>
            <View style={gz.sumCell}>
              <View style={gz.sumRow}><Text>{showTax ? 'Taxable Value' : 'Amount'}</Text><Text>{moneyNo(ptots.sub - ptots.discAmt)}</Text></View>
              {ptots.discAmt > 0 ? <View style={gz.sumRow}><Text>Discount</Text><Text>(-) {moneyNo(ptots.discAmt)}</Text></View> : null}
              {showTax ? rateSummary.map(([rate, amt]) => isInterState
                ? <View style={gz.sumRow} key={rate}><Text>IGST {rate}%</Text><Text>{moneyNo(amt)}</Text></View>
                : (
                  <React.Fragment key={rate}>
                    <View style={gz.sumRow}><Text>CGST {Number(rate) / 2}%</Text><Text>{moneyNo(amt / 2)}</Text></View>
                    <View style={gz.sumRow}><Text>SGST {Number(rate) / 2}%</Text><Text>{moneyNo(amt / 2)}</Text></View>
                  </React.Fragment>
                )) : null}
              {ptots.roundOff ? <View style={gz.sumRow}><Text>Round Off</Text><Text>{moneyNo(ptots.roundOff)}</Text></View> : null}
              <View style={gz.sumTotal}><Text>Total</Text><Text>{money(ptots.total)}</Text></View>
            </View>
          </View>

          {/* HSN-wise tax summary — tax invoice only (a Bill of Supply has no tax) */}
          {showTax ? (<>
          <View style={gz.thead}>
            <Text style={[gz.th, { flex: 1, textAlign: 'left' }]}>HSN/SAC</Text>
            <Text style={[gz.th, gz.cTaxable]}>Taxable</Text>
            {isInterState ? <Text style={[gz.th, gz.cGst]}>IGST</Text> : (<><Text style={[gz.th, gz.cGst]}>CGST</Text><Text style={[gz.th, gz.cGst]}>SGST</Text></>)}
            <Text style={[gz.th, gz.cGst, { borderRightWidth: 0 }]}>Total Tax</Text>
          </View>
          {ptots.hsnSummary.map((h, i) => (
            <View style={gz.tr} key={i} wrap={false}>
              <Text style={[gz.td, { flex: 1 }]}>{h.hsn || '-'}</Text>
              <Text style={[gz.td, gz.cTaxable]}>{moneyNo(h.taxable)}</Text>
              {isInterState ? <Text style={[gz.td, gz.cGst]}>{moneyNo(h.tax)}</Text> : (<><Text style={[gz.td, gz.cGst]}>{moneyNo(h.tax / 2)}</Text><Text style={[gz.td, gz.cGst]}>{moneyNo(h.tax / 2)}</Text></>)}
              <Text style={[gz.td, gz.cGst, { borderRightWidth: 0, fontWeight: 'bold' }]}>{moneyNo(h.tax)}</Text>
            </View>
          ))}
          </>) : null}

          {/* Spacer — grows to push the footer to the bottom of the fixed page */}
          <View style={{ flexGrow: 1 }} />

          {/* Bank details + declaration / signatory — pinned to page bottom */}
          <View style={gz.footRow}>
            <View style={gz.bankCell}>
              {(profile?.bankName || profile?.qrCode) ? (<>
                <Text style={gz.label}>Bank Details</Text>
                {profile?.bankName ? <Text style={gz.line}>Bank: {profile.bankName}</Text> : null}
                {profile?.accountNo ? <Text style={gz.line}>A/C No: {profile.accountNo}</Text> : null}
                {profile?.ifsc ? <Text style={gz.line}>IFSC: {profile.ifsc}</Text> : null}
                {profile?.bankExtra ? <Text style={gz.line}>{profile.bankExtra}</Text> : null}
                {profile?.qrCode ? <Image src={profile.qrCode} style={{ height: 72, width: 72, marginTop: 5 }} /> : null}
              </>) : null}
            </View>
            <View style={gz.signCell}>
              {isBoS ? <Text style={{ fontSize: 8, color: '#9a3412', fontWeight: 'bold', marginBottom: 6 }}>This is a Bill of Supply. No GST is charged on the supplies listed above.</Text> : null}
              <Text style={{ fontSize: 8, color: '#333', marginBottom: 22 }}><Text style={{ fontWeight: 'bold' }}>Declaration: </Text>We declare that this {isBoS ? 'bill of supply' : (isInv ? 'invoice' : 'quotation')} shows the actual price of the goods/services described and that all particulars are true and correct.</Text>
              <Text style={{ textAlign: 'right', fontWeight: 'bold' }}>For {profile?.bizName}</Text>
              <Text style={{ textAlign: 'right', marginTop: 28 }}>Authorised Signatory</Text>
            </View>
          </View>
        </View>
        {settings?.showBranding !== false ? (
          <Text style={{ fontSize: 8, color: '#555', marginTop: 6 }}>POWERED BY {settings?.brandName || 'T2GCRM'}</Text>
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
  if (t === 'GST') return <GstDoc data={data} profile={profile} type={type} settings={settings} />;
  if (t === 'Spreadsheet') return <SpreadsheetDoc data={data} profile={profile} type={type} settings={settings} />;
  if (t === 'Formal') return <FormalDoc data={data} profile={profile} type={type} settings={settings} />;
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
