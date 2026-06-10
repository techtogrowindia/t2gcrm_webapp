import React, { useState, useEffect, useMemo } from 'react';
import { init } from '@instantdb/react';
import { fireAutoNotifications } from '../../utils/messaging';

const APP_ID = import.meta.env.VITE_INSTANT_APP_ID;
const db = init({ appId: APP_ID });

function generateSlots(startTime, endTime, durationMins) {
  const slots = [];
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);
  let current = sh * 60 + sm;
  const end = eh * 60 + em;
  while (current + durationMins <= end) {
    const h = Math.floor(current / 60).toString().padStart(2, '0');
    const m = (current % 60).toString().padStart(2, '0');
    slots.push(`${h}:${m}`);
    current += durationMins;
  }
  return slots;
}

export default function BookingPage() {
  const pathParts = window.location.pathname.split('/').filter(Boolean);
  // Handle both /book/[slug] and /[slug]/book
  const isDedicatedBook = pathParts[0] === 'book';
  const rawSlug = isDedicatedBook ? (pathParts[1] || '') : (pathParts[0] || '');
  const cleanSlug = rawSlug.toLowerCase().trim();

  // --- 1. Top-Level Hooks ---
  const { data, isLoading } = db.useQuery({
    userProfiles: { $: { where: { slug: cleanSlug } } },
    appointmentSettings: { $: { where: { slug: cleanSlug } } },
    appointments: { $: { where: { slug: cleanSlug } } },
  });

  const [step, setStep] = useState(1); // 1: service, 2: date, 3: time, 4: details, 5: confirm
  const [selectedService, setSelectedService] = useState('');
  const [selectedDate, setSelectedDate] = useState('');
  const [selectedTime, setSelectedTime] = useState('');
  const [form, setForm] = useState({ name: '', email: '', phone: '', notes: '' });
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  // --- 2. Derived Data (safe to calculate unconditionally) ---
  const profile = data?.userProfiles?.[0];
  const apptSettings = data?.appointmentSettings?.[0] || {};
  const ownerId = profile?.userId || apptSettings?.userId;

  const workingHours = apptSettings?.workingHours ? JSON.parse(apptSettings.workingHours) : {};
  const holidays = apptSettings?.holidays ? JSON.parse(apptSettings.holidays) : [];
  const slotDuration = apptSettings?.slotDuration || 30;
  const maxPerSlot = apptSettings?.maxPerSlot || 1;
  const bookingWindow = apptSettings?.bookingWindow || 1;
  const services = apptSettings?.services ? JSON.parse(apptSettings.services) : [{ name: 'General Appointment', duration: '' }];

  const selectedServiceObj = useMemo(() => {
    return services.find(s => (typeof s === 'string' ? s : s.name) === selectedService) || {};
  }, [services, selectedService]);

  const currentDuration = (typeof selectedServiceObj === 'object' && selectedServiceObj.duration) 
    ? Number(selectedServiceObj.duration) 
    : slotDuration;

  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  const availableSlots = useMemo(() => {
    if (!selectedDate || !workingHours) return [];
    const d = new Date(selectedDate);
    const dayName = dayNames[d.getDay()];
    const hours = workingHours[dayName];
    if (!hours?.enabled || (!hours.slots && !hours.start)) return [];
    
    let all = [];
    if (hours.slots) {
      hours.slots.forEach(slot => {
        all = [...all, ...generateSlots(slot.start, slot.end, currentDuration)];
      });
    } else {
      all = generateSlots(hours.start, hours.end, currentDuration);
    }

    const taken = (data?.appointments || []).filter(a => a.userId === ownerId && a.date === selectedDate && !['Cancelled', 'No Show'].includes(a.status));
    return all.filter(slot => {
      const count = taken.filter(a => a.time === slot).length;
      return count < maxPerSlot;
    });
  }, [selectedDate, workingHours, currentDuration, maxPerSlot, data?.appointments, ownerId]);

  // --- 3. Early Returns (Rules of Hooks safe) ---
  if (isLoading) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', fontFamily: "'DM Sans', sans-serif" }}>Loading...</div>;
  
  if (!ownerId) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', fontFamily: "'DM Sans', sans-serif", color: '#6b7f74' }}>
      <div style={{ textAlign: 'center' }}><div style={{ fontSize: 64, marginBottom: 16 }}>📅</div><h2>Booking page not found</h2><p>The link might be incorrect or the business has moved.</p></div>
    </div>
  );

  // --- 4. Main Render Data ---
  const bizTitle = profile?.bizName || apptSettings?.title || 'Book an Appointment';
  const bizLogo = profile?.logo || apptSettings?.logo;
  const bizTagline = profile?.tagline || apptSettings?.tagline || '';

  const isDateAvailable = (dateStr) => {
    if (holidays.includes(dateStr)) return false;
    const d = new Date(dateStr);
    const dayName = dayNames[d.getDay()];
    const hours = workingHours[dayName];
    return hours?.enabled !== false;
  };

  const submit = async () => {
    if (!form.name || !form.phone) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/appointments/book', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ownerId,
          slug: cleanSlug,
          service: selectedService,
          date: selectedDate,
          time: selectedTime,
          customer: form,
        }),
      });
      const result = await res.json();
      if (result.success) {
        setDone(true);
        // Fire WhatsApp auto-notification for appointment booked
        if (profile) {
          fireAutoNotifications('appointment_booked', {
            // Provide multiple aliases so the CRM template body can use any
            // variable name that matches the Waprochat template definition.
            client: form.name,
            phone: form.phone,
            email: form.email || '',
            apptDate: selectedDate,
            apptTime: selectedTime,
            service: selectedService,
            date: selectedDate,
            bizName: profile?.bizName || '',
            ownerPhone: profile?.phone || '',
            entityId: `${form.phone}-${selectedDate}-${selectedTime}`,
          }, profile, ownerId).catch(() => {});
        }
      }
      else alert(result.error || 'Booking failed');
    } catch (err) {
      alert('Error: ' + err.message);
    } finally {
      setSubmitting(false);
    }
  };

  // Generate days for date picker based on bookingWindow
  const today = new Date();
  const daysInWindow = bookingWindow * 30 + 5; // roughly 30 days per month
  const dateOptions = Array.from({ length: daysInWindow }, (_, i) => {
    const d = new Date(today.getTime() + (i + 1) * 86400000);
    return d.toISOString().split('T')[0];
  }).filter(isDateAvailable);



  const accentColor = apptSettings?.primaryColor || '#22c55e';

  return (
    <div style={{ minHeight: '100vh', background: '#f0f4f1', fontFamily: "'DM Sans', sans-serif", color: '#1a2e24' }}>
      {/* Header */}
      <div style={{ background: accentColor, color: '#fff', padding: '20px 24px', textAlign: 'center' }}>
        {bizLogo && <img src={bizLogo} alt="Logo" style={{ height: 48, marginBottom: 8, display: 'block', margin: '0 auto 8px', borderRadius: 10 }} />}
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700 }}>{bizTitle}</h1>
        {bizTagline && <p style={{ margin: '6px 0 0', opacity: 0.85, fontSize: 14 }}>{bizTagline}</p>}
      </div>

      {done ? (
        <div style={{ maxWidth: 480, margin: '48px auto', textAlign: 'center', padding: 24 }}>
          <div style={{ fontSize: 72, marginBottom: 16 }}>✅</div>
          <h2 style={{ color: '#166534', fontWeight: 700 }}>Booking Confirmed!</h2>
          <div style={{ background: '#fff', padding: 20, borderRadius: 12, margin: '16px 0', textAlign: 'left', border: '1px solid #e2e8e4' }}>
            <div style={{ padding: '8px 0', borderBottom: '1px solid #f0f4f1', fontSize: 14 }}><strong>Name:</strong> {form.name}</div>
            <div style={{ padding: '8px 0', borderBottom: '1px solid #f0f4f1', fontSize: 14 }}><strong>Service:</strong> {selectedService}</div>
            <div style={{ padding: '8px 0', borderBottom: '1px solid #f0f4f1', fontSize: 14 }}><strong>Date:</strong> {selectedDate}</div>
            <div style={{ padding: '8px 0', borderBottom: '1px solid #f0f4f1', fontSize: 14 }}><strong>Time:</strong> {selectedTime}</div>
            <div style={{ padding: '8px 0', fontSize: 14 }}><strong>Phone:</strong> {form.phone}</div>
          </div>
          <p style={{ color: '#6b7f74', fontSize: 13 }}>We'll send a confirmation to {form.email || form.phone}. See you soon!</p>
          <button onClick={() => window.location.reload()} style={{ padding: '10px 24px', background: accentColor, color: '#fff', border: 'none', borderRadius: 9, cursor: 'pointer', fontWeight: 600, fontFamily: 'inherit', fontSize: 13 }}>
            Book Another Appointment
          </button>
        </div>
      ) : (
        <div style={{ maxWidth: 560, margin: '32px auto', padding: '0 16px' }}>
          {/* Progress Steps */}
          <div style={{ display: 'flex', justifyContent: 'center', gap: 0, marginBottom: 28 }}>
            {['Service', 'Date', 'Time', 'Details'].map((label, i) => (
              <div key={label} style={{ display: 'flex', alignItems: 'center' }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                  <div style={{ width: 32, height: 32, borderRadius: '50%', background: step > i + 1 ? '#16a34a' : step === i + 1 ? accentColor : '#e2e8e4', color: step >= i + 1 ? '#fff' : '#6b7f74', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 13 }}>
                    {step > i + 1 ? '✓' : i + 1}
                  </div>
                  <span style={{ fontSize: 10, color: step === i + 1 ? accentColor : '#6b7f74', fontWeight: step === i + 1 ? 700 : 400 }}>{label}</span>
                </div>
                {i < 3 && <div style={{ width: 60, height: 2, background: step > i + 1 ? '#16a34a' : '#e2e8e4', margin: '0 4px', marginBottom: 20 }} />}
              </div>
            ))}
          </div>

          <div style={{ background: '#fff', borderRadius: 12, padding: 28, border: '1px solid #e2e8e4' }}>
            {/* Step 1: Service */}
            {step === 1 && (
              <div>
                <h3 style={{ marginBottom: 20, fontSize: 18, fontWeight: 700 }}>Select a Service</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {services.map((svc, si) => {
                    const sName = typeof svc === 'object' ? svc.name : svc;
                    if (!sName || !sName.trim()) return null;
                    const sDur = typeof svc === 'object' ? svc.duration : '';
                    const durationText = sDur ? `${sDur} mins` : (slotDuration ? `${slotDuration} mins` : '');
                    return (
                      <button key={si} onClick={() => { setSelectedService(sName); setStep(2); }} className="booking-svc"
                        style={{ padding: '14px 18px', borderRadius: 9, border: `1.5px solid ${selectedService === sName ? accentColor : '#e2e8e4'}`, background: selectedService === sName ? `${accentColor}0a` : '#fff', cursor: 'pointer', fontWeight: 600, fontSize: 14, textAlign: 'left', color: '#1a2e24', transition: 'all .15s', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontFamily: 'inherit' }}>
                        <span>📋 {sName}</span>
                        {durationText && <span style={{ fontSize: 12, color: '#6b7f74', fontWeight: 500 }}>{durationText}</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Step 2: Date */}
            {step === 2 && (
              <div>
                <h3 style={{ marginBottom: 4, fontSize: 18 }}>Select a Date</h3>
                <p style={{ color: '#6b7f74', fontSize: 13, marginBottom: 20 }}>Service: <strong>{selectedService}</strong></p>
                {dateOptions.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: 32, color: '#6b7f74' }}>No available dates in the next 30 days.</div>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
                    {dateOptions.map(dt => {
                      const d = new Date(dt);
                      const label = d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
                      return (
                        <button key={dt} onClick={() => { setSelectedDate(dt); setStep(3); }}
                          style={{ padding: '10px 6px', border: `1.5px solid ${selectedDate === dt ? accentColor : '#e2e8e4'}`, background: selectedDate === dt ? `${accentColor}14` : '#fff', borderRadius: 9, cursor: 'pointer', fontSize: 11, fontWeight: 600, color: '#1a2e24', textAlign: 'center', fontFamily: 'inherit', transition: '.15s' }}>
                          {label}
                        </button>
                      );
                    })}
                  </div>
                )}
                <button onClick={() => setStep(1)} style={{ marginTop: 20, background: 'none', border: 'none', color: accentColor, cursor: 'pointer', fontWeight: 600, fontFamily: 'inherit', fontSize: 13 }}>← Back</button>
              </div>
            )}

            {/* Step 3: Time */}
            {step === 3 && (
              <div>
                <h3 style={{ marginBottom: 4, fontSize: 18 }}>Select a Time</h3>
                <p style={{ color: '#6b7f74', fontSize: 13, marginBottom: 20 }}>{selectedDate} — {selectedService}</p>
                {availableSlots.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: 32, color: '#6b7f74' }}>No available slots for this date.</div>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
                    {availableSlots.map(slot => (
                      <button key={slot} onClick={() => { setSelectedTime(slot); setStep(4); }}
                        style={{ padding: '10px 6px', border: `1.5px solid ${selectedTime === slot ? accentColor : '#e2e8e4'}`, background: selectedTime === slot ? `${accentColor}14` : '#fff', borderRadius: 9, cursor: 'pointer', fontWeight: 700, fontSize: 13, color: '#1a2e24', fontFamily: 'inherit', transition: '.15s' }}>
                        {slot}
                      </button>
                    ))}
                  </div>
                )}
                <button onClick={() => setStep(2)} style={{ marginTop: 20, background: 'none', border: 'none', color: accentColor, cursor: 'pointer', fontWeight: 600, fontFamily: 'inherit', fontSize: 13 }}>← Back</button>
              </div>
            )}

            {/* Step 4: Details */}
            {step === 4 && (
              <div>
                <h3 style={{ marginBottom: 4, fontSize: 18 }}>Your Details</h3>
                <p style={{ color: '#6b7f74', fontSize: 13, marginBottom: 20 }}>{selectedDate} at {selectedTime} — {selectedService}</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {[['name', 'Full Name *', 'text'], ['phone', 'Phone Number *', 'tel'], ['email', 'Email (optional)', 'text'], ['notes', 'Notes / Special Requests', 'text']].map(([key, label, type]) => (
                    <div key={key}>
                      <label style={{ display: 'block', fontWeight: 600, fontSize: 12, marginBottom: 5, color: '#6b7f74' }}>{label}</label>
                      {key === 'notes' ? (
                        <textarea value={form[key]} onChange={e => setForm(p => ({ ...p, [key]: e.target.value }))} style={{ width: '100%', padding: '10px 12px', border: '1.5px solid #e2e8e4', borderRadius: 9, fontSize: 13, resize: 'none', height: 72, boxSizing: 'border-box', fontFamily: 'inherit', outline: 'none' }} />
                      ) : (
                        <input type={type} value={form[key]} onChange={e => setForm(p => ({ ...p, [key]: e.target.value }))} style={{ width: '100%', padding: '10px 12px', border: '1.5px solid #e2e8e4', borderRadius: 9, fontSize: 13, boxSizing: 'border-box', fontFamily: 'inherit', outline: 'none' }} />
                      )}
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: 20, display: 'flex', gap: 10 }}>
                  <button onClick={() => setStep(3)} style={{ padding: '10px 18px', background: '#f0f4f1', border: '1.5px solid #e2e8e4', borderRadius: 9, cursor: 'pointer', fontWeight: 600, fontFamily: 'inherit', fontSize: 13, color: '#1a2e24' }}>← Back</button>
                  <button onClick={submit} disabled={submitting || !form.name || !form.phone}
                    style={{ flex: 1, padding: '12px', background: accentColor, color: '#fff', border: 'none', borderRadius: 9, cursor: 'pointer', fontWeight: 600, fontSize: 14, opacity: (!form.name || !form.phone) ? 0.7 : 1, fontFamily: 'inherit' }}>
                    {submitting ? 'Booking...' : '📅 Confirm Booking'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
