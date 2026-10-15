'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('../db');
const { sendMail } = require('../mailer');

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'or_jwt_secret_dev_key_never_in_production_123';
const ACCESS_TOKEN_EXPIRY = '15m';
const REFRESH_TOKEN_EXPIRY_DAYS = 7;
const APP_URL = process.env.APP_URL || process.env.VITE_API_URL?.replace(':3001', ':5173') || 'http://localhost:5173';

// ── In-Memory Rate Limiting for Login ──────────────────────────────────────────
const loginAttempts = new Map(); // key: ip or email, value: { count, firstAttempt }
const MAX_ATTEMPTS = 5;
const LOCKOUT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

function checkRateLimit(key) {
  const now = Date.now();
  const entry = loginAttempts.get(key);
  if (!entry) return { allowed: true };
  if (now - entry.firstAttempt > LOCKOUT_WINDOW_MS) {
    loginAttempts.delete(key);
    return { allowed: true };
  }
  if (entry.count >= MAX_ATTEMPTS) {
    const retryAfterSec = Math.ceil((entry.firstAttempt + LOCKOUT_WINDOW_MS - now) / 1000);
    return { allowed: false, retryAfterSec };
  }
  return { allowed: true };
}

function recordFailedAttempt(key) {
  const now = Date.now();
  const entry = loginAttempts.get(key);
  if (!entry || now - entry.firstAttempt > LOCKOUT_WINDOW_MS) {
    loginAttempts.set(key, { count: 1, firstAttempt: now });
  } else {
    entry.count += 1;
  }
}

function clearRateLimit(key) {
  loginAttempts.delete(key);
}

// ── Cookie Helpers ────────────────────────────────────────────────────────────
function setAuthCookies(res, accessToken, refreshToken) {
  const isProd = process.env.NODE_ENV === 'production';
  const cookieOptions = {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    path: '/',
  };

  res.cookie('or_access_token', accessToken, {
    ...cookieOptions,
    maxAge: 15 * 60 * 1000, // 15 mins
  });

  if (refreshToken) {
    res.cookie('or_refresh_token', refreshToken, {
      ...cookieOptions,
      maxAge: REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000, // 7 days
    });
  }
}

function clearAuthCookies(res) {
  const isProd = process.env.NODE_ENV === 'production';
  const cookieOptions = {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    path: '/',
  };
  res.clearCookie('or_access_token', cookieOptions);
  res.clearCookie('or_refresh_token', cookieOptions);
}

