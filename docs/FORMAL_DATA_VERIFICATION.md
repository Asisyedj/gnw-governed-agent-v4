# GNW Formal Data Verification Contract

## Purpose

GNW treats data-processing outputs as unverifiable until identity, authorization, provenance, integrity, and immutability obligations have been machine-checked.

The implementation uses four enforcement layers:

1. **Type-level contracts** — branded identifiers (`TenantId`, `TaskId`, `RequestId`, `EvidenceId`, `Sha256Digest`) and recursive `DeepReadonly` types prevent accidental reassignment across compiled code.
2. **Runtime invariants** — every verified stage produces a deterministic `VerificationReport`; violations are blocking errors.
3. **Immutable snapshots** — accepted inputs/outputs are cloned and recursively frozen before they are returned from the verification boundary.
4. **Evidence provenance** — retrieval records bind tenant, source URI/version, content/chunk hashes, authorization digest, timestamps and citation identity; generation is rejected when citations are missing, duplicated, cross-tenant, or outside the verified retrieval set.

## RAG assurance sequence

source -> verified ingestion stage -> authorized retrieval -> verified evidence set -> grounded generation -> cited immutable answer

A stage must not be treated as verified merely because the upstream model returned a value. The verifier checks the structural and security invariants before the value crosses the stage boundary.

## What formal means here

These contracts are deterministic, machine-checked proof obligations enforced by TypeScript compilation, runtime assertions and regression tests. This is **not** a mathematical theorem-prover proof of the entire GNW program. Full formal verification would additionally require a sound formal model and proof/checking system. GNW therefore treats any future theorem-prover work as a separate assurance layer rather than overstating the current guarantee.

## Release enforcement

`npm run verify:invariants` executes the dedicated invariant suite. The production closure script requires the invariant engine and CI gate to be present. A failed invariant check blocks the release path.

## Non-bypass rules

- Do not expose mutable references from a verified boundary.
- Do not cast unverified external data directly to a branded type.
- Do not construct `GroundedAnswer` objects without `verifyGroundedAnswer`.
- Do not treat a retrieval result as authorized unless its tenant and authorization digest are verified.
- Do not weaken a blocking invariant into a warning without a versioned policy change and re-validation.

## Evidence

For each release, retain the invariant test output, the exact source commit SHA, and the resulting BuildEvidence record under the same release identity.
