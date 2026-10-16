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
 * Conservative, explainable rule-based matching engine.
 * Categorizes criteria into confirmed matches, conflicts, and unknown requirements.
 * Calibrates fit score (0.00–1.00 index) and returns NOT_EVALUATED when profile is incomplete.
 */
function evaluateEligibility(arg1, arg2) {
  let opportunity = arg1;
  let profile = arg2;

  // Detect reversed arguments: (profile, opportunity)
  if (arg1 && (arg1.skills || arg1.year_of_study || arg1.branch) && arg2 && (arg2.eligibility || arg2.title || arg2.opp_type)) {
    profile = arg1;
    opportunity = arg2;
  } else if (!arg1 && arg2 && (arg2.eligibility || arg2.title || arg2.opp_type)) {
    profile = arg1;
    opportunity = arg2;
  }

  const hasYear = Boolean(profile && profile.year_of_study);
  const hasBranch = Boolean(profile && profile.branch);
  const hasSkills = Boolean(profile && profile.skills && profile.skills.length > 0);

  if (!profile || !hasYear || (!hasBranch && !hasSkills)) {
    return {
      status: 'NOT_EVALUATED',
      score: null,
      fitLabel: 'Not Evaluated',
      breakdown: {
        confirmed: [],
        conflicts: [],
        unknown: ['Student profile is incomplete. Please set your academic year, branch, and skills.'],
      },
      reason: 'Not evaluated: Profile lacks academic and technical details required for eligibility check.',
      evidence: opportunity?.eligibility || '',
    };
  }

  const opp = opportunity || {};
  const eligText = (opp.eligibility || '').toLowerCase();
  const confirmed = [];
  const conflicts = [];
  const unknown = [];

  const now = new Date();

  // 1. Opportunity Lifecycle / Deadline
  if (opp.is_dead) {
    conflicts.push('Listing is closed or marked inactive by the organizer.');
  }

  if (opp.deadline) {
    const dl = new Date(opp.deadline);
    if (!isNaN(dl.getTime())) {
      if (dl < now) {
        conflicts.push(`Application deadline expired on ${dl.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}.`);
      } else {
        const daysLeft = Math.ceil((dl - now) / 86400000);
        confirmed.push(`Active application window: ${daysLeft} days remaining.`);
      }
    }
  }

  // 2. Category / Opportunity Type
  if (profile.opportunity_types && Array.isArray(profile.opportunity_types) && opp.opp_type) {
    if (profile.opportunity_types.includes(opp.opp_type)) {
      confirmed.push(`Opportunity type matches preference (${opp.opp_type}).`);
    } else {
      conflicts.push(`Opportunity type (${opp.opp_type}) is not in your preferred list (${profile.opportunity_types.join(', ')}).`);
    }
  }

  // 3. Academic Year Requirements
  const userYear = (profile.year_of_study || '').toLowerCase();
  const isFinalYearStrict = /strictly to final year|final year strictly|only final year|final year students only|graduating class only/i.test(opp.eligibility || '');
  const mentionsFinalYear = /4th year|final year|graduating class|senior/i.test(opp.eligibility || '');
  const mentionsPreFinal = /3rd year|pre-final|third year|penultimate/i.test(opp.eligibility || '');
  const mentionsUndergrad = /undergraduate|enrolled in an accredited|ug students|b\.?tech|b\.?e\.?/i.test(opp.eligibility || '');

  if (isFinalYearStrict || mentionsFinalYear) {
    if (userYear.includes('4th') || userYear.includes('final')) {
      confirmed.push('Academic year verified: Final year / graduating student.');
    } else if (isFinalYearStrict) {
      conflicts.push(`Year restriction: Strictly restricted to Final Year students (your profile is ${profile.year_of_study || 'unspecified'}).`);
    } else if (userYear.includes('3rd') && mentionsPreFinal) {
      confirmed.push('Academic year verified: Pre-final / 3rd year student.');
    } else if (!userYear.includes('4th')) {
      conflicts.push(`Academic year preference: Listing prioritizes final year students (your profile: ${profile.year_of_study || 'unspecified'}).`);
    }
  } else if (mentionsPreFinal) {
    if (userYear.includes('3rd') || userYear.includes('pre-final')) {
      confirmed.push('Academic year verified: Pre-final / 3rd year student.');
    } else {
      conflicts.push(`Year restriction: Prioritizes pre-final year students (your profile is ${profile.year_of_study || 'unspecified'}).`);
    }
  } else if (mentionsUndergrad) {
    if (['1st', '2nd', '3rd', '4th'].some(y => userYear.includes(y))) {
      confirmed.push('Academic standing verified: Enrolled university undergraduate student.');
    } else {
      unknown.push('Requires verified enrollment in an accredited university undergraduate program.');
    }
  }

  // 4. Branch / Academic Discipline
  const userBranch = (profile.branch || '').toLowerCase();
  const branchOpenToAll = /any engineering|any discipline|open to all|all branches|any computing/i.test(opp.eligibility || '');
  const branchMentionsCS = /computer science|software engineering|information technology|data science|computing/i.test(opp.eligibility || '');
  const branchMentionsRobotics = /robotics|embedded systems|electrical|electronics/i.test(opp.eligibility || '');
  const branchMentionsCleanTech = /energy|battery|clean ?tech|microgrids/i.test(opp.eligibility || '');

  if (branchOpenToAll) {
    confirmed.push(`Discipline verified: Open to all engineering branches (matches ${profile.branch || 'engineering'}).`);
  } else if (userBranch && eligText.includes(userBranch)) {
    confirmed.push(`Major explicitly matched: ${profile.branch}.`);
  } else if (branchMentionsCS) {
    if (/computer|software|data|cs|it/i.test(userBranch)) {
      confirmed.push(`Major aligned with computing requirement (${profile.branch}).`);
    } else if (userBranch) {
      conflicts.push(`Discipline mismatch: Program seeks computing/software majors (your profile: ${profile.branch}).`);
    } else {
      unknown.push('Listing prioritizes computer science / software disciplines.');
    }
  } else if (branchMentionsRobotics) {
    if (/robotics|electrical|electronics|ece|mech/i.test(userBranch)) {
      confirmed.push(`Major aligned with robotics/systems engineering (${profile.branch}).`);
    } else {
      unknown.push('Listing highlights specialized engineering (robotics, embedded systems, or hardware).');
    }
  } else if (branchMentionsCleanTech) {
    unknown.push('Requires verified research or coursework in renewable energy / clean tech.');
  }

  // 5. Technical Skills
  const userSkills = Array.isArray(profile.skills) ? profile.skills : [];
  const matchedSkills = userSkills.filter(s => eligText.includes(s.toLowerCase()));

  if (matchedSkills.length > 0) {
    confirmed.push(`Technical skills matched: ${matchedSkills.join(', ')}.`);
  }

  // Check for common required skills in opportunity that the student might not have
  const commonTechStack = ['python', 'typescript', 'go', 'react', 'robotics', 'machine learning', 'embedded', 'sql', 'docker'];
  const missingExplicit = commonTechStack.filter(s => eligText.includes(s) && !userSkills.some(us => us.toLowerCase() === s));
  if (missingExplicit.length > 0) {
    unknown.push(`Listing highlights skills not listed in your profile: ${missingExplicit.map(s => s.toUpperCase()).join(', ')}.`);
  }

  // 6. GPA & Academic Performance
  const gpaMatch = (opp.eligibility || '').match(/(?:minimum\s+)?(?:gpa|cgpa)\s*(?:of\s*|[:=]\s*)?([0-9.]+)/i);
  if (gpaMatch) {
    const requiredGpa = parseFloat(gpaMatch[1]);
    const rawGpa = profile.gpa ?? profile.cgpa ?? (profile.imported_data && typeof profile.imported_data === 'object' ? (profile.imported_data.gpa ?? profile.imported_data.cgpa) : null);
    const studentGpa = rawGpa !== null && rawGpa !== undefined && rawGpa !== '' ? parseFloat(rawGpa) : null;

    if (studentGpa !== null && !isNaN(studentGpa) && !isNaN(requiredGpa)) {
      if (studentGpa >= requiredGpa) {
        confirmed.push(`Academic GPA requirement met: Your GPA/CGPA (${studentGpa}) meets or exceeds the required minimum (${requiredGpa}).`);
      } else {
        conflicts.push(`Academic GPA conflict: Program requires minimum GPA/CGPA of ${requiredGpa} (your profile is ${studentGpa}).`);
      }
    } else {
      unknown.push(`Minimum GPA required: ${gpaMatch[1]} (verify your official academic transcript).`);
    }
  }

  // 7. Team Participation
  const teamMatch = (opp.eligibility || '').match(/teams?(?:\s+of)?\s+([0-9]+(?:\s*(?:to|-)\s*[0-9]+)?)/i);
  const soloOnly = /individual\s+participation\s+only|solo\s+(?:applicants|hackers|participants)\s+only/i.test(opp.eligibility || '');
  if (soloOnly) {
    confirmed.push('Individual / solo participation listing.');
  } else if (teamMatch) {
    unknown.push(`Team participation required (${teamMatch[0]}).`);
  }

  // 8. Location & Remote
  const isRemote = /remote|online|virtual/i.test(opp.eligibility || '') || /remote/i.test(opp.title || '');
  const userWantsRemote = Array.isArray(profile.location_pref) && profile.location_pref.some(l => l.toLowerCase() === 'remote');
  if (isRemote && userWantsRemote) {
    confirmed.push('Remote/online format matches your location preferences.');
  } else if (!isRemote && /in-person|on-site/i.test(opp.eligibility || '')) {
    unknown.push('In-person attendance may be required at the organizer venue.');
  }

  // ── Calculate Calibrated Fit Index (0.00 – 1.00) ──────────────────────────
  let status = 'PARTIAL';
  let score = 0.50;
  let fitLabel = 'Moderate Fit';

  if (conflicts.length > 0) {
    const isHardDisqualification = conflicts.some(c => c.includes('expired') || c.includes('closed') || c.includes('Strictly restricted'));
    status = 'NO_MATCH';
    score = isHardDisqualification ? 0.05 : Math.max(0.15, 0.40 - conflicts.length * 0.10);
    fitLabel = isHardDisqualification ? 'Ineligible' : 'Criteria Conflict';
  } else if (confirmed.length >= 2) {
    status = 'MATCH';
    score = Math.min(0.98, 0.80 + (confirmed.length - 2) * 0.05);
    fitLabel = 'Strong Fit';
  } else if (confirmed.length >= 1) {
    status = 'PARTIAL';
    score = 0.55 + confirmed.length * 0.10;
    fitLabel = 'Moderate Fit';
  } else {
    status = 'PARTIAL';
    score = 0.35;
    fitLabel = 'Unverified Fit';
  }

  const reasonParts = [];
  if (confirmed.length > 0) reasonParts.push(`Confirmed: ${confirmed.slice(0, 2).join(' ')}`);
  if (conflicts.length > 0) reasonParts.push(`Conflict: ${conflicts[0]}`);
  if (unknown.length > 0 && conflicts.length === 0) reasonParts.push(`Needs verification: ${unknown[0]}`);

  const reason = reasonParts.join(' | ') || 'Profile evaluated against published eligibility terms.';

  return {
    status,
    score: Math.round(score * 100) / 100,
    fitLabel,
    breakdown: { confirmed, conflicts, unknown },
    reason,
    evidence: opp.eligibility || '',
  };
}

