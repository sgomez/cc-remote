// ContainerEngine — the port over the Docker half. Shaped by what the session
// and account use cases need, NOT a mirror of dockerode. The Docker adapter
// (#13) maps session names to `cc-remote-session-<name>` / clone containers and
// enforces the `cc-remote-session` label guard: reads only ever surface
// labelled containers, so a use case cannot touch arbitrary host containers.

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
  /**
   * Account Config Volume to mount, or null for host-mount (claude-local),
   * where the adapter bind-mounts the host Claude config instead.
   */
  accountConfigVolume: string | null;
  remoteControl: boolean;
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

  createVolume(name: string): Promise<void>;
  removeVolume(name: string): Promise<void>;
  /** Write `content` to `filePath` inside a volume (Seeding Method). */
  seedVolume(volumeName: string, filePath: string, content: string): Promise<void>;
  /** Whether credentials have appeared in an Account Config Volume. */
  hasCredentials(volumeName: string): Promise<boolean>;
}
