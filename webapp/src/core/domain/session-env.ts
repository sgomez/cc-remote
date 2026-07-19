// Container env for the two-phase session flow. The clone helper needs only the
// GitHub token + repo; the main agent additionally carries the session identity
// and, for api-key Provider Types, the Anthropic-compatible endpoint env.
//
// As of issue #33 the Session no longer carries a durable GITHUB_TOKEN — git
// credentials are fetched on demand from the broker. The broker secret and URL
// replace the static token.

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
  permissionMode: string;
  brokerSecret: string;
  brokerUrl: string;
}): Record<string, string> {
  return {
    GITHUB_REPO: input.repo,
    SESSION_NAME: input.sessionName,
    SESSION_UUID: input.sessionUuid,
    PERMISSION_MODE: input.permissionMode,
    CC_BROKER_SECRET: input.brokerSecret,
    CC_BROKER_URL: input.brokerUrl,
    ...buildAnthropicEnv(input.type, input.account),
  };
}
