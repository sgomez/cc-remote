import { describe, expect, it } from "vitest";
import type { CloneContainerSpec, SessionContainerSpec } from "../../core";
import { ACCOUNT_CONFIG_DIR_ENV, ACCOUNT_CONFIG_MOUNT, type DockerAdapterConfig } from "./config";
import {
  buildCloneCreateOptions,
  buildHasCredentialsCreateOptions,
  buildSeedCreateOptions,
  buildSessionCreateOptions,
  CREDENTIALS_MARKER,
} from "./container-specs";

const config: DockerAdapterConfig = {
  host: { socketPath: "/var/run/docker.sock" },
  agentImage: "cc-remote-claude-agent",
  network: "cc-remote_default",
  puid: "1000",
  pgid: "1000",
  pidsLimit: 4096,
  restartPolicy: "unless-stopped",
  gitUserName: "Bot",
  gitUserEmail: "bot@example.com",
};

const sessionSpec: SessionContainerSpec = {
  sessionName: "demo",
  repo: "octocat/hello",
  accountId: "acc-1",
  workspaceVolume: "cc-remote-workspace-demo",
  env: { GITHUB_TOKEN: "tok", SESSION_NAME: "demo", ANTHROPIC_BASE_URL: "https://x" },
  labels: { "cc-remote-session": "true", "cc-remote-session-name": "demo" },
  accountConfigVolume: "cc-remote-account-acc-1",
  remoteControl: false,
};

describe("buildSessionCreateOptions — config-volume account", () => {
  const opts = buildSessionCreateOptions(sessionSpec, config);

  it("names and images the main container, running the image default CMD (ttyd)", () => {
    expect(opts.name).toBe("cc-remote-session-demo");
    expect(opts.Image).toBe("cc-remote-claude-agent");
    // No Cmd/Entrypoint override — the image's ttyd console CMD runs.
    expect(opts.Cmd).toBeUndefined();
    expect(opts.Entrypoint).toBeUndefined();
    expect(opts.Tty).toBe(true);
    expect(opts.OpenStdin).toBe(true);
  });

  it("mounts the workspace volume and stages the Account Config Volume", () => {
    expect(opts.HostConfig?.Binds).toEqual([
      "cc-remote-workspace-demo:/workspace",
      `cc-remote-account-acc-1:${ACCOUNT_CONFIG_MOUNT}`,
    ]);
  });

  it("merges infra env under the domain env and points entrypoint at the staged config", () => {
    const env = opts.Env ?? [];
    expect(env).toContain("PUID=1000");
    expect(env).toContain("PGID=1000");
    expect(env).toContain("GIT_USER_NAME=Bot");
    expect(env).toContain("GITHUB_TOKEN=tok");
    expect(env).toContain("ANTHROPIC_BASE_URL=https://x");
    expect(env).toContain(`${ACCOUNT_CONFIG_DIR_ENV}=${ACCOUNT_CONFIG_MOUNT}`);
  });

  it("carries the hardening flags and network", () => {
    expect(opts.HostConfig?.SecurityOpt).toEqual(["no-new-privileges:true"]);
    expect(opts.HostConfig?.PidsLimit).toBe(4096);
    expect(opts.HostConfig?.RestartPolicy).toEqual({ Name: "unless-stopped" });
    expect(opts.HostConfig?.NetworkMode).toBe("cc-remote_default");
  });

  it("passes the domain labels through unchanged", () => {
    expect(opts.Labels).toEqual(sessionSpec.labels);
  });

  it("applies a memory limit only when configured", () => {
    expect(opts.HostConfig?.Memory).toBeUndefined();
    const limited = buildSessionCreateOptions(sessionSpec, { ...config, memoryLimit: 1024 });
    expect(limited.HostConfig?.Memory).toBe(1024);
  });

  it("domain env overrides an infra key of the same name", () => {
    const spec = { ...sessionSpec, env: { ...sessionSpec.env, PUID: "9999" } };
    const env = buildSessionCreateOptions(spec, config).Env ?? [];
    expect(env).toContain("PUID=9999");
    expect(env.filter((e) => e.startsWith("PUID="))).toHaveLength(1);
  });
});

