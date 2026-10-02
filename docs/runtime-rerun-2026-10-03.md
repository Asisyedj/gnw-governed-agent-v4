# Runtime verification rerun — 2026-10-03

This marker exists only to trigger the repository's canonical CI gates against the current `main` source tree.

The authoritative runtime verification environment is the CI `ubuntu-24.04` runner defined in `.github/workflows/ci.yml`, which provisions PostgreSQL as a pinned service and uses Docker for the production-container build/smoke test.

No production authorization is implied by this marker; release status remains fail-closed until every required gate and external assurance requirement passes on the same commit.
