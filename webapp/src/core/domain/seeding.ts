// Seeding — how an Account's Claude configuration is prepared so Sessions start
// without the onboarding wizard (#4 resolution, verified on Claude Code
// v2.1.207), and how api-key credentials become container env vars.

import type { Account } from "./account";
import type { ProviderType } from "./provider-type";

/** File seeded into the Account Config Volume (relative to the container HOME). */
export const ACCOUNT_CONFIG_FILE = ".claude.json";

export type WizardSkipConfig = {
  hasCompletedOnboarding: true;
  permissions: { defaultMode: string };
  projects: Record<string, { hasTrustDialogAccepted: true }>;
};

/**
 * The minimal `~/.claude.json` that skips both blocking modals: the theme
 * picker / security notes (hasCompletedOnboarding) and the folder-trust dialog
 * (projects["/workspace"].hasTrustDialogAccepted). Both keys are required.
 */
export function wizardSkipConfig(permissionMode: string): WizardSkipConfig {
  return {
    hasCompletedOnboarding: true,
    permissions: { defaultMode: permissionMode },
    projects: { "/workspace": { hasTrustDialogAccepted: true } },
  };
}

/**
 * Anthropic-compatible env for api-key Accounts. baseUrl/model resolve from the
 * Account's own config first (custom), falling back to the Provider Type's
 * curated presets (deepseek). Non api-key types get no anthropic env.
 */
export function buildAnthropicEnv(type: ProviderType, account: Account): Record<string, string> {
  if (type.seeding !== "api-key") return {};
  const baseUrl = account.config.baseUrl ?? type.presets?.baseUrl ?? "";
  const model = account.config.model ?? type.presets?.model ?? "";
  const env: Record<string, string> = {
    ANTHROPIC_BASE_URL: baseUrl,
    ANTHROPIC_AUTH_TOKEN: account.credentials.apiKey ?? "",
    // Neutralise any inherited key so it can't override the account token
    // (mirrors the legacy web-manager).
    ANTHROPIC_API_KEY: "",
  };
  if (model) env.ANTHROPIC_MODEL = model;
  return env;
}
