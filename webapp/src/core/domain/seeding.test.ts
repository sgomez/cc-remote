import { describe, expect, it } from "vitest";
import type { Account } from "./account";
import { requireProviderType } from "./provider-type";
import { ACCOUNT_CONFIG_FILE, buildAnthropicEnv, wizardSkipConfig } from "./seeding";

function account(overrides: Partial<Account>): Account {
  return {
    id: "acc1",
    providerType: "deepseek",
    displayName: "test",
    credentials: {},
    config: {},
    status: "ready",
    createdAt: new Date(0),
    ...overrides,
  };
}

describe("wizard-skip config", () => {
  it("carries the three onboarding-gating keys verified on Claude Code v2.1.207", () => {
    const cfg = wizardSkipConfig();
    expect(cfg).toEqual({
      hasCompletedOnboarding: true,
      theme: "dark",
      projects: { "/workspace": { hasTrustDialogAccepted: true } },
    });
  });

  // The Account Config Volume is shared by every Session of the Account, so a
  // permission mode written here would be a shared mutable cell decided by
  // whichever sibling container started last.
  it("never carries a permission mode, which belongs to a Session not an Account", () => {
    expect(wizardSkipConfig()).not.toHaveProperty("permissions");
  });

  it("seeds into ~/.claude.json", () => {
    expect(ACCOUNT_CONFIG_FILE).toBe(".claude.json");
  });
});

describe("buildAnthropicEnv", () => {
  it("uses curated presets for a deepseek account", () => {
    const t = requireProviderType("deepseek");
    const env = buildAnthropicEnv(t, account({ credentials: { apiKey: "sk-ds" } }));
    expect(env.ANTHROPIC_BASE_URL).toBe("https://api.deepseek.com/anthropic");
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe("sk-ds");
    expect(env.ANTHROPIC_MODEL).toBeTruthy();
    // legacy neutralises any inherited ANTHROPIC_API_KEY
    expect(env.ANTHROPIC_API_KEY).toBe("");
  });

  it("uses account config overrides for a custom account", () => {
    const t = requireProviderType("custom");
    const env = buildAnthropicEnv(
      t,
      account({
        providerType: "custom",
        credentials: { apiKey: "sk-custom" },
        config: { baseUrl: "https://llm.example.com", model: "some-model" },
      }),
    );
    expect(env.ANTHROPIC_BASE_URL).toBe("https://llm.example.com");
    expect(env.ANTHROPIC_MODEL).toBe("some-model");
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe("sk-custom");
  });

  it("yields no anthropic env for non api-key types", () => {
    expect(buildAnthropicEnv(requireProviderType("claude"), account({}))).toEqual({});
  });
});
