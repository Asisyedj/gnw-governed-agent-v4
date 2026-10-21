import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { claimNonce, claimNoncesAtomically } from "../../server/repo.js";
import { db } from "../../server/db/index.js";

describe("persistent governance nonce consumption", () => {
  it("rolls back a partial approval/grant claim when any nonce is already consumed", async () => {
    const suffix = randomUUID();
    const priorGrant = `live-replay-test-grant:${suffix}`;
    const approval = `live-replay-test-approval:${suffix}`;
    const nextGrant = `live-replay-test-next-grant:${suffix}`;

    expect(await claimNonce(db, "grant", priorGrant)).toBe(true);
    expect(await claimNoncesAtomically(db, [
      { kind: "approval", nonce: approval },
      { kind: "grant", nonce: priorGrant },
    ])).toBe("grant_replay");

    // The grant conflict must roll the transaction back, leaving the new approval nonce unused.
    expect(await claimNoncesAtomically(db, [
      { kind: "approval", nonce: approval },
      { kind: "grant", nonce: nextGrant },
    ])).toBe(true);

    expect(await claimNoncesAtomically(db, [
      { kind: "approval", nonce: approval },
      { kind: "grant", nonce: `live-replay-test-third-grant:${suffix}` },
    ])).toBe("approval_replay");
  });
});
