import { describe, expect, it } from "vitest";
import { DeploymentConfigError, loadDeploymentConfig } from "./deployment";
import type { BootstrapRecord } from "../core/domain/bootstrap";

// A complete, valid infra env (the "new app" set from PRD §8 / issue #17).
// Individual cases clone this and remove/override keys to exercise a rule.
const VALID: NodeJS.ProcessEnv = {
  BETTER_AUTH_URL: "https://cc.example.com",
  BETTER_AUTH_SECRET: "0".repeat(64),
  GITHUB_CLIENT_ID: "client-id",
  GITHUB_CLIENT_SECRET: "client-secret",
  ALLOWED_GITHUB_USERS: "sgomez, alice",
  DOCKER_HOST: "tcp://docker-socket-proxy:2375",
  GITHUB_APP_ID: "123456",
  GITHUB_APP_PRIVATE_KEY: Buffer.from(
    "-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA...\n-----END RSA PRIVATE KEY-----",
  ).toString("base64"),
  GITHUB_APP_SLUG: "cc-remote-web-manager",
};

// A valid BootstrapRecord matching the VALID env above.
const VALID_BOOTSTRAP: BootstrapRecord = {
  githubAppId: "123456",
  githubAppSlug: "cc-remote-web-manager",
  githubClientId: "client-id",
  githubClientSecret: "client-secret",
  githubAppPrivateKey: Buffer.from(
    "-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA...\n-----END RSA PRIVATE KEY-----",
  ).toString("base64"),
  allowedGithubUsers: ["sgomez", "alice"],
};

