'use strict';
/**
 * Alert pipeline
 * Sends alerts via in-app (DB), email (nodemailer/Mailpit), and Telegram.
 * Respects per-user alert settings.
 */

const https = require('https');
const db = require('./db');
const { sendMail } = require('./mailer');

// ── Telegram helper ───────────────────────────────────────────────────────────
function sendTelegram(message, customChatId = null) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = customChatId || process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return Promise.resolve(null);
  const body = JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'HTML' });
  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'api.telegram.org',
      path: `/bot${token}/sendMessage`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => { res.resume(); resolve(res.statusCode); });
    req.on('error', () => resolve(null));
    req.write(body); req.end();
  });
}

/**
 * Send an alert to all channels for all users watching an opportunity.
 */
async function sendAlert({ opportunityId, changeId, changeType, explanation, sourceLink, beforeData, afterData }) {
  // Find all users watching this opportunity
  const watchersRes = await db.query(
    `SELECT u.id AS user_id, u.email, p.name,
            COALESCE(s.email_enabled, TRUE) AS email_enabled,
            COALESCE(s.telegram_enabled, FALSE) AS telegram_enabled,
            s.telegram_chat_id,
            s.frequency
     FROM watchlist w
     JOIN users u ON u.id = w.user_id
     LEFT JOIN user_profiles p ON p.user_id = u.id
     LEFT JOIN user_alert_settings s ON s.user_id = u.id
     WHERE w.opportunity_id = $1`,
    [opportunityId]
  );
  const watchers = watchersRes.rows;

  // Also get the opportunity title for the message
  const oppRes = await db.queryOne('SELECT title, apply_link FROM opportunities WHERE id = $1', [opportunityId]);
  const title = oppRes?.title || 'Opportunity';
  const applyLink = sourceLink || oppRes?.apply_link || '';

  const message = buildMessage(changeType, explanation, title, applyLink);

  for (const watcher of watchers) {
    // In-app alert (always created for the watcher)
    await db.query(
      `INSERT INTO alerts (user_id, change_id, opportunity_id, channel, message, sent_at)
       VALUES ($1, $2, $3, 'in-app', $4, NOW())`,
      [watcher.user_id, changeId, opportunityId, message]
    );

    // Email alert (only if enabled by user)
    if (watcher.email_enabled && watcher.email) {
      try {
        const mailRes = await sendMail({
          to: watcher.email,
          subject: `OpportunityRadar: ${changeType.replace(/_/g, ' ')} – ${title}`,
          text: message,
          html: buildHtmlEmail(changeType, explanation, title, applyLink, beforeData, afterData),
        });
        if (mailRes.ok) {
          await db.query(
            `INSERT INTO alerts (user_id, change_id, opportunity_id, channel, message, sent_at)
             VALUES ($1, $2, $3, 'email', $4, NOW())`,
            [watcher.user_id, changeId, opportunityId, message]
          );
        }
      } catch (e) {
        console.warn('[alerts] Email failed:', e.message);
      }
    }

    // Telegram alert (if enabled by user or global token)
    if (watcher.telegram_enabled && (watcher.telegram_chat_id || process.env.TELEGRAM_CHAT_ID)) {
      const tgCode = await sendTelegram(
        `<b>OpportunityRadar Alert</b>\n${message}`,
        watcher.telegram_chat_id
      );
      if (tgCode === 200) {
        await db.query(
          `INSERT INTO alerts (user_id, change_id, opportunity_id, channel, message, sent_at)
           VALUES ($1, $2, $3, 'telegram', $4, NOW())`,
          [watcher.user_id, changeId, opportunityId, message]
        );
      }
    }
  }

  if (watchers.length === 0) {
    console.log(`[alerts] ${changeType}: ${explanation} | No active watchers.`);
  }
}

function buildMessage(changeType, explanation, title, applyLink) {
  return [
    `[${changeType.replace(/_/g, ' ')}] ${title}`,
    explanation,
    applyLink ? `Apply: ${applyLink}` : '',
  ].filter(Boolean).join('\n');
}

function buildHtmlEmail(changeType, explanation, title, applyLink, before, after) {
  return `
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:600px;margin:auto;padding:24px;background:#F6F3EC;color:#1B1B18;">
  <div style="background:#FFFFFF;border:1px solid #E2DDD0;border-radius:8px;padding:24px;">
    <span style="display:inline-block;padding:4px 8px;background:#EFEBE1;color:#1F4D3A;border:1px solid #E2DDD0;border-radius:4px;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">
      ${changeType.replace(/_/g, ' ')}
    </span>
    <h2 style="color:#1F4D3A;margin:12px 0 6px 0;font-size:20px;">${title}</h2>
    <p style="color:#6B6A63;font-size:15px;line-height:1.5;margin-top:0;">${explanation}</p>
    ${before ? `<div style="background:#FAF9F6;border-left:3px solid #C4572F;padding:10px 14px;margin:12px 0;border-radius:0 4px 4px 0;">
      <strong style="color:#C4572F;font-size:12px;text-transform:uppercase;">Before:</strong>
      <pre style="color:#1B1B18;font-size:12px;white-space:pre-wrap;margin:4px 0 0 0;">${JSON.stringify(before, null, 2)}</pre>
    </div>` : ''}
    ${after ? `<div style="background:#FAF9F6;border-left:3px solid #1F4D3A;padding:10px 14px;margin:12px 0;border-radius:0 4px 4px 0;">
      <strong style="color:#1F4D3A;font-size:12px;text-transform:uppercase;">After:</strong>
      <pre style="color:#1B1B18;font-size:12px;white-space:pre-wrap;margin:4px 0 0 0;">${JSON.stringify(after, null, 2)}</pre>
    </div>` : ''}
    ${applyLink ? `<a href="${applyLink}" style="display:inline-block;margin-top:16px;background:#1F4D3A;color:#FFFFFF;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:500;">View Opportunity</a>` : ''}
  </div>
  <p style="color:#6B6A63;font-size:12px;margin-top:16px;text-align:center;">OpportunityRadar — Autonomous Opportunity Intelligence</p>
</body></html>`;
}

module.exports = { sendAlert, sendTelegram, buildMessage };
