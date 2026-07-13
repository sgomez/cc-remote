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
import { makeReadSessionLogs, SessionNotFoundError, wizardSkipConfig } from "../src/core";

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

// --- session logs ----------------------------------------------------------
// The feature exists for containers that are NOT running, so these drive the
// real adapter against real exited containers. They also pin down Docker's two
// wire formats: our session containers are created with `Tty: true` (raw bytes),
// while a non-TTY container returns an 8-byte-framed stream — the decoder must
// strip that framing rather than leak header bytes into the user's log panel.

const LOG_SESSION = `it-logs-${suffix}`;
const CLONE_SESSION = `it-clone-${suffix}`;
const UNLABELLED_SESSION = `it-bare-${suffix}`;

/** Frame-header bytes: what leaks into the text if the decoding is wrong. */
const NUL = "\u0000";
const SOH = "\u0001";

/** Run a throwaway container to completion, so it has logs but no life. */
async function runToExit(opts: {
  name: string;
  script: string;
  labels: Record<string, string>;
  tty: boolean;
}): Promise<void> {
  const c = await docker.createContainer({
    name: opts.name,
    Image: config.agentImage,
    Tty: opts.tty,
    Entrypoint: [],
    Cmd: ["sh", "-c", opts.script],
    Labels: opts.labels,
  });
  await c.start();
  await c.wait();
}

function sessionLabels(name: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    "cc-remote-session": "true",
    "cc-remote-session-name": name,
    "cc-remote-repo": "octocat/Hello-World",
    "cc-remote-account-id": `it-${suffix}`,
    ...extra,
  };
}

suite("DockerContainerEngine.readSessionLogs (real daemon)", () => {
  afterAll(async () => {
    for (const name of [
      `cc-remote-session-${LOG_SESSION}`,
      `cc-remote-session-clone-${CLONE_SESSION}`,
      `cc-remote-session-${UNLABELLED_SESSION}`,
    ]) {
      await docker
        .getContainer(name)
        .remove({ force: true })
        .catch(() => {});
    }
  });

  // The headline case: the container crashed, so there is no terminal to attach
  // to — its logs are the only evidence of why.
  it("reads the logs of a CRASHED (exited) session container, clean of framing bytes", async () => {
    await runToExit({
      name: `cc-remote-session-${LOG_SESSION}`,
      script: "echo 'entrypoint: starting'; echo 'fatal: boom' >&2; exit 1",
      labels: sessionLabels(LOG_SESSION),
      tty: true, // what container-specs.ts actually creates
    });

    const text = await engine.readSessionLogs(LOG_SESSION, { tail: 300 });

    expect(text).toContain("entrypoint: starting");
    expect(text).toContain("fatal: boom");
    expect(text).not.toContain(NUL);
    expect(text).not.toContain(SOH);
  });

  // Robustness against the OTHER wire format: a non-TTY container really is
  // multiplexed by Docker, so this proves the de-framing on live bytes.
  it("de-multiplexes a real non-TTY container's framed log stream", async () => {
    const name = `cc-remote-session-${LOG_SESSION}`;
    await docker
      .getContainer(name)
      .remove({ force: true })
      .catch(() => {});
    await runToExit({
      name,
      script: "echo 'stdout line'; echo 'stderr line' >&2; exit 2",
      labels: sessionLabels(LOG_SESSION),
      tty: false, // Docker frames this one
    });

    const text = await engine.readSessionLogs(LOG_SESSION, { tail: 300 });

    expect(text).toContain("stdout line");
    expect(text).toContain("stderr line");
    expect(text).not.toContain(NUL);
    expect(text).not.toContain(SOH);
    // The header would otherwise render as a control char before the text.
    expect(text.trimStart().startsWith("stdout line")).toBe(true);
  });

  // A clone_failed session's ONLY container is the helper: its logs are the git
  // error, and the use case must fall back to it.
  it("falls back to the clone helper's logs when no main container exists", async () => {
    await runToExit({
      name: `cc-remote-session-clone-${CLONE_SESSION}`,
      script: "echo \"fatal: repository 'https://github.com/o/nope' not found\" >&2; exit 128",
      labels: sessionLabels(CLONE_SESSION, { "cc-remote-cloning": "true" }),
      tty: true,
    });

    const logs = await makeReadSessionLogs({ engine })({ name: CLONE_SESSION });

    expect(logs.text).toContain("fatal: repository");
    expect(logs.text).toContain("not found");
    // Tagged as the clone's output, not the agent's.
    expect(logs.source).toBe("clone");
  });

  // Security: the label guard is what stops this read reaching an arbitrary
  // container on the host, even one squatting the session naming convention.
  it("refuses a container that carries no cc-remote-session label", async () => {
    await runToExit({
      name: `cc-remote-session-${UNLABELLED_SESSION}`,
      script: "echo 'output that must not be readable'",
      labels: {}, // no marker label
      tty: true,
    });

    await expect(engine.readSessionLogs(UNLABELLED_SESSION, { tail: 300 })).rejects.toThrow(
      SessionNotFoundError,
    );
  });

  it("reports a missing session rather than reading nothing", async () => {
    await expect(engine.readSessionLogs(`ghost-${suffix}`, { tail: 300 })).rejects.toThrow(
      SessionNotFoundError,
    );
  });
});
