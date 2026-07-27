import React from 'react';
import { Document, Page, Text, View, Image, StyleSheet, pdf } from '@react-pdf/renderer';
import { fmt, currencySymbol } from '../../utils/helpers';

// A payment receipt is its own document, not a variant of the invoice: it
// acknowledges money received, so it carries the receipt number, the mode and
// the reference you would reconcile against a bank statement — and states which
// invoice it settles and what is still outstanding.

const c = { ink: '#111827', muted: '#6b7280', line: '#e5e7eb', green: '#16a34a', soft: '#f9fafb' };

const s = StyleSheet.create({
  page: { padding: 34, fontSize: 9.5, color: c.ink, fontFamily: 'Helvetica' },
  head: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 18 },
  logo: { width: 92, height: 46, objectFit: 'contain', marginBottom: 6 },
  bizName: { fontSize: 15, fontWeight: 'bold' },
  bizLine: { fontSize: 8.5, color: c.muted, marginTop: 1 },
  title: { fontSize: 17, fontWeight: 'bold', letterSpacing: 1, textAlign: 'center', marginBottom: 14 },
  amountBox: { backgroundColor: c.green, color: '#fff', padding: 12, borderRadius: 4, minWidth: 150 },
  amountLabel: { fontSize: 8.5, color: '#dcfce7' },
  amountValue: { fontSize: 15, fontWeight: 'bold', color: '#fff', marginTop: 3 },
  row: { flexDirection: 'row', paddingVertical: 5, borderBottomWidth: 0.5, borderBottomColor: c.line },
  label: { width: 150, color: c.muted },
  value: { flex: 1, fontWeight: 'bold' },
  sectionTitle: { fontSize: 10, fontWeight: 'bold', marginTop: 18, marginBottom: 6 },
  th: { flexDirection: 'row', backgroundColor: c.soft, paddingVertical: 5, paddingHorizontal: 6, borderBottomWidth: 0.5, borderBottomColor: c.line },
  tr: { flexDirection: 'row', paddingVertical: 5, paddingHorizontal: 6, borderBottomWidth: 0.5, borderBottomColor: c.line },
  cNo: { width: 110 }, cDate: { width: 80 }, cAmt: { flex: 1, textAlign: 'right' },
  bold: { fontWeight: 'bold' },
  sign: { marginTop: 46, alignItems: 'flex-end' },
  signLine: { borderTopWidth: 0.5, borderTopColor: c.ink, width: 150, paddingTop: 4, textAlign: 'center', fontSize: 8.5 },
  foot: { position: 'absolute', bottom: 24, left: 34, right: 34, textAlign: 'center', fontSize: 7.5, color: c.muted },
});

function Row({ label, children }) {
  return (
    <View style={s.row}>
      <Text style={s.label}>{label}</Text>
      <Text style={s.value}>{children || '—'}</Text>
    </View>
  );
}

