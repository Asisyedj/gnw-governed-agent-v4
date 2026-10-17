-- GNW remote access: OAuth 2.1 public-client flow, scoped opaque tokens, and outbound-only host agent.
-- Tokens, authorization codes, and interaction IDs are stored only as SHA-256 digests.
CREATE TABLE oauth_clients (
  client_id TEXT PRIMARY KEY,
  client_name TEXT NOT NULL CHECK (length(client_name) BETWEEN 1 AND 160),
  redirect_uris JSONB NOT NULL CHECK (jsonb_typeof(redirect_uris) = 'array' AND jsonb_array_length(redirect_uris) BETWEEN 1 AND 12),
  grant_types JSONB NOT NULL DEFAULT '["authorization_code","refresh_token"]'::jsonb,
  response_types JSONB NOT NULL DEFAULT '["code"]'::jsonb,
  token_endpoint_auth_method TEXT NOT NULL DEFAULT 'none' CHECK (token_endpoint_auth_method = 'none'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE oauth_authorization_interactions (
  interaction_hash TEXT PRIMARY KEY CHECK (interaction_hash ~ '^[0-9a-f]{64}$'),
  client_id TEXT NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
  redirect_uri TEXT NOT NULL,
  state TEXT NOT NULL,
  code_challenge TEXT NOT NULL CHECK (code_challenge ~ '^[A-Za-z0-9_-]{43,128}$'),
  scope TEXT NOT NULL,
  resource TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  tenant_id INTEGER NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (user_id,tenant_id) REFERENCES users(id,tenant_id) ON DELETE CASCADE
);
CREATE INDEX oauth_interactions_expires_idx ON oauth_authorization_interactions(expires_at);

CREATE TABLE oauth_authorization_codes (
  code_hash TEXT PRIMARY KEY CHECK (code_hash ~ '^[0-9a-f]{64}$'),
  client_id TEXT NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
  redirect_uri TEXT NOT NULL,
  code_challenge TEXT NOT NULL CHECK (code_challenge ~ '^[A-Za-z0-9_-]{43,128}$'),
  scope TEXT NOT NULL,
  resource TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  tenant_id INTEGER NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (user_id,tenant_id) REFERENCES users(id,tenant_id) ON DELETE CASCADE
);
CREATE INDEX oauth_codes_expires_idx ON oauth_authorization_codes(expires_at);

CREATE TABLE oauth_access_tokens (
  token_hash TEXT PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}
  user_id INTEGER NOT NULL,
  tenant_id INTEGER NOT NULL,
  scope TEXT NOT NULL,
  resource TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (user_id,tenant_id) REFERENCES users(id,tenant_id) ON DELETE CASCADE
);
CREATE INDEX oauth_access_expires_idx ON oauth_access_tokens(expires_at);
CREATE INDEX oauth_access_family_idx ON oauth_access_tokens(family_id);

CREATE TABLE oauth_refresh_tokens (
  token_hash TEXT PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  family_id TEXT NOT NULL,
  parent_token_hash TEXT,
  client_id TEXT NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL,
  tenant_id INTEGER NOT NULL,
  scope TEXT NOT NULL,
  resource TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (user_id,tenant_id) REFERENCES users(id,tenant_id) ON DELETE CASCADE
);
CREATE INDEX oauth_refresh_family_idx ON oauth_refresh_tokens(family_id);
CREATE INDEX oauth_refresh_expires_idx ON oauth_refresh_tokens(expires_at);

CREATE TABLE remote_agents (
  id TEXT PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  owner_user_id INTEGER NOT NULL,
  label TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 100),
  token_hash TEXT NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  last_seen_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id,tenant_id),
  FOREIGN KEY (owner_user_id,tenant_id) REFERENCES users(id,tenant_id) ON DELETE CASCADE
);
CREATE INDEX remote_agents_tenant_idx ON remote_agents(tenant_id);

CREATE UNIQUE INDEX approvals_id_tenant_uq ON approvals(id,tenant_id);

