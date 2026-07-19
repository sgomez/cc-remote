// Bootstrap server functions: deployment state and claim token verification.
// These run only on the server — the TanStack Start compiler strips the handlers
// from the client bundle, so the fs imports never reach the browser.

import { existsSync, readFileSync } from "node:fs";
import { createServerFn } from "@tanstack/react-start";
import { verifyClaimToken as verifyClaimTokenPure } from "~/core/domain/bootstrap";

const BOOTSTRAP_FILE = "/data/bootstrap.json";
const CLAIM_TOKEN_FILE = "/data/claim-token";

/**
 * Return whether the deployment is configured (has a Bootstrap File) or
 * unconfigured (no Bootstrap File exists yet). An unconfigured deployment
 * is a legal startup state — it can serve the bootstrap screen but cannot
 * authenticate users.
 */
export const fetchDeploymentState = createServerFn({ method: "GET" }).handler(async () => {
  return { configured: existsSync(BOOTSTRAP_FILE) };
});

/**
 * Verify a supplied claim token against the stored token on the data volume.
 * Uses timing-safe comparison so the caller learns nothing beyond "valid or
 * not". Returns `{ valid: false }` when the stored token file doesn't exist
 * or can't be read (configured deployment, or stale state).
 */
export const verifyClaimTokenServerFn = createServerFn({ method: "POST" })
  .validator((data: { token: string }) => data)
  .handler(async ({ data }) => {
    let stored: string | undefined;
    try {
      stored = readFileSync(CLAIM_TOKEN_FILE, "utf-8").trim();
    } catch {
      // File doesn't exist or can't be read — treat as no stored token.
      // The pure verify function handles undefined correctly.
    }
    return { valid: verifyClaimTokenPure(stored, data.token) };
  });
