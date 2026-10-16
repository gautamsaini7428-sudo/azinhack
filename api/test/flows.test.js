'use strict';
/**
 * OpportunityRadar – Core Flows & Security Regression Test Suite
 * Tests:
 * 1. Change Timeline (before/after values, explanation, source link, detection time)
 * 2. Synchronous Scrape Feedback (/api/sources/:id/check-now returns real counts)
 * 3. Watch and Unwatch agreement across POST, DELETE, and GET /opportunities
 * 4. Calendar export routes (/:id/ics and alias /:id/calendar.ics with RFC 5545 headers)
 * 5. SSRF Protection on source URL submission
 * 6. Conservative & Explainable Matching (no default 85%, confirmed/conflict/unknown breakdown)
 */

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test_secret_key_minimum_32_characters_long_for_security';
const assert = require('assert');
const http = require('http');
const app = require('../src/index');
const db = require('../src/db');
const { evaluateEligibility } = require('../src/matcher');
const { detectChange } = require('../src/change_engine');

let server;
let baseUrl;

async function startServer() {
  return new Promise((resolve) => {
    server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      console.log(`[test-flows] Test server listening on ${baseUrl}`);
      resolve();
    });
  });
}

async function stopServer() {
  return new Promise((resolve) => {
    if (server) server.close(resolve);
    else resolve();
  });
}

async function request(path, options = {}) {
  const url = `${baseUrl}${path}`;
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  const res = await fetch(url, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, headers: res.headers, data: json, text };
}

