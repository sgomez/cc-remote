/**
 * Bootstrap domain: pure logic for the deployment's GitHub identity.
 *
 * The Bootstrap File is a JSON file on the data volume that holds the
 * GitHub App credentials. It is the single source of truth for the
 * deployment's GitHub identity (App ID, slug, OAuth client ID/secret,
 * private key, sign-in allow-list).
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
