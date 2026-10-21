# Gemini / Antigravity GNW Reference Audit — 2026-10-16

## Scope and provenance
- Current GNW checkout: `D:\\GNW\\gnw-governed-agent-v4`
- Branch / HEAD at inspection: `main` / `a5e027416232d6b8b8219724e81792a6175093fb` (short `a5e0274`).
- Candidate reference implementation: `D:\\GNW\\.gemini\\outputs\\gnw-governed-agent`; no Git metadata was present in that directory.
- Antigravity report reviewed: `D:\\GNW\\.gemini\\antigravity\\brain\\3232d9a3-62c1-4855-87d5-cd55a876ecad\\gnw_apex_deployment_audit_report.md`.
- A literal folder named `Dark Gemini` was not found in the searched GNW tree; the relevant material found is under the hidden `.gemini` directory. `D:\\GNW\\Downloads` was empty at the time checked.

## Reference implementation verification
- `npm test` in the candidate reference project: **PASS — 11/11 tests**, exit code 0.
- `npm run typecheck` in the candidate reference project: **PASS**, exit code 0.
- These results apply only to that standalone prototype, not to GNW production or a live Docker execution.
- The prototype README explicitly says it is a governance core/reference implementation, not a production security product. It says only `web.fetch`, `web.search`, and in-memory `files.hash` are runtime skills; the rest of its 50-entry catalog is metadata. The Docker sandbox test is mocked; no real container run was verified.

## Current GNW baseline
- `npm run typecheck`: **PASS**, exit code 0.
- `npm test`: **FAIL / BLOCKED by test environment** — 28 test files; 16 passed, 12 failed; 130 tests passed, 9 failed (139 total). Integration suites report `DATABASE_URL environment variable is required`; audit-chain tests cannot connect to PostgreSQL at `::1:5432` or `127.0.0.1:5432`. Do not treat the full suite as passing.
- Working tree was clean at the pre-audit baseline check. This report is the first intentional change made to the GNW checkout in this audit.

## Findings and adoption decision
1. **Governed multi-stage workflow:** the prototype's Observe → Understand → Reason → Plan → Act → Verify → Critique → Learn sequence is a useful design reference. Do not copy its orchestrator wholesale: GNW already has a stronger persistent governance boundary, signed/persisted capability leases, action-envelope binding, budget reservation, interlock checks, and required audit writes.
2. **Capability leases:** the prototype uses a process-local HMAC lease store. It is not suitable as a replacement for GNW's existing persisted, signed, one-time lease flow.
3. **Audit/Merkle evidence:** the prototype builds an in-memory Merkle tree over event metadata. It does not persist or externally anchor roots and explicitly cannot prove event truth or completeness. GNW's existing immutable ledger/audit chain should remain authoritative.
4. **Public-web fetch / SSRF:** the prototype has useful tests for HTTPS-only fetches, public DNS answers, redirect validation, response size limits, and timeouts. GNW already has SSRF/DNS validation and governed egress code with security tests. Porting a second fetch stack would create duplicate security boundaries; compare edge cases and add missing tests to GNW's existing implementation instead.
5. **Tavily search:** the prototype adapter is bounded to a basic-depth request and up to five HTTPS citations, but it needs a separate `TAVILY_API_KEY`. It does not use the user's Perplexity API and is not wired into GNW's governed dispatcher. Do not add it as if it were Perplexity integration.
6. **Docker sandbox:** isolation flags are a promising reference, but only mocked execution passed. Docker daemon/image availability and real runtime isolation were not verified. Do not enable this path for production until an independently controlled live-container test and governance integration pass.
7. **Historical Antigravity claims:** the reviewed report targets commit `06276ac` on 2026-10-12 and claims 58/58 tests plus live NVIDIA inference. Those are historical claims for a different snapshot, not proof for current `a5e0274`. Another validation report in the same workspace references a different commit and is likewise not current proof.
8. **Sensitive scratch filenames:** Antigravity workspace contains files named `scratch/auth_code.txt` and `scratch/auth_code_2.txt`. Their contents were not opened or copied. Treat them as potentially sensitive; do not import them into the repository. If they contain live authentication material, revoke/rotate it through the relevant provider.

## Recommended next steps
1. Restore an isolated PostgreSQL test environment and rerun the full GNW suite; keep the current release on HOLD until it passes.
2. Reconcile GNW's existing egress and tool dispatcher with the prototype's edge-case tests; add tests to existing security modules rather than creating duplicate primitives.
3. If Perplexity deep research is the target, implement and test it through GNW's existing provider configuration, governance request/action envelope, budgets, approved tool dispatcher, and audit ledger. Keep API credentials in the local secret provider/environment only; never place them in this report or chat.
4. Do not claim production certification, live API connectivity, real Docker isolation, merge, or deployment until direct evidence exists.

## Change log
- Added this audit report only. No GNW runtime source code, credentials, deployment settings, or remote GitHub state were changed by this audit.

## Selective implementation update ? 2026-10-16
- Created local branch feature/governed-deep-research-2026-10-16; no remote push or merge performed.
- Added a deep.research handler to GNW existing governed read-only agent-tool dispatcher. It uses configured deep-research provider/model/key, makes one bounded request (max 2,048 output tokens; timeout capped at 10 minutes), treats retrieved content as untrusted, returns only HTTPS citations without embedded credentials, and performs no automatic retries.
- Extended the existing LLM response parser to preserve provider citations, capped at 20 at the client boundary and 10 in tool output.
- Added unit tests for the Perplexity-compatible endpoint, citation filtering, output budget, and fail-closed missing-key behavior. Targeted agent-tools tests: 7/7 pass. TypeScript typecheck: PASS (exit 0).
- No live Perplexity request was made: no credential was provided in chat and no key value was read or exposed. Runtime connectivity remains unverified until a local secret is configured and a governed request is executed.
- Full-suite run with isolated test database: audit-chain suite passed 9/9, but the all-suite process ended with Windows exit code 3221225477 before a final Vitest summary. Complete suite is not certified; rerun on a stable runner after resolving C: drive space pressure.


## Final local state — 2026-10-16
- Source changes and the audit report are staged on the local feature branch. A local commit was attempted but Git refused because this checkout has no configured author name/email. No author identity was invented; no commit, push, PR, or merge was made.
- Server build/lint did not produce a verifiable result before remote sessions stalled under low C: drive space. Typecheck and targeted unit tests are verified as passing.
- The isolated PostgreSQL test clone was stopped successfully; the original C: database cluster was left untouched.
- Live Perplexity connectivity remains untested because neither GNW_DEEP_RESEARCH_API_KEY nor LLM_API_KEY was present in the remote process environment and no repo .env file exists.