/**
 * Main match function.
 * @param {object} opportunity  – row from opportunities table
 * @param {object} profile      – student profile record
 * @returns {Promise<{ status: string, score: number|null, fitLabel: string, breakdown: object, reason: string, evidence: string }>}
 */
async function matchOpportunity(opportunity, profile) {
  const result = evaluateEligibility(opportunity, profile);

  // Enhance explanation via LLM if an API key is actively configured
  if (OPENAI_API_KEY && result.status !== 'NOT_EVALUATED') {
    try {
      const llmResult = await llmJson(
        'You are an expert student opportunity eligibility adviser. Given a student profile and an opportunity listing, confirm whether the student qualifies. Return JSON: {"status":"MATCH|PARTIAL|NO_MATCH","reason":"concise 1-sentence explanation of fit or disqualification","evidence":"exact quotation from eligibility text"}',
        `Student profile: ${JSON.stringify({ year: profile.year_of_study, branch: profile.branch, skills: profile.skills, types: profile.opportunity_types })}
Opportunity: ${JSON.stringify({ title: opportunity.title, type: opportunity.opp_type, eligibility: opportunity.eligibility, deadline: opportunity.deadline })}`
      );
      if (llmResult?.status && llmResult?.reason) {
        // Only accept LLM status if it agrees or refines conservative boundaries
        result.reason = llmResult.reason;
        if (llmResult.evidence) result.evidence = llmResult.evidence;
      }
    } catch (e) {
      console.warn('[matcher] LLM refinement skipped:', e.message);
    }
  }

  return result;
}

module.exports = { matchOpportunity, evaluateEligibility };

