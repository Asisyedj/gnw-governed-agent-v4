# Secure Tool-Integration Mock Harness

## Data flow

```text
Test invocation
  -> ActionEnvelope + ExecutionContext
  -> SecureToolIntegrationHarness.run()
  -> executeWithGovernance() [GNW production governance boundary]
  -> context binding + envelope digest check
  -> GovernanceService authorization / approval / nonce / interlock checks
  -> required audit invocation record
  -> registered mock provider handler (only after admission)
  -> bounded mock result or simulated failure/timeout
  -> required audit result / deny record
```

## Prompt-injection and command-execution policy

Treat artifact text, search excerpts, summaries, browser/tool output, and model-generated proposals as untrusted input. Content integrity (including a valid SHA-256 digest) proves byte identity, not that embedded instructions are trustworthy or authorized.

The governance policy requires an exact-action human approval for command-capable tools (`exec.command`, `exec.test`, `exec.python`) and other material side effects (`file.write`, `file.patch`, `git.commit`, `github.pr`, `deploy.production`), in addition to restricted-classification and provider-job rules. Approval must remain bound to the request/action digest, tenant, expiry, and nonce; the handler must not run before governance admits the action. A green mocked harness is not proof of live executor containment or prompt-injection immunity.

Regression coverage belongs in `src/tests/unit/production-controls.test.ts` and must keep read-only operations approval-free while asserting that command/side-effect tools require approval even for `internal` classification.

## Design constraints

- Test-only code lives in `src/testing`; it is not a production provider implementation.
- A mock tool must exist in `AGENT_TOOL_SCOPES`; duplicate registrations fail.
- The mock is called through `executeWithGovernance`, not directly from the test. This exercises the repository's actual authorization and action-envelope checks.
- Mismatched tool/operation, missing mock, nonce replay, an engaged interlock, missing human approval, envelope tampering, provider failure and timeout all have negative assertions.
- The timeout aborts the handler's `AbortSignal` and bounds the harness result. A mock handler that ignores the signal is not forcibly terminated; this is not proof of provider cancellation semantics.
- Mock success is `MOCK_VERIFIED`, never `LIVE_VERIFIED`. The harness does not establish that a real browser session, model API, cloud runtime or deep-research provider works.

## Add a mock adapter

```ts
const harness = new SecureToolIntegrationHarness();
harness.registerMockTool("knowledge.search", async (parameters, context) => {
  if (context.signal.aborted) throw new Error("mock_aborted");
  return { mock: true, input: parameters, digest: context.actionEnvelopeDigest };
});
```

Create the `ExecutionContext` and `ActionEnvelope` using the real typed contracts. `governanceRequest.envelopeDigest` must be calculated from the exact envelope with `digestEnvelope(envelope)`. For human-gated tools, provide a correctly bound approval through `ExecutionContext.approval`; otherwise denial is the expected result.

Run:

```bash
npm run test:harness
npm run test
```

The test module mocks only DB persistence boundaries (`audit` / `repo`) so no live external provider is called. Live-provider tests must be a separately approved staging suite with isolated credentials, allowlisted destinations, budgets, human approvals and retained evidence.
