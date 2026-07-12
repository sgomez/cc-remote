import { describe, expect, it } from "vitest";
import { DeploymentConfigError, loadDeploymentConfig } from "./deployment";

// A complete, valid infra env (the "new app" set from PRD §8 / issue #17).
// Individual cases clone this and remove/override keys to exercise a rule.
const VALID: NodeJS.ProcessEnv = {
  BETTER_AUTH_URL: "https://cc.example.com",
  BETTER_AUTH_SECRET: "0".repeat(64),
  GITHUB_CLIENT_ID: "client-id",
  GITHUB_CLIENT_SECRET: "client-secret",
  ALLOWED_GITHUB_USERS: "sgomez, alice",
  DOCKER_HOST: "tcp://docker-socket-proxy:2375",
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
    // One aggregated failure per missing required var (not fail-on-first).
    expect(errors.some((m) => m.includes("BETTER_AUTH_URL"))).toBe(true);
    expect(errors.some((m) => m.includes("BETTER_AUTH_SECRET"))).toBe(true);
    expect(errors.some((m) => m.includes("GITHUB_CLIENT_ID"))).toBe(true);
    expect(errors.some((m) => m.includes("GITHUB_CLIENT_SECRET"))).toBe(true);
    expect(errors.some((m) => m.includes("ALLOWED_GITHUB_USERS"))).toBe(true);
    expect(errors.some((m) => m.includes("DOCKER_HOST"))).toBe(true);
    // The message string carries all of them for the operator to read.
    expect((error as DeploymentConfigError).message).toContain("BETTER_AUTH_URL");
    expect((error as DeploymentConfigError).message).toContain("GITHUB_CLIENT_ID");
  });

  it("treats an empty required var (whitespace only) as missing", () => {
    expect(() => loadDeploymentConfig({ ...VALID, GITHUB_CLIENT_ID: "   " })).toThrow(
      DeploymentConfigError,
    );
  });

  it("rejects an empty allow-list (fail-closed would brick login)", () => {
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
});
