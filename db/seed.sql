-- OpportunityRadar Seed Data
-- Demo user (demo@opportunityradar.dev) + sample profile + sources

-- ── Demo user (demo@opportunityradar.dev) ────────────────────────────────────
-- password is 'demo1234'
INSERT INTO users (id, email, password_hash, email_verified) VALUES
  ('a0000000-0000-0000-0000-000000000001',
   'demo@opportunityradar.dev',
   '$2b$10$rIC3v.wF8SmJ7bW9p/gvzuLMqvYEQmP/DSjHDRRMfpf5k5dVMz6We',
   TRUE),
  ('a0000000-0000-0000-0000-000000000002',
   'priya@demo.local',
   '$2b$10$rIC3v.wF8SmJ7bW9p/gvzuLMqvYEQmP/DSjHDRRMfpf5k5dVMz6We',
   TRUE)
ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, password_hash = EXCLUDED.password_hash, email_verified = TRUE;

-- ── Demo Auth Identity ───────────────────────────────────────────────────────
INSERT INTO auth_identities (id, user_id, provider, provider_user_id) VALUES
  ('c0000000-0000-0000-0000-000000000001',
   'a0000000-0000-0000-0000-000000000001',
   'password',
   'demo@opportunityradar.dev')
ON CONFLICT (provider, provider_user_id) DO NOTHING;

-- ── Demo user profile ────────────────────────────────────────────────────────
INSERT INTO user_profiles (user_id, name, year_of_study, branch, college, skills,
                           interests, location_pref, opportunity_types, onboarding_completed)
VALUES (
  'a0000000-0000-0000-0000-000000000001',
  'Priya Sharma',
  '3rd',
  'Computer Science',
  'IIT Bombay',
  ARRAY['Python', 'Machine Learning', 'React', 'Node.js', 'SQL'],
  ARRAY['AI/ML', 'Climate Tech', 'EdTech'],
  ARRAY['Remote', 'Bangalore', 'Mumbai'],
  ARRAY['internship', 'hackathon', 'scholarship'],
  TRUE
) ON CONFLICT (user_id) DO UPDATE SET
  name = EXCLUDED.name,
  year_of_study = EXCLUDED.year_of_study,
  branch = EXCLUDED.branch,
  college = EXCLUDED.college,
  skills = EXCLUDED.skills,
  interests = EXCLUDED.interests,
  location_pref = EXCLUDED.location_pref,
  opportunity_types = EXCLUDED.opportunity_types,
  onboarding_completed = TRUE;

-- Backward compatibility profiles table
INSERT INTO profiles (user_id, name, year_of_study, branch, college, skills,
                      interests, location_pref, opportunity_types)
VALUES (
  'a0000000-0000-0000-0000-000000000001',
  'Priya Sharma',
  '3rd',
  'Computer Science',
  'IIT Bombay',
  ARRAY['Python', 'Machine Learning', 'React', 'Node.js', 'SQL'],
  ARRAY['AI/ML', 'Climate Tech', 'EdTech'],
  ARRAY['Remote', 'Bangalore', 'Mumbai'],
  ARRAY['internship', 'hackathon', 'scholarship']
) ON CONFLICT (user_id) DO NOTHING;

-- ── Demo alert settings ──────────────────────────────────────────────────────
INSERT INTO user_alert_settings (user_id, email_enabled, telegram_enabled, frequency)
VALUES (
  'a0000000-0000-0000-0000-000000000001',
  TRUE,
  FALSE,
  'realtime'
) ON CONFLICT (user_id) DO NOTHING;

-- ── Sources to monitor ────────────────────────────────────────────────────────
-- Mock portal (always available in Docker)
INSERT INTO sources (id, url, label, source_type, poll_interval, robots_allowed)
VALUES
  ('b0000000-0000-0000-0000-000000000001',
   'http://mock-portal:4000/opportunities',
   'OpportunityRadar Demo Portal',
   'mock',
   5,
   TRUE)
ON CONFLICT (url) DO NOTHING;

-- Real public opportunity pages
INSERT INTO sources (id, url, label, source_type, poll_interval, robots_allowed)
VALUES
  ('b0000000-0000-0000-0000-000000000002',
   'https://unstop.com/hackathons',
   'Unstop Hackathons',
   'official',
   60,
   TRUE),
  ('b0000000-0000-0000-0000-000000000003',
   'https://devpost.com/hackathons',
   'Devpost Hackathons',
   'official',
   60,
   TRUE)
ON CONFLICT (url) DO NOTHING;
