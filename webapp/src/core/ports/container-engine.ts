// ContainerEngine — the port over the Docker half. Shaped by what the session
// and account use cases need, NOT a mirror of dockerode. The Docker adapter
// (#13) maps session names to `cc-remote-session-<name>` / clone containers and
// enforces the `cc-remote-session` label guard: reads only ever surface
// labelled containers, so a use case cannot touch arbitrary host containers.

import type { LoginContainer } from "../domain/login";
import type { SessionContainer } from "../domain/session";

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
}
