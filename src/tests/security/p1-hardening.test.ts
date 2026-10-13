import { describe, expect, it } from "vitest";
import {
  hasIndependentApproval,
  isMonotonicSafeInterlockPatch,
  publicRegistrationAllowed,
} from "../../server/security/p1-guards.js";

describe("P1 fail-closed authorization guards", () => {
  it("does not permit public registration when self-registration is disabled", () => {
    expect(publicRegistrationAllowed(false)).toBe(false);
    expect(publicRegistrationAllowed(true)).toBe(true);
  });

  it("allows tenant-facing interlock changes only toward a safer state", () => {
    expect(isMonotonicSafeInterlockPatch({ killSwitch: true })).toBe(true);
    expect(isMonotonicSafeInterlockPatch({ circuitOpen: true })).toBe(true);
    expect(isMonotonicSafeInterlockPatch({ killSwitch: true, circuitOpen: true })).toBe(true);
    expect(isMonotonicSafeInterlockPatch({ killSwitch: false })).toBe(false);
    expect(isMonotonicSafeInterlockPatch({ circuitOpen: false })).toBe(false);
    expect(isMonotonicSafeInterlockPatch({ killSwitch: true, circuitOpen: false })).toBe(false);
    expect(isMonotonicSafeInterlockPatch({})).toBe(false);
  });

  it("requires a known requester distinct from the reviewer", () => {
    expect(hasIndependentApproval(10, 11)).toBe(true);
    expect(hasIndependentApproval(10, 10)).toBe(false);
    expect(hasIndependentApproval(null, 11)).toBe(false);
    expect(hasIndependentApproval(undefined, 11)).toBe(false);
  });
});
