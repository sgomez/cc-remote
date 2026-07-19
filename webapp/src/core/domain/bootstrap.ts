/**
 * Bootstrap domain: pure logic for the deployment's GitHub identity and the
 * Claim Token that gates the bootstrap screen.
 *
 * The Bootstrap File is a JSON file on the data volume that holds the
 * GitHub App credentials. It is the single source of truth for the
 * deployment's GitHub identity (App ID, slug, OAuth client ID/secret,
 * private key, sign-in allow-list).
 *
 * The Claim Token is issued by the container entrypoint when the deployment
 * is unconfigured. It proves the operator owns the host and gates the
 * bootstrap screen, which sits outside the sign-in it configures.
 *
 * Framework-free and pure — no I/O, no adapters, just data types and
 * validation functions. The Bootstrap File is read by an adapter (or the
 * entrypoint) and passed to the deployment config loader as a record.
 *
 * See the glossary entry in CONTEXT.md for the full domain definition.
 */

/**
 * The full GitHub identity and sign-in configuration stored in the
 * Bootstrap File on the data volume. Every field is required when a
 * deployment is configured.
 */
export type BootstrapRecord = {
  /** Numeric GitHub App ID (used as JWT `iss` claim). */
  githubAppId: string;
  /** Base64-encoded PEM private key. */
  githubAppPrivateKey: string;
  /** GitHub App slug for building installation URLs. */
  githubAppSlug: string;
  /** GitHub OAuth client ID (user-to-server flow). */
  githubClientId: string;
  /** GitHub OAuth client secret. */
  githubClientSecret: string;
  /**
   * Fail-closed sign-in allow-list. Must be non-empty for a configured
   * deployment. Each entry is a case-sensitive GitHub login.
   */
  allowedGithubUsers: string[];
};

/**
 * A deployment is either configured (has a valid BootstrapRecord) or
 * unconfigured (no Bootstrap File exists yet). An unconfigured deployment
 * cannot authenticate users or mint tokens, but it can serve the bootstrap
 * screen and is a legal startup state.
 */
export type DeploymentState =
  | { kind: "unconfigured" }
  | { kind: "configured"; bootstrap: BootstrapRecord };

/**
 * Shape of the GitHub App Manifest conversion response.
 *
 * POST /app-manifests/{code}/conversions returns these fields.
 * Verified against GitHub's REST API documentation during design.
 */
export type ManifestConversionResponse = {
  /** Numeric GitHub App ID. */
  id: number;
  /** App slug (used in installation URLs). */
  slug: string;
  /** OAuth client ID. */
  client_id: string;
  /** OAuth client secret. */
  client_secret: string;
  /** PEM-encoded private key (raw, not base64). */
  pem: string;
  /** Owner of the App — an organisation or a user. */
  owner: {
    /** GitHub login of the owner. */
    login: string;
  };
};

/**
 * Derive a BootstrapRecord from a GitHub App Manifest conversion response.
 *
 * The conversion response carries the raw PEM, which is base64-encoded
 * for storage in the Bootstrap File. The allow-list is seeded from the
 * owner login and is editable before the record is persisted.
 */
export function deriveBootstrapRecordFromManifest(
  response: ManifestConversionResponse,
): BootstrapRecord {
  return {
    githubAppId: String(response.id),
    githubAppSlug: response.slug,
    githubClientId: response.client_id,
    githubClientSecret: response.client_secret,
    githubAppPrivateKey: Buffer.from(response.pem, "utf8").toString("base64"),
    allowedGithubUsers: [response.owner.login],
  };
}

/**
 * Validate a BootstrapRecord and return all problems as human-readable
 * error messages. Returns an empty array when the record is valid.
 *
 * Rules:
 * - githubAppId must be present and numeric
 * - githubAppPrivateKey must be present and decode to a PEM
 * - githubAppSlug must be non-empty
 * - githubClientId must be non-empty
 * - githubClientSecret must be non-empty
 * - allowedGithubUsers must be non-empty (fail-closed)
 */
