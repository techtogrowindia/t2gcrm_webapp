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
import { rawQuery } from './db-pg.js';

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

// ── Handler ───────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action, email: rawEmail, password, code } = req.body || {};
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
        'SELECT id, email, password_hash, is_verified, is_team, is_partner, account_id, doc FROM credentials WHERE email = $1',
        [email]
      );
      if (!rows.length) return res.status(401).json({ error: 'Invalid email or password' });
      const cred = rows[0];

      if (!cred.password_hash)
        return res.status(401).json({ error: 'No password set — use magic code to login' });

      const match = await bcrypt.compare(password, cred.password_hash);
      if (!match) return res.status(401).json({ error: 'Invalid email or password' });

      // Determine tenantId (accountId for owner; account_id for team/partner)
      const tenantId = cred.is_team || cred.is_partner
        ? cred.account_id
        : cred.id; // owner: credential id = userId = tenant id

      const token = signJwt({
        sub:      cred.id,
        email:    cred.email,
        tenantId,
        isOwner:  !cred.is_team && !cred.is_partner,
        isTeam:   !!cred.is_team,
        isPartner: !!cred.is_partner,
      });

      return res.json({
        ok: true, token,
        accountId: tenantId,
        credentialId: cred.id,
        email: cred.email,
        isOwner:  !cred.is_team && !cred.is_partner,
        isTeam:   !!cred.is_team,
        isPartner: !!cred.is_partner,
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
      'SELECT id FROM credentials WHERE email = $1', [email]
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

    // Get credential
    const { rows: credRows } = await rawQuery(
      'SELECT id, email, is_team, is_partner, account_id FROM credentials WHERE email = $1',
      [email]
    );
    if (!credRows.length) return res.status(404).json({ error: 'Account not found' });
    const cred = credRows[0];

    // Mark verified if not already
    await rawQuery(
      'UPDATE credentials SET is_verified = true WHERE id = $1 AND is_verified = false',
      [cred.id]
    );

    const tenantId = cred.is_team || cred.is_partner ? cred.account_id : cred.id;

    const token = signJwt({
      sub:      cred.id,
      email:    cred.email,
      tenantId,
      isOwner:  !cred.is_team && !cred.is_partner,
      isTeam:   !!cred.is_team,
      isPartner: !!cred.is_partner,
    });

    return res.json({
      ok: true, token,
      accountId: tenantId,
      credentialId: cred.id,
      email: cred.email,
      isOwner:  !cred.is_team && !cred.is_partner,
      isTeam:   !!cred.is_team,
      isPartner: !!cred.is_partner,
    });
  }

  return res.status(400).json({ error: 'Unknown action' });
}
