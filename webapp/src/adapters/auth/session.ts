// Server-side session access for the delivery layer. `getSession` is a TSS
// server function for loaders/`beforeLoad`; `requireSession` is the reusable
// guard that later sub-issues (#15 WS/SSE, #16 UI) call to reject
// unauthenticated requests; `getGithubAccessToken` reads the stored OAuth token
// server-side for `GITHUB_TOKEN` injection at container-create time (#13/#14).
//
// The token lives in better-auth's `account` table (survives restarts, unlike
// the legacy in-memory map) and is returned server-side only — it never reaches
// the client.

import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { auth } from "./auth";

export type AuthSession = Awaited<ReturnType<typeof auth.api.getSession>>;

/** TSS server function: resolve the current session (or null) from request cookies. */
export const getSession = createServerFn({ method: "GET" }).handler(async () => {
  return auth.api.getSession({ headers: getRequest().headers });
});

/**
 * Reusable guard for server functions / API + WS routes. Returns the session or
 * throws when unauthenticated — callers map the throw to HTTP 401.
 */
export async function requireSession(headers: Headers): Promise<NonNullable<AuthSession>> {
  const session = await auth.api.getSession({ headers });
  if (!session) throw new Error("UNAUTHENTICATED");
  return session;
}

/**
 * Server-side GitHub access token for the authenticated user (auto-refreshed by
 * better-auth; GitHub OAuth apps issue long-lived tokens so this returns the
 * stored one). `userId` is optional when `headers` already carry the session.
 */
export async function getGithubAccessToken(
  headers: Headers,
  userId?: string,
): Promise<string | undefined> {
  const result = await auth.api.getAccessToken({
    body: { providerId: "github", ...(userId ? { userId } : {}) },
    headers,
  });
  return result?.accessToken;
}