describe("loadDeploymentConfig", () => {
  it("parses a complete env into a typed config", () => {
    const cfg = loadDeploymentConfig(VALID);
    expect(cfg.betterAuthUrl).toBe("https://cc.example.com");
    expect(cfg.betterAuthSecret).toBe("0".repeat(64));
    expect(cfg.githubClientId).toBe("client-id");
    expect(cfg.githubClientSecret).toBe("client-secret");
    expect(cfg.allowedGithubUsers).toEqual(["sgomez", "alice"]);
    expect(cfg.dockerHost).toBe("tcp://docker-socket-proxy:2375");
    expect(cfg.githubAppId).toBe("123456");
    expect(cfg.githubAppPrivateKey).toBeTruthy();
    expect(cfg.githubAppPrivateKey).not.toBe("");
    expect(cfg.githubAppSlug).toBe("cc-remote-web-manager");
  });

  it("applies defaults for the optional infra vars", () => {
    const cfg = loadDeploymentConfig(VALID);
    expect(cfg.databasePath).toBe("./data/cc-remote.db");
    expect(cfg.agentImage).toBe("cc-remote-claude-agent");
    expect(cfg.puid).toBe("1000");
    expect(cfg.pgid).toBe("1000");
  });

  it("honours provided optional vars over defaults", () => {
    const cfg = loadDeploymentConfig({
      ...VALID,
      DATABASE_PATH: "/data/cc-remote.db",
      AGENT_IMAGE: "custom-agent",
      PUID: "1500",
      PGID: "1501",
    });
    expect(cfg.databasePath).toBe("/data/cc-remote.db");
    expect(cfg.agentImage).toBe("custom-agent");
    expect(cfg.puid).toBe("1500");
    expect(cfg.pgid).toBe("1501");
  });

  it("throws a DeploymentConfigError naming every missing required var", () => {
    let error: unknown;
    try {
      loadDeploymentConfig({});
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(DeploymentConfigError);
    const { errors } = error as DeploymentConfigError;
    // Only infra env vars are required; GitHub identity fields are optional.
    expect(errors.some((m) => m.includes("BETTER_AUTH_URL"))).toBe(true);
    expect(errors.some((m) => m.includes("BETTER_AUTH_SECRET"))).toBe(true);
    expect(errors.some((m) => m.includes("DOCKER_HOST"))).toBe(true);
    // GitHub identity env vars are no longer required (they come from the
    // Bootstrap File or the deployment is unconfigured).
    expect(errors.some((m) => m.includes("GITHUB_CLIENT_ID"))).toBe(false);
    expect(errors.some((m) => m.includes("GITHUB_CLIENT_SECRET"))).toBe(false);
    expect(errors.some((m) => m.includes("GITHUB_APP_ID"))).toBe(false);
    expect(errors.some((m) => m.includes("GITHUB_APP_PRIVATE_KEY"))).toBe(false);
    expect(errors.some((m) => m.includes("GITHUB_APP_SLUG"))).toBe(false);
    // The message string carries all problems for the operator to read.
    expect((error as DeploymentConfigError).message).toContain("BETTER_AUTH_URL");
  });

  it("treats an empty required var (whitespace only) as missing", () => {
    expect(() =>
      loadDeploymentConfig({ ...VALID, BETTER_AUTH_URL: "   " }),
    ).toThrow(DeploymentConfigError);
  });

  it("rejects an empty allow-list when GitHub env vars are present (fail-closed)", () => {
    let errors: string[] = [];
    try {
      loadDeploymentConfig({ ...VALID, ALLOWED_GITHUB_USERS: " , ," });
    } catch (e) {
      errors = (e as DeploymentConfigError).errors;
    }
    expect(errors.some((m) => m.includes("ALLOWED_GITHUB_USERS"))).toBe(true);
  });

  it("rejects a non-http(s) BETTER_AUTH_URL", () => {
    expect(() => loadDeploymentConfig({ ...VALID, BETTER_AUTH_URL: "not a url" })).toThrow(
      /BETTER_AUTH_URL/,
    );
  });

  it("rejects a BETTER_AUTH_SECRET that is too short to be secure", () => {
    expect(() => loadDeploymentConfig({ ...VALID, BETTER_AUTH_SECRET: "short" })).toThrow(
      /BETTER_AUTH_SECRET/,
    );
  });

  it("rejects a non-numeric PUID / PGID", () => {
    let errors: string[] = [];
    try {
      loadDeploymentConfig({ ...VALID, PUID: "root", PGID: "-1" });
    } catch (e) {
      errors = (e as DeploymentConfigError).errors;
    }
    expect(errors.some((m) => m.includes("PUID"))).toBe(true);
    expect(errors.some((m) => m.includes("PGID"))).toBe(true);
  });

  it("accepts human-unit agent resource limits", () => {
    expect(() =>
      loadDeploymentConfig({ ...VALID, AGENT_MEMORY_LIMIT: "2g", AGENT_CPU_LIMIT: "1.5" }),
    ).not.toThrow();
  });

  it("rejects an unparseable agent limit at startup, rather than running unbounded", () => {
    // AGENT_MEMORY_LIMIT="2 gigs" used to Number.parseInt to NaN -> no limit at all.
    // The preflight must catch it in `docker compose logs`, not on the first Session.
    let errors: string[] = [];
    try {
      loadDeploymentConfig({ ...VALID, AGENT_MEMORY_LIMIT: "2 gigs", AGENT_CPU_LIMIT: "all" });
    } catch (e) {
      errors = (e as DeploymentConfigError).errors;
    }
    expect(errors.some((m) => m.includes("AGENT_MEMORY_LIMIT"))).toBe(true);
    expect(errors.some((m) => m.includes("AGENT_CPU_LIMIT"))).toBe(true);
  });

  it("rejects a memory limit below Docker's own 6m minimum", () => {
    expect(() => loadDeploymentConfig({ ...VALID, AGENT_MEMORY_LIMIT: "1m" })).toThrow(
      /AGENT_MEMORY_LIMIT/,
    );
  });

  it("ignores the retired claude-local host paths instead of failing on them", () => {
    // A .env left over from an older deployment still carries these. They are no
    // longer part of the config, and a stale value must not brick startup.
    const cfg = loadDeploymentConfig({
      ...VALID,
      CLAUDE_CONFIG_PATH: "/home/u/.claude",
      CLAUDE_JSON_PATH: "/home/u/.claude.json",
    });
    expect(cfg).not.toHaveProperty("hostClaude");
  });

  it("rejects a non-numeric GITHUB_APP_ID from env", () => {
    expect(() =>
      loadDeploymentConfig({ ...VALID, GITHUB_APP_ID: "not-a-number" }),
    ).toThrow(/GITHUB_APP_ID/);
  });

  it("rejects a base64 GITHUB_APP_PRIVATE_KEY that does not decode to a PEM", () => {
    expect(() =>
      loadDeploymentConfig({
        ...VALID,
        GITHUB_APP_PRIVATE_KEY: Buffer.from("not a pem").toString("base64"),
      }),
    ).toThrow(/GITHUB_APP_PRIVATE_KEY/);
  });

  it("rejects an unparseable (non-base64) GITHUB_APP_PRIVATE_KEY", () => {
    expect(() =>
      loadDeploymentConfig({ ...VALID, GITHUB_APP_PRIVATE_KEY: "!!!not-base64!!!" }),
    ).toThrow(/GITHUB_APP_PRIVATE_KEY/);
  });

  // --- Unconfigured Deployment tests ---

  it("admits an Unconfigured Deployment (no GitHub env vars, no bootstrap) as legal", () => {
    const cfg = loadDeploymentConfig({
      BETTER_AUTH_URL: "https://cc.example.com",
      BETTER_AUTH_SECRET: "0".repeat(64),
      DOCKER_HOST: "tcp://docker-socket-proxy:2375",
    });
    // Infra fields are filled.
    expect(cfg.betterAuthUrl).toBe("https://cc.example.com");
    expect(cfg.dockerHost).toBe("tcp://docker-socket-proxy:2375");
    // GitHub identity fields are empty.
    expect(cfg.githubAppId).toBe("");
    expect(cfg.githubAppPrivateKey).toBe("");
    expect(cfg.githubAppSlug).toBe("");
    expect(cfg.githubClientId).toBe("");
    expect(cfg.githubClientSecret).toBe("");
    // Allow-list is empty (no sign-in possible, which is correct for
    // an unconfigured deployment).
    expect(cfg.allowedGithubUsers).toEqual([]);
  });

  it("still requires BETTER_AUTH_URL, BETTER_AUTH_SECRET and DOCKER_HOST even when unconfigured", () => {
    expect(() =>
      loadDeploymentConfig({
        // No GitHub env vars at all.
      }),
    ).toThrow(/BETTER_AUTH_URL/);
  });

  // --- BootstrapRecord tests ---

  it("loads GitHub identity from a BootstrapRecord when present", () => {
    const cfg = loadDeploymentConfig(
      {
        BETTER_AUTH_URL: "https://cc.example.com",
        BETTER_AUTH_SECRET: "0".repeat(64),
        DOCKER_HOST: "tcp://docker-socket-proxy:2375",
      },
      VALID_BOOTSTRAP,
    );
    expect(cfg.githubAppId).toBe("123456");
    expect(cfg.githubAppSlug).toBe("cc-remote-web-manager");
    expect(cfg.githubClientId).toBe("client-id");
    expect(cfg.githubClientSecret).toBe("client-secret");
    expect(cfg.githubAppPrivateKey).toBeTruthy();
    expect(cfg.allowedGithubUsers).toEqual(["sgomez", "alice"]);
  });

  it("BootstrapRecord takes precedence over env vars for GitHub identity", () => {
    const cfg = loadDeploymentConfig(
      {
        ...VALID,
        // These env vars differ from the BootstrapRecord, but the record wins.
        GITHUB_CLIENT_ID: "env-client-id",
        GITHUB_CLIENT_SECRET: "env-client-secret",
        GITHUB_APP_ID: "999999",
        GITHUB_APP_SLUG: "env-slug",
        ALLOWED_GITHUB_USERS: "env-user",
      },
      VALID_BOOTSTRAP,
    );
    expect(cfg.githubClientId).toBe("client-id");
    expect(cfg.githubClientSecret).toBe("client-secret");
    expect(cfg.githubAppId).toBe("123456");
    expect(cfg.githubAppSlug).toBe("cc-remote-web-manager");
    expect(cfg.allowedGithubUsers).toEqual(["sgomez", "alice"]);
  });

  it("rejects an invalid BootstrapRecord with aggregated errors", () => {
    let errors: string[] = [];
    try {
      loadDeploymentConfig(
        {
          BETTER_AUTH_URL: "https://cc.example.com",
          BETTER_AUTH_SECRET: "0".repeat(64),
          DOCKER_HOST: "tcp://docker-socket-proxy:2375",
        },
        {
          githubAppId: "not-a-number",
          githubAppPrivateKey: "!!!bad!!!",
          githubAppSlug: "",
          githubClientId: "",
          githubClientSecret: "",
          allowedGithubUsers: [],
        },
      );
    } catch (e) {
      errors = (e as DeploymentConfigError).errors;
    }
    // All bootstrap validation errors are reported together.
    expect(errors.some((m) => m.includes("githubAppId"))).toBe(true);
    expect(errors.some((m) => m.includes("githubAppPrivateKey"))).toBe(true);
    expect(errors.some((m) => m.includes("githubAppSlug"))).toBe(true);
    expect(errors.some((m) => m.includes("githubClientId"))).toBe(true);
    expect(errors.some((m) => m.includes("githubClientSecret"))).toBe(true);
    expect(errors.some((m) => m.includes("allowedGithubUsers"))).toBe(true);
  });

  it("collects both infra env errors and bootstrap errors together", () => {
    let errors: string[] = [];
    try {
      loadDeploymentConfig(
        {
          // Missing BETTER_AUTH_SECRET
          BETTER_AUTH_URL: "https://cc.example.com",
          DOCKER_HOST: "tcp://docker-socket-proxy:2375",
        },
        {
          githubAppId: "",
          githubAppPrivateKey: "",
          githubAppSlug: "",
          githubClientId: "",
          githubClientSecret: "",
          allowedGithubUsers: [],
        },
      );
    } catch (e) {
      errors = (e as DeploymentConfigError).errors;
    }
    // One error from infra (BETTER_AUTH_SECRET)
    expect(errors.some((m) => m.includes("BETTER_AUTH_SECRET"))).toBe(true);
    // Bootstrap errors
    expect(errors.some((m) => m.includes("Bootstrap File"))).toBe(true);
  });
});
