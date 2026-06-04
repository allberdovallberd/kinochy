import nodemailer from 'nodemailer';
import http from 'node:http';
import https from 'node:https';

export async function sendVerificationEmail({ email, username, code }) {
  const smtpKey = String(process.env.BREVO_SMTP_KEY || '').trim();
  const apiKey = String(process.env.BREVO_API_KEY || '').trim();
  if (apiKey) {
    try {
      return await sendViaBrevoApi({ email, username, code, apiKey });
    } catch (error) {
      if (!smtpKey) throw normalizeBrevoApiError(error);
    }
  }
  if (smtpKey) return sendViaBrevoSmtp({ email, username, code, smtpKey });

  const error = new Error('Brevo is not configured. Set BREVO_SMTP_KEY or BREVO_API_KEY.');
  error.status = 503;
  throw error;
}

async function sendViaBrevoSmtp({ email, username, code, smtpKey }) {
  const senderEmail = process.env.BREVO_SENDER_EMAIL || 'allberdovallberd@gmail.com';
  const senderName = process.env.BREVO_SENDER_NAME || 'Allberdov Allberd';
  const smtpLogin = process.env.BREVO_SMTP_LOGIN || senderEmail;
  const smtpPort = Number(process.env.BREVO_SMTP_PORT || 587);

  const transport = nodemailer.createTransport({
    host: process.env.BREVO_SMTP_HOST || 'smtp-relay.brevo.com',
    port: smtpPort,
    secure: smtpPort === 465,
    auth: {
      user: smtpLogin,
      pass: smtpKey
    }
  });

  try {
    return await transport.sendMail({
      from: `"${senderName}" <${senderEmail}>`,
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
        ? 'Brevo SMTP authentication failed. Check BREVO_SMTP_LOGIN and BREVO_SMTP_KEY from Brevo SMTP settings.'
        : activationLike
        ? 'Brevo SMTP sending is not activated yet. Verify sender and enable transactional SMTP access in Brevo.'
        : `Brevo SMTP email failed: ${message || 'Unknown SMTP error'}`
    );
    error.status = 503;
    throw error;
  }
}

async function sendViaBrevoApi({ email, username, code, apiKey }) {
  const apiUrl = process.env.BREVO_API_URL || 'https://api.brevo.com/v3/smtp/email';
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

  const response = await retry(async () => {
    return postJson(apiUrl, payload, {
      timeoutMs,
      family: ipFamily,
      headers: {
        accept: 'application/json',
        'api-key': apiKey,
        'content-type': 'application/json'
      }
    });
  }, 3);

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

function getVerificationHtml(code) {
  return `<div style="font-family:Arial,sans-serif;font-size:16px;color:#202326">
    <h2>Kinochy verification</h2>
    <p>Your verification code is:</p>
    <p style="font-size:32px;font-weight:700;letter-spacing:6px">${code}</p>
    <p>This code expires in 15 minutes.</p>
  </div>`;
}
