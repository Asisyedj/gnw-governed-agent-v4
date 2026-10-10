import { describe, expect, it } from "vitest";
import { canonicalQueueJson, digestQueuePayload, parseQueuedExecutionPayload } from "../../server/orchestration/queue-payload.js";

const payload = {
  version: 1 as const,
  taskId: 7,
  tenantId: 2,
  actorId: 9,
  role: "operator",
  requestId: "request-7",
  grant: { requestId: "request-7", tenant: "2", subject: "9", role: "operator", taskId: 7 },
  envelope: { taskId: "7", tenantId: "2", actorId: "9", parameters: { z: 1, a: true } },
};

describe("queued execution payload integrity", () => {
  it("canonicalizes object keys independent of insertion order", () => {
    expect(canonicalQueueJson({ b: 2, a: { z: 3, x: 1 } })).toBe('{"a":{"x":1,"z":3},"b":2}');
    expect(digestQueuePayload({ b: 2, a: 1 })).toBe(digestQueuePayload({ a: 1, b: 2 }));
  });

  it("changes digest when any governed value changes", () => {
    expect(digestQueuePayload(payload)).not.toBe(digestQueuePayload({ ...payload, taskId: 8 }));
    expect(digestQueuePayload(payload)).not.toBe(digestQueuePayload({ ...payload, envelope: { ...payload.envelope, actorId: "10" } }));
  });

  it("normalizes omitted undefined object members like JSON serialization", () => {
    expect(canonicalQueueJson({ present: true, absent: undefined })).toBe('{"present":true}');
  });

  it("rejects non-JSON values rather than hashing a lossy representation", () => {
    expect(() => digestQueuePayload({ value: Number.NaN })).toThrow("NON_JSON_QUEUE_PAYLOAD");
    expect(() => digestQueuePayload({ value: BigInt(1) })).toThrow("NON_JSON_QUEUE_PAYLOAD");
  });

  it("validates the tenant, actor, request and execution envelope shape", () => {
    expect(parseQueuedExecutionPayload(payload)).toEqual(payload);
    expect(() => parseQueuedExecutionPayload({ ...payload, tenantId: 0 })).toThrow("QUEUE_PAYLOAD_INVALID");
    expect(() => parseQueuedExecutionPayload({ ...payload, approvalId: -1 })).toThrow("QUEUE_PAYLOAD_INVALID");
    expect(() => parseQueuedExecutionPayload(null)).toThrow("QUEUE_PAYLOAD_INVALID");
  });
});
