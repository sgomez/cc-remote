import { describe, expect, it } from "vitest";
import { expectedOrigin, isAllowedOrigin } from "./ws-origin";

describe("expectedOrigin", () => {
  it("derives scheme + host from BETTER_AUTH_URL, dropping any path", () => {
    expect(expectedOrigin("https://cc.example.com")).toBe("https://cc.example.com");
    expect(expectedOrigin("https://cc.example.com/some/path")).toBe("https://cc.example.com");
  });

  it("keeps a non-default port", () => {
    expect(expectedOrigin("https://cc.example.com:8443")).toBe("https://cc.example.com:8443");
  });

  it("throws on an unparseable URL", () => {
    expect(() => expectedOrigin("not a url")).toThrow();
  });
});

describe("isAllowedOrigin", () => {
  const allowed = "https://cc.example.com";

  it("accepts an exact match", () => {
    expect(isAllowedOrigin("https://cc.example.com", allowed)).toBe(true);
  });

  it("is case-insensitive (scheme/host are case-insensitive per RFC 6454)", () => {
    expect(isAllowedOrigin("HTTPS://CC.EXAMPLE.COM", allowed)).toBe(true);
  });

  it("rejects a missing Origin header (null, undefined, or empty)", () => {
    expect(isAllowedOrigin(null, allowed)).toBe(false);
    expect(isAllowedOrigin(undefined, allowed)).toBe(false);
    expect(isAllowedOrigin("", allowed)).toBe(false);
  });

  it("rejects a different scheme", () => {
    expect(isAllowedOrigin("http://cc.example.com", allowed)).toBe(false);
  });

  it("rejects a different host entirely", () => {
    expect(isAllowedOrigin("https://evil.com", allowed)).toBe(false);
  });

  it("rejects a subdomain of the expected host", () => {
    expect(isAllowedOrigin("https://evil.cc.example.com", allowed)).toBe(false);
  });

  it("rejects a superdomain / suffix match of the expected host", () => {
    expect(isAllowedOrigin("https://notcc.example.com", allowed)).toBe(false);
  });

  it("rejects a different port", () => {
    expect(isAllowedOrigin("https://cc.example.com:8443", allowed)).toBe(false);
  });

  it("rejects an origin that also carries a path or trailing slash", () => {
    // Origin headers never carry a path in practice, but the comparison must
    // still be exact rather than a prefix match.
    expect(isAllowedOrigin("https://cc.example.com/", allowed)).toBe(false);
  });
});
