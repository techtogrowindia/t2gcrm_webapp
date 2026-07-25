import React, { useState } from 'react';
import { dbWrite, dbOp } from '../../utils/dbWrite';
import db from '../../instant';
import { id } from '@instantdb/react';
import { useToast } from '../../context/ToastContext';
import { AUTH_API } from '../../utils/authApi';

export default function UserProfile({ user, profile, perms, memberProfile, ownerId }) {
  const isTeamMember = perms && !perms.isOwner;
  const toast = useToast();

  const [form, setForm] = useState({
    // Team member identity comes from reliable sources: perms.name (their
    // teamMembers record) and user.email (their own login). memberProfile can
    // mis-resolve on the Postgres path, so it's only a last-resort fallback —
    // never for the login email (which drives the password-change target).
    fullName: isTeamMember ? (perms?.name || memberProfile?.name || '') : (profile?.fullName || ''),
    email: isTeamMember ? (user.email || memberProfile?.email || '') : (profile?.email || user.email || ''),
    phone: isTeamMember ? (memberProfile?.phone || '') : (profile?.phone || ''),
  });

  const save = async () => {
    if (!form.email.includes('@')) return toast('Valid email required', 'error');
    
    try {
      if (isTeamMember) {
        const mId = memberProfile?.id || id();
        await dbWrite(dbOp.update('memberProfiles', mId, {
          userId: user.id,
          ownerUserId: ownerId,
          email: form.email.toLowerCase(),
          name: form.fullName,
          phone: form.phone,
          updatedAt: Date.now()
        }));
        toast('Profile updated successfully!', 'success');
      } else {
        const pId = profile?.id || id();
        await dbWrite(dbOp.update('userProfiles', pId, {
          userId: user.id,
          fullName: form.fullName,
          email: form.email.toLowerCase(),
          phone: form.phone,
          updatedAt: Date.now()
        }));
        toast('Profile updated successfully!', 'success');
      }
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const changePassword = async () => {
    const pwdInput = document.getElementById('user-new-password');
    const newPass = pwdInput.value;
    if (!newPass || newPass.length < 6) return toast('Password must be at least 6 characters', 'error');
    
    try {
      const res = await fetch(AUTH_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'change-password', email: form.email, newPassword: newPass, userId: user.id })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      
      toast('Password updated successfully!', 'success');
      pwdInput.value = '';
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  return (
    <div>
      <div className="sh">
        <div><h2>My Profile</h2><div className="sub">Manage your personal details and security</div></div>
        <button className="btn btn-primary btn-sm" onClick={save}>Save Profile</button>
      </div>

      <div className="tw" style={{ marginTop: 20 }}>
        <div style={{ padding: 24 }}>
          <div className="fgrid">
            <div className="fg span2"><label>Full Name</label><input value={form.fullName} onChange={e => setForm(p => ({ ...p, fullName: e.target.value }))} /></div>
            <div className="fg"><label>Login Email</label><input value={form.email} disabled style={{ background: '#f8fafc', color: '#94a3b8' }} /></div>
            {/* type/autoComplete are load-bearing: an untyped input here let the
                browser autofill a saved *email* into the phone field, which a
                stray Save Profile would then persist as the user's phone. */}
            <div className="fg"><label>Phone Number</label><input type="tel" autoComplete="tel" inputMode="tel" value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))} /></div>
          </div>

          <div style={{ marginTop: 40, paddingTop: 20, borderTop: '1px solid var(--border)' }}>
            <h4 style={{ marginBottom: 15 }}>Security & Password</h4>
            <div className="fgrid">
              <div className="fg"><label>New Password</label><input type="password" id="user-new-password" placeholder="Enter new password" /></div>
              <div className="fg" style={{ display: 'flex', alignItems: 'flex-end' }}><button className="btn btn-secondary" onClick={changePassword}>Update Password</button></div>
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>Min. 6 characters. You don't need your current password to change it.</div>
          </div>
        </div>
      </div>
    </div>
  );
}
