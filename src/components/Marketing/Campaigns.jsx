import React, { useState, useMemo, useEffect } from 'react';
import { dbWrite, dbOp } from '../../utils/dbWrite';
import db from '../../instant';
import { id } from '@instantdb/react';
import { useToast } from '../../context/ToastContext';
import { sendEmail } from '../../utils/messaging';
import { fmtD, INDIAN_STATES, DEFAULT_STAGES, DEFAULT_SOURCES, DEFAULT_REQUIREMENTS } from '../../utils/helpers';

const TEMPLATES = [
  { id: 'blank', name: 'Blank Template', subject: '', body: '' },
  { id: 'festival', name: '🎉 Festival Offer', subject: 'Special Festival Greetings & Offer for {{name}}!', body: 'Hi {{name}},\n\nWishing you a wonderful festive season! As a special thanks for being in touch with us, we are offering an exclusive discount on our services this week.\n\nReply to this email to claim your offer!\n\nBest regards,\nThe Team' },
  { id: 'sale', name: '💰 Flash Sale', subject: 'Flash Sale: 20% Off Today Only!', body: 'Hello {{name}},\n\nWe are running a 24-hour flash sale! Get 20% off all our premium packages if you book today.\n\nDon\'t miss out on this limited-time offer.\n\nThanks,\nOur Team' },
  { id: 'reengage', name: '👋 Re-engagement', subject: 'Are you still looking for services, {{name}}?', body: 'Hi {{name}},\n\nIt\'s been a while since we last spoke! I wanted to check in and see if you are still looking for solutions in this space. Our team has added some great new features recently that might be perfect for you.\n\nLet me know if you have time for a quick 5-minute chat this week.\n\nBest,\nYour Dedicated Rep' }
];

