import { describe, expect, it } from "vitest";
import type { Account } from "./account";
import { requireProviderType } from "./provider-type";
import { buildCloneEnv, buildSessionEnv } from "./session-env";

const deepseek: Account = {
  id: "acc-1",
  providerType: "deepseek",
  displayName: "ds",
  credentials: { apiKey: "sk-ds" },
  config: {},
  status: "ready",
  createdAt: new Date(0),
};

const brokerEnv = { brokerSecret: "bs-1", brokerUrl: "http://web-manager:4001" };
const commitIdentity = {
  name: "Sergio Gómez",
  email: "580701+sgomez@users.noreply.github.com",
};
const sessionDefaults = { ...brokerEnv, commitIdentity };

describe("buildCloneEnv", () => {
  it("carries only what the clone helper needs", () => {
    expect(buildCloneEnv({ githubToken: "ght", repo: "o/r" })).toEqual({
      GITHUB_TOKEN: "ght",
      GITHUB_REPO: "o/r",
    });
  });
});

describe("buildSessionEnv", () => {
  it("carries the base session env plus anthropic env for api-key types", () => {
    const env = buildSessionEnv({
      type: requireProviderType("deepseek"),
      account: deepseek,
      repo: "o/r",
      sessionName: "s1",
      sessionUuid: "uuid-1",
      permissionMode: "auto",
      ...sessionDefaults,
    });
    expect(env).toMatchObject({
      GITHUB_REPO: "o/r",
      SESSION_NAME: "s1",
      SESSION_UUID: "uuid-1",
      PERMISSION_MODE: "auto",
      CC_BROKER_SECRET: "bs-1",
      CC_BROKER_URL: "http://web-manager:4001",
      ANTHROPIC_BASE_URL: "https://api.deepseek.com/anthropic",
      ANTHROPIC_AUTH_TOKEN: "sk-ds",
    });
  });

  it("carries the broker secret and url without a durable github token", () => {
    const env = buildSessionEnv({
      type: requireProviderType("deepseek"),
      account: deepseek,
      repo: "o/r",
      sessionName: "s1",
      sessionUuid: "uuid-1",
      permissionMode: "auto",
      ...sessionDefaults,
    });
    expect(env.CC_BROKER_SECRET).toBe("bs-1");
    expect(env.CC_BROKER_URL).toBe("http://web-manager:4001");
    // The durable token is gone -- git credentials are fetched on demand from the broker.
    expect(env.GITHUB_TOKEN).toBeUndefined();
  });

  it("carries the Commit Identity of the provisioning user", () => {
    const env = buildSessionEnv({
      type: requireProviderType("deepseek"),
      account: deepseek,
      repo: "o/r",
      sessionName: "s1",
      sessionUuid: "uuid-1",
      permissionMode: "auto",
      ...sessionDefaults,
    });
    expect(env.GIT_USER_NAME).toBe("Sergio Gómez");
    expect(env.GIT_USER_EMAIL).toBe("580701+sgomez@users.noreply.github.com");
  });

  it("does not inject a durable GITHUB_TOKEN into any session", () => {
    const env = buildSessionEnv({
      type: requireProviderType("deepseek"),
      account: deepseek,
      repo: "o/r",
      sessionName: "s1",
      sessionUuid: "uuid-1",
      permissionMode: "auto",
      ...sessionDefaults,
    });
    expect(Object.keys(env)).not.toContain("GITHUB_TOKEN");
  });

  it("omits anthropic env for remote-control (non api-key) types", () => {
    const oauth: Account = { ...deepseek, providerType: "claude", credentials: {} };
    const env = buildSessionEnv({
      type: requireProviderType("claude"),
      account: oauth,
      repo: "o/r",
      sessionName: "s1",
      sessionUuid: "uuid-1",
      permissionMode: "auto",
      ...sessionDefaults,
    });
    expect(env.ANTHROPIC_BASE_URL).toBeUndefined();
    expect(env.SESSION_UUID).toBe("uuid-1");
    expect(env.CC_BROKER_SECRET).toBe("bs-1");
    expect(env.GITHUB_TOKEN).toBeUndefined();
  });
});
