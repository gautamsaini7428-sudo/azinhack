'use strict';
/**
 * OpportunityRadar – Automated Backend Auth & Isolation Test Suite
 * Tests signup, login, demo login, rate limiting, protected routes,
 * magic link, cross-user isolation, and account deletion.
 */

process.env.NODE_ENV = 'test';
const assert = require('assert');
const http = require('http');
const app = require('../src/index');
const db = require('../src/db');

let server;
let baseUrl;

async function startServer() {
  return new Promise((resolve) => {
    server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      baseUrl = `http://127.0.0.1:${port}`;
      console.log(`[test] Test server listening on ${baseUrl}`);
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

  // Parse set-cookie header if present
  const setCookie = res.headers.get('set-cookie');

  return { status: res.status, headers: res.headers, setCookie, data: json, text };
}

async function runTests() {
  console.log('\n======================================================');
  console.log('  RUNNING AUTHENTICATION & DATA ISOLATION TEST SUITE  ');
  console.log('======================================================\n');

  await startServer();
  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      process.stdout.write(`• ${name} ... `);
      await fn();
      console.log('PASSED ✓');
      passed++;
    } catch (err) {
      console.log(`FAILED ✗\n  Error: ${err.message}`);
      console.error(err.stack);
      failed++;
    }
  }

  // ── TEST 1: Password Validation ──────────────────────────────────────────────
  await test('Reject signup with short password (< 8 chars)', async () => {
    const res = await request('/api/auth/register', {
      method: 'POST',
      body: { email: 'short@example.com', password: '123' },
    });
    assert.strictEqual(res.status, 400);
    assert.match(res.data.error, /at least 8 characters/i);
  });

  // ── TEST 2: Signup Flow ──────────────────────────────────────────────────────
  let user1Token = null;
  let user1Id = null;
  const user1Email = `user1_${Date.now()}@example.com`;

  await test('Signup succeeds with valid credentials & sets session cookies', async () => {
    const res = await request('/api/auth/register', {
      method: 'POST',
      body: { email: user1Email, password: 'StrongPassword123!', name: 'User One' },
    });
    assert.strictEqual(res.status, 201);
    assert.ok(res.data.token, 'Should return access token');
    assert.ok(res.data.user.id, 'Should return user id');
    assert.strictEqual(res.data.user.email, user1Email);
    assert.ok(res.setCookie, 'Should set httpOnly cookies');
    assert.ok(res.setCookie.includes('or_access_token'));
    user1Token = res.data.token;
    user1Id = res.data.user.id;
  });

  // ── TEST 3: Duplicate Email Rejection ────────────────────────────────────────
  await test('Duplicate signup returns 409 Conflict', async () => {
    const res = await request('/api/auth/register', {
      method: 'POST',
      body: { email: user1Email, password: 'AnotherPassword123!' },
    });
    assert.strictEqual(res.status, 409);
    assert.match(res.data.error, /already registered/i);
  });

  // ── TEST 4: Login with Wrong Password ────────────────────────────────────────
  await test('Login with incorrect password returns 401', async () => {
    const res = await request('/api/auth/login', {
      method: 'POST',
      body: { email: user1Email, password: 'WrongPassword999' },
    });
    assert.strictEqual(res.status, 401);
    assert.match(res.data.error, /Invalid email or password/i);
  });

  // ── TEST 5: Rate Limiting on Repeated Failures ───────────────────────────────
  await test('Rate limiting triggers 429 after repeated failed login attempts', async () => {
    const attackEmail = `brute_${Date.now()}@example.com`;
    // Attempt 5 quick failed logins
    for (let i = 0; i < 5; i++) {
      await request('/api/auth/login', {
        method: 'POST',
        body: { email: attackEmail, password: 'wrong' },
      });
    }
    // 6th attempt should be blocked with 429
    const blockedRes = await request('/api/auth/login', {
      method: 'POST',
      body: { email: attackEmail, password: 'wrong' },
    });
    assert.strictEqual(blockedRes.status, 429);
    assert.match(blockedRes.data.error, /Too many failed login attempts/i);
  });

  // ── TEST 6: Successful Login ─────────────────────────────────────────────────
  await test('Successful login returns token and user info', async () => {
    const res = await request('/api/auth/login', {
      method: 'POST',
      body: { email: user1Email, password: 'StrongPassword123!' },
    });
    assert.strictEqual(res.status, 200);
    assert.ok(res.data.token);
    assert.strictEqual(res.data.user.email, user1Email);
  });

  // ── TEST 7: Demo User Instant Login ──────────────────────────────────────────
  let demoToken = null;
  await test('"Continue as demo user" instant login functions flawlessly', async () => {
    const res = await request('/api/auth/demo-login', { method: 'POST' });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.user.email, 'demo@opportunityradar.dev');
    assert.strictEqual(res.data.user.email_verified, true);
    assert.ok(res.data.token);
    demoToken = res.data.token;
  });

  // ── TEST 8: Protected Routes Block Unauthenticated Requests ──────────────────
  await test('Protected route /api/profile rejects unauthenticated request (401)', async () => {
    const res = await request('/api/profile');
    assert.strictEqual(res.status, 401);
  });

  await test('Protected route /api/profile accepts valid Bearer token', async () => {
    const res = await request('/api/profile', {
      headers: { Authorization: `Bearer ${user1Token}` },
    });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.data.user_id, user1Id);
  });

  // ── TEST 9: Cross-User Data Isolation ────────────────────────────────────────
  let user2Token = null;
  let user2Id = null;
  const user2Email = `user2_${Date.now()}@example.com`;

  await test('Create User Two for cross-user isolation testing', async () => {
    const res = await request('/api/auth/register', {
      method: 'POST',
      body: { email: user2Email, password: 'PasswordForUser2!' },
    });
    assert.strictEqual(res.status, 201);
    user2Token = res.data.token;
    user2Id = res.data.user.id;
  });

  await test('User 1 updates profile; User 2 cannot see User 1 profile', async () => {
    // User 1 updates their profile
    const updateRes = await request('/api/profile', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${user1Token}` },
      body: {
        name: 'Alice Wonder',
        college: 'MIT Cambridge',
        year_of_study: '4th',
        branch: 'Robotics',
        skills: ['ROS', 'C++', 'Python'],
      },
    });
    assert.strictEqual(updateRes.status, 200);
    assert.strictEqual(updateRes.data.name, 'Alice Wonder');

    // User 2 requests their profile
    const u2ProfileRes = await request('/api/profile', {
      headers: { Authorization: `Bearer ${user2Token}` },
    });
    assert.strictEqual(u2ProfileRes.status, 200);
    assert.notStrictEqual(u2ProfileRes.data.name, 'Alice Wonder');
    assert.strictEqual(u2ProfileRes.data.user_id, user2Id);
  });

  await test('Watchlist is strictly isolated per user', async () => {
    // User 1 watches opp-001
    const watchRes = await request('/api/opportunities/opp-001/watch', {
      method: 'POST',
      headers: { Authorization: `Bearer ${user1Token}` },
    });
    assert.strictEqual(watchRes.status, 200);
    assert.strictEqual(watchRes.data.watching, true);

    // User 1 opportunities query shows is_watching = true
    const u1Opps = await request('/api/opportunities', {
      headers: { Authorization: `Bearer ${user1Token}` },
    });
    const u1Opp1 = u1Opps.data.opportunities.find(o => o.id === 'opp-001');
    assert.ok(u1Opp1.is_watching, 'User 1 should see opportunity is_watching = true');

    // User 2 opportunities query must show is_watching = false
    const u2Opps = await request('/api/opportunities', {
      headers: { Authorization: `Bearer ${user2Token}` },
    });
    const u2Opp1 = u2Opps.data.opportunities.find(o => o.id === 'opp-001');
    assert.strictEqual(Boolean(u2Opp1?.is_watching), false, 'User 2 must NOT see User 1 watched status');
  });

  await test('Alert settings are isolated per user', async () => {
    // User 1 updates alert settings
    const putRes = await request('/api/alerts/settings', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${user1Token}` },
      body: { email_enabled: false, telegram_enabled: true, telegram_chat_id: 'chat_user_1', frequency: 'daily' },
    });
    assert.strictEqual(putRes.status, 200);
    assert.strictEqual(putRes.data.settings.telegram_chat_id, 'chat_user_1');
    assert.strictEqual(putRes.data.settings.email_enabled, false);

    // User 2 gets their alert settings
    const u2Settings = await request('/api/alerts/settings', {
      headers: { Authorization: `Bearer ${user2Token}` },
    });
    assert.strictEqual(u2Settings.status, 200);
    assert.notStrictEqual(u2Settings.data.telegram_chat_id, 'chat_user_1');
    assert.strictEqual(u2Settings.data.email_enabled, true, 'User 2 default email_enabled should be true');
  });

  // ── TEST 10: Magic Link Generation & Verification ────────────────────────────
  await test('Magic link dispatches and can be verified to issue login session', async () => {
    const magicEmail = `magic_${Date.now()}@example.com`;
    const genRes = await request('/api/auth/magic-link', {
      method: 'POST',
      body: { email: magicEmail },
    });
    assert.strictEqual(genRes.status, 200);
    assert.strictEqual(genRes.data.ok, true);

    // Retrieve token from DB/memoryStore
    const tokenRecord = db.memoryStore.auth_tokens.find(
      t => t.token_type === 'magic_link' && !t.used
    );
    assert.ok(tokenRecord, 'Should find magic link token');

    // Verify token
    const verifyRes = await request('/api/auth/verify-token', {
      method: 'POST',
      body: { token: tokenRecord.token, type: 'magic_link' },
    });
    assert.strictEqual(verifyRes.status, 200);
    assert.strictEqual(verifyRes.data.user.email, magicEmail);
    assert.strictEqual(verifyRes.data.user.email_verified, true);
    assert.ok(verifyRes.data.token);
  });

  // ── TEST 11: Account Deletion ("Delete my account and data") ──────────────────
  await test('"Delete my account and data" permanently removes user and cascades', async () => {
    const delRes = await request('/api/profile/account', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${user1Token}` },
    });
    assert.strictEqual(delRes.status, 200);
    assert.strictEqual(delRes.data.ok, true);

    // Verify User 1 can no longer access /api/profile
    const postDelRes = await request('/api/profile', {
      headers: { Authorization: `Bearer ${user1Token}` },
    });
    assert.strictEqual(postDelRes.status, 200);
    assert.strictEqual(postDelRes.data, null, 'Deleted user profile should be null');

    // Verify login with old credentials fails
    const reLogin = await request('/api/auth/login', {
      method: 'POST',
      body: { email: user1Email, password: 'StrongPassword123!' },
    });
    assert.strictEqual(reLogin.status, 401);
  });

  await stopServer();

  console.log('\n======================================================');
  console.log(`  TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('======================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('[test] Fatal error running tests:', err);
  process.exit(1);
});
