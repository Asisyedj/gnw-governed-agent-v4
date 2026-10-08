// Test-only bootstrap: integration modules import the DB client at module load time.
// Keep this isolated from production runtime configuration.
process.env.NODE_ENV ??= "test";
process.env.DATABASE_URL ??= "postgresql://gnw:gnw_test_pw@localhost:5432/gnw_test";
process.env.COOKIE_SECRET ??= "test-cookie-secret-minimum-32-characters-ok";
process.env.LOG_LEVEL ??= "silent";
