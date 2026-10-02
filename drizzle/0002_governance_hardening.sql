ALTER TABLE interlocks ADD COLUMN IF NOT EXISTS reason TEXT;

-- GNW governance hardening: close remaining tenant-isolation gaps.
ALTER TABLE budget_reservations ADD COLUMN IF NOT EXISTS tenant_id INTEGER;

UPDATE budget_reservations br
SET tenant_id=t.tenant_id
FROM tasks t
WHERE br.task_id=t.id AND br.tenant_id IS NULL;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM budget_reservations WHERE tenant_id IS NULL
  ) THEN RAISE EXCEPTION 'budget_reservations tenant_id cannot be null after backfill'; END IF;

  IF EXISTS (
    SELECT 1 FROM capability_leases
    WHERE task_id IS NULL OR tenant_id IS NULL OR actor_user_id IS NULL
  ) THEN RAISE EXCEPTION 'capability_leases required tenant bindings cannot be null'; END IF;

  IF EXISTS (
    SELECT 1 FROM sessions s
    JOIN users u ON u.id=s.user_id
    WHERE s.tenant_id<>u.tenant_id
  ) THEN RAISE EXCEPTION 'sessions tenant mismatch'; END IF;

  IF EXISTS (
    SELECT 1 FROM tasks t
    JOIN users u ON u.id=t.created_by_user_id
    WHERE t.tenant_id<>u.tenant_id
  ) THEN RAISE EXCEPTION 'tasks creator tenant mismatch'; END IF;

  IF EXISTS (
    SELECT 1 FROM task_steps s
    JOIN tasks t ON t.id=s.task_id
    WHERE s.tenant_id<>t.tenant_id
  ) THEN RAISE EXCEPTION 'task_steps tenant mismatch'; END IF;

  IF EXISTS (
    SELECT 1 FROM approvals a
    JOIN tasks t ON t.id=a.task_id
    WHERE a.tenant_id<>t.tenant_id
  ) THEN RAISE EXCEPTION 'approvals task tenant mismatch'; END IF;

  IF EXISTS (
    SELECT 1 FROM approvals a
    JOIN users u ON u.id=a.requested_by_user_id
    WHERE a.tenant_id<>u.tenant_id
  ) THEN RAISE EXCEPTION 'approvals requester tenant mismatch'; END IF;

  IF EXISTS (
    SELECT 1 FROM approvals a
    JOIN users u ON u.id=a.reviewed_by_user_id
    WHERE a.tenant_id<>u.tenant_id
  ) THEN RAISE EXCEPTION 'approvals reviewer tenant mismatch'; END IF;

  IF EXISTS (
    SELECT 1 FROM budget_reservations b
    JOIN tasks t ON t.id=b.task_id
    WHERE b.tenant_id<>t.tenant_id
  ) THEN RAISE EXCEPTION 'budget_reservations tenant mismatch'; END IF;

  IF EXISTS (
    SELECT 1 FROM artifacts a
    JOIN tasks t ON t.id=a.task_id
    WHERE a.tenant_id<>t.tenant_id
  ) THEN RAISE EXCEPTION 'artifacts task tenant mismatch'; END IF;

  IF EXISTS (
    SELECT 1 FROM artifacts a
    JOIN task_steps s ON s.id=a.step_id
    WHERE a.tenant_id<>s.tenant_id
  ) THEN RAISE EXCEPTION 'artifacts step tenant mismatch'; END IF;

  IF EXISTS (
    SELECT 1 FROM capability_leases c
    JOIN tasks t ON t.id=c.task_id
    WHERE c.tenant_id<>t.tenant_id
  ) THEN RAISE EXCEPTION 'capability lease task tenant mismatch'; END IF;

  IF EXISTS (
    SELECT 1 FROM capability_leases c
    JOIN users u ON u.id=c.actor_user_id
    WHERE c.tenant_id<>u.tenant_id
  ) THEN RAISE EXCEPTION 'capability lease actor tenant mismatch'; END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS users_id_tenant_uq ON users(id,tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS tasks_id_tenant_uq ON tasks(id,tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS task_steps_id_tenant_uq ON task_steps(id,tenant_id);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='sessions_user_same_tenant_fk') THEN
    ALTER TABLE sessions
      ADD CONSTRAINT sessions_user_same_tenant_fk
      FOREIGN KEY (user_id,tenant_id) REFERENCES users(id,tenant_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='tasks_creator_same_tenant_fk') THEN
    ALTER TABLE tasks
      ADD CONSTRAINT tasks_creator_same_tenant_fk
      FOREIGN KEY (created_by_user_id,tenant_id) REFERENCES users(id,tenant_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='task_steps_task_same_tenant_fk') THEN
    ALTER TABLE task_steps
      ADD CONSTRAINT task_steps_task_same_tenant_fk
      FOREIGN KEY (task_id,tenant_id) REFERENCES tasks(id,tenant_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='approvals_task_same_tenant_fk') THEN
    ALTER TABLE approvals
      ADD CONSTRAINT approvals_task_same_tenant_fk
      FOREIGN KEY (task_id,tenant_id) REFERENCES tasks(id,tenant_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='approvals_requester_same_tenant_fk') THEN
    ALTER TABLE approvals
      ADD CONSTRAINT approvals_requester_same_tenant_fk
      FOREIGN KEY (requested_by_user_id,tenant_id) REFERENCES users(id,tenant_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='approvals_reviewer_same_tenant_fk') THEN
    ALTER TABLE approvals
      ADD CONSTRAINT approvals_reviewer_same_tenant_fk
      FOREIGN KEY (reviewed_by_user_id,tenant_id) REFERENCES users(id,tenant_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='budget_task_same_tenant_fk') THEN
    ALTER TABLE budget_reservations
      ADD CONSTRAINT budget_task_same_tenant_fk
      FOREIGN KEY (task_id,tenant_id) REFERENCES tasks(id,tenant_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='artifacts_task_same_tenant_fk') THEN
    ALTER TABLE artifacts
      ADD CONSTRAINT artifacts_task_same_tenant_fk
      FOREIGN KEY (task_id,tenant_id) REFERENCES tasks(id,tenant_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='artifacts_step_same_tenant_fk') THEN
    ALTER TABLE artifacts
      ADD CONSTRAINT artifacts_step_same_tenant_fk
      FOREIGN KEY (step_id,tenant_id) REFERENCES task_steps(id,tenant_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='capability_task_same_tenant_fk') THEN
    ALTER TABLE capability_leases
      ADD CONSTRAINT capability_task_same_tenant_fk
      FOREIGN KEY (task_id,tenant_id) REFERENCES tasks(id,tenant_id);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='capability_actor_same_tenant_fk') THEN
    ALTER TABLE capability_leases
      ADD CONSTRAINT capability_actor_same_tenant_fk
      FOREIGN KEY (actor_user_id,tenant_id) REFERENCES users(id,tenant_id);
  END IF;
