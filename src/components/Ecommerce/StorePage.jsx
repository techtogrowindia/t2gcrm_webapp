import React, { useState, useEffect, useMemo } from 'react';
import { init } from '@instantdb/react';
import { fireAutoNotifications } from '../../utils/messaging';

const APP_ID = import.meta.env.VITE_INSTANT_APP_ID;
const db = init({ appId: APP_ID });

/* ─────────── RESPONSIVE CSS ─────────── */
const RESPONSIVE_CSS = `
  .hide-scroll::-webkit-scrollbar { display: none !important; }
  .hide-scroll { -ms-overflow-style: none !important; scrollbar-width: none !important; }
  @media (max-width: 768px) {
    .banner { height: 160px !important; }
    .banner h1 { font-size: 24px !important; }
    .mobile-hide { display: none !important; }
    .mobile-only { display: block !important; }
    .store-container { padding: 8px !important; }
    .row-image { width: 55px !important; height: 55px !important; }
    .row-item { padding: 12px !important; gap: 12px !important; }
  }
  .mobile-only { display: none !important; }
`;

/* ─────────── SHARED COMPONENTS ─────────── */
function ProductItem({ p, inCart, t, isDark, addToCart, removeFromCart, primary, secondary }) {
  const [isExp, setIsExp] = useState(false);
  const isList = t === 4;
  const isCatalog = t === 5;
  
  const textColor = isDark ? (isList || isCatalog ? '#1e293b' : '#f1f5f9') : '#1e293b';
  const cardBg = isDark ? (isList || isCatalog ? '#fff' : '#1e293b') : '#fff';
  const borderColor = isDark ? '#334155' : '#e5e7eb';
  const rateStr = (p.rate || 0).toLocaleString();

  // --- TEMPLATE 5: COMPACT CATALOG (High Density, Text only) ---
  if (isCatalog) {
    return (
      <div key={p.id} style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: `1px solid ${isDark ? '#334155' : '#f1f5f9'}`, gap: 16, background: '#fff' }}>
         <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 800, fontSize: 15, color: '#1e293b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 1 }}>
               {p.category && <span style={{ fontSize: 10, fontWeight: 900, color: primary, textTransform: 'uppercase', letterSpacing: 0.5 }}>{p.category}</span>}
               {p.desc && <div style={{ fontSize: 11, color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>• {p.desc}</div>}
            </div>
         </div>
         <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 16, flexShrink: 0 }}>
            <div style={{ fontWeight: 800, fontSize: 16, color: '#1e293b' }}>₹{rateStr}</div>
            <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
               {inCart ? (
                 <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6, background: '#f8fafc', padding: 2, borderRadius: 8, border: '1px solid #e2e8f0' }}>
                    <button onClick={() => removeFromCart(p.id)} style={{ width: 28, height: 28, borderRadius: 6, border: '1px solid #ddd', background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>-</button>
                    <span style={{ minWidth: 20, textAlign: 'center', fontWeight: 900, fontSize: 14 }}>{inCart.qty}</span>
                    <button onClick={() => addToCart(p)} style={{ width: 28, height: 28, borderRadius: 6, border: 'none', background: primary, color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>+</button>
                 </div>
               ) : (
                 <button onClick={() => addToCart(p)} style={{ background: primary, color: '#fff', border: 'none', padding: '8px 16px', borderRadius: 8, fontWeight: 900, fontSize: 12, cursor: 'pointer' }}>ADD</button>
               )}
            </div>
         </div>
      </div>
    );
  }

  // --- TEMPLATE 4: EFFICIENT LIST (Enhanced Row Layout) ---
  if (isList) {
    return (
      <div key={p.id} className="row-item" style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 16, padding: 18, borderBottom: `1px solid ${isDark ? '#334155' : '#f1f5f9'}`, background: '#fff' }}>
         <div className="row-image" style={{ width: 75, height: 75, borderRadius: 12, overflow: 'hidden', flexShrink: 0, border: '1px solid #f1f5f9' }}>
            {p.imageUrl ? <img src={p.imageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <div style={{ height: '100%', background: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24 }}>🛍️</div>}
         </div>
         <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
               <div style={{ fontWeight: 800, fontSize: 16, color: primary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</div>
               
               {p.desc && (
                <div style={{ marginTop: 2 }}>
                  <div style={{ fontSize: 12, color: '#64748b', display: isExp ? 'block' : '-webkit-box', WebkitLineClamp: isExp ? 'unset' : 1, WebkitBoxOrient: 'vertical', overflow: isExp ? 'visible' : 'hidden', lineHeight: '1.4' }}>
                    {p.desc}
                  </div>
                  {p.desc.length > 40 && (
                    <div onClick={() => setIsExp(!isExp)} style={{ fontSize: 10, fontWeight: 900, color: primary, cursor: 'pointer', marginTop: 4, textTransform: 'uppercase', display: 'inline-block' }}>
                      {isExp ? 'Less ↑' : 'More ↓'}
                    </div>
                  )}
                </div>
               )}
               
               <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                  {p.category && <span style={{ fontSize: 10, fontWeight: 900, color: '#1e293b', textTransform: 'uppercase', letterSpacing: 0.5, background: '#f1f5f9', padding: '2px 6px', borderRadius: 4 }}>{p.category}</span>}
               </div>
               <div className="mobile-only" style={{ fontWeight: 900, fontSize: 16, marginTop: 4, color: '#1e293b' }}>₹{rateStr}</div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 16, flexShrink: 0 }}>
               <div className="mobile-hide" style={{ fontWeight: 900, fontSize: 18, color: '#1e293b' }}>₹{rateStr}</div>
               <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  {inCart ? (
                     <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 6, background: '#f8fafc', padding: '2px 6px', borderRadius: 10, border: '1.5px solid #e2e8f0' }}>
                        <button onClick={() => removeFromCart(p.id)} style={{ width: 28, height: 28, borderRadius: 8, border: '1px solid #cbd5e1', background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>-</button>
                        <span style={{ fontWeight: 900, minWidth: 16, textAlign: 'center', color: '#1e293b', fontSize: 13 }}>{inCart.qty}</span>
                        <button onClick={() => addToCart(p)} style={{ width: 28, height: 28, borderRadius: 8, border: 'none', background: primary, color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>+</button>
                     </div>
                  ) : (
                     <button onClick={() => addToCart(p)} style={{ background: primary, color: '#fff', border: 'none', padding: '8px 16px', borderRadius: 10, fontWeight: 900, fontSize: 12, cursor: 'pointer', boxShadow: `0 4px 10px ${primary}33` }}>Add</button>
                  )}
               </div>
            </div>
         </div>
      </div>
    );
  }

  // --- DEFAULT GRID (Minimal/Bold/Elegant) ---
  // The `isGallery` variable was removed as it's not used in the new default grid template.
  return (
    <div key={p.id} style={{ background: cardBg, border: `1px solid ${borderColor}`, borderRadius: 20, overflow: 'hidden', display: 'flex', flexDirection: 'column', height: '100%', transition: 'transform 0.2s', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)' }}>
       <div style={{ position: 'relative', paddingTop: '100%', background: isDark ? '#1e293b' : '#f8fafc' }}>
          {p.imageUrl ? <img src={p.imageUrl} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} /> : <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 40 }}>🛍️</div>}
          {p.category && <div style={{ position: 'absolute', top: 12, left: 12, background: 'rgba(255,255,255,0.9)', color: '#000', padding: '4px 10px', borderRadius: 20, fontSize: 11, fontWeight: 900, backdropFilter: 'blur(4px)' }}>{p.category}</div>}
       </div>
       <div style={{ padding: 18, flex: 1, display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontWeight: 800, fontSize: 16, color: textColor, textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>{p.name}</div>
          
          {p.desc && (
             <div style={{ marginTop: 6, flex: 1 }}>
                <div style={{ fontSize: 13, color: isDark ? '#94a3b8' : '#64748b', display: isExp ? 'block' : '-webkit-box', WebkitLineClamp: isExp ? 'unset' : 2, WebkitBoxOrient: 'vertical', overflow: isExp ? 'visible' : 'hidden', lineHeight: '1.5' }}>
                   {p.desc}
                </div>
                <div onClick={() => setIsExp(!isExp)} style={{ display: 'inline-block', fontSize: 11, fontWeight: 900, color: primary, cursor: 'pointer', marginTop: 6, textTransform: 'uppercase', letterSpacing: 0.5, background: isDark ? 'rgba(255,255,255,0.05)' : '#f8fafc', padding: '2px 8px', borderRadius: 6 }}>
                   {isExp ? 'Show Less ↑' : 'Read More ↓'}
                </div>
             </div>
          )}

          <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 16 }}>
            <div style={{ fontWeight: 900, fontSize: 19, color: textColor }}>₹{rateStr}</div>
            
            {inCart ? (
               <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 10, background: isDark ? 'rgba(255,255,255,0.05)' : '#f8fafc', padding: '3px 6px', borderRadius: 12, border: `1px solid ${isDark ? '#334155' : '#e2e8f0'}` }}>
                  <button onClick={() => removeFromCart(p.id)} style={{ width: 30, height: 30, borderRadius: 8, border: `1px solid ${isDark ? '#475569' : '#cbd5e1'}`, background: isDark ? '#1e293b' : '#fff', color: textColor, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900 }}>-</button>
                  <span style={{ fontWeight: 900, minWidth: 20, textAlign: 'center', color: textColor, fontSize: 14 }}>{inCart.qty}</span>
                  <button onClick={() => addToCart(p)} style={{ width: 30, height: 30, borderRadius: 8, border: 'none', background: primary, color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900 }}>+</button>
               </div>
            ) : (
               <button onClick={() => addToCart(p)} style={{ background: primary, color: '#fff', border: 'none', padding: '10px 22px', borderRadius: 12, fontWeight: 900, fontSize: 13, cursor: 'pointer', transition: 'transform 0.1s shadow 0.1s', boxShadow: `0 4px 10px ${primary}33` }}>Add</button>
            )}
          </div>
       </div>
    </div>
  );
}

