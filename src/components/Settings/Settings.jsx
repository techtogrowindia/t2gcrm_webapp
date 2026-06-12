import React, { useState, useRef, useEffect } from 'react';
import { dbWrite, dbOp, dbQueryOnce } from '../../utils/dbWrite';
import db from '../../instant';
import { id } from '@instantdb/react';
import { useToast } from '../../context/ToastContext';
import { renderTemplate, sendEmailMock, sendEmail, sendWhatsApp, AUTO_TRIGGER_EVENTS } from '../../utils/messaging';
import { fmtD, INDIAN_STATES, COUNTRIES, DEFAULT_STAGES, DEFAULT_SOURCES, DEFAULT_REQUIREMENTS, SYSTEM_STAGES, DEFAULT_UNITS, SUPPORTED_CURRENCIES } from '../../utils/helpers';
import DocumentTemplate from '../Finance/DocumentTemplate';

const SETTINGS_GROUPS = [
  {
    title: 'General',
    items: ['Business', 'Billing']
  },
  {
    title: 'Lead Settings',
    items: ['Sources', 'Stages', 'Requirements', 'Custom Fields']
  },
  {
    title: 'Finance & Products',
    items: ['Finance', 'Templates', 'Taxes', 'Product Categories', 'Product Units', 'Expense Categories']
  },
  {
    title: 'Operations',
    items: ['Task Statuses', 'Order Statuses']
  },
  {
    title: 'Comms & Alerts',
    items: ['SMTP', 'WhatsApp', 'WhatsApp Templates']
  }
];

// Centralized defaults are imported from helpers.js
const DEFAULT_CFIELDS = []; // { name: 'Requirement', type: 'text'|'number'|'dropdown', options: 'A,B' }
const DEFAULT_PROD_CATS = ['Electronics', 'Home Appliances', 'Services', 'Furniture', 'General'];
const DEFAULT_EXP_CATS = ['Software', 'Hardware', 'Travel', 'Office', 'Marketing', 'Utilities', 'Salaries', 'Misc'];
const DEFAULT_TASK_STATUSES = ['Pending', 'In Progress', 'Completed'];
const DEFAULT_ORDER_STATUSES = ['Pending', 'Confirmed', 'Processing', 'Shipped', 'Delivered', 'Cancelled'];
const DEFAULT_TAX_OPTIONS = [
  { label: 'None (0%)', rate: 0 },
  { label: 'GST @ 5%', rate: 5 },
  { label: 'GST @ 12%', rate: 12 },
  { label: 'GST @ 18%', rate: 18 },
  { label: 'GST @ 28%', rate: 28 }
];

