/**
 * SSRF / DNS-rebinding protection tests.
 * These verify the application never proxies requests to private/loopback
 * addresses when given attacker-controlled URLs.
 */
import { describe, it, expect } from "vitest";
import { isPrivateAddress, isSafeExternalUrl } from "../../server/lib/ssrf.js";
import { assertSafeResolvedAddresses } from "../../server/security.js";

describe("SSRF — isPrivateAddress", () => {
  const privateAddresses = [
    "127.0.0.1", "127.0.0.2", "::1",
    "10.0.0.1", "10.255.255.255",
    "172.16.0.1", "172.31.255.255",
    "192.168.0.1", "192.168.255.255",
    "169.254.0.1",   // link-local
    "0.0.0.0",
    "fc00::1", "fd00::1",  // ULA IPv6
    "fe80::1", "febf::1", "ff02::1", "::", "::7f00:1", "2001:db8::1",
    "::ffff:127.0.0.1", "::ffff:7f00:1", "0:0:0:0:0:ffff:7f00:1",
    "::ffff:10.0.0.1", "::ffff:a00:1", "::ffff:192.168.1.1",
    "::ffff:c0a8:101", "::ffff:169.254.169.254", "::ffff:a9fe:a9fe",
    "100.64.0.1", "198.18.0.1", "224.0.0.1",
  ];

  for (const addr of privateAddresses) {
    it(`blocks private address: ${addr}`, () => {
      expect(isPrivateAddress(addr)).toBe(true);
    });
  }

  const publicAddresses = ["1.1.1.1", "8.8.8.8", "93.184.216.34", "2606:2800:220:1:248:1893:25c8:1946", "::ffff:0808:0808"];
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


describe("SSRF — DNS answer validation", () => {
  it("rejects an empty DNS answer set", () => {
    expect(() => assertSafeResolvedAddresses([])).toThrow("unsafe_dns_destination");
  });

  it("rejects the entire answer set when any answer is private or mapped-private", () => {
    expect(() => assertSafeResolvedAddresses([
      { address: "93.184.216.34" },
      { address: "::ffff:7f00:1" },
    ])).toThrow("unsafe_dns_destination");
  });

  it("accepts a non-empty set containing only public addresses", () => {
    expect(() => assertSafeResolvedAddresses([
      { address: "1.1.1.1" },
      { address: "2606:2800:220:1:248:1893:25c8:1946" },
    ])).not.toThrow();
  });

  it("rejects malformed resolver output closed", () => {
    expect(() => assertSafeResolvedAddresses([{ address: "not-an-ip" }])).toThrow("unsafe_dns_destination");
  });
});
