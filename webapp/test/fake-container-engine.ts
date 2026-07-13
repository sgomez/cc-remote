// Honest in-memory ContainerEngine. Models the Docker half the core cares
// about: session-labelled containers (main + clone helper), volumes, seeded
// files and detected credentials. Reused by later sub-issues, so it implements
// the real port contract rather than asserting call shapes.

import type { LoginContainer } from "../src/core/domain/login";
import type { ContainerState, SessionContainer } from "../src/core/domain/session";
import type { WorkspaceGitProbe } from "../src/core/domain/workspace-state";
import type {
  CloneContainerSpec,
  ContainerEngine,
  LogFollow,
  LoginContainerSpec,
  LogSink,
  SessionContainerSpec,
} from "../src/core/ports/container-engine";

type Container = SessionContainer;

export class FakeContainerEngine implements ContainerEngine {
  private readonly main = new Map<string, Container>();
  private readonly clones = new Map<string, Container>();
  readonly volumes = new Set<string>();
  /** volume name -> (file path -> content). */
  readonly seededFiles = new Map<string, Map<string, string>>();
  private readonly credentialed = new Set<string>();
  /** accountId -> Login Container (its own label space, separate from sessions). */
  private readonly logins = new Map<string, LoginContainer>();
  /** Exit code the next `awaitCloneExit` reports. */
  nextCloneExit = 0;
  /**
   * What the next `probeWorkspaceGit` yields: a raw probe, or an Error to throw
   * (models an exec/infra failure). Defaults to a clean probe.
   */
  nextWorkspaceProbe: WorkspaceGitProbe | Error = {
    exitCode: 0,
    output: "--cc-remote-git-ahead--\n",
  };
  /** Session names `probeWorkspaceGit` was called with, for assertions. */
  readonly probedWorkspaces: string[] = [];
  /**
   * What the next `readSessionLogs` yields: decoded log text, or an Error to
   * throw (models an unreadable container — the read path must stay honest
   * about a failure rather than render an empty box).
   */
  nextSessionLogs: string | Error = "";
  /** Log reads the use cases performed, for assertions. */
  readonly logReads: { sessionName: string; tail: number }[] = [];
  /** Live follows the use cases opened, for assertions (and for driving them). */
  readonly logFollows: {
    sessionName: string;
    tail: number;
    sink: LogSink;
    closed: boolean;
  }[] = [];
  /** Error the next `followSessionLogs` throws instead of opening a stream. */
  nextFollowError: Error | null = null;
  /** Records specs the use cases passed, for assertions. */
  readonly runSessionSpecs: SessionContainerSpec[] = [];
  readonly runCloneSpecs: CloneContainerSpec[] = [];
  readonly runLoginSpecs: LoginContainerSpec[] = [];

  // --- test helpers -------------------------------------------------------

  /** Simulate a running main session container already existing. */
  seedRunningSession(c: { name: string; repo: string; accountId: string }): void {
    this.main.set(c.name, { ...c, state: "running", cloning: false });
  }

  /**
   * Simulate a main container in an arbitrary lifecycle state — a crash
   * (`exited` + a small non-zero code), a deliberate stop (`exited` + 137/143),
   * a paused or restarting container — so use cases and status derivation can
   * be exercised beyond the running/stopped binary.
   */
  seedSession(c: {
    name: string;
    repo: string;
    accountId: string;
    state: ContainerState;
    exitCode?: number | null;
  }): void {
    this.main.set(c.name, { ...c, cloning: false });
  }

  /** Simulate a session mid-clone: only the running clone helper exists yet. */
  seedCloningSession(c: {
    name: string;
    repo: string;
    accountId: string;
    state?: ContainerState;
    exitCode?: number | null;
  }): void {
    const { state = "running", ...rest } = c;
    this.clones.set(c.name, { ...rest, state, cloning: true });
  }

  /** Simulate credentials appearing in an Account Config Volume. */
  putCredentials(volumeName: string): void {
    this.credentialed.add(volumeName);
  }

  hasVolume(name: string): boolean {
    return this.volumes.has(name);
  }

  /** Whether a Login Container currently exists for an account. */
  hasLoginContainer(accountId: string): boolean {
    return this.logins.has(accountId);
  }

  /** Simulate an orphaned Login Container surviving a web-manager restart. */
  seedLoginContainer(accountId: string, state = "running"): void {
    this.logins.set(accountId, { accountId, state });
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
    if (clone) {
      clone.state = "exited";
      clone.exitCode = this.nextCloneExit;
    }
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
    if (c) {
      c.state = "running";
      c.exitCode = null;
    }
  }

  async stopContainer(sessionName: string): Promise<void> {
    const c = this.main.get(sessionName);
    if (c) {
      c.state = "exited";
      // What a real `docker stop` leaves on the agent: PID1 doesn't handle
      // SIGTERM, so Docker SIGKILLs it after the timeout (128 + 9).
      c.exitCode = 137;
    }
  }

  async removeContainer(sessionName: string): Promise<void> {
    this.main.delete(sessionName);
  }

  async probeWorkspaceGit(sessionName: string): Promise<WorkspaceGitProbe> {
    this.probedWorkspaces.push(sessionName);
    if (this.nextWorkspaceProbe instanceof Error) throw this.nextWorkspaceProbe;
    return this.nextWorkspaceProbe;
  }

  async readSessionLogs(sessionName: string, options: { tail: number }): Promise<string> {
    this.logReads.push({ sessionName, tail: options.tail });
    if (this.nextSessionLogs instanceof Error) throw this.nextSessionLogs;
    return this.nextSessionLogs;
  }

  async followSessionLogs(
    sessionName: string,
    options: { tail: number },
    sink: LogSink,
  ): Promise<LogFollow> {
    if (this.nextFollowError) throw this.nextFollowError;
    const entry = { sessionName, tail: options.tail, sink, closed: false };
    this.logFollows.push(entry);
    return {
      close() {
        entry.closed = true;
      },
    };
  }

  /** The follow opened last — the handle a test drives output through. */
  get lastFollow() {
    const entry = this.logFollows.at(-1);
    if (!entry) throw new Error("no follow was opened");
    return entry;
  }

  async runLoginContainer(spec: LoginContainerSpec): Promise<void> {
    this.runLoginSpecs.push(spec);
    this.logins.set(spec.accountId, { accountId: spec.accountId, state: "running" });
  }

  async getLoginContainer(accountId: string): Promise<LoginContainer | null> {
    const c = this.logins.get(accountId);
    return c ? { ...c } : null;
  }

  async listLoginContainers(): Promise<LoginContainer[]> {
    return [...this.logins.values()].map((c) => ({ ...c }));
  }

  async removeLoginContainer(accountId: string): Promise<void> {
    this.logins.delete(accountId);
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
