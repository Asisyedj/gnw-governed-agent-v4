import { createHash, createPrivateKey, createPublicKey, sign as cryptoSign, verify as cryptoVerify } from "node:crypto";
import dns from "node:dns/promises";
import https from "node:https";
import net from "node:net";
import { isPrivateAddress } from "./lib/ssrf.js";

export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map(k => `${JSON.stringify(k)}:${canonicalize(record[k])}`).join(",")}}`;
}

export function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function grantSigningPayload(grant: Record<string, unknown>): string {
  const { signature: _sig, ...frozen } = grant;
  return canonicalize(frozen);
}

export function signGrant(grant: Record<string, unknown>, issuer: string, privateKeyPem: string) {
  const signature = cryptoSign(null, Buffer.from(grantSigningPayload({ ...grant, issuer })), createPrivateKey(privateKeyPem)).toString("base64url");
  return { issuer, signature };
}

export function verifyGrantSignature(grant: Record<string, unknown>, issuer: string, signature: string, publicKeyPem: string): boolean {
  try {
    return cryptoVerify(null, Buffer.from(grantSigningPayload({ ...grant, issuer })), createPublicKey(publicKeyPem), Buffer.from(signature, "base64url"));
  } catch { return false; }
}

export function assertHttpsUrl(raw: string): URL {
  const url = new URL(raw);
  if (url.protocol !== "https:") throw new Error("https_required");
  if (url.username || url.password) throw new Error("url_credentials_forbidden");
  return url;
}

export function isPrivateOrLocalHost(hostname: string): boolean {
  return isPrivateAddress(hostname);
}

function isUnsafeResolvedAddress(address: string): boolean {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, "");
  // DNS answers must be valid literal IPs, and every answer must be public.
  return net.isIP(normalized) === 0 || isPrivateAddress(normalized);
}

export function assertSafeResolvedAddresses(resolved: readonly { address: string }[]): void {
  if (!resolved.length || resolved.some(entry => isUnsafeResolvedAddress(entry.address))) {
    throw new Error("unsafe_dns_destination");
  }
}

export async function governedFetch(raw: string, init: RequestInit = {}, maxResponseBytes = 4 * 1024 * 1024): Promise<Response> {
  const url = assertHttpsUrl(raw);
  if (init.redirect && init.redirect !== "manual") throw new Error("redirects_must_be_manual");
  const allowedHosts = (init as RequestInit & { __allowedHosts?: readonly string[] }).__allowedHosts;
  if (allowedHosts) assertEgressUrl(raw, allowedHosts);

  const resolved = await dns.lookup(url.hostname, { all: true, verbatim: true });
  assertSafeResolvedAddresses(resolved);
  const target = resolved[0]?.address;
  if (!target) throw new Error("unsafe_dns_destination");
  const method = String(init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers);
  headers.set("host", url.host);
  const body = typeof init.body === "string" ? Buffer.from(init.body) : Buffer.isBuffer(init.body) ? init.body : init.body ? Buffer.from(init.body as ArrayBuffer) : undefined;
  if (body && !headers.has("content-length")) headers.set("content-length", String(body.byteLength));

  return await new Promise<Response>((resolve, reject) => {
    const request = https.request({
      hostname: target,
      port: Number(url.port || 443),
      path: `${url.pathname}${url.search}`,
      method,
      headers: Object.fromEntries(headers.entries()),
      servername: net.isIP(url.hostname) ? undefined : url.hostname,
      rejectUnauthorized: true,
      signal: init.signal ?? undefined,
    }, response => {
      const chunks: Buffer[] = [];
      let total = 0;
      response.on("data", chunk => {
        const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        total += b.byteLength;
        if (total > maxResponseBytes) { request.destroy(new Error("response_too_large")); return; }
        chunks.push(b);
      });
      response.on("end", () => {
        const bodyBuffer = Buffer.concat(chunks);
        const responseHeaders = new Headers();
        for (const [key, value] of Object.entries(response.headers)) {
          if (Array.isArray(value)) value.forEach(v => responseHeaders.append(key, v));
          else if (value !== undefined) responseHeaders.set(key, String(value));
        }
        resolve(new Response(bodyBuffer, { status: response.statusCode ?? 0, statusText: response.statusMessage ?? "", headers: responseHeaders }));
      });
      response.on("error", reject);
    });
    request.on("error", reject);
    if (body) request.write(body);
    request.end();
  });
}

export function assertEgressUrl(raw: string, allowedHosts: readonly string[]) {
  const url = assertHttpsUrl(raw);
  if (isPrivateOrLocalHost(url.hostname)) throw new Error("private_destination_blocked");
  const host = url.hostname.toLowerCase();
  if (!allowedHosts.some(rule => rule === host || (rule.startsWith("*.") && host.endsWith(rule.slice(1))))) throw new Error("egress_destination_not_allowlisted");
  return url;
}