describe("buildSessionCreateOptions — host-mount (claude-local)", () => {
  const hostSpec: SessionContainerSpec = { ...sessionSpec, accountConfigVolume: null };

  it("binds the host Claude config in place and sets no staging env", () => {
    const opts = buildSessionCreateOptions(hostSpec, {
      ...config,
      hostClaudeConfigPath: "/host/.claude",
      hostClaudeJsonPath: "/host/.claude.json",
    });
    expect(opts.HostConfig?.Binds).toEqual([
      "cc-remote-workspace-demo:/workspace",
      "/host/.claude:/home/node/.claude",
      "/host/.claude.json:/home/node/.claude.json",
    ]);
    expect((opts.Env ?? []).some((e) => e.startsWith(`${ACCOUNT_CONFIG_DIR_ENV}=`))).toBe(false);
  });

  it("throws when host-mount is requested but host paths are unset (absent-safe)", () => {
    expect(() => buildSessionCreateOptions(hostSpec, config)).toThrow(/CLAUDE_CONFIG_PATH/);
  });
});

describe("buildCloneCreateOptions", () => {
  const cloneSpec: CloneContainerSpec = {
    sessionName: "demo",
    repo: "octocat/hello",
    accountId: "acc-1",
    workspaceVolume: "cc-remote-workspace-demo",
    env: { GITHUB_TOKEN: "tok", GITHUB_REPO: "octocat/hello" },
    labels: { "cc-remote-session": "true", "cc-remote-cloning": "true" },
  };
  const opts = buildCloneCreateOptions(cloneSpec, config);

  it("names the clone helper and overrides the entrypoint", () => {
    expect(opts.name).toBe("cc-remote-session-clone-demo");
    expect(opts.Entrypoint).toEqual([]);
    expect(opts.WorkingDir).toBe("/workspace");
  });

  it("clones via env interpolation only — no request data in the Cmd", () => {
    const script = (opts.Cmd ?? [])[2] ?? "";
    expect(script).toContain(
      'git clone "https://x-access-token:$GITHUB_TOKEN@github.com/$GITHUB_REPO.git"',
    );
    expect(script).not.toContain("octocat/hello");
  });

  it("mounts only the workspace volume, hardened", () => {
    expect(opts.HostConfig?.Binds).toEqual(["cc-remote-workspace-demo:/workspace"]);
    expect(opts.HostConfig?.SecurityOpt).toEqual(["no-new-privileges:true"]);
  });
});

describe("buildSeedCreateOptions", () => {
  const opts = buildSeedCreateOptions("cc-remote-account-acc-1", ".claude.json", '{"a":1}', config);

  it("passes content and path as env, never interpolated into the Cmd", () => {
    const env = opts.Env ?? [];
    expect(env).toContain('SEED_CONTENT={"a":1}');
    expect(env).toContain("SEED_PATH=.claude.json");
    const script = (opts.Cmd ?? [])[2] ?? "";
    expect(script).toContain('printf %s "$SEED_CONTENT"');
    expect(script).not.toContain('{"a":1}');
  });

  it("mounts the target volume", () => {
    expect(opts.HostConfig?.Binds).toEqual(["cc-remote-account-acc-1:/vol"]);
  });
});

describe("buildHasCredentialsCreateOptions", () => {
  const opts = buildHasCredentialsCreateOptions("cc-remote-account-acc-1", config);

  it("tests the credential marker read-only", () => {
    const script = (opts.Cmd ?? [])[2] ?? "";
    expect(script).toContain(`test -f "/vol/${CREDENTIALS_MARKER}"`);
    expect(opts.HostConfig?.Binds).toEqual(["cc-remote-account-acc-1:/vol:ro"]);
  });
});
