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

/** An installation of the GitHub App, listing which repositories were granted. */
export type GitHubInstallation = {
  id: number;
  account: {
    login: string;
    avatarUrl: string;
    type: "User" | "Organization";
  };
  /** Whether the grant covers all repositories or an explicit selection. */
  repositorySelection: "all" | "selected";
  /** Full `owner/repo` names granted. Empty for "all" (the set is unbounded). */
  repositories: string[];
  /** URL on github.com to review or change the installation. */
  htmlUrl: string;
};

export interface GitHubTokenIssuer {
  /** Obtain a credential scoped to `repo` (owner/repo). */
  issueToken(repo: string): Promise<GitHubTokenCredential>;

  /** List every installation of the App, with granted repositories. Uses the
   *  App's own credentials — no signed-in user token is involved. */
  listInstallations(): Promise<GitHubInstallation[]>;
}
