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
