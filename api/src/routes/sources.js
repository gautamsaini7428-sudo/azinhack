'use strict';
const express = require('express');
const db = require('../db');
const { scrapeAndSnapshot } = require('../snapshot_service');
const router = express.Router();

// GET /api/sources – list all sources
router.get('/', async (_req, res) => {
  const result = await db.query('SELECT * FROM sources ORDER BY created_at DESC');
  res.json(result.rows);
});

// POST /api/sources – add a source to monitor
router.post('/', async (req, res) => {
  try {
    const { url, label, poll_interval = 60 } = req.body;
    if (!url) return res.status(400).json({ error: 'url required' });
    // TODO: check robots.txt before adding
    const result = await db.query(
      `INSERT INTO sources (url, label, poll_interval) VALUES ($1, $2, $3)
       ON CONFLICT (url) DO UPDATE SET label = EXCLUDED.label, poll_interval = EXCLUDED.poll_interval
       RETURNING *`,
      [url, label || url, poll_interval]
    );
    res.status(201).json(result.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/sources/:id/check-now – "Run check now" for demo
router.post('/:id/check-now', async (req, res) => {
  try {
    const source = await db.queryOne('SELECT * FROM sources WHERE id = $1', [req.params.id]);
    if (!source) return res.status(404).json({ error: 'Source not found' });

    // Run check in background and return immediately so UI can stream progress
    res.json({ ok: true, message: 'Check started', sourceId: source.id, label: source.label });

    // Async execution
    scrapeAndSnapshot(source).then(result => {
      console.log(`[check-now] Completed:`, result);
    }).catch(err => {
      console.error(`[check-now] Error:`, err.message);
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/sources/:id/status – check status of last scrape
router.get('/:id/status', async (req, res) => {
  try {
    const source = await db.queryOne('SELECT * FROM sources WHERE id = $1', [req.params.id]);
    if (!source) return res.status(404).json({ error: 'Not found' });
    const recentChanges = await db.query(
      `SELECT c.* FROM changes c
       JOIN opportunities o ON o.id = c.opportunity_id
       WHERE o.source_id = $1 AND c.detected_at > NOW() - INTERVAL '1 hour'
       ORDER BY c.detected_at DESC LIMIT 10`,
      [source.id]
    );
    res.json({ source, recentChanges: recentChanges.rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
