import React, { useState } from 'react';

// ─────────────────────────────────────────────────────────────────────────────
// WhatsApp Template Variable Guide
//
// SELF-DOCUMENTING RULE (CLAUDE.md):
// Whenever a new #variable# is added to any fireAutoNotifications() call site
// or to the date resolver in messaging.js, ADD IT HERE in the correct module
// section — with a description and an example value. This page is the single
// source of truth for template authors.
// ─────────────────────────────────────────────────────────────────────────────

const MODULES = [
  {
    id: 'lead_created',
    label: '📋 Lead Created',
    trigger: 'lead_created',
    how: 'Fires automatically when a new lead is saved.',
    recipient: 'Client (lead\'s phone) or Owner',
    variables: [
      { name: '#lead#',          desc: 'Lead\'s full name',                    example: 'Rajesh Kumar' },
      { name: '#client#',        desc: 'Same as lead name (alias)',             example: 'Rajesh Kumar' },
      { name: '#phone#',         desc: 'Recipient field — DO NOT use in body',  example: '919876543210', special: true },
      { name: '#leadphoneno#',   desc: 'Lead phone number (use inside body)',   example: '919876543210' },
      { name: '#stage#',         desc: 'Current lead stage',                    example: 'New Enquiry' },
      { name: '#source#',        desc: 'Lead source',                           example: 'IndiaMart' },
      { name: '#email#',         desc: 'Lead\'s email address',                 example: 'rajesh@example.com' },
      { name: '#date#',          desc: 'Today\'s date (DD/MM/YYYY)',            example: '10/06/2026' },
      { name: '#bizName#',       desc: 'Your business name',                    example: 'Tech To Grow' },
    ],
    example: `Hi #client#, thank you for your enquiry!\nWe received your lead from #source# and will contact you shortly.\n— #bizName#`,
  },
  {
    id: 'lead_stage_changed',
    label: '🔄 Lead Stage Changed',
    trigger: 'lead_stage_changed',
    how: 'Fires automatically when a lead\'s stage is updated.',
    recipient: 'Client (lead\'s phone) or Owner',
    variables: [
      { name: '#lead#',          desc: 'Lead\'s full name',                    example: 'Rajesh Kumar' },
      { name: '#client#',        desc: 'Same as lead name (alias)',             example: 'Rajesh Kumar' },
      { name: '#fromstage#',     desc: 'Previous stage',                        example: 'New Enquiry' },
      { name: '#tostage#',       desc: 'New/current stage',                     example: 'Warm' },
      { name: '#stage#',         desc: 'Current stage (same as tostage)',        example: 'Warm' },
      { name: '#assignee#',      desc: 'Assigned staff member',                 example: 'Amulu' },
      { name: '#leadphoneno#',   desc: 'Lead phone number (use inside body)',   example: '919876543210' },
      { name: '#date#',          desc: 'Today\'s date',                         example: '10/06/2026' },
    ],
    example: `Hi #client#, your enquiry has been updated.\nStatus: #fromstage# → #tostage#\nAssigned to: #assignee#`,
  },
  {
    id: 'lead_assigned',
    label: '👤 Lead Assigned to Staff',
    trigger: 'lead_assigned',
    how: 'Fires when a lead is assigned or reassigned to a team member.',
    recipient: 'Client (lead\'s phone) or Owner',
    variables: [
      { name: '#lead#',          desc: 'Lead\'s full name',                    example: 'Rajesh Kumar' },
      { name: '#client#',        desc: 'Same as lead name (alias)',             example: 'Rajesh Kumar' },
      { name: '#assignee#',      desc: 'Staff member assigned to this lead',    example: 'Karuppasamy' },
      { name: '#stage#',         desc: 'Current lead stage',                    example: 'Warm' },
      { name: '#leadphoneno#',   desc: 'Lead phone number (use inside body)',   example: '919876543210' },
      { name: '#date#',          desc: 'Today\'s date',                         example: '10/06/2026' },
    ],
    example: `Hi #client#, your enquiry has been assigned to #assignee#.\nThey will contact you shortly.`,
  },
  {
    id: 'customer_created',
    label: '🏆 Lead Converted to Customer',
    trigger: 'customer_created',
    how: 'Fires automatically when a lead\'s stage moves to Won.',
    recipient: 'Client (lead\'s phone) or Owner',
    variables: [
      { name: '#lead#',          desc: 'Customer\'s full name',                example: 'Rajesh Kumar' },
      { name: '#client#',        desc: 'Same as customer name (alias)',         example: 'Rajesh Kumar' },
      { name: '#stage#',         desc: 'Won stage name',                        example: 'Won' },
      { name: '#leadphoneno#',   desc: 'Customer phone (use inside body)',      example: '919876543210' },
      { name: '#date#',          desc: 'Today\'s date',                         example: '10/06/2026' },
      { name: '#bizName#',       desc: 'Your business name',                    example: 'Tech To Grow' },
    ],
    example: `Congratulations #client#! 🎉\nWelcome to the #bizName# family.\nWe look forward to serving you!`,
  },
  {
    id: 'lead_followup',
    label: '📅 Lead Follow-up Reminder',
    trigger: 'lead_followup',
    how: 'Fired by the daily cron N days before a lead\'s follow-up date. Set "Days before follow-up" on the template (default: 1).',
    recipient: 'Client (lead\'s phone) or Owner',
    variables: [
      { name: '#lead#',          desc: 'Lead\'s full name',                    example: 'Rajesh Kumar' },
      { name: '#client#',        desc: 'Same as lead name (alias)',             example: 'Rajesh Kumar' },
      { name: '#followupdate#',  desc: 'Follow-up date & time (DD/MM/YYYY HH:MM)', example: '15/06/2026 10:30' },
      { name: '#daysLeft#',      desc: 'Days until follow-up',                  example: '1' },
      { name: '#stage#',         desc: 'Current lead stage',                    example: 'Warm' },
      { name: '#assignee#',      desc: 'Assigned staff member',                 example: 'Karuppasamy' },
      { name: '#leadphoneno#',   desc: 'Lead phone number (use inside body)',   example: '919876543210' },
      { name: '#date#',          desc: 'Today\'s date',                         example: '14/06/2026' },
    ],
    example: `Hi #client#, this is a reminder that your follow-up is scheduled on #followupdate#.\nOur team member #assignee# will connect with you.\n— #bizName#`,
  },
  {
    id: 'quotation_created',
    label: '📄 Quotation Created',
    trigger: 'quotation_created',
    how: 'Fires automatically when a new quotation is saved.',
    recipient: 'Client (their phone) or Owner',
    variables: [
      { name: '#client#',        desc: 'Client / company name',                 example: 'ABC Corp' },
      { name: '#clientphoneno#', desc: 'Client phone number (use inside body)', example: '919876543210' },
      { name: '#quoteno#',       desc: 'Quotation number',                      example: 'QUOTE/2026/001' },
      { name: '#amount#',        desc: 'Total quotation amount',                example: '25000' },
      { name: '#validuntil#',    desc: 'Quote validity date (YYYY-MM-DD)',       example: '2026-07-10' },
      { name: '#date#',          desc: 'Date quotation was created',             example: '10/06/2026' },
      { name: '#bizName#',       desc: 'Your business name',                    example: 'Tech To Grow' },
    ],
    example: `Hi #client#, your quotation #quoteno# for ₹#amount# is ready.\nValid until: #validuntil#\nReply to confirm — #bizName#`,
  },
  {
    id: 'invoice_created',
    label: '🧾 Invoice Created',
    trigger: 'invoice_created',
    how: 'Fires automatically when a new invoice is saved.',
    recipient: 'Client (their phone) or Owner',
    variables: [
      { name: '#client#',        desc: 'Client / company name',                 example: 'ABC Corp' },
      { name: '#clientphoneno#', desc: 'Client phone number (use inside body)', example: '919876543210' },
      { name: '#invoiceno#',     desc: 'Invoice number',                        example: 'INV/2026/001' },
      { name: '#amount#',        desc: 'Invoice total amount',                  example: '29500' },
      { name: '#date#',          desc: 'Invoice date',                          example: '10/06/2026' },
      { name: '#bizName#',       desc: 'Your business name',                    example: 'Tech To Grow' },
    ],
    example: `Hi #client#, Invoice #invoiceno# for ₹#amount# has been generated.\nPlease make payment at your earliest convenience.\n— #bizName#`,
  },
  {
    id: 'payment_received',
    label: '💰 Payment Received',
    trigger: 'payment_received',
    how: 'Fires automatically when a payment is logged on an invoice.',
    recipient: 'Client (their phone) or Owner',
    variables: [
      { name: '#client#',        desc: 'Client / company name',                 example: 'ABC Corp' },
      { name: '#clientphoneno#', desc: 'Client phone number (use inside body)', example: '919876543210' },
      { name: '#invoiceno#',     desc: 'Invoice number',                        example: 'INV/2026/001' },
      { name: '#amount#',        desc: 'Payment amount received',               example: '14750' },
      { name: '#date#',          desc: 'Payment date',                          example: '10/06/2026' },
      { name: '#bizName#',       desc: 'Your business name',                    example: 'Tech To Grow' },
    ],
    example: `Hi #client#, we have received ₹#amount# for Invoice #invoiceno#.\nThank you for your payment! — #bizName#`,
  },
  {
    id: 'appointment_booked',
    label: '📆 Appointment Booked',
    trigger: 'appointment_booked',
    how: 'Fires automatically when a customer submits the booking form.',
    recipient: 'Client (their phone) or Owner',
    variables: [
      { name: '#client#',        desc: 'Customer\'s name',                      example: 'Priya Sharma' },
      { name: '#clientphoneno#', desc: 'Customer phone (use inside body)',      example: '919876543210' },
      { name: '#service#',       desc: 'Service booked',                        example: 'Hair Treatment' },
      { name: '#apptDate#',      desc: 'Appointment date (YYYY-MM-DD)',          example: '2026-06-15' },
      { name: '#apptTime#',      desc: 'Appointment time',                      example: '10:00 AM' },
      { name: '#date#',          desc: 'Booking date (today)',                   example: '10/06/2026' },
      { name: '#bizName#',       desc: 'Your business name',                    example: 'Beauty Studio' },
    ],
    example: `Hi #client#, your appointment for #service# is confirmed!\nDate: #apptDate# at #apptTime#\nSee you soon — #bizName#`,
  },
  {
    id: 'task_assigned',
    label: '✅ Task Assigned to Staff',
    trigger: 'task_assigned',
    how: 'Fires when a new task is created with an assignee. Message goes to the STAFF MEMBER\'s phone.',
    recipient: 'Staff member\'s phone (not client)',
    variables: [
      { name: '#assignee#',      desc: 'Staff member\'s name',                  example: 'Karuppasamy' },
      { name: '#task#',          desc: 'Task title',                            example: 'Call back Rajesh Kumar' },
      { name: '#client#',        desc: 'Related client (if set)',                example: 'ABC Corp' },
      { name: '#duedate#',       desc: 'Task due date',                         example: '2026-06-12' },
      { name: '#priority#',      desc: 'Task priority',                         example: 'High' },
      { name: '#date#',          desc: 'Today\'s date',                         example: '10/06/2026' },
    ],
    example: `Hi #assignee#, you have a new task assigned:\n📋 #task#\nClient: #client# | Due: #duedate# | Priority: #priority#`,
  },
  {
    id: 'amc_expiry',
    label: '🔧 AMC Expiry Alert',
    trigger: 'amc_expiry',
    how: 'Two triggers: (1) Saves when endDate ≤ 30 days. (2) Daily cron fires exactly N days before endDate (set "Days before expiry" on the template — e.g. 7 and 1).',
    recipient: 'Client (their phone) or Owner',
    variables: [
      { name: '#client#',        desc: 'Client / company name',                 example: 'XYZ Industries' },
      { name: '#clientphoneno#', desc: 'Client phone (use inside body)',        example: '919876543210' },
      { name: '#contractNo#',    desc: 'AMC contract number',                   example: 'AMC50001' },
      { name: '#endDate#',       desc: 'Contract end/expiry date (YYYY-MM-DD)', example: '2026-06-17' },
      { name: '#daysLeft#',      desc: 'Days remaining until expiry',           example: '7' },
      { name: '#amount#',        desc: 'Contract value',                        example: '25000' },
      { name: '#plan#',          desc: 'AMC plan name',                         example: 'Premium Support' },
      { name: '#date#',          desc: 'Today\'s date',                         example: '10/06/2026' },
    ],
    example: `Hi #client#, your AMC contract #contractNo# (#plan#) expires on #endDate# — only #daysLeft# days left.\nRenew now to avoid service interruption. — #bizName#`,
  },
  {
    id: 'order_placed',
    label: '🛒 Order Placed (E-commerce)',
    trigger: 'order_placed',
    how: 'Fires automatically when a customer completes checkout on the storefront.',
    recipient: 'Client (their phone) or Owner',
    variables: [
      { name: '#client#',        desc: 'Customer\'s name',                      example: 'Suresh Babu' },
      { name: '#clientphoneno#', desc: 'Customer phone (use inside body)',      example: '919876543210' },
      { name: '#orderId#',       desc: 'Order ID',                              example: 'ORD-12345' },
      { name: '#orderAmount#',   desc: 'Order total',                           example: '1500' },
      { name: '#orderStatus#',   desc: 'Order status',                          example: 'Placed' },
      { name: '#date#',          desc: 'Order date',                            example: '10/06/2026' },
      { name: '#bizName#',       desc: 'Your business name',                    example: 'My Store' },
    ],
    example: `Hi #client#, your order #orderId# for ₹#orderAmount# has been placed successfully!\nStatus: #orderStatus#\nThank you — #bizName#`,
  },
];

