// Pure capability/action derivation for the session and account detail screens
// (#16). Which lifecycle buttons a Session offers, whether an Account may be
// deleted and why not, and — the acceptance-critical one — whether the Remote
// Control panel is shown, driven ONLY by the Provider Type catalogue capability
// (never a per-provider `if` in a component). Framework-free, colocated tests.

import type { ProviderType, SeedingMethod, SessionStatus } from "~/core";

export type SessionActions = {
  canStart: boolean;
  canStop: boolean;
  /** Reset = destroy container + workspace volume, re-clone with a fresh UUID. */
  canReset: boolean;
  canDestroy: boolean;
  /** clone_failed offers a retry (re-runs the two-phase clone) instead of reset. */
  canRetry: boolean;
};

// Status -> actions. Destroy is always available (even mid-clone, where it
// removes the clone helper) — no status is ever a dead end. The reasoning per
// row, beyond the running/stopped pair the legacy UI already had:
//
//   - starting:      created but not up yet (Docker "created"). Too early for
//                     stop/reset/start to mean anything sensible — just wait,
//                     or abandon it via destroy.
//   - restarting:    Docker's `unless-stopped` policy is cycling it, possibly
//                     in a crash loop. canStop breaks the loop; canReset
//                     recreates cleanly. No canStart — it's already trying.
//   - paused:        `docker pause`, not a real stop — the process is frozen,
//                     not exited. canStart resumes it, canStop ends it
//                     properly; reset/destroy as usual.
//   - error:         the container exited on its own (crash), the whole point
//                     of U2's status split from `stopped`. It reads like
//                     `stopped` capability-wise — canStart to try again,
//                     canReset for a clean slate — but never canStop (nothing
//                     is running).
//   - cloning:       mid clone-helper provisioning, same as before: destroy
//                     only.
//   - clone_failed:  unchanged — canRetry (re-runs the two-phase clone)
//                     instead of reset, plus destroy.
//   - unknown:       an engine state this build doesn't recognise. Too risky
//                     to assume canStart/canStop are meaningful, but reset
//                     (destroy + recreate unconditionally) always is, so it's
//                     offered — the status is never a dead end short of
//                     destroy.
const ACTIONS_BY_STATUS: Record<SessionStatus, SessionActions> = {
  running: { canStart: false, canStop: true, canReset: true, canDestroy: true, canRetry: false },
  starting: {
    canStart: false,
    canStop: false,
    canReset: false,
    canDestroy: true,
    canRetry: false,
  },
  restarting: { canStart: false, canStop: true, canReset: true, canDestroy: true, canRetry: false },
  paused: { canStart: true, canStop: true, canReset: true, canDestroy: true, canRetry: false },
  stopped: { canStart: true, canStop: false, canReset: true, canDestroy: true, canRetry: false },
  error: { canStart: true, canStop: false, canReset: true, canDestroy: true, canRetry: false },
  cloning: {
    canStart: false,
    canStop: false,
    canReset: false,
    canDestroy: true,
    canRetry: false,
  },
  clone_failed: {
    canStart: false,
    canStop: false,
    canReset: false,
    canDestroy: true,
    canRetry: true,
  },
  unknown: { canStart: false, canStop: false, canReset: true, canDestroy: true, canRetry: false },
};

/**
 * Lifecycle actions available for a Session status. See the table above
 * `ACTIONS_BY_STATUS` for the reasoning behind each row. Falls back to the
 * `unknown` row for a status this build doesn't recognise, for the same
 * runtime-safety reason as {@link import("./badges").sessionStatusBadge} — the
 * status arrives from an SSE stream, not a value TypeScript checked.
 */
export function sessionActions(status: SessionStatus): SessionActions {
  return ACTIONS_BY_STATUS[status] ?? ACTIONS_BY_STATUS.unknown;
}

/** The lifecycle actions rendered in the session detail's action row. */
export type SessionActionKind = "stop" | "start" | "reset" | "destroy";

