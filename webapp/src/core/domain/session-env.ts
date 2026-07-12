// Container env for the two-phase session flow. The clone helper needs only the
// GitHub token + repo; the main agent additionally carries the session identity
// and, for api-key Provider Types, the Anthropic-compatible endpoint env.

import type { Account } from "./account";
import type { ProviderType } from "./provider-type";
import { buildAnthropicEnv } from "./seeding";

export function buildCloneEnv(input: {
  githubToken: string;
  repo: string;
}): Record<string, string> {
  return {
    GITHUB_TOKEN: input.githubToken,
    GITHUB_REPO: input.repo,
  };
}

export function buildSessionEnv(input: {
  type: ProviderType;
  account: Account;
  repo: string;
  sessionName: string;
  sessionUuid: string;
  githubToken: string;
  permissionMode: string;
}): Record<string, string> {
  return {
    GITHUB_TOKEN: input.githubToken,
    GITHUB_REPO: input.repo,
    SESSION_NAME: input.sessionName,
    SESSION_UUID: input.sessionUuid,
    PERMISSION_MODE: input.permissionMode,
    ...buildAnthropicEnv(input.type, input.account),
  };
}