END $$;

-- Capability leases are security evidence and must persist the complete authorization binding.
ALTER TABLE capability_leases ADD COLUMN IF NOT EXISTS request_id TEXT;
ALTER TABLE capability_leases ADD COLUMN IF NOT EXISTS action_digest TEXT;
ALTER TABLE capability_leases ADD COLUMN IF NOT EXISTS subject TEXT;
ALTER TABLE capability_leases ADD COLUMN IF NOT EXISTS destination TEXT;
ALTER TABLE capability_leases ADD COLUMN IF NOT EXISTS interlock_generation INTEGER;
ALTER TABLE capability_leases ADD COLUMN IF NOT EXISTS issuer TEXT;
ALTER TABLE capability_leases ADD COLUMN IF NOT EXISTS signature TEXT;
ALTER TABLE capability_leases ADD COLUMN IF NOT EXISTS consumed_at TIMESTAMPTZ;

DO $ BEGIN
  IF EXISTS (
    SELECT 1 FROM capability_leases
    WHERE request_id IS NULL
       OR action_digest IS NULL
       OR subject IS NULL
       OR interlock_generation IS NULL
       OR issuer IS NULL
       OR signature IS NULL
  ) THEN
    RAISE EXCEPTION 'existing capability_leases require an explicit re-issuance/backfill before enabling complete lease evidence';
  END IF;
END $;

CREATE INDEX IF NOT EXISTS capability_leases_action_digest_idx ON capability_leases(action_digest);
CREATE INDEX IF NOT EXISTS capability_leases_request_idx ON capability_leases(request_id);
CREATE INDEX IF NOT EXISTS capability_leases_expiry_idx ON capability_leases(expires_at);

ALTER TABLE capability_leases ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE capability_leases ALTER COLUMN task_id SET NOT NULL;
ALTER TABLE capability_leases ALTER COLUMN actor_user_id SET NOT NULL;

ALTER TABLE budget_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE budget_reservations FORCE ROW LEVEL SECURITY;
ALTER TABLE capability_leases ENABLE ROW LEVEL SECURITY;
ALTER TABLE capability_leases FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS gnw_budget_reservations_tenant ON budget_reservations;
CREATE POLICY gnw_budget_reservations_tenant ON budget_reservations
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::integer)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::integer);

DROP POLICY IF EXISTS gnw_capability_leases_tenant ON capability_leases;
CREATE POLICY gnw_capability_leases_tenant ON capability_leases
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::integer)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::integer);

-- RLS must fail closed if application code forgets to establish tenant context.
REVOKE ALL ON budget_reservations, capability_leases FROM PUBLIC;
