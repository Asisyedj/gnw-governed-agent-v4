-- GNW governed-agent evidence and decision persistence.
CREATE TABLE IF NOT EXISTS evidence_records (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  task_id INTEGER NOT NULL,
  evidence_id TEXT NOT NULL,
  claim_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_family TEXT NOT NULL,
  evidence_type TEXT NOT NULL,
  statement TEXT NOT NULL,
  locator TEXT NOT NULL,
  retrieved_at TIMESTAMPTZ NOT NULL,
  content_digest TEXT NOT NULL,
  derived_from JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'accepted',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS governance_reviews (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  task_id INTEGER NOT NULL,
  stage TEXT NOT NULL,
  reviewer_role TEXT NOT NULL,
  status TEXT NOT NULL,
  findings JSONB NOT NULL DEFAULT '[]'::jsonb,
  evidence_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS governance_challenges (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  task_id INTEGER NOT NULL,
  actor_role TEXT NOT NULL,
  category TEXT NOT NULL,
  status TEXT NOT NULL,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS governance_decisions (
  id SERIAL PRIMARY KEY,
  tenant_id INTEGER NOT NULL,
  task_id INTEGER NOT NULL,
  status TEXT NOT NULL,
  findings JSONB NOT NULL DEFAULT '[]'::jsonb,
  evidence_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  justice_review JSONB NOT NULL DEFAULT '{}'::jsonb,
  uncertainties JSONB NOT NULL DEFAULT '[]'::jsonb,
  corrections JSONB NOT NULL DEFAULT '[]'::jsonb,
  audit_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS evidence_id_tenant_uq ON evidence_records(evidence_id,tenant_id);
CREATE INDEX IF NOT EXISTS evidence_task_idx ON evidence_records(task_id);
CREATE INDEX IF NOT EXISTS evidence_tenant_idx ON evidence_records(tenant_id);
CREATE INDEX IF NOT EXISTS governance_reviews_task_idx ON governance_reviews(task_id);
CREATE INDEX IF NOT EXISTS governance_reviews_tenant_idx ON governance_reviews(tenant_id);
CREATE INDEX IF NOT EXISTS governance_challenges_task_idx ON governance_challenges(task_id);
CREATE INDEX IF NOT EXISTS governance_challenges_tenant_idx ON governance_challenges(tenant_id);
CREATE INDEX IF NOT EXISTS governance_decisions_task_idx ON governance_decisions(task_id);
CREATE INDEX IF NOT EXISTS governance_decisions_tenant_idx ON governance_decisions(tenant_id);

ALTER TABLE evidence_records ENABLE ROW LEVEL SECURITY; ALTER TABLE evidence_records FORCE ROW LEVEL SECURITY;
ALTER TABLE governance_reviews ENABLE ROW LEVEL SECURITY; ALTER TABLE governance_reviews FORCE ROW LEVEL SECURITY;
ALTER TABLE governance_challenges ENABLE ROW LEVEL SECURITY; ALTER TABLE governance_challenges FORCE ROW LEVEL SECURITY;
ALTER TABLE governance_decisions ENABLE ROW LEVEL SECURITY; ALTER TABLE governance_decisions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS gnw_evidence_tenant ON evidence_records;
CREATE POLICY gnw_evidence_tenant ON evidence_records USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::integer) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::integer);
DROP POLICY IF EXISTS gnw_reviews_tenant ON governance_reviews;
CREATE POLICY gnw_reviews_tenant ON governance_reviews USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::integer) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::integer);
DROP POLICY IF EXISTS gnw_challenges_tenant ON governance_challenges;
CREATE POLICY gnw_challenges_tenant ON governance_challenges USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::integer) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::integer);
DROP POLICY IF EXISTS gnw_decisions_tenant ON governance_decisions;
CREATE POLICY gnw_decisions_tenant ON governance_decisions USING (tenant_id = nullif(current_setting('app.tenant_id',true),'')::integer) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id',true),'')::integer);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='evidence_task_same_tenant_fk') THEN
    ALTER TABLE evidence_records ADD CONSTRAINT evidence_task_same_tenant_fk FOREIGN KEY (task_id,tenant_id) REFERENCES tasks(id,tenant_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='governance_reviews_task_same_tenant_fk') THEN
    ALTER TABLE governance_reviews ADD CONSTRAINT governance_reviews_task_same_tenant_fk FOREIGN KEY (task_id,tenant_id) REFERENCES tasks(id,tenant_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='governance_challenges_task_same_tenant_fk') THEN
    ALTER TABLE governance_challenges ADD CONSTRAINT governance_challenges_task_same_tenant_fk FOREIGN KEY (task_id,tenant_id) REFERENCES tasks(id,tenant_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='governance_decisions_task_same_tenant_fk') THEN
    ALTER TABLE governance_decisions ADD CONSTRAINT governance_decisions_task_same_tenant_fk FOREIGN KEY (task_id,tenant_id) REFERENCES tasks(id,tenant_id);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION gnw_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'gnw_append_only:%', TG_TABLE_NAME;
END $$;

DROP TRIGGER IF EXISTS audit_log_append_only ON audit_log;
CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON audit_log FOR EACH ROW EXECUTE FUNCTION gnw_append_only();
DROP TRIGGER IF EXISTS evidence_append_only ON evidence_records;
CREATE TRIGGER evidence_append_only BEFORE UPDATE OR DELETE ON evidence_records FOR EACH ROW EXECUTE FUNCTION gnw_append_only();
DROP TRIGGER IF EXISTS governance_reviews_append_only ON governance_reviews;
CREATE TRIGGER governance_reviews_append_only BEFORE UPDATE OR DELETE ON governance_reviews FOR EACH ROW EXECUTE FUNCTION gnw_append_only();
DROP TRIGGER IF EXISTS governance_challenges_append_only ON governance_challenges;
CREATE TRIGGER governance_challenges_append_only BEFORE UPDATE OR DELETE ON governance_challenges FOR EACH ROW EXECUTE FUNCTION gnw_append_only();
DROP TRIGGER IF EXISTS governance_decisions_append_only ON governance_decisions;
CREATE TRIGGER governance_decisions_append_only BEFORE UPDATE OR DELETE ON governance_decisions FOR EACH ROW EXECUTE FUNCTION gnw_append_only();