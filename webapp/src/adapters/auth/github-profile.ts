// GitHub profile → user mapping for the fail-closed allow-list. Extracted as
// pure values so the wiring is unit-tested (github-profile.test.ts) against
// better-auth's own profile parser — without spinning up better-auth, a DB, or
// real GitHub OAuth.

/** Subset of the GitHub profile better-auth passes to `mapProfileToUser`. */
export interface GithubProfile {
  login: string;
}

/**
 * Additional user field persisted from the GitHub profile so the allow-list can
 * key on the login (not the email).
 *
 * `githubLogin` MUST stay inputtable: declaring it `input: false` makes
 * better-auth's `parseAdditionalUserInputFromProviderProfile` silently drop the
 * value produced by `mapGithubProfileToUser`, leaving `githubLogin` undefined so
 * the fail-closed allow-list denies every sign-in. GitHub is the only enabled
 * provider (no email/password sign-up), so a user cannot inject this field.
 */
export const githubAdditionalFields = {
  githubLogin: { type: "string", required: false },
} as const;

/** Maps the verified GitHub profile onto the persisted `githubLogin` field. */
export function mapGithubProfileToUser(profile: GithubProfile): { githubLogin: string } {
  return { githubLogin: profile.login };
}
