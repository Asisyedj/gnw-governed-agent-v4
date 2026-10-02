-- GNW production tenant isolation. Run only after tenant_id backfill is complete.
DO $$ BEGIN
  IF to_regclass('public.users') IS NOT NULL THEN EXECUTE 'ALTER TABLE users ENABLE ROW LEVEL SECURITY'; EXECUTE 'ALTER TABLE users FORCE ROW LEVEL SECURITY'; END IF;
  IF to_regclass('public.tasks') IS NOT NULL THEN EXECUTE 'ALTER TABLE tasks ENABLE ROW LEVEL SECURITY'; EXECUTE 'ALTER TABLE tasks FORCE ROW LEVEL SECURITY'; END IF;
  IF to_regclass('public.task_steps') IS NOT NULL THEN EXECUTE 'ALTER TABLE task_steps ENABLE ROW LEVEL SECURITY'; EXECUTE 'ALTER TABLE task_steps FORCE ROW LEVEL SECURITY'; END IF;
  IF to_regclass('public.approvals') IS NOT NULL THEN EXECUTE 'ALTER TABLE approvals ENABLE ROW LEVEL SECURITY'; EXECUTE 'ALTER TABLE approvals FORCE ROW LEVEL SECURITY'; END IF;
  IF to_regclass('public.audit_log') IS NOT NULL THEN EXECUTE 'ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY'; EXECUTE 'ALTER TABLE audit_log FORCE ROW LEVEL SECURITY'; END IF;
  IF to_regclass('public.artifacts') IS NOT NULL THEN EXECUTE 'ALTER TABLE artifacts ENABLE ROW LEVEL SECURITY'; EXECUTE 'ALTER TABLE artifacts FORCE ROW LEVEL SECURITY'; END IF;
END $$;

DO $$ BEGIN
  IF to_regclass('public.users') IS NOT NULL THEN
    DROP POLICY IF EXISTS gnw_users_tenant ON users;
    CREATE POLICY gnw_users_tenant ON users USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::integer) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::integer);
  END IF;
  IF to_regclass('public.tasks') IS NOT NULL THEN
    DROP POLICY IF EXISTS gnw_tasks_tenant ON tasks;
    CREATE POLICY gnw_tasks_tenant ON tasks USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::integer) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::integer);
  END IF;
  IF to_regclass('public.task_steps') IS NOT NULL THEN
    DROP POLICY IF EXISTS gnw_task_steps_tenant ON task_steps;
    CREATE POLICY gnw_task_steps_tenant ON task_steps USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::integer) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::integer);
  END IF;
  IF to_regclass('public.approvals') IS NOT NULL THEN
    DROP POLICY IF EXISTS gnw_approvals_tenant ON approvals;
    CREATE POLICY gnw_approvals_tenant ON approvals USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::integer) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::integer);
  END IF;
  IF to_regclass('public.audit_log') IS NOT NULL THEN
    DROP POLICY IF EXISTS gnw_audit_tenant ON audit_log;
    CREATE POLICY gnw_audit_tenant ON audit_log USING (tenant_id IS NULL OR tenant_id = nullif(current_setting('app.tenant_id', true), '')::integer) WITH CHECK (tenant_id IS NULL OR tenant_id = nullif(current_setting('app.tenant_id', true), '')::integer);
  END IF;
  IF to_regclass('public.artifacts') IS NOT NULL THEN
    DROP POLICY IF EXISTS gnw_artifacts_tenant ON artifacts;
    CREATE POLICY gnw_artifacts_tenant ON artifacts USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::integer) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::integer);
  END IF;
END $$;
