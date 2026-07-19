// GitHub OAuth scope for sign-in. Extracted as a constant so the scope is
// unit-testable without opening a DB connection (auth.ts opens better-sqlite3
// at import time).
//
// GitHub Apps ignore authorisation-URL scopes; permissions come from the
// App's own configuration. Keeping only `user:email` (mandatory for
// better-auth's GitHub provider) means we do not advertise an access level
// that no longer exists.
export const GITHUB_OAUTH_SCOPE = ["user:email"] as const;