/* ─────────── CHECKOUT MODAL ─────────── */
function CheckoutModal({ cart, ownerId, ecomName, customerSession, onClose, onSuccess, primaryC, isDark, profile }) {
  const [form, setForm] = useState({ name: customerSession?.name || '', email: customerSession?.email || '', phone: customerSession?.phone || '', address: customerSession?.address || '', notes: '' });
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const total = cart.reduce((s, i) => s + i.rate * i.qty, 0);

  const submit = async () => {
    if (!form.name || !form.phone) return alert('Name and Phone are required');
    setSubmitting(true);
    try {
      const res = await fetch('/api/ecom/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ownerId, ecomName, customer: form, items: cart, total }) });
      const data = await res.json();
      if (data.success) {
        setDone(true);
        localStorage.setItem(`session_${ecomName}`, JSON.stringify(form));
        onSuccess?.(form);
        // Fire WhatsApp auto-notification for order placed
        if (profile) {
          fireAutoNotifications('order_placed', {
            client: form.name,
            phone: form.phone,
            email: form.email || '',
            orderId: data.orderId || '',
            orderAmount: total,
            orderStatus: 'Placed',
            date: new Date().toISOString().split('T')[0],
            bizName: profile?.bizName || '',
            ownerPhone: profile?.phone || '',
            entityId: data.orderId || '',
          }, profile, ownerId).catch(() => {});
        }
      }
      else alert(data.error);
    } catch (err) { alert('Network error'); } finally { setSubmitting(false); }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(6px)', zIndex: 1200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
       <div style={{ background: '#fff', width: '95%', maxWidth: 460, borderRadius: 12, padding: 28, position: 'relative', border: '1px solid #e2e8e4', color: '#1a2e24' }}>
             <div onClick={onClose} style={{ position: 'absolute', top: 20, right: 20, cursor: 'pointer', opacity: 0.6, fontSize: 20, fontWeight: 300 }}>✕</div>
             
             {done ? (
                <div style={{ textAlign: 'center', padding: '10px 0' }}>
                   <div style={{ fontSize: 72 }}>✅</div>
                   <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8, color: '#1a2e24' }}>Order Placed!</h2>
                   <p style={{ color: '#6b7f74', marginBottom: 24, fontSize: 14 }}>Thank you, {form.name}. We'll process your order soon.</p>
                   <button onClick={onClose} style={{ width: '100%', padding: 14, background: primaryC, color: '#fff', border: 'none', borderRadius: 9, fontWeight: 600, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit' }}>Finish</button>
                </div>
            ) : (
               <>
                  <h3 style={{ fontSize: 22, fontWeight: 700, marginBottom: 20, color: '#1a2e24' }}>Complete Order</h3>
                  
                  <div style={{ display: 'grid', gap: 16 }}>
                     <div><label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 5, color: '#6b7f74' }}>Full Name</label><input placeholder="Required" value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))} style={{ width: '100%', padding: '10px 12px', border: '1.5px solid #e2e8e4', borderRadius: 9, color: '#1a2e24', outline: 'none', background: '#fff', boxSizing: 'border-box', fontFamily: 'inherit', fontSize: 13 }} /></div>
                     <div><label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 5, color: '#6b7f74' }}>Email Address</label><input placeholder="Required" value={form.email} onChange={e => setForm(f => ({...f, email: e.target.value}))} style={{ width: '100%', padding: '10px 12px', border: '1.5px solid #e2e8e4', borderRadius: 9, color: '#1a2e24', outline: 'none', background: '#fff', boxSizing: 'border-box', fontFamily: 'inherit', fontSize: 13 }} /></div>
                     <div><label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 5, color: '#6b7f74' }}>Phone Number</label><input placeholder="Required" value={form.phone} onChange={e => setForm(f => ({...f, phone: e.target.value}))} style={{ width: '100%', padding: '10px 12px', border: '1.5px solid #e2e8e4', borderRadius: 9, color: '#1a2e24', outline: 'none', background: '#fff', boxSizing: 'border-box', fontFamily: 'inherit', fontSize: 13 }} /></div>
                     <div><label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 5, color: '#6b7f74' }}>Delivery Address</label><textarea placeholder="Optional" value={form.address} onChange={e => setForm(f => ({...f, address: e.target.value}))} style={{ width: '100%', padding: '10px 12px', border: '1.5px solid #e2e8e4', borderRadius: 9, height: 80, color: '#1a2e24', outline: 'none', background: '#fff', boxSizing: 'border-box', resize: 'none', fontFamily: 'inherit', fontSize: 13 }} /></div>
                  </div>

                  <div style={{ margin: '20px 0', padding: 16, background: '#f0f4f1', borderRadius: 9, display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid #e2e8e4' }}>
                     <span style={{ fontSize: 12, fontWeight: 600, color: '#6b7f74', textTransform: 'uppercase', letterSpacing: 0.5 }}>Total Amount</span>
                     <span style={{ fontSize: 22, fontWeight: 700, color: '#1a2e24' }}>₹{total.toLocaleString()}</span>
                  </div>

                  <button disabled={submitting} onClick={submit} style={{ width: '100%', padding: 14, background: primaryC, color: '#fff', border: 'none', borderRadius: 9, fontWeight: 600, fontSize: 14, cursor: 'pointer', fontFamily: 'inherit' }}>
                     {submitting ? 'Processing...' : 'CONFIRM ORDER'}
                  </button>
                  
                  <div onClick={onClose} style={{ textAlign: 'center', marginTop: 16, fontSize: 13, color: '#6b7f74', cursor: 'pointer', fontWeight: 600 }}>Go Back</div>
               </>
            )}
        </div>
    </div>
  );
}

