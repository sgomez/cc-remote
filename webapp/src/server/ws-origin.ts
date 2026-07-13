// Pure, framework-free Origin check for the terminal/login WebSocket upgrades
// (S4 hardening, 2026-07-13 architecture review). Neither `upgrade()` handler
// checked the `Origin` header before this: cross-site WebSocket hijacking was
// blocked only by better-auth's implicit SameSite=Lax cookie default. These
// endpoints (server/routes/ws/terminal/[name].ts, server/routes/ws/login/[id].ts)
// are only ever dialed by the app's own browser UI, and browsers always send
// `Origin` on a WebSocket handshake, so comparing it against the deployment's
// own public URL is a cheap, load-bearing second check.
//
// Mirrors terminal-proxy.ts: every decision that can be tested without a
// socket lives here, pure and framework-free, and the crossws `upgrade()`
// handlers stay thin glue that just call it before doing anything else.

/**
 * The origin (scheme + host + port) WebSocket upgrades are expected to arrive
 * from, derived from `BETTER_AUTH_URL` — the same public base URL better-auth
 * signs cookies and builds the GitHub OAuth callback against (see
 * `loadDeploymentConfig` in `src/config/deployment.ts` and `adapters/auth/auth.ts`).
 * Reuses that URL rather than inventing a second "public origin" env var.
 *
 * Throws if `betterAuthUrl` is not a parseable URL. In production this never
 * happens: the container's `validate:env` preflight (`loadDeploymentConfig`)
 * already rejects a non-http(s) `BETTER_AUTH_URL` before the server accepts
 * any connection.
 */
export function expectedOrigin(betterAuthUrl: string): string {
  return new URL(betterAuthUrl).origin;
}

/**
 * Whether a WebSocket upgrade's `Origin` header is acceptable against the
 * deployment's expected origin.
 *
 * A missing header (`null`/`undefined`/empty) is rejected, not treated as
 * "no opinion": every browser sends `Origin` on a WS handshake, so its absence
 * means the caller is not a browser talking to us directly (e.g. a bare `curl`,
 * or an intermediary stripping the header) rather than a legitimate same-origin
 * request from the app's own UI.
 *
 * The comparison is case-insensitive (scheme and host are case-insensitive per
 * RFC 6454) but otherwise exact: a different scheme, a different port, or a
 * subdomain of the expected host is a different origin and is rejected.
 */
export function isAllowedOrigin(origin: string | null | undefined, allowedOrigin: string): boolean {
  if (!origin) return false;
  return origin.toLowerCase() === allowedOrigin.toLowerCase();
}
