import React, { useState, useEffect } from 'react';
import { dbWrite, dbOp } from '../../utils/dbWrite';
import db from '../../instant';
import { id } from '@instantdb/react';
import { useToast } from '../../context/ToastContext';

const TRIGGER_TYPES = [
  { id: 'trig-lead',     label: 'New Lead Created',   desc: 'When a new lead is added',            icon: '👤', color: '#3b82f6' },
  { id: 'trig-stage',    label: 'Lead Stage Changed',  desc: 'When lead stage is updated',          icon: '🔄', color: '#8b5cf6' },
  { id: 'trig-followup', label: 'Follow-Up Due',       desc: 'Reminder date reached',               icon: '⏰', color: '#f59e0b' },
  { id: 'trig-amc',      label: 'AMC Expiring',        desc: 'Contract expiring within threshold',   icon: '🛡', color: '#ef4444' },
  { id: 'trig-payment',  label: 'Payment Due',          desc: 'Subscription payment due',            icon: '💰', color: '#14b8a6' },
  { id: 'trig-appt-new', label: 'New Appointment',      desc: 'When a new booking is made',          icon: '📅', color: '#0ea5e9' },
  { id: 'trig-appt-status', label: 'Appt Status Changed', desc: 'When appointment status updates',     icon: '✅', color: '#10b981' },
  { id: 'trig-order-new', label: 'New Ecom Order',       desc: 'When a new store order is placed',     icon: '🛒', color: '#f43f5e' },
  { id: 'trig-order-status', label: 'Order Status Changed', desc: 'When ecom order status updates',      icon: '📦', color: '#f97316' },
];

const ACTION_TYPES = [
  { id: 'act-email', label: 'Send Email',        desc: 'Send automated email',           icon: '📧', color: '#3b82f6', hasTemplate: true  },
  { id: 'act-wa',    label: 'Send WhatsApp',     desc: 'Send WhatsApp message',          icon: '💬', color: '#25d366', hasTemplate: true  },
  { id: 'act-sms',   label: 'Send SMS',          desc: 'Send text message',              icon: '📱', color: '#8b5cf6', hasTemplate: true  },
  { id: 'act-notif', label: 'Notify Team',       desc: 'Send in-app notification',       icon: '🔔', color: '#f59e0b', hasTemplate: false },
  { id: 'act-stage', label: 'Update Lead Stage', desc: 'Automatically move lead stage',  icon: '⬆', color: '#14b8a6', hasTemplate: false },
];

const DELAY_UNITS = ['minutes', 'hours', 'days'];

const RECIPIENT_OPTIONS = [
  { id: 'customer', label: 'Customer / Lead',  desc: 'Send to the lead or customer', icon: '🙋' },
  { id: 'owner',    label: 'Business Owner',   desc: 'Send to your registered email', icon: '🏢' },
  { id: 'both',     label: 'Both',             desc: 'Customer and business owner',  icon: '👥' },
];

const TEMPLATE_VARS = [
  { var: '{client}',       label: 'Client Name'     },
  { var: '{email}',        label: 'Email'           },
  { var: '{phone}',        label: 'Phone'           },
  { var: '{stage}',        label: 'Lead Stage'      },
  { var: '{source}',       label: 'Lead Source'     },
  { var: '{assignee}',     label: 'Assignee'        },
  { var: '{followupDate}', label: 'Follow-up Date'  },
  { var: '{bizName}',      label: 'Business Name'   },
  { var: '{date}',         label: "Today's Date"    },
  { var: '{amount}',       label: 'Amount'          },
  { var: '{contractNo}',   label: 'Contract No.'    },
  { var: '{apptDate}',     label: 'Appt Date'       },
  { var: '{apptTime}',     label: 'Appt Time'       },
  { var: '{service}',      label: 'Service Name'    },
  { var: '{orderId}',      label: 'Order ID'        },
  { var: '{orderStatus}',  label: 'Order Status'    },
  { var: '{orderAmount}',  label: 'Order Total'     },
];

const COND_OPS = ['is', 'is not', 'contains'];

