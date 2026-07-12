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

/**
 * Lifecycle actions available for a Session status. Destroy (tear down the
 * container + workspace volume) is always offered — even mid-clone, where it
 * removes the clone helper. A `cloning` session offers nothing else; a
 * `clone_failed` one adds retry; running/stopped get the stop|start / reset set.
 */
export function sessionActions(status: SessionStatus): SessionActions {
  return {
    canStart: status === "stopped",
    canStop: status === "running",
    canReset: status === "running" || status === "stopped",
    canDestroy: true,
    canRetry: status === "clone_failed",
  };
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
  "host-mount": "host mount",
  oauth: "OAuth",
};

export function seedingLabel(seeding: SeedingMethod): string {
  return SEEDING_LABELS[seeding];
}

export type AccountCapabilities = {
  remoteControl: boolean;
  seedingLabel: string;
  singleton: boolean;
};

export function accountCapabilities(type: ProviderType): AccountCapabilities {
  return {
    remoteControl: type.remoteControl,
    seedingLabel: seedingLabel(type.seeding),
    singleton: type.singleton,
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
 * true for claude-local/claude, false for deepseek/custom. This is the single
 * source the panel reads, so the acceptance check ("visibility driven by the
 * catalogue capability, verified for all four provider types") is this function.
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
