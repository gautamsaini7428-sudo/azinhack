'use strict';
const nodemailer = require('nodemailer');

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;

  const host = process.env.SMTP_HOST || (process.env.NODE_ENV === 'production' ? 'mailpit' : '127.0.0.1');
  const port = parseInt(process.env.SMTP_PORT || '1025', 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  const config = {
    host,
    port,
    secure: port === 465,
    ignoreTLS: port === 1025,
  };

  if (user && pass) {
    config.auth = { user, pass };
  }

  try {
    transporter = nodemailer.createTransport(config);
  } catch (err) {
    console.warn('[mailer] Could not initialize nodemailer transporter:', err.message);
  }

  return transporter;
}

/**
 * Send an email with graceful fallback
 */
async function sendMail({ to, subject, text, html }) {
  const from = process.env.ALERT_FROM_EMAIL || 'alerts@opportunityradar.dev';

  if (process.env.NODE_ENV === 'test') {
    return { ok: true, mocked: true, messageId: 'test-' + Date.now() };
  }

  const mailer = getTransporter();

  if (!mailer) {
    console.log(`[mailer] [MOCK EMAIL to ${to}]: ${subject}\n${text}`);
    return { ok: true, mocked: true };
  }

  try {
    const info = await mailer.sendMail({
      from,
      to,
      subject,
      text,
      html: html || `<p>${text}</p>`,
    });
    console.log(`[mailer] Email dispatched to ${to} (Message ID: ${info.messageId})`);
    return { ok: true, messageId: info.messageId };
  } catch (err) {
    console.warn(`[mailer] Failed to deliver email to ${to}: ${err.message}`);
    // Still return ok: false with error
    return { ok: false, error: err.message };
  }
}

module.exports = { sendMail, getTransporter };
