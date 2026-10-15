'use strict';
/**
 * OpportunityRadar Worker & Scheduler
 *
 * Periodically monitors configured opportunity sources, identifies sources
 * due for polling, and coordinates snapshots and change detection with the API.
 */

const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL;
const API_URL = process.env.API_URL || (process.env.NODE_ENV === 'production' ? 'http://api:3001' : 'http://localhost:3001');
const POLL_INTERVAL_MS = parseInt(process.env.WORKER_POLL_INTERVAL_MS || '30000', 10);

console.log('╔═══════════════════════════════════════════════════════════╗');
console.log('║         OpportunityRadar Background Worker Engine         ║');
console.log('║       Powered by TinyFish Web Agents & Docker Engine      ║');
console.log('╚═══════════════════════════════════════════════════════════╝');
console.log(`[worker] Database URL: ${DATABASE_URL ? '✓ configured' : '✗ missing'}`);
console.log(`[worker] API URL: ${API_URL}`);
console.log(`[worker] Loop interval: ${POLL_INTERVAL_MS / 1000}s`);

const pool = new Pool({
  connectionString: DATABASE_URL,
  connectionTimeoutMillis: 10000,
});

pool.on('error', (err) => {
  console.error('[worker-db] Unexpected database error:', err.message);
});

let isRunning = false;

/**
 * Poll all active sources that are due for checking
 */
async function pollCycle() {
  if (isRunning) {
    console.log('[worker] Previous poll cycle still running, skipping...');
    return;
  }
  isRunning = true;

  try {
    // Find sources where:
    // 1) never checked (last_checked_at IS NULL)
    // 2) or last_checked_at is older than poll_interval minutes
    const query = `
      SELECT id, url, label, poll_interval, source_type, last_checked_at
      FROM sources
      WHERE last_checked_at IS NULL
         OR last_checked_at < NOW() - (poll_interval * INTERVAL '1 minute')
      ORDER BY last_checked_at ASC NULLS FIRST
      LIMIT 5
    `;

    let dueSources = [];
    try {
      const res = await pool.query(query);
      dueSources = res.rows;
    } catch (dbErr) {
      // Fallback: fetch sources directly from API
      const apiSourcesRes = await fetch(`${API_URL}/api/sources`).catch(() => null);
      if (apiSourcesRes && apiSourcesRes.ok) {
        dueSources = await apiSourcesRes.json();
      }
    }

    if (dueSources.length === 0) {
      console.log(`[worker] [${new Date().toISOString()}] No sources due for polling.`);
    } else {
      console.log(`[worker] [${new Date().toISOString()}] Found ${dueSources.length} source(s) due for check:`);

      for (const source of dueSources) {
        console.log(`[worker] → Triggering check for: ${source.label} (${source.url})`);
        try {
          const checkRes = await fetch(`${API_URL}/api/sources/${source.id}/check-now`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
          });

          if (checkRes.ok) {
            const data = await checkRes.json();
            console.log(`[worker] ✓ Check initiated for source [${source.id}]:`, data.message || 'Started');
          } else {
            const errText = await checkRes.text();
            console.warn(`[worker] ⚠ API returned HTTP ${checkRes.status} for source [${source.id}]: ${errText}`);
          }
        } catch (fetchErr) {
          console.error(`[worker] ✗ Failed to reach API at ${API_URL}:`, fetchErr.message);
        }
      }
    }
  } catch (err) {
    console.error('[worker] Error in poll cycle:', err.message);
  } finally {
    isRunning = false;
  }
}

// Wait for database and API to be reachable
async function waitForDependencies(retries = 20, delayMs = 3000) {
  for (let i = 1; i <= retries; i++) {
    try {
      const apiRes = await fetch(`${API_URL}/health`).catch(() => null);
      if (apiRes && apiRes.ok) {
        console.log('[worker] ✓ API health check verified');
        return true;
      }
      console.log(`[worker] Waiting for API to be ready at ${API_URL}... (${i}/${retries})`);
    } catch (e) {
      console.log(`[worker] Waiting for dependencies... (${i}/${retries}): ${e.message}`);
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw new Error('[worker] Dependencies did not become healthy in time.');
}

async function start() {
  try {
    await waitForDependencies();
    console.log('[worker] Ready! Executing initial startup check...');
    await pollCycle();

    // Start periodic interval
    setInterval(pollCycle, POLL_INTERVAL_MS);
    console.log(`[worker] Scheduler active, polling every ${POLL_INTERVAL_MS / 1000} seconds.`);
  } catch (err) {
    console.error('[worker] Startup error:', err.message);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('[worker] Received SIGTERM, draining pool and shutting down...');
  await pool.end();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('[worker] Received SIGINT, exiting...');
  await pool.end();
  process.exit(0);
});

start();
