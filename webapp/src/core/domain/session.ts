// Session — one agent container plus its workspace volume, derived from Docker
// (the source of truth) via the ContainerEngine port. The domain never
// persists Sessions; it only computes their names, labels, and derived status.

import { InvalidRepoError, InvalidSessionNameError } from "./errors";

/**
 * Docker's container lifecycle, as a closed domain vocabulary. The adapter maps
 * the engine's raw string here exactly once (`toContainerState`), so core never
 * branches on Docker's own words and an engine state we don't know about lands
 * on `unknown` instead of being silently read as "stopped".
 */
export type ContainerState =
  | "running"
  | "created"
  | "restarting"
  | "paused"
  | "removing"
  | "exited"
  | "dead"
  | "unknown";

/**
 * A Session's status. Wider than Docker's binary running/not-running so the UI
 * can tell a crashed agent apart from one the user stopped on purpose: `error`
 * means the container died on its own, `stopped` means it was asked to.
 */
export type SessionStatus =
  | "running"
  | "starting"
  | "restarting"
  | "paused"
  | "stopped"
  | "error"
  | "cloning"
  | "clone_failed"
  | "unknown";

export type Session = {
  name: string;
  repo: string;
  accountId: string;
  status: SessionStatus;
};

/**
 * A session-labelled container as reported by the ContainerEngine. `cloning`
 * marks the two-phase clone-helper container. `exitCode` is only meaningful
 * once `state` is `exited`, and is what separates a deliberate stop from a
 * crash (see `toSessionStatus`).
 */
export type SessionContainer = {
  name: string;
  repo: string;
  accountId: string;
  state: ContainerState;
  exitCode?: number | null;
  cloning: boolean;
};

// Equivalent to legacy NAME_REGEX / REPO_REGEX (from the legacy web-manager on
// branch feat/providers-and-console) — the boundary that keeps names safe to
// interpolate into container/volume names and shell commands.
const NAME_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;
const REPO_REGEX = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;

export const SESSION_LABELS = {
  marker: "cc-remote-session",
  name: "cc-remote-session-name",
  repo: "cc-remote-repo",
  accountId: "cc-remote-account-id",
  cloning: "cc-remote-cloning",
} as const;

export function isValidSessionName(name: string): boolean {
  return NAME_REGEX.test(name);
}

export function isValidRepo(repo: string): boolean {
  return REPO_REGEX.test(repo);
}

export function assertValidSessionName(name: string): void {
  if (!isValidSessionName(name)) throw new InvalidSessionNameError(name);
}

export function assertValidRepo(repo: string): void {
  if (!isValidRepo(repo)) throw new InvalidRepoError(repo);
}

export function workspaceVolumeName(name: string): string {
  return `cc-remote-workspace-${name}`;
}

export function buildSessionLabels(input: {
  name: string;
  repo: string;
  accountId: string;
}): Record<string, string> {
  return {
    [SESSION_LABELS.marker]: "true",
    [SESSION_LABELS.name]: input.name,
    [SESSION_LABELS.repo]: input.repo,
    [SESSION_LABELS.accountId]: input.accountId,
  };
}

export function buildCloneLabels(input: {
  name: string;
  repo: string;
  accountId: string;
}): Record<string, string> {
  return {
    ...buildSessionLabels(input),
    [SESSION_LABELS.cloning]: "true",
  };
}

/**
 * Exit codes at or above 128 mean the process was terminated by a signal
 * (128 + signal number): 143 = SIGTERM (a PID1 that exits on `docker stop`),
 * 137 = SIGKILL (what `docker stop` falls back to when PID1 ignores SIGTERM —
 * the agent's common case). A crash leaves its own small code instead (1..127).
 */
const SIGNAL_EXIT_FLOOR = 128;

function wasSignalled(exitCode: number): boolean {
  return exitCode >= SIGNAL_EXIT_FLOOR;
}

/**
 * Derive a Session status from a labelled container. The single derivation
 * point: every surface (the list, the SSE stream, the account detail rows)
 * comes through here, so a Session can never be described two ways.
 *
 * The two branches are deliberately asymmetric on a signalled exit:
 * a *stopped agent is normal* (the user asked for it — `docker stop` routinely
 * leaves 137, and calling that "error" would be a worse regression than the bug
 * this fixes), but a *killed clone is not* (the helper never finished cloning,
 * however it died).
 */
export function toSessionStatus(container: SessionContainer): SessionStatus {
  const { state, exitCode } = container;

  if (container.cloning) {
    // Terminal failure only: a non-zero exit, or a container Docker could not
    // kill. Everything else — created / running / restarting / paused /
    // removing / exited(0) — is the helper still on its happy path. It is
    // briefly `created` and then `removing` between the 1s status ticks, and
    // reporting those as clone_failed is the false red flash we're killing.
    if (state === "dead") return "clone_failed";
    if (state === "exited" && exitCode != null && exitCode !== 0) return "clone_failed";
    return "cloning";
  }

  switch (state) {
    case "running":
      return "running";
    case "created":
      return "starting";
    case "restarting":
      return "restarting";
    case "paused":
      return "paused";
    // Teardown in flight: the container is on its way out, not broken.
    case "removing":
      return "stopped";
    // Docker failed to kill it — the container is wedged, not stopped.
    case "dead":
      return "error";
    case "exited":
      // No exit code to read: degrade to `stopped`. Never cry wolf on missing
      // data — a spurious "error" trains the user to ignore the real one.
      if (exitCode == null) return "stopped";
      if (exitCode === 0 || wasSignalled(exitCode)) return "stopped";
      return "error";
    default:
      return "unknown";
  }
}
