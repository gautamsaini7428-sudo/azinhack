'use strict';
/**
 * Snapshot service
 * Orchestrates TinyFish extraction → DB storage → change detection → alerts
 */

const db = require('./db');
const tf = require('./tinyfish_client');
const { classifyChanges } = require('./change_engine');
const { sendAlert } = require('./alerts');

/**
 * Scrape a source URL, save a snapshot, detect changes, fire alerts.
 * @param {object} source  – row from sources table
 * @returns {{ opportunitiesFound: number, changesDetected: number }}
 */
async function scrapeAndSnapshot(source) {
  console.log(`[snapshot] Scraping: ${source.url} (${source.label})`);
  const startTime = Date.now();
  let opportunitiesFound = 0;
  let changesDetected = 0;

  try {
    // ── Step 1: Use TinyFish to extract opportunities ─────────────────────────
    let extracted;
    try {
      extracted = await tf.extractOpportunities(source.url);
    } catch (err) {
      console.error(`[snapshot] TinyFish extraction failed for ${source.url}:`, err.message);
      // Mark source as checked even on failure
      await db.query('UPDATE sources SET last_checked_at = NOW() WHERE id = $1', [source.id]);
      return { opportunitiesFound: 0, changesDetected: 0, error: err.message };
    }

    const opps = extracted?.opportunities || [];
    opportunitiesFound = opps.length;
    console.log(`[snapshot] Extracted ${opps.length} opportunities from ${source.url}`);

    for (const opp of opps) {
      // ── Step 2: Upsert opportunity into DB ──────────────────────────────────
      const deadline = parseDeadline(opp.deadline);
      const isDead = opp.status === 'closed' || (deadline && deadline < new Date());

      const existing = await db.queryOne(
        'SELECT id FROM opportunities WHERE source_id = $1 AND title = $2',
        [source.id, opp.title]
      );

      let oppId;
      if (existing) {
        oppId = existing.id;
        await db.query(
          `UPDATE opportunities SET
            organizer = $2, opp_type = $3, eligibility = $4,
            deadline = $5, reward = $6, apply_link = $7,
            is_dead = $8, confidence = $9, last_checked_at = NOW(), updated_at = NOW()
           WHERE id = $1`,
          [oppId, opp.organizer, opp.type, opp.eligibility,
           deadline, opp.reward, opp.apply_link,
           isDead, opp.confidence || 0.8]
        );
      } else {
        const res = await db.query(
          `INSERT INTO opportunities
            (source_id, title, organizer, opp_type, eligibility, deadline, reward,
             apply_link, is_dead, confidence, last_checked_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
           RETURNING id`,
          [source.id, opp.title, opp.organizer, opp.type, opp.eligibility,
           deadline, opp.reward, opp.apply_link, isDead, opp.confidence || 0.8]
        );
        oppId = res.rows[0].id;
      }

      // ── Step 3: Save snapshot ───────────────────────────────────────────────
      await db.query(
        `INSERT INTO snapshots (opportunity_id, source_id, raw_data, evidence, confidence)
         VALUES ($1, $2, $3, $4, $5)`,
        [oppId, source.id, opp, opp.evidence || {}, opp.confidence || 0.8]
      );

      // ── Step 4: Detect changes (compare to previous snapshot) ───────────────
      const prevSnap = await db.queryOne(
        `SELECT raw_data FROM snapshots
         WHERE opportunity_id = $1
         ORDER BY taken_at DESC
         LIMIT 1 OFFSET 1`, // second-to-last (previous)
        [oppId]
      );

      if (prevSnap && existing) {
        const currSnap = { raw_data: opp };
        const changes = await classifyChanges(prevSnap, currSnap, source.url);

        for (const change of changes) {
          if (change.change_type === 'COSMETIC') continue; // suppress cosmetic

          // Save change record
          const changeRes = await db.query(
            `INSERT INTO changes
               (opportunity_id, change_type, before_data, after_data, explanation, source_link)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING id`,
            [oppId, change.change_type, change.before_data, change.after_data,
             change.explanation, change.source_link]
          );
          const changeId = changeRes.rows[0].id;
          changesDetected++;

          // Send alerts
          await sendAlert({
            opportunityId: oppId,
            changeId,
            changeType: change.change_type,
            explanation: change.explanation,
            sourceLink: source.url,
            beforeData: change.before_data,
            afterData: change.after_data,
          });
        }
      } else if (!existing) {
        // Brand new listing – treat as NEW_LISTING change
        const changeRes = await db.query(
          `INSERT INTO changes
             (opportunity_id, change_type, after_data, explanation, source_link)
           VALUES ($1, 'NEW_LISTING', $2, $3, $4)
           RETURNING id`,
          [oppId, opp, `New listing found: ${opp.title}`, source.url]
        );
        changesDetected++;
      }
    }

    // ── Step 5: Dead-listing detection ─────────────────────────────────────────
    // Mark opportunities not seen in this scrape that have passed deadline as dead
    await db.query(
      `UPDATE opportunities SET is_dead = TRUE
       WHERE source_id = $1 AND is_dead = FALSE AND deadline < NOW()`,
      [source.id]
    );

    // ── Step 6: Update source's last_checked_at ────────────────────────────────
    await db.query('UPDATE sources SET last_checked_at = NOW() WHERE id = $1', [source.id]);

    console.log(`[snapshot] Done ${source.url} in ${Date.now() - startTime}ms. ${opportunitiesFound} opps, ${changesDetected} changes.`);
    return { opportunitiesFound, changesDetected };

  } catch (err) {
    console.error(`[snapshot] Error processing ${source.url}:`, err);
    throw err;
  }
}

/** Try to parse a deadline string into a Date. Returns null if unparseable. */
function parseDeadline(raw) {
  if (!raw) return null;
  const d = new Date(raw);
  if (!isNaN(d.getTime())) return d;
  // Try common formats like "April 7, 2025"
  const parsed = new Date(raw.replace(/(\d+)(st|nd|rd|th)/, '$1'));
  return isNaN(parsed.getTime()) ? null : parsed;
}

module.exports = { scrapeAndSnapshot };
