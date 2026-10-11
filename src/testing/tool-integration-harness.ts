import { AGENT_TOOL_SCOPES } from "../shared/types.js";
import type { ActionEnvelope } from "../server/action-envelope.js";
import { digestEnvelope } from "../server/action-envelope.js";
import type { CapabilityLease } from "../server/capability.js";
import { executeWithGovernance, type ExecutionContext, type ExecutionResult } from "../server/execution.js";

export type MockToolContext = {
  requestId: string;
  actionEnvelopeDigest: string;
  signal: AbortSignal;
  lease?: CapabilityLease;
};

export type MockToolHandler = (
  parameters: unknown,
  context: MockToolContext,
) => Promise<unknown>;

export type HarnessInvocation = {
  context: ExecutionContext;
  envelope: ActionEnvelope;
  timeoutMs?: number;
};

const declaredTools = new Set(Object.values(AGENT_TOOL_SCOPES).flat());

/**
 * Test-only provider adapter registry. All registered handlers are invoked only
 * through GNW's real executeWithGovernance boundary; the adapters themselves
 * must never call production providers or mutate external systems.
 */
export class SecureToolIntegrationHarness {
  private readonly handlers = new Map<string, MockToolHandler>();

  registerMockTool(tool: string, handler: MockToolHandler): void {
    if (!declaredTools.has(tool)) {
      throw new Error("mock_tool_not_declared_in_agent_scopes");
    }
    if (this.handlers.has(tool)) {
      throw new Error("mock_tool_already_registered");
    }
    this.handlers.set(tool, handler);
  }

  async run(invocation: HarnessInvocation): Promise<ExecutionResult> {
    const { context, envelope } = invocation;
    const timeoutMs = invocation.timeoutMs ?? 5_000;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
      return { success: false, error: "mock_tool_timeout_invalid", durationMs: 0 };
    }
    if (
      envelope.tool !== context.governanceRequest.tool ||
      envelope.operation !== context.governanceRequest.operation
    ) {
      return { success: false, error: "harness_tool_binding_mismatch", durationMs: 0 };
    }
    const handler = this.handlers.get(envelope.tool);
    if (!handler) {
      return { success: false, error: "mock_tool_not_registered", durationMs: 0 };
    }

    return executeWithGovernance(context, envelope, async (lease) => {
      const controller = new AbortController();
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        const handlerResult = handler(envelope.parameters, {
          requestId: context.requestId,
          actionEnvelopeDigest: digestEnvelope(envelope),
          signal: controller.signal,
          ...(lease ? { lease } : {}),
        });
        const timeoutResult = new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => {
            controller.abort();
            reject(new Error("mock_tool_timeout"));
          }, timeoutMs);
        });
        return await Promise.race([handlerResult, timeoutResult]);
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    });
  }
}
