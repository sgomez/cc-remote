import { describe, expect, it } from "vitest";
import {
  type BootstrapRecord,
  deriveBootstrapRecordFromManifest,
  generateClaimToken,
  type ManifestConversionResponse,
  validateBootstrapRecord,
  verifyClaimToken,
} from "./bootstrap";

const VALID_RECORD: BootstrapRecord = {
  githubAppId: "123456",
  githubAppSlug: "cc-remote-web-manager",
  githubClientId: "Iv1.client-id",
  githubClientSecret: "client-secret-value",
  githubAppPrivateKey: Buffer.from(
    "-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA...\n-----END RSA PRIVATE KEY-----",
  ).toString("base64"),
  allowedGithubUsers: ["sgomez"],
};

describe("validateBootstrapRecord", () => {
  it("returns no errors for a valid record", () => {
    expect(validateBootstrapRecord(VALID_RECORD)).toEqual([]);
  });

  it("rejects a non-numeric githubAppId", () => {
    const errors = validateBootstrapRecord({
      ...VALID_RECORD,
      githubAppId: "not-a-number",
    });
    expect(errors.some((e) => e.includes("githubAppId"))).toBe(true);
  });

  it("rejects a missing (empty) githubAppId", () => {
    const errors = validateBootstrapRecord({
      ...VALID_RECORD,
      githubAppId: "",
    });
    expect(errors.some((e) => e.includes("githubAppId"))).toBe(true);
  });

  it("rejects a private key that does not decode to a PEM", () => {
    const errors = validateBootstrapRecord({
      ...VALID_RECORD,
      githubAppPrivateKey: Buffer.from("not a pem").toString("base64"),
    });
    expect(errors.some((e) => e.includes("githubAppPrivateKey"))).toBe(true);
  });

  it("rejects an invalid (non-base64) private key", () => {
    const errors = validateBootstrapRecord({
      ...VALID_RECORD,
      githubAppPrivateKey: "!!!not-base64!!!",
    });
    expect(errors.some((e) => e.includes("githubAppPrivateKey"))).toBe(true);
  });

  it("rejects an empty githubAppSlug", () => {
    const errors = validateBootstrapRecord({
      ...VALID_RECORD,
      githubAppSlug: "",
    });
    expect(errors.some((e) => e.includes("githubAppSlug"))).toBe(true);
  });

  it("rejects an empty githubClientId", () => {
    const errors = validateBootstrapRecord({
      ...VALID_RECORD,
      githubClientId: "",
    });
    expect(errors.some((e) => e.includes("githubClientId"))).toBe(true);
  });

  it("rejects an empty githubClientSecret", () => {
    const errors = validateBootstrapRecord({
      ...VALID_RECORD,
      githubClientSecret: "",
    });
    expect(errors.some((e) => e.includes("githubClientSecret"))).toBe(true);
  });

  it("rejects an empty allow-list (fail-closed)", () => {
    const errors = validateBootstrapRecord({
      ...VALID_RECORD,
      allowedGithubUsers: [],
    });
    expect(errors.some((e) => e.includes("allowedGithubUsers"))).toBe(true);
  });

  it("reports all problems at once", () => {
    const errors = validateBootstrapRecord({
      githubAppId: "",
      githubAppPrivateKey: "!!!bad!!!",
      githubAppSlug: "",
      githubClientId: "",
      githubClientSecret: "",
      allowedGithubUsers: [],
    });
    // Every field should report its problem, not fail on the first one.
    expect(errors.length).toBeGreaterThanOrEqual(6);
  });
});

describe("deriveBootstrapRecordFromManifest", () => {
  it("derives a valid BootstrapRecord from a manifest conversion response", () => {
    const response: ManifestConversionResponse = {
      id: 987654,
      slug: "my-app-slug",
      client_id: "Iv1.abc123",
      client_secret: "secret-value",
      pem: "-----BEGIN RSA PRIVATE KEY-----\nMIIEpA...\n-----END RSA PRIVATE KEY-----",
      owner: { login: "sgomez" },
    };

    const record = deriveBootstrapRecordFromManifest(response);

    expect(record.githubAppId).toBe("987654");
    expect(record.githubAppSlug).toBe("my-app-slug");
    expect(record.githubClientId).toBe("Iv1.abc123");
    expect(record.githubClientSecret).toBe("secret-value");
    // Private key should be base64-encoded
    expect(record.githubAppPrivateKey).toBeTruthy();
    expect(() => Buffer.from(record.githubAppPrivateKey, "base64").toString("utf8")).not.toThrow();
    // Allow-list seeded from owner login
    expect(record.allowedGithubUsers).toEqual(["sgomez"]);
  });

  it("encodes the private key as base64", () => {
    const pem = "-----BEGIN RSA PRIVATE KEY-----\nKEYDATA\n-----END RSA PRIVATE KEY-----";
    const response: ManifestConversionResponse = {
      id: 1,
      slug: "app",
      client_id: "id",
      client_secret: "secret",
      pem,
      owner: { login: "me" },
    };

    const record = deriveBootstrapRecordFromManifest(response);

    const decoded = Buffer.from(record.githubAppPrivateKey, "base64").toString("utf8");
    expect(decoded).toBe(pem);
  });
});

// ---- Claim Token -----------------------------------------------------------

describe("generateClaimToken", () => {
  it("produces a 64-character hex string", () => {
    const token = generateClaimToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produces different tokens across calls", () => {
    const a = generateClaimToken();
    const b = generateClaimToken();
    expect(a).not.toBe(b);
  });
});

describe("verifyClaimToken", () => {
  it("returns true for matching tokens", () => {
    const token = generateClaimToken();
    expect(verifyClaimToken(token, token)).toBe(true);
  });

  it("returns false when the supplied token differs by one character", () => {
    const stored = generateClaimToken();
    const wrong = (stored[0] === "f" ? "0" : "f") + stored.slice(1);
    expect(verifyClaimToken(stored, wrong)).toBe(false);
  });

  it("returns false when the supplied token is completely different", () => {
    const stored = generateClaimToken();
    const wrong = generateClaimToken();
    expect(verifyClaimToken(stored, wrong)).toBe(false);
  });

  it("returns false when the stored token is undefined (token does not exist)", () => {
    expect(verifyClaimToken(undefined, "some-token")).toBe(false);
  });

  it("returns false when the supplied token is empty", () => {
    expect(verifyClaimToken("stored-token", "")).toBe(false);
  });

  it("returns false when the stored token is empty", () => {
    expect(verifyClaimToken("", "supplied-token")).toBe(false);
  });

  it("returns false for a shorter supplied token without leaking length", () => {
    const stored = generateClaimToken();
    expect(verifyClaimToken(stored, stored.slice(0, 32))).toBe(false);
  });

  it("returns false for a longer supplied token without leaking length", () => {
    const stored = generateClaimToken();
    expect(verifyClaimToken(stored, `${stored}extra`)).toBe(false);
  });

  it("does not throw for any input", () => {
    expect(() => verifyClaimToken(undefined as unknown as string, "")).not.toThrow();
    expect(() => verifyClaimToken("abc", "xyz")).not.toThrow();
    expect(() => verifyClaimToken("", "")).not.toThrow();
  });
});
