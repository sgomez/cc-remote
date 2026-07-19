// Bootstrap server functions: deployment state, claim token verification,
// and persisting the Bootstrap File (#55). These run only on the server — the
// TanStack Start compiler strips the handlers from the client bundle, so the fs
// imports never reach the browser.

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createServerFn } from "@tanstack/react-start";
import { loadDeploymentConfig } from "~/config/deployment";
import {
  type BootstrapRecord,
  buildManifest,
  deriveBootstrapRecordFromManifest,
  generateClaimToken,
  type ManifestConversionResponse,
  validateBootstrapRecord,
  verifyClaimToken as verifyClaimTokenPure,
} from "~/core/domain/bootstrap";

const BOOTSTRAP_FILE = "/data/bootstrap.json";
const CLAIM_TOKEN_FILE = "/data/claim-token";
const MANIFEST_RESULTS_DIR = "/data/manifest-results";

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
      /** Optional key referencing a temp file from the App Manifest Flow
       *  exchange. When provided, the GitHub identity fields (appId, appSlug,
       *  clientId, clientSecret, privateKeyBase64) are read from the temp file
       *  instead of from the form, which keeps the private key on the server.
       *  Only the allow-list is taken from the form submission. */
      manifestKey?: string;
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

    // When a manifestKey is provided, read the full BootstrapRecord from the
    // temp file created by exchangeManifestCode. The form fields (appId,
    // appSlug, etc.) are ignored — only the allow-list comes from the form.
    // This is how the private key never reaches the browser.
    let record: BootstrapRecord;
    if (data.manifestKey) {
      try {
        const content = readFileSync(
          join(MANIFEST_RESULTS_DIR, `${data.manifestKey}.json`),
          "utf-8",
        );
        record = JSON.parse(content) as BootstrapRecord;
        // Override the allow-list from the form submission; keep everything
        // else from the manifest exchange.
        record.allowedGithubUsers = allowedGithubUsers;
      } catch {
        return {
          ok: false,
          errors: [
            "The manifest registration result could not be found or has expired. " +
              "Please start the App registration again.",
          ],
        } as const;
      }
    } else {
      record = {
        githubAppId: data.appId.trim(),
        githubAppSlug: data.appSlug.trim(),
        githubClientId: data.clientId.trim(),
        githubClientSecret: data.clientSecret.trim(),
        githubAppPrivateKey: data.privateKeyBase64.trim(),
        allowedGithubUsers,
      };
    }

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
 * Return the GitHub App Manifest registration URL. The browser redirects to
 * this URL, which takes the user to GitHub's App creation form pre-filled
 * with the manifest. After the App is created, GitHub redirects back to the
 * `redirect_url` declared in the manifest (this deployment's callback).
 *
 * Exposes the deployment's base URL from config, which is the only dynamic
 * input needed to build the manifest.
 */
export const getManifestRegistrationUrl = createServerFn({ method: "GET" }).handler(async () => {
  const config = loadDeploymentConfig();
  const manifest = buildManifest(config.betterAuthUrl);
  const manifestJson = JSON.stringify(manifest);
  const encoded = encodeURIComponent(manifestJson);
  return `https://github.com/settings/apps/new?manifest=${encoded}`;
});

/**
 * Exchange a temporary code from GitHub's App Manifest Flow for the full App
 * credentials.
 *
 * POSTs the code to `POST /app-manifests/{code}/conversions`, which returns
 * the App ID, slug, OAuth client ID and secret, and the private key in a
 * single response.
 *
 * The result is written to a temporary file on the data volume, and the
 * caller receives a manifest key that can be used to retrieve it. This lets
 * the private key stay on the server — it is never sent to the browser.
 *
 * An expired code (GitHub's manifest flow has a one hour window) or a
 * malformed response produces a clear error message.
 */
export const exchangeManifestCode = createServerFn({ method: "POST" })
  .validator((data: { code: string }) => data)
  .handler(async ({ data }) => {
    const url = `https://api.github.com/app-manifests/${encodeURIComponent(data.code)}/conversions`;

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "cc-remote-web-manager",
        },
      });
    } catch (err) {
      return {
        ok: false,
        errors: [
          `Network error contacting GitHub: ${err instanceof Error ? err.message : String(err)}`,
        ],
      } as const;
    }

    if (response.status === 404) {
      // A 404 from the conversions endpoint most likely means the temporary
      // code has expired. GitHub's manifest flow has a one hour window.
      return {
        ok: false,
        errors: [
          "This registration attempt has expired. GitHub's App Manifest Flow has " +
            "a one hour window to complete the exchange. Please start again from " +
            "the bootstrap screen.",
        ],
      } as const;
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "Unknown error");
      return {
        ok: false,
        errors: [`GitHub returned ${response.status} while exchanging the manifest code: ${body}`],
      } as const;
    }

    let conversion: ManifestConversionResponse;
    try {
      conversion = (await response.json()) as ManifestConversionResponse;
    } catch {
      return {
        ok: false,
        errors: ["GitHub returned an unparseable response while exchanging the manifest code."],
      } as const;
    }

    const record = deriveBootstrapRecordFromManifest(conversion);

    // Store the full record (including private key) in a temp file keyed by a
    // random hex string. The key is returned to the caller so the bootstrap
    // page can reference the record without the private key reaching the
    // browser.
    const manifestKey = generateClaimToken();
    const dir = MANIFEST_RESULTS_DIR;
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(join(dir, `${manifestKey}.json`), JSON.stringify(record), { mode: 0o600 });

    return {
      ok: true,
      manifestKey,
      githubAppId: record.githubAppId,
      githubAppSlug: record.githubAppSlug,
      githubClientId: record.githubClientId,
      githubClientSecret: record.githubClientSecret,
      allowedGithubUsers: record.allowedGithubUsers,
    } as const;
  });

/**
 * Load the pre-filled fields from a manifest exchange result.
 *
 * Reads the temp file created by `exchangeManifestCode` and returns the
 * non-sensitive fields (everything except the private key). Returns `ok:
 * false` when the key is invalid or the file has been cleaned up.
 *
 * The private key is intentionally excluded from the response — it must
 * never reach the browser.
 */
export const loadManifestResult = createServerFn({ method: "GET" })
  .validator((data: { key: string }) => data)
  .handler(async ({ data }) => {
    try {
      const content = readFileSync(join(MANIFEST_RESULTS_DIR, `${data.key}.json`), "utf-8");
      const record: BootstrapRecord = JSON.parse(content);
      return {
        ok: true,
        githubAppId: record.githubAppId,
        githubAppSlug: record.githubAppSlug,
        githubClientId: record.githubClientId,
        githubClientSecret: record.githubClientSecret,
        allowedGithubUsers: record.allowedGithubUsers,
      } as const;
    } catch {
      return { ok: false } as const;
    }
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
