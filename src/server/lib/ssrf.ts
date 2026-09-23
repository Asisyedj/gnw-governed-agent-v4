/**
 * SSRF protection utilities.
 * Blocks outbound requests to private, loopback, link-local, and metadata addresses.
 */

const PRIVATE_IPV4 = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2[0-9]|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^0\.0\.0\.0$/,
];

const PRIVATE_IPV6 = [
  /^::1$/,
  /^fc[0-9a-f]{2}:/i,
  /^fd[0-9a-f]{2}:/i,
  /^fe80:/i,
  /^::$/,
];

const BLOCKED_HOSTNAMES = new Set(["localhost", "metadata.google.internal"]);

export function isPrivateAddress(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, ""); // strip IPv6 brackets
  if (BLOCKED_HOSTNAMES.has(h)) return true;
  for (const re of PRIVATE_IPV4) if (re.test(h)) return true;
  for (const re of PRIVATE_IPV6) if (re.test(h)) return true;
  return false;
}

export function isSafeExternalUrl(rawUrl: string): boolean {
  let parsed: URL;
  try { parsed = new URL(rawUrl); } catch { return false; }
  if (parsed.protocol !== "https:") return false;
  if (isPrivateAddress(parsed.hostname)) return false;
  return true;
}

/** Throw if the URL is unsafe. Use before any outbound HTTP call. */
export function assertSafeUrl(rawUrl: string): void {
  if (!isSafeExternalUrl(rawUrl))
    throw new Error(`[GNW] SSRF blocked — unsafe outbound URL: ${rawUrl}`);
}
