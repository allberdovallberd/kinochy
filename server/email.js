import nodemailer from 'nodemailer';
import http from 'node:http';
import https from 'node:https';

export async function sendVerificationEmail({ email, username, code }) {
  const smtpConfig = getSmtpConfig();
  const apiKey = String(process.env.BREVO_API_KEY || '').trim();
  const provider = String(process.env.EMAIL_PROVIDER || '').trim().toLowerCase();

  if ((provider === 'gmail' || provider === 'smtp') && smtpConfig) {
    return sendViaSmtp({ email, username, code, smtpConfig });
  }

  if (apiKey && provider !== 'smtp' && provider !== 'gmail') {
    try {
      return await sendViaBrevoApi({ email, username, code, apiKey });
    } catch (error) {
      if (!smtpConfig) throw normalizeBrevoApiError(error);
    }
  }
  if (smtpConfig) return sendViaSmtp({ email, username, code, smtpConfig });

  const error = new Error('Email verification is not configured. Set BREVO_API_KEY, Gmail SMTP settings, or generic SMTP settings.');
  error.status = 503;
  throw error;
}

function getSmtpConfig() {
  const gmailUser = String(process.env.GMAIL_SMTP_USER || '').trim();
  const gmailPassword = String(process.env.GMAIL_APP_PASSWORD || process.env.GMAIL_SMTP_PASSWORD || '').trim();
  if (gmailUser && gmailPassword) {
    return {
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      user: gmailUser,
      pass: gmailPassword,
      senderEmail: process.env.EMAIL_SENDER_EMAIL || process.env.GMAIL_SENDER_EMAIL || gmailUser,
      senderName: process.env.EMAIL_SENDER_NAME || process.env.GMAIL_SENDER_NAME || 'Kinochy'
    };
  }

  const genericHost = String(process.env.SMTP_HOST || '').trim();
  const genericUser = String(process.env.SMTP_USER || '').trim();
  const genericPassword = String(process.env.SMTP_PASSWORD || '').trim();
  if (genericHost && genericUser && genericPassword) {
    const port = Number(process.env.SMTP_PORT || 587);
    return {
      host: genericHost,
      port,
      secure: String(process.env.SMTP_SECURE || '').toLowerCase() === 'true' || port === 465,
      user: genericUser,
      pass: genericPassword,
      senderEmail: process.env.EMAIL_SENDER_EMAIL || process.env.SMTP_SENDER_EMAIL || genericUser,
      senderName: process.env.EMAIL_SENDER_NAME || process.env.SMTP_SENDER_NAME || 'Kinochy'
    };
  }

  const brevoSmtpKey = String(process.env.BREVO_SMTP_KEY || process.env.BREVO_SMTP_PASSWORD || '').trim();
  if (brevoSmtpKey) {
    const senderEmail = process.env.BREVO_SENDER_EMAIL || process.env.EMAIL_SENDER_EMAIL || 'allberdovallberd@gmail.com';
    const smtpPort = Number(process.env.BREVO_SMTP_PORT || 587);
    return {
      host: process.env.BREVO_SMTP_HOST || 'smtp-relay.brevo.com',
      port: smtpPort,
      secure: smtpPort === 465,
      user: process.env.BREVO_SMTP_LOGIN || senderEmail,
      pass: brevoSmtpKey,
      senderEmail,
      senderName: process.env.BREVO_SENDER_NAME || process.env.EMAIL_SENDER_NAME || 'Allberdov Allberd'
    };
  }

  return null;
}

async function sendViaSmtp({ email, username, code, smtpConfig }) {
  const transport = nodemailer.createTransport({
    host: smtpConfig.host,
    port: smtpConfig.port,
    secure: smtpConfig.secure,
    auth: {
      user: smtpConfig.user,
      pass: smtpConfig.pass
    }
  });

  try {
    return await transport.sendMail({
      from: `"${smtpConfig.senderName}" <${smtpConfig.senderEmail}>`,
      to: `"${username || email}" <${email}>`,
      subject: 'Your Kinochy verification code',
      html: getVerificationHtml(code)
    });
  } catch (err) {
    const message = String(err?.message || '');
    const normalized = message.toLowerCase();
    const authFailed =
      normalized.includes('authentication failed') ||
      normalized.includes('invalid login') ||
      normalized.includes('535');
    const activationLike =
      normalized.includes('not activated') ||
      normalized.includes('not authorized') ||
      normalized.includes('unauthorized');

    const error = new Error(
      authFailed
        ? 'SMTP authentication failed. Check Gmail app password or SMTP login/password settings.'
        : activationLike
        ? 'SMTP sending is not activated or the sender is not authorized.'
        : `SMTP email failed: ${message || 'Unknown SMTP error'}`
    );
    error.status = 503;
    throw error;
  }
}

