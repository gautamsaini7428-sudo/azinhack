-- OpportunityRadar Database Schema
-- Runs automatically on first `docker compose up`

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Users ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email           TEXT UNIQUE NOT NULL,
  password_hash   TEXT,
  email_verified  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Auth Identities (Social logins: Google, GitHub, LinkedIn) ────────────────
CREATE TABLE IF NOT EXISTS auth_identities (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider          TEXT NOT NULL, -- 'google' | 'github' | 'linkedin' | 'password'
  provider_user_id  TEXT NOT NULL,
  profile_data      JSONB,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(provider, provider_user_id)
);

-- ── Sessions / Refresh Tokens ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sessions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked     BOOLEAN NOT NULL DEFAULT FALSE,
  user_agent  TEXT,
  ip_address  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Backward compatibility alias
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Auth Tokens (Verification & Magic Links & Password Reset) ─────────────────
CREATE TABLE IF NOT EXISTS auth_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token       TEXT NOT NULL UNIQUE,
  token_type  TEXT NOT NULL, -- 'verify_email' | 'magic_link' | 'password_reset'
  expires_at  TIMESTAMPTZ NOT NULL,
  used        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── User Profiles ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_profiles (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
  name                TEXT NOT NULL,
  year_of_study       TEXT,           -- '1st', '2nd', '3rd', '4th', 'Masters', 'PhD'
  branch              TEXT,           -- 'CS', 'ECE', 'Mech', 'Bio', etc.
  college             TEXT,
  skills              TEXT[],         -- ['Python', 'ML', 'React', …]
  interests           TEXT[],         -- ['AI', 'Climate', 'Fintech', …]
  location_pref       TEXT[],         -- ['Remote', 'Bangalore', 'US']
  opportunity_types   TEXT[],         -- ['internship', 'hackathon', 'scholarship']
  github_username     TEXT,
  linkedin_url        TEXT,
  resume_filename     TEXT,
  imported_data       JSONB,
  onboarding_completed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Backward compatible profiles table
CREATE TABLE IF NOT EXISTS profiles (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  year_of_study     TEXT,
  branch            TEXT,
  college           TEXT,
  skills            TEXT[],
  interests         TEXT[],
  location_pref     TEXT[],
  opportunity_types TEXT[],
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id)
);

-- ── User Alert Settings ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_alert_settings (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
  email_enabled        BOOLEAN NOT NULL DEFAULT TRUE,
  telegram_enabled     BOOLEAN NOT NULL DEFAULT FALSE,
  telegram_chat_id     TEXT,
  frequency            TEXT NOT NULL DEFAULT 'realtime', -- 'realtime' | 'daily' | 'weekly'
  deadline_threshold_days INTEGER NOT NULL DEFAULT 14,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Sources (URLs to monitor) ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sources (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  url             TEXT UNIQUE NOT NULL,
  label           TEXT,
  source_type     TEXT NOT NULL DEFAULT 'official', -- 'official' | 'mock'
  poll_interval   INTEGER NOT NULL DEFAULT 30,      -- minutes
  last_checked_at TIMESTAMPTZ,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  robots_allowed  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Opportunities ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS opportunities (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id      UUID NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  title          TEXT NOT NULL,
  organizer      TEXT,
  opp_type       TEXT,             -- 'internship' | 'hackathon' | 'scholarship'
  eligibility    TEXT,
  deadline       TIMESTAMPTZ,
  reward         TEXT,             -- stipend / prize / grant amount
  apply_link     TEXT,
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  is_dead        BOOLEAN NOT NULL DEFAULT FALSE,  -- closed/expired flag
  confidence     NUMERIC(4,3),    -- 0.000 – 1.000
  last_checked_at TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Snapshots (timestamped extractions) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS snapshots (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id UUID NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  source_id      UUID NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  raw_data       JSONB NOT NULL,   -- full extracted JSON from TinyFish
  evidence       JSONB,            -- {field: "source snippet"} map
  confidence     NUMERIC(4,3),
  taken_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Changes ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS changes (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id UUID NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  change_type    TEXT NOT NULL,    -- DEADLINE_CHANGED | ELIGIBILITY_CHANGED | REWARD_CHANGED | LISTING_CLOSED | NEW_LISTING | COSMETIC
  before_data    JSONB,
  after_data     JSONB,
  explanation    TEXT,             -- "Deadline moved from 12 Nov to 20 Nov"
  source_link    TEXT,
  detected_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── User Watchlist (user tracks opportunities) ───────────────────────────────
CREATE TABLE IF NOT EXISTS user_watchlist (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  opportunity_id UUID NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, opportunity_id)
);

CREATE TABLE IF NOT EXISTS watchlist (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  opportunity_id UUID NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, opportunity_id)
);

-- ── Match Results ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS match_results (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  opportunity_id UUID NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  match_status   TEXT NOT NULL,    -- 'MATCH' | 'PARTIAL' | 'NO_MATCH'
  match_score    NUMERIC(4,3),     -- 0.000 – 1.000
  reason         TEXT,             -- plain-language explanation
  evidence       TEXT,             -- supporting snippet
  computed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, opportunity_id)
);

-- ── Alerts ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS alerts (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  change_id      UUID REFERENCES changes(id) ON DELETE SET NULL,
  opportunity_id UUID REFERENCES opportunities(id) ON DELETE SET NULL,
  channel        TEXT NOT NULL,    -- 'email' | 'telegram' | 'in-app'
  message        TEXT NOT NULL,
  is_read        BOOLEAN NOT NULL DEFAULT FALSE,
  sent_at        TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Indexes ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_opportunities_source     ON opportunities(source_id);
CREATE INDEX IF NOT EXISTS idx_opportunities_deadline   ON opportunities(deadline);
CREATE INDEX IF NOT EXISTS idx_opportunities_dead       ON opportunities(is_dead);
CREATE INDEX IF NOT EXISTS idx_snapshots_opportunity    ON snapshots(opportunity_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_taken_at       ON snapshots(taken_at DESC);
CREATE INDEX IF NOT EXISTS idx_changes_opportunity      ON changes(opportunity_id);
CREATE INDEX IF NOT EXISTS idx_changes_detected_at      ON changes(detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_user              ON alerts(user_id);
CREATE INDEX IF NOT EXISTS idx_alerts_unread            ON alerts(user_id, is_read) WHERE is_read = FALSE;
CREATE INDEX IF NOT EXISTS idx_match_results_user       ON match_results(user_id);
CREATE INDEX IF NOT EXISTS idx_watchlist_user           ON watchlist(user_id);
CREATE INDEX IF NOT EXISTS idx_user_watchlist_user      ON user_watchlist(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user            ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_identities_user     ON auth_identities(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_tokens_lookup       ON auth_tokens(token, token_type);
