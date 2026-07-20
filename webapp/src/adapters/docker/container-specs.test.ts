import { describe, expect, it } from "vitest";
import type { CloneContainerSpec, LoginContainerSpec, SessionContainerSpec } from "../../core";
import { ACCOUNT_CONFIG_DIR_ENV, ACCOUNT_CONFIG_MOUNT, type DockerAdapterConfig } from "./config";
import {
  buildCloneCreateOptions,
  buildHasCredentialsCreateOptions,
  buildLoginCreateOptions,
  buildSeedCreateOptions,
  buildSessionCreateOptions,
  CREDENTIALS_MARKER,
} from "./container-specs";

const MB = 1024 ** 2;

const config: DockerAdapterConfig = {
  host: { socketPath: "/var/run/docker.sock" },
  agentImage: "cc-remote-claude-agent",
  network: "cc-remote-agents",
  puid: "1000",
  pgid: "1000",
  pidsLimit: 4096,
  restartPolicy: "unless-stopped",
};

const sessionSpec: SessionContainerSpec = {
  sessionName: "demo",
  repo: "octocat/hello",
  accountId: "acc-1",
  workspaceVolume: "cc-remote-workspace-demo",
  env: {
    GITHUB_REPO: "octocat/hello",
    SESSION_NAME: "demo",
    ANTHROPIC_BASE_URL: "https://x",
    CC_BROKER_SECRET: "bs-1",
    CC_BROKER_URL: "http://web-manager:4001",
    GIT_USER_NAME: "Sergio Gómez",
    GIT_USER_EMAIL: "580701+sgomez@users.noreply.github.com",
  },
  labels: {
    "cc-remote-session": "true",
    "cc-remote-session-name": "demo",
    "cc-remote-permission-mode": "bypassPermissions",
  },
  accountConfigVolume: "cc-remote-account-acc-1",
  remoteControl: false,
};

const loginSpec: LoginContainerSpec = {
  accountId: "acc-1",
  accountConfigVolume: "cc-remote-account-acc-1",
  labels: { "cc-remote-login": "true", "cc-remote-account-id": "acc-1" },
};

describe("buildLoginCreateOptions", () => {
  const opts = buildLoginCreateOptions(loginSpec, config);

  it("names the login container from the account id", () => {
    expect(opts.name).toBe("cc-remote-login-acc-1");
    expect(opts.Image).toBe("cc-remote-claude-agent");
    expect(opts.Tty).toBe(true);
    expect(opts.OpenStdin).toBe(true);
  });

  it("mounts ONLY the Account Config Volume and stages it for entrypoint linking", () => {
    expect(opts.HostConfig?.Binds).toEqual([`cc-remote-account-acc-1:${ACCOUNT_CONFIG_MOUNT}`]);
    expect(opts.Env).toContain(`${ACCOUNT_CONFIG_DIR_ENV}=${ACCOUNT_CONFIG_MOUNT}`);
  });

  it("injects NO GITHUB_TOKEN, repo, or domain provider env", () => {
    const env = opts.Env ?? [];
    expect(env.some((e) => e.startsWith("GITHUB_TOKEN="))).toBe(false);
    expect(env.some((e) => e.startsWith("GITHUB_REPO="))).toBe(false);
    expect(env.some((e) => e.startsWith("ANTHROPIC_"))).toBe(false);
  });

  it("overrides the CMD with a ttyd bound to the login terminal base path", () => {
    expect(opts.Cmd?.[0]).toBe("sh");
    const cmd = (opts.Cmd ?? []).join(" ");
    expect(cmd).toContain("ttyd -p 7681");
    expect(cmd).toContain("--base-path /api/accounts/acc-1/login/terminal");
    expect(cmd).toContain("console-entrypoint.sh");
  });

  it("carries hardening + network but no restart policy (ephemeral)", () => {
    expect(opts.HostConfig?.SecurityOpt).toEqual(["no-new-privileges:true"]);
    expect(opts.HostConfig?.PidsLimit).toBe(4096);
    expect(opts.HostConfig?.NetworkMode).toBe("cc-remote-agents");
    expect(opts.HostConfig?.RestartPolicy).toBeUndefined();
  });

  it("labels it as a Login Container so session listings exclude it", () => {
    expect(opts.Labels?.["cc-remote-login"]).toBe("true");
    expect(opts.Labels?.["cc-remote-session"]).toBeUndefined();
  });
});

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
    expect(env).toContain("CC_BROKER_SECRET=bs-1");
    expect(env).toContain("CC_BROKER_URL=http://web-manager:4001");
    expect(env).toContain("ANTHROPIC_BASE_URL=https://x");
    expect(env).toContain(`${ACCOUNT_CONFIG_DIR_ENV}=${ACCOUNT_CONFIG_MOUNT}`);
  });

  it("injects NO durable GITHUB_TOKEN into the Session container", () => {
    const env = opts.Env ?? [];
    expect(env.some((e) => e.startsWith("GITHUB_TOKEN="))).toBe(false);
  });

  it("carries the per-Session Commit Identity from the domain env", () => {
    const env = opts.Env ?? [];
    expect(env).toContain("GIT_USER_NAME=Sergio Gómez");
    expect(env).toContain("GIT_USER_EMAIL=580701+sgomez@users.noreply.github.com");
  });

  it("carries the hardening flags and network", () => {
    expect(opts.HostConfig?.SecurityOpt).toEqual(["no-new-privileges:true"]);
    expect(opts.HostConfig?.PidsLimit).toBe(4096);
    expect(opts.HostConfig?.RestartPolicy).toEqual({ Name: "unless-stopped" });
    expect(opts.HostConfig?.NetworkMode).toBe("cc-remote-agents");
  });

  it("passes the domain labels through", () => {
    expect(opts.Labels).toMatchObject(sessionSpec.labels);
    // The permission-mode label is what a reset reads back to restore the mode
    // the Session was created in — losing it here would silently downgrade it.
    expect(opts.Labels?.["cc-remote-permission-mode"]).toBe("bypassPermissions");
  });

  it("applies a memory limit only when configured", () => {
    expect(opts.HostConfig?.Memory).toBeUndefined();
    expect(opts.HostConfig?.MemorySwap).toBeUndefined();
    const limited = buildSessionCreateOptions(sessionSpec, { ...config, memoryLimit: 2048 * MB });
    expect(limited.HostConfig?.Memory).toBe(2048 * MB);
  });

  it("domain env overrides an infra key of the same name", () => {
    const spec = { ...sessionSpec, env: { ...sessionSpec.env, PUID: "9999" } };
    const env = buildSessionCreateOptions(spec, config).Env ?? [];
    expect(env).toContain("PUID=9999");
    expect(env.filter((e) => e.startsWith("PUID="))).toHaveLength(1);
  });
});

