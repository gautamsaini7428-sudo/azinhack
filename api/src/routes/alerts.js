'use strict';
const express = require('express');
const db = require('../db');
const router = express.Router();

// ── GET /api/alerts – user's in-app notification feed ─────────────────────────
router.get('/', async (req, res) => {
  try {
    const { limit = 30, unread_only } = req.query;
    let sql = `
      SELECT a.*, o.title AS opp_title, o.opp_type,
             c.change_type, c.before_data, c.after_data, c.explanation AS change_explanation
      FROM alerts a
      LEFT JOIN opportunities o ON o.id = a.opportunity_id
      LEFT JOIN changes c ON c.id = a.change_id
      WHERE a.user_id = $1 AND a.channel = 'in-app'
    `;
    const params = [req.user.userId];
    if (unread_only === 'true') sql += ' AND a.is_read = FALSE';
    sql += ` ORDER BY a.created_at DESC LIMIT $2`;
    params.push(parseInt(limit));

    const result = await db.query(sql, params);
    const unreadCount = await db.queryOne(
      'SELECT COUNT(*) FROM alerts WHERE user_id = $1 AND channel = $2 AND is_read = FALSE',
      [req.user.userId, 'in-app']
    );

    res.json({
      alerts: result.rows,
      unread_count: parseInt(unreadCount?.count || '0', 10),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/alerts/settings – user's alert preferences ───────────────────────
router.get('/settings', async (req, res) => {
  try {
    let settings = await db.queryOne(
      'SELECT * FROM user_alert_settings WHERE user_id = $1',
      [req.user.userId]
    );

    if (!settings) {
      // Create defaults
      const resIns = await db.query(
        `INSERT INTO user_alert_settings (user_id, email_enabled, telegram_enabled, frequency, deadline_threshold_days)
         VALUES ($1, TRUE, FALSE, 'realtime', 14)
         ON CONFLICT (user_id) DO NOTHING
         RETURNING *`,
        [req.user.userId]
      );
      settings = resIns.rows[0] || {
        user_id: req.user.userId,
        email_enabled: true,
        telegram_enabled: false,
        telegram_chat_id: '',
        frequency: 'realtime',
        deadline_threshold_days: 14,
      };
    }

    res.json(settings);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── PUT /api/alerts/settings – update alert preferences ───────────────────────
router.put('/settings', async (req, res) => {
  try {
    const {
      email_enabled = true,
      telegram_enabled = false,
      telegram_chat_id = '',
      frequency = 'realtime',
      deadline_threshold_days = 14,
    } = req.body;

    const result = await db.query(
      `INSERT INTO user_alert_settings
         (user_id, email_enabled, telegram_enabled, telegram_chat_id, frequency, deadline_threshold_days, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         email_enabled = EXCLUDED.email_enabled,
         telegram_enabled = EXCLUDED.telegram_enabled,
         telegram_chat_id = EXCLUDED.telegram_chat_id,
         frequency = EXCLUDED.frequency,
         deadline_threshold_days = EXCLUDED.deadline_threshold_days,
         updated_at = NOW()
       RETURNING *`,
      [
        req.user.userId,
        Boolean(email_enabled),
        Boolean(telegram_enabled),
        telegram_chat_id ? String(telegram_chat_id).trim() : '',
        ['realtime', 'daily', 'weekly'].includes(frequency) ? frequency : 'realtime',
        parseInt(deadline_threshold_days, 10) || 14,
      ]
    );

    res.json({ ok: true, settings: result.rows[0] });
  } catch (e) {
    console.error('[alerts/settings] error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ── PATCH / POST /api/alerts/:id/read – mark single alert as read ─────────────
const markReadHandler = async (req, res) => {
  try {
    await db.query(
      'UPDATE alerts SET is_read = TRUE WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.userId]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
router.patch('/:id/read', markReadHandler);
router.post('/:id/read', markReadHandler);

// ── PATCH / POST /api/alerts/read-all – mark all alerts as read ───────────────
const markAllReadHandler = async (req, res) => {
  try {
    await db.query(
      "UPDATE alerts SET is_read = TRUE WHERE user_id = $1 AND channel = 'in-app'",
      [req.user.userId]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
router.patch('/read-all', markAllReadHandler);
router.post('/read-all', markAllReadHandler);

module.exports = router;