CREATE TABLE remote_tasks (
  id TEXT PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  task_id INTEGER NOT NULL,
  requested_by_user_id INTEGER NOT NULL,
  agent_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('system_status','git_status','git_diff_check','current_commit','list_project_root','typecheck','lint','production_closure','compliance','crypto_closure','build','file_read','file_change')),
  arguments_json JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (pg_column_size(arguments_json) <= 160000),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','pending_approval','running','completed','failed','denied','cancelled','expired')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0 AND attempts <= 100),
  approval_id INTEGER,
  action_digest TEXT CHECK (action_digest IS NULL OR action_digest ~ '^[0-9a-f]{64}$'),
  output JSONB CHECK (output IS NULL OR pg_column_size(output) <= 1000000),
  error_summary TEXT CHECK (error_summary IS NULL OR length(error_summary) <= 1000),
  lease_expires_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (task_id,tenant_id),
  FOREIGN KEY (task_id,tenant_id) REFERENCES tasks(id,tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (requested_by_user_id,tenant_id) REFERENCES users(id,tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (agent_id,tenant_id) REFERENCES remote_agents(id,tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (approval_id,tenant_id) REFERENCES approvals(id,tenant_id)
);
CREATE INDEX remote_tasks_agent_status_idx ON remote_tasks(agent_id,status,created_at);
CREATE INDEX remote_tasks_tenant_idx ON remote_tasks(tenant_id,status,created_at);

-- OAuth client metadata is public by design. All bearer/code tables are tenant-scoped
-- and can be discovered before login only by presenting the exact high-entropy token hash.
ALTER TABLE oauth_authorization_interactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE oauth_authorization_interactions FORCE ROW LEVEL SECURITY;
ALTER TABLE oauth_authorization_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE oauth_authorization_codes FORCE ROW LEVEL SECURITY;
ALTER TABLE oauth_access_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE oauth_access_tokens FORCE ROW LEVEL SECURITY;
ALTER TABLE oauth_refresh_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE oauth_refresh_tokens FORCE ROW LEVEL SECURITY;
ALTER TABLE remote_agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE remote_agents FORCE ROW LEVEL SECURITY;
ALTER TABLE remote_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE remote_tasks FORCE ROW LEVEL SECURITY;

CREATE POLICY oauth_interactions_tenant ON oauth_authorization_interactions
  USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::integer)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::integer);
CREATE POLICY oauth_codes_lookup ON oauth_authorization_codes FOR SELECT
  USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::integer
     OR code_hash = nullif(current_setting('app.oauth_code_hash',true),''));
CREATE POLICY oauth_codes_insert_tenant ON oauth_authorization_codes
  FOR INSERT WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::integer);
CREATE POLICY oauth_codes_update_tenant ON oauth_authorization_codes
  FOR UPDATE USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::integer)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::integer);
CREATE POLICY oauth_access_lookup ON oauth_access_tokens FOR SELECT
  USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::integer
     OR token_hash = nullif(current_setting('app.oauth_access_hash',true),''));
CREATE POLICY oauth_access_insert_tenant ON oauth_access_tokens
  FOR INSERT WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::integer);
CREATE POLICY oauth_access_update_tenant ON oauth_access_tokens
  FOR UPDATE USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::integer)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::integer);
CREATE POLICY oauth_refresh_lookup ON oauth_refresh_tokens FOR SELECT
  USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::integer
     OR token_hash = nullif(current_setting('app.oauth_refresh_hash',true),''));
CREATE POLICY oauth_refresh_insert_tenant ON oauth_refresh_tokens
  FOR INSERT WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::integer);
CREATE POLICY oauth_refresh_update_tenant ON oauth_refresh_tokens
  FOR UPDATE USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::integer)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::integer);
CREATE POLICY remote_agents_tenant_or_token ON remote_agents FOR SELECT
  USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::integer
     OR token_hash = nullif(current_setting('app.remote_agent_token_hash',true),''));
CREATE POLICY remote_agents_insert_tenant ON remote_agents
  FOR INSERT WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::integer);
CREATE POLICY remote_agents_update_tenant ON remote_agents
  FOR UPDATE USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::integer)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::integer);
CREATE POLICY remote_tasks_tenant ON remote_tasks
  USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::integer)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::integer);

REVOKE ALL ON oauth_clients,oauth_authorization_interactions,oauth_authorization_codes,oauth_access_tokens,oauth_refresh_tokens,remote_agents,remote_tasks FROM PUBLIC;
),
  family_id TEXT NOT NULL,
  client_id TEXT NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL,
  tenant_id INTEGER NOT NULL,
  scope TEXT NOT NULL,
  resource TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (user_id,tenant_id) REFERENCES users(id,tenant_id) ON DELETE CASCADE
);
CREATE INDEX oauth_access_expires_idx ON oauth_access_tokens(expires_at);

CREATE TABLE oauth_refresh_tokens (
  token_hash TEXT PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  family_id TEXT NOT NULL,
  parent_token_hash TEXT,
  client_id TEXT NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL,
  tenant_id INTEGER NOT NULL,
  scope TEXT NOT NULL,
  resource TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (user_id,tenant_id) REFERENCES users(id,tenant_id) ON DELETE CASCADE
);
CREATE INDEX oauth_refresh_family_idx ON oauth_refresh_tokens(family_id);
CREATE INDEX oauth_refresh_expires_idx ON oauth_refresh_tokens(expires_at);