async function sendViaBrevoApi({ email, username, code, apiKey }) {
  const apiUrls = getBrevoApiUrls();
  const timeoutMs = Number(process.env.BREVO_TIMEOUT_MS || 45000);
  const ipFamily = Number(process.env.BREVO_IP_FAMILY || 4);
  const payload = {
    sender: {
      name: process.env.BREVO_SENDER_NAME || 'Allberdov Allberd',
      email: process.env.BREVO_SENDER_EMAIL || 'allberdovallberd@gmail.com'
    },
    to: [{ email, name: username || email }],
    subject: 'Your Kinochy verification code',
    htmlContent: getVerificationHtml(code)
  };

  const response = await postWithFallback(apiUrls, payload, {
    attempts: 2,
    timeoutMs,
    family: ipFamily,
    headers: {
      accept: 'application/json',
      'api-key': apiKey,
      'content-type': 'application/json'
    }
  });

  if (response.status < 200 || response.status >= 300) {
    const message = response.text.includes('SMTP account is not yet activated')
      ? 'Brevo transactional sending is not activated yet. Activate sender and transactional access in Brevo.'
      : `Brevo email failed: ${response.text}`;
    const error = new Error(message);
    error.status = 503;
    throw error;
  }

  return response.text ? JSON.parse(response.text) : {};
}

function getBrevoApiUrls() {
  const explicit = String(process.env.BREVO_API_URLS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (explicit.length) return explicit;

  const primary = process.env.BREVO_API_URL || 'https://api.brevo.com/v3/smtp/email';
  return [...new Set([primary, 'https://api.sendinblue.com/v3/smtp/email'])];
}

function normalizeBrevoApiError(error) {
  const message = String(error?.message || '');
  const causeCode = String(error?.cause?.code || error?.code || '');
  const combined = `${message} ${causeCode}`.toLowerCase();
  const normalized = new Error(
    combined.includes('timeout') || combined.includes('econnreset') || combined.includes('enotfound') || combined.includes('eai_again')
      ? 'Brevo API is unreachable from this server right now. Check outbound HTTPS access to api.brevo.com, or add BREVO_SMTP_LOGIN and BREVO_SMTP_KEY to use SMTP fallback.'
      : `Brevo email failed: ${message || 'Unknown API error'}`
  );
  normalized.status = 503;
  throw normalized;
}

function postJson(target, payload, options = {}) {
  const url = new URL(target);
  const body = JSON.stringify(payload);
  const transport = url.protocol === 'http:' ? http : https;

  return new Promise((resolve, reject) => {
    const request = transport.request(
      url,
      {
        method: 'POST',
        family: options.family || 4,
        timeout: options.timeoutMs || 45000,
        headers: {
          ...options.headers,
          'content-length': Buffer.byteLength(body)
        }
      },
      (response) => {
        let text = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          text += chunk;
        });
        response.on('end', () => {
          resolve({ status: response.statusCode || 0, text });
        });
      }
    );

    request.on('timeout', () => {
      request.destroy(Object.assign(new Error('Brevo API request timed out.'), { code: 'ETIMEDOUT' }));
    });
    request.on('error', reject);
    request.write(body);
    request.end();
  });
}

async function retry(work, attempts) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await work();
    } catch (error) {
      lastError = error;
      if (attempt === attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 1200));
    }
  }
  throw lastError;
}

async function postWithFallback(urls, payload, options) {
  let lastError;
  for (const url of urls) {
    try {
      return await retry(() => postJson(url, payload, options), options.attempts || 2);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

function getVerificationHtml(code) {
  return `<div style="font-family:Arial,sans-serif;font-size:16px;color:#202326">
    <h2>Kinochy verification</h2>
    <p>Your verification code is:</p>
    <p style="font-size:32px;font-weight:700;letter-spacing:6px">${code}</p>
    <p>This code expires in 15 minutes.</p>
  </div>`;
}
