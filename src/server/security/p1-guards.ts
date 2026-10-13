/**
 * Small fail-closed authorization predicates shared by route handlers and tests.
 * These checks intentionally do not grant platform-level privileges.
 */
export function publicRegistrationAllowed(allowSelfRegistration: boolean): boolean {
  return allowSelfRegistration;
}

/**
 * Until a separately authenticated platform-operator dual-control workflow exists,
 * tenant-facing endpoints may only move global interlocks toward the safer state.
 */
export function isMonotonicSafeInterlockPatch(patch: {
  killSwitch?: boolean;
  circuitOpen?: boolean;
}): boolean {
  const requestedStates = [patch.killSwitch, patch.circuitOpen].filter(
    (value): value is boolean => value !== undefined,
  );
  return requestedStates.length > 0 && requestedStates.every((value) => value === true);
}

/**
 * Missing requester identity is not sufficient evidence of separation of duties.
 */
export function hasIndependentApproval(requesterId: number | null | undefined, reviewerId: number): boolean {
  return requesterId !== null && requesterId !== undefined && requesterId !== reviewerId;
}
