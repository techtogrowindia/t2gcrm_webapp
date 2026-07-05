import React, { useState } from 'react';
import db from '../../instant';
import { DEFAULT_PLANS } from '../../context/AppContext';
import { useToast } from '../../context/ToastContext';
import { pgAuthSetSession } from '../../hooks/useAuthPg';

import { AUTH_API } from '../../utils/authApi';
const USE_PG_AUTH = import.meta.env.VITE_USE_PG_AUTH === 'true';

export default function AuthScreen({ settings }) {
  const activePlans = settings?.plans || DEFAULT_PLANS;
  const [tab, setTab] = useState('login'); // 'login' | 'register'
  const [authMethod, setAuthMethod] = useState('password'); // 'password' | 'magic'
  const [step, setStep] = useState('email'); // 'email' | 'code' | 'forgot' | 'reset'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [code, setCode] = useState('');
  const [selectedPlan, setSelectedPlan] = useState('');
  const [bizName, setBizName] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const toast = useToast();

  const handleMagicSendCode = async (e) => {
    e.preventDefault();
    if (!email.trim()) { toast('Enter your email address', 'error'); return; }

    if (tab === 'register') {
      localStorage.setItem('tc_reg_data', JSON.stringify({
        bizName, fullName, phone, selectedPlan: selectedPlan || 'Trial'
      }));
    }

    setLoading(true);
    try {
      if (USE_PG_AUTH) {
        const res = await fetch('/api/auth-pg', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'send-code', email: email.trim() }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to send code');
        setStep('code');
        toast('Magic code sent! Check your email 📧', 'success');
      } else {
        await db.auth.sendMagicCode({ email: email.trim() });
        setStep('code');
        toast('Magic code sent! Check your email 📧', 'success');
      }
    } catch (err) {
      toast(err?.message || err?.body?.message || 'Failed to send code. Try again.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleMagicVerifyCode = async (e) => {
    e.preventDefault();
    if (!code.trim()) { toast('Enter the code from your email', 'error'); return; }
    setLoading(true);
    try {
      if (USE_PG_AUTH) {
        const res = await fetch('/api/auth-pg', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'verify-code', email: email.trim(), code: code.trim() }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Invalid code');
        pgAuthSetSession(data);
        toast(`Welcome to ${settings?.brandName || 'T2GCRM'}! 👋`, 'success');
        window.location.reload(); // trigger useAuthPg to pick up the new token
      } else {
        await db.auth.signInWithMagicCode({ email: email.trim(), code: code.trim() });
        toast(`Welcome to ${settings?.brandName || 'T2GCRM'}! 👋`, 'success');
      }
    } catch (err) {
      toast(err?.message || err?.body?.message || 'Invalid code. Try again.', 'error');
      setCode('');
    } finally {
      setLoading(false);
    }
  };

  const handlePasswordSubmit = async (e) => {
    e.preventDefault();
    if (!email.trim() || !password) { toast('Enter email and password', 'error'); return; }
    setLoading(true);

    try {
      if (USE_PG_AUTH && tab === 'login') {
        // Postgres password login
        const res = await fetch('/api/auth-pg', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'login', email: email.trim(), password }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Authentication failed');
        pgAuthSetSession(data);
        if (data.isTeam) {
          localStorage.setItem('tc_team_member', JSON.stringify({
            isTeamMember: true,
            ownerUserId: data.accountId,
            teamMemberId: data.credentialId,
          }));
        } else { localStorage.removeItem('tc_team_member'); }
        if (data.isPartner) {
          localStorage.setItem('tc_channel_partner', JSON.stringify({
            isPartner: true, ownerUserId: data.accountId, partnerId: data.credentialId,
          }));
        } else { localStorage.removeItem('tc_channel_partner'); }
        toast('Welcome Back! 👋', 'success');
        window.location.reload();
        return;
      }

      // InstantDB path (prod, or register flow)
      const payload = { email: email.trim(), password, fullName, bizName, phone, selectedPlan };
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, action: tab })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Authentication failed');

      if (tab === 'register') {
        localStorage.setItem('tc_reg_data', JSON.stringify({
          bizName, fullName, phone, selectedPlan: selectedPlan || 'Trial'
        }));
        localStorage.setItem('tc_pending_otp', data.otp || '');
        console.log('REGISTRATION OTP (Dev Mode):', data.otp);
        setStep('otp-verify');
        toast('Account created! Enter the OTP to verify your email.', 'success');
      } else {
        await db.auth.signInWithToken(data.token);
        if (data.isTeamMember) {
          localStorage.setItem('tc_team_member', JSON.stringify({
            isTeamMember: true, ownerUserId: data.ownerUserId, teamMemberId: data.teamMemberId
          }));
        } else { localStorage.removeItem('tc_team_member'); }
        if (data.isPartner) {
          localStorage.setItem('tc_channel_partner', JSON.stringify({
            isPartner: true, ownerUserId: data.ownerUserId,
            partnerId: data.partnerId, role: data.role
          }));
        } else { localStorage.removeItem('tc_channel_partner'); }
        toast('Welcome Back! 👋', 'success');
      }
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async (e) => {
    e.preventDefault();
    if (!email.trim()) { toast('Please enter your email first', 'info'); return; }
    setLoading(true);
    try {
      const res = await fetch(AUTH_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reset-password-request', email: email.trim() })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      // In production, backend should send the email or we call our /api/send-email from here
      // For now we log it so development is easier
      console.log('PASSWORD RESET CODE (Dev Mode):', data.otp);
      
      toast('Reset code sent! Check your email / console.', 'success');
      setStep('reset');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e) => {
    e.preventDefault();
    if (!code.trim() || !newPassword) { toast('Enter code and new password', 'error'); return; }
    setLoading(true);
    try {
      const res = await fetch(AUTH_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reset-password-verify', email: email.trim(), code: code.trim(), newPassword })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      toast('Password reset successfully! You can now log in.', 'success');
      setStep('email');
      setTab('login');
      setPassword('');
      setNewPassword('');
      setCode('');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleOtpVerify = async (e) => {
    e.preventDefault();
    if (!code.trim()) { toast('Enter the OTP from your email', 'error'); return; }
    setLoading(true);
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'verify-otp', email: email.trim(), otp: code.trim() })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Verification failed');

      // OTP verified — sign in with the token
      await db.auth.signInWithToken(data.token);
      toast('Email verified! Welcome! 🎉', 'success');
    } catch (err) {
      toast(err.message, 'error');
      setCode('');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-screen">
      {/* LEFT PANEL */}
      <div className="auth-left">
        <div style={{ width: '100%', maxWidth: 400 }}>
          <div style={{ textAlign: 'left', marginBottom: 12 }}>
            <div style={{ width: 52, height: 52, background: 'var(--accent)', borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16, fontWeight: 800, fontSize: 18, color: '#fff' }}>{settings?.brandShort || 'T2G'}</div>
            <h1 style={{ fontSize: 32, marginBottom: 12 }}>{settings?.brandName || 'T2GCRM'}</h1>
            <p style={{ fontSize: 16, color: 'rgba(255,255,255,0.7)', lineHeight: 1.5, textAlign: 'left', margin: 0 }}>All-in-one SaaS platform to manage leads, invoices, projects &amp; automation.</p>
          </div>
          
          <div style={{ marginTop: 40, width: '100%' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              {[
                'Real-time lead & pipeline dashboards',
                'Quotations, Invoices & Subscriptions',
                'Appointment & Ecommerce',
                'Integration & Automations'
              ].map((feature, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <div style={{ width: 22, height: 22, border: '2px solid var(--accent)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>
                  </div>
                  <span style={{ fontSize: 15, color: '#f8fafc', fontWeight: 500 }}>{feature}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* RIGHT PANEL */}
      <div className="auth-right">
        <div className="auth-box">
          <h2>{step === 'email' ? 'Welcome 👋' : step === 'otp-verify' ? 'Verify Your Email ✉️' : step === 'reset' ? 'Reset Password 🔑' : 'Check Your Email 📧'}</h2>
          <p className="sub">
            {step === 'email'
              ? `Sign in to your ${settings?.brandName || 'T2GCRM'} workspace`
              : step === 'otp-verify'
              ? `We sent a verification code to ${email}`
              : step === 'reset'
              ? 'Enter the 6-digit code and a new password'
              : `We sent a 6-digit code to ${email}`}
          </p>

          {/* TABS (only visible on email step) */}
          {step === 'email' && (
            <div className="auth-tabs">
              <div className={`auth-tab${tab === 'login' ? ' active' : ''}`} onClick={() => setTab('login')}>Sign In</div>
              <div className={`auth-tab${tab === 'register' ? ' active' : ''}`} onClick={() => setTab('register')}>Create Account</div>
            </div>
          )}

          {/* AUTH METHOD SELECTOR */}
          {step === 'email' && (
            <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
              <button 
                type="button" 
                className={`btn ${authMethod === 'password' ? 'btn-primary' : ''}`} 
                style={{ flex: 1, background: authMethod !== 'password' ? '#f1f5f9' : undefined, color: authMethod !== 'password' ? '#64748b' : undefined }}
                onClick={() => setAuthMethod('password')}
              >
                Password
              </button>
              <button 
                type="button" 
                className={`btn ${authMethod === 'magic' ? 'btn-primary' : ''}`} 
                style={{ flex: 1, background: authMethod !== 'magic' ? '#f1f5f9' : undefined, color: authMethod !== 'magic' ? '#64748b' : undefined }}
                onClick={() => setAuthMethod('magic')}
              >
                Magic Code
              </button>
            </div>
          )}

          {/* REGISTER EXTRA FIELDS */}
          {step === 'email' && tab === 'register' && (
            <>
              <div className="form-group">
                <label>Full Name</label>
                <input value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Your full name" />
              </div>
              <div className="form-group">
                <label>Business Name</label>
                <input value={bizName} onChange={e => setBizName(e.target.value)} placeholder="Your business name" />
              </div>
              <div className="form-group">
                <label>Phone Number</label>
                <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="+91 98765 43210" />
              </div>
            </>
          )}

          {/* EMAIL & PASSWORD STEP */}
          {step === 'email' && (
            <form onSubmit={authMethod === 'password' ? handlePasswordSubmit : handleMagicSendCode}>
              <div className="form-group">
                <label>Email Address</label>
                <input
                  type="email" value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@company.com" required autoFocus
                />
              </div>

              {authMethod === 'password' && (
                <div className="form-group">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <label style={{ marginBottom: 0 }}>Password</label>
                    {tab === 'login' && (
                      <span 
                        style={{ fontSize: 12, color: 'var(--accent)', cursor: 'pointer', fontWeight: 600 }}
                        onClick={() => setStep('forgot')}
                      >
                        Forgot password?
                      </span>
                    )}
                  </div>
                  <div style={{ position: 'relative', marginTop: 6 }}>
                    <input
                      type={showPassword ? 'text' : 'password'} value={password}
                      onChange={e => setPassword(e.target.value)}
                      placeholder="••••••••" required
                      style={{ paddingRight: 40 }}
                    />
                    <svg
                      onClick={() => setShowPassword(v => !v)}
                      style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', cursor: 'pointer', color: '#94a3b8', width: 20, height: 20 }}
                      viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                    >
                      {showPassword ? (
                        <>
                          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                          <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                          <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
                          <line x1="1" y1="1" x2="23" y2="23" />
                        </>
                      ) : (
                        <>
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                          <circle cx="12" cy="12" r="3" />
                        </>
                      )}
                    </svg>
                  </div>
                </div>
              )}

              <button type="submit" className="btn btn-primary" style={{ marginTop: 6 }} disabled={loading}>
                {loading ? 'Processing...' : (authMethod === 'password' ? (tab === 'login' ? 'Sign In' : 'Create Account') : 'Send Magic Code →')}
              </button>
              
              {tab === 'login' && (
                <div style={{ textAlign: 'center', marginTop: 24 }}>
                  <a href="/partner/register" style={{ fontSize: 13, color: '#64748b', textDecoration: 'none', fontWeight: 600 }}>
                    Channel Partner? <span style={{ color: 'var(--accent)' }}>Register here →</span>
                  </a>
                </div>
              )}
            </form>
          )}

          {/* FORGOT PASSWORD REQUEST STEP */}
          {step === 'forgot' && (
            <form onSubmit={handleForgotPassword}>
              <div className="form-group">
                <label>Email Address</label>
                <input
                  type="email" value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@company.com" required autoFocus
                />
              </div>
              <button type="submit" className="btn btn-primary" style={{ marginTop: 6 }} disabled={loading}>
                {loading ? 'Sending...' : 'Send Reset Code'}
              </button>
              <div style={{ textAlign: 'center', marginTop: 14 }}>
                <span
                  style={{ fontSize: 12, color: '#64748b', cursor: 'pointer', fontWeight: 600 }}
                  onClick={() => setStep('email')}
                >
                  ← Back to Login
                </span>
              </div>
            </form>
          )}

          {/* FORGOT PASSWORD RESET STEP */}
          {step === 'reset' && (
            <form onSubmit={handleResetPassword}>
              <div className="form-group">
                <label>6-Digit Reset Code</label>
                <input
                  type="text" value={code}
                  onChange={e => setCode(e.target.value)}
                  placeholder="123456" required autoFocus
                  style={{ letterSpacing: '0.3em', fontSize: 22, textAlign: 'center', fontWeight: 700 }}
                  maxLength={6}
                />
              </div>
              <div className="form-group">
                <label>New Password</label>
                <div style={{ position: 'relative' }}>
                  <input
                    type={showNewPassword ? 'text' : 'password'} value={newPassword}
                    onChange={e => setNewPassword(e.target.value)}
                    placeholder="••••••••" required
                    style={{ paddingRight: 40 }}
                  />
                  <svg
                    onClick={() => setShowNewPassword(v => !v)}
                    style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', cursor: 'pointer', color: '#94a3b8', width: 20, height: 20 }}
                    viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                  >
                    {showNewPassword ? (
                      <>
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                        <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                        <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24" />
                        <line x1="1" y1="1" x2="23" y2="23" />
                      </>
                    ) : (
                      <>
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                        <circle cx="12" cy="12" r="3" />
                      </>
                    )}
                  </svg>
                </div>
              </div>
              <button type="submit" className="btn btn-primary" style={{ marginTop: 6 }} disabled={loading}>
                {loading ? 'Reseting...' : 'Update Password ✓'}
              </button>
            </form>
          )}

          {/* REGISTRATION OTP VERIFY STEP */}
          {step === 'otp-verify' && (
            <form onSubmit={handleOtpVerify}>
              <div className="form-group">
                <label>6-Digit Verification Code</label>
                <input
                  type="text" value={code}
                  onChange={e => setCode(e.target.value)}
                  placeholder="123456" required autoFocus
                  style={{ letterSpacing: '0.3em', fontSize: 22, textAlign: 'center', fontWeight: 700 }}
                  maxLength={6}
                />
              </div>
              <button type="submit" className="btn btn-primary" style={{ marginTop: 6 }} disabled={loading}>
                {loading ? 'Verifying...' : 'Verify & Sign In ✓'}
              </button>
              <div style={{ textAlign: 'center', marginTop: 14 }}>
                <span
                  style={{ fontSize: 12, color: '#64748b', cursor: 'pointer', fontWeight: 600 }}
                  onClick={() => { setStep('email'); setTab('login'); setCode(''); }}
                >
                  ← Back to Sign In
                </span>
              </div>
            </form>
          )}

          {/* MAGIC CODE STEP */}
          {step === 'code' && (
            <form onSubmit={handleMagicVerifyCode}>
              <div className="form-group">
                <label>6-Digit Magic Code</label>
                <input
                  type="text" value={code}
                  onChange={e => setCode(e.target.value)}
                  placeholder="123456" required autoFocus
                  style={{ letterSpacing: '0.3em', fontSize: 22, textAlign: 'center', fontWeight: 700 }}
                  maxLength={6}
                />
              </div>
              <button type="submit" className="btn btn-primary" style={{ marginTop: 6 }} disabled={loading}>
                {loading ? 'Verifying...' : 'Verify & Sign In ✓'}
              </button>
              <div style={{ textAlign: 'center', marginTop: 14 }}>
                <span
                  style={{ fontSize: 12, color: 'var(--accent)', cursor: 'pointer', fontWeight: 600 }}
                  onClick={() => { setStep('email'); setCode(''); }}
                >
                  ← Use a different email
                </span>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
