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
      githubToken: "ght",
      permissionMode: "auto",
    });
    expect(env).toMatchObject({
      GITHUB_TOKEN: "ght",
      GITHUB_REPO: "o/r",
      SESSION_NAME: "s1",
      SESSION_UUID: "uuid-1",
      PERMISSION_MODE: "auto",
      ANTHROPIC_BASE_URL: "https://api.deepseek.com/anthropic",
      ANTHROPIC_AUTH_TOKEN: "sk-ds",
    });
  });

  it("omits anthropic env for remote-control (non api-key) types", () => {
    const oauth: Account = { ...deepseek, providerType: "claude", credentials: {} };
    const env = buildSessionEnv({
      type: requireProviderType("claude"),
      account: oauth,
      repo: "o/r",
      sessionName: "s1",
      sessionUuid: "uuid-1",
      githubToken: "ght",
      permissionMode: "auto",
    });
    expect(env.ANTHROPIC_BASE_URL).toBeUndefined();
    expect(env.SESSION_UUID).toBe("uuid-1");
  });
});