export function PaymentReceiptDoc({ payment, invoice, profile }) {
  const cur = invoice?.currency || 'INR';
  const money = (n) => fmt(Number(n) || 0, cur);
  const payments = Array.isArray(invoice?.payments) ? invoice.payments : [];
  const paid = payments.reduce((a, p) => a + (Number(p.amount) || 0), 0);
  const balance = (Number(invoice?.total) || 0) - paid;
  const bizName = profile?.businessName || profile?.bizName || '';

  return (
    <Document>
      <Page size="A4" style={s.page}>
        <View style={s.head}>
          <View style={{ flex: 1 }}>
            {profile?.logoUrl ? <Image style={s.logo} src={profile.logoUrl} /> : null}
            <Text style={s.bizName}>{bizName}</Text>
            {profile?.address ? <Text style={s.bizLine}>{profile.address}</Text> : null}
            {profile?.bizState ? <Text style={s.bizLine}>{profile.bizState}</Text> : null}
            {profile?.gstin ? <Text style={s.bizLine}>GSTIN: {profile.gstin}</Text> : null}
            {profile?.phone ? <Text style={s.bizLine}>{profile.phone}</Text> : null}
          </View>
          <View style={s.amountBox}>
            <Text style={s.amountLabel}>Amount Received</Text>
            <Text style={s.amountValue}>{money(payment?.amount)}</Text>
          </View>
        </View>

        <Text style={s.title}>PAYMENT RECEIPT</Text>

        <Row label="Receipt No">{payment?.no}</Row>
        <Row label="Payment Date">{payment?.date}</Row>
        <Row label="Payment Mode">{payment?.mode}</Row>
        <Row label="Reference Number">{payment?.reference}</Row>
        <Row label="Received From">{invoice?.client}</Row>
        <Row label="Amount in Words">{amountInWords(payment?.amount, cur)}</Row>
        {payment?.notes ? <Row label="Notes">{payment.notes}</Row> : null}

        <Text style={s.sectionTitle}>Payment for</Text>
        <View style={s.th}>
          <Text style={[s.cNo, s.bold]}>Invoice Number</Text>
          <Text style={[s.cDate, s.bold]}>Invoice Date</Text>
          <Text style={[s.cAmt, s.bold]}>Invoice Amount</Text>
          <Text style={[s.cAmt, s.bold]}>Payment Amount</Text>
        </View>
        <View style={s.tr}>
          <Text style={s.cNo}>{invoice?.no}</Text>
          <Text style={s.cDate}>{invoice?.date}</Text>
          <Text style={s.cAmt}>{money(invoice?.total)}</Text>
          <Text style={[s.cAmt, s.bold]}>{money(payment?.amount)}</Text>
        </View>

        {/* What is still owed after this receipt — the question anyone holding
            a receipt actually wants answered. */}
        <View style={[s.row, { marginTop: 10, borderBottomWidth: 0 }]}>
          <Text style={s.label}>Total paid against this invoice</Text>
          <Text style={s.value}>{money(paid)}</Text>
        </View>
        <View style={[s.row, { borderBottomWidth: 0 }]}>
          <Text style={s.label}>Balance due</Text>
          <Text style={[s.value, { color: balance > 0.5 ? '#dc2626' : c.green }]}>
            {balance > 0.5 ? money(balance) : 'Fully paid'}
          </Text>
        </View>

        <View style={s.sign}>
          <Text style={s.signLine}>Authorized Signature</Text>
        </View>

        <Text style={s.foot}>
          {bizName ? `${bizName} · ` : ''}This is a computer-generated receipt.
        </Text>
      </Page>
    </Document>
  );
}

// Indian numbering (lakh/crore), which is what a receipt in INR is expected to
// read. Falls back to the plain amount for other currencies rather than
// printing an English scale that doesn't match the figure.
export function amountInWords(n, currency = 'INR') {
  const amount = Math.floor(Number(n) || 0);
  if (currency !== 'INR') return '';
  if (amount === 0) return 'Zero Only';
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
    'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const two = (x) => x < 20 ? ones[x] : `${tens[Math.floor(x / 10)]}${x % 10 ? ' ' + ones[x % 10] : ''}`;
  const three = (x) => `${x >= 100 ? ones[Math.floor(x / 100)] + ' Hundred' + (x % 100 ? ' ' : '') : ''}${x % 100 ? two(x % 100) : ''}`;
  const parts = [];
  const crore = Math.floor(amount / 10000000);
  const lakh = Math.floor((amount % 10000000) / 100000);
  const thousand = Math.floor((amount % 100000) / 1000);
  const rest = amount % 1000;
  if (crore) parts.push(`${three(crore)} Crore`);
  if (lakh) parts.push(`${three(lakh)} Lakh`);
  if (thousand) parts.push(`${three(thousand)} Thousand`);
  if (rest) parts.push(three(rest));
  return `Indian Rupee ${parts.join(' ')} Only`;
}

export async function downloadPaymentReceipt({ payment, invoice, profile }) {
  const blob = await pdf(<PaymentReceiptDoc payment={payment} invoice={invoice} profile={profile} />).toBlob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `Receipt-${payment?.no || 'payment'}.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return true;
}

export default PaymentReceiptDoc;
