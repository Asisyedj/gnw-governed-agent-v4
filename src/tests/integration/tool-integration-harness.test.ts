import { describe, expect, it, vi } from "vitest";
import { SecureToolIntegrationHarness, type HarnessInvocation } from "../../testing/tool-integration-harness.js";

const invocation = (tool = "knowledge.search", operation = "search") => ({
  context: { requestId: "test-request", governanceRequest: { tool, operation } },
  envelope: { tool, operation, parameters: {} },
} as unknown as HarnessInvocation);

describe("SecureToolIntegrationHarness registration and fail-closed guards", () => {
  it("rejects tools not declared in GNW agent scopes", () => {
    const harness = new SecureToolIntegrationHarness();
    expect(() => harness.registerMockTool("shell.exec", async () => "no")).toThrow("mock_tool_not_declared_in_agent_scopes");
  });

  it("rejects duplicate mock registration", () => {
    const harness = new SecureToolIntegrationHarness();
    harness.registerMockTool("knowledge.search", async () => "first");
    expect(() => harness.registerMockTool("knowledge.search", async () => "second")).toThrow("mock_tool_already_registered");
  });

  it("refuses a mismatched tool/operation envelope before invoking any handler", async () => {
    const harness = new SecureToolIntegrationHarness();
    const handler = vi.fn(async () => "must not execute");
    harness.registerMockTool("knowledge.search", handler);
    const result = await harness.run(invocation("knowledge.search", "delete"));
    expect(result.success).toBe(false);
    expect(result.error).toBe("harness_tool_binding_mismatch");
    expect(handler).not.toHaveBeenCalled();
  });

  it("fails closed if a declared tool has no registered mock", async () => {
    const harness = new SecureToolIntegrationHarness();
    const result = await harness.run(invocation());
    expect(result.success).toBe(false);
    expect(result.error).toBe("mock_tool_not_registered");
  });
});