export default function Settings({ user, profile, isExpired, initialTab, ownerId, perms, teamInfo, memberProfile, settings }) {
  const groups = SETTINGS_GROUPS;
  const [active, setActive] = useState(initialTab || 'Business');
  
  React.useEffect(() => {
     if (initialTab) setActive(initialTab);
  }, [initialTab]);

  // Removed userProfile state (now in UserProfile.jsx)
  const [biz, setBiz] = useState({
    bizName: profile?.bizName || '', 
    bizEmail: profile?.bizEmail || '',
    bizPhone: profile?.bizPhone || '',
    address: profile?.address || '',
    bizState: profile?.bizState || '',
    country: profile?.country || 'India',
    pincode: profile?.pincode || '',
    gstin: profile?.gstin || '', pan: profile?.pan || '',
    website: profile?.website || '',
    logo: profile?.logo || null,
    bizExtraEmails: profile?.bizExtraEmails || '',
    slug: profile?.slug || '',
    defaultCurrency: profile?.defaultCurrency || 'INR',
    waNotifPhone: profile?.waNotifPhone || '',
  });
  const [fin, setFin] = useState({
    qPrefix: profile?.qPrefix || 'QUO-',
    qNextNum: profile?.qNextNum || 1,
    qTerms: profile?.qTerms || '1. Valid for 30 days.\n2. 50% advance to start work.',
    qNotes: profile?.qNotes || 'Thank you for your business!',
    iPrefix: profile?.iPrefix || 'INV-',
    iNextNum: profile?.iNextNum || 1,
    iTerms: profile?.iTerms || '1. Please pay within 7 days.\n2. Interest @ 18% for late payment.',
    iNotes: profile?.iNotes || 'Thank you for choosing us!',
    reqShipping: profile?.reqShipping || 'Optional',
    defaultTaxRate: profile?.defaultTaxRate || 0,
    bankName: profile?.bankName || '',
    accountNo: profile?.accountNo || '',
    ifsc: profile?.ifsc || '',
    accHolder: profile?.accHolder || '',
    bankExtra: profile?.bankExtra || '',
    qrCode: profile?.qrCode || null,
    invoiceTemplate: profile?.invoiceTemplate || 'Spreadsheet',
    quotationTemplate: profile?.quotationTemplate || 'Spreadsheet',
  });
  const [smtpHost, setSmtpHost] = useState(profile?.smtpHost || '');
  const [smtpPort, setSmtpPort] = useState(profile?.smtpPort || '587');
  const [smtpUser, setSmtpUser] = useState(profile?.smtpUser || '');
  const [smtpPass, setSmtpPass] = useState(profile?.smtpPass || '');
  const [waApiToken, setWaApiToken] = useState(profile?.waApiToken || '');
  const [waPhoneId, setWaPhoneId] = useState(profile?.waPhoneId || '');
  const [whatsappTemplates, setWhatsappTemplates] = useState(profile?.whatsappTemplates || []);
  const [waTestNumber, setWaTestNumber] = useState('');
  const [newSource, setNewSource] = useState('');
  const [newStage, setNewStage] = useState('');
  const [editingStageIdx, setEditingStageIdx] = useState(null);
  const [editingStageVal, setEditingStageVal] = useState('');
  const stageDragIdx = useRef(null);
  const [newRequirement, setNewRequirement] = useState('');
  const [newExpCat, setNewExpCat] = useState('');
  const [newProdCat, setNewProdCat] = useState('');
  const [newUnit, setNewUnit] = useState('');

  // Sync state with profile prop when it loads
  useEffect(() => {
    if (profile) {
      setBiz({
        bizName: profile.bizName || '',
        bizEmail: profile.bizEmail || '',
        bizPhone: profile.bizPhone || '',
        address: profile.address || '',
        bizState: profile.bizState || '',
        country: profile.country || 'India',
        pincode: profile.pincode || '',
        gstin: profile.gstin || '',
        pan: profile.pan || '',
        website: profile.website || '',
        logo: profile.logo || null,
        bizExtraEmails: profile.bizExtraEmails || '',
        slug: profile.slug || '',
        defaultCurrency: profile.defaultCurrency || 'INR',
        waNotifPhone: profile.waNotifPhone || '',
      });
      setFin({
        qPrefix: profile.qPrefix || 'QUO-',
        qNextNum: profile.qNextNum || 1,
        qTerms: profile.qTerms || '1. Valid for 30 days.\n2. 50% advance to start work.',
        qNotes: profile.qNotes || 'Thank you for your business!',
        iPrefix: profile.iPrefix || 'INV-',
        iNextNum: profile.iNextNum || 1,
        iTerms: profile.iTerms || '1. Please pay within 7 days.\n2. Interest @ 18% for late payment.',
        iNotes: profile.iNotes || 'Thank you for choosing us!',
        reqShipping: profile.reqShipping || 'Optional',
        defaultTaxRate: profile.defaultTaxRate || 0,
        bankName: profile.bankName || '',
        accountNo: profile.accountNo || '',
        ifsc: profile.ifsc || '',
        accHolder: profile.accHolder || '',
        bankExtra: profile.bankExtra || '',
        qrCode: profile.qrCode || null,
        invoiceTemplate: profile.invoiceTemplate || 'Classic',
        quotationTemplate: profile.quotationTemplate || 'Classic',
      });
      setSmtpHost(profile.smtpHost || '');
      setSmtpPort(profile.smtpPort || '587');
      setSmtpUser(profile.smtpUser || '');
      setSmtpPass(profile.smtpPass || '');
      setWaApiToken(profile.waApiToken || '');
      setWaPhoneId(profile.waPhoneId || '');
      setWhatsappTemplates(profile.whatsappTemplates || []);

    }
  }, [profile]);
  const [newTaskStatus, setNewTaskStatus] = useState('');
  const [newTax, setNewTax] = useState({ label: '', rate: '' });
  const [newCF, setNewCF] = useState({ name: '', type: 'text', options: '' });

  const [editingCFIndex, setEditingCFIndex] = useState(null);
  const [editingWA, setEditingWA] = useState(null);
  const [waFormTrigger, setWaFormTrigger] = useState('');
  const [waFormBody, setWaFormBody] = useState(''); // tracks textarea for live curl preview
  const [waFormRecipients, setWaFormRecipients] = useState(['client']); // multi-select recipients

  // Sample template bodies — shown when user selects a trigger on Add New
  const WA_SAMPLE_BODIES = {
    lead_created:        `Hi #client#, thank you for your enquiry!\nWe received your lead (Requirement: #requirement#) from #source# and our team will contact you shortly.\n— #bizName#`,
    lead_stage_changed:  `Hi #client#, your enquiry status has been updated.\nStage: #fromstage# → #tostage#\nAssigned to: #assignee#\n— #bizName#`,
    lead_assigned:       `Hi #assignee#, a new lead has been assigned to you:\nName: #lead# | Stage: #stage#\nPhone: #leadphoneno# | Requirement: #requirement#`,
    customer_created:    `Congratulations #client#! 🎉\nWelcome to the #bizName# family. We look forward to serving you!`,
    lead_followup:       `Hi #client#, this is a reminder that your follow-up is scheduled on #followupdate# (#daysLeft# day(s) away).\nOur team member #assignee# will connect with you.\n— #bizName#`,
    quotation_created:   `Hi #client#, your quotation #quoteno# for ₹#amount# is ready.\nValid until: #validuntil#\nReply to confirm — #bizName#`,
    invoice_created:     `Hi #client#, Invoice #invoiceno# for ₹#amount# has been generated on #date#.\nPlease make payment at your earliest convenience.\n— #bizName#`,
    payment_received:    `Hi #client#, we have received ₹#amount# for Invoice #invoiceno#.\nThank you for your payment! — #bizName#`,
    appointment_booked:  `Hi #client#, your appointment for #service# is confirmed!\nDate: #apptDate# at #apptTime#\nSee you soon — #bizName#`,
    task_assigned:       `Hi #assignee#, you have a new task assigned:\n📋 #task#\nClient: #client# | Due: #duedate# | Priority: #priority#`,
    amc_expiry:          `Hi #client#, your AMC contract #contractNo# (#plan#) expires on #endDate# — only #daysLeft# days left.\nPlease renew to avoid service interruption. — #bizName#`,
    order_placed:        `Hi #client#, your order #orderId# for ₹#orderAmount# has been placed!\nStatus: #orderStatus#\nThank you — #bizName#`,
  };
  const toast = useToast();

  const { data } = db.useQuery({
     userProfiles: { $: { where: { userId: ownerId } } },
     quotes: { $: { where: { userId: ownerId } } },
     invoices: { $: { where: { userId: ownerId } } },
     ecomSettings: { $: { where: { userId: ownerId } } },
     appointmentSettings: { $: { where: { userId: ownerId } } }
  });
  const profileId = data?.userProfiles?.[0]?.id;
  const sources = data?.userProfiles?.[0]?.sources || DEFAULT_SOURCES;
  const stages = data?.userProfiles?.[0]?.stages || DEFAULT_STAGES;
  const wonStage = data?.userProfiles?.[0]?.wonStage || 'Won';
  const lostStage = data?.userProfiles?.[0]?.lostStage || 'Lost';
  const disabledStages = data?.userProfiles?.[0]?.disabledStages || [];
  const requirements = data?.userProfiles?.[0]?.requirements || DEFAULT_REQUIREMENTS;
  const customFields = data?.userProfiles?.[0]?.customFields || DEFAULT_CFIELDS;
  const productCats = data?.userProfiles?.[0]?.productCats || DEFAULT_PROD_CATS;
  const expCats = data?.userProfiles?.[0]?.expCats || DEFAULT_EXP_CATS;
  const taskStatuses = data?.userProfiles?.[0]?.taskStatuses || DEFAULT_TASK_STATUSES;
  const orderStatuses = data?.userProfiles?.[0]?.orderStatuses || DEFAULT_ORDER_STATUSES;
  const taxRates = data?.userProfiles?.[0]?.taxRates || DEFAULT_TAX_OPTIONS;
  const productUnits = data?.userProfiles?.[0]?.productUnits || DEFAULT_UNITS;

  const [newOrderStatus, setNewOrderStatus] = useState('');

  // Auto-migration for revamped stage names: Drafted -> Created
  useEffect(() => {
    if (!profileId || !stages) return;
    let updated = false;
    const nl = [...stages];
    const txs = [];
    
    const migrations = [
      { old: 'Quotation Drafted', new: 'Quotation Created' },
      { old: 'Invoice Drafted', new: 'Invoice Created' }
    ];

    migrations.forEach(m => {
      const idx = nl.indexOf(m.old);
      if (idx !== -1) {
        nl[idx] = m.new;
        updated = true;
        // Also update leads currently in this stage
        (data?.leads || []).filter(l => l.stage === m.old).forEach(l => {
          txs.push(dbOp.update('leads', l.id, { stage: m.new }));
        });
      }
    });

    if (updated) {
      txs.push(dbOp.update('userProfiles', profileId, { stages: nl }));
      dbWrite(txs).then(() => {
         console.log("✅ Stages migrated successfully (Drafted -> Created)");
      }).catch(e => console.error("❌ Stage migration failed:", e));
    }
  }, [profileId, stages, data?.leads]);

  // Auto-migration for Labels -> Requirements
  useEffect(() => {
    if (!profileId) return;
    const txs = [];
    let updated = false;

    const rawProfile = data?.userProfiles?.[0];
    if (rawProfile && rawProfile.labels && !rawProfile.requirements) {
      txs.push(dbOp.update('userProfiles', profileId, { requirements: rawProfile.labels }));
      updated = true;
    }

    (data?.leads || []).forEach(l => {
      // If legacy label exists but requirement is empty, migrate it
      if (l.label && !l.requirement) {
        txs.push(dbOp.update('leads', l.id, { requirement: l.label }));
        updated = true;
      }
    });

    if (updated && txs.length > 0) {
      dbWrite(txs).then(() => {
         console.log("✅ Labels migrated to Requirements successfully");
      }).catch(e => console.error("❌ Label migration failed:", e));
    }
  }, [profileId, data?.userProfiles, data?.leads]);

  // Auto-migration: Rename custom field "requirement" -> "Service Type" to avoid clash with built-in field
  useEffect(() => {
    if (!profileId) return;
    const rawProfile = data?.userProfiles?.[0];
    const cfs = rawProfile?.customFields || [];
    const conflictIdx = cfs.findIndex(cf => cf.name.toLowerCase() === 'requirement');
    if (conflictIdx === -1) return;

    const txs = [];
    const newName = 'Service Type';
    const updatedCFs = [...cfs];
    updatedCFs[conflictIdx] = { ...updatedCFs[conflictIdx], name: newName };
    txs.push(dbOp.update('userProfiles', profileId, { customFields: updatedCFs }));

    // Migrate lead custom data: move custom.requirement -> custom["Service Type"]
    (data?.leads || []).forEach(l => {
      if (l.custom?.requirement) {
        const newCustom = { ...l.custom, [newName]: l.custom.requirement };
        delete newCustom.requirement;
        txs.push(dbOp.update('leads', l.id, { custom: newCustom }));
      }
    });

    dbWrite(txs).then(() => {
      console.log('✅ Custom field "requirement" renamed to "Service Type"');
    }).catch(e => console.error('❌ Custom field rename failed:', e));
  }, [profileId, data?.userProfiles, data?.leads]);

  const handleFile = (e, callback, fieldName = null) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 500000) return toast('File too large (max 500KB)', 'error');
    const reader = new FileReader();
    reader.onloadend = async () => {
      const result = reader.result;
      callback(result);
      
      // Auto-save if fieldName is provided
      if (fieldName && profileId) {
        try {
          await dbWrite(dbOp.update('userProfiles', profileId, { [fieldName]: result }));
          toast(`${fieldName === 'logo' ? 'Logo' : 'QR Code'} auto-saved!`, 'success');
        } catch (err) {
          console.error(`Auto-save failed for ${fieldName}:`, err);
        }
      }
    };
    reader.readAsDataURL(file);
  };


  const saveBiz = async () => {
    // Normalize slug: lowercase, trim, replace non-alphanumeric with hyphens
    const cleanSlug = (biz.slug || '').toLowerCase().trim().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '');

    // Uniqueness check — one-time point query at save time (not a live subscription)
    if (cleanSlug) {
      const slugCheck = await dbQueryOnce({ userProfiles: { $: { where: { slug: cleanSlug } } } });
      const isTaken = (slugCheck?.userProfiles || []).some(p => p.userId !== ownerId);
      if (isTaken) return toast('This brand URL slug is already taken! Please choose another one.', 'error');
    }

    const payload = { 
      ...biz,
      slug: cleanSlug,
      accHolder: fin.accHolder,
      bankName: fin.bankName,
      accountNo: fin.accountNo,
      ifsc: fin.ifsc,
      bankExtra: fin.bankExtra,
      qrCode: fin.qrCode,
      tagline: biz.tagline || profile?.tagline || '', // Ensure tagline is synced
      userId: ownerId 
    };

    const txs = [];
    if (profileId) txs.push(dbOp.update('userProfiles', profileId, payload));

    // Global Slug Sync: Force update linked modules to the new slug
    const ecomId = data?.ecomSettings?.[0]?.id;
    if (ecomId) {
      txs.push(dbOp.update('ecomSettings', ecomId, { ecomName: cleanSlug }));
    }
    
    const apptId = data?.appointmentSettings?.[0]?.id;
    if (apptId) {
      txs.push(dbOp.update('appointmentSettings', apptId, { slug: cleanSlug }));
    }

    try {
      if (txs.length > 0) await dbWrite(txs);
      setBiz(b => ({ ...b, slug: cleanSlug })); // Update local state with cleaned slug
      toast('Business Profile & URLs synced successfully! 🚀', 'success');
    } catch (err) {
      toast('Sync failed: ' + err.message, 'error');
    }
  };

  const saveFin = async () => {
    const payload = { ...fin, userId: ownerId };
    if (profileId) await dbWrite(dbOp.update('userProfiles', profileId, payload));
    toast('Finance settings saved!', 'success');
  };

  const saveList = async (key, list, extra = {}) => {
    const payload = { [key]: list, userId: ownerId, ...extra };
    if (profileId) { await dbWrite(dbOp.update('userProfiles', profileId, payload)); }
    else { await dbWrite(dbOp.update('userProfiles', id(), { ...payload, userId: ownerId })); }
    toast('Saved!', 'success');
  };

  const syncExistingData = async () => {
    const leads = data?.leads || [];
    const customers = data?.customers || [];
    const quotes = data?.quotes || [];
    const invoices = data?.invoices || [];
    const txs = [];
    let count = 0;
    let stageCount = 0;

    const activeStages = profile?.stages || DEFAULT_STAGES;
    const activeSources = profile?.sources || DEFAULT_SOURCES;
    const activeRequirements = profile?.requirements || DEFAULT_REQUIREMENTS;

    const STAGE_ORDER = ['New Enquiry', 'Enquiry Contacted', 'Quotation Created', 'Quotation Sent', 'Invoice Created', 'Invoice Sent', 'Won'];

    leads.forEach(l => {
      let updated = false;
      const updates = {};

      // 1. Sync Contact Details from Customers (case-insensitive & trimmed)
      const cMatch = customers.find(c => (c.name || '').trim().toLowerCase() === (l.name || '').trim().toLowerCase());
      if (cMatch) {
        if ((cMatch.email && l.email !== cMatch.email) || (cMatch.phone && l.phone !== cMatch.phone)) {
          updates.email = cMatch.email || l.email || '';
          updates.phone = cMatch.phone || l.phone || '';
          updated = true;
          count++;
        }
      }

      // 2. Sync Stage from Quotes & Invoices (case-insensitive & trimmed)
      const lQuotes = quotes.filter(q => (q.client || '').trim().toLowerCase() === (l.name || '').trim().toLowerCase());
      const lInvoices = invoices.filter(i => (i.client || '').trim().toLowerCase() === (l.name || '').trim().toLowerCase());
      
      let targetStage = l.stage;
      const getRank = (s) => {
         if (s === wonStage) return STAGE_ORDER.indexOf('Won');
         if (s === lostStage) return STAGE_ORDER.indexOf('Lost');
         const r = STAGE_ORDER.indexOf(s);
         return r === -1 ? -1 : r;
      };

      const currentRank = getRank(l.stage);

      // Check Invoices first (higher priority)
      if (lInvoices.some(i => i.status === 'Paid' || i.status === 'Partially Paid')) {
         targetStage = wonStage;
      } else if (lInvoices.some(i => i.status === 'Sent')) {
         targetStage = 'Invoice Sent';
      } else if (lInvoices.some(i => i.status === 'Draft')) {
         targetStage = 'Invoice Created';
      } else if (lQuotes.some(q => q.status === 'Sent')) {
         targetStage = 'Quotation Sent';
      } else if (lQuotes.some(q => q.status === 'Draft' || q.status === 'Created')) {
         targetStage = 'Quotation Created';
      }

      if (targetStage !== l.stage && getRank(targetStage) > currentRank) {
         updates.stage = targetStage;
         updated = true;
         stageCount++;
      }

      if (updated) {
        txs.push(dbOp.update('leads', l.id, updates));
      }
    });

    if (txs.length > 0) {
      await dbWrite(txs);
      toast(`Synced details for ${count} leads and updated stages for ${stageCount} leads!`, 'success');
    } else {
      toast('All lead data is already in sync', 'info');
    }
  };

  const addItem = (key, list, val, reset) => {
    if (!val.trim()) return;
    saveList(key, [...list, val.trim()]);
    reset('');
  };

  const RESERVED_FIELD_NAMES = ['name', 'companyname', 'email', 'phone', 'source', 'stage', 'assign', 'followup', 'requirement', 'notes', 'label', 'productcat', 'created', 'createdat', 'reminder', 'assigned', 'distributor', 'retailer'];

  const addCF = () => {
    if (!newCF.name.trim()) return;
    const cleanName = newCF.name.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
    if (RESERVED_FIELD_NAMES.includes(cleanName)) {
      return toast(`"${newCF.name.trim()}" conflicts with a built-in field name. Please choose a different name.`, 'error');
    }
    if (editingCFIndex !== null) {
      const updatedList = [...customFields];
      updatedList[editingCFIndex] = { ...newCF, name: newCF.name.trim() };
      saveList('customFields', updatedList);
      setEditingCFIndex(null);
    } else {
      saveList('customFields', [...customFields, { ...newCF, name: newCF.name.trim() }]);
    }
    setNewCF({ name: '', type: 'text', options: '' });
  };
  
  const editCF = (idx) => {
    setEditingCFIndex(idx);
    setNewCF(customFields[idx]);
  };

  const cancelEditCF = () => {
    setEditingCFIndex(null);
    setNewCF({ name: '', type: 'text', options: '' });
  };

  // Friendly labels per list type for the confirmation prompt.
  const ITEM_LABELS = {
    taxRates: 'tax rate', customFields: 'custom field', sources: 'source',
    stages: 'stage', requirements: 'requirement', productCats: 'product category',
    productUnits: 'unit', expCats: 'expense category', taskStatuses: 'task status',
    orderStatuses: 'order status',
  };

  const removeItem = (key, list, idx) => {
    const item = list[idx];
    const name = typeof item === 'string'
      ? item
      : (item?.name || item?.label || (item?.rate != null ? `${item.rate}%` : '') || 'this item');
    const typeLabel = ITEM_LABELS[key] || 'item';
    if (!window.confirm(`Remove ${typeLabel} "${name}"? This cannot be undone.`)) return;
    saveList(key, list.filter((_, i) => i !== idx));
  };

  const editItem = (key, list, idx, currentVal) => {
    const newVal = prompt('Edit value:', currentVal);
    if (newVal !== null && newVal.trim() !== '' && newVal !== currentVal) {
      const newList = [...list];
      newList[idx] = newVal.trim();
      // If renaming a requirement, also update partnerVisibleRequirements to keep the selection
      if (key === 'requirements' && profileId) {
        const currentVisible = data?.userProfiles?.[0]?.partnerVisibleRequirements || [];
        const updatedVisible = currentVisible.map(r => r === currentVal ? newVal.trim() : r);
        const payload = { requirements: newList, partnerVisibleRequirements: updatedVisible, userId: ownerId };
        dbWrite(dbOp.update('userProfiles', profileId, payload))
          .then(() => toast('Saved!', 'success'))
          .catch(e => toast('Save failed: ' + e.message, 'error'));
      } else {
        saveList(key, newList);
      }
    }
  };

  const addTaxRate = () => {
    if (!newTax.label.trim() || newTax.rate === '') return;
    saveList('taxRates', [...taxRates, { label: newTax.label.trim(), rate: parseFloat(newTax.rate) || 0 }]);
    setNewTax({ label: '', rate: '' });
  };

  const saveSMTP = async () => {
    const payload = { smtpHost, smtpPort, smtpUser, smtpPass, smtpSender: smtpUser, userId: ownerId };
    if (profileId) { await dbWrite(dbOp.update('userProfiles', profileId, payload)); }
    toast('SMTP settings saved!', 'success');
  };

  const testSMTP = async () => {
    if (!smtpHost || !smtpUser || !smtpPass) return toast('Fill in SMTP Host, Username and Password first', 'error');
    const testEmail = prompt('Recipient Email:', user?.email || smtpUser);
    if (!testEmail) return;
    const testSubject = prompt('Email Subject:', 'CRM SMTP Test');
    if (!testSubject) return;
    const testBody = prompt('Email Content:', 'This is a test email from your CRM. If you see this, SMTP is working!');
    if (!testBody) return;

    try {
      toast('Sending test email...', 'info');
      const smtpConfig = { smtpHost, smtpPort, smtpUser, smtpPass, bizName: biz.bizName };
      const result = await sendEmail(testEmail, testSubject, testBody, ownerId, biz.bizName, user.id, smtpConfig);
      if (result === 'OK') {
        toast('✅ Test email sent successfully!', 'success');
      } else {
        toast(`⚠️ Unexpected result: ${result}`, 'warning');
      }
    } catch (e) {
      console.error('SMTP Test Error:', e);
      toast(`❌ Failed: ${e.message}`, 'error');
    }
  };

  const saveWA = async () => {
    const payload = { waApiToken, waPhoneId, whatsappTemplates, userId: ownerId };
    if (profileId) { await dbWrite(dbOp.update('userProfiles', profileId, payload)); }
    
    if (!waApiToken.trim() || !waPhoneId.trim()) {
      toast('Templates saved! (Note: WhatsApp API info is still missing)', 'warning');
    } else {
      toast('WhatsApp settings saved successfully!', 'success');
    }
  };



  const testWA = async () => {
    if (!waApiToken || !waPhoneId) return toast('Please save WhatsApp settings first', 'error');
    const testTo = waTestNumber || prompt('Send test message to (with country code e.g. +919876543210):');
    if (!testTo) return;
    
    // For manual test, we'll try to use the first template if available, or just a generic one
    const testMsg = `Hello! This is a test message from your T2GCRM
 account. WhatsApp integration is working correctly! 🚀\n\nBusiness: ${biz.bizName || 'Your Business'}`;
    
    try {
      toast('Sending test WhatsApp message...', 'info');
      // Update sendWhatsApp to handle waprochat if possible
      const result = await sendWhatsApp(testTo, testMsg, ownerId, user.id);
      if (result === 'OK') {
        toast('✅ Test WhatsApp message sent successfully!', 'success');
      } else {
        toast(`Error: ${result}`, 'warning');
      }
    } catch (e) {
      toast(`Failed: ${e.message}`, 'error');
    }
  };



  const sampleInv = {
    no: 'INV/2026/001', date: new Date().toISOString().split('T')[0], dueDate: new Date(Date.now() + 86400000*7).toISOString().split('T')[0],
    client: 'John Doe Corp', items: [{ name: 'Premium Service', qty: 1, rate: 2500, taxRate: 18 }, { name: 'Consulting', qty: 2, rate: 500, taxRate: 0 }],
    disc: 10, discType: '%', notes: 'Sample invoice preview', terms: 'Due in 7 days'
  };

  return (
    <div>
      <div className="sh"><div><h2>Settings</h2></div></div>
      <div className="sg">
        {/* Sidebar */}
        <div className="sn">
          {groups.map(group => (
            <div key={group.title} className="sng">
              <div className="snh">{group.title}</div>
              {group.items.map(s => (
                <div key={s} className={`sni${active === s ? ' active' : ''}`} onClick={() => setActive(s)}>{s}</div>
              ))}
            </div>
          ))}
        </div>

        {/* Content */}
        <div>
          {active === 'Billing' && (
            <div>
              <div className="sh" style={{ marginBottom: 20 }}>
                <div>
                  <h3>Current Plan</h3>
                  <div className="sub">Manage your current plan and upgrades</div>
                </div>
                {isExpired && <span className="badge bg-red" style={{ padding: '4px 12px', fontSize: 11 }}>EXPIRED</span>}
              </div>

              <div className="stat-grid" style={{ marginBottom: 30 }}>
                <div className="stat-card sc-blue">
                  <div className="lbl">Current Plan</div>
                  <div className="val">{profile?.plan || 'Free Trial'}</div>
                </div>
                <div className="stat-card sc-purple">
                  <div className="lbl">Valid Until</div>
                  <div className="val" style={{ fontSize: 16 }}>{profile?.planExpiry ? new Date(profile.planExpiry).toLocaleDateString() : 'N/A'}</div>
                </div>
              </div>

              <h4 style={{ marginBottom: 15 }}>Upgrade Options</h4>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 15 }}>
                {(settings?.plans || [
                  { name: 'Trial', duration: 7, price: 0, features: 'Perfect for exploring the CRM' },
                  { name: 'Premium', duration: 30, price: 2999, features: 'For growing businesses' },
                  { name: 'START-UP', duration: 365, price: 24999, features: 'Cost-effective annual plan' },
                  { name: 'Premium Pro', duration: 365, price: 29999, features: 'Unlimited power for teams' },
                ])
                  .filter(p => !p.hidden || p.name === profile?.plan)
                  .map(p => (
                  <div key={p.name} className={`plan-card ${profile?.plan === p.name ? 'featured' : ''}`} style={{ border: profile?.plan === p.name ? '2px solid var(--accent)' : '1px solid var(--border)', padding: 20, borderRadius: 12, position: 'relative' }}>
                    {profile?.plan === p.name && <div style={{ position: 'absolute', top: -10, right: 10, background: 'var(--accent)', color: 'white', padding: '2px 8px', borderRadius: 4, fontSize: 10, fontWeight: 700 }}>ACTIVE</div>}
                    <div style={{ fontWeight: 700, fontSize: 16 }}>{p.name}</div>
                    <div style={{ color: 'var(--muted)', fontSize: 12, marginBottom: 10 }}>{p.features || p.desc || ''}</div>
                    <div style={{ fontSize: 24, fontWeight: 800, margin: '10px 0', color: 'var(--accent)' }}>
                      {(+(p.price || 0)) === 0 ? 'Free' : `₹${(+(p.price || 0)).toLocaleString()}`}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 15 }}>per {p.duration} days</div>
                    
                    {profile?.plan === p.name ? (
                      <button className="btn btn-primary" style={{ width: '100%', opacity: 0.7 }} disabled>Current Plan</button>
                    ) : (
                      <button className="btn btn-primary" style={{ width: '100%' }} onClick={() => toast(`Contact Admin to upgrade to ${p.name}`, 'info')}>Upgrade Now</button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}


          {active === 'Business' && (
            <div className="tw">
              <div className="tw-head"><h3>Business Profile</h3><button className="btn btn-primary btn-sm" onClick={saveBiz}>Save Business</button></div>
              <div style={{ padding: '20px' }}>
                <div className="sub" style={{ marginBottom: 20 }}>Public business information used for invoices and professional documents.</div>
                <div className="fgrid">
                  <div className="fg span2"><label>Business Name</label><input value={biz.bizName} onChange={e => setBiz(b => ({ ...b, bizName: e.target.value }))} placeholder="e.g. Acme Corp" /></div>
                  <div className="fg span2"><label>Business Tagline</label><input value={biz.tagline} onChange={e => setBiz(b => ({ ...b, tagline: e.target.value }))} placeholder="e.g. Quality products at best prices" /></div>
                  <div className="fg span2"><label>Business Address</label><textarea value={biz.address} onChange={e => setBiz(b => ({ ...b, address: e.target.value }))} style={{ minHeight: 60 }} /></div>
                  <div className="fg"><label>Official Email</label><input type="email" value={biz.bizEmail} onChange={e => setBiz(b => ({ ...b, bizEmail: e.target.value }))} /></div>
                  <div className="fg"><label>Official Phone</label><input value={biz.bizPhone} onChange={e => setBiz(b => ({ ...b, bizPhone: e.target.value }))} /></div>
                  <div className="fg">
                    <label>Country</label>
                    <select value={biz.country} onChange={e => setBiz(b => ({ ...b, country: e.target.value }))}>
                      {COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div className="fg">
                    <label>State</label>
                    <select value={biz.bizState} onChange={e => setBiz(b => ({ ...b, bizState: e.target.value }))}>
                      <option value="">Select State...</option>
                      {INDIAN_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </div>
                  <div className="fg"><label>Pincode</label><input value={biz.pincode} onChange={e => setBiz(b => ({ ...b, pincode: e.target.value }))} placeholder="Postal Code" /></div>
                  <div className="fg">
                    <label>Default Currency</label>
                    <select value={biz.defaultCurrency} onChange={e => setBiz(b => ({ ...b, defaultCurrency: e.target.value }))}>
                      {SUPPORTED_CURRENCIES.map(c => <option key={c.code} value={c.code}>{c.symbol} {c.code} — {c.name}</option>)}
                    </select>
                    <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4 }}>Used as default for new invoices & quotations (can be overridden per record).</div>
                  </div>
                  <div className="fg"><label>GSTIN</label><input value={biz.gstin} onChange={e => setBiz(b => ({ ...b, gstin: e.target.value }))} placeholder="22AAAAA0000A1Z5" /></div>
                  <div className="fg"><label>PAN</label><input value={biz.pan} onChange={e => setBiz(b => ({ ...b, pan: e.target.value }))} placeholder="AAAPZ1234C" /></div>
                  <div className="fg span2"><label>Website</label><input value={biz.website} onChange={e => setBiz(b => ({ ...b, website: e.target.value }))} /></div>
                  <div className="fg span2">
                    <label>WhatsApp Notification Number</label>
                    <input
                      value={biz.waNotifPhone}
                      onChange={e => setBiz(b => ({ ...b, waNotifPhone: e.target.value }))}
                      placeholder="e.g. 919876543210 (with country code, no +)"
                    />
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                      WhatsApp template messages set to <strong>"Business Owner"</strong> will be sent to this number. Include country code (e.g. 91 for India).
                    </div>
                  </div>
                  <div className="fg span2">
                    <label>Additional Notification Emails (comma-separated)</label>
                    <input 
                      value={biz.bizExtraEmails} 
                      onChange={e => setBiz(b => ({ ...b, bizExtraEmails: e.target.value }))} 
                      placeholder="manager@example.com, support@example.com" 
                    />
                    <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4 }}>These emails will also receive automated business alerts (Follow-ups, etc.)</div>
                  </div>

                  <div className="fg span2" style={{ background: 'var(--bg-soft)', padding: 16, borderRadius: 10, border: '1px solid var(--border)' }}>
                    <label style={{ fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
                      🌐 Brand URL Slug
                      <span style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 400 }}>(e.g. your-business-name)</span>
                    </label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 0, marginTop: 8, border: '1.5px solid var(--border)', borderRadius: 8, overflow: 'hidden', background: '#fff' }}>
                      <span style={{ padding: '8px 10px', background: 'var(--bg-soft)', fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap', borderRight: '1px solid var(--border)' }}>
                        {(settings?.crmDomain || window.location.origin).replace(/\/$/, '')}/
                      </span>
                      <input
                        value={biz.slug}
                        onChange={e => setBiz(b => ({ ...b, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') }))}
                        placeholder="your-slug"
                        style={{ border: 'none', borderRadius: 0, flex: 1, padding: '8px 12px' }}
                      />
                    </div>
                    {biz.slug && (
                      <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                        <div style={{ background: '#fff', padding: '10px 14px', borderRadius: 10, border: '1px solid var(--border)', position: 'relative' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase' }}>🛒 Store Website</div>
                            <div style={{ display: 'flex', gap: 4 }}>
                              <button className="btn-icon" style={{ fontSize: 10, padding: '2px 6px' }} onClick={() => { navigator.clipboard.writeText(`${(settings?.crmDomain || window.location.origin).replace(/\/$/, '')}/${biz.slug}/store`); toast('Copied!', 'success'); }} title="Copy Store Link">📋</button>
                              <button className="btn-icon" style={{ fontSize: 10, padding: '2px 6px' }} onClick={() => window.open(`${(settings?.crmDomain || window.location.origin).replace(/\/$/, '')}/${biz.slug}/store`, '_blank')} title="Open Store">👁</button>
                            </div>
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--accent)', marginTop: 4, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {(settings?.crmDomain || window.location.origin).replace(/\/$/, '')}/{biz.slug}/store
                          </div>
                        </div>
                        <div style={{ background: '#fff', padding: '10px 14px', borderRadius: 10, border: '1px solid var(--border)', position: 'relative' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase' }}>📅 Booking Page</div>
                            <div style={{ display: 'flex', gap: 4 }}>
                              <button className="btn-icon" style={{ fontSize: 10, padding: '2px 6px' }} onClick={() => { navigator.clipboard.writeText(`${(settings?.crmDomain || window.location.origin).replace(/\/$/, '')}/${biz.slug}/book`); toast('Copied!', 'success'); }} title="Copy Booking Link">📋</button>
                              <button className="btn-icon" style={{ fontSize: 10, padding: '2px 6px' }} onClick={() => window.open(`${(settings?.crmDomain || window.location.origin).replace(/\/$/, '')}/${biz.slug}/book`, '_blank')} title="Open Booking Page">👁</button>
                            </div>
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--accent)', marginTop: 4, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {(settings?.crmDomain || window.location.origin).replace(/\/$/, '')}/{biz.slug}/book
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="fg span2">
                    <label>Brand Logo</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 15, marginTop: 5 }}>
                      {biz.logo && <img src={biz.logo} alt="Logo" style={{ height: 60, width: 60, objectFit: 'contain', border: '1px solid var(--border)', borderRadius: 8 }} />}
                      <div style={{ flex: 1 }}>
                        <input type="file" accept="image/*" onChange={e => handleFile(e, (res) => setBiz(b => ({ ...b, logo: res })), 'logo')} style={{ fontSize: 12 }} />
                        <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4 }}>Recommended: Square PNG/JPG, Max 500KB.</div>
                      </div>
                      {biz.logo && <button className="btn btn-sm" style={{ background: '#fee2e2', color: '#991b1b' }} onClick={async () => {
                        if (!window.confirm('Remove the brand logo? This cannot be undone.')) return;
                        setBiz(b => ({ ...b, logo: null }));
                        if (profileId) await dbWrite(dbOp.update('userProfiles', profileId, { logo: null }));
                      }}>Remove</button>}
                    </div>
                  </div>
                </div>

                <div style={{ marginTop: 30, paddingTop: 20, borderTop: '2px dashed var(--border)' }}>
                  <h4 style={{ marginBottom: 20, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2" /><line x1="3" y1="10" x2="21" y2="10" /></svg>
                    Payment & Bank Details
                  </h4>
                  <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 30 }}>
                    <div className="fgrid">
                      <div className="fg span2"><label>Account Holder Name</label><input value={fin.accHolder} onChange={e => setFin(f => ({ ...f, accHolder: e.target.value }))} /></div>
                      <div className="fg"><label>Bank Name</label><input value={fin.bankName} onChange={e => setFin(f => ({ ...f, bankName: e.target.value }))} /></div>
                      <div className="fg"><label>Account Number</label><input value={fin.accountNo} onChange={e => setFin(f => ({ ...f, accountNo: e.target.value }))} /></div>
                      <div className="fg"><label>IFSC Code</label><input value={fin.ifsc} onChange={e => setFin(f => ({ ...f, ifsc: e.target.value }))} /></div>
                      <div className="fg span2"><label>Additional Payment Details (Optional)</label><textarea value={fin.bankExtra} onChange={e => setFin(f => ({ ...f, bankExtra: e.target.value }))} placeholder="e.g. UPI ID: name@upi or Swift Code: ..." style={{ minHeight: 60 }} /></div>
                    </div>
                    <div>
                      <label style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, display: 'block' }}>Payment QR Code</label>
                      <div style={{ border: '2px dashed var(--border)', borderRadius: 12, padding: 15, textAlign: 'center', background: 'var(--bg-soft)' }}>
                        {fin.qrCode ? (
                          <div style={{ position: 'relative' }}>
                            <img src={fin.qrCode} alt="QR" style={{ width: '100%', maxWidth: 150, borderRadius: 8 }} />
                            <button className="btn btn-sm" style={{ position: 'absolute', top: -10, right: -10, background: '#fee2e2', color: '#991b1b', padding: '2px 6px' }} onClick={() => setFin(f => ({ ...f, qrCode: null }))}>✕</button>
                          </div>
                        ) : (
                          <div style={{ padding: '10px 0' }}>
                            <div style={{ fontSize: 24, marginBottom: 8 }}>📱</div>
                            <input type="file" accept="image/*" onChange={e => handleFile(e, (res) => setFin(f => ({ ...f, qrCode: res })), 'qrCode')} style={{ fontSize: 11, width: '100%' }} />
                            <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 8 }}>Upload UPI/Payment QR</div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                <div style={{ marginTop: 30, paddingTop: 20, borderTop: '2px dashed var(--border)' }}>
                  <h4 style={{ marginBottom: 20, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                    Team Permissions
                  </h4>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 16, background: 'var(--bg-soft)', borderRadius: 10, border: '1px solid var(--border)' }}>
                    <label style={{ position: 'relative', display: 'inline-block', width: 44, height: 24, flexShrink: 0 }}>
                      <input
                        type="checkbox"
                        checked={profile?.teamCanSeeAllLeads !== false}
                        onChange={async (e) => {
                          if (profileId) {
                            await dbWrite(dbOp.update('userProfiles', profileId, { teamCanSeeAllLeads: e.target.checked }));
                            toast(e.target.checked ? 'Team members can now see all leads' : 'Team members can only see their assigned leads', 'success');
                          }
                        }}
                        style={{ opacity: 0, width: 0, height: 0 }}
                      />
                      <span style={{
                        position: 'absolute', cursor: 'pointer', top: 0, left: 0, right: 0, bottom: 0,
                        background: profile?.teamCanSeeAllLeads !== false ? 'var(--accent)' : '#cbd5e1',
                        borderRadius: 24, transition: '.3s',
                      }}>
                        <span style={{
                          position: 'absolute', height: 18, width: 18, left: profile?.teamCanSeeAllLeads !== false ? 22 : 3, bottom: 3,
                          background: '#fff', borderRadius: '50%', transition: '.3s',
                        }} />
                      </span>
                    </label>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 13 }}>Team members can see all leads</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                        {profile?.teamCanSeeAllLeads !== false
                          ? 'Enabled: Team members can view all leads in the system'
                          : 'Disabled: Team members can only see leads assigned to them'}
                      </div>
                    </div>
                  </div>

                  {/* Second toggle: only relevant when the main "see all leads" toggle is OFF */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 16, marginTop: 12, background: 'var(--bg-soft)', borderRadius: 10, border: '1px solid var(--border)', opacity: profile?.teamCanSeeAllLeads !== false ? 0.5 : 1 }}>
                    <label style={{ position: 'relative', display: 'inline-block', width: 44, height: 24, flexShrink: 0 }}>
                      <input
                        type="checkbox"
                        checked={profile?.teamCanSeeUnassignedLeads !== false}
                        disabled={profile?.teamCanSeeAllLeads !== false}
                        onChange={async (e) => {
                          if (profileId) {
                            await dbWrite(dbOp.update('userProfiles', profileId, { teamCanSeeUnassignedLeads: e.target.checked }));
                            toast(e.target.checked ? 'Team members can now see unassigned leads' : 'Team members can no longer see unassigned leads', 'success');
                          }
                        }}
                        style={{ opacity: 0, width: 0, height: 0 }}
                      />
                      <span style={{
                        position: 'absolute', cursor: profile?.teamCanSeeAllLeads !== false ? 'not-allowed' : 'pointer', top: 0, left: 0, right: 0, bottom: 0,
                        background: profile?.teamCanSeeUnassignedLeads !== false ? 'var(--accent)' : '#cbd5e1',
                        borderRadius: 24, transition: '.3s',
                      }}>
                        <span style={{
                          position: 'absolute', height: 18, width: 18, left: profile?.teamCanSeeUnassignedLeads !== false ? 22 : 3, bottom: 3,
                          background: '#fff', borderRadius: '50%', transition: '.3s',
                        }} />
                      </span>
                    </label>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 13 }}>Team members can see unassigned leads</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                        {profile?.teamCanSeeAllLeads !== false
                          ? 'Not applicable when "see all leads" is enabled'
                          : (profile?.teamCanSeeUnassignedLeads !== false
                              ? 'Enabled: Team members see assigned + unassigned leads'
                              : 'Disabled: Team members see ONLY leads assigned to them')}
                      </div>
                    </div>
                  </div>
                </div>

                <div style={{ marginTop: 30, paddingTop: 20, borderTop: '2px dashed var(--border)' }}>
                   <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <h4 style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
                          <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M21 2v6h-6M3 12a9 9 0 0115-6.7L21 8M3 22v-6h6m12-4a9 9 0 01-15 6.7L3 16" /></svg>
                          Data Maintenance
                        </h4>
                        <div className="sub" style={{ marginBottom: 15 }}>Sync existing lead contact details (Phone/Email) with their matching customer records.</div>
                      </div>
                      <button className="btn btn-secondary" onClick={syncExistingData}>
                        🔄 Sync Data
                      </button>
                   </div>
                </div>
              </div>
            </div>
          )}

          {active === 'Finance' && (
            <div className="tw">
              <div className="tw-head"><h3>Quotation & Invoice Settings</h3><button className="btn btn-primary btn-sm" onClick={saveFin}>Save Settings</button></div>
              <div style={{ padding: '20px' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 30 }}>
                  {/* Quotations */}
                  <div>
                    <h4 style={{ marginBottom: 15, color: 'var(--accent)' }}>Quotations</h4>
                    <div className="fgrid">
                      <div className="fg"><label>Prefix</label><input value={fin.qPrefix} onChange={e => setFin(f => ({ ...f, qPrefix: e.target.value }))} /></div>
                      <div className="fg"><label>Starting Number</label><input type="number" value={fin.qNextNum} onChange={e => setFin(f => ({ ...f, qNextNum: parseInt(e.target.value) || 1 }))} /></div>
                      <div className="fg span2"><label>Default Terms & Conditions</label><textarea value={fin.qTerms} onChange={e => setFin(f => ({ ...f, qTerms: e.target.value }))} style={{ minHeight: 80 }} /></div>
                      <div className="fg span2"><label>Default Notes</label><textarea value={fin.qNotes} onChange={e => setFin(f => ({ ...f, qNotes: e.target.value }))} style={{ minHeight: 60 }} /></div>
                    </div>
                  </div>

                  {/* Invoices */}
                  <div>
                    <h4 style={{ marginBottom: 15, color: 'var(--green)' }}>Invoices</h4>
                    <div className="fgrid">
                      <div className="fg"><label>Prefix</label><input value={fin.iPrefix} onChange={e => setFin(f => ({ ...f, iPrefix: e.target.value }))} /></div>
                      <div className="fg"><label>Starting Number</label><input type="number" value={fin.iNextNum} onChange={e => setFin(f => ({ ...f, iNextNum: parseInt(e.target.value) || 1 }))} /></div>
                      <div className="fg span2"><label>Default Terms & Conditions</label><textarea value={fin.iTerms} onChange={e => setFin(f => ({ ...f, iTerms: e.target.value }))} style={{ minHeight: 80 }} /></div>
                      <div className="fg span2"><label>Default Notes</label><textarea value={fin.iNotes} onChange={e => setFin(f => ({ ...f, iNotes: e.target.value }))} style={{ minHeight: 60 }} /></div>
                    </div>
                  </div>
                </div>

                <div style={{ marginTop: 30, paddingTop: 20, borderTop: '2px dashed var(--border)' }}>
                  <div className="fgrid">
                    <div className="fg">
                      <label style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>Ship to option</label>
                      <select value={fin.reqShipping} onChange={e => setFin(f => ({ ...f, reqShipping: e.target.value }))}>
                        <option value="Optional">Toggle (Optional addition per-document)</option>
                        <option value="Hidden">Hidden (Do not feature Ship To address)</option>
                        <option value="Mandatory">Mandatory (Always require Ship To address)</option>
                      </select>
                    </div>
                    <div className="fg">
                      <label style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>Default Tax Rate (%)</label>
                      <select value={fin.defaultTaxRate} onChange={e => setFin(f => ({ ...f, defaultTaxRate: parseFloat(e.target.value) || 0 }))}>
                        {taxRates.map(t => <option key={t.label} value={t.rate}>{t.label} ({t.rate}%)</option>)}
                      </select>
                    </div>
                  </div>
                </div>

              </div>
            </div>
          )}

          {active === 'Taxes' && (
            <div className="tw">
              <div className="tw-head"><h3>Tax Configuration</h3></div>
              <div style={{ padding: '16px 20px' }}>
                <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
                  <input value={newTax.label} onChange={e => setNewTax({ ...newTax, label: e.target.value })} placeholder="Label (e.g. IGST 18%)" style={{ flex: 2, padding: '8px 12px', border: '1.5px solid var(--border)', borderRadius: 8, fontSize: 13, fontFamily: 'inherit' }} />
                  <input type="number" value={newTax.rate} onChange={e => setNewTax({ ...newTax, rate: e.target.value })} placeholder="Rate (%)" style={{ flex: 1, padding: '8px 12px', border: '1.5px solid var(--border)', borderRadius: 8, fontSize: 13, fontFamily: 'inherit' }} />
                  <button className="btn btn-primary btn-sm" onClick={addTaxRate}>Add Tax</button>
                </div>
                <div className="tw-scroll">
                  <table style={{ background: 'var(--bg)', borderRadius: 8, overflow: 'hidden' }}>
                    <thead><tr><th>Tax Label</th><th>Percentage Rate</th><th>Action</th></tr></thead>
                    <tbody>
                      {taxRates.length === 0 ? <tr><td colSpan={3} style={{ textAlign: 'center', padding: 14, color: 'var(--muted)' }}>No taxes defined</td></tr> : taxRates.map((t, i) => (
                        <tr key={i}>
                          <td><strong>{t.label}</strong></td>
                          <td><span className="badge bg-purple">{t.rate}%</span></td>
                          <td>
                             <button className="btn btn-sm" style={{ background: '#fee2e2', color: '#991b1b', padding: '2px 8px' }} onClick={() => removeItem('taxRates', taxRates, i)}>Del</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {active === 'Custom Fields' && (
            <div className="tw">
              <div className="tw-head"><h3>Lead Custom Fields</h3></div>
              <div style={{ padding: '16px 20px' }}>
                <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center' }}>
                  <input value={newCF.name} onChange={e => setNewCF({ ...newCF, name: e.target.value })} placeholder="Field Name (e.g. Budget)" style={{ flex: 1, padding: '8px 12px', border: '1.5px solid var(--border)', borderRadius: 8, fontSize: 13, fontFamily: 'inherit' }} />
                  <select value={newCF.type} onChange={e => setNewCF({ ...newCF, type: e.target.value })} style={{ padding: '8px 12px', border: '1.5px solid var(--border)', borderRadius: 8, fontSize: 13, fontFamily: 'inherit' }}>
                    <option value="text">Text</option>
                    <option value="number">Number</option>
                    <option value="dropdown">Dropdown</option>
                  </select>
                  {newCF.type === 'dropdown' && (
                     <input value={newCF.options} onChange={e => setNewCF({ ...newCF, options: e.target.value })} placeholder="Options (comma separated)" style={{ flex: 1, padding: '8px 12px', border: '1.5px solid var(--border)', borderRadius: 8, fontSize: 13, fontFamily: 'inherit' }} />
                  )}
                  <button className="btn btn-primary btn-sm" onClick={addCF}>{editingCFIndex !== null ? 'Update Field' : 'Add Field'}</button>
                  {editingCFIndex !== null && <button className="btn btn-secondary btn-sm" onClick={cancelEditCF}>Cancel</button>}
                </div>
                <div className="tw-scroll">
                  <table style={{ background: 'var(--bg)', borderRadius: 8, overflow: 'hidden' }}>
                    <thead><tr><th>Field Name</th><th>Type</th><th>Options</th><th>Action</th></tr></thead>
                    <tbody>
                      {customFields.length === 0 ? <tr><td colSpan={4} style={{ textAlign: 'center', padding: 14, color: 'var(--muted)' }}>No custom fields defined</td></tr> : customFields.map((cf, i) => (
                        <tr key={i}>
                          <td><strong>{cf.name}</strong></td>
                          <td><span className="badge bg-gray">{cf.type}</span></td>
                          <td>{cf.type === 'dropdown' ? cf.options : '-'}</td>
                          <td style={{ display: 'flex', gap: 6 }}>
                             <button className="btn btn-sm btn-secondary" style={{ padding: '2px 8px' }} onClick={() => editCF(i)}>✎ Edit</button>
                             <button className="btn btn-sm" style={{ background: '#fee2e2', color: '#991b1b', padding: '2px 8px' }} onClick={() => removeItem('customFields', customFields, i)}>Del</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {active === 'Sources' && (
            <div className="tw">
              <div className="tw-head"><h3>Lead Sources</h3></div>
              <div style={{ padding: '16px 20px' }}>
                <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                  <input value={newSource} onChange={e => setNewSource(e.target.value)} placeholder="New source..." style={{ flex: 1, padding: '8px 12px', border: '1.5px solid var(--border)', borderRadius: 8, fontSize: 13, fontFamily: 'inherit' }} />
                  <button className="btn btn-primary btn-sm" onClick={() => addItem('sources', sources, newSource, setNewSource)}>Add</button>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {sources.map((s, i) => (
                    <span key={i} className="badge bg-blue" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '5px 10px' }}>
                      {s} 
                      <span style={{ cursor: 'pointer', opacity: 0.8 }} onClick={() => editItem('sources', sources, i, s)}>✎</span>
                      <span style={{ cursor: 'pointer', color: '#1e40af' }} onClick={() => removeItem('sources', sources, i)}>✕</span>
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}

          {active === 'Stages' && (
            <div className="tw">
              <div className="tw-head"><h3>Lead Stages</h3></div>
              <div style={{ padding: '16px 20px' }}>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>Drag ⠿ to reorder. Changes apply to the Kanban board and all stage dropdowns.</div>

                {/* Add New Stage */}
                <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                  <input
                    value={newStage}
                    onChange={e => setNewStage(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && newStage.trim() && (saveList('stages', [...stages, newStage.trim()]), setNewStage(''))}
                    placeholder="New stage name..."
                    style={{ flex: 1, padding: '8px 12px', border: '1.5px solid var(--border)', borderRadius: 8, fontSize: 13, fontFamily: 'inherit' }}
                  />
                  <button className="btn btn-primary btn-sm" onClick={() => { if (!newStage.trim()) return; saveList('stages', [...stages, newStage.trim()]); setNewStage(''); }}>+ Add Stage</button>
                </div>

                {/* Stage List */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {stages.map((s, i) => (
                    <div
                      key={i}
                      draggable
                      onDragStart={e => { stageDragIdx.current = i; e.dataTransfer.effectAllowed = 'move'; }}
                      onDragOver={e => e.preventDefault()}
                      onDrop={e => {
                        const from = stageDragIdx.current;
                        if (from === null || from === i) return;
                        const reordered = [...stages];
                        const [moved] = reordered.splice(from, 1);
                        reordered.splice(i, 0, moved);
                        saveList('stages', reordered);
                        stageDragIdx.current = null;
                      }}
                      onDragEnd={() => { stageDragIdx.current = null; }}
                      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, cursor: 'grab', userSelect: 'none' }}
                    >
                      <span style={{ fontSize: 18, color: 'var(--muted)', lineHeight: 1, cursor: 'grab' }}>⠿</span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', width: 20, textAlign: 'center' }}>#{i + 1}</span>
                      {editingStageIdx === i ? (
                        <input
                          autoFocus
                          value={editingStageVal}
                          onChange={e => setEditingStageVal(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') { 
                               const newVal = editingStageVal.trim();
                               if (newVal && newVal !== s) {
                                  const nl = [...stages]; 
                                  nl[i] = newVal;
                                  const extra = {};
                                  if (s === wonStage) extra.wonStage = newVal;
                                  if (s === lostStage) extra.lostStage = newVal;
                                  
                                  const txs = [dbOp.update('userProfiles', profileId, { stages: nl, ...extra })];
                                  // Update leads
                                  (data?.leads || []).filter(l => l.stage === s).forEach(l => {
                                     txs.push(dbOp.update('leads', l.id, { stage: newVal }));
                                  });
                                  dbWrite(txs).then(() => toast('Stage updated!', 'success'));
                               }
                               setEditingStageIdx(null); 
                            }
                            if (e.key === 'Escape') setEditingStageIdx(null);
                          }}
                          onBlur={() => { 
                             const newVal = editingStageVal.trim();
                             if (newVal && newVal !== s) {
                                const nl = [...stages]; 
                                nl[i] = newVal;
                                const extra = {};
                                if (s === wonStage) extra.wonStage = newVal;
                                
                                const txs = [dbOp.update('userProfiles', profileId, { stages: nl, ...extra })];
                                (data?.leads || []).filter(l => l.stage === s).forEach(l => {
                                   txs.push(dbOp.update('leads', l.id, { stage: newVal }));
                                });
                                dbWrite(txs).then(() => toast('Stage updated!', 'success'));
                             }
                             setEditingStageIdx(null); 
                          }}
                          style={{ flex: 1, padding: '4px 8px', border: '1.5px solid var(--accent)', borderRadius: 6, fontSize: 13, fontFamily: 'inherit' }}
                        />
                      ) : (
                        <span style={{ flex: 1, fontSize: 13, fontWeight: 500 }}>{s} {(SYSTEM_STAGES.includes(s) || s === wonStage) && <span style={{ color: 'var(--muted)', fontSize: 10, fontWeight: 400, marginLeft: 8 }}>(System Stage)</span>}</span>
                      )}
                      
                      {(!SYSTEM_STAGES.includes(s) || s === wonStage) && (
                         <button
                           className="btn btn-secondary btn-sm"
                           style={{ fontSize: 11, padding: '2px 8px' }}
                           onClick={() => { setEditingStageIdx(i); setEditingStageVal(s); }}
                         >✎ Rename</button>
                      )}

                      {(!SYSTEM_STAGES.includes(s) && s !== wonStage) && (
                         <button
                           className="btn btn-sm"
                           style={{ fontSize: 11, padding: '2px 8px', background: '#fee2e2', color: '#991b1b' }}
                           onClick={() => removeItem('stages', stages, i)}
                         >✕</button>
                      )}
                      
                      {(SYSTEM_STAGES.includes(s) || s === wonStage) && (
                        <button
                          className="btn btn-sm"
                          style={{ 
                            fontSize: 11, 
                            padding: '2px 8px', 
                            background: disabledStages.includes(s) ? '#f3f4f6' : '#ecfdf5', 
                            color: disabledStages.includes(s) ? '#4b5563' : '#047857',
                            border: `1px solid ${disabledStages.includes(s) ? '#d1d5db' : '#a7f3d0'}`
                          }}
                          onClick={() => {
                            const nw = disabledStages.includes(s) ? disabledStages.filter(x => x !== s) : [...disabledStages, s];
                            saveList('disabledStages', nw);
                          }}
                        >
                          {disabledStages.includes(s) ? 'Enable' : 'Disable'}
                        </button>
                      )}
                    </div>
                  ))}
                  {stages.length === 0 && <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 13, padding: 20 }}>No stages yet. Add one above.</div>}
                </div>
              </div>
            </div>
          )}

          {active === 'Requirements' && (
            <div className="tw">
              <div className="tw-head"><h3>Lead Requirements</h3></div>
              <div style={{ padding: '16px 20px' }}>
                <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                  <input value={newRequirement} onChange={e => setNewRequirement(e.target.value)} placeholder="New requirement..." style={{ flex: 1, padding: '8px 12px', border: '1.5px solid var(--border)', borderRadius: 8, fontSize: 13, fontFamily: 'inherit' }} />
                  <button className="btn btn-primary btn-sm" onClick={() => addItem('requirements', requirements, newRequirement, setNewRequirement)}>Add</button>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {requirements.map((l, i) => (
                    <span key={i} className="badge bg-orange" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '5px 10px' }}>
                      {l} 
                      <span style={{ cursor: 'pointer', opacity: 0.8 }} onClick={() => editItem('requirements', requirements, i, l)}>✎</span>
                      <span style={{ cursor: 'pointer' }} onClick={() => removeItem('requirements', requirements, i)}>✕</span>
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}

          {active === 'Product Categories' && (
            <div className="tw">
              <div className="tw-head"><h3>Product Categories</h3></div>
              <div style={{ padding: '16px 20px' }}>
                <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                  <input value={newProdCat} onChange={e => setNewProdCat(e.target.value)} placeholder="New product category..." style={{ flex: 1, padding: '8px 12px', border: '1.5px solid var(--border)', borderRadius: 8, fontSize: 13, fontFamily: 'inherit' }} />
                  <button className="btn btn-primary btn-sm" onClick={() => addItem('productCats', productCats, newProdCat, setNewProdCat)}>Add</button>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {productCats.map((c, i) => (
                    <span key={i} className="badge bg-blue" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '5px 10px' }}>
                      {c} 
                      <span style={{ cursor: 'pointer', opacity: 0.8 }} onClick={() => editItem('productCats', productCats, i, c)}>✎</span>
                      <span style={{ cursor: 'pointer' }} onClick={() => removeItem('productCats', productCats, i)}>✕</span>
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}
          
          {active === 'Product Units' && (
            <div className="tw">
              <div className="tw-head"><h3>Product Units</h3></div>
              <div style={{ padding: '16px 20px' }}>
                <div className="sub" style={{ marginBottom: 15 }}>Manage units of measurement (e.g. Nos, Kgs, Hours) used for products and line items.</div>
                <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                  <input value={newUnit} onChange={e => setNewUnit(e.target.value)} placeholder="New unit (e.g. Boxes)..." style={{ flex: 1, padding: '8px 12px', border: '1.5px solid var(--border)', borderRadius: 8, fontSize: 13, fontFamily: 'inherit' }} />
                  <button className="btn btn-primary btn-sm" onClick={() => addItem('productUnits', productUnits, newUnit, setNewUnit)}>Add Unit</button>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {productUnits.map((u, i) => (
                    <span key={i} className="badge bg-teal" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '5px 10px' }}>
                      {u} 
                      <span style={{ cursor: 'pointer', opacity: 0.8 }} onClick={() => editItem('productUnits', productUnits, i, u)}>✎</span>
                      <span style={{ cursor: 'pointer' }} onClick={() => removeItem('productUnits', productUnits, i)}>✕</span>
                    </span>
                  ))}
                </div>
                {productUnits.length === 0 && <div style={{ textAlign: 'center', color: 'var(--muted)', fontSize: 13, padding: 20 }}>No units added. Default units will be used.</div>}
              </div>
            </div>
          )}

          {active === 'Expense Categories' && (
            <div className="tw">
              <div className="tw-head"><h3>Expense Categories</h3></div>
              <div style={{ padding: '16px 20px' }}>
                <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                  <input value={newExpCat} onChange={e => setNewExpCat(e.target.value)} placeholder="New category..." style={{ flex: 1, padding: '8px 12px', border: '1.5px solid var(--border)', borderRadius: 8, fontSize: 13, fontFamily: 'inherit' }} />
                  <button className="btn btn-primary btn-sm" onClick={() => addItem('expCats', expCats, newExpCat, setNewExpCat)}>Add</button>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {expCats.map((c, i) => (
                    <span key={i} className="badge bg-gray" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '5px 10px' }}>
                      {c} 
                      <span style={{ cursor: 'pointer', opacity: 0.8 }} onClick={() => editItem('expCats', expCats, i, c)}>✎</span>
                      <span style={{ cursor: 'pointer' }} onClick={() => removeItem('expCats', expCats, i)}>✕</span>
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}

          {active === 'Task Statuses' && (
            <div className="tw">
              <div className="tw-head"><h3>Task Statuses</h3></div>
              <div style={{ padding: '16px 20px' }}>
                <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                  <input value={newTaskStatus} onChange={e => setNewTaskStatus(e.target.value)} placeholder="New status..." style={{ flex: 1, padding: '8px 12px', border: '1.5px solid var(--border)', borderRadius: 8, fontSize: 13, fontFamily: 'inherit' }} />
                  <button className="btn btn-primary btn-sm" onClick={() => addItem('taskStatuses', taskStatuses, newTaskStatus, setNewTaskStatus)}>Add</button>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {taskStatuses.map((s, i) => (
                    <span key={i} className="badge bg-purple" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '5px 10px' }}>
                      {s} 
                      <span style={{ cursor: 'pointer', opacity: 0.8 }} onClick={() => editItem('taskStatuses', taskStatuses, i, s)}>✎</span>
                      <span style={{ cursor: 'pointer' }} onClick={() => removeItem('taskStatuses', taskStatuses, i)}>✕</span>
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}

          {active === 'Order Statuses' && (
            <div className="tw">
              <div className="tw-head"><h3>Order Statuses</h3></div>
              <div style={{ padding: '16px 20px' }}>
                <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                  <input value={newOrderStatus} onChange={e => setNewOrderStatus(e.target.value)} placeholder="New order status..." style={{ flex: 1, padding: '8px 12px', border: '1.5px solid var(--border)', borderRadius: 8, fontSize: 13, fontFamily: 'inherit' }} />
                  <button className="btn btn-primary btn-sm" onClick={() => addItem('orderStatuses', orderStatuses, newOrderStatus, setNewOrderStatus)}>Add</button>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {orderStatuses.map((s, i) => (
                    <span key={i} className="badge bg-blue" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, padding: '5px 10px' }}>
                      {s} 
                      <span style={{ cursor: 'pointer', opacity: 0.8 }} onClick={() => editItem('orderStatuses', orderStatuses, i, s)}>✎</span>
                      <span style={{ cursor: 'pointer' }} onClick={() => removeItem('orderStatuses', orderStatuses, i)}>✕</span>
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}

          {active === 'SMTP' && (
            <div className="tw">
              <div className="tw-head">
                <h3>Email Settings (Direct SMTP)</h3>
                <div style={{ display: 'flex', gap: 8 }}>
                   <button className="btn btn-secondary btn-sm" onClick={testSMTP}>Test Connection</button>
                   <button className="btn btn-primary btn-sm" onClick={saveSMTP}>Save</button>
                </div>
              </div>
              <div style={{ padding: '20px' }}>
                <div className="sub" style={{ marginBottom: 15 }}>
                  Enter your SMTP server details below. Works with Gmail, Outlook, Hostinger, or any SMTP provider.
                </div>
                <div className="fgrid">
                  <div className="fg"><label>SMTP Host</label><input value={smtpHost} onChange={e => setSmtpHost(e.target.value)} placeholder="e.g., smtp.gmail.com" /></div>
                  <div className="fg"><label>SMTP Port</label><input value={smtpPort} onChange={e => setSmtpPort(e.target.value)} placeholder="587 or 465" /></div>
                  <div className="fg"><label>Email / Username</label><input value={smtpUser} onChange={e => setSmtpUser(e.target.value)} placeholder="your@email.com" /></div>
                  <div className="fg"><label>Password / App Password</label><input type="password" value={smtpPass} onChange={e => setSmtpPass(e.target.value)} placeholder="••••••••" /></div>
                </div>
                <div style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 8, padding: 12, fontSize: 12, marginTop: 12, color: '#166534' }}>
                  💡 <strong>Gmail Users:</strong> Use an <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer" style={{ color: '#166534', fontWeight: 600 }}>App Password</a> (not your main password). Set Host to <code>smtp.gmail.com</code>, Port to <code>587</code>.
                </div>
              </div>
            </div>
          )}

          {active === 'WhatsApp' && (
            <div className="tw">
              <div className="tw-head"><h3>WhatsApp API (Waprochat)</h3><button className="btn btn-primary btn-sm" onClick={saveWA}>Save Settings</button></div>
              <div style={{ padding: '20px' }}>
                <div className="sub" style={{ marginBottom: 20 }}>Configure your Waprochat API credentials to enable automated WhatsApp notifications.</div>
                
                {waApiToken && waPhoneId ? (
                  <div style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 10, padding: '10px 14px', marginBottom: 18, display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                    <span style={{ color: '#16a34a', fontWeight: 700 }}>✓ Configured</span>
                    <span style={{ color: '#166534' }}>— Waprochat API credentials are on file. Use "Test Send" to verify.</span>
                  </div>
                ) : (
                  <div style={{ background: '#fefce8', border: '1px solid #fde047', borderRadius: 10, padding: '10px 14px', marginBottom: 18, fontSize: 13, color: '#854d0e' }}>
                    ⚠ Not configured. Fill in your Waprochat API credentials below and click Save.
                  </div>
                )}

                <div className="fgrid">
                  <div className="fg span2">
                    <label>API Token *</label>
                    <input
                      type="password"
                      value={waApiToken}
                      onChange={e => setWaApiToken(e.target.value)}
                      placeholder="Paste your Waprochat API token here"
                    />
                  </div>
                  <div className="fg">
                    <label>Phone Number ID *</label>
                    <input
                      value={waPhoneId}
                      onChange={e => setWaPhoneId(e.target.value)}
                      placeholder="e.g. 1234567890123456"
                    />
                  </div>
                  <div className="fg">
                    <label>Test Phone Number (for Test Send)</label>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input
                        value={waTestNumber}
                        onChange={e => setWaTestNumber(e.target.value)}
                        placeholder="+91XXXXXXXXXX"
                        style={{ flex: 1 }}
                      />
                      <button className="btn btn-secondary btn-sm" onClick={testWA}>Test Send</button>
                    </div>
                  </div>
                </div>

                <div style={{ marginTop: 20, border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
                  <div style={{ padding: '10px 14px', background: 'var(--bg)', fontSize: 12, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: '1px solid var(--border)' }}>📋 Setup Guide</div>
                  <div style={{ padding: '14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {[
                      ['1', 'Login to your', 'Waprochat Portal', 'https://portal.waprochat.in', 'and navigate to API settings.'],
                      ['2', 'Copy your', 'API Token', null, 'and', 'Phone Number ID', null, 'from the dashboard.'],
                      ['3', 'Paste them into the fields above and click Save.'],
                      ['4', 'Go to the "WhatsApp Templates" tab to configure your message templates.'],
                      ['5', 'Ensure your templates are approved on the portal before using them here.'],
                    ].map(([num, ...parts]) => (
                      <div key={num} style={{ display: 'flex', gap: 10, fontSize: 12 }}>
                        <span style={{ width: 20, height: 20, borderRadius: '50%', background: 'var(--accent)', color: '#fff', fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{num}</span>
                        <span style={{ color: 'var(--text)', lineHeight: 1.5 }}>
                          {parts.length === 5 ? (
                            <>{parts[0]} <a href={parts[2]} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)', fontWeight: 600 }}>{parts[1]}</a> {parts[3]} {parts[4]}</>
                          ) : parts.join(' ')}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {active === 'WhatsApp Templates' && (() => {
            // Helper: extract #variable# placeholders from template body
            const extractVars = (body) => {
              const normal = body?.match(/#([a-zA-Z_][a-zA-Z0-9_]*)#/g) || [];
              const dateTokens = body?.match(/#(\+\d+day)#/gi) || [];
              return [...normal, ...dateTokens].map((m, i) => ({ index: i + 1, name: m.replace(/#/g, ''), raw: m }));
            };

            const hasWACredentials = !!(waApiToken?.trim() && waPhoneId?.trim());

            // Helper: generate curl command for a template
            const buildCurl = (t) => {
              if (t.customCurl) return t.customCurl;
              const vars = extractVars(t.body);
              const lines = [
                `curl -X POST \\`,
                `https://portal.waprochat.in/api/v1/whatsapp/send/template \\`,
                `-d "apiToken=${waApiToken ? '••••••••••••••••••••' : '{YOUR_API_TOKEN}'}" \\`,
                `-d "phone_number_id=${waPhoneId ? '••••••••••••' : '{YOUR_PHONE_NUMBER_ID}'}" \\`,
                `-d "template_id=${t.templateId || '{template-id}'}" \\`,
              ];
              vars.forEach(v => {
                lines.push(`-d "templateVariable-${v.name}-${v.index}=#${v.name}#" \\`);
              });
              lines.push(`-d "phone_number=#phone#"`);
              return lines.join('\n');
            };

            // Save helper that persists immediately
            const saveTemplatesNow = async (newTemplates) => {
              setWhatsappTemplates(newTemplates);
              const payload = { waApiToken, waPhoneId, whatsappTemplates: newTemplates, userId: ownerId };
              if (profileId) await dbWrite(dbOp.update('userProfiles', profileId, payload));
            };

            return (
            <div className="tw">
              <div className="tw-head">
                <h3>WhatsApp Templates</h3>
              </div>
              <div style={{ padding: '20px' }}>
                <div className="sub" style={{ marginBottom: 20 }}>
                  Create WhatsApp message templates with <code>#variable#</code> placeholders. The curl command is auto-generated based on variables in your template.
                </div>

                {/* ── WhatsApp API Credentials Status ── */}
                {!hasWACredentials && (
                  <div style={{ marginBottom: 20, padding: '12px 16px', background: '#fef3c7', border: '1px solid #fbbf24', borderRadius: 10, display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
                    <span style={{ fontSize: 18 }}>⚠️</span>
                    <div>
                      <div style={{ fontWeight: 700, color: '#92400e' }}>WhatsApp API credentials not configured</div>
                      <div style={{ fontSize: 12, color: '#a16207', marginTop: 2 }}>
                        Go to <strong>WhatsApp</strong> settings tab to add your API Token & Phone Number ID. The curl commands will use placeholder values until configured.
                      </div>
                    </div>
                  </div>
                )}
                {hasWACredentials && (
                  <div style={{ marginBottom: 20, padding: '10px 14px', background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 10, display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
                    <span style={{ fontSize: 16 }}>✅</span>
                    <div>
                      <span style={{ fontWeight: 700, color: '#166534' }}>API credentials loaded</span>
                      <span style={{ color: '#15803d', marginLeft: 6 }}>— Phone ID: <code style={{ background: '#dcfce7', padding: '1px 6px', borderRadius: 4, fontSize: 11 }}>{waPhoneId}</code></span>
                    </div>
                  </div>
                )}

                {/* ── How it works ── */}
                <div style={{ marginBottom: 24, padding: 14, background: '#f0f9ff', borderRadius: 10, border: '1px solid #bae6fd', fontSize: 12, color: '#0369a1', lineHeight: 1.6 }}>
                  <div style={{ fontWeight: 700, marginBottom: 6 }}>💡 How it works</div>
                  <div>1. Create your template in <strong>Waprochat / Meta</strong> using <code>#variable#</code> format (same as here).</div>
                  <div>2. Add the template here with the <strong>same message</strong> — use <code>#variable_name#</code> for dynamic values.</div>
                  <div>3. The CRM auto-generates the curl command using your <strong>API Token</strong> & <strong>Phone Number ID</strong> from WhatsApp settings.</div>
                  <div>4. Click <strong>Edit</strong> on any template to view and customize the curl command.</div>
                  <div style={{ marginTop: 6, color: '#1e40af', fontWeight: 600 }}>
                    Example: <code>Hello #client#, Invoice #invoiceno# for Rs.#amt#/-</code> → <code>client=1, invoiceno=2, amt=3</code>
                  </div>
                  <div style={{ marginTop: 12 }}>
                    <button
                      onClick={() => window.open('/wa-guide', '_blank')}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: '#2563eb', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                      📖 Open Variable Guide — all variables with examples (module-wise)
                    </button>
                    <div style={{ fontSize: 11, color: '#0369a1', marginTop: 4 }}>
                      Confused about <code>#validuntil#</code>, <code>#endDate#</code>, <code>#requirement#</code> etc.? See every variable explained with examples for each module.
                    </div>
                  </div>
                </div>

                {/* ── Add / Edit Template Form ── */}
                <div style={{ marginBottom: 24, padding: 16, background: editingWA ? '#fffbeb' : 'var(--bg-soft)', borderRadius: 12, border: editingWA ? '2px solid #fbbf24' : '1px solid var(--border)' }}>
                  <h4 style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                    {editingWA ? '✏️ Edit Template' : '➕ Add New Template'}
                  </h4>
                  <div className="fgrid">
                    <div className="fg"><label>Template Name *</label><input placeholder="e.g. Invoice Notification" id="new_wa_name" /></div>
                    <div className="fg"><label>Waprochat Template ID *</label><input placeholder="e.g. invoice_notify_01" id="new_wa_id" /></div>
                    <div className="fg span2">
                      <label>Template Message (use <code>#variable#</code> for dynamic values)</label>
                      <textarea
                        placeholder="Hello #client#, this is a reminder for your upcoming #service# on #date#. Thank you!"
                        id="new_wa_body"
                        value={waFormBody}
                        onChange={e => setWaFormBody(e.target.value)}
                        style={{ minHeight: 80, lineHeight: 1.6 }}
                      />
                      <div style={{ marginTop: 8 }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', marginBottom: 5, textTransform: 'uppercase' }}>Insert Variable</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                          {[
                            { var: '#client#', label: 'Client Name' },
                            { var: '#email#', label: 'Email' },
                            { var: '#phone#', label: 'Phone' },
                            { var: '#stage#', label: 'Lead Stage' },
                            { var: '#source#', label: 'Lead Source' },
                            { var: '#assignee#', label: 'Assignee' },
                            { var: '#followupDate#', label: 'Follow-up Date' },
                            { var: '#bizName#', label: 'Business Name' },
                            { var: '#date#', label: "Today's Date" },
                            { var: '#amount#', label: 'Amount' },
                            { var: '#contractNo#', label: 'Contract No.' },
                            { var: '#apptDate#', label: 'Appt Date' },
                            { var: '#apptTime#', label: 'Appt Time' },
                            { var: '#service#', label: 'Service Name' },
                            { var: '#orderId#', label: 'Order ID' },
                            { var: '#orderStatus#', label: 'Order Status' },
                            { var: '#orderAmount#', label: 'Order Total' },
                            { var: '#invoiceno#', label: 'Invoice No' },
                            { var: '#lead#', label: 'Lead Name' },
                            { var: '#leadphoneno#', label: 'Lead Phone No' },
                            { var: '#clientphoneno#', label: 'Client Phone No' },
                            { var: '#assignee#', label: 'Assignee' },
                            { var: '#stage#', label: 'Lead Stage' },
                            { var: '#requirement#', label: 'Lead Requirement' },
                            { var: '#fromstage#', label: 'From Stage' },
                            { var: '#tostage#', label: 'To Stage' },
                            { var: '#quoteno#', label: 'Quote No' },
                            { var: '#validuntil#', label: 'Quote Valid Until' },
                            { var: '#task#', label: 'Task Title' },
                            { var: '#duedate#', label: 'Due Date' },
                            { var: '#priority#', label: 'Task Priority' },
                            { var: '#followupdate#', label: 'Follow-up Date' },
                            { var: '#daysLeft#', label: 'Days Left' },
                            { var: '#contractNo#', label: 'AMC Contract No' },
                            { var: '#endDate#', label: 'AMC End Date' },
                            { var: '#plan#', label: 'AMC Plan' },
                            { var: '#today#', label: "Today's Date" },
                            { var: '#tomorrow#', label: "Tomorrow's Date" },
                            { var: '#+1day#', label: '+1 Day' },
                            { var: '#+2day#', label: '+2 Days' },
                            { var: '#+3day#', label: '+3 Days' },
                            { var: '#+7day#', label: '+7 Days' },
                            { var: '#+15day#', label: '+15 Days' },
                            { var: '#+30day#', label: '+30 Days' },
                          ].map(v => (
                            <button key={v.var} onClick={() => {
                              setWaFormBody(prev => prev + v.var);
                            }}
                              className="btn btn-sm"
                              style={{ fontSize: 11, padding: '2px 8px', background: '#f0fdf4', color: '#16a34a', border: '1px solid #bbf7d0', borderRadius: 20, cursor: 'pointer' }}>
                              {v.var}
                            </button>
                          ))}
                        </div>
                        <div style={{ marginTop: 8 }}>
                          <button className="btn btn-sm" style={{ fontSize: 11, padding: '3px 10px', background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe', borderRadius: 6 }}
                            onClick={() => window.open('/wa-guide', '_blank')}>
                            📖 Variable Guide — what each variable means with examples
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* ── Curl Preview — shown for both Add New and Edit, updates live as body changes ── */}
                  {(() => {
                    const isCustomCurl = !!(editingWA && whatsappTemplates.find(tpl => tpl.id === editingWA.id)?.customCurl);
                    // For Add New: build curl from current form state (waFormBody + id field)
                    // For Edit: build from the saved template (with custom curl support)
                    let previewCurl;
                    if (editingWA) {
                      const currentTpl = whatsappTemplates.find(tpl => tpl.id === editingWA.id) || editingWA;
                      previewCurl = buildCurl(currentTpl);
                    } else {
                      // Live preview from the form fields
                      const liveTemplateId = document.getElementById('new_wa_id')?.value || '{template-id}';
                      const liveTpl = { templateId: liveTemplateId, body: waFormBody };
                      previewCurl = buildCurl(liveTpl);
                    }
                    const hasContent = waFormBody.trim().length > 0 || editingWA;
                    if (!hasContent) return null;
                    return (
                      <div style={{ marginTop: 16 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase' }}>⚡ Curl Command Preview</div>
                            {isCustomCurl && <span style={{ fontSize: 9, padding: '2px 6px', background: '#fef3c7', color: '#92400e', borderRadius: 8, fontWeight: 600, border: '1px solid #fde68a' }}>CUSTOM EDIT</span>}
                            {!isCustomCurl && hasWACredentials && <span style={{ fontSize: 9, padding: '2px 6px', background: '#f0fdf4', color: '#166534', borderRadius: 8, fontWeight: 600, border: '1px solid #bbf7d0' }}>AUTO-GENERATED</span>}
                            {!editingWA && <span style={{ fontSize: 9, padding: '2px 6px', background: '#eff6ff', color: '#1d4ed8', borderRadius: 8, fontWeight: 600, border: '1px solid #bfdbfe' }}>LIVE PREVIEW</span>}
                          </div>
                          <div style={{ display: 'flex', gap: 6 }}>
                            {isCustomCurl && (
                              <button className="btn btn-sm" style={{ fontSize: 10, padding: '2px 8px', background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a' }} onClick={() => {
                                setEditingWA({ ...editingWA, customCurl: undefined });
                                setWhatsappTemplates(whatsappTemplates.map(tpl =>
                                  tpl.id === editingWA.id ? { ...tpl, customCurl: undefined } : tpl
                                ));
                                toast('Curl reset to auto-generated', 'info');
                              }}>↺ Reset</button>
                            )}
                            <button className="btn btn-sm" style={{ fontSize: 10, padding: '2px 8px', background: '#f0fdf4', color: '#16a34a', border: '1px solid #bbf7d0' }} onClick={() => {
                              navigator.clipboard.writeText(previewCurl);
                              toast('Curl command copied!', 'success');
                            }}>📋 Copy</button>
                          </div>
                        </div>
                        <textarea
                          value={previewCurl}
                          readOnly={!editingWA}
                          onChange={editingWA ? e => {
                            const newCurl = e.target.value;
                            setEditingWA({ ...editingWA, customCurl: newCurl });
                            setWhatsappTemplates(whatsappTemplates.map(tpl =>
                              tpl.id === editingWA.id ? { ...tpl, customCurl: newCurl } : tpl
                            ));
                          } : undefined}
                          spellCheck={false}
                          style={{
                            width: '100%',
                            minHeight: 140,
                            padding: '12px 14px',
                            background: '#1e293b',
                            color: '#e2e8f0',
                            borderRadius: 10,
                            fontSize: 11,
                            lineHeight: 1.7,
                            whiteSpace: 'pre',
                            fontFamily: "'Fira Code', 'SF Mono', 'Consolas', monospace",
                            border: isCustomCurl ? '2px solid #fbbf24' : '1px solid #334155',
                            resize: 'vertical',
                            boxSizing: 'border-box',
                            cursor: editingWA ? 'text' : 'default',
                          }}
                        />
                        <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4 }}>
                          {editingWA
                            ? '💡 Edit the curl command directly to customise. API Token & Phone Number ID are loaded from your WhatsApp settings.'
                            : '💡 Live preview — updates as you type the template body. Fill in the Waprochat Template ID above to see it here.'}
                        </div>
                      </div>
                    );
                  })()}

                  {/* ── Auto-Trigger Settings ── */}
                  <div style={{ marginTop: 16, padding: 14, background: '#f0fdf4', borderRadius: 10, border: '1px solid #bbf7d0' }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#166534', textTransform: 'uppercase', marginBottom: 8 }}>⚡ Auto-Notification Trigger</div>
                    <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                      <select id="new_wa_trigger" style={{ padding: '8px 12px', border: '1.5px solid #86efac', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', background: '#fff' }}
                        onChange={e => {
                          const val = e.target.value;
                          setWaFormTrigger(val);
                          // Auto-fill sample body only when adding new (not editing)
                          if (!editingWA && val && WA_SAMPLE_BODIES[val]) {
                            setWaFormBody(WA_SAMPLE_BODIES[val]);
                          }
                        }}>
                        {AUTO_TRIGGER_EVENTS.map(e => <option key={e.value} value={e.value}>{e.label}</option>)}
                      </select>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600, color: '#166534', cursor: 'pointer' }}>
                        <input type="checkbox" id="new_wa_autoEnabled" style={{ width: 16, height: 16 }} />
                        Enable Auto-Send
                      </label>
                    </div>
                    <div style={{ fontSize: 11, color: '#15803d', marginTop: 6 }}>When enabled, this template is sent automatically when the selected event occurs — no automation setup needed.</div>
                    {/* ── Days-before field — shown for amc_expiry and lead_followup ── */}
                    {(waFormTrigger === 'amc_expiry' || waFormTrigger === 'lead_followup') && (
                      <>
                        <div style={{ marginTop: 12, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                          <div style={{ fontSize: 12, fontWeight: 700, color: '#166534' }}>⏰ Send this alert:</div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <input type="number" id="new_wa_days" min="1" max="365" defaultValue={waFormTrigger === 'lead_followup' ? '1' : '7'}
                              style={{ width: 70, padding: '6px 8px', border: '1.5px solid #86efac', borderRadius: 8, fontSize: 13, fontFamily: 'inherit', background: '#fff' }} />
                            <span style={{ fontSize: 13, color: '#166534', fontWeight: 600 }}>
                              {waFormTrigger === 'lead_followup' ? 'day(s) before follow-up date' : 'days before AMC expiry'}
                            </span>
                          </div>
                        </div>
                        <div style={{ fontSize: 11, color: '#15803d', marginTop: 4 }}>
                          {waFormTrigger === 'lead_followup'
                            ? <>Set to <strong>1</strong> for a day-before reminder, <strong>0</strong> sends on the follow-up day itself. Create separate templates for different timings.</>
                            : <>Set to <strong>7</strong> for a week-before warning, <strong>1</strong> for a final day reminder. Create separate templates for each milestone.</>
                          }
                        </div>
                      </>
                    )}
                    {/* ── Recipients (multi-select checkboxes) ── */}
                    <div style={{ marginTop: 12 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#166534', marginBottom: 8 }}>📱 Send message to: <span style={{ fontSize: 10, fontWeight: 400 }}>(select one or more — separate message per recipient)</span></div>
                      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                        {[
                          { value: 'client',   label: 'Client / Lead',           hint: "lead/customer's phone" },
                          { value: 'owner',    label: 'Business Owner',          hint: 'WhatsApp Notification Number' },
                          { value: 'assignee', label: 'Assigned Staff Member',   hint: "staff member's phone in Teams" },
                        ].map(opt => (
                          <label key={opt.value} style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', fontSize: 13, fontWeight: 600, color: '#166534', background: waFormRecipients.includes(opt.value) ? '#dcfce7' : '#f0fdf4', border: `1.5px solid ${waFormRecipients.includes(opt.value) ? '#86efac' : '#d1fae5'}`, borderRadius: 8, padding: '6px 12px' }}>
                            <input type="checkbox"
                              checked={waFormRecipients.includes(opt.value)}
                              onChange={e => setWaFormRecipients(prev =>
                                e.target.checked ? [...prev, opt.value] : prev.filter(r => r !== opt.value)
                              )}
                              style={{ width: 14, height: 14, accentColor: '#16a34a' }}
                            />
                            {opt.label}
                            <span style={{ fontSize: 10, fontWeight: 400, color: '#4ade80' }}>({opt.hint})</span>
                          </label>
                        ))}
                      </div>
                      {waFormRecipients.length > 1 && (
                        <div style={{ fontSize: 11, color: '#0369a1', background: '#e0f2fe', border: '1px solid #bae6fd', borderRadius: 6, padding: '5px 10px', marginTop: 8 }}>
                          ℹ️ {waFormRecipients.length} recipients selected — the API will be called {waFormRecipients.length} times with different phone numbers.
                        </div>
                      )}
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
                    <button className="btn btn-primary" onClick={async () => {
                      const name = document.getElementById('new_wa_name').value;
                      const templateId = document.getElementById('new_wa_id').value;
                      const body = waFormBody;
                      const autoTrigger = document.getElementById('new_wa_trigger').value;
                      const autoEnabled = document.getElementById('new_wa_autoEnabled').checked;
                      const recipientTypes = waFormRecipients.length > 0 ? waFormRecipients : ['client'];
                      const daysVal = parseInt(document.getElementById('new_wa_days')?.value || '7', 10) || 7;
                      const daysBeforeExpiry  = autoTrigger === 'amc_expiry'    ? daysVal : undefined;
                      const daysBeforeFollowup = autoTrigger === 'lead_followup' ? daysVal : undefined;
                      if (!name || !templateId) return toast('Name and Template ID required', 'error');
                      if (!body.trim()) return toast('Template message body is required', 'error');

                      const vars = extractVars(body);
                      const tplObj = { name, templateId, body, variables: vars, autoTrigger, autoEnabled, recipientTypes,
                        ...(daysBeforeExpiry  != null ? { daysBeforeExpiry }  : {}),
                        ...(daysBeforeFollowup != null ? { daysBeforeFollowup } : {}),
                      };

                      if (editingWA) {
                        const updated = whatsappTemplates.map(t =>
                          t.id === editingWA.id ? { ...t, ...tplObj, customCurl: editingWA.customCurl } : t
                        );
                        await saveTemplatesNow(updated);
                        setEditingWA(null);
                        toast('Template updated & saved!', 'success');
                      } else {
                        const updated = [...whatsappTemplates, { id: id(), ...tplObj }];
                        await saveTemplatesNow(updated);
                        toast('Template added & saved!', 'success');
                      }

                      document.getElementById('new_wa_name').value = '';
                      document.getElementById('new_wa_id').value = '';
                      document.getElementById('new_wa_trigger').value = '';
                      document.getElementById('new_wa_autoEnabled').checked = false;
                      setWaFormRecipients(['client']);
                      if (document.getElementById('new_wa_days')) document.getElementById('new_wa_days').value = '7';
                      setWaFormTrigger('');
                      setWaFormBody('');
                    }}>{editingWA ? 'Update Template' : 'Add Template'}</button>
                    {editingWA && <button className="btn btn-secondary" onClick={() => {
                      setEditingWA(null);
                      document.getElementById('new_wa_name').value = '';
                      document.getElementById('new_wa_id').value = '';
                      document.getElementById('new_wa_trigger').value = '';
                      document.getElementById('new_wa_autoEnabled').checked = false;
                      setWaFormRecipients(['client']);
                      if (document.getElementById('new_wa_days')) document.getElementById('new_wa_days').value = '7';
                      setWaFormTrigger('');
                      setWaFormBody('');
                    }}>Cancel Edit</button>}
                  </div>
                </div>

                {/* ── Template Cards (compact - no curl shown) ── */}
                {whatsappTemplates.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: 40, color: 'var(--muted)', background: 'var(--bg-soft)', borderRadius: 12, border: '1.5px dashed var(--border)' }}>
                    <div style={{ fontSize: 28, marginBottom: 8 }}>💬</div>
                    <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>No WhatsApp templates yet</div>
                    <div style={{ fontSize: 12 }}>Add your first template above to get started.</div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {whatsappTemplates.map((t, idx) => {
                      const vars = extractVars(t.body);
                      const isBeingEdited = editingWA?.id === t.id;
                      return (
                        <div key={t.id} style={{ border: isBeingEdited ? '2px solid #fbbf24' : '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', background: isBeingEdited ? '#fffdf5' : 'var(--surface)' }}>
                          {/* Header */}
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', background: isBeingEdited ? '#fefce8' : 'var(--bg-soft)', borderBottom: '1px solid var(--border)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                              <span style={{ fontSize: 18 }}>💬</span>
                              <div>
                                <div style={{ fontWeight: 700, fontSize: 14 }}>{t.name} {isBeingEdited && <span style={{ fontSize: 10, color: '#b45309', fontWeight: 400 }}>(Editing)</span>}</div>
                                <div style={{ fontSize: 11, color: 'var(--muted)', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                                  Template ID: <code style={{ background: '#e0f2fe', color: '#0369a1', padding: '1px 6px', borderRadius: 4 }}>{t.templateId}</code>
                                  {(() => {
                                    const rTypes = t.recipientTypes
                                      ? (Array.isArray(t.recipientTypes) ? t.recipientTypes : [t.recipientTypes])
                                      : [t.recipientType || 'client'];
                                    const labels = { client: 'Client', owner: 'Owner', assignee: 'Assignee' };
                                    return rTypes.map(r => (
                                      <span key={r} style={{ background: r === 'owner' ? '#fef9c3' : r === 'assignee' ? '#eff6ff' : '#f0fdf4', color: r === 'owner' ? '#854d0e' : r === 'assignee' ? '#1d4ed8' : '#166534', padding: '1px 7px', borderRadius: 10, fontWeight: 600, fontSize: 10, border: '1px solid', borderColor: r === 'owner' ? '#fde68a' : r === 'assignee' ? '#bfdbfe' : '#86efac' }}>
                                        📱 {labels[r] || r}
                                      </span>
                                    ));
                                  })()}
                                  {t.autoTrigger === 'amc_expiry' && (
                                    <span style={{ background: '#eff6ff', color: '#1d4ed8', padding: '1px 7px', borderRadius: 10, fontWeight: 600, fontSize: 10, border: '1px solid #bfdbfe' }}>
                                      ⏰ {t.daysBeforeExpiry || 7}d before expiry
                                    </span>
                                  )}
                                  {t.autoTrigger === 'lead_followup' && (
                                    <span style={{ background: '#eff6ff', color: '#1d4ed8', padding: '1px 7px', borderRadius: 10, fontWeight: 600, fontSize: 10, border: '1px solid #bfdbfe' }}>
                                      ⏰ {t.daysBeforeFollowup ?? 1}d before follow-up
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>
                            <div style={{ display: 'flex', gap: 6 }}>
                              <button className="btn btn-secondary btn-sm" style={{ fontSize: 11 }} onClick={() => {
                                setEditingWA(t);
                                setTimeout(() => {
                                  const nameEl = document.getElementById('new_wa_name');
                                  const idEl = document.getElementById('new_wa_id');
                                  const bodyEl = document.getElementById('new_wa_body');
                                  const triggerEl = document.getElementById('new_wa_trigger');
                                  const enabledEl = document.getElementById('new_wa_autoEnabled');
                                  if (nameEl) nameEl.value = t.name;
                                  if (idEl) idEl.value = t.templateId;
                                  if (triggerEl) triggerEl.value = t.autoTrigger || '';
                                  if (enabledEl) enabledEl.checked = !!t.autoEnabled;
                                  // backward compat: old templates use recipientType (string)
                                  const saved = t.recipientTypes
                                    ? (Array.isArray(t.recipientTypes) ? t.recipientTypes : [t.recipientTypes])
                                    : [t.recipientType || 'client'];
                                  setWaFormRecipients(saved);
                                  setWaFormTrigger(t.autoTrigger || '');
                                  setWaFormBody(t.body || '');
                                  const daysEl = document.getElementById('new_wa_days');
                                  if (daysEl) {
                                    if (t.autoTrigger === 'lead_followup') daysEl.value = t.daysBeforeFollowup ?? 1;
                                    else daysEl.value = t.daysBeforeExpiry ?? 7;
                                  }
                                }, 0);
                                window.scrollTo({ top: 0, behavior: 'smooth' });
                              }}>✏️ Edit</button>
                              <button className="btn btn-sm" style={{ background: '#fee2e2', color: '#991b1b', fontSize: 11 }} onClick={async () => {
                                if (window.confirm('Delete this template?')) {
                                  const updated = whatsappTemplates.filter((_, i) => i !== idx);
                                  await saveTemplatesNow(updated);
                                  if (editingWA?.id === t.id) setEditingWA(null);
                                  toast('Template deleted', 'error');
                                }
                              }}>🗑 Delete</button>
                            </div>
                          </div>

                          <div style={{ padding: '12px 16px' }}>
                            {/* Template Message Preview */}
                            <div style={{ padding: '10px 14px', background: '#dcfce7', borderRadius: 10, fontSize: 13, lineHeight: 1.6, color: '#14532d', border: '1px solid #86efac', whiteSpace: 'pre-wrap' }}>
                              {t.body || 'No message body'}
                            </div>
                            {vars.length > 0 && (
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                                {vars.map(v => (
                                  <span key={v.index} style={{ fontSize: 10, padding: '3px 8px', background: '#dbeafe', color: '#1e40af', borderRadius: 12, fontWeight: 600, border: '1px solid #93c5fd' }}>
                                    Variable {v.index}: {'#' + v.name + '#'}
                                  </span>
                                ))}
                              </div>
                            )}
                            {t.customCurl && (
                              <div style={{ fontSize: 10, marginTop: 6, color: '#92400e', fontWeight: 600 }}>📝 Custom curl command saved</div>
                            )}

                            {/* Auto-Trigger Status */}
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10, padding: '8px 12px', background: t.autoEnabled ? '#f0fdf4' : '#f8fafc', borderRadius: 8, border: `1px solid ${t.autoEnabled ? '#86efac' : '#e2e8f0'}` }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <span style={{ fontSize: 14 }}>{t.autoEnabled ? '⚡' : '💤'}</span>
                                <div>
                                  <div style={{ fontSize: 11, fontWeight: 700, color: t.autoEnabled ? '#166534' : '#64748b' }}>
                                    {t.autoEnabled ? 'Auto-Send Active' : 'Auto-Send Off'}
                                  </div>
                                  {t.autoTrigger && (
                                    <div style={{ fontSize: 10, color: t.autoEnabled ? '#15803d' : '#94a3b8' }}>
                                      Trigger: {AUTO_TRIGGER_EVENTS.find(e => e.value === t.autoTrigger)?.label || t.autoTrigger}
                                    </div>
                                  )}
                                </div>
                              </div>
                              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                                <input
                                  type="checkbox"
                                  checked={!!t.autoEnabled}
                                  onChange={async (e) => {
                                    const updated = whatsappTemplates.map(tpl =>
                                      tpl.id === t.id ? { ...tpl, autoEnabled: e.target.checked } : tpl
                                    );
                                    await saveTemplatesNow(updated);
                                    toast(e.target.checked ? `Auto-send enabled for "${t.name}"` : `Auto-send disabled for "${t.name}"`, e.target.checked ? 'success' : 'info');
                                  }}
                                  style={{ width: 16, height: 16 }}
                                />
                                <span style={{ fontSize: 11, fontWeight: 600, color: '#475569' }}>Enable</span>
                              </label>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
            );
          })()}

          {active === 'Templates' && (
            <div className="tw">
              <div className="tw-head"><h3>Document Templates</h3><button className="btn btn-primary btn-sm" onClick={saveFin}>Save Defaults</button></div>
              <div style={{ padding: '20px' }}>
                <div className="sub" style={{ marginBottom: 25 }}>Select the default look and feel for your Invoices and Quotations.</div>
                
                 <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 30 }}>
                    {/* Invoice Template Selection */}
                    <div>
                       <h4 style={{ marginBottom: 15 }}>Default Invoice Template</h4>
                       <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 15 }}>
                          {[
                            { id: 'Classic', name: 'Classic' },
                            { id: 'Modern', name: 'Modern' },
                            { id: 'Minimal', name: 'Minimal' },
                            { id: 'Spreadsheet', name: 'Tax Invoice (GST)' },
                          ].map(t => (
                            <div key={t.id} onClick={() => setFin(f => ({ ...f, invoiceTemplate: t.id }))} style={{ border: fin.invoiceTemplate === t.id ? '2px solid var(--accent)' : '1px solid var(--border)', borderRadius: 10, padding: 10, cursor: 'pointer', textAlign: 'center', backgroundColor: fin.invoiceTemplate === t.id ? 'rgba(var(--accent-rgb), 0.05)' : 'transparent', transition: '0.2s', minWidth: 0 }}>
                               <div style={{ height: 160, background: '#f8fafc', borderRadius: 6, marginBottom: 8, overflow: 'hidden', border: '1px solid var(--border)', position: 'relative', display: 'flex', justifyContent: 'center' }}>
                                  <div style={{ transform: 'scale(0.18)', transformOrigin: 'top center', pointerEvents: 'none', width: '210mm', height: '297mm', flexShrink: 0 }}>
                                     <DocumentTemplate data={{ ...sampleInv, template: t.id }} profile={biz} preview={true} type="Invoice" />
                                  </div>
                               </div>
                               <div style={{ fontSize: 12, fontWeight: 700 }}>{t.name}</div>
                            </div>
                          ))}
                       </div>
                    </div>

                    {/* Quotation Template Selection */}
                    <div>
                       <h4 style={{ marginBottom: 15 }}>Default Quotation Template</h4>
                       <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 15 }}>
                          {[
                            { id: 'Classic', name: 'Classic' },
                            { id: 'Modern', name: 'Modern' },
                            { id: 'Minimal', name: 'Minimal' },
                            { id: 'Spreadsheet', name: 'Spreadsheet' },
                          ].map(t => (
                            <div key={t.id} onClick={() => setFin(f => ({ ...f, quotationTemplate: t.id }))} style={{ border: fin.quotationTemplate === t.id ? '2px solid var(--accent)' : '1px solid var(--border)', borderRadius: 10, padding: 10, cursor: 'pointer', textAlign: 'center', backgroundColor: fin.quotationTemplate === t.id ? 'rgba(var(--accent-rgb), 0.05)' : 'transparent', transition: '0.2s', minWidth: 0 }}>
                               <div style={{ height: 160, background: '#f8fafc', borderRadius: 6, marginBottom: 8, overflow: 'hidden', border: '1px solid var(--border)', position: 'relative', display: 'flex', justifyContent: 'center' }}>
                                  <div style={{ transform: 'scale(0.18)', transformOrigin: 'top center', pointerEvents: 'none', width: '210mm', height: '297mm', flexShrink: 0 }}>
                                     <DocumentTemplate data={{ ...sampleInv, template: t.id }} profile={biz} preview={true} type="Quotation" />
                                  </div>
                               </div>
                               <div style={{ fontSize: 12, fontWeight: 700 }}>{t.name}</div>
                            </div>
                          ))}
                       </div>
                    </div>
                 </div>

                <div style={{ marginTop: 40, padding: 20, bgcolor: '#f8fafc', borderRadius: 12, border: '1px solid var(--border)' }}>
                   <div style={{ fontWeight: 700, marginBottom: 10 }}>💡 Pro Tip</div>
                   <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.5 }}>
                      The <strong>Tax Invoice (GST)</strong> template is optimized for Indian GST compliance and A4 printing. It automatically splits IGST into CGST/SGST based on your business and client states.
                   </div>
                </div>
              </div>
            </div>
          )}


        </div>
      </div>
    </div>
  );
}