export function validateBootstrapRecord(record: BootstrapRecord): string[] {
  const errors: string[] = [];

  if (!record.githubAppId) {
    errors.push("githubAppId is required but missing or empty");
  } else if (!/^\d+$/.test(record.githubAppId)) {
    errors.push(`githubAppId must be a numeric GitHub App ID (got "${record.githubAppId}")`);
  }

  if (!record.githubAppPrivateKey) {
    errors.push("githubAppPrivateKey is required but missing or empty");
  } else {
    // Buffer.from(data, "base64") never throws on invalid input in Node.js —
    // it silently ignores non-base64 characters. The PEM-header regex on the
    // decoded string is the real guard.
    try {
      const decoded = Buffer.from(record.githubAppPrivateKey, "base64").toString("utf8");
      if (!/^-----BEGIN\s/.test(decoded)) {
        errors.push(
          "githubAppPrivateKey must be a base64-encoded PEM (decoded value does not look like a private key)",
        );
      }
    } catch {
      // Buffer.from with base64 shouldn't throw, but guard against unexpected.
      errors.push("githubAppPrivateKey is not valid base64");
    }
  }

  if (!record.githubAppSlug) {
    errors.push("githubAppSlug is required but missing or empty");
  }

  if (!record.githubClientId) {
    errors.push("githubClientId is required but missing or empty");
  }

  if (!record.githubClientSecret) {
    errors.push("githubClientSecret is required but missing or empty");
  }

  if (record.allowedGithubUsers.length === 0) {
    errors.push(
      "allowedGithubUsers is required and must list at least one username " +
        "(an empty allow-list is fail-closed and denies everyone)",
    );
  }

  return errors;
}

// ---- App Manifest Flow -------------------------------------------------------

/**
 * A GitHub App Manifest for the App Manifest Flow.
 *
 * Submitted to GitHub at `https://github.com/settings/apps/new` as a URL-encoded
 * JSON `manifest` query parameter. GitHub creates the App from this manifest and
 * redirects back to the `redirect_url` with a temporary code.
 */
export type GithubAppManifest = {
  /** App name, derived from the deployment hostname. */
  name: string;
  /** Homepage URL (the deployment's own URL). */
  url: string;
  /**
   * Where GitHub redirects after the App is created. Must point to the
   * callback route on this deployment.
   */
  redirect_url: string;
  /**
   * OAuth callback URLs. Must include the deployment's own callback path
   * (`/api/auth/callback/github`). Only the first is used when the App is
   * created from a manifest; GitHub sets the rest.
   */
  callback_urls: string[];
  /** The App is public (required for OAuth user-to-server flow). */
  public: boolean;
  /**
   * Default repository permissions the App will request on installation.
   * Sessions need contents (write) to clone repos with the installation token,
   * and pull_requests (write) to push branches and open PRs.
   */
  default_permissions: {
    contents: string;
    pull_requests: string;
    emails: string;
  };
};

/**
 * Build a GitHub App Manifest from the deployment's base URL.
 *
 * The manifest declares the App's identity, permissions, and the callback URLs
 * that GitHub will use. The `redirect_url` points at this deployment's manifest
 * callback route, which exchanges the temporary code for credentials.
 *
 * The App name is derived from the hostname so multiple deployments on
 * different domains produce different App names.
 */
export function buildManifest(baseUrl: string): GithubAppManifest {
  const cleanUrl = baseUrl.replace(/\/+$/, "");
  return {
    name: `cc-remote-${new URL(cleanUrl).hostname}`,
    url: cleanUrl,
    redirect_url: `${cleanUrl}/bootstrap/manifest/callback`,
    callback_urls: [`${cleanUrl}/api/auth/callback/github`],
    public: true,
    default_permissions: {
      contents: "write",
      pull_requests: "write",
      emails: "read",
    },
  };
}

// ---- Claim Token ------------------------------------------------------------

/** Byte length of the generated token (32 bytes = 256 bits of entropy). */
const CLAIM_TOKEN_BYTES = 32;

/**
 * Generate a cryptographically random Claim Token.
 *
 * Uses the Web Crypto API (`globalThis.crypto`) so it works in both Node.js
 * and browser runtimes without importing a Node-specific module.
 */
export function generateClaimToken(): string {
  const bytes = new Uint8Array(CLAIM_TOKEN_BYTES);
  globalThis.crypto.getRandomValues(bytes);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return hex;
}

/**
 * Verify a supplied claim token against the stored token with a constant-time
 * comparison. Returns `false` for a missing or empty stored token, for an empty
 * supplied token, and for a mismatch — the caller learns nothing beyond "valid
 * or not".
 *
 * The function deliberately avoids early returns on length mismatch: it still
 * runs a constant-time comparison against a dummy buffer so an attacker cannot
 * distinguish "wrong length" from "wrong value" through timing.
 */
export function verifyClaimToken(stored: string | undefined, supplied: string): boolean {
  if (!stored || !supplied) return false;

  const a = new TextEncoder().encode(stored);
  const b = new TextEncoder().encode(supplied);

  if (a.length !== b.length) {
    // Constant-time reject: XOR each stored byte against itself (always
    // zero), so the loop runs for the same duration as a successful
    // comparison would, but the result is discarded.
    let result = 0;
    for (let i = 0; i < a.length; i++) {
      result |= a[i] ^ a[i];
    }
    void result;
    return false;
  }

  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a[i] ^ b[i];
  }
  return result === 0;
}
