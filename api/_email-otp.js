import nodemailer from 'nodemailer';

// Shared OTP-email sender for both auth backends (InstantDB api/auth.js and
// Postgres api/auth-pg.js) — registration verification + password reset.
//
// Previously these OTPs were only ever returned in the API JSON response and
// console.log'd on the frontend ("Dev Mode" leftovers) — real end users in
// production never saw their code, so registration and password reset could
// never actually complete for them. This sends the code by real email, and
// callers must stop echoing the raw code back in the response (returning it
// let anyone reset any account's password just by knowing the email).
function getSystemSmtp() {
  const host = process.env.SYSTEM_SMTP_HOST;
  const port = parseInt(process.env.SYSTEM_SMTP_PORT || '587');
  const user = process.env.SYSTEM_SMTP_USER;
  const pass = process.env.SYSTEM_SMTP_PASS;
  const from = process.env.SYSTEM_SMTP_FROM || process.env.SYSTEM_SMTP_USER;
  if (!host || !user || !pass) return null;
  return { host, port, user, pass, from };
}

// opts: { subject, heading, blurb }
export async function sendOtpEmail(email, code, brandName, opts = {}) {
  const smtp = getSystemSmtp();
  if (!smtp) {
    // Local/dev fallback when SYSTEM_SMTP isn't configured — logged server-side
    // only (never exposed to the client).
    console.warn(`[auth] System SMTP not configured — OTP email not sent to ${email}. Code: ${code}`);
    return false;
  }
  const brand = brandName || 'T2GCRM';
  const heading = opts.heading || 'Your verification code';
  const blurb = opts.blurb || `${heading}:`;
  const transporter = nodemailer.createTransport({
    host: smtp.host, port: smtp.port,
    secure: smtp.port === 465,
    auth: { user: smtp.user, pass: smtp.pass },
    tls: { rejectUnauthorized: false },
  });
  await transporter.sendMail({
    from: smtp.from ? `"${brand}" <${smtp.from}>` : smtp.user,
    to: email,
    subject: opts.subject || `Your code for ${brand}`,
    text: `${heading}: ${code}\n\nThis code will expire shortly. Do not share it with anyone.`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px">
        <h2 style="margin:0 0 8px">${brand}</h2>
        <p style="color:#64748b;margin:0 0 24px">${blurb}</p>
        <div style="font-size:36px;font-weight:700;letter-spacing:8px;color:#0f172a;
                    background:#f1f5f9;padding:16px 24px;border-radius:8px;
                    display:inline-block;margin-bottom:24px">${code}</div>
        <p style="color:#64748b;font-size:14px">This code will expire shortly. Do not share it with anyone.</p>
      </div>`,
  });
  return true;
}
