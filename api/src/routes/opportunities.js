'use strict';
const express = require('express');
const db = require('../db');
const { matchOpportunity } = require('../matcher');
const router = express.Router();

// GET /api/opportunities – list all, optionally with match scores for current user
router.get('/', async (req, res) => {
  try {
    const userId = req.user?.userId;
    const { type, status, search, limit = 50, offset = 0 } = req.query;

    let whereClause = 'WHERE o.is_active = TRUE';
    const params = [];
    let paramIdx = 1;

    if (type) { whereClause += ` AND o.opp_type = $${paramIdx++}`; params.push(type); }
    if (status === 'dead') { whereClause += ` AND o.is_dead = TRUE`; }
    else if (status === 'live') { whereClause += ` AND o.is_dead = FALSE AND (o.deadline IS NULL OR o.deadline > NOW())`; }
    if (search) {
      whereClause += ` AND (o.title ILIKE $${paramIdx} OR o.organizer ILIKE $${paramIdx} OR o.eligibility ILIKE $${paramIdx})`;
      params.push(`%${search}%`); paramIdx++;
    }

    const oppsQuery = `
      SELECT o.*,
             s.url AS source_url, s.label AS source_label, s.last_checked_at AS source_last_checked,
             ${userId ? `mr.match_status, mr.match_score, mr.reason AS match_reason,` : `NULL AS match_status, NULL AS match_score, NULL AS match_reason,`}
             ${userId ? `(w.id IS NOT NULL) AS is_watching,` : `FALSE AS is_watching,`}
             EXTRACT(EPOCH FROM (o.deadline - NOW())) / 86400 AS days_to_deadline,
             (SELECT COUNT(*) FROM changes c WHERE c.opportunity_id = o.id AND c.change_type != 'COSMETIC') AS change_count
      FROM opportunities o
      JOIN sources s ON s.id = o.source_id
      ${userId ? `LEFT JOIN match_results mr ON mr.opportunity_id = o.id AND mr.user_id = $${paramIdx++}` : ''}
      ${userId ? `LEFT JOIN watchlist w ON w.opportunity_id = o.id AND w.user_id = $${paramIdx++}` : ''}
      ${whereClause}
      ORDER BY
        CASE WHEN mr.match_status = 'MATCH' THEN 0 WHEN mr.match_status = 'PARTIAL' THEN 1 ELSE 2 END,
        o.deadline ASC NULLS LAST
      LIMIT $${paramIdx++} OFFSET $${paramIdx++}
    `;
    if (userId) { params.push(userId, userId); }
    params.push(parseInt(limit), parseInt(offset));

    const result = await db.query(oppsQuery, params);
    const countResult = await db.query(
      `SELECT COUNT(*) FROM opportunities o ${whereClause}`,
      params.slice(0, params.length - 2) // Remove limit/offset
    );

    res.json({
      opportunities: result.rows,
      total: parseInt(countResult.rows[0].count),
      limit: parseInt(limit),
      offset: parseInt(offset),
    });
  } catch (e) {
    console.error('[opportunities] list error:', e);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/opportunities/:id – single opportunity with change history
router.get('/:id', async (req, res) => {
  try {
    const opp = await db.queryOne(
      `SELECT o.*, s.url AS source_url, s.label AS source_label, s.last_checked_at AS source_last_checked
       FROM opportunities o JOIN sources s ON s.id = o.source_id WHERE o.id = $1`,
      [req.params.id]
    );
    if (!opp) return res.status(404).json({ error: 'Not found' });

    // Change history
    const changesRes = await db.query(
      `SELECT * FROM changes WHERE opportunity_id = $1 ORDER BY detected_at DESC LIMIT 20`,
      [req.params.id]
    );

    // Latest snapshot evidence
    const snap = await db.queryOne(
      `SELECT evidence, confidence, taken_at FROM snapshots WHERE opportunity_id = $1 ORDER BY taken_at DESC LIMIT 1`,
      [req.params.id]
    );

    res.json({ opportunity: opp, changes: changesRes.rows, snapshot: snap });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/opportunities/:id/ics – download .ics calendar file
router.get('/:id/ics', async (req, res) => {
  try {
    const opp = await db.queryOne('SELECT * FROM opportunities WHERE id = $1', [req.params.id]);
    if (!opp || !opp.deadline) return res.status(404).json({ error: 'Not found or no deadline' });

    const dl = new Date(opp.deadline);
    const format = d => d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    const now = new Date();

    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//OpportunityRadar//EN',
      'BEGIN:VEVENT',
      `UID:opp-${opp.id}@opportunityradar`,
      `DTSTART:${format(dl)}`,
      `DTEND:${format(new Date(dl.getTime() + 3600000))}`,
      `SUMMARY:Deadline: ${opp.title}`,
      `DESCRIPTION:${(opp.eligibility || '').replace(/\n/g, '\\n')}\\nApply: ${opp.apply_link || ''}`,
      `URL:${opp.apply_link || ''}`,
      `DTSTAMP:${format(now)}`,
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="deadline-${opp.id}.ics"`);
    res.send(ics);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/opportunities/:id/watch – add to watchlist (requires auth)
router.post('/:id/watch', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  try {
    await db.query(
      'INSERT INTO watchlist (user_id, opportunity_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [req.user.userId, req.params.id]
    );
    await db.query(
      'INSERT INTO user_watchlist (user_id, opportunity_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [req.user.userId, req.params.id]
    ).catch(() => {});
    res.json({ ok: true, watching: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/opportunities/:id/watch – remove from watchlist
router.delete('/:id/watch', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  try {
    await db.query(
      'DELETE FROM watchlist WHERE user_id = $1 AND opportunity_id = $2',
      [req.user.userId, req.params.id]
    );
    await db.query(
      'DELETE FROM user_watchlist WHERE user_id = $1 AND opportunity_id = $2',
      [req.user.userId, req.params.id]
    ).catch(() => {});
    res.json({ ok: true, watching: false });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