function hashToken(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

async function createSession(userId, req) {
  const refreshToken = crypto.randomBytes(40).toString('hex');
  const tokenHash = hashToken(refreshToken);
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
  const userAgent = req.headers['user-agent'] || null;
  const ipAddress = req.ip || req.connection?.remoteAddress || null;

  await db.query(
    `INSERT INTO sessions (user_id, token_hash, expires_at, user_agent, ip_address, created_at)
     VALUES ($1, $2, $3, $4, $5, NOW())`,
    [userId, tokenHash, expiresAt.toISOString(), userAgent, ipAddress]
  );

  await db.query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at, revoked, created_at)
     VALUES ($1, $2, $3, FALSE, NOW())`,
    [userId, tokenHash, expiresAt.toISOString()]
  ).catch(() => {});

  return refreshToken;
}

// ── GET /api/auth/providers ───────────────────────────────────────────────────
// Informs UI which social login buttons to show based on available environment credentials
router.get('/providers', (_req, res) => {
  res.json({
    google: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    github: Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET),
    linkedin: Boolean(process.env.LINKEDIN_CLIENT_ID && process.env.LINKEDIN_CLIENT_SECRET),
  });
});

// ── POST /api/auth/register ───────────────────────────────────────────────────
router.post('/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(cleanEmail)) {
      return res.status(400).json({ error: 'Invalid email address format' });
    }

    if (typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters long' });
    }

    // Check if user already exists
    const existing = await db.queryOne('SELECT id FROM users WHERE email = $1', [cleanEmail]);
    if (existing) {
      return res.status(409).json({ error: 'Email is already registered. Please log in.' });
    }

    const hash = await bcrypt.hash(password, 10);
    const userRes = await db.query(
      `INSERT INTO users (email, password_hash, email_verified, created_at, updated_at)
       VALUES ($1, $2, FALSE, NOW(), NOW())
       RETURNING id, email, email_verified, created_at`,
      [cleanEmail, hash, false]
    );
    const user = userRes.rows[0];

    // Create auth identity
    await db.query(
      `INSERT INTO auth_identities (user_id, provider, provider_user_id, created_at)
       VALUES ($1, 'password', $2, NOW())`,
      [user.id, cleanEmail]
    );

    // Create user profile
    const displayName = name ? name.trim() : cleanEmail.split('@')[0];
    await db.query(
      `INSERT INTO user_profiles (user_id, name, onboarding_completed, updated_at)
       VALUES ($1, $2, FALSE, NOW())`,
      [user.id, displayName, '3rd', '', '', [], [], [], [], null, null, null, null, false]
    );

    // Create default alert settings
    await db.query(
      `INSERT INTO user_alert_settings (user_id, email_enabled, telegram_enabled, frequency)
       VALUES ($1, TRUE, FALSE, 'realtime')`,
      [user.id, true, false, '', 'realtime', 14]
    );

    // Create verification token
    const verifyToken = crypto.randomBytes(32).toString('hex');
    const tokenExpires = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
    await db.query(
      `INSERT INTO auth_tokens (user_id, token, token_type, expires_at)
       VALUES ($1, $2, 'verify_email', $3)`,
      [user.id, verifyToken, tokenExpires.toISOString()]
    );

    // Send verification email via Mailpit/SMTP
    const verifyLink = `${APP_URL}/login?token=${verifyToken}&type=verify_email`;
    sendMail({
      to: cleanEmail,
      subject: 'Verify your OpportunityRadar account',
      text: `Welcome to OpportunityRadar! Click the link below to verify your email address:\n\n${verifyLink}\n\nThis link expires in 24 hours.`,
      html: `
        <div style="font-family:sans-serif;max-width:540px;margin:auto;padding:24px;border:1px solid #E2DDD0;border-radius:8px;background:#FFFFFF;">
          <h2 style="color:#1F4D3A;margin-top:0;">Verify your email</h2>
          <p style="color:#1B1B18;line-height:1.5;">Welcome to OpportunityRadar. Confirm your email address to secure your account and track high-priority opportunities:</p>
          <a href="${verifyLink}" style="display:inline-block;padding:10px 20px;background:#1F4D3A;color:#FFFFFF;border-radius:6px;text-decoration:none;font-weight:500;">Verify Email Address</a>
          <p style="color:#6B6A63;font-size:12px;margin-top:24px;">Or copy and paste this link in your browser: <br/><code style="word-break:break-all;">${verifyLink}</code></p>
        </div>
      `,
    }).catch(e => console.warn('[auth] Verification email send notice:', e.message));

    // Generate tokens & session
    const accessToken = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: ACCESS_TOKEN_EXPIRY });
    const refreshToken = await createSession(user.id, req);

    setAuthCookies(res, accessToken, refreshToken);

    res.status(201).json({
      ok: true,
      message: 'Account created successfully. A verification email has been sent.',
      user: {
        id: user.id,
        email: user.email,
        email_verified: false,
        name: displayName,
      },
      token: accessToken,
      refreshToken,
    });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Email is already registered' });
    }
    console.error('[auth] Registration error:', err);
    res.status(500).json({ error: 'Registration failed due to server error' });
  }
});

// ── POST /api/auth/login ──────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const clientKey = `${req.ip}_${cleanEmail}`;

    // Rate limiting check
    const rateCheck = checkRateLimit(clientKey);
    if (!rateCheck.allowed) {
      return res.status(429).json({
        error: `Too many failed login attempts. Please try again in ${rateCheck.retryAfterSec} seconds.`,
      });
    }

    const user = await db.queryOne('SELECT * FROM users WHERE email = $1', [cleanEmail]);
    if (!user || !user.password_hash) {
      recordFailedAttempt(clientKey);
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      recordFailedAttempt(clientKey);
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Success: clear rate limit counter
    clearRateLimit(clientKey);

    // Get user profile for response
    const profile = await db.queryOne('SELECT * FROM user_profiles WHERE user_id = $1', [user.id]);

    const accessToken = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: ACCESS_TOKEN_EXPIRY });
    const refreshToken = await createSession(user.id, req);

    setAuthCookies(res, accessToken, refreshToken);

    res.json({
      ok: true,
      user: {
        id: user.id,
        email: user.email,
        email_verified: Boolean(user.email_verified),
        name: profile?.name || user.email.split('@')[0],
        onboarding_completed: Boolean(profile?.onboarding_completed),
      },
      token: accessToken,
      refreshToken,
    });
  } catch (err) {
    console.error('[auth] Login error:', err);
    res.status(500).json({ error: 'Login failed due to an unexpected error' });
  }
});

// ── POST /api/auth/demo-login ─────────────────────────────────────────────────
// Seeded demo account for instant judges login
router.post('/demo-login', async (req, res) => {
  try {
    const demoEmail = 'demo@opportunityradar.dev';
    let user = await db.queryOne('SELECT * FROM users WHERE email = $1', [demoEmail]);

    if (!user) {
      // Create on demand if not present
      const hash = await bcrypt.hash('demo1234', 10);
      const userRes = await db.query(
        `INSERT INTO users (email, password_hash, email_verified)
         VALUES ($1, $2, TRUE) RETURNING *`,
        [demoEmail, hash]
      );
      user = userRes.rows[0];

      await db.query(
        `INSERT INTO user_profiles (user_id, name, year_of_study, branch, college, skills, interests, location_pref, opportunity_types, onboarding_completed)
         VALUES ($1, 'Priya Sharma', '3rd', 'Computer Science', 'IIT Bombay',
                 ARRAY['Python', 'Machine Learning', 'React', 'Node.js', 'SQL'],
                 ARRAY['AI/ML', 'Climate Tech', 'EdTech'],
                 ARRAY['Remote', 'Bangalore', 'Mumbai'],
                 ARRAY['internship', 'hackathon', 'scholarship'], TRUE)
         ON CONFLICT (user_id) DO NOTHING`,
        [user.id, 'Priya Sharma', '3rd', 'Computer Science', 'IIT Bombay',
         ['Python', 'Machine Learning', 'React', 'Node.js', 'SQL'],
         ['AI/ML', 'Climate Tech', 'EdTech'],
         ['Remote', 'Bangalore', 'Mumbai'],
         ['internship', 'hackathon', 'scholarship'], null, null, null, null, true]
      );
    }

    const profile = await db.queryOne('SELECT * FROM user_profiles WHERE user_id = $1', [user.id]);

    const accessToken = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: ACCESS_TOKEN_EXPIRY });
    const refreshToken = await createSession(user.id, req);

    setAuthCookies(res, accessToken, refreshToken);

    res.json({
      ok: true,
      user: {
        id: user.id,
        email: user.email,
        email_verified: true,
        name: profile?.name || 'Priya Sharma',
        college: profile?.college || 'IIT Bombay',
        onboarding_completed: Boolean(profile?.onboarding_completed),
      },
      token: accessToken,
      refreshToken,
    });
  } catch (err) {
    console.error('[auth] Demo login error:', err);
    res.status(500).json({ error: 'Demo login failed' });
  }
});

// ── POST /api/auth/magic-link ─────────────────────────────────────────────────
router.post('/magic-link', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    const cleanEmail = email.trim().toLowerCase();
    let user = await db.queryOne('SELECT * FROM users WHERE email = $1', [cleanEmail]);

    if (!user) {
      // Auto-create user for passwordless signup
      const userRes = await db.query(
        `INSERT INTO users (email, email_verified) VALUES ($1, FALSE) RETURNING *`,
        [cleanEmail, null, false]
      );
      user = userRes.rows[0];
      await db.query(
        `INSERT INTO user_profiles (user_id, name, onboarding_completed) VALUES ($1, $2, FALSE)`,
        [user.id, cleanEmail.split('@')[0], '3rd', '', '', [], [], [], [], null, null, null, null, false]
      );
    }

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 mins

    await db.query(
      `INSERT INTO auth_tokens (user_id, token, token_type, expires_at)
       VALUES ($1, $2, 'magic_link', $3)`,
      [user.id, token, expiresAt.toISOString()]
    );

    const magicUrl = `${APP_URL}/login?token=${token}&type=magic_link`;
    await sendMail({
      to: cleanEmail,
      subject: 'Your OpportunityRadar Magic Sign-in Link',
      text: `Click the link below to sign in instantly to OpportunityRadar:\n\n${magicUrl}\n\nThis link is valid for 15 minutes.`,
      html: `
        <div style="font-family:sans-serif;max-width:540px;margin:auto;padding:24px;border:1px solid #E2DDD0;border-radius:8px;background:#FFFFFF;">
          <h2 style="color:#1F4D3A;margin-top:0;">Sign in to OpportunityRadar</h2>
          <p style="color:#1B1B18;line-height:1.5;">Click below to log in securely without typing your password:</p>
          <a href="${magicUrl}" style="display:inline-block;padding:10px 20px;background:#1F4D3A;color:#FFFFFF;border-radius:6px;text-decoration:none;font-weight:500;">Sign in instantly</a>
          <p style="color:#6B6A63;font-size:12px;margin-top:24px;">Expires in 15 minutes. If you did not request this email, you can safely disregard it.</p>
        </div>
      `,
    });

    res.json({ ok: true, message: 'Magic link dispatched to your email address.' });
  } catch (err) {
    console.error('[auth] Magic link error:', err);
    res.status(500).json({ error: 'Failed to generate magic link' });
  }
});

// ── POST /api/auth/verify-token ───────────────────────────────────────────────
// Verifies magic link or email verification token and creates session
router.post('/verify-token', async (req, res) => {
  try {
    const { token, type } = req.body;
    if (!token) return res.status(400).json({ error: 'Token is required' });

    const tokenRecord = await db.queryOne(
      `SELECT * FROM auth_tokens WHERE token = $1 AND token_type = $2 AND used = FALSE`,
      [token, type || 'magic_link']
    );

    if (!tokenRecord) {
      return res.status(400).json({ error: 'Invalid or expired authentication link' });
    }

    if (new Date(tokenRecord.expires_at) < new Date()) {
      return res.status(400).json({ error: 'This authentication link has expired' });
    }

    // Mark token as used
    await db.query('UPDATE auth_tokens SET used = TRUE WHERE token = $1', [token]);

    // Mark user email verified
    await db.query('UPDATE users SET email_verified = TRUE WHERE id = $1', [tokenRecord.user_id]);

    const user = await db.queryOne('SELECT id, email, email_verified FROM users WHERE id = $1', [tokenRecord.user_id]);
    const profile = await db.queryOne('SELECT * FROM user_profiles WHERE user_id = $1', [user.id]);

    const accessToken = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: ACCESS_TOKEN_EXPIRY });
    const refreshToken = await createSession(user.id, req);

    setAuthCookies(res, accessToken, refreshToken);

    res.json({
      ok: true,
      message: 'Verification successful',
      user: {
        id: user.id,
        email: user.email,
        email_verified: true,
        name: profile?.name || user.email.split('@')[0],
        onboarding_completed: Boolean(profile?.onboarding_completed),
      },
      token: accessToken,
      refreshToken,
    });
  } catch (err) {
    console.error('[auth] Verify token error:', err);
    res.status(500).json({ error: 'Verification failed' });
  }
});

// ── POST /api/auth/forgot-password ────────────────────────────────────────────
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    const cleanEmail = email.trim().toLowerCase();
    const user = await db.queryOne('SELECT * FROM users WHERE email = $1', [cleanEmail]);

    // Even if user not found, respond with generic success to prevent email enumeration
    if (!user) {
      return res.json({ ok: true, message: 'If that email exists in our system, a password reset link has been sent.' });
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes

    await db.query(
      `INSERT INTO auth_tokens (user_id, token, token_type, expires_at)
       VALUES ($1, $2, 'password_reset', $3)`,
      [user.id, resetToken, expiresAt.toISOString()]
    );

    const resetLink = `${APP_URL}/login?token=${resetToken}&type=reset_password`;
    await sendMail({
      to: cleanEmail,
      subject: 'Reset your OpportunityRadar password',
      text: `A password reset was requested for your account. Click the link below to set a new password:\n\n${resetLink}\n\nThis link expires in 30 minutes.`,
      html: `
        <div style="font-family:sans-serif;max-width:540px;margin:auto;padding:24px;border:1px solid #E2DDD0;border-radius:8px;background:#FFFFFF;">
          <h2 style="color:#1F4D3A;margin-top:0;">Password Reset Request</h2>
          <p style="color:#1B1B18;line-height:1.5;">Click the button below to choose a new password for your OpportunityRadar account:</p>
          <a href="${resetLink}" style="display:inline-block;padding:10px 20px;background:#1F4D3A;color:#FFFFFF;border-radius:6px;text-decoration:none;font-weight:500;">Reset Password</a>
          <p style="color:#6B6A63;font-size:12px;margin-top:24px;">Expires in 30 minutes. If you did not request this reset, your account remains secure.</p>
        </div>
      `,
    });

    res.json({ ok: true, message: 'If that email exists in our system, a password reset link has been sent.' });
  } catch (err) {
    console.error('[auth] Forgot password error:', err);
    res.status(500).json({ error: 'Password reset request failed' });
  }
});

// ── POST /api/auth/reset-password ─────────────────────────────────────────────
router.post('/reset-password', async (req, res) => {
  try {
    const { token, new_password } = req.body;
    if (!token || !new_password) {
      return res.status(400).json({ error: 'Token and new password are required' });
    }

    if (typeof new_password !== 'string' || new_password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters long' });
    }

    const tokenRecord = await db.queryOne(
      `SELECT * FROM auth_tokens WHERE token = $1 AND token_type = 'password_reset' AND used = FALSE`,
      [token]
    );

    if (!tokenRecord) {
      return res.status(400).json({ error: 'Invalid or expired password reset link' });
    }

    if (new Date(tokenRecord.expires_at) < new Date()) {
      return res.status(400).json({ error: 'This password reset link has expired' });
    }

    const hash = await bcrypt.hash(new_password, 10);
    await db.query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [hash, tokenRecord.user_id]);
    await db.query('UPDATE auth_tokens SET used = TRUE WHERE token = $1', [token]);

    // Revoke previous sessions on password change
    await db.query('UPDATE sessions SET revoked = TRUE WHERE user_id = $1', [tokenRecord.user_id]);

    res.json({ ok: true, message: 'Password has been reset successfully. Please log in with your new password.' });
  } catch (err) {
    console.error('[auth] Reset password error:', err);
    res.status(500).json({ error: 'Password reset failed' });
  }
});

// ── POST /api/auth/refresh ────────────────────────────────────────────────────
router.post('/refresh', async (req, res) => {
  try {
    const rawRefreshToken = req.cookies?.or_refresh_token || req.body?.refreshToken;
    if (!rawRefreshToken) {
      return res.status(401).json({ error: 'Refresh token is required' });
    }

    const tokenHash = hashToken(rawRefreshToken);
    const session = await db.queryOne(
      `SELECT s.*, u.email, u.email_verified
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1 AND s.revoked = FALSE`,
      [tokenHash]
    );

    if (!session || new Date(session.expires_at) < new Date()) {
      clearAuthCookies(res);
      return res.status(401).json({ error: 'Session expired or invalidated. Please log in again.' });
    }

    // Generate fresh access token & rotate refresh token
    const newAccessToken = jwt.sign(
      { userId: session.user_id, email: session.email },
      JWT_SECRET,
      { expiresIn: ACCESS_TOKEN_EXPIRY }
    );

    // Revoke old session and create fresh one
    await db.query('UPDATE sessions SET revoked = TRUE WHERE token_hash = $1', [tokenHash]);
    await db.query('UPDATE refresh_tokens SET revoked = TRUE WHERE token_hash = $1', [tokenHash]).catch(() => {});
    const newRefreshToken = await createSession(session.user_id, req);

    setAuthCookies(res, newAccessToken, newRefreshToken);

    res.json({
      ok: true,
      token: newAccessToken,
      refreshToken: newRefreshToken,
    });
  } catch (err) {
    console.error('[auth] Refresh error:', err);
    res.status(500).json({ error: 'Token refresh failed' });
  }
});

// ── POST /api/auth/logout ─────────────────────────────────────────────────────
router.post('/logout', async (req, res) => {
  try {
    const rawRefreshToken = req.cookies?.or_refresh_token || req.body?.refreshToken;
    if (rawRefreshToken) {
      const tokenHash = hashToken(rawRefreshToken);
      await db.query('UPDATE sessions SET revoked = TRUE WHERE token_hash = $1', [tokenHash]);
      await db.query('UPDATE refresh_tokens SET revoked = TRUE WHERE token_hash = $1', [tokenHash]).catch(() => {});
    }

    clearAuthCookies(res);
    res.json({ ok: true, message: 'Logged out successfully' });
  } catch (err) {
    clearAuthCookies(res);
    res.json({ ok: true, message: 'Logged out' });
  }
});

// ── GET /api/auth/me ──────────────────────────────────────────────────────────
router.get('/me', requireAuth, async (req, res) => {
  try {
    const user = await db.queryOne(
      'SELECT id, email, email_verified, created_at FROM users WHERE id = $1',
      [req.user.userId]
    );
    if (!user) return res.status(404).json({ error: 'User not found' });

    const profile = await db.queryOne(
      'SELECT * FROM user_profiles WHERE user_id = $1',
      [req.user.userId]
    );

    const alertSettings = await db.queryOne(
      'SELECT * FROM user_alert_settings WHERE user_id = $1',
      [req.user.userId]
    );

    res.json({
      user: {
        id: user.id,
        email: user.email,
        email_verified: user.email_verified,
        name: profile?.name || user.email.split('@')[0],
        onboarding_completed: Boolean(profile?.onboarding_completed),
      },
      profile: profile || null,
      alert_settings: alertSettings || null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── OAuth Handlers (Google, GitHub, LinkedIn OIDC) ───────────────────────────
router.get('/oauth/:provider', (req, res) => {
  const { provider } = req.params;
  const state = crypto.randomBytes(16).toString('hex');
  const redirectUri = `${process.env.API_URL || 'http://localhost:3001'}/api/auth/oauth/${provider}/callback`;

  if (provider === 'google') {
    if (!process.env.GOOGLE_CLIENT_ID) return res.status(400).send('Google OAuth not configured in .env');
    const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${process.env.GOOGLE_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=openid%20email%20profile&state=${state}`;
    return res.redirect(url);
  }

  if (provider === 'github') {
    if (!process.env.GITHUB_CLIENT_ID) return res.status(400).send('GitHub OAuth not configured in .env');
    const url = `https://github.com/login/oauth/authorize?client_id=${process.env.GITHUB_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=user:email,read:user&state=${state}`;
    return res.redirect(url);
  }

  if (provider === 'linkedin') {
    if (!process.env.LINKEDIN_CLIENT_ID) return res.status(400).send('LinkedIn OAuth not configured in .env');
    const url = `https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=${process.env.LINKEDIN_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}&scope=openid%20profile%20email`;
    return res.redirect(url);
  }

  res.status(400).send('Unknown OAuth provider');
});

