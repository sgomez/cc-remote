// Bootstrap server functions: deployment state, claim token verification,
// and persisting the Bootstrap File (#55). These run only on the server — the
// TanStack Start compiler strips the handlers from the client bundle, so the fs
// imports never reach the browser.

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createServerFn } from "@tanstack/react-start";
import {
  type BootstrapRecord,
  validateBootstrapRecord,
  verifyClaimToken as verifyClaimTokenPure,
} from "~/core/domain/bootstrap";

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

/**
 * Validate and persist the deployment's GitHub identity from the bootstrap form.
 *
 * Re-verifies the claim token on every submission (defence in depth for a route
 * that sits outside the sign-in guard). Builds a BootstrapRecord from the form
 * fields, validates it in memory with the same rules as the startup preflight,
 * and only then writes the Bootstrap File. A configuration that would fail to
 * load is never persisted, so the deployment can never end up crash-looping from
 * a bad identity.
 *
 * On success the process exits cleanly and the restart policy brings the
 * container back with the new configuration loaded. Running Sessions (sibling
 * containers) are unaffected — only web-manager restarts.
 */
export const saveBootstrapConfig = createServerFn({ method: "POST" })
  .validator(
    (data: {
      token: string;
      appId: string;
      appSlug: string;
      clientId: string;
      clientSecret: string;
      privateKeyBase64: string;
      allowedUsers: string;
    }) => data,
  )
  .handler(async ({ data }) => {
    // Re-verify the claim token. It must be valid every time a save is
    // attempted — possession of the token is the only identity proof this
    // unauthenticated screen has.
    let stored: string | undefined;
    try {
      stored = readFileSync(CLAIM_TOKEN_FILE, "utf-8").trim();
    } catch {
      // File doesn't exist or can't be read.
    }
    if (!verifyClaimTokenPure(stored, data.token)) {
      return { ok: false, errors: ["Invalid or expired claim token."] };
    }

    const allowedGithubUsers = data.allowedUsers
      .split(",")
      .map((u) => u.trim())
      .filter(Boolean);

    const record: BootstrapRecord = {
      githubAppId: data.appId.trim(),
      githubAppSlug: data.appSlug.trim(),
      githubClientId: data.clientId.trim(),
      githubClientSecret: data.clientSecret.trim(),
      githubAppPrivateKey: data.privateKeyBase64.trim(),
      allowedGithubUsers,
    };

    // Validate in memory before touching the filesystem. Uses the same
    // validateBootstrapRecord that the startup preflight runs, so a
    // configuration that would crash the process is never persisted.
    const errors = validateBootstrapRecord(record);
    if (errors.length > 0) {
      return { ok: false, errors };
    }

    // Ensure the parent directory exists (the volume mount point is
    // guaranteed at deploy time but not in dev).
    const dir = dirname(BOOTSTRAP_FILE);
    mkdirSync(dir, { recursive: true, mode: 0o700 });

    // Restrictive permissions: the file holds the App private key.
    writeFileSync(BOOTSTRAP_FILE, JSON.stringify(record, null, 2), { mode: 0o600 });

    // Exit cleanly so the restart policy brings the container back with the
    // new configuration loaded. The setTimeout gives the framework a tick to
    // flush the JSON response before the process terminates.
    setTimeout(() => process.exit(0), 100);
    return { ok: true };
  });

/**
 * Spend (delete) the claim token. Called after the first successful sign-in
 * so the unauthenticated bootstrap surface closes permanently once the
 * operator can authenticate (issue #57). Idempotent: when the token was
 * already spent (or the deployment was never unconfigured) this is a no-op.
 */
export const spendClaimToken = createServerFn({ method: "POST" }).handler(async () => {
  try {
    unlinkSync(CLAIM_TOKEN_FILE);
  } catch {
    // File doesn't exist — already spent or never issued. No-op.
  }
});
