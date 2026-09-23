-- GNW Governed Agent v4 — initial schema migration
-- Generated for: PostgreSQL 16
-- Run via: drizzle-kit migrate

CREATE TABLE IF NOT EXISTS tenants (
  id           SERIAL PRIMARY KEY,
  slug         TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  tenant_id     INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email         TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('owner','admin','operator','viewer')),
  last_login_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, email)
);

CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id   INTEGER NOT NULL,
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_token_hash_idx ON sessions(token_hash);
CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS tasks (
  id                       SERIAL PRIMARY KEY,
  tenant_id                INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  created_by_user_id       INTEGER REFERENCES users(id),
  title                    TEXT NOT NULL,
  description              TEXT,
  classification           TEXT NOT NULL DEFAULT 'standard',
  status                   TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','running','waiting_approval','done','failed','cancelled')),
  budget_tokens_allocated  INTEGER NOT NULL DEFAULT 10000,
  budget_tokens_used       INTEGER NOT NULL DEFAULT 0,
  budget_bytes_allocated   BIGINT NOT NULL DEFAULT 10485760,
  budget_bytes_used        BIGINT NOT NULL DEFAULT 0,
  trajectory_root_hash     TEXT,
  trajectory_steps         INTEGER NOT NULL DEFAULT 0,
  error_message            TEXT,
  metadata                 JSONB,
  started_at               TIMESTAMPTZ,
  completed_at             TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tasks_tenant_id_idx  ON tasks(tenant_id);
CREATE INDEX IF NOT EXISTS tasks_status_idx     ON tasks(status);
CREATE INDEX IF NOT EXISTS tasks_created_at_idx ON tasks(created_at DESC);

CREATE TABLE IF NOT EXISTS task_steps (
  id                  SERIAL PRIMARY KEY,
  task_id             INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  tenant_id           INTEGER NOT NULL,
  step_index          INTEGER NOT NULL,
  agent_role          TEXT NOT NULL,
  tool_name           TEXT NOT NULL,
  operation           TEXT NOT NULL,
  input_digest        TEXT NOT NULL,
  output_digest       TEXT,
  chain_hash          TEXT NOT NULL,
  prev_chain_hash     TEXT,
  status              TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','running','done','failed','denied')),
  governance_decision JSONB,
  duration_ms         INTEGER,
  error_message       TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS task_steps_task_id_idx ON task_steps(task_id);

CREATE TABLE IF NOT EXISTS approvals (
  id                    SERIAL PRIMARY KEY,
  tenant_id             INTEGER NOT NULL,
  task_id               INTEGER REFERENCES tasks(id),
  requested_by_user_id  INTEGER REFERENCES users(id),
  reviewed_by_user_id   INTEGER REFERENCES users(id),
  action_digest         TEXT NOT NULL,
  request_id            TEXT,
  nonce                 TEXT NOT NULL UNIQUE,
  status                TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','denied','expired')),
  reason                TEXT,
  expires_at            TIMESTAMPTZ NOT NULL,
  reviewed_at           TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS approvals_tenant_status_idx ON approvals(tenant_id, status);
CREATE INDEX IF NOT EXISTS approvals_expires_at_idx    ON approvals(expires_at);

CREATE TABLE IF NOT EXISTS nonces (
  id         SERIAL PRIMARY KEY,
  kind       TEXT NOT NULL,
  nonce      TEXT NOT NULL,
  task_id    INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (kind, nonce)
);

CREATE TABLE IF NOT EXISTS interlocks (
  id                  SERIAL PRIMARY KEY,
  kill_switch         BOOLEAN NOT NULL DEFAULT false,
  circuit_open        BOOLEAN NOT NULL DEFAULT false,
  generation          INTEGER NOT NULL DEFAULT 0,
  updated_by_user_id  INTEGER REFERENCES users(id),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO interlocks (kill_switch, circuit_open, generation)
  VALUES (false, false, 0)
  ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS budget_reservations (
  id               SERIAL PRIMARY KEY,
  task_id          INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  grant_nonce      TEXT NOT NULL UNIQUE,
  reserved_tokens  INTEGER NOT NULL,
  reserved_bytes   BIGINT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_log (
  id             BIGSERIAL PRIMARY KEY,
  event_type     TEXT NOT NULL,
  actor_id       INTEGER,
  tenant_id      INTEGER,
  task_id        INTEGER,
  resource_type  TEXT,
  resource_id    TEXT,
  outcome        TEXT CHECK (outcome IN ('success','failure','denied','error')),
  detail         JSONB,
  request_id     TEXT,
  ip_address     TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_log_tenant_id_idx  ON audit_log(tenant_id);
CREATE INDEX IF NOT EXISTS audit_log_created_at_idx ON audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_event_type_idx ON audit_log(event_type);

CREATE TABLE IF NOT EXISTS artifacts (
  id           SERIAL PRIMARY KEY,
  tenant_id    INTEGER NOT NULL,
  task_id      INTEGER REFERENCES tasks(id),
  step_id      INTEGER REFERENCES task_steps(id),
  storage_key  TEXT NOT NULL UNIQUE,
  filename     TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size         BIGINT NOT NULL,
  sha256       TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
