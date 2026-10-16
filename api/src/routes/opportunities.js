'use strict';
const express = require('express');
const db = require('../db');
const router = express.Router();

function parseMatchPayload(row) {
  let breakdown = null;
  let fitLabel = null;
  let summary = row.match_reason || null;

  if (row.match_reason && typeof row.match_reason === 'string') {
    if (row.match_reason.startsWith('{')) {
      try {
        const parsed = JSON.parse(row.match_reason);
        summary = parsed.summary || parsed.reason || row.match_reason;
        breakdown = parsed.breakdown || null;
        fitLabel = parsed.fitLabel || null;
      } catch {}
    }
  }

  const score = row.match_score !== null && row.match_score !== undefined ? parseFloat(row.match_score) : null;

  return {
    ...row,
    is_watching: Boolean(row.is_watching),
    is_watched: Boolean(row.is_watching || row.is_watched),
    match: row.match_status ? {
      status: row.match_status,
      score: score,
      fitLabel: fitLabel || (row.match_status === 'MATCH' ? 'Strong Fit' : row.match_status === 'PARTIAL' ? 'Moderate Fit' : 'Ineligible'),
      reason: summary,
      evidence: row.match_evidence || '',
      breakdown: breakdown || { confirmed: [], conflicts: [], unknown: [] },
    } : null,
  };
}

