process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test_secret_key_minimum_32_characters_long_for_security';
const assert = require('assert');
const http = require('http');
const app = require('../src/index');

let server;
let API_BASE;

async function startServer() {
  return new Promise((resolve) => {
    server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      API_BASE = `http://127.0.0.1:${port}`;
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
  const url = `${API_BASE}${path}`;
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

async function runTests() {
  await startServer();
  console.log('\n======================================================');
  console.log(' RUNNING PROFILE-TO-ELIGIBILITY MATCHING PIPELINE TESTS');
  console.log('======================================================\n');

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

  let token = null;
  let userId = null;

  // Step 1: Register a new test user
  await test('1. Register test student user', async () => {
    const email = `pipeline_student_${Date.now()}@test.edu`;
    const res = await request('/api/auth/register', {
      method: 'POST',
      body: { name: 'Pipeline Tester', email, password: 'PipelinePassword123!' },
    });
    assert.strictEqual(res.status, 201, `Registration failed: ${res.text}`);
    assert.ok(res.data.token, 'Token expected');
    token = res.data.token;
    userId = res.data.user.id;
  });

  // Step 2: Fresh user has no profile or pending evaluation
  await test('2. Fresh user initial state without completed profile', async () => {
    const oppRes = await request('/api/opportunities', {
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.strictEqual(oppRes.status, 200);
    assert.ok(Array.isArray(oppRes.data.opportunities));
    // Since matches haven't been computed yet for fresh user, match_status is null
    oppRes.data.opportunities.forEach(o => {
      assert.strictEqual(o.match_status, null, 'Un-evaluated opportunity should have null match_status');
    });
  });

  // Step 3: Save complete profile via PUT /api/profile
  let savedProfileResponse = null;
  await test('3. Save complete profile via PUT /api/profile and verify contract & GPA persistence', async () => {
    const profilePayload = {
      name: 'Aditya Verma',
      year_of_study: '3rd',
      branch: 'Computer Science',
      college: 'BITS Pilani',
      gpa: 3.85,
      skills: ['Python', 'Machine Learning', 'React', 'Docker', 'SQL'],
      interests: ['AI/ML', 'Robotics', 'Climate Tech'],
      location_pref: ['Remote', 'Bangalore'],
      opportunity_types: ['internship', 'hackathon', 'scholarship'],
    };

    const putRes = await request('/api/profile', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}` },
      body: profilePayload,
    });

    assert.strictEqual(putRes.status, 200, `PUT /api/profile failed: ${putRes.text}`);
    savedProfileResponse = putRes.data;

    // Verify response contract: both res.profile and top-level properties exist
    assert.ok(savedProfileResponse.profile, 'res.profile must exist for frontend contract');
    assert.strictEqual(savedProfileResponse.profile.name, 'Aditya Verma');
    assert.strictEqual(savedProfileResponse.profile.year_of_study, '3rd');
    assert.strictEqual(savedProfileResponse.profile.branch, 'Computer Science');
    assert.strictEqual(savedProfileResponse.profile.college, 'BITS Pilani');
    assert.strictEqual(savedProfileResponse.profile.gpa, 3.85, 'GPA must be returned on profile');
    assert.deepStrictEqual(savedProfileResponse.profile.skills, ['Python', 'Machine Learning', 'React', 'Docker', 'SQL']);
    assert.strictEqual(savedProfileResponse.matches_recomputed, true, 'Matches should be recomputed synchronously');
  });

  // Step 4: Verify with a fresh GET /api/profile
  await test('4. Verify saved profile with fresh GET /api/profile', async () => {
    const getRes = await request('/api/profile', {
      headers: { Authorization: `Bearer ${token}` },
    });

    assert.strictEqual(getRes.status, 200);
    const prof = getRes.data;
    assert.strictEqual(prof.name, 'Aditya Verma');
    assert.strictEqual(prof.year_of_study, '3rd');
    assert.strictEqual(prof.branch, 'Computer Science');
    assert.strictEqual(prof.gpa, 3.85, 'GPA must be accurately persisted and returned');
    assert.ok(prof.skills.includes('Python'));
    assert.ok(prof.skills.includes('React'));
  });

  // Step 5: Reload opportunities and verify real computed match scores
  await test('5. GET /api/opportunities returns actual calculated match scores and breakdowns', async () => {
    const oppRes = await request('/api/opportunities', {
      headers: { Authorization: `Bearer ${token}` },
    });

    assert.strictEqual(oppRes.status, 200);
    const opps = oppRes.data.opportunities;
    assert.ok(opps.length > 0, 'Opportunities must be returned');

    // Find opp-001 (Northwind Labs Fellowship: CS/Python/undergrad)
    const opp1 = opps.find(o => o.id === 'opp-001');
    assert.ok(opp1, 'opp-001 should exist');
    assert.ok(opp1.match, 'opp-001 must have computed match object');
    assert.strictEqual(opp1.match.status, 'MATCH');
    assert.ok(opp1.match.score >= 0.80, `Expected score >= 0.80, got ${opp1.match.score}`);
    assert.strictEqual(opp1.match.fitLabel, 'Strong Fit');
    assert.ok(opp1.match.breakdown.confirmed.length >= 2, 'Should have confirmed skills and academic standing');
    assert.strictEqual(opp1.match.breakdown.conflicts.length, 0);

    // Find opp-003 (Meridian STEM Scholarship: min GPA 3.2, CS/DS/EE, 2nd or 3rd year)
    const opp3 = opps.find(o => o.id === 'opp-003');
    assert.ok(opp3, 'opp-003 should exist');
    assert.ok(opp3.match, 'opp-003 must have computed match object');
    assert.strictEqual(opp3.match.status, 'MATCH');
    assert.ok(opp3.match.breakdown.confirmed.some(c => c.includes('GPA requirement met')), 'Should confirm student GPA (3.85) meets minimum GPA (3.2)');

    // Find opp-006 (Helios CleanTech: expired deadline & closed)
    const opp6 = opps.find(o => o.id === 'opp-006');
    assert.ok(opp6, 'opp-006 should exist');
    assert.ok(opp6.match, 'opp-006 must have computed match object');
    assert.strictEqual(opp6.match.status, 'NO_MATCH');
    assert.ok(opp6.match.breakdown.conflicts.some(c => c.includes('closed') || c.includes('expired')), 'Should detect conflict for closed opportunity');
  });

  // Step 6: Test incomplete profile evaluation
  await test('6. Incomplete profile returns NOT_EVALUATED without crashing or fabricated scores', async () => {
    // Register another user who only has year, no branch and no skills
    const emailInc = `incomplete_${Date.now()}@test.edu`;
    const regRes = await request('/api/auth/register', {
      method: 'POST',
      body: { name: 'Incomplete User', email: emailInc, password: 'Password123!' },
    });
    const incToken = regRes.data.token;

    // Save incomplete profile
    const putRes = await request('/api/profile', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${incToken}` },
      body: {
        name: 'Incomplete User',
        year_of_study: '',
        branch: '',
        skills: [],
      },
    });
    assert.strictEqual(putRes.status, 200);

    const oppRes = await request('/api/opportunities', {
      headers: { Authorization: `Bearer ${incToken}` },
    });
    assert.strictEqual(oppRes.status, 200);
    const opps = oppRes.data.opportunities;
    opps.forEach(o => {
      assert.strictEqual(o.match.status, 'NOT_EVALUATED');
      assert.strictEqual(o.match.score, null, 'Score must be null for incomplete profile');
      assert.strictEqual(o.match.fitLabel, 'Not Evaluated');
      assert.ok(o.match.reason.includes('Profile lacks academic and technical details'));
    });
  });

  // Step 7: Test rematch endpoint
  await test('7. POST /api/profile/rematch triggers recalculation and returns success', async () => {
    const rematchRes = await request('/api/profile/rematch', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.strictEqual(rematchRes.status, 200);
    assert.strictEqual(rematchRes.data.ok, true);
  });

  console.log('\n------------------------------------------------------');
  console.log(`TOTAL: ${passed} PASSED, ${failed} FAILED`);
  console.log('------------------------------------------------------\n');
  await stopServer();
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
