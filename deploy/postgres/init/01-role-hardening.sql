-- GNW production database role hardening.
-- The bootstrap superuser creates this role; the application role must never bypass RLS.
ALTER ROLE gnw NOSUPERUSER NOBYPASSRLS;
