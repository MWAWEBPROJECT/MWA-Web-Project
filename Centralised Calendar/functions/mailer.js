// Booking mail uses the existing admin Gmail OAuth connection in _enquiryPrivate/mailbox.
// Existing SMTP secret definitions stay bound for release compatibility; no shared
// SMTP credential is rotated or used as an ambiguous-delivery fallback.
// TLS transport utilities remain tested for legacy consumers.
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
async function sendMail({ to, cc, replyTo = DEFAULT_REPLY_TO, subject, text, html, attachments }, {notAfter} = {}) {
  if (!to) return { sent: false, reason: 'no-recipient' };
  try {
    const result=await require('./gmailBookingMail').sendBookingGmail({to,cc,replyTo,subject,text,html,attachments},{notAfter});
    if(!result.sent)logger.warn('[email] Booking Gmail delivery unavailable',{reason:result.reason});
    return result;
  } catch {
    logger.error('[email] Booking Gmail delivery outcome requires review');
    return {sent:false,reason:'send-error'};
  }
}

const transportOptions=(host,port,user,pass)=>smtpTransportOptions({host,port,user,pass});
module.exports = { transportOptions, sendMail, sendAll, emailSecrets, smtpTransportOptions, sendWithTransport };