router.get('/oauth/:provider/callback', async (req, res) => {
  const { provider } = req.params;
  const { code } = req.query;

  if (!code) return res.redirect(`${APP_URL}/login?error=OAuth_cancelled`);

  try {
    let email = null;
    let providerUserId = null;
    let name = null;
    let cleanEmail = null;

    // Handle Mock or Real OAuth callback
    if (provider === 'github') {
      const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          client_id: process.env.GITHUB_CLIENT_ID,
          client_secret: process.env.GITHUB_CLIENT_SECRET,
          code,
        }),
      });
      const tokenData = await tokenRes.json();
      if (!tokenData.access_token) throw new Error('Failed to retrieve GitHub access token');

      const userRes = await fetch('https://api.github.com/user', {
        headers: { Authorization: `Bearer ${tokenData.access_token}`, 'User-Agent': 'OpportunityRadar' },
      });
      const githubUser = await userRes.json();
      providerUserId = String(githubUser.id);
      name = githubUser.name || githubUser.login;

      // Email might be private, fetch from /user/emails
      if (githubUser.email) {
        email = githubUser.email;
      } else {
        const emailRes = await fetch('https://api.github.com/user/emails', {
          headers: { Authorization: `Bearer ${tokenData.access_token}`, 'User-Agent': 'OpportunityRadar' },
        });
        const emails = await emailRes.json();
        const primary = emails.find(e => e.primary && e.verified) || emails[0];
        email = primary?.email;
      }
    } else if (provider === 'google') {
      const redirectUri = `${process.env.API_URL || 'http://localhost:3001'}/api/auth/oauth/google/callback`;
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: process.env.GOOGLE_CLIENT_ID,
          client_secret: process.env.GOOGLE_CLIENT_SECRET,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
        }),
      });
      const tokenData = await tokenRes.json();
      const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });
      const gUser = await userRes.json();
      providerUserId = gUser.sub;
      email = gUser.email;
      name = gUser.name;
    } else if (provider === 'linkedin') {
      const redirectUri = `${process.env.API_URL || 'http://localhost:3001'}/api/auth/oauth/linkedin/callback`;
      const tokenRes = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code,
          client_id: process.env.LINKEDIN_CLIENT_ID,
          client_secret: process.env.LINKEDIN_CLIENT_SECRET,
          redirect_uri: redirectUri,
        }),
      });
      const tokenData = await tokenRes.json();
      const userinfoRes = await fetch('https://api.linkedin.com/v2/userinfo', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });
      const lUser = await userinfoRes.json();
      providerUserId = lUser.sub;
      email = lUser.email;
      name = lUser.name;
    }

    if (!email) throw new Error('Could not retrieve verified email from provider');

    cleanEmail = email.toLowerCase();

    // Check if identity exists or link by email
    let identity = await db.queryOne(
      'SELECT * FROM auth_identities WHERE provider = $1 AND provider_user_id = $2',
      [provider, providerUserId]
    );

    let user = null;
    if (identity) {
      user = await db.queryOne('SELECT * FROM users WHERE id = $1', [identity.user_id]);
    }

    if (!user) {
      user = await db.queryOne('SELECT * FROM users WHERE email = $1', [cleanEmail]);
      if (!user) {
        const uRes = await db.query(
          'INSERT INTO users (email, email_verified) VALUES ($1, TRUE) RETURNING *',
          [cleanEmail, null, true]
        );
        user = uRes.rows[0];
        await db.query(
          'INSERT INTO user_profiles (user_id, name, onboarding_completed) VALUES ($1, $2, FALSE)',
          [user.id, name || cleanEmail.split('@')[0], '3rd', '', '', [], [], [], [], null, null, null, null, false]
        );
      }
      await db.query(
        'INSERT INTO auth_identities (user_id, provider, provider_user_id) VALUES ($1, $2, $3)',
        [user.id, provider, providerUserId]
      );
    }

    const accessToken = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, { expiresIn: ACCESS_TOKEN_EXPIRY });
    const refreshToken = await createSession(user.id, req);

    setAuthCookies(res, accessToken, refreshToken);
    res.redirect(`${APP_URL}/`);
  } catch (err) {
    console.error(`[auth] OAuth callback error [${provider}]:`, err.message);
    res.redirect(`${APP_URL}/login?error=${encodeURIComponent(err.message)}`);
  }
});

// ── Authentication Middleware ─────────────────────────────────────────────────
function requireAuth(req, res, next) {
  let token = null;

  // 1. Try Cookie
  if (req.cookies && req.cookies.or_access_token) {
    token = req.cookies.or_access_token;
  }

  // 2. Try Authorization header
  if (!token && req.headers.authorization?.startsWith('Bearer ')) {
    token = req.headers.authorization.slice(7);
  }

  if (!token) {
    return res.status(401).json({ error: 'Authentication required. Please log in.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Session expired or invalid', code: 'TOKEN_EXPIRED' });
  }
}

module.exports = {
  router,
  requireAuth,
  setAuthCookies,
  clearAuthCookies,
  JWT_SECRET,
};
