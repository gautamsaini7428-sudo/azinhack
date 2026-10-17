'use strict';
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const isTest = process.env.NODE_ENV === 'test';
// When running locally outside docker, hostname "db" is not resolvable
const isDockerDb = (process.env.DATABASE_URL || '').includes('@db:');
let isConnected = (isTest || (isDockerDb && process.platform === 'win32')) ? false : null;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 1000,
});

pool.on('error', (_err) => {
  // Silent idle client error handling
});

const DEMO_PASSWORD_HASH = bcrypt.hashSync('demo1234', 10);
const DEMO_USER_ID = 'a0000000-0000-0000-0000-000000000001';

// ── In-Memory Fallback Store (for offline / direct execution without Docker) ──
const memoryStore = {
  users: [
    {
      id: DEMO_USER_ID,
      email: 'demo@opportunityradar.dev',
      password_hash: DEMO_PASSWORD_HASH,
      email_verified: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: 'a0000000-0000-0000-0000-000000000002',
      email: 'priya@demo.local',
      password_hash: DEMO_PASSWORD_HASH,
      email_verified: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ],
  auth_identities: [
    {
      id: 'c0000000-0000-0000-0000-000000000001',
      user_id: DEMO_USER_ID,
      provider: 'password',
      provider_user_id: 'demo@opportunityradar.dev',
      profile_data: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ],
  sessions: [],
  auth_tokens: [],
  user_profiles: [
    {
      id: 'p0000000-0000-0000-0000-000000000001',
      user_id: DEMO_USER_ID,
      name: 'Priya Sharma',
      year_of_study: '3rd',
      branch: 'Computer Science',
      college: 'IIT Bombay',
      skills: ['Python', 'Machine Learning', 'React', 'Node.js', 'SQL'],
      interests: ['AI/ML', 'Climate Tech', 'EdTech'],
      location_pref: ['Remote', 'Bangalore', 'Mumbai'],
      opportunity_types: ['internship', 'hackathon', 'scholarship'],
      github_username: 'student-demo',
      linkedin_url: 'https://linkedin.com/in/student-demo',
      resume_filename: null,
      imported_data: null,
      onboarding_completed: true,
      updated_at: new Date().toISOString(),
    },
  ],
  profiles: [
    {
      user_id: DEMO_USER_ID,
      name: 'Priya Sharma',
      year_of_study: '3rd',
      branch: 'Computer Science',
      college: 'IIT Bombay',
      skills: ['Python', 'Machine Learning', 'React', 'Node.js', 'SQL'],
      interests: ['AI/ML', 'Climate Tech', 'EdTech'],
      location_pref: ['Remote', 'Bangalore', 'Mumbai'],
      opportunity_types: ['internship', 'hackathon', 'scholarship'],
      updated_at: new Date().toISOString(),
    },
  ],
  user_alert_settings: [
    {
      id: 'uas-001',
      user_id: DEMO_USER_ID,
      email_enabled: true,
      telegram_enabled: false,
      telegram_chat_id: '',
      frequency: 'realtime',
      deadline_threshold_days: 14,
      updated_at: new Date().toISOString(),
    },
  ],
  sources: [
    {
      id: 'b0000000-0000-0000-0000-000000000001',
      url: 'http://localhost:4000/opportunities',
      label: 'OpportunityRadar Demo Portal',
      source_type: 'mock',
      poll_interval: 5,
      robots_allowed: true,
      last_checked_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    },
    {
      id: 'b0000000-0000-0000-0000-000000000002',
      url: 'https://unstop.com/hackathons',
      label: 'Unstop Hackathons',
      source_type: 'official',
      poll_interval: 60,
      robots_allowed: true,
      last_checked_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    },
  ],
  opportunities: [
    {
      id: 'opp-001',
      source_id: 'b0000000-0000-0000-0000-000000000001',
      title: 'Northwind Labs Software Engineering Fellowship',
      organizer: 'Northwind Labs',
      opp_type: 'internship',
      eligibility: 'Open to undergraduate and graduate students enrolled in an accredited university. Strong Python, TypeScript, or Go skills required.',
      deadline: new Date(Date.now() + 4 * 86400000).toISOString(),
      reward: '$3,500 – $6,000 monthly stipend',
      apply_link: 'https://northwindlabs.example.com/fellowship',
      is_dead: false,
      confidence: 0.98,
      last_checked_at: new Date().toISOString(),
    },
    {
      id: 'opp-002',
      source_id: 'b0000000-0000-0000-0000-000000000001',
      title: 'Apex National Innovation Hackathon',
      organizer: 'Apex Technology Foundation',
      opp_type: 'hackathon',
      eligibility: 'Indian and international students currently enrolled in UG/PG programs. Teams of 2 to 6. Any engineering or computing branch eligible.',
      deadline: new Date(Date.now() + 9 * 86400000).toISOString(),
      reward: '$15,000 Total Prize Pool + Fast-Track Interviews',
      apply_link: 'https://apextechfoundation.example.org/hackathon',
      is_dead: false,
      confidence: 0.95,
      last_checked_at: new Date().toISOString(),
    },
    {
      id: 'opp-003',
      source_id: 'b0000000-0000-0000-0000-000000000001',
      title: 'Meridian Future Leaders STEM Scholarship',
      organizer: 'Meridian Global Trust',
      opp_type: 'scholarship',
      eligibility: 'Open to undergraduate students in 2nd or 3rd year pursuing Computer Science, Data Science, or Electrical Engineering. Minimum GPA 3.2 or equivalent.',
      deadline: new Date(Date.now() + 13 * 86400000).toISOString(),
      reward: '$5,000 educational grant + executive mentorship',
      apply_link: 'https://meridiantrust.example.org/scholarship',
      is_dead: false,
      confidence: 0.92,
      last_checked_at: new Date().toISOString(),
    },
    {
      id: 'opp-004',
      source_id: 'b0000000-0000-0000-0000-000000000001',
      title: 'Hyperion Autonomous Systems Challenge',
      organizer: 'Hyperion Robotics Institute',
      opp_type: 'hackathon',
      eligibility: 'Pre-final and final year university students. Knowledge of robotics, AI/ML, computer vision, or embedded systems. Teams of 2-4.',
      deadline: new Date(Date.now() + 21 * 86400000).toISOString(),
      reward: '$10,000 Grand Prize + Lab Incubation Grant',
      apply_link: 'https://hyperionrobotics.example.io/challenge',
      is_dead: false,
      confidence: 0.96,
      last_checked_at: new Date().toISOString(),
    },
    {
      id: 'opp-005',
      source_id: 'b0000000-0000-0000-0000-000000000001',
      title: 'Aether Cloud Solutions Research Residency',
      organizer: 'Aether Cloud Computing',
      opp_type: 'internship',
      eligibility: '3rd year or penultimate year students in Computer Science, Software Engineering, or related fields. Experience with distributed systems and cloud backends.',
      deadline: new Date(Date.now() + 35 * 86400000).toISOString(),
      reward: '$4,500/month stipend + hardware grant',
      apply_link: 'https://aethercloud.example.net/residency',
      is_dead: false,
      confidence: 0.97,
      last_checked_at: new Date().toISOString(),
    },
    {
      id: 'opp-006',
      source_id: 'b0000000-0000-0000-0000-000000000001',
      title: 'Helios Sustainable Energy Tech Grant',
      organizer: 'Helios CleanTech Institute',
      opp_type: 'scholarship',
      eligibility: 'Enrolled university students conducting verified capstone research in renewable microgrids, battery chemistry, or solar optimization.',
      deadline: new Date(Date.now() - 5 * 86400000).toISOString(),
      reward: '$8,000 research award',
      apply_link: 'https://helioscleantech.example.org/grants',
      is_dead: true,
      confidence: 0.94,
      last_checked_at: new Date().toISOString(),
    },
  ],
  watchlist: [],
  user_watchlist: [],
  snapshots: [],
  changes: [
    {
      id: 'chg-001',
      opportunity_id: 'opp-002',
      change_type: 'DEADLINE_CHANGED',
      before_data: { deadline: new Date(Date.now() - 2 * 86400000).toISOString() },
      after_data: { deadline: new Date(Date.now() + 9 * 86400000).toISOString() },
      explanation: 'Organizers extended the submission deadline by 11 days to accommodate academic schedules.',
      source_link: 'http://localhost:4000/opportunities',
      detected_at: new Date(Date.now() - 3600000).toISOString(),
    },
  ],
  alerts: [
    {
      id: 'alt-001',
      user_id: DEMO_USER_ID,
      opportunity_id: 'opp-002',
      channel: 'in-app',
      message: 'Apex National Innovation Hackathon deadline has been extended! Check the updated schedule.',
      is_read: false,
      created_at: new Date(Date.now() - 3500000).toISOString(),
    },
  ],
  match_results: [],
};

/**
 * In-memory SQL simulator for key tables when PostgreSQL is not running
 */
function memoryQuery(text, params = []) {
  const t = text.trim();

  // SELECT 1 AS ok (ping)
  if (/^SELECT 1/i.test(t)) {
    return { rows: [{ ok: 1 }], rowCount: 1 };
  }

  // Users lookup by email
  if (/^\s*SELECT[\s\S]*FROM\s+users\s+WHERE\s+email/i.test(t)) {
    const email = (params[0] || '').toLowerCase();
    const user = memoryStore.users.find(u => u.email.toLowerCase() === email);
    return { rows: user ? [user] : [], rowCount: user ? 1 : 0 };
  }

  // Users lookup by id
  if (/^\s*SELECT[\s\S]*FROM\s+users\s+WHERE\s+id/i.test(t)) {
    const user = memoryStore.users.find(u => u.id === params[0]);
    return { rows: user ? [user] : [], rowCount: user ? 1 : 0 };
  }

  // Users insert
  if (/INSERT INTO users/i.test(t)) {
    const email = (params[0] || '').toLowerCase();
    const existing = memoryStore.users.find(u => u.email.toLowerCase() === email);
    if (existing) {
      const err = new Error('duplicate key value violates unique constraint "users_email_key"');
      err.code = '23505';
      throw err;
    }
    const emailVerified = /TRUE/i.test(t) ? true : (params[2] !== undefined ? Boolean(params[2]) : false);
    const user = {
      id: 'user-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
      email,
      password_hash: params[1],
      email_verified: emailVerified,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    memoryStore.users.push(user);
    return { rows: [user], rowCount: 1 };
  }

  // Users update
  if (/UPDATE users SET/i.test(t)) {
    let user = null;
    if (/WHERE id = \$[0-9]+/i.test(t)) {
      const idParam = params[params.length - 1];
      user = memoryStore.users.find(u => u.id === idParam);
      if (user) {
        if (/password_hash =/i.test(t)) user.password_hash = params[0];
        if (/email_verified = TRUE/i.test(t) || /email_verified = \$[0-9]+/i.test(t)) user.email_verified = true;
        user.updated_at = new Date().toISOString();
      }
    }
    return { rows: user ? [user] : [], rowCount: user ? 1 : 0 };
  }

  // Users delete (cascade!)
  if (/DELETE FROM users WHERE id/i.test(t)) {
    const userId = params[0];
    memoryStore.users = memoryStore.users.filter(u => u.id !== userId);
    memoryStore.auth_identities = memoryStore.auth_identities.filter(i => i.user_id !== userId);
    memoryStore.sessions = memoryStore.sessions.filter(s => s.user_id !== userId);
    memoryStore.auth_tokens = memoryStore.auth_tokens.filter(tk => tk.user_id !== userId);
    memoryStore.user_profiles = memoryStore.user_profiles.filter(p => p.user_id !== userId);
    memoryStore.profiles = memoryStore.profiles.filter(p => p.user_id !== userId);
    memoryStore.user_alert_settings = memoryStore.user_alert_settings.filter(s => s.user_id !== userId);
    memoryStore.watchlist = memoryStore.watchlist.filter(w => w.user_id !== userId);
    memoryStore.user_watchlist = memoryStore.user_watchlist.filter(w => w.user_id !== userId);
    memoryStore.alerts = memoryStore.alerts.filter(a => a.user_id !== userId);
    memoryStore.match_results = memoryStore.match_results.filter(m => m.user_id !== userId);
    return { rows: [], rowCount: 1 };
  }

  // Auth identities lookup
  if (/SELECT \* FROM auth_identities WHERE provider =/i.test(t)) {
    const provider = params[0];
    const puid = params[1];
    const identity = memoryStore.auth_identities.find(
      i => i.provider === provider && i.provider_user_id === puid
    );
    return { rows: identity ? [identity] : [], rowCount: identity ? 1 : 0 };
  }

  // Auth identities insert
  if (/INSERT INTO auth_identities/i.test(t)) {
    const identity = {
      id: 'ident-' + Date.now(),
      user_id: params[0],
      provider: params[1],
      provider_user_id: params[2],
      profile_data: params[3] || {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    memoryStore.auth_identities.push(identity);
    return { rows: [identity], rowCount: 1 };
  }

  // Sessions insert
  if (/INSERT INTO sessions/i.test(t) || /INSERT INTO refresh_tokens/i.test(t)) {
    const session = {
      id: 'sess-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
      user_id: params[0],
      token_hash: params[1],
      expires_at: params[2],
      revoked: false,
      user_agent: params[3] || null,
      ip_address: params[4] || null,
      created_at: new Date().toISOString(),
    };
    memoryStore.sessions.push(session);
    return { rows: [session], rowCount: 1 };
  }

  // Sessions lookup by token_hash
  if (/SELECT \* FROM sessions WHERE token_hash/i.test(t) || /SELECT \* FROM refresh_tokens WHERE token_hash/i.test(t)) {
    const session = memoryStore.sessions.find(s => s.token_hash === params[0] && !s.revoked);
    return { rows: session ? [session] : [], rowCount: session ? 1 : 0 };
  }

  // Sessions revoke / update
  if (/UPDATE sessions SET revoked = TRUE/i.test(t) || /UPDATE refresh_tokens SET revoked = TRUE/i.test(t)) {
    if (params[0]) {
      memoryStore.sessions.forEach(s => {
        if (s.token_hash === params[0] || s.user_id === params[0]) s.revoked = true;
      });
    }
    return { rows: [], rowCount: 1 };
  }

  // Auth tokens insert
  if (/INSERT INTO auth_tokens/i.test(t)) {
    let tokenType = 'magic_link';
    if (/'verify_email'/i.test(t)) tokenType = 'verify_email';
    else if (/'password_reset'/i.test(t)) tokenType = 'password_reset';
    else if (/'magic_link'/i.test(t)) tokenType = 'magic_link';
    else if (params.length >= 4) tokenType = params[2];

    const expiresAt = params.length === 3 ? params[2] : (params[3] || new Date(Date.now() + 86400000).toISOString());

    const tok = {
      id: 'tok-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6),
      user_id: params[0],
      token: params[1],
      token_type: tokenType,
      expires_at: expiresAt,
      used: false,
      created_at: new Date().toISOString(),
    };
    memoryStore.auth_tokens.push(tok);
    return { rows: [tok], rowCount: 1 };
  }

  // Auth tokens lookup
  if (/SELECT \* FROM auth_tokens WHERE token =/i.test(t)) {
    const token = params[0];
    const type = params[1];
    const tok = memoryStore.auth_tokens.find(
      x => x.token === token && (!type || x.token_type === type) && !x.used
    );
    return { rows: tok ? [tok] : [], rowCount: tok ? 1 : 0 };
  }

  // Auth tokens mark used
  if (/UPDATE auth_tokens SET used = TRUE/i.test(t)) {
    const token = params[0];
    const tok = memoryStore.auth_tokens.find(x => x.token === token);
    if (tok) tok.used = true;
    return { rows: [], rowCount: 1 };
  }

  // User Profile / profiles lookup
  if (/SELECT \* FROM user_profiles WHERE user_id/i.test(t) || /SELECT \* FROM profiles WHERE user_id/i.test(t)) {
    const p = memoryStore.user_profiles.find(x => x.user_id === params[0]) ||
              memoryStore.profiles.find(x => x.user_id === params[0]);
    return { rows: p ? [p] : [], rowCount: p ? 1 : 0 };
  }

  // User Profile upsert (user_profiles or profiles)
  if (/INSERT INTO user_profiles/i.test(t) || /INSERT INTO profiles/i.test(t)) {
    const userId = params[0];
    const name = params[1] || 'Student';
    let year_of_study = '3rd';
    let branch = '';
    let college = '';
    let skills = [];
    let interests = [];
    let location_pref = [];
    let opportunity_types = [];
    let github_username = null;
    let linkedin_url = null;
    let resume_filename = null;
    let imported_data = null;
    let onboarding_completed = false;

    if (params.length >= 9) {
      year_of_study = params[2] || '3rd';
      branch = params[3] || '';
      college = params[4] || '';
      skills = Array.isArray(params[5]) ? params[5] : [];
      interests = Array.isArray(params[6]) ? params[6] : [];
      location_pref = Array.isArray(params[7]) ? params[7] : [];
      opportunity_types = Array.isArray(params[8]) ? params[8] : [];

      if (params.length === 10) {
        onboarding_completed = Boolean(params[9]);
      } else if (params.length >= 13) {
        github_username = params[9] || null;
        linkedin_url = params[10] || null;
        resume_filename = params[11] || null;
        imported_data = params[12] || null;
        onboarding_completed = params[13] !== undefined ? Boolean(params[13]) : true;
      }
    }

    let parsedImp = imported_data;
    if (typeof imported_data === 'string') {
      try { parsedImp = JSON.parse(imported_data); } catch {}
    }
    const gpa = (parsedImp && typeof parsedImp === 'object') ? (parsedImp.gpa ?? parsedImp.cgpa ?? null) : null;

    const p = {
      id: 'prof-' + Date.now(),
      user_id: userId,
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
      gpa,
      onboarding_completed,
      updated_at: new Date().toISOString(),
    };

    const isUserProfilesTable = /INSERT INTO user_profiles/i.test(t);
    const isLegacyProfilesTable = /INSERT INTO profiles\s*\(/i.test(t);

    if (isUserProfilesTable || !isLegacyProfilesTable) {
      const upIdx = memoryStore.user_profiles.findIndex(x => x.user_id === userId);
      if (upIdx >= 0) memoryStore.user_profiles[upIdx] = { ...memoryStore.user_profiles[upIdx], ...p };
      else memoryStore.user_profiles.push(p);
    }

    if (isLegacyProfilesTable || !isUserProfilesTable) {
      const prIdx = memoryStore.profiles.findIndex(x => x.user_id === userId);
      if (prIdx >= 0) memoryStore.profiles[prIdx] = { ...memoryStore.profiles[prIdx], ...p };
      else memoryStore.profiles.push(p);
    }

    return { rows: [p], rowCount: 1 };
  }

  // User Alert Settings lookup
  if (/SELECT \* FROM user_alert_settings WHERE user_id/i.test(t)) {
    const s = memoryStore.user_alert_settings.find(x => x.user_id === params[0]);
    return { rows: s ? [s] : [], rowCount: s ? 1 : 0 };
  }

  // User Alert Settings upsert
  if (/INSERT INTO user_alert_settings/i.test(t)) {
    const s = {
      id: 'uas-' + Date.now(),
      user_id: params[0],
      email_enabled: params[1] !== undefined ? params[1] : true,
      telegram_enabled: params[2] !== undefined ? params[2] : false,
      telegram_chat_id: params[3] || '',
      frequency: params[4] || 'realtime',
      deadline_threshold_days: params[5] || 14,
      updated_at: new Date().toISOString(),
    };
    const idx = memoryStore.user_alert_settings.findIndex(x => x.user_id === s.user_id);
    if (idx >= 0) memoryStore.user_alert_settings[idx] = s;
    else memoryStore.user_alert_settings.push(s);
    return { rows: [s], rowCount: 1 };
  }

  // Sources list
  if (/SELECT \* FROM sources ORDER BY/i.test(t)) {
    return { rows: memoryStore.sources, rowCount: memoryStore.sources.length };
  }

  // Sources single
  if (/SELECT \* FROM sources WHERE id/i.test(t)) {
    const s = memoryStore.sources.find(x => x.id === params[0]);
    return { rows: s ? [s] : [], rowCount: s ? 1 : 0 };
  }

  // Sources insert
  if (/INSERT INTO sources/i.test(t)) {
    const s = {
      id: 'src-' + Date.now(),
      url: params[0],
      label: params[1],
      poll_interval: params[2] || 60,
      robots_allowed: true,
      last_checked_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    };
    memoryStore.sources.push(s);
    return { rows: [s], rowCount: 1 };
  }

  // Count opportunities
  if (/^\s*SELECT\s+COUNT\(\*\)\s+FROM\s+opportunities/i.test(t)) {
    return { rows: [{ count: String(memoryStore.opportunities.length) }], rowCount: 1 };
  }

  // Opportunities list
  if (/SELECT[\s\S]*FROM\s+opportunities/i.test(t)) {
    // If querying single opportunity
    if (/WHERE\s+(?:o\.)?id\s*=\s*\$1/i.test(t)) {
      const opp = memoryStore.opportunities.find(o => o.id === params[0]);
      return { rows: opp ? [opp] : [], rowCount: opp ? 1 : 0 };
    }

    // Determine querying user if present in query
    let currentUserId = null;
    const userParamMatch = t.match(/mr\.user_id\s*=\s*\$([0-9]+)/i);
    if (userParamMatch) {
      const idx = parseInt(userParamMatch[1], 10) - 1;
      if (params[idx]) currentUserId = params[idx];
    }
    if (!currentUserId && params.length > 0) {
      for (const p of params) {
        if (typeof p === 'string' && (p.startsWith('user-') || p.startsWith('a0000000-') || /^[0-9a-f-]{20,}$/i.test(p))) {
          currentUserId = p;
          break;
        }
      }
    }

    // Attach user-specific watchlist and match scores
    const rows = memoryStore.opportunities.map(o => {
      const isWatching = currentUserId
        ? (memoryStore.watchlist.some(w => w.user_id === currentUserId && w.opportunity_id === o.id) ||
           memoryStore.user_watchlist.some(w => w.user_id === currentUserId && w.opportunity_id === o.id))
        : false;
      const match = currentUserId
        ? memoryStore.match_results.find(m => m.user_id === currentUserId && m.opportunity_id === o.id)
        : null;
      const changes = memoryStore.changes.filter(c => c.opportunity_id === o.id);
      return {
        ...o,
        is_watching: isWatching,
        match_status: match ? match.match_status : null,
        match_score: match ? match.match_score : null,
        match_reason: match ? match.reason : null,
        match_evidence: match ? match.evidence : null,
        change_count: changes.length,
        source_url: o.source_url || 'http://localhost:4000/opportunities',
        source_label: o.source_label || 'OpportunityRadar Demo Portal',
      };
    });
    return { rows, rowCount: rows.length };
  }

  // Opportunities upsert
  if (/INSERT INTO opportunities/i.test(t)) {
    const opp = {
      id: 'opp-' + Date.now(),
      source_id: params[0],
      title: params[1],
      organizer: params[2],
      opp_type: params[3],
      eligibility: params[4],
      deadline: params[5],
      reward: params[6],
      apply_link: params[7],
      is_dead: params[8] || false,
      confidence: params[9] || 0.8,
      last_checked_at: new Date().toISOString(),
    };
    memoryStore.opportunities.push(opp);
    return { rows: [opp], rowCount: 1 };
  }

  // Watchlist query
  if (/SELECT[\s\S]*FROM\s+(?:user_)?watchlist/i.test(t)) {
    let rows = memoryStore.watchlist;
    if (/WHERE user_id = \$1/i.test(t)) {
      rows = rows.filter(w => w.user_id === params[0]);
    }
    return { rows, rowCount: rows.length };
  }

  // Watchlist insert
  if (/INSERT INTO (?:user_)?watchlist/i.test(t)) {
    const w = { user_id: params[0], opportunity_id: params[1], created_at: new Date().toISOString() };
    if (!memoryStore.watchlist.some(x => x.user_id === w.user_id && x.opportunity_id === w.opportunity_id)) {
      memoryStore.watchlist.push(w);
    }
    if (!memoryStore.user_watchlist.some(x => x.user_id === w.user_id && x.opportunity_id === w.opportunity_id)) {
      memoryStore.user_watchlist.push(w);
    }
    return { rows: [w], rowCount: 1 };
  }

  // Watchlist delete
  if (/DELETE FROM (?:user_)?watchlist/i.test(t)) {
    const userId = params[0];
    const oppId = params[1];
    memoryStore.watchlist = memoryStore.watchlist.filter(
      x => !(x.user_id === userId && x.opportunity_id === oppId)
    );
    memoryStore.user_watchlist = memoryStore.user_watchlist.filter(
      x => !(x.user_id === userId && x.opportunity_id === oppId)
    );
    return { rows: [], rowCount: 1 };
  }

  // Match results upsert
  if (/INSERT INTO match_results/i.test(t)) {
    const mr = {
      id: 'mr-' + Date.now(),
      user_id: params[0],
      opportunity_id: params[1],
      match_status: params[2],
      match_score: params[3],
      reason: params[4],
      evidence: params[5],
      computed_at: new Date().toISOString(),
    };
    const idx = memoryStore.match_results.findIndex(
      m => m.user_id === mr.user_id && m.opportunity_id === mr.opportunity_id
    );
    if (idx >= 0) memoryStore.match_results[idx] = mr;
    else memoryStore.match_results.push(mr);
    return { rows: [mr], rowCount: 1 };
  }

  // Changes query
  if (/SELECT[\s\S]*FROM\s+changes/i.test(t)) {
    let rows = memoryStore.changes.map(c => {
      const opp = memoryStore.opportunities.find(o => o.id === c.opportunity_id) || {};
      const src = memoryStore.sources.find(s => s.id === opp.source_id) || {};
      return {
        ...c,
        opp_title: opp.title || 'Opportunity Update',
        opp_organizer: opp.organizer || '',
        opp_type: opp.opp_type || 'internship',
        apply_link: opp.apply_link || '',
        source_url: src.url || c.source_link || 'http://localhost:4000/opportunities',
        source_label: src.label || 'Demo Portal',
      };
    });
    if (/WHERE c\.opportunity_id = \$1/i.test(t) || /WHERE opportunity_id = \$1/i.test(t)) {
      rows = rows.filter(c => c.opportunity_id === params[0]);
    }
    if (/WHERE o\.source_id = \$1/i.test(t)) {
      const oppsForSrc = memoryStore.opportunities.filter(o => o.source_id === params[0]).map(o => o.id);
      rows = rows.filter(c => oppsForSrc.includes(c.opportunity_id));
    }
    if (/change_type != 'COSMETIC'/i.test(t)) {
      rows = rows.filter(c => c.change_type !== 'COSMETIC');
    }
    return { rows, rowCount: rows.length };
  }

  // Changes insert
  if (/INSERT INTO changes/i.test(t)) {
    const hasExplicitId = /\(id\s*,/i.test(t);
    const id = hasExplicitId ? params[0] : ('chg-' + Date.now());
    const oppId = hasExplicitId ? params[1] : params[0];
    const changeType = hasExplicitId ? params[2] : params[1];
    const beforeData = hasExplicitId ? params[3] : params[2];
    const afterData = hasExplicitId ? params[4] : params[3];
    const explanation = hasExplicitId ? params[5] : params[4];
    const detectedAt = (hasExplicitId && params[6]) || new Date().toISOString();
    let parsedBefore = beforeData;
    let parsedAfter = afterData;
    try { if (typeof beforeData === 'string') parsedBefore = JSON.parse(beforeData); } catch {}
    try { if (typeof afterData === 'string') parsedAfter = JSON.parse(afterData); } catch {}
    const c = {
      id,
      opportunity_id: oppId,
      change_type: changeType,
      before_data: parsedBefore,
      after_data: parsedAfter,
      explanation,
      source_link: 'http://localhost:4000/opportunities',
      detected_at: detectedAt,
    };
    memoryStore.changes.unshift(c);
    return { rows: [c], rowCount: 1 };
  }

  // Snapshots query
  if (/SELECT[\s\S]*FROM\s+snapshots/i.test(t)) {
    return { rows: memoryStore.snapshots, rowCount: memoryStore.snapshots.length };
  }

  // Alerts query
  if (/SELECT[\s\S]*FROM\s+alerts/i.test(t)) {
    let rows = memoryStore.alerts;
    if (/WHERE a\.user_id = \$1/i.test(t) || /WHERE user_id = \$1/i.test(t)) {
      const uid = params[0];
      rows = rows.filter(a => a.user_id === uid);
    }
    if (/is_read = FALSE/i.test(t)) {
      rows = rows.filter(a => !a.is_read);
    }
    if (/SELECT COUNT\(\*\) FROM alerts/i.test(t)) {
      return { rows: [{ count: String(rows.length) }], rowCount: 1 };
    }
    return { rows, rowCount: rows.length };
  }

  // Alerts insert
  if (/INSERT INTO alerts/i.test(t)) {
    const a = {
      id: 'alt-' + Date.now(),
      user_id: params[0],
      change_id: params[1] || null,
      opportunity_id: params[2] || null,
      channel: params[3] || 'in-app',
      message: params[4] || '',
      is_read: false,
      sent_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    };
    memoryStore.alerts.unshift(a);
    return { rows: [a], rowCount: 1 };
  }

  // Alerts mark read
  if (/UPDATE alerts SET is_read = TRUE/i.test(t)) {
    const id = params[0];
    const uid = params[1];
    memoryStore.alerts.forEach(a => {
      if ((!id || a.id === id) && (!uid || a.user_id === uid)) {
        a.is_read = true;
      }
    });
    return { rows: [], rowCount: 1 };
  }

  // Generic fallback
  return { rows: [], rowCount: 0 };
}

/**
 * Execute a query and return rows.
 * Automatically tries PostgreSQL first, seamlessly falls back to memoryStore.
 */
async function query(text, params = []) {
  if (isConnected === false) {
    return memoryQuery(text, params);
  }

  try {
    const res = await pool.query(text, params);
    isConnected = true;
    return res;
  } catch (err) {
    if (isConnected === null) {
      console.warn(`[db] PostgreSQL not accessible (${err.message}). Activating in-memory fallback store.`);
      isConnected = false;
      return memoryQuery(text, params);
    }
    if (isConnected === false) {
      return memoryQuery(text, params);
    }
    throw err;
  }
}

/** Return the first row or null */
async function queryOne(text, params = []) {
  const res = await query(text, params);
  return res.rows[0] || null;
}

/** Convenience: check DB is alive */
async function ping() {
  const res = await query('SELECT 1 AS ok');
  return res.rows[0]?.ok === 1;
}

module.exports = { query, queryOne, ping, pool, memoryStore };
