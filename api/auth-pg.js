// ===================================================================
// api/auth-pg.js — Authentication against PostgreSQL
//
// Supports:
//   POST /api/auth-pg  { action: 'login',       email, password }
//   POST /api/auth-pg  { action: 'send-code',   email }
//   POST /api/auth-pg  { action: 'verify-code', email, code }
//   POST /api/auth-pg  { action: 'me' }          (verify JWT, return profile)
//
// Returns { token, accountId, email, role } on success.
// Token is a JWT signed with JWT_SECRET (24h expiry).
// Magic-code: 6-digit OTP, 10-min expiry, max 5 attempts, single-use.
// System SMTP for magic-code emails comes from env vars (set by admin on VPS).
// ===================================================================
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import nodemailer from 'nodemailer';
import { rawQuery, tenantQuery, tenantTransaction } from './db-pg.js';
import { sendOtpEmail } from './_email-otp.js';

// ── JWT (no external library — pure Node crypto) ──────────────────
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRY_SECONDS = 24 * 60 * 60; // 24 hours

function base64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function signJwt(payload) {
  if (!JWT_SECRET) throw new Error('JWT_SECRET not set in environment');
  const header  = base64url(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const body    = base64url(Buffer.from(JSON.stringify({
    ...payload,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + JWT_EXPIRY_SECONDS,
  })));
  const sig = base64url(
    crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest()
  );
  return `${header}.${body}.${sig}`;
}

function verifyJwt(token) {
  if (!JWT_SECRET) throw new Error('JWT_SECRET not set in environment');
  const parts = (token || '').split('.');
  if (parts.length !== 3) throw new Error('Invalid token');
  const [header, body, sig] = parts;
  const expected = base64url(
    crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest()
  );
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)))
    throw new Error('Invalid token signature');
  const payload = JSON.parse(Buffer.from(body, 'base64').toString());
  if (payload.exp < Math.floor(Date.now() / 1000)) throw new Error('Token expired');
  return payload;
}

// ── System SMTP (for magic-code emails) ───────────────────────────
function getSystemSmtp() {
  const host = process.env.SYSTEM_SMTP_HOST;
  const port = parseInt(process.env.SYSTEM_SMTP_PORT || '587');
  const user = process.env.SYSTEM_SMTP_USER;
  const pass = process.env.SYSTEM_SMTP_PASS;
  const from = process.env.SYSTEM_SMTP_FROM || process.env.SYSTEM_SMTP_USER;
  if (!host || !user || !pass) return null;
  return { host, port, user, pass, from };
}

