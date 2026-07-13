// DockerContainerEngine — the ContainerEngine port over dockerode, talking to
// the docker-socket-proxy (never the raw socket in production). Deliberately
// thin: all branching/mapping lives in the pure builders (container-specs.ts)
// and container-mapping.ts, both unit-tested in CI. This file only issues
// dockerode calls and is exercised by the local integration script
// (test/docker-smoke.mjs) against a real daemon — NOT in CI (no Docker there).

import Docker from "dockerode";
import type {
  CloneContainerSpec,
  ContainerEngine,
  LogFollow,
  LoginContainer,
  LoginContainerSpec,
  LogSink,
  SessionContainer,
  SessionContainerSpec,
  WorkspaceGitProbe,
} from "../../core";
import { SessionNotFoundError, WORKSPACE_PROBE_SEPARATOR } from "../../core";
import { configFromEnv, type DockerAdapterConfig, WORKSPACE_MOUNT } from "./config";
import {
  cloneContainerName,
  decodeDockerLogs,
  isLoginLabelled,
  isSessionLabelled,
  loginContainerName,
  mainContainerName,
  parseExitCode,
  toLoginContainer,
  toSessionContainer,
} from "./container-mapping";
import {
  buildCloneCreateOptions,
  buildHasCredentialsCreateOptions,
  buildLoginCreateOptions,
  buildSeedCreateOptions,
  buildSessionCreateOptions,
} from "./container-specs";
import { createDockerLogDecoder } from "./docker-log-decoder";

function isNotFound(err: unknown): boolean {
  return (
    typeof err === "object" && err !== null && (err as { statusCode?: number }).statusCode === 404
  );
}

/**
 * dockerode's `.stop()` rejects with HTTP 304 when Docker considers the
 * container already stopped. The core's `stop-session` use case already
 * skips the call for a container it knows is stopped (`isAlreadyStopped`),
 * but that check and this one race: the container can exit on its own (crash,
 * OOM) in the gap between the use case's `getSessionContainer` inspect and
 * this `.stop()` call. That race cannot be closed in core, so the adapter
 * swallows ONLY a 304 here — the desired end state (not running) already
 * holds, so it is a success, not an error. Every other status propagates.
 */
function isAlreadyStoppedError(err: unknown): boolean {
  return (
    typeof err === "object" && err !== null && (err as { statusCode?: number }).statusCode === 304
  );
}

/**
 * The workspace git probe (I2). Runs as the unprivileged `node` user (via the
 * exec `User`): `git status --porcelain`, a separator line, then the count of
 * commits ahead of `@{upstream}` (which fails silently with no upstream, leaving
 * an empty ahead-block). A non-git or missing `/workspace` exits non-zero, which
 * the domain maps to "unknown". The separator is the domain's constant so the
 * pure parser (`parseWorkspaceProbe`) and this command never drift.
 */
const WORKSPACE_PROBE_CMD = [
  `git -C ${WORKSPACE_MOUNT} rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 3`,
  `git -C ${WORKSPACE_MOUNT} status --porcelain`,
  `printf '%s\\n' '${WORKSPACE_PROBE_SEPARATOR}'`,
  `git -C ${WORKSPACE_MOUNT} rev-list --count @{upstream}..HEAD 2>/dev/null || true`,
].join("\n");

/** Drain a dockerode exec (TTY) stream to a single UTF-8 string. */
function collectStream(stream: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    stream.on("error", reject);
  });
}

export class DockerContainerEngine implements ContainerEngine {
  constructor(
    private readonly docker: Docker,
    private readonly config: DockerAdapterConfig,
  ) {}

  async listSessionContainers(): Promise<SessionContainer[]> {
    const containers = await this.docker.listContainers({ all: true });
    return containers
      .filter((c) => isSessionLabelled(c.Labels))
      .map((c) =>
        toSessionContainer({
          labels: c.Labels,
          state: c.State,
          // The list endpoint has no exit-code field; its human-readable
          // `Status` ("Exited (137) 2 minutes ago") is the only carrier.
          exitCode: parseExitCode(c.Status),
        }),
      );
  }