export type SessionActionButton = {
  action: SessionActionKind;
  /** Normal label, or the progress verb while this action is in flight. */
  label: string;
  /** This action is the one currently running. */
  busy: boolean;
  /** True while ANY action is in flight (so double-submits are blocked). */
  disabled: boolean;
  /** Reset/destroy are gated behind a confirmation dialog. */
  confirm: boolean;
};

const ACTION_LABELS: Record<SessionActionKind, { idle: string; busy: string }> = {
  stop: { idle: "Stop", busy: "Stopping…" },
  start: { idle: "Start", busy: "Starting…" },
  reset: { idle: "Reset", busy: "Resetting…" },
  destroy: { idle: "Destroy", busy: "Destroying…" },
};

const CONFIRM_ACTIONS: ReadonlySet<SessionActionKind> = new Set(["reset", "destroy"]);

/**
 * The action row buttons for a Session status, with the in-flight `busy` action
 * overlaid: the active button shows its progress verb, and while any action is
 * running every button is disabled so a slow container op can't be double-fired.
 * Built on {@link sessionActions} so button visibility stays single-sourced.
 */
export function sessionActionState(
  status: SessionStatus,
  busy: SessionActionKind | null,
): SessionActionButton[] {
  const a = sessionActions(status);
  const order: SessionActionKind[] = ["stop", "start", "reset", "destroy"];
  const visible: Record<SessionActionKind, boolean> = {
    stop: a.canStop,
    start: a.canStart,
    reset: a.canReset,
    destroy: a.canDestroy,
  };
  return order
    .filter((action) => visible[action])
    .map((action) => {
      const isBusy = busy === action;
      return {
        action,
        label: isBusy ? ACTION_LABELS[action].busy : ACTION_LABELS[action].idle,
        busy: isBusy,
        disabled: busy !== null,
        confirm: CONFIRM_ACTIONS.has(action),
      };
    });
}

const SEEDING_LABELS: Record<SeedingMethod, string> = {
  "api-key": "API key",
  oauth: "OAuth",
};

export function seedingLabel(seeding: SeedingMethod): string {
  return SEEDING_LABELS[seeding];
}

export type AccountCapabilities = {
  remoteControl: boolean;
  seedingLabel: string;
};

export function accountCapabilities(type: ProviderType): AccountCapabilities {
  return {
    remoteControl: type.remoteControl,
    seedingLabel: seedingLabel(type.seeding),
  };
}

export type RemoteControlPanel = {
  /** Whether to show the pairing panel — the catalogue capability, verbatim. */
  available: boolean;
  /** Copy for the "not available" case, naming the provider so it's specific. */
  unavailableNote: string;
};

/**
 * Remote Control panel visibility is the Provider Type's `remoteControl` flag —
 * true for claude, false for deepseek/custom. This is the single source the
 * panel reads, so the acceptance check ("visibility driven by the catalogue
 * capability, verified for every provider type") is this function.
 */
export function remoteControlPanel(type: ProviderType): RemoteControlPanel {
  return {
    available: type.remoteControl,
    unavailableNote: `${type.label} does not support Remote Control. Use the web terminal above.`,
  };
}

export type DeleteGuard = {
  deletable: boolean;
  /** Present only when blocked — the reason to surface next to the disabled button. */
  reason?: string;
};

/**
 * Account deletion is refused while Sessions labelled with it exist (Docker is
 * the source of truth for the count; the core use case enforces it too). This
 * derives the UI guard + reason from that count.
 */
export function deleteGuard(sessionsUsing: number): DeleteGuard {
  if (sessionsUsing > 0) {
    const plural = sessionsUsing === 1 ? "session" : "sessions";
    return {
      deletable: false,
      reason: `deletion blocked — destroy its ${sessionsUsing} ${plural} first`,
    };
  }
  return { deletable: true };
}
