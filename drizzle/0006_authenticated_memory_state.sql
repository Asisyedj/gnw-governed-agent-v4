-- Migration: 0006_authenticated_memory_state.sql
-- Status: CANDIDATE CONTRACT / SCOPED REVIEW ONLY (NOT YET APPLIED TO PRODUCTION)
-- Target: PostgreSQL 16
-- Scope: Formal Authenticated Memory State, Triad of Decoupled Roots, Statement-Level Append-Only Guards

BEGIN;

-- 1. Budget reservations column alignment (Finding 4 resolution)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'budget_reservations'
  ) THEN
    ALTER TABLE public.budget_reservations
      ADD COLUMN IF NOT EXISTS prev_entry_hash text NOT NULL DEFAULT 'GENESIS',
      ADD COLUMN IF NOT EXISTS entry_hash text NOT NULL DEFAULT 'GENESIS';
  END IF;
END $$;

-- 2. Dedicated authenticated memory schema (gnw_mem)
CREATE SCHEMA IF NOT EXISTS gnw_mem;

CREATE DOMAIN gnw_mem.digest32 AS bytea CHECK (octet_length(VALUE) = 32);
CREATE DOMAIN gnw_mem.counter64 AS bigint CHECK (VALUE >= 0);

CREATE TABLE IF NOT EXISTS gnw_mem.principal_tenants (
  principal name PRIMARY KEY,
  tenant_id uuid NOT NULL
);

CREATE TABLE IF NOT EXISTS gnw_mem.tenant_state (
  tenant_id uuid PRIMARY KEY,
  lineage_id gnw_mem.digest32 NOT NULL,
  epoch gnw_mem.counter64 NOT NULL DEFAULT 0,
  event_counter gnw_mem.counter64 NOT NULL DEFAULT 0,
  audit_chain_head gnw_mem.digest32 NOT NULL,
  UNIQUE (tenant_id, lineage_id)
);

CREATE TABLE IF NOT EXISTS gnw_mem.events (
  tenant_id uuid NOT NULL,
  lineage_id gnw_mem.digest32 NOT NULL,
  counter gnw_mem.counter64 NOT NULL CHECK (counter > 0),
  epoch gnw_mem.counter64 NOT NULL CHECK (epoch > 0),
  schema_version text NOT NULL CHECK (schema_version = 'GNW-AUDIT-EVENT-V2'),
  op_code smallint NOT NULL CHECK (op_code > 0),
  previous_hash gnw_mem.digest32 NOT NULL,
  nonce_key gnw_mem.digest32 NOT NULL,
  semantic_key gnw_mem.digest32 NOT NULL,
  canonical_body bytea NOT NULL CHECK (octet_length(canonical_body) BETWEEN 1 AND 1048576),
  body_digest gnw_mem.digest32 NOT NULL,
  event_hash gnw_mem.digest32 NOT NULL,
  PRIMARY KEY (tenant_id, counter),
  UNIQUE (tenant_id, nonce_key),
  UNIQUE (tenant_id, counter, event_hash)
);

CREATE TABLE IF NOT EXISTS gnw_mem.manifests (
  tenant_id uuid NOT NULL,
  manifest_digest gnw_mem.digest32 NOT NULL,
  epoch gnw_mem.counter64 NOT NULL CHECK (epoch > 0),
  canonical_bytes bytea NOT NULL,
  PRIMARY KEY (tenant_id, manifest_digest)
);

CREATE TABLE IF NOT EXISTS gnw_mem.lifecycle (
  tenant_id uuid NOT NULL,
  memory_id gnw_mem.digest32 NOT NULL,
  version gnw_mem.counter64 NOT NULL CHECK (version > 0),
  leaf_digest gnw_mem.digest32 NOT NULL,
  state text NOT NULL CHECK (state IN ('ACTIVE', 'REVOKED', 'TOMBSTONED')),
  effective_counter gnw_mem.counter64 NOT NULL,
  promotion_certificate_digest gnw_mem.digest32 NOT NULL,
  reason_digest gnw_mem.digest32 NOT NULL,
  PRIMARY KEY (tenant_id, memory_id, version)
);

CREATE TABLE IF NOT EXISTS gnw_mem.epoch_descriptors (
  tenant_id uuid NOT NULL,
  epoch gnw_mem.counter64 NOT NULL CHECK (epoch > 0),
  event_counter gnw_mem.counter64 NOT NULL,
  audit_chain_head gnw_mem.digest32 NOT NULL,
  memory_root gnw_mem.digest32 NOT NULL,
  status_root gnw_mem.digest32 NOT NULL,
  previous_descriptor_digest gnw_mem.digest32 NOT NULL,
  manifest_digest gnw_mem.digest32 NOT NULL,
  policy_digest gnw_mem.digest32 NOT NULL,
  canonical_bytes bytea NOT NULL,
  descriptor_digest gnw_mem.digest32 NOT NULL,
  signature_envelope bytea NOT NULL,
  PRIMARY KEY (tenant_id, epoch),
  UNIQUE (tenant_id, descriptor_digest)
);

CREATE TABLE IF NOT EXISTS gnw_mem.witness_receipts (
  tenant_id uuid NOT NULL,
  descriptor_digest gnw_mem.digest32 NOT NULL,
  log_id gnw_mem.digest32 NOT NULL,
  tree_size gnw_mem.counter64 NOT NULL CHECK (tree_size > 0),
  log_root gnw_mem.digest32 NOT NULL,
  witness_id gnw_mem.digest32 NOT NULL,
  receipt_bytes bytea NOT NULL,
  receipt_digest gnw_mem.digest32 NOT NULL,
  PRIMARY KEY (tenant_id, descriptor_digest, log_id, tree_size, witness_id)
);

CREATE TABLE IF NOT EXISTS gnw_mem.replay_claims (
  tenant_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('NONCE', 'SEMANTIC')),
  claim_key gnw_mem.digest32 NOT NULL,
  request_digest gnw_mem.digest32 NOT NULL,
  first_counter gnw_mem.counter64 NOT NULL,
  PRIMARY KEY (tenant_id, kind, claim_key)
);

-- Reject history mutation trigger
CREATE OR REPLACE FUNCTION gnw_mem.reject_history_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'append_only_history:%:%', TG_TABLE_NAME, TG_OP USING ERRCODE = '42501';
END;
$$;

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[ 'events', 'manifests', 'lifecycle', 'epoch_descriptors', 'witness_receipts', 'replay_claims' ]
  LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS reject_history_change ON gnw_mem.%I; ' ||
      'CREATE TRIGGER reject_history_change BEFORE UPDATE OR DELETE OR TRUNCATE ON gnw_mem.%I ' ||
      'FOR EACH STATEMENT EXECUTE FUNCTION gnw_mem.reject_history_change()',
      tbl, tbl
    );
  END LOOP;
END $$;

COMMIT;
