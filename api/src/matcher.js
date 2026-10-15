'use strict';
/**
 * Matching Engine
 * Compares an opportunity to a student profile and returns
 * MATCH / PARTIAL / NO_MATCH with a plain-language reason.
 *
 * Uses an LLM call for explanation generation (falls back to rule-based if no key).
 */

const https = require('https');

const LLM_MODEL = process.env.LLM_MODEL || 'gpt-4o-mini';
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

/** Call OpenAI-compatible chat completions and expect JSON back */
async function llmJson(systemPrompt, userPrompt) {
  if (!OPENAI_API_KEY) {
    // Return a mock response for demo mode
    return null;
  }
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: LLM_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1,
      max_tokens: 400,
    });
    const url = new (require('url').URL)(`${OPENAI_BASE_URL}/chat/completions`);
    const options = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const req = require('https').request(options, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          const content = parsed.choices?.[0]?.message?.content;
          resolve(content ? JSON.parse(content) : null);
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/**
 * Rule-based matching (no LLM needed for basic signal)
 * Returns { score: 0-1, signals: string[] }
 */
function ruleBasedMatch(opportunity, profile) {
  const signals = [];
  let score = 0;
  const opp = opportunity;

  // Type match
  if (profile.opportunity_types && opp.opp_type) {
    if (profile.opportunity_types.includes(opp.opp_type)) {
      score += 0.3;
      signals.push(`Type matches (${opp.opp_type})`);
    } else {
      signals.push(`Type mismatch: you want ${profile.opportunity_types.join('/')}, this is ${opp.opp_type}`);
    }
  }

  // Eligibility text – keyword check against profile
  const eligText = (opp.eligibility || '').toLowerCase();
  let eligScore = 0;
  if (profile.branch && eligText.includes(profile.branch.toLowerCase())) { eligScore += 0.15; signals.push(`Branch "${profile.branch}" mentioned in eligibility`); }
  if (profile.year_of_study) {
    const yearMap = { '1st': ['1st year', 'first year', 'freshman'], '2nd': ['2nd year', 'second year'], '3rd': ['3rd year', 'third year', 'pre-final'], '4th': ['4th year', 'final year', 'senior'] };
    const aliases = yearMap[profile.year_of_study] || [];
    if (aliases.some(a => eligText.includes(a))) { eligScore += 0.1; signals.push(`Year of study (${profile.year_of_study}) matches eligibility`); }
  }
  if (profile.skills) {
    const matchedSkills = profile.skills.filter(s => eligText.includes(s.toLowerCase()));
    if (matchedSkills.length > 0) { eligScore += Math.min(0.2, matchedSkills.length * 0.05); signals.push(`Skills match: ${matchedSkills.join(', ')}`); }
  }
  score += eligScore;

  // Deadline – is it not expired?
  if (opp.deadline) {
    const dl = new Date(opp.deadline);
    const now = new Date();
    if (dl > now) {
      const daysLeft = Math.floor((dl - now) / 86400000);
      score += 0.15;
      signals.push(`Deadline is ${daysLeft} days away`);
    } else {
      score -= 0.3;
      signals.push('Deadline has already passed');
    }
  }

  // Active listing
  if (opp.is_dead) { score -= 0.5; signals.push('Listing is marked as closed'); }

  // Location
  if (profile.location_pref && opp.eligibility) {
    const hasRemote = eligText.includes('remote') || eligText.includes('online');
    if (hasRemote && profile.location_pref.includes('Remote')) { score += 0.1; signals.push('Remote/online eligible'); }
  }

  return { score: Math.max(0, Math.min(1, score)), signals };
}

/**
 * Main match function.
 * @param {object} opportunity  – row from opportunities table
 * @param {object} profile      – row from profiles table
 * @returns {{ status: string, score: number, reason: string, evidence: string }}
 */
async function matchOpportunity(opportunity, profile) {
  const { score, signals } = ruleBasedMatch(opportunity, profile);

  let status;
  if (score >= 0.55) status = 'MATCH';
  else if (score >= 0.25) status = 'PARTIAL';
  else status = 'NO_MATCH';

  let reason = signals.join('. ');
  let evidence = opportunity.eligibility || '';

  // Enhance with LLM if available
  if (OPENAI_API_KEY) {
    try {
      const llmResult = await llmJson(
        'You are an opportunity matching assistant. Given a student profile and an opportunity, decide MATCH/PARTIAL/NO_MATCH. Return JSON: {"status":"MATCH|PARTIAL|NO_MATCH","reason":"one sentence plain language explanation","evidence":"exact quote from eligibility text that is most relevant"}',
        `Student profile: ${JSON.stringify({ year: profile.year_of_study, branch: profile.branch, skills: profile.skills, interests: profile.interests, location: profile.location_pref, types: profile.opportunity_types })}
Opportunity: ${JSON.stringify({ title: opportunity.title, type: opportunity.opp_type, eligibility: opportunity.eligibility, deadline: opportunity.deadline, reward: opportunity.reward })}`
      );
      if (llmResult) {
        status = llmResult.status || status;
        reason = llmResult.reason || reason;
        evidence = llmResult.evidence || evidence;
      }
    } catch (e) {
      console.warn('[matcher] LLM call failed, using rule-based:', e.message);
    }
  }

  return { status, score, reason, evidence };
}

module.exports = { matchOpportunity };
