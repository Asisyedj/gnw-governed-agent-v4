-- Durable workflows, queue leases, exact action approvals, and tenant RLS.
-- tenant_id intentionally uses INTEGER to match GNW's existing tenants.id serial key.
CREATE TABLE IF NOT EXISTS workflow_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  task_id INTEGER,
  state TEXT NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','planning','researching','implementation_ready','implementing','testing','reviewing','awaiting_human_approval','verifying','completed','blocked','failed','cancel_requested','cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 10),
  deadline_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS workflow_runs_tenant_state_idx ON workflow_runs(tenant_id,state);
CREATE TABLE IF NOT EXISTS workflow_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  workflow_id UUID NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  agent_role TEXT NOT NULL,
  state TEXT NOT NULL,
  input_digest TEXT NOT NULL CHECK (input_digest ~ '^[a-f0-9]{64}$'),
  output_digest TEXT CHECK (output_digest IS NULL OR output_digest ~ '^[a-f0-9]{64}$'),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  error_code TEXT
);
CREATE INDEX IF NOT EXISTS workflow_steps_tenant_workflow_idx ON workflow_steps(tenant_id,workflow_id);
CREATE TABLE IF NOT EXISTS workflow_events (
  id BIGSERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  workflow_id UUID NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  actor TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS workflow_events_tenant_workflow_idx ON workflow_events(tenant_id,workflow_id,occurred_at);
CREATE TABLE IF NOT EXISTS job_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  workflow_id UUID REFERENCES workflow_runs(id) ON DELETE CASCADE,
  job_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  payload_digest TEXT NOT NULL CHECK (payload_digest ~ '^[a-f0-9]{64}$'),
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','leased','succeeded','retryable','failed','cancel_requested','cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 10),
  run_after TIMESTAMPTZ NOT NULL DEFAULT now(),
  lease_owner TEXT,
  lease_token UUID,
  lease_expires_at TIMESTAMPTZ,
  cancel_requested_at TIMESTAMPTZ,
  last_error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, idempotency_key),
  CHECK ((status IN ('leased','cancel_requested') AND lease_owner IS NOT NULL AND lease_token IS NOT NULL AND lease_expires_at IS NOT NULL) OR (status NOT IN ('leased','cancel_requested') AND lease_owner IS NULL AND lease_token IS NULL AND lease_expires_at IS NULL))
);
CREATE INDEX IF NOT EXISTS job_queue_claim_idx ON job_queue(status,run_after,lease_expires_at,created_at);
CREATE INDEX IF NOT EXISTS job_queue_tenant_idx ON job_queue(tenant_id,status);
CREATE TABLE IF NOT EXISTS action_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  task_id INTEGER,
  actor_id INTEGER NOT NULL REFERENCES users(id),
  approver_id INTEGER NOT NULL REFERENCES users(id),
  action_type TEXT NOT NULL,
  tool_id TEXT NOT NULL,
  target TEXT NOT NULL,
  payload_digest TEXT NOT NULL CHECK (payload_digest ~ '^[a-f0-9]{64}$'),
  nonce UUID NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'granted' CHECK (status IN ('pending','granted','denied','consumed','expired')),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (actor_id <> approver_id),
  FOREIGN KEY (actor_id, tenant_id) REFERENCES users(id, tenant_id) ON DELETE CASCADE,
  FOREIGN KEY (approver_id, tenant_id) REFERENCES users(id, tenant_id) ON DELETE CASCADE,
  CHECK ((status = 'consumed') = (consumed_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS action_approvals_tenant_digest_idx ON action_approvals(tenant_id,payload_digest,status);
CREATE INDEX IF NOT EXISTS action_approvals_expiry_idx ON action_approvals(expires_at) WHERE status='granted';
-- RLS on all new tenant-owned tables. app.tenant_id must be set transaction-locally.
DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['workflow_runs','workflow_steps','workflow_events','job_queue','action_approvals'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I',t || '_tenant_isolation',t);
    EXECUTE format('CREATE POLICY %I ON %I USING (tenant_id = nullif(current_setting(''app.tenant_id'',true),'''')::integer) WITH CHECK (tenant_id = nullif(current_setting(''app.tenant_id'',true),'''')::integer)',t || '_tenant_isolation',t);
  END LOOP;
END $$;
