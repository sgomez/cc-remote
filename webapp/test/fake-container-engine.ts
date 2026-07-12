// Honest in-memory ContainerEngine. Models the Docker half the core cares
// about: session-labelled containers (main + clone helper), volumes, seeded
// files and detected credentials. Reused by later sub-issues, so it implements
// the real port contract rather than asserting call shapes.

import type { SessionContainer } from "../src/core/domain/session";
import type {
  CloneContainerSpec,
  ContainerEngine,
  SessionContainerSpec,
} from "../src/core/ports/container-engine";

type Container = {
  name: string;
  repo: string;
  accountId: string;
  state: string;
  cloning: boolean;
};

export class FakeContainerEngine implements ContainerEngine {
  private readonly main = new Map<string, Container>();
  private readonly clones = new Map<string, Container>();
  readonly volumes = new Set<string>();
  /** volume name -> (file path -> content). */
  readonly seededFiles = new Map<string, Map<string, string>>();
  private readonly credentialed = new Set<string>();
  /** Exit code the next `awaitCloneExit` reports. */
  nextCloneExit = 0;
  /** Records specs the use cases passed, for assertions. */
  readonly runSessionSpecs: SessionContainerSpec[] = [];
  readonly runCloneSpecs: CloneContainerSpec[] = [];

  // --- test helpers -------------------------------------------------------

  /** Simulate a running main session container already existing. */
  seedRunningSession(c: { name: string; repo: string; accountId: string }): void {
    this.main.set(c.name, { ...c, state: "running", cloning: false });
  }

  /** Simulate credentials appearing in an Account Config Volume. */
  putCredentials(volumeName: string): void {
    this.credentialed.add(volumeName);
  }

  hasVolume(name: string): boolean {
    return this.volumes.has(name);
  }

  // --- port ---------------------------------------------------------------

  async listSessionContainers(): Promise<SessionContainer[]> {
    return [...this.main.values(), ...this.clones.values()].map((c) => ({ ...c }));
  }

  async getSessionContainer(name: string): Promise<SessionContainer | null> {
    const c = this.main.get(name) ?? this.clones.get(name);
    return c ? { ...c } : null;
  }

  async runCloneContainer(spec: CloneContainerSpec): Promise<void> {
    this.runCloneSpecs.push(spec);
    this.clones.set(spec.sessionName, {
      name: spec.sessionName,
      repo: spec.repo,
      accountId: spec.accountId,
      state: "running",
      cloning: true,
    });
  }

  async awaitCloneExit(sessionName: string): Promise<number> {
    const clone = this.clones.get(sessionName);
    if (clone) clone.state = "exited";
    return this.nextCloneExit;
  }

  async removeCloneContainer(sessionName: string): Promise<void> {
    this.clones.delete(sessionName);
  }

  async runSessionContainer(spec: SessionContainerSpec): Promise<void> {
    this.runSessionSpecs.push(spec);
    this.main.set(spec.sessionName, {
      name: spec.sessionName,
      repo: spec.repo,
      accountId: spec.accountId,
      state: "running",
      cloning: false,
    });
  }

  async startContainer(sessionName: string): Promise<void> {
    const c = this.main.get(sessionName);
    if (c) c.state = "running";
  }

  async stopContainer(sessionName: string): Promise<void> {
    const c = this.main.get(sessionName);
    if (c) c.state = "exited";
  }

  async removeContainer(sessionName: string): Promise<void> {
    this.main.delete(sessionName);
  }

  async createVolume(name: string): Promise<void> {
    this.volumes.add(name);
  }

  async removeVolume(name: string): Promise<void> {
    this.volumes.delete(name);
    this.seededFiles.delete(name);
    this.credentialed.delete(name);
  }

  async seedVolume(volumeName: string, filePath: string, content: string): Promise<void> {
    let files = this.seededFiles.get(volumeName);
    if (!files) {
      files = new Map();
      this.seededFiles.set(volumeName, files);
    }
    files.set(filePath, content);
  }

  async hasCredentials(volumeName: string): Promise<boolean> {
    return this.credentialed.has(volumeName);
  }
}
