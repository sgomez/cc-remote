// Integration test for the Docker adapter against a REAL Docker daemon.
// NOT run in CI (no Docker on runners) and NOT collected by `pnpm test` (its
// include is src/**/*.test.ts). Run explicitly:
//
//   RUN_DOCKER_IT=1 pnpm test:docker
//
// Prerequisites (see src/adapters/docker/README.md):
//   - a reachable Docker daemon (DOCKER_HOST unset uses /var/run/docker.sock;
//     in prod it is tcp://docker-socket-proxy:2375);
//   - the agent image built and tagged (AGENT_IMAGE, default
//     `cc-remote-claude-agent`);
//   - AGENT_NETWORK set to a network that exists on the daemon (default
//     `cc-remote_default`; use `bridge` for a plain local daemon).
//
// The clone phase reaches github.com over the network; skip-friendly if offline.

import Docker from "dockerode";
import { afterAll, describe, expect, it } from "vitest";
import { configFromEnv } from "../src/adapters/docker/config";
import { DockerContainerEngine } from "../src/adapters/docker/docker-container-engine";
import { wizardSkipConfig } from "../src/core";

const RUN = process.env.RUN_DOCKER_IT === "1";
const suite = RUN ? describe : describe.skip;

const suffix = Date.now().toString(36);
const SESSION = `it-${suffix}`;
const ACCOUNT_VOL = `cc-remote-account-it-${suffix}`;
const WORKSPACE_VOL = `cc-remote-workspace-${SESSION}`;

const config = configFromEnv({
  ...process.env,
  AGENT_NETWORK: process.env.AGENT_NETWORK || "bridge",
});
const docker = new Docker(config.host);
const engine = new DockerContainerEngine(docker, config);

async function readFileFromVolume(volume: string, path: string): Promise<string> {
  // base64 the file so newlines/CRs in the pretty JSON survive the log stream;
  // strip all whitespace from the (possibly wrapped) base64 before decoding.
  const c = await docker.createContainer({
    Image: config.agentImage,
    Tty: true,
    Entrypoint: [],
    Cmd: ["sh", "-c", `base64 "/vol/${path}"`],
    HostConfig: { Binds: [`${volume}:/vol:ro`] },
  });
  await c.start();
  await c.wait();
  const out = await c.logs({ stdout: true, stderr: true, follow: false });
  await c.remove({ force: true });
  const b64 = Buffer.from(out).toString("utf8").replace(/\s/g, "");
  return Buffer.from(b64, "base64").toString("utf8");
}

suite("DockerContainerEngine (real daemon)", () => {
  afterAll(async () => {
    await engine.removeContainer(SESSION).catch(() => {});
    await engine.removeCloneContainer(SESSION).catch(() => {});
    await engine.removeVolume(WORKSPACE_VOL).catch(() => {});
    await engine.removeVolume(ACCOUNT_VOL).catch(() => {});
  });

  it("creates and seeds an Account Config Volume with the wizard-skip JSON", async () => {
    await engine.createVolume(ACCOUNT_VOL);
    const json = JSON.stringify(wizardSkipConfig("auto"), null, 2);
    await engine.seedVolume(ACCOUNT_VOL, ".claude.json", json);

    const seeded = await readFileFromVolume(ACCOUNT_VOL, ".claude.json");
    expect(JSON.parse(seeded)).toMatchObject({ hasCompletedOnboarding: true });
  });

  it("reports credentials only once the marker file appears", async () => {
    expect(await engine.hasCredentials(ACCOUNT_VOL)).toBe(false);
    await engine.seedVolume(ACCOUNT_VOL, ".claude/.credentials.json", "{}");
    expect(await engine.hasCredentials(ACCOUNT_VOL)).toBe(true);
  });

  it("runs the main session container with correct labels and lists it", async () => {
    await engine.createVolume(WORKSPACE_VOL);
    await engine.runSessionContainer({
      sessionName: SESSION,
      repo: "octocat/Hello-World",
      accountId: `it-${suffix}`,
      workspaceVolume: WORKSPACE_VOL,
      env: { SESSION_NAME: SESSION, PERMISSION_MODE: "auto" },
      labels: {
        "cc-remote-session": "true",
        "cc-remote-session-name": SESSION,
        "cc-remote-repo": "octocat/Hello-World",
        "cc-remote-account-id": `it-${suffix}`,
      },
      accountConfigVolume: ACCOUNT_VOL,
      remoteControl: false,
    });

    const got = await engine.getSessionContainer(SESSION);
    expect(got).toMatchObject({
      name: SESSION,
      repo: "octocat/Hello-World",
      accountId: `it-${suffix}`,
      state: "running",
      cloning: false,
    });

    const list = await engine.listSessionContainers();
    expect(list.some((c) => c.name === SESSION)).toBe(true);

    // Verify the config volume is actually staged inside the container.
    const info = await docker.getContainer(`cc-remote-session-${SESSION}`).inspect();
    const binds = info.HostConfig.Binds ?? [];
    expect(binds).toContain(`${ACCOUNT_VOL}:/home/node/.claude-config`);
  });

  it("stops, starts and destroys the session leaving no container", async () => {
    await engine.stopContainer(SESSION);
    expect((await engine.getSessionContainer(SESSION))?.state).not.toBe("running");
    await engine.startContainer(SESSION);
    expect((await engine.getSessionContainer(SESSION))?.state).toBe("running");

    await engine.removeContainer(SESSION);
    await engine.removeVolume(WORKSPACE_VOL);
    expect(await engine.getSessionContainer(SESSION)).toBeNull();
  });

  it("guards non-session containers: unknown name resolves to null", async () => {
    expect(await engine.getSessionContainer("does-not-exist")).toBeNull();
  });
});