export default function Campaigns({ user, perms, ownerId }) {
  const canCreate = perms?.can('Campaigns', 'create') === true;
  const canEdit = perms?.can('Campaigns', 'edit') === true;
  const canDelete = perms?.can('Campaigns', 'delete') === true;

  const [tab, setTab] = useState('compose'); // 'compose' | 'history'
  
  // Filters
  const [targetType, setTargetType] = useState('leads'); // 'leads' | 'customers' | 'both'
  const [selStages, setSelStages] = useState(new Set());
  const [selSources, setSelSources] = useState(new Set());
  const [selRequirements, setSelRequirements] = useState(new Set());
  
  const [selProducts, setSelProducts] = useState(new Set());
  const [selPeriod, setSelPeriod] = useState('');
  const [minAmount, setMinAmount] = useState('');
  const [maxAmount, setMaxAmount] = useState('');
  const [selAmcStatus, setSelAmcStatus] = useState(new Set());
  const [selStates, setSelStates] = useState(new Set());

  const [excludedIds, setExcludedIds] = useState(new Set());
  const [previewSearch, setPreviewSearch] = useState('');
  const [showPreview, setShowPreview] = useState(false);
  const [manualAdds, setManualAdds] = useState(new Set());
  const [addSearch, setAddSearch] = useState('');
  const [showManualAdd, setShowManualAdd] = useState(false);
  
  // Composer
  const channel = 'email';
  const [campaignName, setCampaignName] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState('blank');
  
  // Processing
  const [sendMode, setSendMode] = useState('now'); // 'now' | 'schedule'
  const [scheduleTime, setScheduleTime] = useState('');
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState(0);
  const toast = useToast();

  const { data } = db.useQuery({
    customers: { $: { where: { userId: ownerId }, limit: 10000 } },
    invoices: { $: { where: { userId: ownerId } } },
    amc: { $: { where: { userId: ownerId } } },
    products: { $: { where: { userId: ownerId } } },
    campaigns: { $: { where: { userId: ownerId } } },
    userProfiles: { $: { where: { userId: ownerId } } },
    campaignTemplates: { $: { where: { userId: ownerId } } }
  });

  // Leads fetched via server (replaced limit:10000 subscription that hung at 11k)
  const [leads, setLeads] = useState([]);
  useEffect(() => {
    if (!ownerId) return;
    fetch('/api/leads-page', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ownerId, mode: 'kanban', tab: 'all', page: 1, pageSize: 1000, isOwner: true, teamCanSeeAllLeads: true, boundaries: {} }),
    })
      .then(r => r.json())
      .then(json => setLeads(json.items || []))
      .catch(() => {});
  }, [ownerId]);
  const customers = useMemo(() => data?.customers || [], [data?.customers]);
  const invoices = data?.invoices || [];
  const amcList = data?.amc || [];
  const products = data?.products || [];
  const campaigns = (data?.campaigns || []).sort((a,b) => b.createdAt - a.createdAt);
  const userTemplates = data?.campaignTemplates || [];
  const profile = data?.userProfiles?.[0];
  const activeStages = profile?.stages || DEFAULT_STAGES;
  const activeSources = profile?.sources || DEFAULT_SOURCES;
  const activeRequirements = profile?.requirements || DEFAULT_REQUIREMENTS;

    const STAGE_ORDER = ['New Enquiry', 'Enquiry Contacted', 'Quotation Created', 'Quotation Sent', 'Invoice Created', 'Invoice Sent', 'Won'];

  // Base candidates list with unified payload structure
  const allCandidates = useMemo(() => {
    const list = [];
    
    // Process Leads
    leads.forEach(l => {
      const custMatch = customers.find(c => c.name === l.name);
      const effEmail = l.email || custMatch?.email;
      const effPhone = l.phone || custMatch?.phone;
      if (!effEmail) return;
      list.push({
        id: `lead_${l.id}`,
        entityId: l.id,
        type: 'Lead',
        name: l.name,
        email: effEmail || '',
        phone: effPhone || '',
        _orig: l
      });
    });

    // Process Customers
    customers.forEach(c => {
      if (!c.email) return;
      list.push({
        id: `cust_${c.id}`,
        entityId: c.id,
        type: 'Customer',
        name: c.name,
        email: c.email || '',
        phone: c.phone || '',
        _orig: c
      });
    });

    return list;
  }, [leads, customers, channel]);

  // Audience Builder Filter
  const targetAudience = useMemo(() => {
    // Helper to calculate total value of a customer's invoices
    const getCustTotals = (cName) => {
      const custInvs = invoices.filter(inv => inv.client === cName);
      const totalAmt = custInvs.reduce((sum, inv) => {
        const sub = (inv.items || []).reduce((s, it) => s + (it.qty || 0) * (it.rate || 0), 0);
        const tax = (inv.items || []).reduce((s, it) => s + (it.qty || 0) * (it.rate || 0) * (it.taxRate || 0) / 100, 0);
        const discAmt = inv.discType === '₹' ? (parseFloat(inv.disc) || 0) : (sub * (parseFloat(inv.disc) || 0) / 100);
        return sum + Math.round(sub - discAmt + tax + (parseFloat(inv.adj) || 0));
      }, 0);
      return { custInvs, totalAmt };
    };

    const list = allCandidates.filter(item => {
      if (manualAdds.has(item.id)) return true; // Always include if manually added
      if (excludedIds.has(item.id)) return false; // Explicitly excluded

      if (item.type === 'Lead') {
        if (targetType === 'customers') return false;
        const l = item._orig;
        if (selStages.size > 0 && !selStages.has(l.stage)) return false;
        if (selSources.size > 0 && !selSources.has(l.source)) return false;
        if (selRequirements.size > 0 && !selRequirements.has(l.requirement)) return false;
        return true;
      } else {
        if (targetType === 'leads') return false;
        const c = item._orig;
        if (selStates.size > 0 && !selStates.has(c.state)) return false;
        
        const { custInvs, totalAmt } = getCustTotals(c.name);
        if (minAmount && totalAmt < parseFloat(minAmount)) return false;
        if (maxAmount && totalAmt > parseFloat(maxAmount)) return false;
        
        if (selProducts.size > 0) {
          const boughtProducts = new Set();
          custInvs.forEach(inv => {
            (inv.items || []).forEach(it => boughtProducts.add(it.name));
          });
          if (!Array.from(selProducts).some(p => boughtProducts.has(p))) return false;
        }

        if (selPeriod) {
          if (custInvs.length === 0) return false;
          const lastPurchDate = Math.max(...custInvs.map(inv => new Date(inv.dueDate).getTime()));
          const daysAgo = (Date.now() - lastPurchDate) / (1000 * 60 * 60 * 24);
          
          if (selPeriod === '30d' && daysAgo > 30) return false;
          if (selPeriod === '3m' && daysAgo > 90) return false;
          if (selPeriod === '6m' && daysAgo > 180) return false;
          if (selPeriod === '1y' && daysAgo > 365) return false;
          if (selPeriod === '1-2y' && (daysAgo <= 365 || daysAgo > 730)) return false;
          if (selPeriod === '2y+' && daysAgo <= 730) return false;
        }

        if (selAmcStatus.size > 0) {
          const custAmcs = amcList.filter(a => a.client === c.name);
          const hasMatchingAmc = custAmcs.some(a => selAmcStatus.has(a.status));
          if (!hasMatchingAmc) return false;
        }
        return true;
      }
    });

    // Deduplicate by email/phone based on channel
    const unique = [];
    const seen = new Set();
    for (const item of list) {
      const key = channel === 'email' ? item.email : item.phone;
      if (!seen.has(key)) {
        seen.add(key);
        // Clean up internal _orig before returning
        const { _orig, ...cleanItem } = item;
        unique.push(cleanItem);
      }
    }

    return unique;
  }, [allCandidates, invoices, amcList, channel, targetType, selStages, selSources, selRequirements, selProducts, selPeriod, minAmount, maxAmount, selAmcStatus, selStates, excludedIds, manualAdds]);

  const loadTemplate = (tid) => {
    setSelectedTemplate(tid);
    // Search both system and user templates
    const sysT = TEMPLATES.find(x => x.id === tid);
    const usrT = userTemplates.find(x => x.id === tid);
    const t = sysT || usrT;
    
    if (t) {
      setSubject(t.subject);
      setBody(t.body);
    }
  };

  const handleSaveTemplate = async () => {
    if (!canEdit) { toast('Permission denied: cannot save templates', 'error'); return; }
    if (!subject.trim() || !body.trim()) return toast('Please enter a subject and body before saving a template', 'error');
    
    // Check if the currently selected template is a custom user template
    const isEditingCustom = userTemplates.some(t => t.id === selectedTemplate);

    if (isEditingCustom) {
      // Overwrite existing custom template
      await dbWrite(dbOp.update('campaignTemplates', selectedTemplate, { subject, body, updatedAt: Date.now() }));
      toast('Template updated successfully', 'success');
    } else {
      // Save as a brand new template
      const templateName = prompt('Enter a name for this new template:');
      if (!templateName || !templateName.trim()) return;

      const newTid = id();
      await dbWrite(dbOp.update('campaignTemplates', newTid, {
        userId: ownerId,
        name: templateName.trim(),
        subject,
        body,
        createdAt: Date.now()
      }));
      
      setSelectedTemplate(newTid);
      toast('New template saved!', 'success');
    }
  };

  const handleDeleteTemplate = async () => {
    if (!canDelete) { toast('Permission denied: cannot delete templates', 'error'); return; }
    if (!confirm('Are you sure you want to delete this custom template?')) return;
    await dbWrite(dbOp.delete('campaignTemplates', selectedTemplate));
    setSelectedTemplate('blank');
    setSubject('');
    setBody('');
    toast('Template deleted', 'error');
  };

  const handleSend = async () => {
    if (!canCreate) { toast('Permission denied: cannot send campaigns', 'error'); return; }
    if (!campaignName.trim()) return toast('Please enter a Campaign Name', 'error');
    if (!profile?.smtpHost) return toast('Please configure your SMTP settings in the Settings page first', 'error');
    if (targetAudience.length === 0) return toast('No leads match your selected filters. Please adjust your audience.', 'error');
    if (!subject.trim() || !body.trim()) return toast('Please enter a subject and email body.', 'error');
    
    if (sendMode === 'schedule') {
      if (!scheduleTime) return toast('Please select a date and time to schedule this campaign.', 'error');
      const skedDate = new Date(scheduleTime);
      if (skedDate < new Date()) return toast('Scheduled time must be in the future.', 'error');
      
      const campId = id();
      await dbWrite(dbOp.update('campaigns', campId, {
        userId: ownerId,
        name: campaignName,
        channel: channel,
        subject: subject,
        body: body,
        audienceSize: targetAudience.length,
        status: 'Scheduled',
        filters: { targetType, stages: Array.from(selStages), sources: Array.from(selSources), requirements: Array.from(selRequirements), products: Array.from(selProducts), period: selPeriod, minAmount, maxAmount, amcStatus: Array.from(selAmcStatus), states: Array.from(selStates) },
        scheduledFor: skedDate.getTime(),
        createdAt: Date.now()
      }));

      toast('Campaign scheduled successfully!', 'success');
      setTab('history');
      setCampaignName('');
      setSubject('');
      setBody('');
      setScheduleTime('');
      return;
    }

    if (!confirm(`Are you sure you want to send this EMAIL campaign to ${targetAudience.length} leads now?`)) return;

    setSending(true);
    setProgress(0);
    
    const campId = id();
    let sentCount = 0;
    
    // Create the campaign record first
    await dbWrite(dbOp.update('campaigns', campId, {
      userId: ownerId,
      name: campaignName,
      channel: channel,
      subject: subject,
      body: body,
      audienceSize: targetAudience.length,
      status: 'Sending...',
      createdAt: Date.now()
    }));

    // Process loop avoiding strict rate limits (Wait 1s between emails)
    for (let i = 0; i < targetAudience.length; i++) {
      const recipient = targetAudience[i];
      const effEmail = recipient.email;
      const effPhone = recipient.phone;

      try {
        const pSubj = subject.replace(/{{name}}/g, recipient.name || 'Friend').replace(/{{email}}/g, effEmail);
        const pBody = body.replace(/{{name}}/g, recipient.name || 'Friend').replace(/{{email}}/g, effEmail);
        
        const logText = `Received email campaign: "${campaignName}"\nSubject: ${pSubj}`;

        await sendEmail(effEmail, pSubj, pBody, ownerId, profile?.bizName, ownerId);
        
        // Log to timeline
          await dbWrite(dbOp.update('activityLogs', id(), {
            entityId: recipient.entityId,
            entityType: recipient.type.toLowerCase(),
            text: logText,
            userId: ownerId,
            actorId: user.id,
            userName: 'System (Campaign)',
            createdAt: Date.now()
          }));
        
        sentCount++;
      } catch (err) {
        console.error(`Failed to send campaign to ${effEmail || effPhone}:`, err);
      }
      
      setProgress(Math.round(((i + 1) / targetAudience.length) * 100));
      // Artificial delay to prevent triggering spam/rate limits on free EmailJS
      await new Promise(r => setTimeout(r, 1500)); 
    }
    
    // Update campaign status
    await dbWrite(dbOp.update('campaigns', campId, {
      status: 'Completed',
      sentCount: sentCount
    }));

    toast(`Campaign complete! Sent to ${sentCount} leads.`, 'success');
    setSending(false);
    setTab('history');
    setCampaignName('');
    setSubject('');
    setBody('');
  };

  const toggleSet = (set, setFn, val) => {
    const next = new Set(set);
    if (next.has(val)) next.delete(val);
    else next.add(val);
    setFn(next);
  };

  return (
    <div>
      <div className="sh" style={{ marginBottom: 20 }}>
        <div><h2>Marketing Campaigns</h2><div className="sub">Send bulk emails to targeted lead segments</div></div>
      </div>

      <div className="tabs">
        {canCreate && <div className={`tab${tab === 'compose' ? ' active' : ''}`} onClick={() => !sending && setTab('compose')}>Compose Campaign</div>}
        <div className={`tab${tab === 'history' ? ' active' : ''}`} onClick={() => !sending && setTab('history')}>Campaign History</div>
        {canEdit && <div className={`tab${tab === 'templates' ? ' active' : ''}`} onClick={() => !sending && setTab('templates')}>My Templates</div>}
      </div>

      {tab === 'compose' && (
        <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 25, marginTop: 20 }}>
          
          {/* LEFT SIDE: Audience Builder */}
          <div className="tw" style={{ padding: 25, height: 'max-content' }}>
            <h3>1. Target Audience</h3>
            <div style={{ marginTop: 15, fontSize: 13, color: 'var(--muted)', marginBottom: 20 }}>Select filters below to build your recipient list. Leaving a category blank means "All".</div>

            <div style={{ display: 'flex', background: 'var(--bg)', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border)', marginBottom: 20 }}>
              <button className={`btn btn-sm ${targetType === 'leads' ? 'btn-primary' : 'btn-ghost'}`} style={{ flex: 1, borderRadius: 0, border: 'none' }} onClick={() => setTargetType('leads')}>Leads</button>
              <button className={`btn btn-sm ${targetType === 'customers' ? 'btn-primary' : 'btn-ghost'}`} style={{ flex: 1, borderRadius: 0, border: 'none' }} onClick={() => setTargetType('customers')}>Customers</button>
              <button className={`btn btn-sm ${targetType === 'both' ? 'btn-primary' : 'btn-ghost'}`} style={{ flex: 1, borderRadius: 0, border: 'none' }} onClick={() => setTargetType('both')}>Both</button>
            </div>
            
            <div style={{ background: 'var(--bg)', padding: 15, borderRadius: 8, textAlign: 'center', marginBottom: 25, border: '1px solid var(--border)' }}>
              <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--accent)' }}>{targetAudience.length}</div>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--muted)', letterSpacing: 1, marginBottom: 4 }}>Recipients Selected</div>
              <div style={{ fontSize: 10, color: 'var(--muted)', fontStyle: 'italic' }}>
                (Excludes missing {channel === 'email' ? 'email' : 'phone number'}{targetType === 'both' ? ', avoids duplicates' : ''})
              </div>
            </div>

            {(targetType === 'leads' || targetType === 'both') && (
              <div style={{ padding: 12, border: '1px dashed var(--border)', borderRadius: 8, marginBottom: 20, background: 'var(--bg-soft)' }}>
                <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', color: 'var(--muted)', letterSpacing: 1, marginBottom: 15 }}>Lead Filters</div>
                <div style={{ marginBottom: 20 }}>
                  <strong style={{ fontSize: 13, display: 'block', marginBottom: 10 }}>Filter by Stage {selStages.size > 0 && <span style={{ color: 'var(--accent)' }}>({selStages.size})</span>}</strong>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 150, overflowY: 'auto' }}>
                    {activeStages.map(s => (
                      <label key={s} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer' }}>
                        <input type="checkbox" checked={selStages.has(s)} onChange={() => toggleSet(selStages, setSelStages, s)} style={{ accentColor: 'var(--accent)' }}/> {s}
                      </label>
                    ))}
                  </div>
                </div>

                <div style={{ marginBottom: 20 }}>
                  <strong style={{ fontSize: 13, display: 'block', marginBottom: 10 }}>Filter by Source {selSources.size > 0 && <span style={{ color: 'var(--accent)' }}>({selSources.size})</span>}</strong>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 150, overflowY: 'auto' }}>
                    {activeSources.map(s => (
                      <label key={s} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer' }}>
                        <input type="checkbox" checked={selSources.has(s)} onChange={() => toggleSet(selSources, setSelSources, s)} style={{ accentColor: 'var(--accent)' }}/> {s}
                      </label>
                    ))}
                  </div>
                </div>

                <div>
                  <strong style={{ fontSize: 13, display: 'block', marginBottom: 10 }}>Filter by Requirement {selRequirements.size > 0 && <span style={{ color: 'var(--accent)' }}>({selRequirements.size})</span>}</strong>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 150, overflowY: 'auto' }}>
                    {activeRequirements.map(s => (
                      <label key={s} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer' }}>
                        <input type="checkbox" checked={selRequirements.has(s)} onChange={() => toggleSet(selRequirements, setSelRequirements, s)} style={{ accentColor: 'var(--accent)' }}/> {s}
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {(targetType === 'customers' || targetType === 'both') && (
              <div style={{ padding: 12, border: '1px dashed var(--border)', borderRadius: 8, marginBottom: 20, background: 'var(--bg-soft)' }}>
                <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', color: 'var(--muted)', letterSpacing: 1, marginBottom: 15 }}>Customer Filters</div>
                
                <div className="fg" style={{ marginBottom: 15 }}>
                  <label>Purchased Product {selProducts.size > 0 && <span style={{ color: 'var(--accent)' }}>({selProducts.size})</span>}</label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 120, overflowY: 'auto', background: 'var(--bg)', padding: 10, borderRadius: 6, border: '1px solid var(--border)' }}>
                    {products.length === 0 && <div style={{ fontSize: 11, color: 'var(--muted)' }}>No products found</div>}
                    {products.map(p => (
                      <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer' }}>
                        <input type="checkbox" checked={selProducts.has(p.name)} onChange={() => toggleSet(selProducts, setSelProducts, p.name)} style={{ accentColor: 'var(--accent)' }}/> {p.name}
                      </label>
                    ))}
                  </div>
                </div>

                <div className="fg" style={{ marginBottom: 15 }}>
                  <label>Last Purchase Period</label>
                  <select value={selPeriod} onChange={e => setSelPeriod(e.target.value)}>
                    <option value="">Any Time</option>
                    <option value="30d">Last 30 Days</option>
                    <option value="3m">Last 3 Months</option>
                    <option value="6m">Last 6 Months</option>
                    <option value="1y">Last 1 Year</option>
                    <option value="1-2y">1-2 Years Ago</option>
                    <option value="2y+">2+ Years Ago</option>
                  </select>
                </div>

                <div className="fg" style={{ marginBottom: 15 }}>
                  <label>Invoice Amount Range</label>
                  <div style={{ display: 'flex', gap: 10 }}>
                    <input type="number" placeholder="Min ₹" value={minAmount} onChange={e => setMinAmount(e.target.value)} style={{ width: '100%' }} />
                    <input type="number" placeholder="Max ₹" value={maxAmount} onChange={e => setMaxAmount(e.target.value)} style={{ width: '100%' }} />
                  </div>
                </div>

                <div className="fg" style={{ marginBottom: 15 }}>
                  <label>AMC Status {selAmcStatus.size > 0 && <span style={{ color: 'var(--accent)' }}>({selAmcStatus.size})</span>}</label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, background: 'var(--bg)', padding: 10, borderRadius: 6, border: '1px solid var(--border)' }}>
                    {['Active', 'Expired', 'Cancelled'].map(s => (
                      <label key={s} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer' }}>
                        <input type="checkbox" checked={selAmcStatus.has(s)} onChange={() => toggleSet(selAmcStatus, setSelAmcStatus, s)} style={{ accentColor: 'var(--accent)' }}/> {s}
                      </label>
                    ))}
                  </div>
                </div>

                <div className="fg">
                  <label>Customer State {selStates.size > 0 && <span style={{ color: 'var(--accent)' }}>({selStates.size})</span>}</label>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 120, overflowY: 'auto', background: 'var(--bg)', padding: 10, borderRadius: 6, border: '1px solid var(--border)' }}>
                    {INDIAN_STATES.map(s => (
                      <label key={s} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer' }}>
                        <input type="checkbox" checked={selStates.has(s)} onChange={() => toggleSet(selStates, setSelStates, s)} style={{ accentColor: 'var(--accent)' }}/> {s}
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            )}

            <button className="btn btn-secondary btn-sm" style={{ width: '100%', marginBottom: 20 }} onClick={() => { setSelStages(new Set()); setSelSources(new Set()); setSelRequirements(new Set()); setSelProducts(new Set()); setSelPeriod(''); setMinAmount(''); setMaxAmount(''); setSelAmcStatus(new Set()); setSelStates(new Set()); setExcludedIds(new Set()); setManualAdds(new Set()); }}>Reset Filters</button>

            {/* MANUAL RECIPIENTS PANEL */}
            <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', marginBottom: 20 }}>
              <button 
                className="btn btn-ghost" 
                style={{ width: '100%', borderRadius: 0, borderBottom: showManualAdd ? '1px solid var(--border)' : 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 15px' }}
                onClick={() => setShowManualAdd(!showManualAdd)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span>➕</span>
                  <strong style={{ fontSize: 13 }}>Manually Add Recipients ({manualAdds.size})</strong>
                </div>
                <span>{showManualAdd ? '▲' : '▼'}</span>
              </button>
              
              {showManualAdd && (
                <div style={{ background: 'var(--bg)' }}>
                  <div style={{ padding: 10, borderBottom: '1px solid var(--border)' }}>
                    <input 
                      type="text" 
                      placeholder="Search to add by name, email, phone..." 
                      value={addSearch}
                      onChange={e => setAddSearch(e.target.value)}
                      style={{ padding: '6px 12px', fontSize: 12, width: '100%' }}
                    />
                  </div>
                  {addSearch.trim() && (
                    <div style={{ maxHeight: 200, overflowY: 'auto', padding: 10, background: 'var(--bg-soft)' }}>
                      {allCandidates
                        .filter(r => !manualAdds.has(r.id))
                        .filter(r => r.name.toLowerCase().includes(addSearch.toLowerCase()) || r.email.toLowerCase().includes(addSearch.toLowerCase()) || r.phone.includes(addSearch))
                        .slice(0, 10)
                        .map(r => (
                        <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 6px', borderBottom: '1px solid var(--border-light)', fontSize: 12 }}>
                          <div style={{ flex: 1, overflow: 'hidden' }}>
                           <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                              <strong style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</strong>
                              <span className="badge bg-gray" style={{ fontSize: 9, padding: '2px 6px' }}>{r.type}</span>
                            </div>
                            <div style={{ color: 'var(--muted)', fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {r.email} {r.email && r.phone ? '•' : ''} {r.phone}
                            </div>
                          </div>
                          <button 
                            className="btn btn-primary btn-sm" 
                            style={{ padding: '4px 8px', fontSize: 11 }}
                            onClick={() => {
                              const next = new Set(manualAdds);
                              next.add(r.id);
                              // Auto-remove them from excluded list if they were manually banished earlier
                              const nextExc = new Set(excludedIds);
                              nextExc.delete(r.id);
                              setExcludedIds(nextExc);
                              setManualAdds(next);
                              setAddSearch('');
                            }}
                          >
                            Add
                          </button>
                        </div>
                      ))}
                      {allCandidates.filter(r => !manualAdds.has(r.id) && (r.name.toLowerCase().includes(addSearch.toLowerCase()) || r.email.toLowerCase().includes(addSearch.toLowerCase()) || r.phone.includes(addSearch))).length === 0 && (
                        <div style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'center', padding: 10 }}>No matches found</div>
                      )}
                    </div>
                  )}
                  {manualAdds.size > 0 && (
                    <div style={{ padding: 10 }}>
                      <strong style={{ fontSize: 11, display: 'block', marginBottom: 8, color: 'var(--muted)', textTransform: 'uppercase' }}>Manually Added ({manualAdds.size}):</strong>
                      {allCandidates.filter(r => manualAdds.has(r.id)).map(r => (
                        <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, background: 'var(--bg-soft)', padding: '6px 10px', borderRadius: 6, marginBottom: 4 }}>
                          <span>{r.name} <span style={{ color: 'var(--muted)' }}>({r.type})</span></span>
                          <button className="btn btn-ghost btn-sm" style={{ padding: '2px 6px', color: '#991b1b' }} onClick={() => toggleSet(manualAdds, setManualAdds, r.id)}>Remove</button>
                        </div>
                      ))}
                    </div>
                  )}
                  {manualAdds.size > 0 && (
                    <div style={{ padding: '8px 10px', borderTop: '1px dashed var(--border)', textAlign: 'right' }}>
                      <button className="btn btn-ghost btn-sm" style={{ padding: '2px 8px', fontSize: 11 }} onClick={() => setManualAdds(new Set())}>Clear All</button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* PREVIEW PANEL */}
            <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
              <button 
                className="btn btn-ghost" 
                style={{ width: '100%', borderRadius: 0, borderBottom: showPreview ? '1px solid var(--border)' : 'none', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 15px' }}
                onClick={() => setShowPreview(!showPreview)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span>👁</span>
                  <strong style={{ fontSize: 13 }}>Preview Recipients ({targetAudience.length})</strong>
                </div>
                <span>{showPreview ? '▲' : '▼'}</span>
              </button>
              
              {showPreview && (
                <div style={{ background: 'var(--bg)' }}>
                  <div style={{ padding: 10, borderBottom: '1px solid var(--border)' }}>
                    <input 
                      type="text" 
                      placeholder="Search recipients by name, email..." 
                      value={previewSearch}
                      onChange={e => setPreviewSearch(e.target.value)}
                      style={{ padding: '6px 12px', fontSize: 12, width: '100%' }}
                    />
                  </div>
                  <div style={{ maxHeight: 300, overflowY: 'auto', padding: 10 }}>
                    {targetAudience.length === 0 && <div style={{ fontSize: 12, color: 'var(--muted)', textAlign: 'center', padding: 20 }}>No recipients match filters.</div>}
                    {targetAudience
                      .filter(r => !previewSearch || r.name.toLowerCase().includes(previewSearch.toLowerCase()) || r.email.toLowerCase().includes(previewSearch.toLowerCase()) || r.phone.includes(previewSearch))
                      .map((r, i) => (
                      <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 6px', borderBottom: '1px solid var(--border-light)', fontSize: 12 }}>
                        <span style={{ color: 'var(--muted)', width: 20 }}>{i + 1}.</span>
                        <div style={{ flex: 1, overflow: 'hidden' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                            <strong style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</strong>
                            <span className="badge bg-gray" style={{ fontSize: 9, padding: '2px 6px' }}>{r.type}</span>
                          </div>
                          <div style={{ color: 'var(--muted)', fontSize: 11, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {r.email} {r.email && r.phone ? '•' : ''} {r.phone}
                          </div>
                        </div>
                        <button 
                          className="btn btn-sm" 
                          style={{ background: 'transparent', color: 'var(--muted)', border: 'none', padding: '4px 8px', fontSize: 14 }}
                          onClick={() => toggleSet(excludedIds, setExcludedIds, r.id)}
                          title="Exclude recipient from campaign"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                  {excludedIds.size > 0 && (
                    <div style={{ padding: 10, borderTop: '1px dashed var(--border)', fontSize: 11, color: 'var(--muted)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span>{excludedIds.size} recipient(s) manually excluded.</span>
                      <button className="btn btn-ghost btn-sm" style={{ padding: '2px 8px', fontSize: 11 }} onClick={() => setExcludedIds(new Set())}>Restore All</button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* RIGHT SIDE: Composer */}
          <div className="tw" style={{ padding: 25 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3>2. Compose Email</h3>
            </div>
            
            <div className="fg" style={{ marginTop: 20 }}>
              <label>Campaign Name (Internal)</label>
              <input value={campaignName} onChange={e => setCampaignName(e.target.value)} placeholder="e.g., Diwali Offer 2026" disabled={sending} />
            </div>

            <div className="fg" style={{ marginTop: 20 }}>
              <label>Choose a Template</label>
              <select value={selectedTemplate} onChange={e => loadTemplate(e.target.value)} disabled={sending}>
                <optgroup label="System Presets">
                  {TEMPLATES.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </optgroup>
                {userTemplates.length > 0 && (
                  <optgroup label="My Custom Templates">
                    {userTemplates.map(t => <option key={t.id} value={t.id}>⭐ {t.name}</option>)}
                  </optgroup>
                )}
              </select>
            </div>

            <div className="fg" style={{ marginTop: 20 }}>
              <label style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Email Subject</span>
                <span style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 400 }}>Supports {'{{name}}'}, {'{{email}}'}</span>
              </label>
              <input value={subject} onChange={e => setSubject(e.target.value)} placeholder="Enter subject line..." disabled={sending} />
            </div>

            <div className="fg" style={{ marginTop: 20 }}>
              <label style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Email Body</span>
              </label>
              <textarea 
                value={body} 
                onChange={e => setBody(e.target.value)} 
                placeholder="Write your email content here..."
                style={{ height: 250, resize: 'vertical' }}
                disabled={sending}
              />
            </div>

            {/* Template Actions */}
            <div style={{ marginTop: 15, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', gap: 10 }}>
                {userTemplates.some(t => t.id === selectedTemplate) ? (
                  <>
                    {canEdit && <button className="btn btn-secondary btn-sm" onClick={handleSaveTemplate} disabled={sending}>💾 Update Current Template</button>}
                    {canDelete && <button className="btn btn-sm" style={{ background: '#fee2e2', color: '#991b1b' }} onClick={handleDeleteTemplate} disabled={sending}>🗑 Delete Template</button>}
                  </>
                ) : (
                  canCreate && <button className="btn btn-secondary btn-sm" onClick={handleSaveTemplate} disabled={sending}>💾 Save as New Template</button>
                )}
              </div>
            </div>

            {sending ? (
              <div style={{ marginTop: 30, background: 'var(--bg-soft)', padding: 20, borderRadius: 12, border: '1px solid var(--border)' }}>
                <h4 style={{ margin: 0, marginBottom: 15 }}>Sending Campaign...</h4>
                <div style={{ width: '100%', height: 10, background: 'var(--border)', borderRadius: 10, overflow: 'hidden' }}>
                  <div style={{ width: `${progress}%`, height: '100%', background: 'var(--accent)', transition: 'width 0.3s' }} />
                </div>
                <div style={{ fontSize: 12, textAlign: 'center', marginTop: 10, color: 'var(--muted)', fontWeight: 600 }}>{progress}% Complete - Please do not close this window</div>
              </div>
            ) : (
              <div style={{ marginTop: 30, borderTop: '1px solid var(--border)', paddingTop: 20 }}>
                <div style={{ display: 'flex', gap: 20, marginBottom: 20 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                    <input type="radio" checked={sendMode === 'now'} onChange={() => setSendMode('now')} style={{ accentColor: 'var(--accent)' }} />
                    Send Now
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                    <input type="radio" checked={sendMode === 'schedule'} onChange={() => setSendMode('schedule')} style={{ accentColor: 'var(--accent)' }} />
                    Schedule for Later
                  </label>
                </div>

                {sendMode === 'schedule' && (
                  <div className="fg" style={{ marginBottom: 20 }}>
                    <label>Select Date & Time</label>
                    <input type="datetime-local" value={scheduleTime} onChange={e => setScheduleTime(e.target.value)} />
                  </div>
                )}

                <div style={{ display: 'flex', gap: 15, justifyContent: 'flex-end' }}>
                  {canCreate && (
                    <button className="btn btn-primary" onClick={handleSend}>
                      {sendMode === 'now' ? `🚀 Send Now to ${targetAudience.length} Leads` : '📅 Schedule Campaign'}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'history' && (
        <div className="tw" style={{ marginTop: 20 }}>
          <table style={{ width: '100%' }}>
            <thead>
              <tr>
                <th>Date</th>
                <th>Campaign Name</th>
                <th>Subject</th>
                <th>Audience Size</th>
                <th>Sent</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.length === 0 ? (
                <tr><td colSpan={6} style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>No campaigns sent yet.</td></tr>
              ) : campaigns.map(c => (
                <tr key={c.id}>
                  <td style={{ fontSize: 12 }}>
                    <div>{new Date(c.createdAt).toLocaleString()}</div>
                    {c.scheduledFor && <div style={{ color: 'var(--accent)', fontWeight: 600, marginTop: 4 }}>Scheduled: {new Date(c.scheduledFor).toLocaleString()}</div>}
                  </td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {c.channel === 'whatsapp' ? <span title="WhatsApp">💬</span> : <span title="Email">📧</span>}
                      <strong>{c.name}</strong>
                    </div>
                  </td>
                  <td style={{ fontSize: 12, color: 'var(--muted)', maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.channel === 'whatsapp' ? c.body : c.subject}
                  </td>
                  <td style={{ textAlign: 'center' }}><span className="badge bg-gray">{c.audienceSize}</span></td>
                  <td style={{ textAlign: 'center' }}><span className="badge bg-green">{c.sentCount || 0}</span></td>
                  <td>
                    <span className={`badge ${c.status === 'Completed' ? 'bg-green' : c.status === 'Scheduled' ? 'bg-purple' : 'bg-yellow'}`}>{c.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'templates' && (
        <div className="tw" style={{ padding: 25, marginTop: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <h3>My Custom Templates</h3>
            <button className="btn btn-primary btn-sm" onClick={() => { setTab('compose'); setSelectedTemplate('blank'); setSubject(''); setBody(''); }}>+ Create New</button>
          </div>
          <table style={{ width: '100%' }}>
            <thead>
              <tr>
                <th>Created On</th>
                <th>Template Name</th>
                <th>Subject</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {userTemplates.length === 0 ? (
                <tr><td colSpan={4} style={{ textAlign: 'center', padding: 40, color: 'var(--muted)' }}>No custom templates saved yet.</td></tr>
              ) : userTemplates.map(t => (
                <tr key={t.id}>
                  <td style={{ fontSize: 12 }}>{new Date(t.createdAt).toLocaleString()}</td>
                  <td><strong>⭐ {t.name}</strong></td>
                  <td style={{ fontSize: 12, color: 'var(--muted)', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.subject}</td>
                  <td style={{ textAlign: 'right' }}>
                    <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                      <button className="btn btn-secondary btn-sm" onClick={() => { loadTemplate(t.id); setTab('compose'); }}>Edit / Use</button>
                      <button className="btn btn-sm" style={{ background: '#fee2e2', color: '#991b1b' }} onClick={async () => {
                        if (!canDelete) { toast('Permission denied', 'error'); return; }
                        if (confirm('Delete this template?')) await dbWrite(dbOp.delete('campaignTemplates', t.id));
                      }}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