const DATE_VARS = [
  { name: '#today#',      desc: 'Today\'s date',     example: '10/06/2026' },
  { name: '#tomorrow#',   desc: 'Tomorrow\'s date',   example: '11/06/2026' },
  { name: '#+1day#',      desc: 'Today + 1 day',      example: '11/06/2026' },
  { name: '#+7day#',      desc: 'Today + 7 days',     example: '17/06/2026' },
  { name: '#+15day#',     desc: 'Today + 15 days',    example: '25/06/2026' },
  { name: '#+30day#',     desc: 'Today + 30 days',    example: '10/07/2026' },
  { name: '#+Nday#',      desc: 'Today + any N days (e.g. #+45day#)', example: '25/07/2026' },
];

export default function WAVariableGuide({ onClose }) {
  const [activeModule, setActiveModule] = useState(null);

  return (
    <div className="mo open" style={{ zIndex: 1100 }}>
      <div className="mo-box" style={{ width: 760, maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}>
        {/* Header */}
        <div className="mo-head">
          <div>
            <h3 style={{ margin: 0 }}>📖 WhatsApp Template Variable Guide</h3>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
              All available <code>#variable#</code> placeholders with descriptions and examples — organised by event type
            </div>
          </div>
          <button className="btn-icon" onClick={onClose}>✕</button>
        </div>

        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          {/* Sidebar — event list */}
          <div style={{ width: 220, flexShrink: 0, borderRight: '1px solid var(--border)', overflowY: 'auto', padding: '12px 8px', background: 'var(--bg-soft)' }}>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: 'var(--muted)', padding: '0 8px 8px', letterSpacing: '0.05em' }}>Events</div>
            {MODULES.map(m => (
              <div key={m.id}
                onClick={() => setActiveModule(activeModule === m.id ? null : m.id)}
                style={{ padding: '8px 10px', borderRadius: 8, cursor: 'pointer', marginBottom: 2, fontSize: 12, fontWeight: 600,
                  background: activeModule === m.id ? 'var(--accent)' : 'transparent',
                  color: activeModule === m.id ? '#fff' : 'var(--text)' }}>
                {m.label}
              </div>
            ))}
            <div style={{ marginTop: 8, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
              <div
                onClick={() => setActiveModule(activeModule === 'dates' ? null : 'dates')}
                style={{ padding: '8px 10px', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 600,
                  background: activeModule === 'dates' ? 'var(--accent)' : 'transparent',
                  color: activeModule === 'dates' ? '#fff' : 'var(--text)' }}>
                📅 Date Variables
              </div>
            </div>
          </div>

          {/* Main content */}
          <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
            {!activeModule && (
              <div>
                {/* Key rules */}
                <div style={{ background: '#fef9c3', border: '1px solid #fde68a', borderRadius: 10, padding: 14, marginBottom: 16, fontSize: 12 }}>
                  <div style={{ fontWeight: 700, color: '#92400e', marginBottom: 6 }}>⚡ Key Rules — Read First</div>
                  <ol style={{ margin: 0, paddingLeft: 18, color: '#78350f', lineHeight: 1.8 }}>
                    <li>The <code>#variable#</code> name in the CRM body must <strong>exactly match</strong> the variable name in your Waprochat template.</li>
                    <li><strong>Never put <code>#phone#</code> in the message body</strong> — it is the recipient field. Use <code>#leadphoneno#</code> or <code>#clientphoneno#</code> to show the phone inside the message.</li>
                    <li>Variable names are <strong>case-sensitive</strong> — <code>#Client#</code> ≠ <code>#client#</code>.</li>
                    <li>Each Waprochat template defines its own variable names (e.g. <code>name</code>, <code>service</code>, <code>date</code>). Your CRM body must use those exact names.</li>
                  </ol>
                </div>
                {/* Quick overview */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  {MODULES.map(m => (
                    <div key={m.id}
                      onClick={() => setActiveModule(m.id)}
                      style={{ border: '1px solid var(--border)', borderRadius: 10, padding: '12px 14px', cursor: 'pointer', background: '#fff' }}
                    >
                      <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>{m.label}</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>{m.how}</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {m.variables.filter(v => !v.special).slice(0, 4).map(v => (
                          <code key={v.name} style={{ fontSize: 10, background: '#f0fdf4', color: '#166534', padding: '1px 5px', borderRadius: 4, border: '1px solid #bbf7d0' }}>{v.name}</code>
                        ))}
                        {m.variables.filter(v => !v.special).length > 4 && (
                          <span style={{ fontSize: 10, color: 'var(--muted)' }}>+{m.variables.filter(v => !v.special).length - 4} more</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                <div onClick={() => setActiveModule('dates')} style={{ marginTop: 10, border: '1px solid var(--border)', borderRadius: 10, padding: '12px 14px', cursor: 'pointer', background: '#fff' }}>
                  <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>📅 Date Variables</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>Resolved at send time — <code>#today#</code>, <code>#tomorrow#</code>, <code>#+Nday#</code></div>
                </div>
              </div>
            )}

            {activeModule && activeModule !== 'dates' && (() => {
              const mod = MODULES.find(m => m.id === activeModule);
              if (!mod) return null;
              return (
                <div>
                  <h3 style={{ margin: '0 0 4px' }}>{mod.label}</h3>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>Trigger key: <code style={{ background: 'var(--bg-soft)', padding: '1px 6px', borderRadius: 4 }}>{mod.trigger}</code></div>
                  <div style={{ fontSize: 12, background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '8px 12px', marginBottom: 16, color: '#166534' }}>
                    <strong>When it fires:</strong> {mod.how}
                  </div>
                  <div style={{ fontSize: 12, color: '#0369a1', background: '#e0f2fe', border: '1px solid #bae6fd', borderRadius: 8, padding: '6px 12px', marginBottom: 16 }}>
                    <strong>📱 Recipient:</strong> {mod.recipient}
                  </div>

                  {/* Variables table */}
                  <div style={{ marginBottom: 20 }}>
                    <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 10 }}>Available Variables</div>
                    <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                        <thead>
                          <tr style={{ background: 'var(--bg-soft)' }}>
                            <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 700, borderBottom: '1px solid var(--border)', width: 160 }}>Variable</th>
                            <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 700, borderBottom: '1px solid var(--border)' }}>Description</th>
                            <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 700, borderBottom: '1px solid var(--border)', width: 160 }}>Example Value</th>
                          </tr>
                        </thead>
                        <tbody>
                          {mod.variables.map((v, i) => (
                            <tr key={v.name} style={{ borderBottom: i < mod.variables.length - 1 ? '1px solid var(--border)' : 'none', background: v.special ? '#fef9c3' : '#fff' }}>
                              <td style={{ padding: '8px 12px' }}>
                                <code style={{ fontSize: 11, background: v.special ? '#fde68a' : '#f0fdf4', color: v.special ? '#92400e' : '#166534', padding: '2px 6px', borderRadius: 4, border: '1px solid', borderColor: v.special ? '#fbbf24' : '#bbf7d0' }}>{v.name}</code>
                                {v.special && <span style={{ fontSize: 9, display: 'block', color: '#b45309', marginTop: 2 }}>⚠️ Recipient only</span>}
                              </td>
                              <td style={{ padding: '8px 12px', color: 'var(--text-soft)' }}>{v.desc}</td>
                              <td style={{ padding: '8px 12px', color: '#0369a1', fontFamily: 'monospace', fontSize: 11 }}>{v.example}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Example template */}
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>Example Template Body</div>
                    <pre style={{ background: '#1e293b', color: '#e2e8f0', borderRadius: 10, padding: 16, fontSize: 12, lineHeight: 1.8, whiteSpace: 'pre-wrap', margin: 0 }}>
                      {mod.example}
                    </pre>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>
                      💡 The variable names above must match what you defined in your Waprochat template.
                    </div>
                  </div>
                </div>
              );
            })()}

            {activeModule === 'dates' && (
              <div>
                <h3 style={{ margin: '0 0 12px' }}>📅 Built-in Date Variables</h3>
                <div style={{ fontSize: 12, background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '8px 12px', marginBottom: 16, color: '#166534' }}>
                  These are resolved automatically at send time (DD/MM/YYYY format). Use in any template regardless of event type.
                </div>
                <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', marginBottom: 20 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr style={{ background: 'var(--bg-soft)' }}>
                        <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 700, borderBottom: '1px solid var(--border)', width: 160 }}>Variable</th>
                        <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 700, borderBottom: '1px solid var(--border)' }}>Description</th>
                        <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 700, borderBottom: '1px solid var(--border)', width: 140 }}>Example (if today = 10/06/2026)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {DATE_VARS.map((v, i) => (
                        <tr key={v.name} style={{ borderBottom: i < DATE_VARS.length - 1 ? '1px solid var(--border)' : 'none', background: '#fff' }}>
                          <td style={{ padding: '8px 12px' }}>
                            <code style={{ fontSize: 11, background: '#f0fdf4', color: '#166534', padding: '2px 6px', borderRadius: 4, border: '1px solid #bbf7d0' }}>{v.name}</code>
                          </td>
                          <td style={{ padding: '8px 12px', color: 'var(--text-soft)' }}>{v.desc}</td>
                          <td style={{ padding: '8px 12px', color: '#0369a1', fontFamily: 'monospace', fontSize: 11 }}>{v.example}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>Example Usage</div>
                <pre style={{ background: '#1e293b', color: '#e2e8f0', borderRadius: 10, padding: 16, fontSize: 12, lineHeight: 1.8, whiteSpace: 'pre-wrap', margin: 0 }}>
{`Hi #client#, your quotation is valid until #tomorrow#.
Your AMC renewal is due in #+7day#.
Offer expires on #+30day#.`}
                </pre>
              </div>
            )}
          </div>
        </div>

        <div className="mo-foot">
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>
            💡 When you add new variables in the future, update <code>WAVariableGuide.jsx</code> — it is the single source of truth.
          </div>
          <button className="btn btn-primary btn-sm" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
