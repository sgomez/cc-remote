// Account — a user-registered instance of a Provider Type (PRD §3, CONTEXT.md).
// The id also names the Account Config Volume (`cc-remote-account-<id>`), which
// EVERY Account owns: credentials never come from the host, only from a volume
// seeded at registration (api-key) or filled by a Login Container (oauth).

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
