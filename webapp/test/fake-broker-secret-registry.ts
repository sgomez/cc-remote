// In-memory BrokerSecretRegistry for tests. Modeled after FakeGitHubTokenIssuer:
// seedable entries, recorded lookups, settable failures.

import type {
  BrokerSecretEntry,
  BrokerSecretRegistry,
} from "../src/core/ports/broker-secret-registry";

export class FakeBrokerSecretRegistry implements BrokerSecretRegistry {
  private readonly entries = new Map<string, BrokerSecretEntry>();

  /** Secrets passed to `lookup`, in call order — for assertions. */
  readonly lookedUpSecrets: string[] = [];

  // --- test helpers -------------------------------------------------------

  /** Reset all state for a fresh test. */
  reset(): void {
    this.entries.clear();
    this.lookedUpSecrets.length = 0;
  }

  /** Pre-seed an entry so a lookup succeeds. */
  seed(secret: string, sessionName: string, repo: string): void {
    this.entries.set(secret, { sessionName, repo });
  }

  // --- port ---------------------------------------------------------------

  register(secret: string, sessionName: string, repo: string): void {
    this.entries.set(secret, { sessionName, repo });
  }

  async lookup(secret: string): Promise<BrokerSecretEntry | null> {
    this.lookedUpSecrets.push(secret);
    return this.entries.get(secret) ?? null;
  }
}
