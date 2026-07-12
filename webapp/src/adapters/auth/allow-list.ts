// Fail-closed GitHub allow-list — the security-critical decision, extracted as
// pure functions so it is unit-tested without spinning up better-auth or real
// GitHub (PRD §4, research #2). The auth config wires these into
// `databaseHooks.session.create.before` (every sign-in) and
// `user.create.before` (first sign-up).

/** Parse `ALLOWED_GITHUB_USERS` (comma-separated) into a trimmed, non-empty list. */
export function parseAllowList(raw: string | undefined | null): string[] {
  return (raw ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/**
 * Whether a GitHub login may sign in. **Fails closed**: an empty allow-list
 * admits nobody (exact legacy `ALLOWED_GITHUB_USERS` semantics), and a
 * missing/unknown login is never allowed. The match is case-sensitive, matching
 * GitHub's own treatment of the canonical `login`.
 */
export function isLoginAllowed(login: string | undefined | null, allowList: string[]): boolean {
  if (!login) return false;
  return allowList.includes(login);
}
