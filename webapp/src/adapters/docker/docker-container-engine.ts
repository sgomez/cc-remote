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
  SessionContainer,
  SessionContainerSpec,
} from "../../core";
import { configFromEnv, type DockerAdapterConfig } from "./config";
import {
  cloneContainerName,
  isSessionLabelled,
  mainContainerName,
  toSessionContainer,
} from "./container-mapping";
import {
  buildCloneCreateOptions,
  buildHasCredentialsCreateOptions,
  buildSeedCreateOptions,
  buildSessionCreateOptions,
} from "./container-specs";

function isNotFound(err: unknown): boolean {
  return (
    typeof err === "object" && err !== null && (err as { statusCode?: number }).statusCode === 404
  );
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
      .map((c) => toSessionContainer({ labels: c.Labels, state: c.State }));
  }

  async getSessionContainer(name: string): Promise<SessionContainer | null> {
    const found = await this.inspectSession(name);
    if (!found) return null;
    return toSessionContainer({
      labels: found.Config.Labels ?? {},
      state: found.State.Status,
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
    await this.guardedSession(sessionName).stop();
  }

  async removeContainer(sessionName: string): Promise<void> {
    await this.guardedSession(sessionName).remove({ force: true });
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
