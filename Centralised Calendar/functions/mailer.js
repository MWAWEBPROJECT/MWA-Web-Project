// Email sending (Gmail / any SMTP via nodemailer).
//
// Message content and recipients live in notifications.js (docs/NOTIFICATIONS.md).
// This module defines the Cloud Functions *secrets* (set via
// `firebase functions:secrets:set`) and a `sendMail` helper that:
//   - sends nothing and logs a warning when secrets are unset (never throws,
//     never blocks a booking submission/decision), and
//   - sends via SMTP once SMTP_HOST/PORT/USER/PASS are set.
//
// See docs/EMAIL_SETUP.md for the configuration steps.
const { defineSecret } = require('firebase-functions/params');
const logger = require('firebase-functions/logger');
const nodemailer = require('nodemailer');

const SMTP_HOST = defineSecret('SMTP_HOST');
const SMTP_PORT = defineSecret('SMTP_PORT');
const SMTP_USER = defineSecret('SMTP_USER');
const SMTP_PASS = defineSecret('SMTP_PASS');
const EMAIL_FROM = defineSecret('EMAIL_FROM');

const DEFAULT_REPLY_TO = 'Events@muhammadiwelfare.org.au';

/** Send several messages (nulls skipped) without letting one failure stop the rest. */
async function sendAll(messages) {
  const out = [];
  for (const m of messages) if (m) out.push(await sendMail(m));
  return out;
}

const emailSecrets = [SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, EMAIL_FROM];

let cachedTransporter;
function smtpTransportOptions({ host, port, user, pass }) {
  const resolvedPort = Number(port || 587);
  if (![465, 587].includes(resolvedPort)) throw new Error('SMTP must use implicit TLS on port 465 or STARTTLS on port 587.');
  return {
    host,
    port: resolvedPort,
    secure: resolvedPort === 465,
    requireTLS: resolvedPort === 587,
    tls: { rejectUnauthorized: true },
    auth: { user, pass }
  };
}

function buildTransporter() {
  const host = SMTP_HOST.value();
  const user = SMTP_USER.value();
  const pass = SMTP_PASS.value();
  if (!host || !user || !pass) return null;
  if (cachedTransporter) return cachedTransporter;
  cachedTransporter = nodemailer.createTransport(smtpTransportOptions({
    host, port: SMTP_PORT.value(), user, pass
  }));
  return cachedTransporter;
}

async function sendWithTransport(transporter, message, from, logger) {
  try {
    await transporter.sendMail({ from, ...message });
    return { sent: true };
  } catch (err) {
    logger.error('[email] Send failed', { to: message.to, subject: message.subject, error: String(err) });
    return { sent: false, reason: 'send-error' };
  }
}

/** Best-effort send. Resolves to {sent:boolean, reason?} — never throws. */
async function sendMail({ to, cc, replyTo = DEFAULT_REPLY_TO, subject, text, html, attachments }) {
  if (!to) return { sent: false, reason: 'no-recipient' };
  try {
    const transporter = buildTransporter();
    if (!transporter) {
      logger.warn('[email] Not configured — skipping send.', { to, subject });
      return { sent: false, reason: 'not-configured' };
    }
    const from = EMAIL_FROM.value() || SMTP_USER.value();
    return await sendWithTransport(transporter, { to, cc, replyTo, subject, text, html, attachments }, from, logger);
  } catch (err) {
    logger.error('[email] Transport configuration failed', { to, subject, error: String(err) });
    return { sent: false, reason: 'send-error' };
  }
}

module.exports = { sendMail, sendAll, emailSecrets, smtpTransportOptions, sendWithTransport };