async function sendMagicCodeEmail(email, code, brandName) {
  const smtp = getSystemSmtp();
  if (!smtp) {
    console.warn('[auth-pg] System SMTP not configured — magic code not sent. Code:', code);
    return; // In dev, log the code to console
  }
  const transporter = nodemailer.createTransport({
    host: smtp.host, port: smtp.port,
    secure: smtp.port === 465,
    auth: { user: smtp.user, pass: smtp.pass },
    tls: { rejectUnauthorized: false },
  });
  await transporter.sendMail({
    from: smtp.from ? `"${brandName || 'T2GCRM'}" <${smtp.from}>` : smtp.user,
    to: email,
    subject: `Your login code for ${brandName || 'T2GCRM'}`,
    text: `Your login code is: ${code}\n\nThis code expires in 10 minutes. Do not share it.`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px">
        <h2 style="margin:0 0 8px">${brandName || 'T2GCRM'}</h2>
        <p style="color:#64748b;margin:0 0 24px">Your login verification code:</p>
        <div style="font-size:36px;font-weight:700;letter-spacing:8px;color:#0f172a;
                    background:#f1f5f9;padding:16px 24px;border-radius:8px;
                    display:inline-block;margin-bottom:24px">${code}</div>
        <p style="color:#64748b;font-size:14px">Expires in 10 minutes. Do not share this code.</p>
      </div>`,
  });
}

// ── Rate limit: max 1 send-code per 60s per email ─────────────────
const sendRateMap = new Map(); // email -> lastSentMs (in-memory, resets on restart)
function checkSendRate(email) {
  const last = sendRateMap.get(email) || 0;
  if (Date.now() - last < 60_000) return false;
  sendRateMap.set(email, Date.now());
  return true;
}

// ── Cross-type email classification (uniqueness enforcement) ───────
// Server-side backstop so an email can only be ONE user type. Uses only the
// no-RLS auth tables: accounts (owners) + credentials (is_team/is_partner).
// team_members/partner_applications are RLS-gated and unreadable here, but
// credentials carries the same team/partner signal.
async function classifyEmail(email) {
  const [acc, cred] = await Promise.all([
    rawQuery('SELECT 1 FROM accounts WHERE lower(email) = lower($1) LIMIT 1', [email]),
    rawQuery('SELECT is_team, is_partner FROM credentials WHERE lower(email) = lower($1) LIMIT 1', [email]),
  ]);
  return {
    isOwner: acc.rows.length > 0,
    isTeam: !!cred.rows[0]?.is_team,
    isPartner: !!cred.rows[0]?.is_partner,
  };
}

// ── Handler ───────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action, email: rawEmail, password, newPassword, code, userId, ownerUserId, teamMemberId, partnerId } = req.body || {};
  const email = (rawEmail || '').trim().toLowerCase();

  // ── action: me (verify token, return identity) ──────────────────
  if (action === 'me') {
    try {
      const auth = req.headers.authorization || '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : auth;
      const payload = verifyJwt(token);
      return res.json({ ok: true, ...payload });
    } catch (e) {
      return res.status(401).json({ error: e.message });
    }
  }

  // ── action: login (password) ────────────────────────────────────
  if (action === 'login') {
    if (!email || !password)
      return res.status(400).json({ error: 'email and password required' });
    try {
      const { rows } = await rawQuery(
        'SELECT id, email, password_hash, is_verified, is_team, is_partner, account_id, doc FROM credentials WHERE lower(email) = lower($1)',
        [email]
      );
      if (!rows.length) return res.status(401).json({ error: 'Invalid email or password' });

      // An email may WRONGLY have more than one credential row — e.g. a
      // business owner who was also added as a channel partner/team member
      // (a data-integrity issue this app is prone to; see CLAUDE.md "No
      // Orphaned Records"). The old code did `rows[0]` and logged the user in
      // as whatever the DB happened to return first — which is how an owner
      // ended up in the partner portal. Mirror api/auth.js: prefer the owner
      // (non-team/non-partner) credential, and among candidates pick the one
      // whose password actually matches (so a password reset that only touched
      // one of the duplicate rows can't lock the user out).
      const ordered = [...rows].sort(
        (a, b) => Number(!!a.is_team || !!a.is_partner) - Number(!!b.is_team || !!b.is_partner)
      );
      let cred = null;
      for (const c of ordered) {
        if (c.password_hash && await bcrypt.compare(password, c.password_hash)) { cred = c; break; }
      }
      if (!cred) {
        if (!rows.some(c => c.password_hash))
          return res.status(401).json({ error: 'No password set — use magic code to login' });
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      // Owner priority: if this email owns an account, treat it as the owner
      // even if a partner/team credential also exists for the same email
      // (mirrors auth.js isOwnerAccount override).
      const { rows: accRows } = await rawQuery(
        'SELECT id FROM accounts WHERE lower(email) = lower($1)', [email]
      );
      const isOwnerAccount = accRows.length > 0;

      // Email verification gate (mirrors auth.js). Self-signup creates an
      // UNVERIFIED credential before the OTP step; such a user must not be able
      // to log in yet (they'd get a broken session with no tenant). If an
      // account already exists (imported/verified owners, team, partners) we
      // auto-verify a stale is_verified=false flag instead of blocking.
      if (!cred.is_verified) {
        if (isOwnerAccount || cred.is_team || cred.is_partner) {
          await rawQuery('UPDATE credentials SET is_verified = true WHERE id = $1 AND is_verified = false', [cred.id]);
        } else {
          return res.status(403).json({ error: 'Please verify your email before logging in. Check your inbox for the verification code.' });
        }
      }

      const isOwner   = isOwnerAccount || (!cred.is_team && !cred.is_partner);
      const isTeam    = !!cred.is_team && !isOwnerAccount;
      const isPartner = !!cred.is_partner && !isOwnerAccount;
      // For owners: tenantId = their own accounts.id. For team/partner: the
      // owner tenant their credential points at.
      const tenantId  = isOwner
        ? (accRows[0]?.id || cred.account_id || cred.id)
        : cred.account_id;

      const token = signJwt({ sub: cred.id, email: cred.email, tenantId, isOwner, isTeam, isPartner });

      return res.json({
        ok: true, token,
        accountId: tenantId,
        credentialId: cred.id,
        email: cred.email,
        isOwner, isTeam, isPartner,
      });
    } catch (e) {
      console.error('[auth-pg] login error:', e.message);
      return res.status(500).json({ error: 'Login failed' });
    }
  }

  // ── action: send-code (magic code) ──────────────────────────────
  if (action === 'send-code') {
    if (!email) return res.status(400).json({ error: 'email required' });

    // Check email exists
    const { rows } = await rawQuery(
      'SELECT id FROM credentials WHERE lower(email) = lower($1)', [email]
    );
    if (!rows.length)
      return res.status(404).json({ error: 'No account found for this email' });

    // Rate limit: 1 per 60s
    if (!checkSendRate(email))
      return res.status(429).json({ error: 'Please wait 60 seconds before requesting another code' });

    // Generate 6-digit code, hash it
    const code = String(Math.floor(100000 + Math.random() * 900000));
    const codeHash = crypto.createHash('sha256').update(code).digest('hex');
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    // Invalidate any previous unused codes for this email
    await rawQuery(
      "UPDATE login_codes SET used = true WHERE email = $1 AND used = false AND expires_at > now()",
      [email]
    );

    // Store new code
    await rawQuery(
      'INSERT INTO login_codes (email, code_hash, expires_at) VALUES ($1, $2, $3)',
      [email, codeHash, expiresAt]
    );

    // Get brand name from global_settings for the email
    let brandName = 'T2GCRM';
    try {
      const gs = await rawQuery('SELECT doc FROM global_settings LIMIT 1');
      brandName = gs.rows[0]?.doc?.brandName || 'T2GCRM';
    } catch {}

    // Send email
    await sendMagicCodeEmail(email, code, brandName);

    return res.json({ ok: true, message: 'Code sent to your email' });
  }

  // ── action: verify-code (magic code) ────────────────────────────
  if (action === 'verify-code') {
    if (!email || !code)
      return res.status(400).json({ error: 'email and code required' });

    // Find the latest valid unused code for this email
    const { rows: codeRows } = await rawQuery(
      `SELECT id, code_hash, attempts FROM login_codes
       WHERE email = $1 AND used = false AND expires_at > now()
       ORDER BY created_at DESC LIMIT 1`,
      [email]
    );

    if (!codeRows.length)
      return res.status(400).json({ error: 'Code expired or not found. Request a new one.' });

    const codeRow = codeRows[0];

    // Max 5 attempts
    if (codeRow.attempts >= 5) {
      await rawQuery('UPDATE login_codes SET used = true WHERE id = $1', [codeRow.id]);
      return res.status(400).json({ error: 'Too many attempts. Request a new code.' });
    }

    // Verify
    const inputHash = crypto.createHash('sha256').update(String(code).trim()).digest('hex');
    const valid = crypto.timingSafeEqual(
      Buffer.from(inputHash), Buffer.from(codeRow.code_hash)
    );

    if (!valid) {
      await rawQuery('UPDATE login_codes SET attempts = attempts + 1 WHERE id = $1', [codeRow.id]);
      const remaining = 4 - codeRow.attempts;
      return res.status(400).json({ error: `Incorrect code. ${remaining} attempt(s) remaining.` });
    }

    // Mark used
    await rawQuery('UPDATE login_codes SET used = true WHERE id = $1', [codeRow.id]);

    // Get credential. Same duplicate-credential guard as password login: an
    // email may (wrongly) have multiple rows; the code was verified against
    // the EMAIL, so pick the owner (non-team/non-partner) credential when
    // several exist rather than an arbitrary rows[0] — otherwise an owner with
    // a stray partner credential lands in the partner portal after a magic-code
    // login too.
    const { rows: credRows } = await rawQuery(
      'SELECT id, email, is_team, is_partner, account_id FROM credentials WHERE lower(email) = lower($1)',
      [email]
    );
    if (!credRows.length) return res.status(404).json({ error: 'Account not found' });
    const cred = credRows.find(c => !c.is_team && !c.is_partner) || credRows[0];

    // Mark verified if not already
    await rawQuery(
      'UPDATE credentials SET is_verified = true WHERE id = $1 AND is_verified = false',
      [cred.id]
    );

    // Owner priority: an email that owns an account is the owner even if a
    // partner/team credential also exists (mirrors the password-login path).
    const { rows: accRows } = await rawQuery(
      'SELECT id FROM accounts WHERE lower(email) = lower($1)', [email]
    );
    const isOwnerAccount = accRows.length > 0;
    const isOwner   = isOwnerAccount || (!cred.is_team && !cred.is_partner);
    const isTeam    = !!cred.is_team && !isOwnerAccount;
    const isPartner = !!cred.is_partner && !isOwnerAccount;
    const tenantId  = isOwner
      ? (accRows[0]?.id || cred.account_id || cred.id)
      : cred.account_id;

    const token = signJwt({ sub: cred.id, email: cred.email, tenantId, isOwner, isTeam, isPartner });

    return res.json({
      ok: true, token,
      accountId: tenantId,
      credentialId: cred.id,
      email: cred.email,
      isOwner, isTeam, isPartner,
    });
  }

  // ── action: change-password (self change / admin set) ───────────
  // Mirrors /api/auth change-password on the PG `credentials` table.
  if (action === 'change-password') {
    if (!email || !newPassword) return res.status(400).json({ error: 'Required fields missing' });
    try {
      const hash = await bcrypt.hash(newPassword, 10);
      const { rows } = await rawQuery('SELECT id FROM credentials WHERE lower(email) = lower($1)', [email]);
      if (rows.length) {
        await rawQuery(
          "UPDATE credentials SET password_hash = $1, is_verified = true, doc = (doc - 'resetCode' - 'resetExpires') WHERE id = $2",
          [hash, rows[0].id]
        );
      } else {
        if (!userId) return res.status(400).json({ error: 'userId required to create credentials' });
        await rawQuery(
          "INSERT INTO credentials (id, email, password_hash, is_verified, is_team, is_partner, account_id, doc, created_at) VALUES (gen_random_uuid(), $1, $2, true, false, false, $3, '{}'::jsonb, now())",
          [email, hash, String(userId)]
        );
      }
      return res.status(200).json({ success: true, message: 'Password updated' });
    } catch (e) {
      console.error('[auth-pg] change-password error:', e.message);
      return res.status(500).json({ error: 'Password update failed' });
    }
  }

  // ── action: reset-password-request (generate OTP, email it) ──────
  // Stores resetCode/resetExpires in credentials.doc (mirrors the InstantDB
  // resetCode/resetExpires fields). The OTP is emailed directly — it must
  // NEVER be returned in the response (that would let anyone who knows an
  // email address fetch the reset code and take over the account).
  if (action === 'reset-password-request') {
    if (!email) return res.status(400).json({ error: 'Email required' });
    try {
      const otp = String(Math.floor(100000 + Math.random() * 900000));
      const expires = Date.now() + 15 * 60 * 1000;
      const { rows } = await rawQuery('SELECT id FROM credentials WHERE lower(email) = lower($1)', [email]);
      if (rows.length) {
        await rawQuery(
          "UPDATE credentials SET doc = doc || jsonb_build_object('resetCode', $1::text, 'resetExpires', $2::bigint) WHERE id = $3",
          [otp, expires, rows[0].id]
        );
      } else {
        // No credential yet — allow owners (present in accounts) to bootstrap.
        const { rows: acc } = await rawQuery('SELECT id FROM accounts WHERE lower(email) = lower($1)', [email]);
        if (!acc.length) return res.status(404).json({ error: 'User not found' });
        await rawQuery(
          "INSERT INTO credentials (id, email, password_hash, is_verified, is_team, is_partner, account_id, doc, created_at) VALUES (gen_random_uuid(), $1, '', true, false, false, $2, jsonb_build_object('resetCode', $3::text, 'resetExpires', $4::bigint), now())",
          [email, acc[0].id, otp, expires]
        );
      }
      let brandName = 'T2GCRM';
      try {
        const gs = await rawQuery('SELECT doc FROM global_settings LIMIT 1');
        brandName = gs.rows[0]?.doc?.brandName || 'T2GCRM';
      } catch {}
      await sendOtpEmail(email, otp, brandName, {
        subject: `Your ${brandName} password reset code`,
        heading: 'Your password reset code',
        blurb: 'Use this code to reset your password:',
      });
      return res.status(200).json({ success: true, message: 'If this email exists, a reset code has been sent.' });
    } catch (e) {
      console.error('[auth-pg] reset-password-request error:', e.message);
      return res.status(500).json({ error: 'Reset request failed' });
    }
  }

  // ── action: reset-password-verify ───────────────────────────────
  if (action === 'reset-password-verify') {
    if (!email || !code || !newPassword) return res.status(400).json({ error: 'Required fields missing' });
    try {
      const { rows } = await rawQuery(
        "SELECT id, doc->>'resetCode' AS reset_code, (doc->>'resetExpires')::bigint AS reset_expires FROM credentials WHERE lower(email) = lower($1)",
        [email]
      );
      const cred = rows[0];
      if (!cred || !cred.reset_code || cred.reset_code !== String(code) || Date.now() > Number(cred.reset_expires))
        return res.status(400).json({ error: 'Invalid or expired code' });
      const hash = await bcrypt.hash(newPassword, 10);
      await rawQuery(
        "UPDATE credentials SET password_hash = $1, is_verified = true, doc = (doc - 'resetCode' - 'resetExpires') WHERE id = $2",
        [hash, cred.id]
      );
      return res.status(200).json({ success: true, message: 'Password updated' });
    } catch (e) {
      console.error('[auth-pg] reset-password-verify error:', e.message);
      return res.status(500).json({ error: 'Reset failed' });
    }
  }

  // ── action: set-team-password (admin sets a team member's password) ─
  // account_id MUST be the owner tenant — team_members has RLS and can't be
  // resolved at login, so the owner link lives on credentials.account_id.
  if (action === 'set-team-password') {
    if (!email || !password || !ownerUserId || !teamMemberId) return res.status(400).json({ error: 'Required fields missing' });
    try {
      // Email uniqueness: a team member's email must not already be an owner or partner.
      const cls = await classifyEmail(email);
      if (cls.isOwner) return res.status(409).json({ error: 'This email belongs to a business owner — use a different email for the team member.' });
      if (cls.isPartner) return res.status(409).json({ error: 'This email is already registered as a partner.' });

      const hash = await bcrypt.hash(password, 10);
      const { rows } = await rawQuery('SELECT id FROM credentials WHERE lower(email) = lower($1)', [email]);
      const existing = rows[0];
      if (existing) {
        await rawQuery(
          "UPDATE credentials SET password_hash = $1, is_team = true, is_verified = true, account_id = $2, doc = doc || jsonb_build_object('teamMemberId', $3::text, 'ownerUserId', $2::text) WHERE id = $4",
          [hash, String(ownerUserId), String(teamMemberId), existing.id]
        );
      } else {
        await rawQuery(
          "INSERT INTO credentials (id, email, password_hash, is_verified, is_team, is_partner, account_id, doc, created_at) VALUES (gen_random_uuid(), $1, $2, true, true, false, $3, jsonb_build_object('teamMemberId', $4::text, 'ownerUserId', $3::text), now())",
          [email, hash, String(ownerUserId), String(teamMemberId)]
        );
      }
      return res.status(200).json({ success: true, message: 'Password set' });
    } catch (e) {
      console.error('[auth-pg] set-team-password error:', e.message);
      return res.status(500).json({ error: 'Failed to set password' });
    }
  }

  // ── action: set-partner-password ────────────────────────────────
  if (action === 'set-partner-password') {
    if (!email || !password || !ownerUserId || !partnerId) return res.status(400).json({ error: 'Required fields missing' });
    try {
      // Email uniqueness: a partner's email must not already be an owner or team member.
      const cls = await classifyEmail(email);
      if (cls.isOwner) return res.status(409).json({ error: 'This email belongs to a business owner — use a different email.' });
      if (cls.isTeam) return res.status(409).json({ error: 'This email is already registered as a team member.' });

      const hash = await bcrypt.hash(password, 10);
      const { rows } = await rawQuery('SELECT id FROM credentials WHERE lower(email) = lower($1)', [email]);
      const existing = rows[0];
      if (existing) {
        await rawQuery(
          "UPDATE credentials SET password_hash = $1, is_partner = true, is_verified = true, account_id = $2, doc = doc || jsonb_build_object('partnerId', $3::text, 'ownerUserId', $2::text) WHERE id = $4",
          [hash, String(ownerUserId), String(partnerId), existing.id]
        );
      } else {
        await rawQuery(
          "INSERT INTO credentials (id, email, password_hash, is_verified, is_team, is_partner, account_id, doc, created_at) VALUES (gen_random_uuid(), $1, $2, true, false, true, $3, jsonb_build_object('partnerId', $4::text, 'ownerUserId', $3::text), now())",
          [email, hash, String(ownerUserId), String(partnerId)]
        );
      }
      return res.status(200).json({ success: true, message: 'Partner password set' });
    } catch (e) {
      console.error('[auth-pg] set-partner-password error:', e.message);
      return res.status(500).json({ error: 'Failed to set partner password' });
    }
  }

  // ── action: delete-partner-credentials ──────────────────────────
  if (action === 'delete-partner-credentials') {
    if (!email) return res.status(400).json({ error: 'Email required' });
    try {
      const { rows } = await rawQuery(
        'DELETE FROM credentials WHERE lower(email) = lower($1) AND is_partner = true RETURNING id',
        [email]
      );
      return res.status(200).json({ success: true, message: `Deleted ${rows.length} credential(s)` });
    } catch (e) {
      console.error('[auth-pg] delete-partner-credentials error:', e.message);
      return res.status(500).json({ error: 'Failed to delete credentials' });
    }
  }

  // ── action: register (public self-signup, PG) ───────────────────
  // Creates an UNVERIFIED owner credential and emails a 6-digit OTP. The
  // accounts (tenant) row is created on verify-otp — so an abandoned signup
  // leaves only a throwaway unverified credential, never a half-built tenant.
  if (action === 'register') {
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
    try {
      const { rows: acc } = await rawQuery('SELECT id FROM accounts WHERE lower(email) = lower($1)', [email]);
      if (acc.length) return res.status(400).json({ error: 'User already exists' });
      const { rows: existing } = await rawQuery('SELECT id, is_verified FROM credentials WHERE lower(email) = lower($1)', [email]);
      if (existing[0]?.is_verified) return res.status(400).json({ error: 'User already exists' });

      const { fullName = '', bizName = '', phone = '', selectedPlan } = req.body || {};
      const hash = await bcrypt.hash(password, 10);
      const otp = String(Math.floor(100000 + Math.random() * 900000));
      const otpExpires = Date.now() + 15 * 60 * 1000;
      const regDoc = { otp, otpExpires, fullName, bizName, phone, selectedPlan: selectedPlan || 'Trial' };

      if (existing[0]?.id) {
        await rawQuery(
          "UPDATE credentials SET password_hash = $1, is_verified = false, is_team = false, is_partner = false, doc = doc || $2::jsonb WHERE id = $3",
          [hash, JSON.stringify(regDoc), existing[0].id]
        );
      } else {
        await rawQuery(
          "INSERT INTO credentials (id, email, password_hash, is_verified, is_team, is_partner, account_id, doc, created_at) VALUES (gen_random_uuid(), $1, $2, false, false, false, NULL, $3::jsonb, now())",
          [email, hash, JSON.stringify(regDoc)]
        );
      }

      let brandName = 'T2GCRM';
      try { const gs = await rawQuery('SELECT doc FROM global_settings LIMIT 1'); brandName = gs.rows[0]?.doc?.brandName || 'T2GCRM'; } catch {}
      await sendOtpEmail(email, otp, brandName, {
        subject: `Verify your ${brandName} account`,
        heading: 'Your verification code',
        blurb: 'Enter this code to verify your email and finish creating your account:',
      });
      return res.status(200).json({ success: true, message: 'Registration successful. Check your email for a verification code.' });
    } catch (e) {
      console.error('[auth-pg] register error:', e.message);
      return res.status(500).json({ error: 'Registration failed' });
    }
  }

  // ── action: verify-otp (finish self-signup, PG) ──────────────────
  // Verifies the registration OTP, creates the tenant (accounts) row on first
  // success, marks the credential verified, and returns a JWT so the new owner
  // is logged straight in.
  if (action === 'verify-otp') {
    const otpInput = req.body.otp || code;
    if (!email || !otpInput) return res.status(400).json({ error: 'Email and code are required' });
    try {
      const { rows } = await rawQuery('SELECT id, doc FROM credentials WHERE lower(email) = lower($1)', [email]);
      const cred = rows[0];
      if (!cred) return res.status(404).json({ error: 'Account not found' });
      const storedOtp = cred.doc?.otp;
      const otpExpires = Number(cred.doc?.otpExpires || 0);
      if (!storedOtp || String(storedOtp) !== String(otpInput).trim() || Date.now() > otpExpires) {
        return res.status(400).json({ error: 'Invalid or expired code' });
      }

      // Create the tenant row on first verification (idempotent if it exists).
      const { rows: accRows } = await rawQuery('SELECT id FROM accounts WHERE lower(email) = lower($1)', [email]);
      let accountId = accRows[0]?.id;
      if (!accountId) {
        accountId = crypto.randomUUID();
        const now = Date.now();
        const plan = cred.doc?.selectedPlan || 'Trial';
        const planExpiry = now + 7 * 24 * 60 * 60 * 1000; // 7-day trial
        const profileDoc = { userId: accountId, email, fullName: cred.doc?.fullName || '', bizName: cred.doc?.bizName || '', phone: cred.doc?.phone || '', plan, planExpiry, role: 'user', createdAt: now };
        await rawQuery(
          'INSERT INTO accounts (id, email, business_name, plan, doc, created_at, updated_at) VALUES ($1, $2, $3, $4, $5::jsonb, now(), now())',
          [accountId, email, cred.doc?.bizName || '', plan, JSON.stringify(profileDoc)]
        );
      }

      await rawQuery(
        "UPDATE credentials SET is_verified = true, account_id = $1, doc = (doc - 'otp' - 'otpExpires') WHERE id = $2",
        [accountId, cred.id]
      );

      const token = signJwt({ sub: cred.id, email, tenantId: accountId, isOwner: true, isTeam: false, isPartner: false });
      return res.status(200).json({ ok: true, success: true, token, accountId, credentialId: cred.id, email, isOwner: true, isTeam: false, isPartner: false });
    } catch (e) {
      console.error('[auth-pg] verify-otp error:', e.message);
      return res.status(500).json({ error: 'Verification failed' });
    }
  }

  // ── action: business-analytics (admin Business Report, PG) ───────
  // Per-tenant record counts + metadata. Uses one grouped count per table
  // (cheap) instead of the InstantDB per-tenant-per-table loop. counts keys
  // use the InstantDB collection names the admin UI already reads
  // (activityLogs, teamMembers, …) so no frontend change is needed.
  if (action === 'business-analytics') {
    try {
      const PG_TO_COLLECTION = {
        purchase_orders: 'purchaseOrders', ecom_customers: 'ecomCustomers',
        executed_automations: 'executedAutomations', partner_applications: 'partnerApplications',
        partner_commissions: 'partnerCommissions', member_profiles: 'memberProfiles',
        team_members: 'teamMembers', ecom_settings: 'ecomSettings',
        appointment_settings: 'appointmentSettings', call_log_sync_state: 'callLogSyncState',
        activity_logs: 'activityLogs', call_logs: 'callLogs',
      };
      const accts = (await rawQuery('SELECT id, email, business_name, plan, doc FROM accounts')).rows;
      const tenantTables = (await rawQuery(
        "SELECT table_name FROM information_schema.columns WHERE column_name='tenant_id' AND table_schema='public'"
      )).rows.map(r => r.table_name);

      // Counts must be tenant-scoped: the tenant tables have RLS, so a plain
      // rawQuery (no tenant context) fail-closes to 0 rows. Instead run ONE
      // grouped count query PER tenant via tenantQuery (sets app.tenant_id so
      // RLS returns that tenant's rows) — a single UNION covers all tables plus
      // the 30-day recent-activity count. 1 query per tenant, not per table.
      const countSql = [
        ...tenantTables.map(t => `SELECT '${t}' AS tbl, count(*)::int AS n FROM ${t}`),
        "SELECT '__recent30' AS tbl, count(*)::int AS n FROM activity_logs WHERE created_at > now() - interval '30 days'",
      ].join(' UNION ALL ');

      const analytics = [];
      for (const a of accts) {
        const counts = {};
        let recentActivity = 0;
        try {
          const rows = (await tenantQuery(a.id, countSql)).rows;
          for (const r of rows) {
            if (r.tbl === '__recent30') { recentActivity = r.n; continue; }
            if (r.n > 0) counts[PG_TO_COLLECTION[r.tbl] || r.tbl] = r.n;
          }
        } catch (e) { /* tenant with a transient error → zeros, don't fail the whole report */ }
        const totalRecords = Object.values(counts).reduce((s, n) => s + n, 0);
        analytics.push({
          id: a.id, userId: a.id,
          email: a.email || a.doc?.email || '',
          bizName: a.business_name || a.doc?.bizName || '',
          plan: a.plan || a.doc?.plan || 'Trial',
          planExpiry: a.doc?.planExpiry || 0,
          createdAt: a.doc?.createdAt || 0,
          totalRecords, counts,
          recentActivity,
          teamSize: counts.teamMembers || 0,
        });
      }
      analytics.sort((x, y) => y.totalRecords - x.totalRecords);

      return res.status(200).json({ success: true, analytics });
    } catch (e) {
      console.error('[auth-pg] business-analytics error:', e.message);
      return res.status(500).json({ error: 'Analytics failed' });
    }
  }

  // ── action: admin-create-user (create a new business owner on PG) ─
  // Mirrors api/auth.js admin-create-user, but writes the tenant (accounts
  // row) + owner credential straight to Postgres. This is REQUIRED on the PG
  // stack: the normal userProfiles write path (data-pg.js) is UPDATE-only and
  // never inserts an accounts row, so without this a brand-new business had no
  // PG account or credential and could not log in at all (password OR magic
  // code — verify-code also 404s when no credential row exists).
  if (action === 'admin-create-user') {
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });
    try {
      const { rows: accExisting } = await rawQuery('SELECT id FROM accounts WHERE lower(email) = lower($1)', [email]);
      if (accExisting.length) return res.status(400).json({ error: 'A business account with this email already exists' });
      const { rows: credExisting } = await rawQuery('SELECT id, is_verified FROM credentials WHERE lower(email) = lower($1)', [email]);
      if (credExisting[0]?.is_verified) return res.status(400).json({ error: 'User with this email already exists' });

      const { fullName = '', bizName = '', phone = '', selectedPlan, duration } = req.body || {};
      const plan = selectedPlan || 'Trial';
      const now = Date.now();
      const planExpiry = now + (Number(duration) || 7) * 24 * 60 * 60 * 1000;
      const accountId = crypto.randomUUID(); // = tenant id (userProfiles.userId)
      const hash = await bcrypt.hash(password, 10);

      // accounts.doc mirrors the userProfiles shape the app reads back
      // ({ ...doc, id, userId }). Promoted columns (email/business_name/plan)
      // set explicitly to stay consistent with the doc.
      const profileDoc = { userId: accountId, email, fullName, bizName, phone, plan, planExpiry, role: 'user', createdAt: now };
      await rawQuery(
        `INSERT INTO accounts (id, email, business_name, plan, doc, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, now(), now())`,
        [accountId, email, bizName, plan, JSON.stringify(profileDoc)]
      );

      // Owner credential — verified, non-team/non-partner.
      if (credExisting[0]?.id) {
        await rawQuery(
          `UPDATE credentials SET password_hash = $1, is_verified = true, is_team = false, is_partner = false, account_id = $2 WHERE id = $3`,
          [hash, accountId, credExisting[0].id]
        );
      } else {
        await rawQuery(
          `INSERT INTO credentials (id, email, password_hash, is_verified, is_team, is_partner, account_id, doc, created_at)
           VALUES (gen_random_uuid(), $1, $2, true, false, false, $3, '{}'::jsonb, now())`,
          [email, hash, accountId]
        );
      }

      return res.status(200).json({ success: true, message: `Business "${bizName || email}" created successfully`, userId: accountId });
    } catch (e) {
      console.error('[auth-pg] admin-create-user error:', e.message);
      return res.status(500).json({ error: 'Failed to create business' });
    }
  }

  // ── action: admin-delete-user (hard-delete a business + all its data) ─
  // PG mirror of api/auth.js admin-delete-user. Deletes every tenant table
  // row (tenant_id = the business), the owner + team + partner credentials,
  // and the accounts (tenant) row itself — all in ONE tenant-scoped
  // transaction so a mid-way failure rolls back instead of half-deleting.
  if (action === 'admin-delete-user') {
    const targetUserId = req.body.targetUserId || req.body.profileId;
    if (!targetUserId) return res.status(400).json({ error: 'targetUserId (business id) is required' });
    try {
      // Gather team/partner emails first (RLS tables — need tenant context) so
      // their login credentials get removed too.
      const teamRows = (await tenantQuery(targetUserId,
        "SELECT lower(doc->>'email') AS email FROM team_members WHERE tenant_id = $1", [targetUserId])).rows;
      const partnerRows = (await tenantQuery(targetUserId,
        "SELECT lower(doc->>'email') AS email FROM partner_applications WHERE tenant_id = $1", [targetUserId])).rows;

      // Every tenant-scoped table (auto-discovered so new tables are covered).
      const tenantTables = (await rawQuery(
        "SELECT table_name FROM information_schema.columns WHERE column_name='tenant_id' AND table_schema='public'"
      )).rows.map(r => r.table_name);

      const queries = [];
      // 1. all tenant data (RLS-scoped by the tenant context set below)
      for (const t of tenantTables) {
        queries.push({ sql: `DELETE FROM ${t} WHERE tenant_id = $1`, params: [targetUserId] });
      }
      // 2. credentials for owner + team + partners (credentials has no RLS)
      const emails = [...new Set([
        (req.body.ownerEmail || '').trim().toLowerCase(),
        ...teamRows.map(r => r.email),
        ...partnerRows.map(r => r.email),
      ].filter(Boolean))];
      for (const em of emails) {
        queries.push({ sql: 'DELETE FROM credentials WHERE lower(email) = lower($1)', params: [em] });
      }
      // 3. the tenant (accounts) row itself
      queries.push({ sql: 'DELETE FROM accounts WHERE id = $1', params: [targetUserId] });

      const results = await tenantTransaction(targetUserId, queries);
      const deletedCount = results.reduce((s, r) => s + (r.rowCount || 0), 0);
      return res.status(200).json({ success: true, message: `Business deleted. ${deletedCount} records removed.`, deletedCount });
    } catch (e) {
      console.error('[auth-pg] admin-delete-user error:', e.message);
      return res.status(500).json({ error: 'Failed to delete business' });
    }
  }

  return res.status(400).json({ error: 'Unknown action' });
}