async function runFlowTests() {
  console.log('\n======================================================');
  console.log('   RUNNING CORE FLOWS & SECURITY REGRESSION TESTS     ');
  console.log('======================================================\n');

  await startServer();
  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ✕ ${name}`);
      console.error(`    ${err.message}`);
      failed++;
    }
  }

  // 1. Setup authenticated user
  let token;
  let user;

  await test('Setup: Register a test student user', async () => {
    const email = `student_${Date.now()}@university.edu`;
    const res = await request('/api/auth/register', {
      method: 'POST',
      body: { name: 'Flow Test Student', email, password: 'SecurePassword123!' },
    });
    assert.strictEqual(res.status, 201, `Registration failed: ${res.text}`);
    assert.ok(res.data.token, 'Token expected in response');
    token = res.data.token;
    user = res.data.user;
  });

  // 2. Change Timeline test
  await test('Change Timeline: GET /api/changes returns detected changes with opportunity & source metadata', async () => {
    // Insert a change record into db
    const changeId = 'test-change-001';
    await db.query(
      `INSERT INTO changes (id, opportunity_id, change_type, before_data, after_data, explanation, detected_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        changeId,
        'opp-002',
        'DEADLINE_CHANGED',
        JSON.stringify({ deadline: '2026-10-20T23:59:00.000Z' }),
        JSON.stringify({ deadline: '2026-11-20T23:59:00.000Z' }),
        'Deadline extended by 30 days based on official announcement.',
        new Date().toISOString(),
      ]
    );

    const res = await request('/api/changes', {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.strictEqual(res.status, 200);
    assert.ok(Array.isArray(res.data.changes), 'Expected changes array');
    const found = res.data.changes.find((c) => c.id === changeId);
    assert.ok(found, 'Inserted change should appear in changes feed');
    assert.strictEqual(found.change_type, 'DEADLINE_CHANGED');
    assert.strictEqual(found.explanation, 'Deadline extended by 30 days based on official announcement.');
    assert.ok(found.detected_at, 'detected_at timestamp must exist');
    assert.ok(found.before_data, 'before_data must exist');
    assert.ok(found.after_data, 'after_data must exist');
    assert.ok(found.opp_title, 'Opportunity title must be joined');
  });

  // 3. Watch and Unwatch flow
  await test('Watch & Unwatch: POST /watch adds, DELETE /watch removes, state agrees in GET /opportunities', async () => {
    const oppId = 'opp-001';

    // Initial state: not watched
    const initRes = await request('/api/opportunities', {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.strictEqual(initRes.status, 200);
    const initOpp = initRes.data.opportunities.find((o) => o.id === oppId);
    assert.ok(initOpp, 'opp-001 should exist');
    assert.strictEqual(Boolean(initOpp.is_watched), false, 'Initially not watched');

    // 1. Watch via POST
    const watchRes = await request(`/api/opportunities/${oppId}/watch`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.strictEqual(watchRes.status, 200);
    assert.strictEqual(watchRes.data.watched, true, 'Watch response must confirm watched: true');

    // Verify GET /opportunities reflects watched
    const watchedListRes = await request('/api/opportunities', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const watchedOpp = watchedListRes.data.opportunities.find((o) => o.id === oppId);
    assert.strictEqual(Boolean(watchedOpp.is_watched), true, 'GET /opportunities must reflect is_watched: true');

    // 2. Unwatch via DELETE
    const unwatchRes = await request(`/api/opportunities/${oppId}/watch`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.strictEqual(unwatchRes.status, 200);
    assert.strictEqual(unwatchRes.data.watched, false, 'Unwatch response must confirm watched: false');

    // Verify GET /opportunities reflects unwatched
    const unwatchedListRes = await request('/api/opportunities', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const unwatchedOpp = unwatchedListRes.data.opportunities.find((o) => o.id === oppId);
    assert.strictEqual(Boolean(unwatchedOpp.is_watched), false, 'GET /opportunities must reflect is_watched: false');
  });

  // 4. Calendar Export Flow (.ics and RFC 5545)
  await test('Calendar Export: /:id/ics and /:id/calendar.ics return valid RFC 5545 iCalendar data', async () => {
    const oppId = 'opp-001';

    // Route 1: /:id/ics
    const res1 = await request(`/api/opportunities/${oppId}/ics`);
    assert.strictEqual(res1.status, 200);
    assert.ok(
      (res1.headers.get('content-type') || '').includes('text/calendar'),
      `Content-Type must be text/calendar, got: ${res1.headers.get('content-type')}`
    );
    assert.ok(res1.text.includes('BEGIN:VCALENDAR'), 'Output must have BEGIN:VCALENDAR');
    assert.ok(res1.text.includes('END:VCALENDAR'), 'Output must have END:VCALENDAR');
    assert.ok(res1.text.includes('SUMMARY:'), 'Output must have SUMMARY');

    // Route 2: /:id/calendar.ics (alias)
    const res2 = await request(`/api/opportunities/${oppId}/calendar.ics`);
    assert.strictEqual(res2.status, 200);
    assert.ok(res2.text.includes('BEGIN:VCALENDAR'), 'Alias route must return valid VCALENDAR');
  });

  // 5. SSRF Validation
  await test('SSRF Protection: Rejects private/loopback IP addresses and cloud metadata', async () => {
    const blockedUrls = [
      'http://127.0.0.1:9999/admin',
      'http://169.254.169.254/latest/meta-data',
      'http://10.0.0.1/internal',
      'http://192.168.1.1/router',
    ];

    for (const url of blockedUrls) {
      const res = await request('/api/sources', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: { label: 'SSRF Attack Test', url, poll_interval: 60 },
      });
      assert.strictEqual(
        res.status,
        400,
        `Expected HTTP 400 blocking SSRF URL ${url}, got ${res.status}: ${res.text}`
      );
      assert.ok(res.data.error.includes('private or loopback'), `Error message should explain private address block for ${url}`);
    }
  });

  // 6. Source Management Authorization
  await test('Security: Source management requires authentication', async () => {
    const unauthAdd = await request('/api/sources', {
      method: 'POST',
      body: { label: 'Unauth Source', url: 'https://example.com/jobs' },
    });
    assert.strictEqual(unauthAdd.status, 401, 'POST /api/sources without auth must return 401');

    const sourcesList = await request('/api/sources');
    const validSourceId = sourcesList.data?.[0]?.id || 'b0000000-0000-0000-0000-000000000001';

    const unauthCheck = await request(`/api/sources/${validSourceId}/check-now`, {
      method: 'POST',
    });
    assert.strictEqual(unauthCheck.status, 401, 'POST /api/sources/:id/check-now without auth must return 401');
  });

  // 7. Synchronous Check-Now Endpoint
  await test('Synchronous Scrape: POST /api/sources/:id/check-now returns real counts and status', async () => {
    const sourcesList = await request('/api/sources');
    const validSourceId = sourcesList.data?.[0]?.id || 'b0000000-0000-0000-0000-000000000001';

    const res = await request(`/api/sources/${validSourceId}/check-now`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.strictEqual(res.status, 200, `Check-now failed: ${res.text}`);
    assert.strictEqual(res.data.ok, true);
    assert.ok(typeof res.data.opportunitiesFound === 'number', 'opportunitiesFound must be a number');
    assert.ok(typeof res.data.changesDetected === 'number', 'changesDetected must be a number');
    assert.ok(Array.isArray(res.data.recentChanges), 'recentChanges must be an array');
  });

  // 8. Conservative Matching Engine
  await test('Conservative Matching: Incomplete profile returns NOT_EVALUATED and null score', () => {
    const opp = {
      title: 'Graduate Fellowship',
      eligibility: 'Must be 4th year student with Python experience.',
      opp_type: 'internship',
    };

    // Empty profile
    const emptyResult = evaluateEligibility(null, opp);
    assert.strictEqual(emptyResult.status, 'NOT_EVALUATED');
    assert.strictEqual(emptyResult.score, null, 'Must NOT default to 0.85!');
    assert.ok(emptyResult.breakdown.unknown.length > 0);

    // Profile missing year
    const partialProfile = { skills: ['Python'] };
    const partialResult = evaluateEligibility(partialProfile, opp);
    assert.strictEqual(partialResult.status, 'NOT_EVALUATED');
    assert.strictEqual(partialResult.score, null, 'Missing study year must result in NOT_EVALUATED');
  });

  await test('Conservative Matching: Detailed criteria breakdown into confirmed, conflicts, and unknown', () => {
    const opp = {
      title: 'Robotics Challenge',
      eligibility: 'Pre-final year (3rd year) students in Computer Science. Knowledge of Python and ROS. Teams of 3.',
      opp_type: 'hackathon',
      deadline: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(),
    };

    const eligibleStudent = {
      year_of_study: '3rd',
      branch: 'Computer Science',
      skills: ['Python', 'ROS', 'C++'],
      gpa: 3.5,
    };

    const result = evaluateEligibility(eligibleStudent, opp);
    assert.strictEqual(result.status, 'MATCH');
    assert.ok(result.score >= 0.8, `Expected strong fit score >= 0.8, got ${result.score}`);
    assert.ok(result.breakdown.confirmed.length >= 2, 'Should have multiple confirmed requirements');
    assert.strictEqual(result.breakdown.conflicts.length, 0, 'Should have 0 conflicts');

    // Conflicting student: 1st year
    const firstYearStudent = {
      year_of_study: '1st',
      branch: 'Electrical Engineering',
      skills: ['Java'],
    };

    const conflictResult = evaluateEligibility(firstYearStudent, opp);
    assert.strictEqual(conflictResult.status, 'NO_MATCH');
    assert.ok(conflictResult.score < 0.5, 'Score should reflect conflict');
    assert.ok(conflictResult.breakdown.conflicts.length >= 1, 'Should list year/branch conflict');
  });

  // 10. GPA and Team Matching Regression
  await test('GPA and Team Matching: Correctly evaluates GPA thresholds and solo/team flags', () => {
    const oppWithGpa = {
      title: 'Competitive Research Internship',
      eligibility: 'Must maintain minimum GPA of 3.5. Open to CS and EE students.',
      opp_type: 'internship',
    };

    // Student meeting GPA
    const highGpaStudent = {
      year_of_study: '3rd',
      branch: 'Computer Science',
      skills: ['Python'],
      gpa: 3.8,
    };
    const resHigh = evaluateEligibility(highGpaStudent, oppWithGpa);
    assert.ok(resHigh.breakdown.confirmed.some((c) => c.includes('GPA requirement met')), 'High GPA student should meet requirement');
    assert.strictEqual(resHigh.breakdown.conflicts.length, 0);

    // Student failing GPA
    const lowGpaStudent = {
      year_of_study: '3rd',
      branch: 'Computer Science',
      skills: ['Python'],
      gpa: 3.2,
    };
    const resLow = evaluateEligibility(lowGpaStudent, oppWithGpa);
    assert.ok(resLow.breakdown.conflicts.some((c) => c.includes('GPA conflict')), 'Low GPA student should have conflict');
    assert.strictEqual(resLow.status, 'NO_MATCH');

    // Student without GPA recorded
    const unknownGpaStudent = {
      year_of_study: '3rd',
      branch: 'Computer Science',
      skills: ['Python'],
    };
    const resUnknown = evaluateEligibility(unknownGpaStudent, oppWithGpa);
    assert.ok(resUnknown.breakdown.unknown.some((u) => u.includes('Minimum GPA required')), 'Missing GPA should be unknown');
  });

  // 11. Change Classification Engine
  await test('Change Engine: Accurately classifies changes and flags COSMETIC diffs', () => {
    // Deadline shift
    const dlChanges = detectChange(
      { deadline: '2026-11-01T00:00:00.000Z' },
      { deadline: '2026-12-01T00:00:00.000Z' }
    );
    assert.strictEqual(dlChanges[0].change_type, 'DEADLINE_CHANGED');
    assert.ok(dlChanges[0].explanation.includes('Deadline moved from'));

    // Eligibility rewrite
    const eligChanges = detectChange(
      { eligibility: 'Open to all second and third year engineering students.' },
      { eligibility: 'Open strictly to Final Year (4th year) engineering students only. Graduating class required.' }
    );
    assert.strictEqual(eligChanges[0].change_type, 'ELIGIBILITY_CHANGED');

    // Reward adjustment
    const rewChanges = detectChange(
      { reward: '10,000 INR prize' },
      { reward: '25,000 INR prize' }
    );
    assert.strictEqual(rewChanges[0].change_type, 'REWARD_CHANGED');

    // Listing closed
    const closedChanges = detectChange(
      { status: 'open', is_dead: false },
      { status: 'closed', is_dead: true }
    );
    assert.strictEqual(closedChanges[0].change_type, 'LISTING_CLOSED');

    // Cosmetic change
    const cosmeticChanges = detectChange(
      { eligibility: 'Open to all students.' },
      { eligibility: 'Open to all students. ' }
    );
    assert.strictEqual(cosmeticChanges[0].change_type, 'COSMETIC');
  });

  // 12. Token Security Regression: Refresh tokens excluded from bodies
  await test('Security: Refresh tokens are excluded from response bodies', async () => {
    const loginRes = await request('/api/auth/demo-login', {
      method: 'POST',
    });
    assert.strictEqual(loginRes.status, 200);
    assert.ok(loginRes.data.token, 'Access token must be present');
    assert.strictEqual(loginRes.data.refreshToken, undefined, 'refreshToken must NOT be returned in JSON body');
    const setCookie = loginRes.headers.get('set-cookie') || '';
    assert.ok(setCookie.includes('HttpOnly'), 'Refresh cookie must have HttpOnly attribute');
  });

  await stopServer();

  console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

runFlowTests().catch((err) => {
  console.error('Fatal error in flows test:', err);
  process.exit(1);
});
