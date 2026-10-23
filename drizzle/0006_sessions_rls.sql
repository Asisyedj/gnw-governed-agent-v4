-- The app currently implements only local artifact storage. Enable RLS for tenant-bound session
-- records and use the session's one-way token digest as a narrow lookup capability before auth.
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sessions_tenant_isolation ON sessions;
CREATE POLICY sessions_tenant_isolation ON sessions
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::integer)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::integer);

DROP POLICY IF EXISTS sessions_token_hash_lookup ON sessions;
CREATE POLICY sessions_token_hash_lookup ON sessions
  FOR SELECT
  USING (token_hash = nullif(current_setting('app.session_token_hash', true), ''));
