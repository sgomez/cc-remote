// Deployment configuration: the single, validated view of the infra env the
// production container is given (PRD §8 "Configuration split" / issue #17).
//
// After issue #53, the deployment's GitHub identity (App ID, slug, OAuth
// client ID/secret, private key, sign-in allow-list) is resolved from the
// Bootstrap File on the data volume rather than from environment variables.
// When no Bootstrap File exists yet, the deployment starts in an Unconfigured
// state — the GitHub identity fields are empty and no user can sign in, but
// the process boots normally and can serve the bootstrap screen.
//
// This is the ONLY env the new app consumes — everything provider/account
// related moved to the web UI + SQLite, so the legacy per-provider config file
// is gone. The set here is what `setup.sh` / `config.js` compile into `.env`
// and `.env.example`
// documents. The container entrypoint runs this as a preflight (`validate:env`)
// so a misconfigured deployment fails fast with ALL problems listed at once,
// instead of surfacing them one obscure request at a time.
//
// Framework-free and pure (env in → config out / throw), so it is unit-tested
// directly (deployment.test.ts) with no server, Docker, or DB. It does not
// replace the scattered `process.env` reads in the adapters (auth, db-path,
// docker/config) — those keep their own defaults; this module is the startup
// guard and the documented source of truth for the required set.

// The limit parsers live with their only consumer, the Docker adapter, and are
// pure (no dockerode import), so the preflight can reuse them without dragging
// infrastructure in — this module stays unit-testable with no server/Docker/DB.
import { parseMemoryBytes, parseNanoCpus } from "../adapters/docker/config";
import type { BootstrapRecord } from "../core/domain/bootstrap";
import { validateBootstrapRecord } from "../core/domain/bootstrap";

/** Parsed, validated infra configuration for the production container. */
export type DeploymentConfig = {
  /** Public base URL better-auth signs cookies / builds OAuth callbacks against. */
  betterAuthUrl: string;
  /** Stable signing secret; a fresh one every restart invalidates all sessions. */
  betterAuthSecret: string;
  githubClientId: string;
  githubClientSecret: string;
  /**
   * Fail-closed allow-list, already split/trimmed.
   * Guaranteed non-empty when the deployment is configured
   * (BootstrapRecord provided). Empty when unconfigured.
   */
  allowedGithubUsers: string[];
  /** dockerode target — the socket proxy (`tcp://docker-socket-proxy:2375`). */
  dockerHost: string;
  /** Agent image both session phases run. */
  agentImage: string;
  /** SQLite file path (domain + better-auth tables) on the persisted volume. */
  databasePath: string;
  puid: string;
  pgid: string;
  /** GitHub App numeric ID for JWT signing. Empty when unconfigured. */
  githubAppId: string;
  /** Base64-encoded PEM private key for GitHub App JWT signing. Empty when unconfigured. */
  githubAppPrivateKey: string;
  /** GitHub App slug for building installation URLs. Empty when unconfigured. */
  githubAppSlug: string;
};

/**
 * Aggregated configuration failure. `errors` lists one human-readable line per
 * problem; `message` joins them so a bare `throw` still prints everything.
 */
export class DeploymentConfigError extends Error {
  readonly errors: string[];
  constructor(errors: string[]) {
    super(`Invalid deployment configuration:\n${errors.map((e) => `  - ${e}`).join("\n")}`);
    this.name = "DeploymentConfigError";
    this.errors = errors;
  }
}

const DEFAULTS = {
  databasePath: "./data/cc-remote.db",
  agentImage: "cc-remote-claude-agent",
  puid: "1000",
  pgid: "1000",
} as const;

// better-auth's own recommended minimum; `config.js` emits 64 hex chars.
const MIN_SECRET_LENGTH = 32;

function trimmed(value: string | undefined): string {
  return (value ?? "").trim();
}

function isNonNegativeInteger(value: string): boolean {
  return /^\d+$/.test(value);
}

function parseAllowList(raw: string | undefined): string[] {
  return trimmed(raw)
    .split(",")
    .map((u) => u.trim())
    .filter(Boolean);
}

/**
 * Validate and parse the infra env. Collects EVERY problem before throwing, so
 * one run surfaces the full list. Returns a typed config when the env is sound.
 *
 * When a `BootstrapRecord` is provided, the GitHub identity (App ID, slug,
 * OAuth client ID/secret, private key) and the sign-in allow-list are resolved
 * from the record rather than from environment variables. The record is
 * validated with the same rules that the env-var path used.
 *
 * When neither a BootstrapRecord nor the corresponding env vars are present,
 * the GitHub identity fields are empty strings — an Unconfigured Deployment.
 * All non-GitHub validation (BETTER_AUTH_URL, DOCKER_HOST, agent limits, etc.)
 * is enforced regardless of the bootstrap state.
 */
