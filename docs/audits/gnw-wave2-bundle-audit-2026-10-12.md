# GNW Wave-2 Bundle Audit — 12 October 2026

## Decision: NO-GO for production

The uploaded bundle contains meaningful security hardening, tool handlers, tests, and local verification evidence. It does **not** prove production readiness. The wave-2 patch was not applied to the Windows worktree, and its recorded candidate base commit 981a92fa0969a158e3848c4fe0a8d7d92335837e did not resolve through the connected GitHub repository API. The outer ZIP is a partial evidence bundle: it lacks the normal src tree, package-lock.json, and tsconfig.server.json, so the recorded suite cannot be rerun from that ZIP alone.

## What the bundle says was implemented

- Migration 0003 separates tenant-bound audit records from restricted system-audit events and addresses the reported tenantless-audit exposure.
- Human approval policy and dispatch regressions cover the ten requested tool IDs.
- research.search is limited to current task/tenant internal artifacts.
- research.fetch uses allowlisted HTTPS, content-type/response-size bounds, cancellation, and DNS destination checks. Network tests were mocked; live external fetch was not demonstrated.
- exec.command, exec.test, and exec.python add input, path-shape, timeout, response-boundary, cancellation, and non-zero-exit handling. exec.test is restricted to npm test. No configured live executor was available.
- docs.write stores bounded, hash-checked task/tenant artifacts internally. It is not a Google Docs or other external provider integration.
- model.chat, browser.run, deploy.preview, and deploy.production remain fail-closed without concrete configured integrations.

The bundle therefore does not support the claim that all ten tools are fully integrated and live-tested in production.

## Verification evidence in the bundle (not rerun against the current GitHub branch)

The supplied report/logs record Node 22 install, typecheck, build and targeted tests passing; lint with zero errors and 12 warnings; 26 test files / 152 tests passing in a disposable PostgreSQL run; coverage of 71.06% statements, 65.78% branches, 80.82% functions and 81.88% lines; plus local migrations, RLS, append-only audit, kill-switch and backup/restore checks. Dependency audit is reported clean and a 347-component unsigned CycloneDX SBOM is included.

In this audit session, the nested evidence ZIP passed its integrity test and node --check passed for the three supplied MJS verifier/preflight scripts. The upload did not contain the complete project tree or lockfile, so project-wide test/typecheck/build commands were not independently rerun.

## Security and release blockers

1. Potential SSRF gap: security.ts checks IPv4-mapped IPv6 addresses in dotted form but does not appear to normalize hexadecimal forms such as ::ffff:7f00:1 before private-address classification. This could allow an allowlisted DNS hostname returning a mapped loopback/private address to evade the intended check. This is a code-review finding requiring robust IP classification and regression tests, not a claim of a live exploit. Test dotted and hexadecimal mapped loopback/RFC1918 cases, IPv6 loopback/link-local/ULA, and multi-answer DNS responses before enabling research.fetch for production.
2. docs.write cleans up after metadata/storage-integrity failures, cancellation after upload, and database-write failure; cleanup behavior when storage.put itself partially writes and then throws needs explicit verification.
3. Production preflight and signed release-evidence gates correctly DENY in the bundle due absent production configuration, signatures, TEE/MPC/HSM evidence, independent audit and distinct approvers.
4. Authorized staging smoke/rollback, actual container build and scanning, provider integration tests, and remote CI for the uploaded patch are not proven.
5. The sanitized secret scan has 40 candidates; it is not evidence that a scanner proved zero secrets.

## GitHub state observed

- Repository: Asisyedj/gnw-governed-agent-v4
- main HEAD: 3b25f82ec3e0308097d1ac5dac2fb00bf9c4a4f5
- Release-gates PR #58 head: c09b276cab192d257717e2e08959e11d0c67e5e6
- The reported successful CI, CodeQL, continuous-security and compliance-gate runs belong to PR #58, not to the uploaded wave-2 patch.
- The uploaded patch hash is 649f851f43faa989df7b8d4b2139bde0e8bf1ac7e0905a25f943f5016b6aa177. Its handoff receipt says wave two was not received/applied on the Windows worktree.

## Required next steps

Rebase/apply wave two against the current review-branch source without blind file overwrites; add mapped-IPv6 egress and storage partial-write cleanup regressions; run full PR CI, typecheck, lint, Vitest/PostgreSQL-RLS and the Git-aware production-closure verifier; then configure authorized staging and genuine signed release evidence. Until these are complete, **NO-GO remains the correct production decision**.

This commit records the audit findings only. It intentionally does not claim or perform source-code integration; the patch needs a verified rebase and CI run first.