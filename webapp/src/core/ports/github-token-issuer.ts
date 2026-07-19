// GitHubTokenIssuer — port over GitHub credential resolution. The core asks "give
// me a credential for this repository" and gets back a token + its expiry; how
// the token is obtained is an adapter concern. This is what lets later sub-issues
// swap the OAuth token for an installation token without touching the core.
//
// expiresAt lets a credential consumer pre-emptively refresh before a long
// operation (e.g. git push) rather than discovering a stale token mid-flight.
// The initial OAuth adapter returns a far-future date since OAuth tokens do not
// expire.

export type GitHubTokenCredential = {
  token: string;
  expiresAt: Date;
};

export interface GitHubTokenIssuer {
  /** Obtain a credential scoped to `repo` (owner/repo). */
  issueToken(repo: string): Promise<GitHubTokenCredential>;
}
