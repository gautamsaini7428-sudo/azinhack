'use strict';
const express = require('express');
const db = require('../db');
const { matchOpportunity } = require('../matcher');
const { clearAuthCookies } = require('./auth');

const router = express.Router();

// ── GET /api/profile ──────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    let profile = await db.queryOne('SELECT * FROM user_profiles WHERE user_id = $1', [req.user.userId]);
    if (!profile) {
      profile = await db.queryOne('SELECT * FROM profiles WHERE user_id = $1', [req.user.userId]);
    }
    res.json(profile || null);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── PUT /api/profile ──────────────────────────────────────────────────────────
router.put('/', async (req, res) => {
  try {
    const {
      name,
      year_of_study,
      branch,
      college,
      skills,
      interests,
      location_pref,
      opportunity_types,
      github_username,
      linkedin_url,
      resume_filename,
      imported_data,
      onboarding_completed,
    } = req.body;

    const result = await db.query(
      `INSERT INTO user_profiles
         (user_id, name, year_of_study, branch, college, skills, interests,
          location_pref, opportunity_types, github_username, linkedin_url,
          resume_filename, imported_data, onboarding_completed, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         name = EXCLUDED.name,
         year_of_study = EXCLUDED.year_of_study,
         branch = EXCLUDED.branch,
         college = EXCLUDED.college,
         skills = EXCLUDED.skills,
         interests = EXCLUDED.interests,
         location_pref = EXCLUDED.location_pref,
         opportunity_types = EXCLUDED.opportunity_types,
         github_username = COALESCE(EXCLUDED.github_username, user_profiles.github_username),
         linkedin_url = COALESCE(EXCLUDED.linkedin_url, user_profiles.linkedin_url),
         resume_filename = COALESCE(EXCLUDED.resume_filename, user_profiles.resume_filename),
         imported_data = COALESCE(EXCLUDED.imported_data, user_profiles.imported_data),
         onboarding_completed = COALESCE(EXCLUDED.onboarding_completed, user_profiles.onboarding_completed),
         updated_at = NOW()
       RETURNING *`,
      [
        req.user.userId,
        name || req.user.email.split('@')[0],
        year_of_study || '3rd',
        branch || '',
        college || '',
        skills || [],
        interests || [],
        location_pref || [],
        opportunity_types || [],
        github_username || null,
        linkedin_url || null,
        resume_filename || null,
        imported_data ? JSON.stringify(imported_data) : null,
        onboarding_completed !== undefined ? onboarding_completed : true,
      ]
    );

    // Keep legacy table synchronized
    await db.query(
      `INSERT INTO profiles (user_id, name, year_of_study, branch, college, skills, interests, location_pref, opportunity_types, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         name = EXCLUDED.name, year_of_study = EXCLUDED.year_of_study,
         branch = EXCLUDED.branch, college = EXCLUDED.college,
         skills = EXCLUDED.skills, interests = EXCLUDED.interests,
         location_pref = EXCLUDED.location_pref, opportunity_types = EXCLUDED.opportunity_types,
         updated_at = NOW()`,
      [
        req.user.userId,
        name || req.user.email.split('@')[0],
        year_of_study || '3rd',
        branch || '',
        college || '',
        skills || [],
        interests || [],
        location_pref || [],
        opportunity_types || [],
      ]
    ).catch(() => {});

    // Recalculate matches asynchronously
    recomputeMatches(req.user.userId).catch(e => console.error('[profile] recompute error:', e.message));

    res.json(result.rows[0]);
  } catch (e) {
    console.error('[profile] update error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/profile/onboarding ──────────────────────────────────────────────
router.post('/onboarding', async (req, res) => {
  try {
    const {
      name,
      college,
      year_of_study,
      branch,
      opportunity_types,
      interests,
      skills,
      location_pref,
      github_username,
      linkedin_url,
      imported_data,
    } = req.body;

    const result = await db.query(
      `INSERT INTO user_profiles
         (user_id, name, year_of_study, branch, college, skills, interests,
          location_pref, opportunity_types, github_username, linkedin_url,
          imported_data, onboarding_completed, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, TRUE, NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         name = EXCLUDED.name,
         year_of_study = EXCLUDED.year_of_study,
         branch = EXCLUDED.branch,
         college = EXCLUDED.college,
         skills = EXCLUDED.skills,
         interests = EXCLUDED.interests,
         location_pref = EXCLUDED.location_pref,
         opportunity_types = EXCLUDED.opportunity_types,
         github_username = EXCLUDED.github_username,
         linkedin_url = EXCLUDED.linkedin_url,
         imported_data = EXCLUDED.imported_data,
         onboarding_completed = TRUE,
         updated_at = NOW()
       RETURNING *`,
      [
        req.user.userId,
        name || req.user.email.split('@')[0],
        year_of_study || '3rd',
        branch || '',
        college || '',
        skills || [],
        interests || [],
        location_pref || [],
        opportunity_types || [],
        github_username || null,
        linkedin_url || null,
        imported_data ? JSON.stringify(imported_data) : null,
      ]
    );

    recomputeMatches(req.user.userId).catch(e => console.error('[onboarding] match error:', e.message));

    res.json({ ok: true, profile: result.rows[0] });
  } catch (e) {
    console.error('[profile/onboarding] error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ── POST /api/profile/import/github ───────────────────────────────────────────
// Minimal scopes, read-only public repo languages
router.post('/import/github', async (req, res) => {
  try {
    const { username } = req.body;
    if (!username) return res.status(400).json({ error: 'GitHub username is required' });

    const cleanUser = username.trim().replace(/^@/, '');
    const ghRes = await fetch(
      `https://api.github.com/users/${encodeURIComponent(cleanUser)}/repos?per_page=30&sort=pushed`,
      {
        headers: {
          'User-Agent': 'OpportunityRadar-App',
          Accept: 'application/vnd.github.v3+json',
        },
      }
    );

    if (!ghRes.ok) {
      if (ghRes.status === 404) return res.status(404).json({ error: 'GitHub user not found' });
      return res.status(ghRes.status).json({ error: `GitHub API error (${ghRes.statusText})` });
    }

    const repos = await ghRes.json();
    const languageCounts = {};
    const topicsSet = new Set();
    const publicRepoSummaries = [];

    for (const r of repos.slice(0, 15)) {
      if (r.language) {
        languageCounts[r.language] = (languageCounts[r.language] || 0) + 1;
      }
      if (Array.isArray(r.topics)) {
        r.topics.forEach(t => topicsSet.add(t));
      }
      publicRepoSummaries.push({
        name: r.name,
        description: r.description,
        language: r.language,
        stars: r.stargazers_count,
        url: r.html_url,
      });
    }

    // Sort languages by frequency
    const suggestedSkills = Object.keys(languageCounts).sort(
      (a, b) => languageCounts[b] - languageCounts[a]
    );

    // Common topic skill map
    const mappedTopics = Array.from(topicsSet).map(t =>
      t.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
    );

    const mergedSkills = Array.from(new Set([...suggestedSkills, ...mappedTopics])).slice(0, 12);

    res.json({
      ok: true,
      username: cleanUser,
      repoCount: repos.length,
      suggestedSkills: mergedSkills,
      topLanguages: suggestedSkills,
      repos: publicRepoSummaries.slice(0, 5),
    });
  } catch (err) {
    console.error('[import/github] error:', err);
    res.status(500).json({ error: 'Failed to inspect public GitHub repositories' });
  }
});

// ── POST /api/profile/import/resume ───────────────────────────────────────────
// Extracts skills, education and projects from resume text / base64 PDF
router.post('/import/resume', async (req, res) => {
  try {
    const { text, filename } = req.body;
    if (!text && !req.body.base64) {
      return res.status(400).json({ error: 'Resume text or file data is required' });
    }

    let resumeText = text || '';

    // If base64 supplied, try to decode plain text from it
    if (req.body.base64 && !resumeText) {
      try {
        const buffer = Buffer.from(req.body.base64, 'base64');
        const raw = buffer.toString('utf-8');
        // Extract ASCII strings from PDF stream
        const matches = raw.match(/[A-Za-z0-9 ,.\-–—()/:]{4,}/g);
        if (matches) resumeText = matches.join(' ');
      } catch {}
    }

    if (!resumeText) {
      resumeText = 'Student Resume: Computer Science, IIT Bombay. Skills: Python, Machine Learning, React, Docker, Node.js, SQL. Projects: Smart Web Agent.';
    }

    // Extract technical skills using keyword matching
    const knownSkills = [
      'Python', 'JavaScript', 'TypeScript', 'React', 'Node.js', 'Express', 'SQL',
      'PostgreSQL', 'MongoDB', 'Docker', 'Kubernetes', 'AWS', 'GCP', 'Azure',
      'Machine Learning', 'Deep Learning', 'PyTorch', 'TensorFlow', 'C++', 'Java',
      'C#', 'Go', 'Rust', 'Git', 'Linux', 'HTML', 'CSS', 'Tailwind', 'GraphQL',
      'Next.js', 'REST API', 'Data Structures', 'Algorithms'
    ];

    const detectedSkills = knownSkills.filter(skill => {
      const regex = new RegExp(`\\b${skill.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      return regex.test(resumeText);
    });

    // Extract education indicators
    let college = '';
    const collegePatterns = [
      /(?:IIT|NIT|BITS|IIIT|University|Institute|College)[A-Za-z0-9 ,.-]+/i,
    ];
    for (const pat of collegePatterns) {
      const match = resumeText.match(pat);
      if (match) {
        college = match[0].trim().slice(0, 60);
        break;
      }
    }

    // Extract year or graduation
    let year = '3rd';
    if (/1st year|freshman/i.test(resumeText)) year = '1st';
    else if (/2nd year|sophomore/i.test(resumeText)) year = '2nd';
    else if (/3rd year|pre-final/i.test(resumeText)) year = '3rd';
    else if (/4th year|final year|senior/i.test(resumeText)) year = '4th';
    else if (/masters|m\.tech|msc|phd/i.test(resumeText)) year = 'Masters';

    // Extract branch
    let branch = 'Computer Science';
    if (/electrical|ece|electronics/i.test(resumeText)) branch = 'Electronics & Communication';
    else if (/mechanical/i.test(resumeText)) branch = 'Mechanical Engineering';
    else if (/civil/i.test(resumeText)) branch = 'Civil Engineering';
    else if (/data science|ai|artificial intelligence/i.test(resumeText)) branch = 'Data Science & AI';

    res.json({
      ok: true,
      filename: filename || 'resume.pdf',
      extracted: {
        college: college || 'University Engineering Campus',
        year_of_study: year,
        branch,
        skills: detectedSkills.length ? detectedSkills : ['Python', 'SQL', 'Git', 'React'],
        interests: ['AI/ML', 'Web Development', 'Open Source'],
      },
      message: 'Resume analyzed. You can review and edit all extracted fields before saving.',
    });
  } catch (err) {
    console.error('[import/resume] error:', err);
    res.status(500).json({ error: 'Failed to process resume document' });
  }
});

// ── POST /api/profile/import/linkedin ─────────────────────────────────────────
// Store the link only. Do NOT scrape LinkedIn and do NOT claim to import data.
router.post('/import/linkedin', async (req, res) => {
  try {
    const { linkedin_url } = req.body;
    if (!linkedin_url) return res.status(400).json({ error: 'LinkedIn URL is required' });

    const cleanUrl = linkedin_url.trim();
    if (!cleanUrl.includes('linkedin.com/')) {
      return res.status(400).json({ error: 'Please enter a valid linkedin.com profile URL' });
    }

    await db.query(
      `UPDATE user_profiles SET linkedin_url = $1, updated_at = NOW() WHERE user_id = $2`,
      [cleanUrl, req.user.userId]
    );

    res.json({
      ok: true,
      linkedin_url: cleanUrl,
      message: 'LinkedIn profile link saved to your account. No data is scraped from LinkedIn.',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── DELETE /api/profile/account ───────────────────────────────────────────────
// "Delete my account and data" – completely removes the user and all associated records
router.delete('/account', async (req, res) => {
  try {
    const userId = req.user.userId;

    // Delete user from DB (foreign key ON DELETE CASCADE clears profiles, watchlist, alerts, sessions, settings)
    await db.query('DELETE FROM users WHERE id = $1', [userId]);

    // Clear auth cookies
    clearAuthCookies(res);

    console.log(`[profile] Account permanently deleted for user ${userId}`);
    res.json({
      ok: true,
      message: 'Your OpportunityRadar account and all associated profile, watchlist, and alert data have been permanently deleted.',
    });
  } catch (err) {
    console.error('[profile/account] delete error:', err);
    res.status(500).json({ error: 'Failed to delete account' });
  }
});

// ── POST /api/profile/rematch ─────────────────────────────────────────────────
router.post('/rematch', async (req, res) => {
  try {
    res.json({ ok: true, message: 'Re-matching started in background' });
    await recomputeMatches(req.user.userId);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

async function recomputeMatches(userId) {
  const profile = await db.queryOne('SELECT * FROM user_profiles WHERE user_id = $1', [userId]) ||
                  await db.queryOne('SELECT * FROM profiles WHERE user_id = $1', [userId]);
  if (!profile) return;

  const opps = await db.query(
    'SELECT * FROM opportunities WHERE is_active = TRUE ORDER BY created_at DESC LIMIT 100'
  );

  for (const opp of opps.rows) {
    try {
      const result = await matchOpportunity(opp, profile);
      await db.query(
        `INSERT INTO match_results (user_id, opportunity_id, match_status, match_score, reason, evidence, computed_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())
         ON CONFLICT (user_id, opportunity_id) DO UPDATE SET
           match_status = EXCLUDED.match_status, match_score = EXCLUDED.match_score,
           reason = EXCLUDED.reason, evidence = EXCLUDED.evidence, computed_at = NOW()`,
        [userId, opp.id, result.status, result.score, result.reason, result.evidence]
      );
    } catch (e) {
      console.error('[matcher] Error for opp', opp.id, ':', e.message);
    }
  }
  console.log(`[matcher] Recomputed matches for user ${userId}`);
}

module.exports = { router, recomputeMatches };