/* ─────────── MAIN STORE PAGE ─────────── */
export default function StorePage() {
  const ecomName = (window.location.pathname.split('/')[1] || '').toLowerCase().trim();
  const [cart, setCart] = useState(() => { try { const s = localStorage.getItem(`cart_${ecomName}`); return s ? JSON.parse(s) : []; } catch { return []; } });
  useEffect(() => { localStorage.setItem(`cart_${ecomName}`, JSON.stringify(cart)); }, [cart, ecomName]);
  const [showCheckout, setShowCheckout] = useState(false);
  const [customerSession, setCustomerSession] = useState(() => { try { const s = localStorage.getItem(`session_${ecomName}`); return s ? JSON.parse(s) : null; } catch { return null; } });
  
  const [search, setSearch] = useState('');
  const [cat, setCat] = useState('All');

  const cleanSlug = ecomName.toLowerCase().trim();
  const { data, isLoading } = db.useQuery({ 
    userProfiles: { $: { where: { slug: cleanSlug } } }, 
    ecomSettings: { $: { where: { ecomName: cleanSlug } } }, 
    products: {} 
  });

  const profile = data?.userProfiles?.[0];
  const settings = useMemo(() => {
    const s = { ...(data?.ecomSettings?.[0] || {}) };
    if (profile) {
      if (profile.bizName) s.title = profile.bizName;
      if (profile.logo) s.logo = profile.logo;
      if (profile.bannerUrl && !s.bannerUrl) s.bannerUrl = profile.bannerUrl;
    }
    return s;
  }, [data?.ecomSettings, profile]);

  const ownerId = profile?.userId || settings?.userId;
  const allProducts = useMemo(() => {
    return (data?.products || []).filter(p => p.userId === ownerId && p.listInEcom);
  }, [data?.products, ownerId]);

  const categories = useMemo(() => {
    return [...new Set(allProducts.map(p => p.category).filter(Boolean))];
  }, [allProducts]);

  const filtered = useMemo(() => {
    let list = allProducts;
    if (cat !== 'All') list = list.filter(p => p.category === cat);
    if (search) list = list.filter(p => p.name.toLowerCase().includes(search.toLowerCase()));
    return list;
  }, [allProducts, cat, search]);

  if (isLoading) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', fontFamily: "'DM Sans', sans-serif" }}>Loading...</div>;
  if (!ownerId) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', fontFamily: "'DM Sans', sans-serif", color: '#6b7f74' }}><h2>🏪 Store Not Found</h2></div>;

  const templateId = Number(settings?.template) || 1;
  const primaryC = settings.primaryColor || '#6366f1';
  const a = settings.accentColor || '#fdd835';
  const secondaryC = settings.secondaryColor || '#2e7d32';

  const isDark = templateId === 2;
  // const theme = templateId === 5 ? 'catalog' : (templateId === 4 ? 'list' : 'grid'); // No longer needed, using templateId directly

  const addToCart = (pi) => setCart(prev => { const ex = prev.find(i => i.id === pi.id); if (ex) return prev.map(i => i.id === pi.id ? { ...i, qty: i.qty + 1 } : i); return [...prev, { ...pi, qty: 1 }]; });
  const removeFromCart = (pid) => setCart(prev => { const ex = prev.find(i => i.id === pid); if (ex?.qty <= 1) return prev.filter(i => i.id !== pid); return prev.map(i => i.id === pid ? { ...i, qty: i.qty - 1 } : i); });

  return (
    <div style={{ fontFamily: "'DM Sans', sans-serif", minHeight: '100vh', background: isDark ? '#0f172a' : '#f0f4f1', color: isDark ? '#f1f5f9' : '#1a2e24' }}>
      <style>{RESPONSIVE_CSS}</style>
      
      {/* Header */}
      <header style={{ background: isDark ? `${primaryC}99` : '#fff', borderBottom: `1.5px solid ${isDark ? primaryC : '#e2e8e4'}`, padding: '0 20px', position: 'sticky', top: 0, zIndex: 100, backdropFilter: isDark ? 'blur(10px)' : 'none' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', height: 64 }}>
           <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 12 }}>
             {settings.logo && <img src={settings.logo} alt="Logo" style={{ height: 36, width: 36, objectFit: 'contain', borderRadius: 6 }} />}
             <div style={{ fontWeight: 700, fontSize: 18 }}>{settings.title || 'Store'}</div>
           </div>
           <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 14 }}>
             {customerSession && <a href={`/${ecomName}/orders`} style={{ fontSize: 13, color: isDark ? '#fff' : primaryC, fontWeight: 700, textDecoration: 'none' }}>ORDERS</a>}
             <div onClick={() => setShowCheckout(true)} style={{ background: isDark ? a : primaryC, color: isDark ? '#000' : '#fff', padding: '10px 20px', borderRadius: 9, cursor: 'pointer', fontWeight: 600, fontSize: 13, display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, borderRight: `1px solid ${isDark ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.2)'}`, paddingRight: 10 }}>
                   <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.9 }}>
                     <circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>
                   </svg>
                   <span>{cart.reduce((a, b) => a + b.qty, 0)}</span>
                </div>
                <span style={{ fontSize: 14 }}>₹{cart.reduce((a, b) => a + (b.rate * b.qty), 0).toLocaleString()}</span>
             </div>
           </div>
        </div>
      </header>

      {/* Banner */}
      {settings.bannerUrl && (
        <div className="banner" style={{ background: `linear-gradient(rgba(0,0,0,0.3), rgba(0,0,0,0.3)), url(${settings.bannerUrl}) center/cover no-repeat`, height: 260, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
           <div style={{ textAlign: 'center', color: '#fff', padding: '0 20px', textShadow: '0 2px 10px rgba(0,0,0,0.4)' }}>
             <h1 style={{ fontSize: 42, fontWeight: 900, marginBottom: 4, letterSpacing: '-1px' }}>{settings.title}</h1>
             {settings.tagline && <p style={{ fontSize: 18, fontWeight: 500, opacity: 0.9 }}>{settings.tagline}</p>}
           </div>
        </div>
      )}

      {/* Main Content */}
      <main className="store-container" style={{ maxWidth: templateId === 5 ? 1000 : 1200, margin: '0 auto', padding: '24px 16px' }}>
         
         {/* Filter Section */}
         <div style={{ display: 'flex', flexDirection: 'row', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 200, position: 'relative' }}>
              <input 
                placeholder="Search products..." 
                value={search} onChange={e => setSearch(e.target.value)} 
                style={{ width: '100%', padding: '10px 14px', borderRadius: 9, border: `1.5px solid ${isDark ? '#334155' : '#e2e8e4'}`, background: isDark ? 'rgba(255,255,255,0.05)' : '#fff', color: isDark ? '#fff' : '#1a2e24', fontSize: 13, outline: 'none', fontFamily: 'inherit' }} 
              />
            </div>
            <div className="hide-scroll" style={{ display: 'flex', flexDirection: 'row', gap: 8, flex: 2, overflowX: 'auto', paddingBottom: 4 }}>
               {['All', ...categories].map(c => (
                  <button key={c} onClick={() => setCat(c)} style={{ padding: '8px 16px', borderRadius: 20, border: `1.5px solid ${cat === c ? primaryC : (isDark ? '#334155' : '#e2e8e4')}`, background: cat === c ? primaryC : (isDark ? 'rgba(255,255,255,0.05)' : '#fff'), color: cat === c ? '#fff' : (isDark ? '#94a3b8' : '#6b7f74'), fontWeight: 600, fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap', fontFamily: 'inherit' }}>{c}</button>
               ))}
            </div>
         </div>

         <div style={{ paddingBottom: 40 }}>
            {(templateId === 4 || templateId === 5) && (
               <div className="mobile-hide" style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 16, padding: '16px 20px', background: isDark ? 'rgba(255,255,255,0.03)' : '#f1f5f9', borderRadius: 16, marginBottom: 16, border: `1px solid ${isDark ? '#334155' : '#e2e8f0'}`, opacity: 0.8 }}>
                  <div style={{ width: 50, fontSize: 10, fontWeight: 900, color: isDark ? '#94a3b8' : '#64748b', textTransform: 'uppercase', letterSpacing: 1 }}>Icon</div>
                  <div style={{ flex: 1, fontSize: 10, fontWeight: 900, color: isDark ? '#94a3b8' : '#64748b', textTransform: 'uppercase', letterSpacing: 1 }}>Name & Service Details</div>
                  <div style={{ display: 'flex', gap: 16, flexShrink: 0, fontSize: 10, fontWeight: 900, color: isDark ? '#94a3b8' : '#64748b', textTransform: 'uppercase', letterSpacing: 1 }}>
                     <div className="mobile-hide" style={{ minWidth: 80, textAlign: 'right' }}>Price</div>
                     <div style={{ minWidth: 90, textAlign: 'center' }}>{templateId === 5 ? 'Status' : 'Qty / Action'}</div>
                  </div>
               </div>
            )}
            
            <div style={{ display: 'grid', gridTemplateColumns: (templateId === 4 || templateId === 5) ? '1fr' : 'repeat(auto-fill, minmax(280px, 1fr))', gap: (templateId === 4 || templateId === 5) ? 12 : 24 }}>
               {filtered.map(p => (
                  <ProductItem key={p.id} p={p} inCart={cart.find(c => c.id === p.id)} t={templateId} isDark={isDark} addToCart={addToCart} removeFromCart={removeFromCart} primary={primaryC} secondary={secondaryC} />
               ))}
            </div>
            {filtered.length === 0 && <div style={{ padding: 64, textAlign: 'center', color: '#94a3b8' }}><h3>No products found</h3></div>}
         </div>
      </main>

      {showCheckout && <CheckoutModal cart={cart} ownerId={ownerId} ecomName={ecomName} customerSession={customerSession} onClose={() => setShowCheckout(false)} onSuccess={setCustomerSession} primaryC={primaryC} isDark={isDark} profile={profile} />}
    </div>
  );
}
