-- GNW production hardening: PostgreSQL schema alignment and real RLS.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE budget_reservations ADD COLUMN IF NOT EXISTS tenant_id INTEGER;
CREATE TABLE IF NOT EXISTS capability_leases (
 id SERIAL PRIMARY KEY, lease_id TEXT NOT NULL UNIQUE, task_id INTEGER, tenant_id INTEGER, actor_user_id INTEGER, capability TEXT NOT NULL,
 issued_at TIMESTAMPTZ NOT NULL, expires_at TIMESTAMPTZ NOT NULL, revoked_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE capability_leases ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();
UPDATE budget_reservations br SET tenant_id=t.tenant_id FROM tasks t WHERE br.task_id=t.id AND br.tenant_id IS NULL;
ALTER TABLE budget_reservations ALTER COLUMN tenant_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS budget_res_tenant_idx ON budget_reservations(tenant_id);
ALTER TABLE users ENABLE ROW LEVEL SECURITY; ALTER TABLE users FORCE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY; ALTER TABLE tasks FORCE ROW LEVEL SECURITY;
ALTER TABLE task_steps ENABLE ROW LEVEL SECURITY; ALTER TABLE task_steps FORCE ROW LEVEL SECURITY;
ALTER TABLE approvals ENABLE ROW LEVEL SECURITY; ALTER TABLE approvals FORCE ROW LEVEL SECURITY;
ALTER TABLE budget_reservations ENABLE ROW LEVEL SECURITY; ALTER TABLE budget_reservations FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY; ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;
ALTER TABLE capability_leases ENABLE ROW LEVEL SECURITY; ALTER TABLE capability_leases FORCE ROW LEVEL SECURITY;
ALTER TABLE artifacts ENABLE ROW LEVEL SECURITY; ALTER TABLE artifacts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS users_tenant_isolation ON users;
CREATE POLICY users_tenant_isolation ON users USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::integer) WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::integer);
DROP POLICY IF EXISTS tasks_tenant_isolation ON tasks;
CREATE POLICY tasks_tenant_isolation ON tasks USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::integer) WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::integer);
DROP POLICY IF EXISTS task_steps_tenant_isolation ON task_steps;
CREATE POLICY task_steps_tenant_isolation ON task_steps USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::integer) WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::integer);
DROP POLICY IF EXISTS approvals_tenant_isolation ON approvals;
CREATE POLICY approvals_tenant_isolation ON approvals USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::integer) WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::integer);
DROP POLICY IF EXISTS budget_tenant_isolation ON budget_reservations;
CREATE POLICY budget_tenant_isolation ON budget_reservations USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::integer) WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::integer);
DROP POLICY IF EXISTS audit_tenant_isolation ON audit_log;
CREATE POLICY audit_tenant_isolation ON audit_log USING (tenant_id IS NULL OR tenant_id=nullif(current_setting('app.tenant_id',true),'')::integer) WITH CHECK (tenant_id IS NULL OR tenant_id=nullif(current_setting('app.tenant_id',true),'')::integer);
DROP POLICY IF EXISTS capability_tenant_isolation ON capability_leases;
CREATE POLICY capability_tenant_isolation ON capability_leases USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::integer) WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::integer);
DROP POLICY IF EXISTS artifacts_tenant_isolation ON artifacts;
CREATE POLICY artifacts_tenant_isolation ON artifacts USING (tenant_id=nullif(current_setting('app.tenant_id',true),'')::integer) WITH CHECK (tenant_id=nullif(current_setting('app.tenant_id',true),'')::integer);