// GET /api/opportunities – list all, optionally with match scores for current user
router.get('/', async (req, res) => {
  try {
    const userId = req.user?.userId;
    const { type, status, search, limit = 50, offset = 0 } = req.query;

    let whereClause = 'WHERE o.is_active = TRUE';
    const whereParams = [];
    let pIdx = 1;

    if (type) {
      whereClause += ` AND o.opp_type = $${pIdx++}`;
      whereParams.push(type);
    }
    if (status === 'dead') {
      whereClause += ` AND o.is_dead = TRUE`;
    } else if (status === 'live') {
      whereClause += ` AND o.is_dead = FALSE AND (o.deadline IS NULL OR o.deadline > NOW())`;
    }
    if (search) {
      whereClause += ` AND (o.title ILIKE $${pIdx} OR o.organizer ILIKE $${pIdx} OR o.eligibility ILIKE $${pIdx})`;
      whereParams.push(`%${search}%`);
      pIdx++;
    }

    const queryParams = [...whereParams];
    let userJoinClauses = '';
    let matchSelectClause = 'NULL AS match_status, NULL AS match_score, NULL AS match_reason, NULL AS match_evidence, FALSE AS is_watching,';
    let orderByClause = 'ORDER BY o.deadline ASC NULLS LAST';

    if (userId) {
      const mrIdx = queryParams.length + 1;
      const wIdx = queryParams.length + 2;
      queryParams.push(userId, userId);

      userJoinClauses = `
        LEFT JOIN match_results mr ON mr.opportunity_id = o.id AND mr.user_id = $${mrIdx}
        LEFT JOIN watchlist w ON w.opportunity_id = o.id AND w.user_id = $${wIdx}
      `;
      matchSelectClause = `
        mr.match_status, mr.match_score, mr.reason AS match_reason, mr.evidence AS match_evidence,
        (w.opportunity_id IS NOT NULL) AS is_watching,
        (w.opportunity_id IS NOT NULL) AS is_watched,
      `;
      orderByClause = `
        ORDER BY
          CASE
            WHEN mr.match_status = 'MATCH' THEN 0
            WHEN mr.match_status = 'PARTIAL' THEN 1
            WHEN mr.match_status = 'NO_MATCH' THEN 2
            ELSE 3
          END,
          o.deadline ASC NULLS LAST
      `;
    }

    const limitIdx = queryParams.length + 1;
    const offsetIdx = queryParams.length + 2;
    queryParams.push(parseInt(limit, 10) || 50, parseInt(offset, 10) || 0);

    const oppsQuery = `
      SELECT o.*,
             s.url AS source_url, s.label AS source_label, s.last_checked_at AS source_last_checked,
             ${matchSelectClause}
             EXTRACT(EPOCH FROM (o.deadline - NOW())) / 86400 AS days_to_deadline,
             (SELECT COUNT(*) FROM changes c WHERE c.opportunity_id = o.id AND c.change_type != 'COSMETIC') AS change_count
      FROM opportunities o
      JOIN sources s ON s.id = o.source_id
      ${userJoinClauses}
      ${whereClause}
      ${orderByClause}
      LIMIT $${limitIdx} OFFSET $${offsetIdx}
    `;

    const result = await db.query(oppsQuery, queryParams);
    const countResult = await db.query(
      `SELECT COUNT(*) FROM opportunities o ${whereClause}`,
      whereParams
    );

    const opportunities = result.rows.map(parseMatchPayload);

    res.json({
      opportunities,
      total: parseInt(countResult.rows[0]?.count || '0', 10),
      limit: parseInt(limit, 10) || 50,
      offset: parseInt(offset, 10) || 0,
    });
  } catch (e) {
    console.error('[opportunities] list error:', e);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/opportunities/:id – single opportunity with change history and evidence
router.get('/:id', async (req, res) => {
  try {
    const opp = await db.queryOne(
      `SELECT o.*, s.url AS source_url, s.label AS source_label, s.last_checked_at AS source_last_checked
       FROM opportunities o JOIN sources s ON s.id = o.source_id WHERE o.id = $1`,
      [req.params.id]
    );
    if (!opp) return res.status(404).json({ error: 'Opportunity not found' });

    // Change history
    const changesRes = await db.query(
      `SELECT * FROM changes WHERE opportunity_id = $1 AND change_type != 'COSMETIC' ORDER BY detected_at DESC LIMIT 20`,
      [req.params.id]
    );

    // Latest snapshot evidence
    const snap = await db.queryOne(
      `SELECT evidence, confidence, taken_at FROM snapshots WHERE opportunity_id = $1 ORDER BY taken_at DESC LIMIT 1`,
      [req.params.id]
    );

    res.json({
      opportunity: opp,
      changes: changesRes.rows,
      recent_changes: changesRes.rows,
      snapshot: snap,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/opportunities/:id/ics and alias :id/calendar.ics – download RFC 5545 .ics calendar event
router.get(['/:id/ics', '/:id/calendar.ics'], async (req, res) => {
  try {
    const opp = await db.queryOne('SELECT * FROM opportunities WHERE id = $1', [req.params.id]);
    if (!opp || !opp.deadline) {
      return res.status(404).json({ error: 'Opportunity not found or no deadline specified' });
    }

    const dl = new Date(opp.deadline);
    if (isNaN(dl.getTime())) {
      return res.status(400).json({ error: 'Invalid opportunity deadline format' });
    }

    const formatUtc = d => d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    const now = new Date();
    const escapeText = s => (s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

    const safeTitle = escapeText(opp.title);
    const safeDesc = escapeText(`${opp.eligibility || ''}\nOrganizer: ${opp.organizer || 'N/A'}\nApplication: ${opp.apply_link || ''}`);
    const safeUrl = (opp.apply_link || '').replace(/[\r\n]/g, '');

    const icsLines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//OpportunityRadar//Opportunity Calendar v1.0//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'BEGIN:VEVENT',
      `UID:opp-${opp.id}@opportunityradar.dev`,
      `DTSTAMP:${formatUtc(now)}`,
      `DTSTART:${formatUtc(dl)}`,
      `DTEND:${formatUtc(new Date(dl.getTime() + 3600000))}`,
      `SUMMARY:Application Deadline: ${safeTitle}`,
      `DESCRIPTION:${safeDesc}`,
      safeUrl ? `URL:${safeUrl}` : '',
      'STATUS:CONFIRMED',
      'END:VEVENT',
      'END:VCALENDAR',
    ].filter(Boolean).join('\r\n');

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="deadline-${opp.id}.ics"`);
    res.send(icsLines);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/opportunities/:id/watch – add to watchlist (or toggle if requested)
router.post('/:id/watch', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const oppId = req.params.id;
    const userId = req.user.userId;

    // Check if toggle requested or already watched
    if (req.body?.action === 'toggle') {
      const existing = await db.queryOne(
        'SELECT id FROM watchlist WHERE user_id = $1 AND opportunity_id = $2',
        [userId, oppId]
      );
      if (existing) {
        await db.query('DELETE FROM watchlist WHERE user_id = $1 AND opportunity_id = $2', [userId, oppId]);
        await db.query('DELETE FROM user_watchlist WHERE user_id = $1 AND opportunity_id = $2', [userId, oppId]).catch(() => {});
        return res.json({ ok: true, watched: false, watching: false });
      }
    }

    await db.query(
      'INSERT INTO watchlist (user_id, opportunity_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [userId, oppId]
    );
    await db.query(
      'INSERT INTO user_watchlist (user_id, opportunity_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [userId, oppId]
    ).catch(() => {});

    res.json({ ok: true, watched: true, watching: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/opportunities/:id/watch – remove from watchlist
router.delete('/:id/watch', async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const oppId = req.params.id;
    const userId = req.user.userId;

    await db.query(
      'DELETE FROM watchlist WHERE user_id = $1 AND opportunity_id = $2',
      [userId, oppId]
    );
    await db.query(
      'DELETE FROM user_watchlist WHERE user_id = $1 AND opportunity_id = $2',
      [userId, oppId]
    ).catch(() => {});

    res.json({ ok: true, watched: false, watching: false });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;

