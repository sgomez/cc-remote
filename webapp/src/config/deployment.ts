// Deployment configuration: the single, validated view of the infra env the
// production container is given (PRD §8 "Configuration split" / issue #17).
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

/** Parsed, validated infra configuration for the production container. */
export type DeploymentConfig = {
  /** Public base URL better-auth signs cookies / builds OAuth callbacks against. */
  betterAuthUrl: string;
  /** Stable signing secret; a fresh one every restart invalidates all sessions. */
  betterAuthSecret: string;
  githubClientId: string;
  githubClientSecret: string;
  /** Fail-closed allow-list, already split/trimmed; guaranteed non-empty. */
  allowedGithubUsers: string[];
  /** dockerode target — the socket proxy (`tcp://docker-socket-proxy:2375`). */
  dockerHost: string;
  /** Agent image both session phases run. */
  agentImage: string;
  /** SQLite file path (domain + better-auth tables) on the persisted volume. */
  databasePath: string;
  puid: string;
  pgid: string;
  /** GitHub App numeric ID for JWT signing. */
  githubAppId: string;
  /** Base64-encoded PEM private key for GitHub App JWT signing. Empty if not configured. */
  githubAppPrivateKey: string;
  /** GitHub App slug for building installation URLs. */
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
 */
export function loadDeploymentConfig(env: NodeJS.ProcessEnv = process.env): DeploymentConfig {
  const errors: string[] = [];

  const require = (name: string): string => {
    const value = trimmed(env[name]);
    if (!value) errors.push(`${name} is required but missing or empty`);
    return value;
  };

  const betterAuthUrl = require("BETTER_AUTH_URL");
  const betterAuthSecret = require("BETTER_AUTH_SECRET");
  const githubClientId = require("GITHUB_CLIENT_ID");
  const githubClientSecret = require("GITHUB_CLIENT_SECRET");
  const dockerHost = require("DOCKER_HOST");

  if (betterAuthUrl && !/^https?:\/\/.+/.test(betterAuthUrl)) {
    errors.push(`BETTER_AUTH_URL must be an http(s) URL (got "${betterAuthUrl}")`);
  }
  if (betterAuthSecret && betterAuthSecret.length < MIN_SECRET_LENGTH) {
    errors.push(`BETTER_AUTH_SECRET must be at least ${MIN_SECRET_LENGTH} characters`);
  }

  // Fail-closed allow-list: an empty list denies everyone, so an empty value is
  // a misconfiguration (a deployment nobody can log into), not "deny all".
  const allowedGithubUsers = parseAllowList(env.ALLOWED_GITHUB_USERS);
  if (allowedGithubUsers.length === 0) {
    errors.push(
      "ALLOWED_GITHUB_USERS is required and must list at least one username " +
        "(an empty allow-list is fail-closed and denies everyone)",
    );
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

  // GitHub App configuration for token-minting. Missing or malformed values are a
  // hard startup error: without this config every Session that tries to clone a repo
  // will fail at provision time with an opaque Docker error, and the operator may not
  // connect the two. Fail loud at start instead.
  const githubAppId = require("GITHUB_APP_ID");
  if (githubAppId && !/^\d+$/.test(githubAppId)) {
    errors.push(`GITHUB_APP_ID must be a numeric GitHub App ID (got "${githubAppId}")`);
  }
  const githubAppPrivateKey = require("GITHUB_APP_PRIVATE_KEY");
  if (githubAppPrivateKey) {
    // Buffer.from(data, "base64") never throws on invalid input in Node.js — it
    // silently ignores non-base64 characters. The PEM-header regex on the decoded
    // string is the real guard. No try/catch needed here.
    const decoded = Buffer.from(githubAppPrivateKey, "base64").toString("utf8");
    if (!/^-----BEGIN\s/.test(decoded)) {
      errors.push(
        "GITHUB_APP_PRIVATE_KEY must be a base64-encoded PEM (decoded value does not look like a private key)",
      );
    }
  }
  const githubAppSlug = require("GITHUB_APP_SLUG");

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
