'use strict';
/**
 * OpportunityRadar API – Main Entry Point
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const db = require('./db');
const { router: authRouter, requireAuth, JWT_SECRET } = require('./routes/auth');
const opportunitiesRouter = require('./routes/opportunities');
const sourcesRouter = require('./routes/sources');
const { router: profileRouter } = require('./routes/profile');
const alertsRouter = require('./routes/alerts');

const app = express();
const PORT = parseInt(process.env.API_PORT || '3001', 10);

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors({
  origin: (origin, callback) => {
    // Dynamic origin matching to support credentials with cookies across ports
    callback(null, true);
  },
  credentials: true,
}));

app.use(cookieParser());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Attach user if token present in cookie or Authorization header (optional auth)
app.use((req, _res, next) => {
  let token = null;
  if (req.cookies && req.cookies.or_access_token) {
    token = req.cookies.or_access_token;
  } else if (req.headers.authorization?.startsWith('Bearer ')) {
    token = req.headers.authorization.slice(7);
  }

  if (token) {
    try {
      req.user = jwt.verify(token, JWT_SECRET);
    } catch {}
  }
  next();
});

// ── Routes ────────────────────────────────────────────────────────────────────
app.get('/health', async (_req, res) => {
  try {
    await db.ping();
    res.json({
      status: 'ok',
      service: 'opportunityradar-api',
      ts: new Date().toISOString(),
      mailpit_configured: Boolean(process.env.SMTP_HOST),
    });
  } catch (e) {
    res.status(503).json({ status: 'error', error: e.message });
  }
});

app.use('/api/auth', authRouter);
app.use('/api/opportunities', opportunitiesRouter);
app.use('/api/sources', sourcesRouter);
app.use('/api/profile', requireAuth, profileRouter);
app.use('/api/alerts', requireAuth, alertsRouter);

// Admin: trigger immediate scrape of a source (demo / worker manual trigger)
app.post('/api/admin/scrape/:sourceId', requireAuth, async (req, res) => {
  const { scrapeAndSnapshot } = require('./snapshot_service');
  const source = await db.queryOne('SELECT * FROM sources WHERE id = $1', [req.params.sourceId]);
  if (!source) return res.status(404).json({ error: 'Source not found' });
  res.json({ ok: true, message: `Scraping ${source.label}` });
  scrapeAndSnapshot(source).catch(e => console.error('[admin/scrape]', e.message));
});

// 404 handler
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

// Error handler
app.use((err, _req, res, _next) => {
  console.error('[api] Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ── Start ─────────────────────────────────────────────────────────────────────
if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[api] OpportunityRadar API listening on :${PORT}`);
    console.log(`[api] TinyFish key: ${process.env.TINYFISH_API_KEY ? '✓ set' : '✗ MISSING – extraction will fail'}`);
  });
}

module.exports = app;