CREATE TABLE remote_agents (
  id TEXT PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  owner_user_id INTEGER NOT NULL,
  label TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 100),
  token_hash TEXT NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  last_seen_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id,tenant_id),
  FOREIGN KEY (owner_user_id,tenant_id) REFERENCES users(id,tenant_id) ON DELETE CASCADE
);
CREATE INDEX remote_agents_tenant_idx ON remote_agents(tenant_id);

CREATE UNIQUE INDEX approvals_id_tenant_uq ON approvals(id,tenant_id);

CREATE TABLE remote_tasks (
  id TEXT PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  task_id INTEGER NOT NULL,
  requested_by_user_id INTEGER NOT NULL,
  agent_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('system_status','git_status','git_diff_check','current_commit','list_project_root','typecheck','lint','production_closure','compliance','crypto_closure','build','file_read','file_change')),
  arguments_json JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (pg_column_size(arguments_json) <= 160000),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','pending_approval','running','completed','failed','denied','cancelled','expired')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0 AND attempts <= 100),
  approval_id INTEGER,
  action_digest TEXT CHECK (action_digest IS NULL OR action_digest ~ '^[0-9a-f]{64}$'),
  output JSONB CHECK (output IS NULL OR pg_column_size(output) <= 1000000),
  error_summary TEXT CHECK (error_summary IS NULL OR length(error_summary) <= 1000),
  lease_expires_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (task_id,tenant_id),
  FOREIGN KEY (task_id,tenant_id) REFERENCES tasks(id,tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (requested_by_user_id,tenant_id) REFERENCES users(id,tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (agent_id,tenant_id) REFERENCES remote_agents(id,tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (approval_id,tenant_id) REFERENCES approvals(id,tenant_id)
);
CREATE INDEX remote_tasks_agent_status_idx ON remote_tasks(agent_id,status,created_at);
CREATE INDEX remote_tasks_tenant_idx ON remote_tasks(tenant_id,status,created_at);

-- OAuth client metadata is public by design. All bearer/code tables are tenant-scoped
-- and can be discovered before login only by presenting the exact high-entropy token hash.
ALTER TABLE oauth_authorization_interactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE oauth_authorization_interactions FORCE ROW LEVEL SECURITY;
ALTER TABLE oauth_authorization_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE oauth_authorization_codes FORCE ROW LEVEL SECURITY;
ALTER TABLE oauth_access_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE oauth_access_tokens FORCE ROW LEVEL SECURITY;
ALTER TABLE oauth_refresh_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE oauth_refresh_tokens FORCE ROW LEVEL SECURITY;
ALTER TABLE remote_agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE remote_agents FORCE ROW LEVEL SECURITY;
ALTER TABLE remote_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE remote_tasks FORCE ROW LEVEL SECURITY;

CREATE POLICY oauth_interactions_tenant ON oauth_authorization_interactions
  USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::integer)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::integer);
CREATE POLICY oauth_codes_lookup ON oauth_authorization_codes FOR SELECT
  USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::integer
     OR code_hash = nullif(current_setting('app.oauth_code_hash',true),''));
CREATE POLICY oauth_codes_insert_tenant ON oauth_authorization_codes
  FOR INSERT WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::integer);
CREATE POLICY oauth_codes_update_tenant ON oauth_authorization_codes
  FOR UPDATE USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::integer)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::integer);
CREATE POLICY oauth_access_lookup ON oauth_access_tokens FOR SELECT
  USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::integer
     OR token_hash = nullif(current_setting('app.oauth_access_hash',true),''));
CREATE POLICY oauth_access_insert_tenant ON oauth_access_tokens
  FOR INSERT WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::integer);
CREATE POLICY oauth_access_update_tenant ON oauth_access_tokens
  FOR UPDATE USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::integer)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::integer);
CREATE POLICY oauth_refresh_lookup ON oauth_refresh_tokens FOR SELECT
  USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::integer
     OR token_hash = nullif(current_setting('app.oauth_refresh_hash',true),''));
CREATE POLICY oauth_refresh_insert_tenant ON oauth_refresh_tokens
  FOR INSERT WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::integer);
CREATE POLICY oauth_refresh_update_tenant ON oauth_refresh_tokens
  FOR UPDATE USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::integer)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::integer);
CREATE POLICY remote_agents_tenant_or_token ON remote_agents FOR SELECT
  USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::integer
     OR token_hash = nullif(current_setting('app.remote_agent_token_hash',true),''));
CREATE POLICY remote_agents_insert_tenant ON remote_agents
  FOR INSERT WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::integer);
CREATE POLICY remote_agents_update_tenant ON remote_agents
  FOR UPDATE USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::integer)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::integer);
CREATE POLICY remote_tasks_tenant ON remote_tasks
  USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::integer)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::integer);

REVOKE ALL ON oauth_clients,oauth_authorization_interactions,oauth_authorization_codes,oauth_access_tokens,oauth_refresh_tokens,remote_agents,remote_tasks FROM PUBLIC;
