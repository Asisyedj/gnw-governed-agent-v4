-- GNW governance hardening: close remaining tenant-isolation gaps.
ALTER TABLE budget_reservations ADD COLUMN IF NOT EXISTS tenant_id INTEGER;
UPDATE budget_reservations br SET tenant_id=t.tenant_id FROM tasks t WHERE br.task_id=t.id AND br.tenant_id IS NULL;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='budget_reservations' AND column_name='tenant_id') THEN
    ALTER TABLE budget_reservations ALTER COLUMN tenant_id SET NOT NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS budget_res_tenant_idx ON budget_reservations(tenant_id);
CREATE INDEX IF NOT EXISTS capability_leases_tenant_idx ON capability_leases(tenant_id);
CREATE INDEX IF NOT EXISTS artifacts_task_idx ON artifacts(task_id);

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
