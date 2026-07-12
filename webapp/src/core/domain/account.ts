// Account — a user-registered instance of a Provider Type (PRD §3, CONTEXT.md).
// The id also names the Account Config Volume (`cc-remote-account-<id>`).

import type { ProviderType } from "./provider-type";

export type AccountStatus = "pending_login" | "ready";

export type Account = {
  id: string;
  /** Provider Type id (catalogue key). */
  providerType: string;
  displayName: string;
  /** Secrets (e.g. apiKey). Plaintext JSON in the DB by decision (#5). */
  credentials: Record<string, string>;
  /** Non-secret overrides (baseUrl/model for `custom`). */
  config: Record<string, string>;
  status: AccountStatus;
  createdAt: Date;
};

export function accountConfigVolumeName(accountId: string): string {
  return `cc-remote-account-${accountId}`;
}

/**
 * Whether an Account of this type owns an Account Config Volume. Only
 * host-mount types (claude-local) do not — they bind-mount the host config.
 */
export function ownsConfigVolume(type: ProviderType): boolean {
  return type.seeding !== "host-mount";
}