const BUILT_IN_TEMPLATES = [
  {
    category: '🌱 Lead Nurturing',
    items: [
      {
        name: 'Welcome Email',
        trigger: 'trig-lead', action: 'act-email',
        delay: { value: 0, unit: 'minutes' }, recipient: 'customer', conditions: [],
        subject: 'Welcome to {bizName}!',
        template: 'Hi {client},\n\nThank you for reaching out to {bizName}! We\'re excited to connect with you.\n\nWe\'ll be in touch shortly to understand your needs better. Feel free to reply with any questions.\n\nWarm regards,\nTeam {bizName}',
        desc: 'Instant welcome email to new leads',
      },
      {
        name: 'Day-1 Check-in',
        trigger: 'trig-lead', action: 'act-email',
        delay: { value: 1, unit: 'days' }, recipient: 'customer', conditions: [],
        subject: 'Following up on your inquiry — {bizName}',
        template: 'Hi {client},\n\nJust checking in on your inquiry from yesterday. We noticed you reached us via {source} and we\'d love to help you move forward.\n\nLet\'s schedule a quick call!\n\nBest,\nTeam {bizName}',
        desc: 'Gentle follow-up 1 day after lead creation',
      },
      {
        name: 'Day-3 Value Offer',
        trigger: 'trig-lead', action: 'act-email',
        delay: { value: 3, unit: 'days' }, recipient: 'customer', conditions: [],
        subject: 'Something that might interest you, {client}',
        template: 'Hi {client},\n\nWe noticed you haven\'t connected with us yet — no worries!\n\nWe\'d love to show you how {bizName} can help you. Reply or call us anytime.\n\nCheers,\nTeam {bizName}',
        desc: '3-day nurture email with value proposition',
      },
      {
        name: 'WhatsApp Intro',
        trigger: 'trig-lead', action: 'act-wa',
        delay: { value: 30, unit: 'minutes' }, recipient: 'customer', conditions: [],
        subject: '',
        template: 'Hi {client}! 👋 This is {bizName}. Thanks for your interest! We\'ll be in touch soon. Feel free to WhatsApp us anytime! 😊',
        desc: 'Quick WhatsApp greeting for new leads',
      },
    ]
  },
  {
    category: '🔔 Team Follow-Up Reminders',
    items: [
      {
        name: 'Follow-Up Alert (Owner)',
        trigger: 'trig-followup', action: 'act-email',
        delay: { value: 0, unit: 'minutes' }, recipient: 'owner', conditions: [],
        subject: '⏰ Follow-up Due: {client}',
        template: 'Hi Team,\n\n⏰ Follow-up scheduled for {client} today ({followupDate}).\n\nStage: {stage} | Source: {source} | Assigned: {assignee}\nContact: {email} | {phone}\n\nAutomation Bot 🤖',
        desc: 'Alert owner when a follow-up is due',
      },
      {
        name: 'Stage Change Notification',
        trigger: 'trig-stage', action: 'act-notif',
        delay: { value: 0, unit: 'minutes' }, recipient: 'owner', conditions: [],
        subject: '',
        template: '🔄 {client} has moved to stage: {stage}. Assigned to: {assignee}.',
        desc: 'In-app notification when lead stage changes',
      },
    ]
  },
  {
    category: '💰 Renewal & Payment',
    items: [
      {
        name: 'AMC Expiry Notice (Customer)',
        trigger: 'trig-amc', action: 'act-email',
        delay: { value: 0, unit: 'minutes' }, recipient: 'customer', conditions: [],
        subject: 'Your AMC Contract is Expiring — {bizName}',
        template: 'Dear {client},\n\nYour AMC contract ({contractNo}) is due to expire on {date}.\n\nPlease get in touch with us to renew before the expiry date.\n\nBest regards,\nTeam {bizName}',
        desc: 'Alert customer before AMC expires',
      },
      {
        name: 'AMC Owner Alert',
        trigger: 'trig-amc', action: 'act-email',
        delay: { value: 0, unit: 'minutes' }, recipient: 'owner', conditions: [],
        subject: '🛡 AMC Expiring: {client} — {contractNo}',
        template: 'Hi Team,\n\n🛡 {client}\'s AMC ({contractNo}) expires on {date}.\n\nPlease renew to avoid service disruption.\n\nAutomation Bot 🤖',
        desc: 'Alert business owner about upcoming AMC expiry',
      },
      {
        name: 'Payment Reminder (WhatsApp)',
        trigger: 'trig-payment', action: 'act-wa',
        delay: { value: 0, unit: 'minutes' }, recipient: 'customer', conditions: [],
        subject: '',
        template: 'Hi {client} 👋, a gentle reminder that your payment of {amount} with {bizName} is due. Please clear it at the earliest. Thank you! 🙏',
        desc: 'WhatsApp payment reminder to customer',
      },
    ]
  },
  {
    category: '📅 Appointment Management',
    items: [
      {
        name: 'Booking Confirmation',
        trigger: 'trig-appt-new', action: 'act-email',
        delay: { value: 0, unit: 'minutes' }, recipient: 'customer', conditions: [],
        subject: 'Appointment Confirmed: {service} on {apptDate}',
        template: 'Hi {client},\n\nYour appointment for {service} has been confirmed for {apptDate} at {apptTime}.\n\nLocation: {bizName}\n\nWe look forward to seeing you!\n\nBest regards,\nTeam {bizName}',
        desc: 'Instant confirmation email after booking',
      },
      {
        name: 'Appt Reminder (1 Day Before)',
        trigger: 'trig-appt-new', action: 'act-wa',
        delay: { value: 1, unit: 'days', dir: 'before' }, recipient: 'customer', conditions: [],
        subject: '',
        template: 'Hi {client}! 👋 Just a reminder that you have an appointment for {service} tomorrow ({apptDate}) at {apptTime}. See you soon! 😊',
        desc: 'Send WhatsApp reminder 24h before appointment',
      },
      {
        name: 'New Booking Alert (Owner)',
        trigger: 'trig-appt-new', action: 'act-notif',
        delay: { value: 0, unit: 'minutes' }, recipient: 'owner', conditions: [],
        subject: '',
        template: '📅 New Booking: {client} for {service} on {apptDate} at {apptTime}.',
        desc: 'In-app alert for the business owner',
      },
    ]
  },
  {
    category: '🛒 E-Commerce & Orders',
    items: [
      {
        name: 'Order Confirmation',
        trigger: 'trig-order-new', action: 'act-email',
        delay: { value: 0, unit: 'minutes' }, recipient: 'customer', conditions: [],
        subject: 'Order Received - #{orderId}',
        template: 'Hi {client},\n\nThank you for your order #{orderId} from {bizName}!\n\nTotal: {orderAmount}\nStatus: {orderStatus}\n\nWe are processing your order and will notify you when it ships.\n\nThank you for shopping with us!\n\nBest regards,\nTeam {bizName}',
        desc: 'Send order confirmation after successful checkout',
      },
      {
        name: 'Order Shipped Update',
        trigger: 'trig-order-status', action: 'act-wa',
        delay: { value: 0, unit: 'minutes' }, recipient: 'customer', conditions: [{ field: 'orderStatus', op: 'is', value: 'Shipped' }],
        subject: '',
        template: 'Great news {client}! 🚚 Your order #{orderId} from {bizName} has been shipped! It will be with you shortly. 😊',
        desc: 'WhatsApp notification when order status changes to Shipped',
      },
      {
        name: 'New Order Alert (Owner)',
        trigger: 'trig-order-new', action: 'act-email',
        delay: { value: 0, unit: 'minutes' }, recipient: 'owner', conditions: [],
        subject: '🛒 New Order Received: #{orderId}',
        template: 'Hi Owner,\n\nA new order #{orderId} has been placed by {client} for {orderAmount}.\n\nCheck your dashboard to process the order.\n\nAutomation Bot 🤖',
        desc: 'Email alert to owner for every new order',
      },
    ]
  },
];

const WIZARD_STEPS = ['Name', 'Trigger', 'Action', 'Conditions', 'Timing', 'Recipient', 'Template'];

const delayLabel = (delay) => {
  if (!delay || !delay.value || delay.dir === 'immediately') return 'Immediately';
  const dir = delay.dir === 'before' ? 'before' : 'after';
  return `${delay.value} ${delay.unit} ${dir}`;
};

const condSummary = (conditions) => {
  if (!conditions || conditions.length === 0) return 'All leads';
  return conditions.map(c => `${c.field} ${c.op} "${c.value}"`).join(' & ');
};

