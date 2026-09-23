/**
 * SSRF / DNS-rebinding protection tests.
 * These verify the application never proxies requests to private/loopback
 * addresses when given attacker-controlled URLs.
 */
import { describe, it, expect } from "vitest";
import { isPrivateAddress, isSafeExternalUrl } from "../../server/lib/ssrf.js";

describe("SSRF — isPrivateAddress", () => {
  const privateAddresses = [
    "127.0.0.1", "127.0.0.2", "::1",
    "10.0.0.1", "10.255.255.255",
    "172.16.0.1", "172.31.255.255",
    "192.168.0.1", "192.168.255.255",
    "169.254.0.1",   // link-local
    "0.0.0.0",
    "fc00::1", "fd00::1",  // ULA IPv6
  ];

  for (const addr of privateAddresses) {
    it(`blocks private address: ${addr}`, () => {
      expect(isPrivateAddress(addr)).toBe(true);
    });
  }

  const publicAddresses = ["1.1.1.1", "8.8.8.8", "93.184.216.34", "2606:2800:220:1:248:1893:25c8:1946"];
  for (const addr of publicAddresses) {
    it(`allows public address: ${addr}`, () => {
      expect(isPrivateAddress(addr)).toBe(false);
    });
  }
});

describe("SSRF — isSafeExternalUrl", () => {
  it("rejects http:// (non-TLS)", () => {
    expect(isSafeExternalUrl("http://example.com/api")).toBe(false);
  });

  it("rejects file:// protocol", () => {
    expect(isSafeExternalUrl("file:///etc/passwd")).toBe(false);
  });

  it("rejects ftp:// protocol", () => {
    expect(isSafeExternalUrl("ftp://example.com/data")).toBe(false);
  });

  it("accepts https:// with public hostname", () => {
    expect(isSafeExternalUrl("https://api.example.com/v1/data")).toBe(true);
  });

  it("rejects https:// with loopback hostname", () => {
    expect(isSafeExternalUrl("https://127.0.0.1/api")).toBe(false);
  });

  it("rejects https:// with private IP hostname", () => {
    expect(isSafeExternalUrl("https://192.168.1.1/api")).toBe(false);
  });

  it("rejects https:// with localhost", () => {
    expect(isSafeExternalUrl("https://localhost/api")).toBe(false);
  });

  it("rejects https:// with metadata endpoint", () => {
    expect(isSafeExternalUrl("https://169.254.169.254/latest/meta-data/")).toBe(false);
  });
});
