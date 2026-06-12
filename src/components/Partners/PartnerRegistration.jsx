import React, { useState, useEffect } from 'react';
import { dbWrite, dbOp } from '../../utils/dbWrite';
import db from '../../instant';
import { id } from '@instantdb/react';

export default function PartnerRegistration({ params }) {
  const cleanSlug = params?.slug ? params.slug.toLowerCase().trim() : '';

  const { data, isLoading } = db.useQuery({
    userProfiles: { $: { where: { slug: cleanSlug } } },
    globalSettings: { $: { where: { slug: cleanSlug } } },
    partnerApplications: {}
  });

  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    role: 'Retailer',
    companyName: '',
    address: '',
    village: '',
    city: '',
    district: '',
    pincode: '',
    state: '',
    taxId: '',
    notes: '',
    customData: {},
    distributorPhone: ''
  });
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  if (isLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', fontFamily: 'sans-serif' }}>
        Loading...
      </div>
    );
  }

  const profile = data?.userProfiles?.[0];
  const settings = data?.globalSettings?.[0] || {};
  const ownerId = profile?.userId || settings?.userId;
  const config = profile?.partnerFormConfig || { reqCompany: 'Optional', reqAddress: 'Optional', reqTax: 'Optional', reqNotes: 'Optional' };

  // Dynamic role aliases
  const dAlias = profile?.distributorAlias || 'Distributor';
  const rAlias = profile?.retailerAlias || 'Retailer';

  // Resolve distributor by phone
  const allApps = (data?.partnerApplications || []).filter(a => a.userId === ownerId && a.status === 'Approved');
  const resolvedDistributor = form.distributorPhone.replace(/\D/g, '').length >= 10
    ? allApps.find(a => a.role === 'Distributor' && a.phone?.replace(/\D/g, '').endsWith(form.distributorPhone.replace(/\D/g, '').slice(-10)))
    : null;

  if (!ownerId && cleanSlug) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', fontFamily: 'sans-serif', color: '#6b7280' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 64, marginBottom: 16 }}>🏢</div>
          <h2>Business not found</h2>
          <p>The registration link might be incorrect.</p>
        </div>
      </div>
    );
  }

  const bizLogo = profile?.logo || settings?.brandLogo;
  const bizTitle = profile?.bizName || settings?.brandName || 'Channel Partner Registration';
  const bizTagline = profile?.tagline || 'Join our distribution network';
  const accentColor = '#2563eb'; // Blue-ish for partner

  const submit = async (e) => {
    e.preventDefault();
    if (!form.name || !form.email || !form.phone) {
      setErrorMsg('Name, email, and phone are required.');
      return;
    }
    
    setSubmitting(true);
    setErrorMsg('');
    
    try {
      // Create a partnerApplication record
      const applicationId = id();
      const payload = {
        ...form,
        email: form.email.trim().toLowerCase(),
        userId: ownerId,
        status: 'Pending',
        appliedAt: Date.now(),
        ...(form.role === 'Retailer' && resolvedDistributor ? { parentDistributorId: resolvedDistributor.id } : {})
      };
      delete payload.distributorPhone;
      
      await dbWrite(dbOp.update('partnerApplications', applicationId, payload));
      
      // Also add a notification for the admin
      await dbWrite(dbOp.update('notifications', id(), {
        userId: ownerId,
        title: 'New Partner Application',
        body: `${form.name} applied to be a ${form.role}.`,
        link: '/distributors',
        read: false,
        createdAt: Date.now()
      }));

      setDone(true);
    } catch (err) {
      setErrorMsg('Failed to submit application. Please try again later.');
      console.error(err);
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <div style={{ minHeight: '100vh', background: '#f8fafc', fontFamily: 'Inter, system-ui, sans-serif' }}>
        <div style={{ maxWidth: 480, margin: '80px auto', textAlign: 'center', padding: '40px', background: '#fff', borderRadius: 16, boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)' }}>
          <div style={{ fontSize: 72, marginBottom: 16 }}>🤝</div>
          <h2 style={{ color: '#166534', marginBottom: 12 }}>Application Submitted!</h2>
          <p style={{ color: '#475569', lineHeight: 1.6 }}>
            Thank you for applying to be a {form.role} for <strong>{bizTitle}</strong>. 
            We will review your application and get back to you shortly at {form.email}.
          </p>
          <div style={{ marginTop: 30 }}>
            <a href="/" style={{ color: accentColor, textDecoration: 'none', fontWeight: 600 }}>← Return to Homepage</a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc', fontFamily: 'Inter, system-ui, sans-serif' }}>
      {/* Header */}
      <div style={{ background: accentColor, color: '#fff', padding: '30px 24px', textAlign: 'center' }}>
        {bizLogo && <img src={bizLogo} alt="Logo" style={{ height: 50, marginBottom: 12, display: 'block', margin: '0 auto 12px', borderRadius: 8 }} />}
        <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800 }}>{bizTitle}</h1>
        {bizTagline && <p style={{ margin: '8px 0 0', opacity: 0.9, fontSize: 15 }}>{bizTagline}</p>}
      </div>

      <div style={{ maxWidth: 560, margin: '-20px auto 40px', padding: '0 16px', position: 'relative', zIndex: 10 }}>
        <div style={{ background: '#fff', borderRadius: 16, padding: '32px', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)' }}>
          <h2 style={{ fontSize: 20, marginBottom: 6, color: '#0f172a' }}>Register as a Partner</h2>
          <p style={{ color: '#64748b', fontSize: 14, marginBottom: 24 }}>Fill out the details below to join our network.</p>
          
          {errorMsg && (
            <div style={{ background: '#fef2f2', color: '#991b1b', padding: '12px 16px', borderRadius: 8, fontSize: 14, marginBottom: 20, border: '1px solid #fecaca' }}>
              {errorMsg}
            </div>
          )}

          <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            
            <div style={{ display: 'flex', gap: 16 }}>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', fontWeight: 600, fontSize: 13, color: '#334155', marginBottom: 6 }}>I want to become a *</label>
                <select 
                  value={form.role} 
                  onChange={e => setForm(p => ({ ...p, role: e.target.value }))}
                  style={{ width: '100%', padding: '10px 12px', border: '1.5px solid #cbd5e1', borderRadius: 8, fontSize: 14, background: '#fff', cursor: 'pointer' }}
                >
                  <option value="Distributor">{dAlias}</option>
                  <option value="Retailer">{rAlias}</option>
                </select>
              </div>
            </div>

            <div>
              <label style={{ display: 'block', fontWeight: 600, fontSize: 13, color: '#334155', marginBottom: 6 }}>Full Name *</label>
              <input 
                value={form.name} 
                onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                placeholder="John Doe" 
                style={{ width: '100%', padding: '10px 12px', border: '1.5px solid #cbd5e1', borderRadius: 8, fontSize: 14, boxSizing: 'border-box' }}
                required 
              />
            </div>
            
            <div style={{ display: 'flex', gap: 16 }}>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', fontWeight: 600, fontSize: 13, color: '#334155', marginBottom: 6 }}>Email Address *</label>
                <input 
                  type="email" 
                  value={form.email} 
                  onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
                  placeholder="john@example.com" 
                  style={{ width: '100%', padding: '10px 12px', border: '1.5px solid #cbd5e1', borderRadius: 8, fontSize: 14, boxSizing: 'border-box' }}
                  required 
                />
              </div>
              <div style={{ flex: 1 }}>
                <label style={{ display: 'block', fontWeight: 600, fontSize: 13, color: '#334155', marginBottom: 6 }}>Phone Number *</label>
                <input 
                  type="tel" 
                  value={form.phone} 
                  onChange={e => setForm(p => ({ ...p, phone: e.target.value }))}
                  placeholder="+91 98765 43210" 
                  style={{ width: '100%', padding: '10px 12px', border: '1.5px solid #cbd5e1', borderRadius: 8, fontSize: 14, boxSizing: 'border-box' }}
                  required 
                />
              </div>
            </div>

            {form.role === 'Retailer' && (
              <div>
                <label style={{ display: 'block', fontWeight: 600, fontSize: 13, color: '#334155', marginBottom: 6 }}>Your {dAlias}'s Mobile Number</label>
                <input 
                  type="tel" 
                  value={form.distributorPhone} 
                  onChange={e => setForm(p => ({ ...p, distributorPhone: e.target.value }))}
                  placeholder={`Enter your ${dAlias.toLowerCase()}'s phone number`}
                  style={{ width: '100%', padding: '10px 12px', border: `1.5px solid ${resolvedDistributor ? '#22c55e' : '#cbd5e1'}`, borderRadius: 8, fontSize: 14, boxSizing: 'border-box', background: resolvedDistributor ? '#f0fdf4' : '#fff' }}
                />
                {resolvedDistributor ? (
                  <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6, color: '#16a34a', fontSize: 13, fontWeight: 600 }}>
                    <span>✓</span> {dAlias}: {resolvedDistributor.companyName || resolvedDistributor.name}
                  </div>
                ) : form.distributorPhone.replace(/\D/g, '').length >= 10 ? (
                  <div style={{ marginTop: 6, color: '#dc2626', fontSize: 12 }}>No matching {dAlias.toLowerCase()} found for this number.</div>
                ) : form.distributorPhone ? (
                  <div style={{ marginTop: 6, color: '#94a3b8', fontSize: 12 }}>Enter full 10-digit mobile number to auto-resolve.</div>
                ) : null}
              </div>
            )}

            {config.reqCompany !== 'Hidden' && (
              <div>
                <label style={{ display: 'block', fontWeight: 600, fontSize: 13, color: '#334155', marginBottom: 6 }}>Business / Company Name {config.reqCompany === 'Required' && '*'}</label>
                <input 
                  value={form.companyName} 
                  onChange={e => setForm(p => ({ ...p, companyName: e.target.value }))}
                  placeholder="Doe Enterprises" 
                  style={{ width: '100%', padding: '10px 12px', border: '1.5px solid #cbd5e1', borderRadius: 8, fontSize: 14, boxSizing: 'border-box' }}
                  required={config.reqCompany === 'Required'}
                />
              </div>
            )}

            {config.reqAddress !== 'Hidden' && (
              <>
                <div>
                  <label style={{ display: 'block', fontWeight: 600, fontSize: 13, color: '#334155', marginBottom: 6 }}>Business Address {config.reqAddress === 'Required' && '*'}</label>
                  <textarea 
                    value={form.address} 
                    onChange={e => setForm(p => ({ ...p, address: e.target.value }))}
                    placeholder="Full operational address..." 
                    style={{ width: '100%', padding: '10px 12px', border: '1.5px solid #cbd5e1', borderRadius: 8, fontSize: 14, boxSizing: 'border-box', minHeight: 70, resize: 'vertical' }}
                    required={config.reqAddress === 'Required'}
                  />
                </div>
                <div style={{ display: 'flex', gap: 16 }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ display: 'block', fontWeight: 600, fontSize: 13, color: '#334155', marginBottom: 6 }}>Village / Area</label>
                    <input 
                      value={form.village} 
                      onChange={e => setForm(p => ({ ...p, village: e.target.value }))}
                      placeholder="Village or Local Area" 
                      style={{ width: '100%', padding: '10px 12px', border: '1.5px solid #cbd5e1', borderRadius: 8, fontSize: 14, boxSizing: 'border-box' }}
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={{ display: 'block', fontWeight: 600, fontSize: 13, color: '#334155', marginBottom: 6 }}>City / Town</label>
                    <input 
                      value={form.city} 
                      onChange={e => setForm(p => ({ ...p, city: e.target.value }))}
                      placeholder="City Name" 
                      style={{ width: '100%', padding: '10px 12px', border: '1.5px solid #cbd5e1', borderRadius: 8, fontSize: 14, boxSizing: 'border-box' }}
                    />
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 16 }}>
                  <div style={{ flex: 1 }}>
                    <label style={{ display: 'block', fontWeight: 600, fontSize: 13, color: '#334155', marginBottom: 6 }}>District</label>
                    <input 
                      value={form.district} 
                      onChange={e => setForm(p => ({ ...p, district: e.target.value }))}
                      placeholder="District" 
                      style={{ width: '100%', padding: '10px 12px', border: '1.5px solid #cbd5e1', borderRadius: 8, fontSize: 14, boxSizing: 'border-box' }}
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label style={{ display: 'block', fontWeight: 600, fontSize: 13, color: '#334155', marginBottom: 6 }}>Pincode</label>
                    <input 
                      value={form.pincode} 
                      onChange={e => setForm(p => ({ ...p, pincode: e.target.value }))}
                      placeholder="e.g. 560001" 
                      style={{ width: '100%', padding: '10px 12px', border: '1.5px solid #cbd5e1', borderRadius: 8, fontSize: 14, boxSizing: 'border-box' }}
                    />
                  </div>
                </div>
                <div>
                  <label style={{ display: 'block', fontWeight: 600, fontSize: 13, color: '#334155', marginBottom: 6 }}>State</label>
                  <input 
                    value={form.state} 
                    onChange={e => setForm(p => ({ ...p, state: e.target.value }))}
                    placeholder="State" 
                    style={{ width: '100%', padding: '10px 12px', border: '1.5px solid #cbd5e1', borderRadius: 8, fontSize: 14, boxSizing: 'border-box' }}
                  />
                </div>
              </>
            )}

            {config.reqTax !== 'Hidden' && (
              <div>
                <label style={{ display: 'block', fontWeight: 600, fontSize: 13, color: '#334155', marginBottom: 6 }}>Tax ID (GSTIN / VAT) {config.reqTax === 'Required' && '*'}</label>
                <input 
                  value={form.taxId} 
                  onChange={e => setForm(p => ({ ...p, taxId: e.target.value }))}
                  placeholder="e.g. 29ABCDE1234F2Z5" 
                  style={{ width: '100%', padding: '10px 12px', border: '1.5px solid #cbd5e1', borderRadius: 8, fontSize: 14, boxSizing: 'border-box' }}
                  required={config.reqTax === 'Required'}
                />
              </div>
            )}

            {config.reqNotes !== 'Hidden' && (
              <div>
                <label style={{ display: 'block', fontWeight: 600, fontSize: 13, color: '#334155', marginBottom: 6 }}>Other details or questions {config.reqNotes === 'Required' && '*'}</label>
                <textarea 
                  value={form.notes} 
                  onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
                  placeholder="Optional notes..." 
                  style={{ width: '100%', padding: '10px 12px', border: '1.5px solid #cbd5e1', borderRadius: 8, fontSize: 14, boxSizing: 'border-box', minHeight: 60, resize: 'vertical' }}
                  required={config.reqNotes === 'Required'}
                />
              </div>
            )}

            {config.customFields && config.customFields.length > 0 && (
              <div style={{ marginTop: 8, marginBottom: 8 }}>
                <div style={{ height: 1, background: '#e2e8f0', marginBottom: 16 }}></div>
                {config.customFields.map(cf => (
                  <div key={cf.id} style={{ marginBottom: 16 }}>
                    <label style={{ display: 'block', fontWeight: 600, fontSize: 13, color: '#334155', marginBottom: 6 }}>
                      {cf.label} {cf.required && '*'}
                    </label>
                    <input 
                      type={cf.type === 'Number' ? 'number' : cf.type === 'Date' ? 'date' : 'text'}
                      value={form.customData?.[cf.id] || ''} 
                      onChange={e => setForm(p => ({ ...p, customData: { ...p.customData, [cf.id]: e.target.value } }))}
                      placeholder={`Enter ${cf.label.toLowerCase()}...`}
                      style={{ width: '100%', padding: '10px 12px', border: '1.5px solid #cbd5e1', borderRadius: 8, fontSize: 14, boxSizing: 'border-box' }}
                      required={cf.required}
                    />
                  </div>
                ))}
              </div>
            )}

            <button 
              type="submit" 
              disabled={submitting}
              style={{
                marginTop: 10,
                padding: '12px', 
                background: accentColor, 
                color: '#fff', 
                border: 'none', 
                borderRadius: 8, 
                fontSize: 15, 
                fontWeight: 600, 
                cursor: submitting ? 'not-allowed' : 'pointer',
                opacity: submitting ? 0.7 : 1
              }}
            >
              {submitting ? 'Submitting Application...' : 'Submit Application'}
            </button>
            <div style={{ textAlign: 'center', marginTop: 10 }}>
              <a href="/login" style={{ fontSize: 13, color: '#64748b', textDecoration: 'none' }}>Already a partner? Sign In here</a>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
