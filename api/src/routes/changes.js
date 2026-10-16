'use strict';
const express = require('express');
const db = require('../db');
const router = express.Router();

/**
 * GET /api/changes
 * Returns detected changes with full opportunity context, diff snippets, and source links.
 */
router.get('/', async (req, res) => {
  try {
    const { limit = 50, opportunity_id, type } = req.query;

    let sql = `
      SELECT c.*,
             o.title AS opp_title,
             o.organizer AS opp_organizer,
             o.opp_type,
             o.apply_link,
             s.url AS source_url,
             s.label AS source_label
      FROM changes c
      JOIN opportunities o ON o.id = c.opportunity_id
      LEFT JOIN sources s ON s.id = o.source_id
      WHERE c.change_type != 'COSMETIC'
    `;
    const params = [];
    let pIdx = 1;

    if (opportunity_id) {
      sql += ` AND c.opportunity_id = $${pIdx++}`;
      params.push(opportunity_id);
    }
    if (type) {
      sql += ` AND c.change_type = $${pIdx++}`;
      params.push(type);
    }

    sql += ` ORDER BY c.detected_at DESC LIMIT $${pIdx++}`;
    params.push(parseInt(limit, 10) || 50);

    const result = await db.query(sql, params);

    res.json({
      changes: result.rows,
      total: result.rowCount || result.rows.length,
    });
  } catch (err) {
    console.error('[changes] Error loading changes:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
