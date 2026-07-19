// ContainerEngine — the port over the Docker half. Shaped by what the session
// and account use cases need, NOT a mirror of dockerode. The Docker adapter
// (#13) maps session names to `cc-remote-session-<name>` / clone containers and
// enforces the `cc-remote-session` label guard: reads only ever surface
// labelled containers, so a use case cannot touch arbitrary host containers.

import type { LoginContainer } from "../domain/login";
import type { SessionContainer } from "../domain/session";
import type { WorkspaceGitProbe } from "../domain/workspace-state";

/** Spec for the clone-helper container (first phase of session creation). */
export type CloneContainerSpec = {
  sessionName: string;
  repo: string;
  accountId: string;
  workspaceVolume: string;
  env: Record<string, string>;
  labels: Record<string, string>;
};

/** Spec for the main agent container (second phase). */
export type SessionContainerSpec = {
  sessionName: string;
  repo: string;
  accountId: string;
  workspaceVolume: string;
  env: Record<string, string>;
  labels: Record<string, string>;
  /** Account Config Volume to mount — every Account owns one. */
  accountConfigVolume: string;
  remoteControl: boolean;
};

/**
 * Spec for a Login Container (#14): the ephemeral OAuth-login terminal. It
 * mounts ONLY the Account Config Volume — no workspace, no repo, no
 * GITHUB_TOKEN — so nothing but the login itself can happen inside it.
 */
export type LoginContainerSpec = {
  accountId: string;
  accountConfigVolume: string;
  labels: Record<string, string>;
};

/** Where a live log follow delivers its output. */
export type LogSink = {
  onChunk(text: string): void;
  onError(error: Error): void;
  /** The container's stream ended (it exited, or Docker closed the follow). */
  onEnd(): void;
};

/** Handle on a live follow. `close()` is idempotent and stops the stream. */
export type LogFollow = { close(): void };

export interface ContainerEngine {
  /** All session-labelled containers (main + clone helpers). */
  listSessionContainers(): Promise<SessionContainer[]>;
  /** The session-labelled container for `name` (main, else clone), or null. */
  getSessionContainer(name: string): Promise<SessionContainer | null>;

  /** Create and start the clone-helper container. */
  runCloneContainer(spec: CloneContainerSpec): Promise<void>;
  /** Wait for the clone helper to exit; resolves with its exit code. */
  awaitCloneExit(sessionName: string): Promise<number>;
  /** Remove the clone-helper container (after a successful clone). */
  removeCloneContainer(sessionName: string): Promise<void>;

  /** Create and start the main agent container. */
  runSessionContainer(spec: SessionContainerSpec): Promise<void>;
  startContainer(sessionName: string): Promise<void>;
  stopContainer(sessionName: string): Promise<void>;
  removeContainer(sessionName: string): Promise<void>;

  /**
   * Probe the git state of `/workspace` inside the running session container
   * (the uncommitted-work guard, I2). Execs `git status --porcelain` + an
   * ahead-of-upstream count as the unprivileged `node` user and returns the raw
   * capture; the domain (`parseWorkspaceProbe`) interprets it. Only ever called
   * for a running main container — the use case handles the stopped case without
   * touching this.
   */
  probeWorkspaceGit(sessionName: string): Promise<WorkspaceGitProbe>;

  /**
   * Tail the container output of a session, for diagnosing one that did not come
   * up. Resolves main-else-clone-helper (like `getSessionContainer`) under the
   * same label guard, and works for a stopped/exited container — that is the
   * case it exists for. Returns decoded text: the adapter owns Docker's stream
   * framing, the core never sees a byte of it.
   */
  readSessionLogs(sessionName: string, options: { tail: number }): Promise<string>;

  /**
   * Follow a session's container output live: replay the last `tail` lines, then
   * push new output to `sink` as the container produces it. Same main-else-clone
   * resolution and label guard as `readSessionLogs` — watching a clone helper
   * fail in real time is a first-class case.
   *
   * The returned handle MUST tear the underlying stream down on `close()`: one
   * leaked follow per modal open is a real resource bug on a long-running server.
   * Text reaching the sink is already free of Docker's stream framing; ANSI
   * sanitizing is the core's job, so chunks may still contain escapes.
   */
  followSessionLogs(
    sessionName: string,
    options: { tail: number },
    sink: LogSink,
  ): Promise<LogFollow>;

  /** Create and start the Login Container for an Account (#14). */
  runLoginContainer(spec: LoginContainerSpec): Promise<void>;
  /** The Login Container for `accountId`, or null (idempotent re-entry/recovery). */
  getLoginContainer(accountId: string): Promise<LoginContainer | null>;
  /** All login-labelled containers — for restart recovery (rediscover by label). */
  listLoginContainers(): Promise<LoginContainer[]>;
  /** Remove the Login Container for `accountId` (idempotent). */
  removeLoginContainer(accountId: string): Promise<void>;

  createVolume(name: string): Promise<void>;
  removeVolume(name: string): Promise<void>;
  /** Write `content` to `filePath` inside a volume (Seeding Method). */
  seedVolume(volumeName: string, filePath: string, content: string): Promise<void>;
  /** Whether credentials have appeared in an Account Config Volume. */
  hasCredentials(volumeName: string): Promise<boolean>;
  /** Find a session's name and repository by its CC_BROKER_SECRET. */
  findSessionBySecret(secret: string): Promise<{ sessionName: string; repo: string } | null>;
}