export default function AutomationView({ user, ownerId }) {
  const [tab, setTab] = useState('flows');        // flows | templates
  const [tplTab, setTplTab] = useState('builtIn'); // builtIn | myTpl
  const [modal, setModal] = useState(false);
  const [editTplModal, setEditTplModal] = useState(false);  // edit saved template
  const [editTplData, setEditTplData] = useState(null);
  const [step, setStep] = useState(1);

  // ─── Wizard state ────────────────────────────────────────────────────────────
  const [flowName, setFlowName]         = useState('');
  const [selectedTrig, setSelectedTrig]   = useState(null);
  const [selectedActs, setSelectedActs]   = useState([]); // multi-select array
  const [targetStage, setTargetStage]     = useState(''); // for act-stage action
  const [conditions, setConditions]     = useState([]);   // [{field, op, value}]
  const [delayValue, setDelayValue]     = useState(0);
  const [delayUnit, setDelayUnit]       = useState('minutes');
  const [delayDir, setDelayDir]         = useState('immediately'); // 'immediately' | 'before' | 'after'
  const [recipient, setRecipient]       = useState('customer');
  const [emailSubject, setEmailSubject] = useState('');
  const [template, setTemplate]         = useState('');
  const [saveTplName, setSaveTplName]   = useState('');
  const [showSaveTpl, setShowSaveTpl]   = useState(false);
  const [loadTplOpen, setLoadTplOpen]   = useState(false);
  const [editingFlowId, setEditingFlowId] = useState(null); // null = create, string = edit
  const [whatsappTemplateId, setWhatsappTemplateId] = useState('');

  const toast = useToast();

  const { data } = db.useQuery({
    automations: { $: { where: { userId: ownerId } } },
    automationTemplates: { $: { where: { userId: ownerId } } },
    userProfiles: { $: { where: { userId: ownerId } } },
    teamMembers:  { $: { where: { userId: ownerId } } },
    orders:       { $: { where: { userId: ownerId } } },
    appointments: { $: { where: { userId: ownerId } } },
  });

  const automations      = data?.automations          || [];
  const savedTemplates   = data?.automationTemplates  || [];
  const profile          = data?.userProfiles?.[0]    || {};
  const team             = data?.teamMembers           || [];

  // Profile-driven condition field options
  const profileStages  = profile.stages  || [];
  const profileSources = profile.sources || [];
  const profileRequirements  = profile.requirements  || [];
  const customFields   = profile.customFields || [];
  const teamNames      = team.map(t => t.name).filter(Boolean);

  const COND_FIELDS = [
    { id: 'source',   label: 'Source',      options: profileSources },
    { id: 'stage',    label: 'Stage',       options: profileStages  },
    { id: 'requirement',    label: 'Requirement',       options: profileRequirements  },
    { id: 'assign',   label: 'Assigned To', options: teamNames      },
    ...customFields.map(cf => ({ id: `custom.${cf.name}`, label: `Custom: ${cf.name}`, options: cf.type === 'dropdown' ? (cf.options || '').split(',').map(s => s.trim()) : [] })),
  ];

  // ─── helpers ─────────────────────────────────────────────────────────────────
  const resetForm = () => {
    setFlowName(''); setSelectedTrig(null); setSelectedActs([]); setTargetStage('');
    setConditions([]); setDelayValue(0); setDelayUnit('minutes'); setDelayDir('immediately');
    setRecipient('customer'); setEmailSubject(''); setTemplate('');
    setSaveTplName(''); setShowSaveTpl(false); setLoadTplOpen(false); setStep(1);
    setEditingFlowId(null); setWhatsappTemplateId('');
  };

  const openCreate = () => { resetForm(); setModal(true); };

  // Load an existing automation into the wizard for editing
  const openEditFlow = (a) => {
    resetForm();
    setEditingFlowId(a.id);
    setFlowName(a.name || '');
    setSelectedTrig(a.trigger || null);
    const acts = Array.isArray(a.actions) && a.actions.length > 0 ? a.actions : (a.action ? [a.action] : []);
    setSelectedActs(acts);
    setTargetStage(a.targetStage || '');
    setConditions(a.conditions || []);
    setDelayValue(a.delay?.value || 0);
    setDelayUnit(a.delay?.unit || 'minutes');
    setDelayDir(a.delay?.dir || (a.delay?.value > 0 ? 'after' : 'immediately'));
    setRecipient(a.recipient || 'customer');
    setEmailSubject(a.subject || '');
    setTemplate(a.template || '');
    setWhatsappTemplateId(a.whatsappTemplateId || '');
    setStep(1);
    setModal(true);
  };

  // Save automation as a reusable template
  const saveAsTemplate = async (a) => {
    const tplName = prompt('Template name:', a.name);
    if (!tplName) return;
    const acts = Array.isArray(a.actions) && a.actions.length > 0 ? a.actions : (a.action ? [a.action] : []);
    await dbWrite(dbOp.update('automationTemplates', id(), {
      name: tplName.trim(),
      subject: a.subject || '',
      body: a.template || '',
      actions: acts,
      action: acts[0] || '',
      trigger: a.trigger,
      delay: a.delay,
      recipient: a.recipient,
      conditions: a.conditions || [],
      targetStage: a.targetStage || '',
      userId: ownerId,
      createdAt: Date.now(),
    }));
    toast(`Saved as template "${tplName}" ✅`, 'success');
  };

  const toggleAct = (actId) => setSelectedActs(prev =>
    prev.includes(actId) ? prev.filter(a => a !== actId) : [...prev, actId]
  );

  const anyHasTemplate = (acts) => (acts || []).some(a => ACTION_TYPES.find(t => t.id === a)?.hasTemplate);
  const hasStageAct    = (acts) => (acts || []).includes('act-stage');

  const visibleSteps = (acts) => {
    const base = ['Name','Trigger','Action','Conditions','Timing','Recipient'];
    if (anyHasTemplate(acts ?? selectedActs)) base.push('Template');
    return base;
  };

  const nextStep = () => {
    if (step === 1 && !flowName.trim())          { toast('Enter a name', 'error'); return; }
    if (step === 2 && !selectedTrig)             { toast('Select a trigger', 'error'); return; }
    if (step === 3 && selectedActs.length === 0) { toast('Select at least one action', 'error'); return; }
    if (step === 3) {
      if (!template) setTemplate(`Hi {client},\n\nThis is an automated message from {bizName}.\n\nBest regards,\nTeam {bizName}`);
      if (!emailSubject) setEmailSubject(`Message from {bizName}`);
    }
    setStep(s => s + 1);
  };

  const saveFlow = async () => {
    if (!flowName || !selectedTrig || selectedActs.length === 0) { toast('Please complete all steps', 'error'); return; }
    const payload = {
      name: flowName, trigger: selectedTrig,
      actions: selectedActs,
      action: selectedActs[0],
      targetStage,
      conditions, delay: { value: Number(delayValue), unit: delayUnit, dir: delayDir },
      recipient, subject: emailSubject, template,
      whatsappTemplateId,
      userId: ownerId,
    };
    if (editingFlowId) {
      // Update existing automation
      await dbWrite(dbOp.update('automations', editingFlowId, payload));
      toast(`Automation "${flowName}" updated! ✅`, 'success');
    } else {
      // Create new automation
      await dbWrite(dbOp.update('automations', id(), { ...payload, active: true, createdAt: Date.now() }));
      toast(`Automation "${flowName}" created! ✅`, 'success');
    }
    setModal(false); resetForm();
  };

  const toggleFlow = async (a) => {
    await dbWrite(dbOp.update('automations', a.id, { active: !a.active }));
    toast(`Flow ${a.active ? 'paused' : 'activated'}`, a.active ? 'warning' : 'success');
  };

  const delFlow = async (aid) => {
    if (!confirm('Delete this automation?')) return;
    await dbWrite(dbOp.delete('automations', aid));
    toast('Automation deleted', 'error');
  };

  const applyBuiltIn = (tpl) => {
    resetForm(); // Crucial: Clear ANY existing state including editingFlowId
    setFlowName(tpl.name); setSelectedTrig(tpl.trigger);
    // support both legacy action string and new actions array
    const acts = tpl.actions || (tpl.action ? [tpl.action] : []);
    setSelectedActs(acts); setTargetStage(tpl.targetStage || '');
    setConditions(tpl.conditions || []);
    setDelayValue(tpl.delay.value); setDelayUnit(tpl.delay.unit);
    setDelayDir(tpl.delay.dir || (tpl.delay.value > 0 ? 'after' : 'immediately'));
    setRecipient(tpl.recipient); setEmailSubject(tpl.subject || ''); setTemplate(tpl.template || tpl.body || '');
    setWhatsappTemplateId(tpl.whatsappTemplateId || '');
    setStep(1); setModal(true);
  };


  // ─── Saved Templates CRUD ────────────────────────────────────────────────────
  const saveTpl = async () => {
    if (!saveTplName.trim()) { toast('Enter a template name', 'error'); return; }
    await dbWrite(dbOp.update('automationTemplates', id(), {
      name: saveTplName.trim(), subject: emailSubject, body: template,
      actions: selectedActs,   // store multiple
      action: selectedActs[0], // fallback
      userId: ownerId, createdAt: Date.now(),
    }));
    toast(`Template "${saveTplName}" saved!`, 'success');
    setSaveTplName(''); setShowSaveTpl(false);
  };

  const loadTpl = (t) => {
    setTemplate(t.body || '');
    if (selectedActs.includes('act-email') && t.subject) setEmailSubject(t.subject);
    setLoadTplOpen(false);
    toast(`Loaded: "${t.name}"`, 'success');
  };

  const deleteSavedTpl = async (tid) => {
    if (!confirm('Delete this template?')) return;
    await dbWrite(dbOp.delete('automationTemplates', tid));
    toast('Template deleted', 'error');
  };

  const openEditTpl = (t) => {
    setEditTplData({ ...t });
    setEditTplModal(true);
  };

  const saveEditTpl = async () => {
    if (!editTplData) return;
    await dbWrite(dbOp.update('automationTemplates', editTplData.id, {
      name: editTplData.name,
      subject: editTplData.subject,
      body: editTplData.body,
    }));
    toast('Template updated!', 'success');
    setEditTplModal(false); setEditTplData(null);
  };

  // ─── Condition helpers ───────────────────────────────────────────────────────
  const addCondition = () => setConditions(prev => [...prev, { field: 'source', op: 'is', value: profileSources[0] || '' }]);
  const updateCond = (i, patch) => setConditions(prev => prev.map((c, idx) => idx === i ? { ...c, ...patch } : c));
  const removeCond = (i) => setConditions(prev => prev.filter((_, idx) => idx !== i));

  const getFieldInfo = (fieldId) => COND_FIELDS.find(f => f.id === fieldId) || {};

  // ─── Requirements ─────────────────────────────────────────────────────────────────
  const trigIcon  = (id) => TRIGGER_TYPES.find(t => t.id === id)?.icon || '⚡';
  const trigLabel = (id) => TRIGGER_TYPES.find(t => t.id === id)?.label || id;
  const actIcon   = (id) => ACTION_TYPES.find(a => a.id === id)?.icon || '⚡';
  const actLabel  = (id) => ACTION_TYPES.find(a => a.id === id)?.label || id;

  const stepsForWizard = visibleSteps(selectedActs);
  const isLastStep = step === stepsForWizard.length;

  // ─── INSERT VAR ──────────────────────────────────────────────────────────────
  const insertVar = (v) => setTemplate(prev => prev + v);

  // ─── RENDER ──────────────────────────────────────────────────────────────────
  return (
    <div>
      <div className="sh">
        <div>
          <h2>Automation</h2>
          <div className="sub">Automate follow-ups, alerts, and client nurturing</div>
        </div>
        <button className="btn btn-primary btn-sm" onClick={openCreate}>+ Create Automation</button>
      </div>

      <div className="tabs">
        {[['flows','My Automations'],['templates','Templates']].map(([t,l]) => (
          <div key={t} className={`tab${tab===t?' active':''}`} onClick={() => setTab(t)}>{l}</div>
        ))}
      </div>

      {/* ======================== MY FLOWS ======================== */}
      {tab === 'flows' && (
        <div>
          {automations.length === 0 ? (
            <div className="empty-state">
              <div className="icon">⚡</div>
              <h3>No automations yet</h3>
              <p>Create an automation or pick a Smart Template to start automating your CRM.</p>
              <button className="btn btn-primary btn-sm" style={{marginTop:12}} onClick={() => setTab('templates')}>Browse Templates</button>
            </div>
          ) : (
            <div className="tw">
              <div className="tw-head"><h3>Active Automations ({automations.filter(a => a.active).length}/{automations.length})</h3></div>
              <div className="tw-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>#</th><th>Name</th><th>Trigger</th><th>Action</th>
                      <th>Conditions</th><th>Timing</th><th>Recipient</th><th>Active</th><th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {automations.map((a, i) => (
                      <tr key={a.id}>
                        <td style={{color:'var(--muted)',fontSize:11}}>{i+1}</td>
                        <td><strong>{a.name}</strong></td>
                        <td style={{fontSize:12}}>{trigIcon(a.trigger)} {trigLabel(a.trigger)}</td>
                        <td style={{fontSize:12}}>{actIcon(a.action)} {actLabel(a.action)}</td>
                        <td style={{fontSize:11}}>
                          <span className="badge" style={{background:'#fefce8',color:'#854d0e',border:'1px solid #fde68a',maxWidth:170,display:'inline-block',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}} title={condSummary(a.conditions)}>
                            {condSummary(a.conditions)}
                          </span>
                        </td>
                        <td style={{fontSize:11}}>
                          <span className="badge" style={{background:'#f0f9ff',color:'#0369a1',border:'1px solid #bae6fd'}}>
                            {delayLabel(a.delay)==='Immediately' ? '⚡ Now' : `⏱ ${delayLabel(a.delay)}`}
                          </span>
                        </td>
                        <td style={{fontSize:11,textTransform:'capitalize'}}>
                          <span className="badge" style={{background:'#fdf4ff',color:'#7e22ce',border:'1px solid #e9d5ff'}}>
                            {RECIPIENT_OPTIONS.find(r=>r.id===a.recipient)?.icon || '🙋'} {a.recipient || 'customer'}
                          </span>
                        </td>
                        <td>
                          <label className="toggle">
                            <input type="checkbox" checked={a.active !== false} onChange={() => toggleFlow(a)} />
                            <span className="toggle-slider" />
                          </label>
                        </td>
                        <td>
                          <div style={{display:'flex',gap:5,flexWrap:'wrap'}}>
                            <button className="btn btn-sm" style={{background:'#eff6ff',color:'#1d4ed8',border:'1px solid #bfdbfe'}} onClick={() => openEditFlow(a)}>✏ Edit</button>
                            <button className="btn btn-sm" style={{background:'#f0fdf4',color:'#166534',border:'1px solid #bbf7d0'}} onClick={() => saveAsTemplate(a)}>📋 Template</button>
                            <button className="btn btn-sm" style={{background:'#fee2e2',color:'#991b1b'}} onClick={() => delFlow(a.id)}>Del</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ======================== TEMPLATES ======================== */}
      {tab === 'templates' && (
        <div>
          <div style={{display:'flex',gap:10,marginBottom:20}}>
            {[['builtIn','⚡ Built-in'],['myTpl','📁 My Templates']].map(([t,l]) => (
              <button key={t} className={`btn btn-sm ${tplTab===t?'btn-primary':'btn-secondary'}`} onClick={() => setTplTab(t)}>{l}</button>
            ))}
          </div>

          {tplTab === 'builtIn' && BUILT_IN_TEMPLATES.map((cat, ci) => (
            <div key={ci} style={{marginBottom:28}}>
              <div style={{fontSize:14,fontWeight:700,marginBottom:12}}>{cat.category}</div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(260px,1fr))',gap:14}}>
                {cat.items.map((tpl, i) => (
                  <div key={i} className="tw" style={{cursor:'pointer'}} onClick={() => applyBuiltIn(tpl)}>
                    <div style={{padding:'16px 18px'}}>
                      <div style={{fontSize:14,fontWeight:700,marginBottom:4}}>{tpl.name}</div>
                      <div style={{fontSize:12,color:'var(--muted)',marginBottom:10}}>{tpl.desc}</div>
                      <div style={{fontSize:11,display:'flex',gap:5,flexWrap:'wrap',marginBottom:6}}>
                        <span className="badge bg-blue">{trigLabel(tpl.trigger)}</span>
                        <span>→</span>
                        <span className="badge bg-green">{actLabel(tpl.action)}</span>
                      </div>
                      <div style={{fontSize:11,display:'flex',gap:5,flexWrap:'wrap',marginBottom:12}}>
                        <span className="badge" style={{background:'#f0f9ff',color:'#0369a1',border:'1px solid #bae6fd'}}>{delayLabel(tpl.delay)==='Immediately'?'⚡ Now':`⏱ ${delayLabel(tpl.delay)}`}</span>
                        <span className="badge" style={{background:'#fdf4ff',color:'#7e22ce',border:'1px solid #e9d5ff',textTransform:'capitalize'}}>→ {tpl.recipient}</span>
                      </div>
                      <button className="btn btn-primary btn-sm" style={{width:'100%'}}>Use Template</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}

          {tplTab === 'myTpl' && (
            <div>
              {savedTemplates.length === 0 ? (
                <div className="empty-state">
                  <div className="icon">📁</div>
                  <h3>No saved templates yet</h3>
                  <p>When creating a flow, use "Save as Template" in the Template step to save your message for reuse.</p>
                </div>
              ) : (
                <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))',gap:14}}>
                  {savedTemplates.map(t => (
                    <div key={t.id} className="tw">
                      <div style={{padding:'16px 18px'}}>
                        <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:6}}>
                          <div style={{fontSize:14,fontWeight:700}}>{t.name}</div>
                          <span className="badge bg-blue" style={{fontSize:10}}>{actLabel(t.action)}</span>
                        </div>
                        {t.subject && <div style={{fontSize:12,color:'var(--muted)',marginBottom:4}}>Subject: {t.subject}</div>}
                        <div style={{fontSize:12,color:'var(--text)',background:'var(--bg-soft)',padding:'8px 10px',borderRadius:7,maxHeight:70,overflow:'hidden',marginBottom:10,lineHeight:1.5}}>
                          {(t.body||'').slice(0,120)}{(t.body||'').length>120?'…':''}
                        </div>
                        <div style={{display:'flex',gap:6}}>
                          <button className="btn btn-primary btn-sm" style={{flex:1}} onClick={() => applyBuiltIn(t)}>⚡ Use Template</button>
                          <button className="btn btn-secondary btn-sm" onClick={() => openEditTpl(t)}>✎ Edit</button>
                          <button className="btn btn-sm" style={{background:'#fee2e2',color:'#991b1b'}} onClick={() => deleteSavedTpl(t.id)}>Del</button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ======================== CREATE FLOW WIZARD ======================== */}
      {modal && (
        <div className="mo open">
          <div className="mo-box" style={{maxWidth:580}}>
            <div className="mo-head">
              <h3>Create Automation Flow</h3>
              <button className="btn-icon" onClick={() => setModal(false)}>✕</button>
            </div>

            <div className="mo-body">
              {/* Step progress bar */}
              <div style={{display:'flex',gap:0,marginBottom:22,overflowX:'auto'}}>
                {stepsForWizard.map((s, i) => (
                  <div key={s} style={{flex:'1 0 auto',textAlign:'center',borderBottom:`2.5px solid ${step>i?'var(--accent)':'var(--border)'}`,paddingBottom:8,
                    cursor:step>i?'pointer':'default',fontSize:10,fontWeight:step===i+1?700:500,
                    color:step===i+1?'var(--accent)':step>i?'var(--text)':'var(--muted)',minWidth:60}}
                    onClick={() => step>i && setStep(i+1)}>
                    <div style={{width:18,height:18,borderRadius:'50%',background:step>i?'var(--accent)':'var(--border)',color:'#fff',fontSize:9,fontWeight:700,display:'inline-flex',alignItems:'center',justifyContent:'center',marginBottom:3}}>
                      {step>i+1?'✓':i+1}
                    </div>
                    <div>{s}</div>
                  </div>
                ))}
              </div>

              {/* ── Step 1: Name ── */}
              {step === 1 && (
                <div className="fg">
                  <label>Flow Name</label>
                  <input value={flowName} onChange={e=>setFlowName(e.target.value)} placeholder="e.g. Welcome — Google Leads" autoFocus />
                  <div style={{fontSize:11,color:'var(--muted)',marginTop:4}}>Give it a descriptive name so you can identify it later, e.g. "Welcome — WhatsApp Leads"</div>
                </div>
              )}

              {/* ── Step 2: Trigger ── */}
              {step === 2 && (
                <div style={{display:'flex',flexDirection:'column',gap:8}}>
                  <label style={{fontSize:11,fontWeight:700,color:'var(--muted)',textTransform:'uppercase'}}>Select a Trigger</label>
                  {TRIGGER_TYPES.map(t => (
                    <div key={t.id} onClick={() => setSelectedTrig(t.id)} style={{padding:'10px 14px',borderRadius:9,border:`1.5px solid ${selectedTrig===t.id?'var(--accent)':'var(--border)'}`,cursor:'pointer',background:selectedTrig===t.id?'#f0fdf4':'var(--surface)',display:'flex',gap:12,alignItems:'center'}}>
                      <span style={{fontSize:20}}>{t.icon}</span>
                      <div><div style={{fontSize:13,fontWeight:700}}>{t.label}</div><div style={{fontSize:11,color:'var(--muted)'}}>{t.desc}</div></div>
                    </div>
                  ))}
                </div>
              )}

              {/* ── Step 3: Action (multi-select) ── */}
              {step === 3 && (
                <div>
                  <label style={{fontSize:11,fontWeight:700,color:'var(--muted)',textTransform:'uppercase',display:'block',marginBottom:10}}>Select Actions (choose multiple)</label>
                  <div style={{display:'flex',flexDirection:'column',gap:8}}>
                    {ACTION_TYPES.map(a => {
                      const checked = selectedActs.includes(a.id);
                      return (
                        <div key={a.id} onClick={() => toggleAct(a.id)}
                          style={{padding:'10px 14px',borderRadius:9,border:`1.5px solid ${checked?'var(--accent)':'var(--border)'}`,cursor:'pointer',background:checked?'#f0fdf4':'var(--surface)',display:'flex',gap:12,alignItems:'center'}}>
                          {/* Checkbox indicator */}
                          <div style={{width:18,height:18,borderRadius:4,border:`2px solid ${checked?'var(--accent)':'var(--border)'}`,background:checked?'var(--accent)':'transparent',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                            {checked && <span style={{color:'#fff',fontSize:11,fontWeight:900}}>✓</span>}
                          </div>
                          <span style={{fontSize:20}}>{a.icon}</span>
                          <div style={{flex:1}}>
                            <div style={{fontSize:13,fontWeight:700}}>{a.label}</div>
                            <div style={{fontSize:11,color:'var(--muted)'}}>{a.desc}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {selectedActs.length > 0 && (
                    <div style={{marginTop:10,padding:'8px 12px',background:'#f0fdf4',borderRadius:8,fontSize:11,color:'#16a34a'}}>
                      ✓ Selected: {selectedActs.map(a => ACTION_TYPES.find(t=>t.id===a)?.label).filter(Boolean).join(' + ')}
                    </div>
                  )}
                </div>
              )}

              {/* ── Step 4: Conditions ── */}
              {step === 4 && (
                <div>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
                    <div>
                      <label style={{fontSize:11,fontWeight:700,color:'var(--muted)',textTransform:'uppercase',display:'block'}}>Filter Conditions (Optional)</label>
                      <div style={{fontSize:11,color:'var(--muted)',marginTop:2}}>Only fire this flow when ALL conditions match. Leave empty to run for all leads.</div>
                    </div>
                    <button className="btn btn-secondary btn-sm" onClick={addCondition}>+ Add Condition</button>
                  </div>

                  {conditions.length === 0 ? (
                    <div style={{padding:'20px',textAlign:'center',background:'var(--bg-soft)',borderRadius:10,border:'1.5px dashed var(--border)'}}>
                      <div style={{fontSize:22,marginBottom:6}}>🎯</div>
                      <div style={{fontSize:13,fontWeight:600,marginBottom:4}}>No conditions — fires for all leads</div>
                      <div style={{fontSize:11,color:'var(--muted)'}}>Click "+ Add Condition" to filter by Source, Stage, Label, or Custom Fields</div>
                    </div>
                  ) : (
                    <div style={{display:'flex',flexDirection:'column',gap:8}}>
                      {conditions.map((cond, i) => {
                        const fi = getFieldInfo(cond.field);
                        const hasOptions = fi.options && fi.options.length > 0;
                        return (
                          <div key={i} style={{display:'flex',gap:8,alignItems:'center',padding:'10px 12px',background:'var(--bg-soft)',borderRadius:9,border:'1px solid var(--border)'}}>
                            {/* Field */}
                            <select value={cond.field} onChange={e => updateCond(i, {field:e.target.value,value:''})} style={{flex:1.2,padding:'6px 8px',borderRadius:6,border:'1px solid var(--border)',fontSize:12}}>
                              {COND_FIELDS.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
                            </select>
                            {/* Operator */}
                            <select value={cond.op} onChange={e => updateCond(i, {op:e.target.value})} style={{flex:0.8,padding:'6px 8px',borderRadius:6,border:'1px solid var(--border)',fontSize:12}}>
                              {COND_OPS.map(op => <option key={op} value={op}>{op}</option>)}
                            </select>
                            {/* Value */}
                            {hasOptions ? (
                              <select value={cond.value} onChange={e => updateCond(i, {value:e.target.value})} style={{flex:1.2,padding:'6px 8px',borderRadius:6,border:'1px solid var(--border)',fontSize:12}}>
                                <option value="">Select...</option>
                                {fi.options.map(o => <option key={o} value={o}>{o}</option>)}
                              </select>
                            ) : (
                              <input value={cond.value} onChange={e => updateCond(i, {value:e.target.value})} placeholder="Value..." style={{flex:1.2,padding:'6px 8px',borderRadius:6,border:'1px solid var(--border)',fontSize:12}} />
                            )}
                            <button onClick={() => removeCond(i)} style={{background:'#fee2e2',color:'#991b1b',border:'none',borderRadius:6,padding:'4px 8px',cursor:'pointer',fontSize:12}}>✕</button>
                          </div>
                        );
                      })}

                      {conditions.length > 1 && (
                        <div style={{fontSize:11,color:'var(--muted)',textAlign:'center',padding:'4px 0'}}>All conditions must match (AND logic)</div>
                      )}
                    </div>
                  )}

                  {conditions.length > 0 && (
                    <div style={{marginTop:12,padding:'8px 12px',background:'#fefce8',borderRadius:8,fontSize:11,color:'#854d0e'}}>
                      🎯 This flow fires when: <strong>{condSummary(conditions)}</strong>
                    </div>
                  )}
                </div>
              )}

              {/* ── Step 5: Timing ── */}
              {step === 5 && (
                <div>
                  <label style={{fontSize:11,fontWeight:700,color:'var(--muted)',textTransform:'uppercase',display:'block',marginBottom:12}}>When should this run?</label>

                  {/* Direction pills */}
                  <div style={{display:'flex',gap:8,marginBottom:14}}>
                    {[
                      {id:'immediately', label:'⚡ Immediately', hint:'As soon as the trigger fires'},
                      {id:'after',       label:'⏩ After',       hint:'X time after the trigger'},
                      {id:'before',      label:'⏪ Before',      hint:'X time before the event (e.g. 15 min before follow-up)'},
                    ].map(opt => (
                      <div key={opt.id} onClick={() => { setDelayDir(opt.id); if (opt.id==='immediately') setDelayValue(0); }}
                        style={{flex:1,padding:'10px 12px',borderRadius:9,border:`1.5px solid ${delayDir===opt.id?'var(--accent)':'var(--border)'}`,cursor:'pointer',background:delayDir===opt.id?'#f0fdf4':'var(--surface)',textAlign:'center'}}>
                        <div style={{fontSize:13,fontWeight:700,marginBottom:3}}>{opt.label}</div>
                        <div style={{fontSize:10,color:'var(--muted)'}}>{opt.hint}</div>
                      </div>
                    ))}
                  </div>

                  {/* Number + unit (hidden when Immediately) */}
                  {delayDir !== 'immediately' && (
                    <div style={{display:'flex',gap:10,alignItems:'center'}}>
                      <input type="number" min={1} max={365} value={delayValue||''} onChange={e=>setDelayValue(e.target.value)} placeholder="e.g. 15"
                        style={{width:80,padding:'8px 12px',borderRadius:7,border:'1.5px solid var(--border)',fontSize:14,fontWeight:700}} autoFocus />
                      <select value={delayUnit} onChange={e=>setDelayUnit(e.target.value)} style={{padding:'8px 12px',borderRadius:7,border:'1.5px solid var(--border)',fontSize:13}}>
                        {DELAY_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                      </select>
                      <span style={{fontSize:13,color:'var(--muted)',fontStyle:'italic'}}>{delayDir} the trigger</span>
                    </div>
                  )}

                  <div style={{marginTop:14,padding:'10px 14px',background:'#f0f9ff',borderRadius:8,fontSize:12,color:'#0369a1'}}>
                    ⏰ This automation will execute:
                    <strong>
                      {delayDir==='immediately'
                        ? ' immediately when the trigger fires'
                        : ` ${delayValue||'?'} ${delayUnit} ${delayDir} the trigger fires`}
                    </strong>
                  </div>
                </div>
              )}

              {/* ── Step 6: Recipient ── */}
              {step === 6 && (
                <div style={{display:'flex',flexDirection:'column',gap:8}}>
                  <label style={{fontSize:11,fontWeight:700,color:'var(--muted)',textTransform:'uppercase'}}>Who should receive this?</label>
                  {RECIPIENT_OPTIONS.map(r => (
                    <div key={r.id} onClick={() => setRecipient(r.id)} style={{padding:'10px 14px',borderRadius:9,border:`1.5px solid ${recipient===r.id?'var(--accent)':'var(--border)'}`,cursor:'pointer',background:recipient===r.id?'#f0fdf4':'var(--surface)',display:'flex',gap:12,alignItems:'center'}}>
                      <span style={{fontSize:22}}>{r.icon}</span>
                      <div><div style={{fontSize:13,fontWeight:700}}>{r.label}</div><div style={{fontSize:11,color:'var(--muted)'}}>{r.desc}</div></div>
                    </div>
                  ))}
                </div>
              )}

              {/* ── Step 7: Template ── */}
              {step === 7 && (
                <div>
                  {/* Stage picker — shown when act-stage is selected */}
                  {hasStageAct(selectedActs) && (
                    <div className="fg" style={{marginBottom:14}}>
                      <label style={{fontWeight:700}}>Move Lead to Stage ⬆</label>
                      {profileStages.length > 0 ? (
                        <select value={targetStage} onChange={e=>setTargetStage(e.target.value)}
                          style={{padding:'8px 10px',borderRadius:7,border:'1.5px solid var(--border)',fontSize:13}}>
                          <option value="">Select target stage...</option>
                          {profileStages.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      ) : (
                        <div style={{fontSize:12,color:'var(--muted)',padding:'8px 0'}}>⚠ No stages configured. Add stages in Settings → Lead Stages first.</div>
                      )}
                    </div>
                  )}

                  {/* WhatsApp Template picker */}
                  {selectedActs.includes('act-wa') && (
                    <div className="fg" style={{marginBottom:18, padding: 12, border: '1px solid var(--border)', borderRadius: 10, background: 'var(--bg-soft)'}}>
                      <label style={{fontWeight:700, display: 'flex', alignItems: 'center', gap: 6}}>
                        <span style={{fontSize:18}}>💬</span> Select WhatsApp Template
                      </label>
                      <div style={{fontSize: 11, color: 'var(--muted)', marginBottom: 10}}>Waprochat requires a template for automated messages. Add templates in Settings first.</div>
                      {profile.whatsappTemplates?.length > 0 ? (
                        <select value={whatsappTemplateId} onChange={e=>setWhatsappTemplateId(e.target.value)}
                          style={{padding:'8px 10px',borderRadius:7,border:'1.5px solid var(--border)',fontSize:13, width: '100%', background: '#fff'}}>
                          <option value="">Select template...</option>
                          {profile.whatsappTemplates.map(t => (
                            <option key={t.id} value={t.id}>{t.name} ({t.templateId})</option>
                          ))}
                        </select>
                      ) : (
                        <div style={{fontSize:12, color:'#991b1b', background: '#fee2e2', padding:'10px', borderRadius: 8, border: '1px solid #fecaca'}}>
                          ⚠ No WhatsApp templates configured. <br/>
                          <span style={{fontSize: 11}}>Go to <strong>Settings → WhatsApp Templates</strong> to add one.</span>
                        </div>
                      )}
                      
                      {whatsappTemplateId && profile.whatsappTemplates?.find(t => t.id === whatsappTemplateId) && (
                        <div style={{marginTop: 10, padding: 10, background: '#fff', borderRadius: 7, border: '1px solid var(--border)', fontSize: 11}}>
                          <div style={{fontWeight: 700, color: 'var(--muted)', marginBottom: 4}}>Preview:</div>
                          <div style={{color: 'var(--text)', whiteSpace: 'pre-wrap'}}>
                            {profile.whatsappTemplates.find(t => t.id === whatsappTemplateId).body}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Message template — only if any messaging action is selected */}
                  {anyHasTemplate(selectedActs) && (
                    <div>
                      {selectedActs.includes('act-email') && (
                        <div className="fg" style={{marginBottom:10}}>
                          <label>Email Subject</label>
                          <input value={emailSubject} onChange={e=>setEmailSubject(e.target.value)} placeholder="e.g. Welcome to {bizName}!" />
                        </div>
                      )}

                      {/* Load from saved template */}
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:6}}>
                        <label style={{fontSize:12,fontWeight:700,color:'var(--text)'}}>Message Body</label>
                        {savedTemplates.length > 0 && (
                          <div style={{position:'relative'}}>
                            <button className="btn btn-secondary btn-sm" style={{fontSize:11}} onClick={() => setLoadTplOpen(o=>!o)}>
                              📁 Load Template ▾
                            </button>
                            {loadTplOpen && (
                              <div style={{position:'absolute',right:0,top:'100%',marginTop:4,background:'var(--surface)',border:'1px solid var(--border)',borderRadius:9,zIndex:50,minWidth:220,boxShadow:'0 4px 20px rgba(0,0,0,0.12)'}}>
                                {savedTemplates.filter(t => !t.action || selectedActs.includes(t.action)).map(t => (
                                  <div key={t.id} onClick={() => loadTpl(t)} style={{padding:'9px 14px',cursor:'pointer',fontSize:12,borderBottom:'1px solid var(--border)'}}
                                    onMouseEnter={e=>e.currentTarget.style.background='var(--bg-soft)'}
                                    onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                                    <div style={{fontWeight:700}}>{t.name}</div>
                                    {t.subject && <div style={{color:'var(--muted)',fontSize:10}}>Subj: {t.subject}</div>}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      <textarea
                        value={template}
                        onChange={e=>setTemplate(e.target.value)}
                        rows={6}
                        style={{width:'100%',padding:'10px 12px',borderRadius:8,border:'1.5px solid var(--border)',fontFamily:'inherit',fontSize:13,lineHeight:1.6,resize:'vertical',boxSizing:'border-box'}}
                        placeholder="Write your message. Use variables like {client}, {bizName}..."
                      />

                      {/* Variable chips */}
                      <div style={{marginTop:8,marginBottom:10}}>
                        <div style={{fontSize:10,fontWeight:700,color:'var(--muted)',marginBottom:5,textTransform:'uppercase'}}>Insert Variable</div>
                        <div style={{display:'flex',flexWrap:'wrap',gap:5}}>
                          {TEMPLATE_VARS.map(v => (
                            <button key={v.var} onClick={() => insertVar(v.var)}
                              className="btn btn-sm"
                              style={{fontSize:11,padding:'2px 8px',background:'#f0fdf4',color:'#16a34a',border:'1px solid #bbf7d0',borderRadius:20,cursor:'pointer'}}>
                              {v.var}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Save as template */}
                      {!showSaveTpl ? (
                        <button className="btn btn-secondary btn-sm" style={{fontSize:11,width:'100%',marginTop:4}} onClick={() => { setSaveTplName(flowName); setShowSaveTpl(true); }}>
                          💾 Save as Reusable Template
                        </button>
                      ) : (
                        <div style={{display:'flex',gap:8,alignItems:'center',marginTop:4}}>
                          <input value={saveTplName} onChange={e=>setSaveTplName(e.target.value)} placeholder="Template name..." style={{flex:1,padding:'6px 10px',borderRadius:7,border:'1.5px solid var(--border)',fontSize:12}} />
                          <button className="btn btn-primary btn-sm" style={{fontSize:11}} onClick={saveTpl}>Save</button>
                          <button className="btn btn-secondary btn-sm" style={{fontSize:11}} onClick={() => setShowSaveTpl(false)}>✕</button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

            </div>

            <div className="mo-foot">
              <button className="btn btn-secondary btn-sm" onClick={() => step>1?setStep(s=>s-1):setModal(false)}>
                {step>1?'← Back':'Cancel'}
              </button>
              {isLastStep
                ? <button className="btn btn-primary btn-sm" onClick={saveFlow}>{editingFlowId ? 'Update Automation ✅' : 'Create Automation ⚡'}</button>
                : <button className="btn btn-primary btn-sm" onClick={nextStep}>Next →</button>
              }
            </div>
          </div>
        </div>
      )}

      {/* ======================== EDIT SAVED TEMPLATE MODAL ======================== */}
      {editTplModal && editTplData && (
        <div className="mo open">
          <div className="mo-box" style={{maxWidth:520}}>
            <div className="mo-head">
              <h3>Edit Template</h3>
              <button className="btn-icon" onClick={() => { setEditTplModal(false); setEditTplData(null); }}>✕</button>
            </div>
            <div className="mo-body">
              <div className="fg" style={{marginBottom:10}}>
                <label>Template Name</label>
                <input value={editTplData.name} onChange={e=>setEditTplData(d=>({...d,name:e.target.value}))} />
              </div>
              {editTplData.action === 'act-email' && (
                <div className="fg" style={{marginBottom:10}}>
                  <label>Email Subject</label>
                  <input value={editTplData.subject||''} onChange={e=>setEditTplData(d=>({...d,subject:e.target.value}))} placeholder="{bizName} — Message for you!" />
                </div>
              )}
              <div className="fg">
                <label>Message Body</label>
                <textarea value={editTplData.body||''} onChange={e=>setEditTplData(d=>({...d,body:e.target.value}))} rows={8}
                  style={{fontFamily:'inherit',fontSize:13,lineHeight:1.6}} />
              </div>
              <div style={{marginTop:8,display:'flex',flexWrap:'wrap',gap:5}}>
                {TEMPLATE_VARS.map(v => (
                  <button key={v.var} onClick={() => setEditTplData(d=>({...d,body:(d.body||'')+v.var}))}
                    style={{fontSize:11,padding:'2px 8px',background:'#f0fdf4',color:'#16a34a',border:'1px solid #bbf7d0',borderRadius:20,cursor:'pointer'}}>
                    {v.var}
                  </button>
                ))}
              </div>
            </div>
            <div className="mo-foot">
              <button className="btn btn-secondary btn-sm" onClick={() => { setEditTplModal(false); setEditTplData(null); }}>Cancel</button>
              <button className="btn btn-primary btn-sm" onClick={saveEditTpl}>Save Changes</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
