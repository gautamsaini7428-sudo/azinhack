'use strict';
const express = require('express');
const db = require('../db');
const { scrapeAndSnapshot } = require('../snapshot_service');
const { requireAuth } = require('./auth');
const { recomputeMatches } = require('./profile');

const router = express.Router();

// ── In-Memory Rate Limiting for Scrape Triggers ──────────────────────────────
const scrapeLimits = new Map(); // key: user/ip, value: { count, firstAttempt }
const SCRAPE_WINDOW_MS = 5 * 60 * 1000;
const MAX_SCRAPES = 12;

function checkScrapeLimit(key) {
  const now = Date.now();
  const entry = scrapeLimits.get(key);
  if (!entry || now - entry.firstAttempt > SCRAPE_WINDOW_MS) {
    scrapeLimits.set(key, { count: 1, firstAttempt: now });
    return { allowed: true };
  }
  if (entry.count >= MAX_SCRAPES) {
    const retryAfterSec = Math.ceil((entry.firstAttempt + SCRAPE_WINDOW_MS - now) / 1000);
    return { allowed: false, retryAfterSec };
  }
  entry.count += 1;
  return { allowed: true };
}

/**
 * Validate source URL and enforce strict SSRF protections.
 * Rejects private, loopback, and cloud metadata addresses.
 */
function validateSourceUrl(inputUrl) {
  if (!inputUrl || typeof inputUrl !== 'string') {
    throw new Error('A valid URL string is required.');
  }

  let parsed;
  try {
    parsed = new URL(inputUrl.trim());
  } catch {
    throw new Error('Invalid URL format.');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Source URL must use http:// or https:// protocol.');
  }

  const host = parsed.hostname.toLowerCase();
  const isDev = process.env.NODE_ENV !== 'production';

  // Allow simulated local mock-portal only in development/testing mode
  const isMockPortal = (host === 'localhost' || host === '127.0.0.1' || host === 'mock-portal') &&
    (parsed.port === '4000' || parsed.port === String(process.env.MOCK_PORTAL_PORT || 4000));

  if (isDev && isMockPortal) {
    return parsed.href;
  }

  // Strict SSRF Blocklist
  const isBlocked =
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.startsWith('10.') ||
    host.startsWith('192.168.') ||
    host.startsWith('169.254.') || // AWS/GCP metadata
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host) ||
    /^127\./.test(host);

  if (isBlocked) {
    throw new Error('Access to private or loopback or internal cloud network addresses is prohibited to prevent SSRF.');
  }

  return parsed.href;
}

// GET /api/sources – list all monitored sources
router.get('/', async (_req, res) => {
  try {
    const result = await db.query('SELECT * FROM sources ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/sources – add a source to monitor (requires auth + SSRF validation)
router.post('/', requireAuth, async (req, res) => {
  try {
    const { url, label, poll_interval = 60 } = req.body;
    if (!url) return res.status(400).json({ error: 'Source URL is required.' });

    let safeUrl;
    try {
      safeUrl = validateSourceUrl(url);
    } catch (validationErr) {
      return res.status(400).json({ error: validationErr.message });
    }

    const intervalMinutes = Math.max(5, Math.min(1440, parseInt(poll_interval, 10) || 60));

    const result = await db.query(
      `INSERT INTO sources (url, label, poll_interval, is_active, robots_allowed, created_at)
       VALUES ($1, $2, $3, TRUE, TRUE, NOW())
       ON CONFLICT (url) DO UPDATE SET
         label = EXCLUDED.label,
         poll_interval = EXCLUDED.poll_interval
       RETURNING *`,
      [safeUrl, label ? String(label).trim().slice(0, 120) : safeUrl, intervalMinutes]
    );

    res.status(201).json(result.rows[0]);
  } catch (e) {
    console.error('[sources/add] error:', e);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/sources/:id/check-now – trigger scrape and await real completion (requires auth)
router.post('/:id/check-now', requireAuth, async (req, res) => {
  try {
    const clientKey = `scrape_${req.user?.userId || req.ip}`;
    const rateCheck = checkScrapeLimit(clientKey);
    if (!rateCheck.allowed) {
      return res.status(429).json({
        error: `Scraping rate limit exceeded. Please wait ${rateCheck.retryAfterSec} seconds before triggering another check.`,
      });
    }

    const source = await db.queryOne('SELECT * FROM sources WHERE id = $1', [req.params.id]);
    if (!source) return res.status(404).json({ error: 'Source not found' });

    // Execute scrape and snapshot synchronously so UI receives real result
    let scrapeResult;
    try {
      scrapeResult = await scrapeAndSnapshot(source);
    } catch (scrapeErr) {
      return res.status(502).json({
        ok: false,
        error: `Extraction failed: ${scrapeErr.message}`,
        sourceId: source.id,
      });
    }

    // Recompute match scores for the requesting user after listings update
    if (req.user?.userId) {
      recomputeMatches(req.user.userId).catch(e => console.warn('[check-now] recompute error:', e.message));
    }

    // Retrieve real changes detected for this source in the last 15 minutes
    const changesRes = await db.query(
      `SELECT c.*, o.title AS opp_title, o.organizer AS opp_organizer, o.opp_type, o.apply_link
       FROM changes c
       JOIN opportunities o ON o.id = c.opportunity_id
       WHERE o.source_id = $1 AND c.detected_at > NOW() - INTERVAL '15 minute'
       ORDER BY c.detected_at DESC LIMIT 10`,
      [source.id]
    );

    res.json({
      ok: true,
      message: `Scrape successfully finished for ${source.label || source.url}`,
      sourceId: source.id,
      label: source.label,
      opportunitiesFound: scrapeResult.opportunitiesFound || 0,
      changesDetected: scrapeResult.changesDetected || 0,
      recentChanges: changesRes.rows || [],
      error: scrapeResult.error || null,
      checked_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error('[check-now] Error:', e);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/sources/:id/status – check status of last scrape
router.get('/:id/status', async (req, res) => {
  try {
    const source = await db.queryOne('SELECT * FROM sources WHERE id = $1', [req.params.id]);
    if (!source) return res.status(404).json({ error: 'Source not found' });

    const recentChanges = await db.query(
      `SELECT c.*, o.title AS opp_title, o.organizer AS opp_organizer, o.opp_type, o.apply_link
       FROM changes c
       JOIN opportunities o ON o.id = c.opportunity_id
       WHERE o.source_id = $1 AND c.detected_at > NOW() - INTERVAL '2 hour'
       ORDER BY c.detected_at DESC LIMIT 10`,
      [source.id]
    );

    res.json({
      source,
      recentChanges: recentChanges.rows,
      last_checked_at: source.last_checked_at,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
