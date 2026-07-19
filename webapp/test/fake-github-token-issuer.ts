// Honest in-memory GitHubTokenIssuer. Modeled after FakeContainerEngine:
// seedable responses, recorded calls, settable failures.
//
// Default: returns a fixed token with a far-future expiry, regardless of repo.
// Tests call `thenFail()` to simulate an issuer error, or inspect `issuedRepos`
// to assert which repository the use case requested.

import type {
  GitHubTokenCredential,
  GitHubTokenIssuer,
} from "../src/core/ports/github-token-issuer";

const FAR_FUTURE = new Date("2099-01-01T00:00:00.000Z");

export class FakeGitHubTokenIssuer implements GitHubTokenIssuer {
  /** Repos passed to `issueToken`, in call order — for assertions. */
  readonly issuedRepos: string[] = [];

  /** What the next `issueToken` call returns. */
  nextCredential: GitHubTokenCredential = { token: "fake-token", expiresAt: FAR_FUTURE };

  /** Error the next `issueToken` throws instead of returning a credential. */
  private nextError: Error | null = null;

  // --- test helpers -------------------------------------------------------

  /** Reset all state for a fresh test. */
  reset(): void {
    this.issuedRepos.length = 0;
    this.nextCredential = { token: "fake-token", expiresAt: FAR_FUTURE };
    this.nextError = null;
  }

  /** The next `issueToken` call throws this error (models a token-minting failure). */
  thenFail(error: Error): void {
    this.nextError = error;
  }

  // --- port ---------------------------------------------------------------

  async issueToken(repo: string): Promise<GitHubTokenCredential> {
    this.issuedRepos.push(repo);
    if (this.nextError) throw this.nextError;
    return { ...this.nextCredential };
  }
}