  async getSessionContainer(name: string): Promise<SessionContainer | null> {
    const found = await this.inspectSession(name);
    if (!found) return null;
    return toSessionContainer({
      labels: found.Config.Labels ?? {},
      // An OOM kill exits 137 — indistinguishable, by the signal rule, from the
      // SIGKILL that a normal `docker stop` leaves. But it IS a failure, so we
      // report the state as `dead` (which the domain maps to `error`) rather
      // than letting the kernel's kill masquerade as a user's stop. `inspect`
      // is the only path that can see this; the list endpoint cannot.
      state: found.State.OOMKilled ? "dead" : found.State.Status,
      exitCode: found.State.ExitCode,
    });
  }

  async runCloneContainer(spec: CloneContainerSpec): Promise<void> {
    const container = await this.docker.createContainer(buildCloneCreateOptions(spec, this.config));
    await container.start();
  }

  async awaitCloneExit(sessionName: string): Promise<number> {
    const container = this.docker.getContainer(cloneContainerName(sessionName));
    const result = await container.wait();
    return result.StatusCode;
  }

  async removeCloneContainer(sessionName: string): Promise<void> {
    await this.removeIfPresent(cloneContainerName(sessionName));
  }

  async runSessionContainer(spec: SessionContainerSpec): Promise<void> {
    const container = await this.docker.createContainer(
      buildSessionCreateOptions(spec, this.config),
    );
    await container.start();
  }

  async startContainer(sessionName: string): Promise<void> {
    await this.guardedSession(sessionName).start();
  }

  async stopContainer(sessionName: string): Promise<void> {
    try {
      await this.guardedSession(sessionName).stop();
    } catch (err) {
      if (!isAlreadyStoppedError(err)) throw err;
    }
  }

  async removeContainer(sessionName: string): Promise<void> {
    await this.guardedSession(sessionName).remove({ force: true });
  }

  async probeWorkspaceGit(sessionName: string): Promise<WorkspaceGitProbe> {
    const container = this.docker.getContainer(mainContainerName(sessionName));
    const exec = await container.exec({
      Cmd: ["sh", "-c", WORKSPACE_PROBE_CMD],
      AttachStdout: true,
      AttachStderr: true,
      Tty: true,
      User: "node",
    });
    const stream = await exec.start({ Tty: true });
    const output = await collectStream(stream as unknown as NodeJS.ReadableStream);
    const info = await exec.inspect();
    return { exitCode: info.ExitCode ?? 1, output };
  }

  /**
   * Tail a session's container output. Resolves the same main-else-clone target
   * as `getSessionContainer`, under the same label guard (`inspectSession`), so
   * this read can never reach an unlabelled host container. `follow: false`
   * makes dockerode buffer the whole response, which works for an exited
   * container — the case the feature exists for.
   */
  async readSessionLogs(sessionName: string, options: { tail: number }): Promise<string> {
    const info = await this.inspectSession(sessionName);
    if (!info) throw new SessionNotFoundError(sessionName);

    const buffer = (await this.docker.getContainer(info.Id).logs({
      stdout: true,
      stderr: true,
      tail: options.tail,
      timestamps: false,
      follow: false,
    })) as unknown as Buffer;

    return decodeDockerLogs(Buffer.from(buffer));
  }

  /**
   * Follow a session's container output live. Same label-guarded main-else-clone
   * target as the one-shot read; `follow: true` makes dockerode hand back a live
   * Readable instead of a buffer.
   *
   * Two things this must not get wrong:
   *
   *   - The wire format. We do NOT sniff it here — the container's own `Tty` flag
   *     says which one Docker will send, and a follow's chunk boundaries fall
   *     wherever they like, so the decoder is stateful (docker-log-decoder.ts).
   *   - Teardown. `close()` destroys the socket and detaches the listeners, so a
   *     closed modal (or a disconnected SSE client) leaves nothing behind. Docker
   *     keeps a `follow` stream open for the life of the container, so leaking one
   *     per modal open would accumulate sockets on a long-running server.
   */
  async followSessionLogs(
    sessionName: string,
    options: { tail: number },
    sink: LogSink,
  ): Promise<LogFollow> {
    const info = await this.inspectSession(sessionName);
    if (!info) throw new SessionNotFoundError(sessionName);

    const stream = (await this.docker.getContainer(info.Id).logs({
      stdout: true,
      stderr: true,
      tail: options.tail,
      timestamps: false,
      follow: true,
    })) as unknown as NodeJS.ReadableStream & { destroy?: () => void };

    const decoder = createDockerLogDecoder(info.Config.Tty === true);
    let closed = false;

    const close = () => {
      if (closed) return;
      closed = true;
      stream.removeAllListeners();
      stream.destroy?.();
    };

    stream.on("data", (chunk: Buffer) => {
      const text = decoder.push(chunk);
      if (text !== "") sink.onChunk(text);
    });
    stream.on("error", (error: Error) => {
      if (!closed) sink.onError(error);
    });
    stream.on("end", () => {
      if (closed) return;
      const rest = decoder.flush();
      if (rest !== "") sink.onChunk(rest);
      sink.onEnd();
    });

    return { close };
  }