describe("buildSessionCreateOptions — named volumes only", () => {
  it("never binds a host path: every bind source is a cc-remote volume", () => {
    const binds = buildSessionCreateOptions(sessionSpec, config).HostConfig?.Binds ?? [];
    expect(binds).not.toHaveLength(0);
    for (const bind of binds) {
      const source = bind.split(":")[0];
      expect(source.startsWith("/")).toBe(false);
      expect(source.startsWith("cc-remote-")).toBe(true);
    }
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

describe("commit identity is per-Session, never deployment-wide", () => {
  // GIT_USER_NAME/GIT_USER_EMAIL used to come from infraEnv, so all five builders
  // got a single deployment-wide identity — and its host-derived default never
  // resolved, so every agent committed as a fake "Claude Remote Agent" that
  // GitHub attributed to nobody. The identity is now the provisioning user's,
  // supplied per-Session through the domain env. Nothing else may carry one.
  const noIdentitySpecs = [
    [
      "clone",
      buildCloneCreateOptions(
        {
          sessionName: "demo",
          repo: "octocat/hello",
          accountId: "acc-1",
          workspaceVolume: "cc-remote-workspace-demo",
          env: {},
          labels: {},
        },
        config,
      ),
    ],
    ["login", buildLoginCreateOptions(loginSpec, config)],
    ["seed", buildSeedCreateOptions("vol", ".claude.json", "{}", config)],
    ["has-credentials", buildHasCredentialsCreateOptions("vol", config)],
  ] as const;

  it.each(noIdentitySpecs)("%s container carries no git identity", (_, opts) => {
    const env = opts.Env ?? [];
    expect(env.some((e) => e.startsWith("GIT_USER_NAME="))).toBe(false);
    expect(env.some((e) => e.startsWith("GIT_USER_EMAIL="))).toBe(false);
  });

  it("the adapter contributes no identity of its own when the domain supplies none", () => {
    const opts = buildSessionCreateOptions({ ...sessionSpec, env: {} }, config);
    const env = opts.Env ?? [];
    expect(env.some((e) => e.startsWith("GIT_USER_"))).toBe(false);
  });
});

describe("resource limits (S4)", () => {
  // An agent runs untrusted, AI-generated code in --permission-mode auto. Without a
  // memory cap, one runaway build takes the VPS down WITH web-manager — the thing
  // you'd use to log in and kill it. Every container this adapter creates must carry
  // the limits, not just the Session: the clone helper (huge repos) had no PidsLimit
  // at all, and only the Session ever got Memory. All five now go through
  // baseHostConfig, and this table is the guard against the next one forgetting.
  const limited: DockerAdapterConfig = {
    ...config,
    memoryLimit: 2 * 1024 * MB,
    nanoCpus: 1_500_000_000,
  };
  const cloneSpec: CloneContainerSpec = {
    sessionName: "demo",
    repo: "octocat/hello",
    accountId: "acc-1",
    workspaceVolume: "cc-remote-workspace-demo",
    env: {},
    labels: {},
  };
  const builders = [
    ["session", buildSessionCreateOptions(sessionSpec, limited)],
    ["clone", buildCloneCreateOptions(cloneSpec, limited)],
    ["login", buildLoginCreateOptions(loginSpec, limited)],
    ["seed", buildSeedCreateOptions("vol", ".claude.json", "{}", limited)],
    ["has-credentials", buildHasCredentialsCreateOptions("vol", limited)],
  ] as const;

  it.each(builders)("%s container carries the memory limit", (_, opts) => {
    expect(opts.HostConfig?.Memory).toBe(2 * 1024 * MB);
  });

  it.each(builders)("%s container disables swap (MemorySwap == Memory)", (_, opts) => {
    // Unset, Docker defaults swap to 2x Memory, so a "2g" container can still touch
    // 4g and thrash the host's disk — the cap would not be a cap.
    expect(opts.HostConfig?.MemorySwap).toBe(opts.HostConfig?.Memory);
  });

  it.each(builders)("%s container carries the CPU quota", (_, opts) => {
    expect(opts.HostConfig?.NanoCpus).toBe(1_500_000_000);
  });

  it.each(builders)("%s container carries the pids limit (fork-bomb ceiling)", (_, opts) => {
    expect(opts.HostConfig?.PidsLimit).toBe(4096);
  });

  it.each(builders)("%s container carries no-new-privileges", (_, opts) => {
    expect(opts.HostConfig?.SecurityOpt).toEqual(["no-new-privileges:true"]);
  });

  it("keeps the restart policy on the Session and off the ephemeral containers", () => {
    expect(buildSessionCreateOptions(sessionSpec, limited).HostConfig?.RestartPolicy).toEqual({
      Name: "unless-stopped",
    });
    for (const [name, opts] of builders) {
      if (name === "session") continue;
      expect(opts.HostConfig?.RestartPolicy, name).toBeUndefined();
    }
  });
});

describe("network isolation", () => {
  // The docker-socket-proxy accepts POST /containers/create and does not vet
  // request bodies, so any container that can reach it can bind-mount / and take
  // the host. EVERY container this adapter creates must therefore be pinned to
  // the agents network (which the proxy is not on) — including the short-lived
  // helpers, which need no network at all: omitting NetworkMode would silently
  // drop them on Docker's default bridge, safe only by accident.
  const cloneSpec: CloneContainerSpec = {
    sessionName: "demo",
    repo: "octocat/hello",
    accountId: "acc-1",
    workspaceVolume: "cc-remote-workspace-demo",
    env: {},
    labels: {},
  };
  const builders = [
    ["session", buildSessionCreateOptions(sessionSpec, config)],
    ["clone", buildCloneCreateOptions(cloneSpec, config)],
    ["login", buildLoginCreateOptions(loginSpec, config)],
    ["seed", buildSeedCreateOptions("vol", ".claude.json", "{}", config)],
    ["has-credentials", buildHasCredentialsCreateOptions("vol", config)],
  ] as const;

  it.each(builders)("%s container is pinned to the configured agents network", (_, opts) => {
    expect(opts.HostConfig?.NetworkMode).toBe("cc-remote-agents");
  });
});

describe("compose ownership neutralization", () => {
  // The agent image is built by `docker compose build`, which bakes
  // com.docker.compose.project/service labels into the image. Containers
  // inherit image labels, so without an override compose treats every sibling
  // container as a replica of the claude-agent service (replicas: 0) and a
  // `docker compose up/down --remove-orphans` would stop or delete live
  // Sessions. Inherited labels can't be removed, only overridden — every
  // builder must blank them out.
  const cloneSpec: CloneContainerSpec = {
    sessionName: "demo",
    repo: "octocat/hello",
    accountId: "acc-1",
    workspaceVolume: "cc-remote-workspace-demo",
    env: {},
    labels: { "cc-remote-session": "true", "cc-remote-cloning": "true" },
  };
  const builders = [
    ["session", buildSessionCreateOptions(sessionSpec, config)],
    ["clone", buildCloneCreateOptions(cloneSpec, config)],
    ["login", buildLoginCreateOptions(loginSpec, config)],
    ["seed", buildSeedCreateOptions("vol", ".claude.json", "{}", config)],
    ["has-credentials", buildHasCredentialsCreateOptions("vol", config)],
  ] as const;

  it.each(builders)("%s container blanks the inherited compose project labels", (_, opts) => {
    expect(opts.Labels?.["com.docker.compose.project"]).toBe("");
    expect(opts.Labels?.["com.docker.compose.service"]).toBe("");
    expect(opts.Labels?.["com.docker.compose.version"]).toBe("");
  });

  it("keeps the domain labels alongside the overrides", () => {
    const session = buildSessionCreateOptions(sessionSpec, config);
    expect(session.Labels).toMatchObject(sessionSpec.labels);
  });
});
