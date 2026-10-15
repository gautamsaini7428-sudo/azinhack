'use strict';
/**
 * Change Engine
 * Compares two snapshots of an opportunity and classifies the changes.
 *
 * Categories:
 *   DEADLINE_CHANGED    – deadline date changed
 *   ELIGIBILITY_CHANGED – eligibility text changed meaningfully
 *   REWARD_CHANGED      – reward/stipend amount changed
 *   LISTING_CLOSED      – status changed to closed, or page says expired
 *   NEW_LISTING         – newly discovered opportunity
 *   COSMETIC            – whitespace, formatting, or trivial changes (suppressed)
 */

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const LLM_MODEL = process.env.LLM_MODEL || 'gpt-4o-mini';
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';

async function llmClassify(before, after) {
  if (!OPENAI_API_KEY) return null;
  return new Promise((resolve) => {
    const body = JSON.stringify({
      model: LLM_MODEL,
      messages: [{
        role: 'system',
        content: 'You classify changes between two versions of an opportunity listing. Return JSON only: {"change_type":"DEADLINE_CHANGED|ELIGIBILITY_CHANGED|REWARD_CHANGED|LISTING_CLOSED|COSMETIC","explanation":"one sentence human-readable summary of what changed, e.g. Deadline moved from 12 Nov to 20 Nov"}'
      }, {
        role: 'user',
        content: `Before: ${JSON.stringify(before)}\nAfter: ${JSON.stringify(after)}`
      }],
      response_format: { type: 'json_object' },
      temperature: 0,
      max_tokens: 200,
    });
    const url = new (require('url').URL)(`${OPENAI_BASE_URL}/chat/completions`);
    const req = require('https').request({
      hostname: url.hostname, port: url.port || 443, path: url.pathname, method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { const p = JSON.parse(data); resolve(JSON.parse(p.choices?.[0]?.message?.content)); }
        catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.write(body); req.end();
  });
}

/** Rule-based change detection */
function detectChange(before, after) {
  const changes = [];

  // Deadline check
  const dlBefore = before.deadline ? new Date(before.deadline).toISOString() : null;
  const dlAfter  = after.deadline  ? new Date(after.deadline).toISOString()  : null;
  if (dlBefore !== dlAfter && (dlBefore || dlAfter)) {
    const bStr = dlBefore ? new Date(dlBefore).toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' }) : 'unknown';
    const aStr = dlAfter  ? new Date(dlAfter).toLocaleDateString('en-IN',  { day:'numeric', month:'short', year:'numeric' }) : 'removed';
    changes.push({ change_type: 'DEADLINE_CHANGED', explanation: `Deadline moved from ${bStr} to ${aStr}` });
  }

  // Status / closed
  const wasClosed = ['closed', 'expired', 'ended'].includes((before.status || '').toLowerCase());
  const isClosed  = ['closed', 'expired', 'ended'].includes((after.status  || '').toLowerCase()) || after.is_dead;
  if (!wasClosed && isClosed) {
    changes.push({ change_type: 'LISTING_CLOSED', explanation: 'Listing was closed or marked as expired' });
  }

  // Eligibility (significant text change >30 chars different)
  const eligBefore = (before.eligibility || '').trim();
  const eligAfter  = (after.eligibility  || '').trim();
  if (eligBefore !== eligAfter) {
    const editDist = levenshteinDistance(eligBefore, eligAfter);
    if (editDist > 30) {
      changes.push({ change_type: 'ELIGIBILITY_CHANGED', explanation: 'Eligibility criteria were updated' });
    } else if (editDist > 0) {
      changes.push({ change_type: 'COSMETIC', explanation: 'Minor text update in eligibility' });
    }
  }

  // Reward
  const rewBefore = (before.reward || '').trim();
  const rewAfter  = (after.reward  || '').trim();
  if (rewBefore !== rewAfter && rewBefore && rewAfter) {
    changes.push({ change_type: 'REWARD_CHANGED', explanation: `Reward changed from "${rewBefore}" to "${rewAfter}"` });
  }

  // Nothing meaningful changed
  if (changes.length === 0) {
    changes.push({ change_type: 'COSMETIC', explanation: 'No meaningful changes detected' });
  }

  return changes;
}

/**
 * Compare two snapshots and return an array of change records.
 * COSMETIC changes are included in the return but flagged so callers can suppress alerts.
 *
 * @param {object} prevSnapshot  – { raw_data }
 * @param {object} currSnapshot  – { raw_data }
 * @param {string} sourceLink
 * @returns {Promise<ChangeRecord[]>}
 */
async function classifyChanges(prevSnapshot, currSnapshot, sourceLink) {
  const before = prevSnapshot.raw_data || {};
  const after  = currSnapshot.raw_data  || {};

  const ruleChanges = detectChange(before, after);

  // Try LLM enhancement for the first non-cosmetic change
  const meaningful = ruleChanges.filter(c => c.change_type !== 'COSMETIC');
  if (meaningful.length > 0) {
    try {
      const llmResult = await llmClassify(before, after);
      if (llmResult?.change_type && llmResult?.explanation) {
        // LLM takes over the primary classification
        meaningful[0].change_type  = llmResult.change_type;
        meaningful[0].explanation  = llmResult.explanation;
      }
    } catch (e) {
      console.warn('[change_engine] LLM classification failed, using rules:', e.message);
    }
  }

  return ruleChanges.map(c => ({
    ...c,
    before_data: before,
    after_data:  after,
    source_link: sourceLink,
  }));
}

/** Simple Levenshtein distance for cosmetic/significant change heuristic */
function levenshteinDistance(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  // Use a 1D DP approach for memory efficiency
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const curr = [i];
    for (let j = 1; j <= n; j++) {
      curr[j] = a[i - 1] === b[j - 1]
        ? prev[j - 1]
        : 1 + Math.min(prev[j - 1], prev[j], curr[j - 1]);
    }
    prev = curr;
    // Short-circuit: if min of prev row > threshold, give up
    if (Math.min(...prev) > 500) return 501;
  }
  return prev[n];
}

module.exports = { classifyChanges, detectChange };