  async runLoginContainer(spec: LoginContainerSpec): Promise<void> {
    const container = await this.docker.createContainer(buildLoginCreateOptions(spec, this.config));
    await container.start();
  }

  async getLoginContainer(accountId: string): Promise<LoginContainer | null> {
    try {
      const info = await this.docker.getContainer(loginContainerName(accountId)).inspect();
      if (!isLoginLabelled(info.Config.Labels)) return null;
      return toLoginContainer({ labels: info.Config.Labels ?? {}, state: info.State.Status });
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async listLoginContainers(): Promise<LoginContainer[]> {
    const containers = await this.docker.listContainers({ all: true });
    return containers
      .filter((c) => isLoginLabelled(c.Labels))
      .map((c) => toLoginContainer({ labels: c.Labels, state: c.State }));
  }

  async removeLoginContainer(accountId: string): Promise<void> {
    await this.removeIfPresent(loginContainerName(accountId));
  }

  async createVolume(name: string): Promise<void> {
    // Idempotent in the Engine API: creating an existing volume returns it.
    await this.docker.createVolume({ Name: name });
  }

  async removeVolume(name: string): Promise<void> {
    try {
      await this.docker.getVolume(name).remove({ force: true });
    } catch (err) {
      if (!isNotFound(err)) throw err;
    }
  }

  async seedVolume(volumeName: string, filePath: string, content: string): Promise<void> {
    const exitCode = await this.runHelper(
      buildSeedCreateOptions(volumeName, filePath, content, this.config),
    );
    if (exitCode !== 0) {
      throw new Error(`Seeding ${filePath} into ${volumeName} failed (exit ${exitCode}).`);
    }
  }

  async hasCredentials(volumeName: string): Promise<boolean> {
    const exitCode = await this.runHelper(
      buildHasCredentialsCreateOptions(volumeName, this.config),
    );
    return exitCode === 0;
  }

  // --- internals ----------------------------------------------------------

  /** Inspect the main container, falling back to the clone helper; null if absent
   *  or (defence in depth) missing the session marker label. */
  private async inspectSession(name: string): Promise<Docker.ContainerInspectInfo | null> {
    for (const containerName of [mainContainerName(name), cloneContainerName(name)]) {
      try {
        const info = await this.docker.getContainer(containerName).inspect();
        if (!isSessionLabelled(info.Config.Labels)) return null;
        return info;
      } catch (err) {
        if (!isNotFound(err)) throw err;
      }
    }
    return null;
  }

  /** Resolve the main session container by name, enforcing the label guard. */
  private guardedSession(name: string): Docker.Container {
    // Callers (start/stop/remove) reach here only after the use case confirmed
    // the container exists via getSessionContainer, so a direct handle is safe;
    // the label guard still lives in inspectSession for the read path.
    return this.docker.getContainer(mainContainerName(name));
  }

  private async removeIfPresent(containerName: string): Promise<void> {
    try {
      await this.docker.getContainer(containerName).remove({ force: true });
    } catch (err) {
      if (!isNotFound(err)) throw err;
    }
  }

  /** Run a short-lived helper container to completion and return its exit code. */
  private async runHelper(options: Docker.ContainerCreateOptions): Promise<number> {
    const container = await this.docker.createContainer(options);
    try {
      await container.start();
      const result = await container.wait();
      return result.StatusCode;
    } finally {
      try {
        await container.remove({ force: true });
      } catch {
        // Best-effort cleanup; a leaked helper must not mask the real result.
      }
    }
  }
}

/** Build a DockerContainerEngine from environment configuration. */
export function createDockerContainerEngine(
  env: NodeJS.ProcessEnv = process.env,
): DockerContainerEngine {
  const config = configFromEnv(env);
  const docker = new Docker(config.host);
  return new DockerContainerEngine(docker, config);
}