export function loadDeploymentConfig(
  env: NodeJS.ProcessEnv = process.env,
  bootstrap?: BootstrapRecord,
): DeploymentConfig {
  const errors: string[] = [];

  const require = (name: string): string => {
    const value = trimmed(env[name]);
    if (!value) errors.push(`${name} is required but missing or empty`);
    return value;
  };

  const betterAuthUrl = require("BETTER_AUTH_URL");
  const betterAuthSecret = require("BETTER_AUTH_SECRET");
  const dockerHost = require("DOCKER_HOST");

  if (betterAuthUrl && !/^https?:\/\/.+/.test(betterAuthUrl)) {
    errors.push(`BETTER_AUTH_URL must be an http(s) URL (got "${betterAuthUrl}")`);
  }
  if (betterAuthSecret && betterAuthSecret.length < MIN_SECRET_LENGTH) {
    errors.push(`BETTER_AUTH_SECRET must be at least ${MIN_SECRET_LENGTH} characters`);
  }

  // Resolve GitHub identity: BootstrapRecord overrides env vars.
  // When neither is present the deployment is unconfigured — an empty allow-list
  // and empty GitHub identity fields are legal at startup (no user is denied
  // access because there is no way to sign in at all).
  let githubClientId: string;
  let githubClientSecret: string;
  let allowedGithubUsers: string[];
  let githubAppId: string;
  let githubAppPrivateKey: string;
  let githubAppSlug: string;

  if (bootstrap) {
    // Validate the bootstrap record and collect its errors alongside the rest.
    errors.push(...validateBootstrapRecord(bootstrap).map((msg) => `Bootstrap File: ${msg}`));
    githubClientId = bootstrap.githubClientId;
    githubClientSecret = bootstrap.githubClientSecret;
    allowedGithubUsers = bootstrap.allowedGithubUsers;
    githubAppId = bootstrap.githubAppId;
    githubAppPrivateKey = bootstrap.githubAppPrivateKey;
    githubAppSlug = bootstrap.githubAppSlug;
  } else {
    // Env-var fallback for backward compatibility or for configured
    // deployments that haven't migrated to the Bootstrap File yet.
    // All of these are now optional — missing values mean unconfigured.
    githubClientId = trimmed(env.GITHUB_CLIENT_ID);
    githubClientSecret = trimmed(env.GITHUB_CLIENT_SECRET);

    allowedGithubUsers = parseAllowList(env.ALLOWED_GITHUB_USERS);
    // When GitHub identity env vars ARE present, the allow-list must be
    // non-empty (fail-closed). When no env vars are present at all, the
    // deployment is unconfigured and an empty allow-list is expected.
    // Detect "present" by the presence of any GitHub identity env var.
    const anyGithubEnvPresent =
      githubClientId ||
      githubClientSecret ||
      trimmed(env.GITHUB_APP_ID) ||
      trimmed(env.GITHUB_APP_PRIVATE_KEY) ||
      trimmed(env.GITHUB_APP_SLUG);

    if (anyGithubEnvPresent && allowedGithubUsers.length === 0) {
      errors.push(
        "ALLOWED_GITHUB_USERS is required and must list at least one username " +
          "(an empty allow-list is fail-closed and denies everyone)",
      );
    }

    githubAppId = trimmed(env.GITHUB_APP_ID);
    if (githubAppId && !/^\d+$/.test(githubAppId)) {
      errors.push(`GITHUB_APP_ID must be a numeric GitHub App ID (got "${githubAppId}")`);
    }
    githubAppPrivateKey = trimmed(env.GITHUB_APP_PRIVATE_KEY);
    if (githubAppPrivateKey) {
      const decoded = Buffer.from(githubAppPrivateKey, "base64").toString("utf8");
      if (!/^-----BEGIN\s/.test(decoded)) {
        errors.push(
          "GITHUB_APP_PRIVATE_KEY must be a base64-encoded PEM (decoded value does not look like a private key)",
        );
      }
    }
    githubAppSlug = trimmed(env.GITHUB_APP_SLUG);
  }

  const puid = trimmed(env.PUID) || DEFAULTS.puid;
  const pgid = trimmed(env.PGID) || DEFAULTS.pgid;
  if (!isNonNegativeInteger(puid))
    errors.push(`PUID must be a non-negative integer (got "${puid}")`);
  if (!isNonNegativeInteger(pgid))
    errors.push(`PGID must be a non-negative integer (got "${pgid}")`);

  // Agent resource limits (S4). The Docker adapter owns the parse and the values
  // (it is the only consumer); the preflight runs it so a typo like
  // AGENT_MEMORY_LIMIT="2 gigs" is reported at container start, alongside every
  // other config problem, instead of blowing up on the first Session create.
  // These are the caps that keep one runaway agent from taking the host — and
  // web-manager with it — so an unparseable value is a hard error, never a
  // silent fall-back to "unlimited".
  for (const name of ["AGENT_MEMORY_LIMIT", "AGENT_CPU_LIMIT"] as const) {
    try {
      if (name === "AGENT_MEMORY_LIMIT") parseMemoryBytes(env[name], name);
      else parseNanoCpus(env[name], name);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  if (errors.length > 0) throw new DeploymentConfigError(errors);

  return {
    betterAuthUrl,
    betterAuthSecret,
    githubClientId,
    githubClientSecret,
    allowedGithubUsers,
    dockerHost,
    agentImage: trimmed(env.AGENT_IMAGE) || DEFAULTS.agentImage,
    databasePath: trimmed(env.DATABASE_PATH) || DEFAULTS.databasePath,
    puid,
    pgid,
    githubAppId,
    githubAppPrivateKey,
    githubAppSlug,
  };
}
