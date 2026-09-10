-- Applied through Floot execute_sql on top of the seeded auth tables (users, sessions, user_passwords, login_attempts).
CREATE TYPE workflow_kind AS ENUM ('build', 'research', 'review');
CREATE TYPE run_mode AS ENUM ('demo', 'remote');
CREATE TYPE run_status AS ENUM ('running', 'completed', 'failed', 'cancelled', 'interrupted');
CREATE TABLE notes (
  id text PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title text NOT NULL,
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notes_user_created_idx ON notes(user_id, created_at DESC);
CREATE TABLE runs (
  id text PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  goal text NOT NULL,
  workflow workflow_kind NOT NULL,
  mode run_mode NOT NULL,
  model text NOT NULL,
  status run_status NOT NULL,
  started_at timestamptz NOT NULL,
  completed_at timestamptz,
  tokens integer NOT NULL DEFAULT 0,
  calls integer NOT NULL DEFAULT 0,
  cache_hits integer NOT NULL DEFAULT 0,
  context_titles jsonb NOT NULL DEFAULT '[]'::jsonb,
  steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX runs_user_started_idx ON runs(user_id, started_at DESC);

-- Anonymous proxy rate limiting (60 requests per minute per client address).
CREATE TABLE rate_limits (
  key text PRIMARY KEY,
  window_start timestamptz NOT NULL,
  count integer NOT NULL DEFAULT 0
);
-- notes and runs tables above are unused after the switch to browser-local storage.
