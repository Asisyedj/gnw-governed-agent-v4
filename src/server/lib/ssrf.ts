/**
 * SSRF protection utilities. Reject non-public IP destinations before egress.
 */
import net from "node:net";

const BLOCKED_HOSTNAMES = new Set(["localhost", "metadata.google.internal"]);

function parseIpv6(value: string): bigint | null {
  let input = value.toLowerCase().split("%", 1)[0] ?? "";
  if (!input || !net.isIPv6(input)) return null;
  // Expand IPv4 dotted tails (for example ::ffff:127.0.0.1) into two words.
  if (input.includes(".")) {
    const lastColon = input.lastIndexOf(":");
    const ipv4 = input.slice(lastColon + 1);
    if (!net.isIPv4(ipv4)) return null;
    const octets = ipv4.split(".").map(Number);
    const high = ((octets[0] ?? 0) << 8) | (octets[1] ?? 0);
    const low = ((octets[2] ?? 0) << 8) | (octets[3] ?? 0);
    input = `${input.slice(0, lastColon)}:${high.toString(16)}:${low.toString(16)}`;
  }
  const halves = input.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;
  const words = [...left, ...Array(Math.max(0, missing)).fill("0"), ...right];
  if (words.length !== 8 || words.some(word => !/^[0-9a-f]{1,4}$/.test(word))) return null;
  return words.reduce((acc, word) => (acc << 16n) | BigInt(`0x${word}`), 0n);
}

function isPrivateIpv4(address: string): boolean {
  if (!net.isIPv4(address)) return true;
  const [a, b, c] = address.split(".").map(Number) as [number, number, number, number];
  return a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0 && c === 0) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 192 && b === 88 && c === 99) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) || a >= 224;
}

export function isPrivateAddress(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "").replace(/%[^%]+$/, "");
  if (BLOCKED_HOSTNAMES.has(h) || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (net.isIPv4(h)) return isPrivateIpv4(h);
  if (!net.isIPv6(h)) return false;

  const parsed = parseIpv6(h);
  if (parsed === null) return true;
  // IPv4-mapped IPv6 has 80 zero bits followed by 0xffff and the IPv4 address.
  if ((parsed >> 32n) === 0xffffn) {
    const v4 = Number(parsed & 0xffffffffn);
    return isPrivateIpv4([v4 >>> 24, (v4 >>> 16) & 255, (v4 >>> 8) & 255, v4 & 255].join("."));
  }
  // Unspecified, loopback, unique-local (fc00::/7), link-local (fe80::/10), multicast.
  return parsed === 0n || parsed === 1n ||
    (parsed >> 121n) === 0x7en ||
    (parsed >> 118n) === 0x3fan ||
    (parsed >> 120n) === 0xffn;
}

export function isSafeExternalUrl(rawUrl: string): boolean {
  let parsed: URL;
  try { parsed = new URL(rawUrl); } catch { return false; }
  if (parsed.protocol !== "https:") return false;
  if (parsed.username || parsed.password) return false;
  if (isPrivateAddress(parsed.hostname)) return false;
  return true;
}

/** Throw if the URL is unsafe. Use before any outbound HTTP call. */
export function assertSafeUrl(rawUrl: string): void {
  if (!isSafeExternalUrl(rawUrl)) throw new Error(`[GNW] SSRF blocked — unsafe outbound URL: ${rawUrl}`);
}
