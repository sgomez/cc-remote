// Pure status-badge derivation for Sessions and Accounts (#16). The UI shows a
// badge per status with a label, a CSS modifier class (mapped to the legacy
// design tokens in styles), and whether its status dot animates. Kept
// framework-free and colocated with tests so the mapping is verified without a
// DOM — components only spread the result onto markup.

import type { AccountStatus, SessionStatus } from "~/core";

export type StatusBadge = {
  /** Human-facing text. */
  label: string;
  /** CSS modifier appended to `.status-badge` (matches legacy index.css). */
  className: SessionStatus | AccountStatus;
  /** Whether the status dot pulses (running / starting / restarting / cloning). */
  animated: boolean;
};

// "error" is labelled "crashed" rather than the domain word "error": the whole
// point of the wider status vocabulary (U2) is that the UI tells a crashed
// agent apart from one the user stopped on purpose, and "crashed" says that in
// one word without reading Docker logs. `starting`/`restarting` are transient
// like `cloning`, so they pulse too; `paused`/`error`/`unknown` are settled
// (if unhappy) states and don't.
const SESSION_BADGES: Record<SessionStatus, StatusBadge> = {
  running: { label: "running", className: "running", animated: true },
  starting: { label: "starting", className: "starting", animated: true },
  restarting: { label: "restarting", className: "restarting", animated: true },
  paused: { label: "paused", className: "paused", animated: false },
  stopped: { label: "stopped", className: "stopped", animated: false },
  error: { label: "crashed", className: "error", animated: false },
  cloning: { label: "cloning", className: "cloning", animated: true },
  clone_failed: { label: "clone failed", className: "clone_failed", animated: false },
  unknown: { label: "unknown", className: "unknown", animated: false },
};

/**
 * Looks up the badge for a Session status. `status` arrives at runtime from
 * the SSE stream (`api/sessions/status`), which is only type-checked at the
 * server boundary — a value this build doesn't recognise (e.g. a status the
 * engine adapter starts emitting before the UI catches up) must not crash the
 * component, so an unmapped status falls back to the `unknown` badge instead
 * of an `undefined` lookup.
 */
export function sessionStatusBadge(status: SessionStatus): StatusBadge {
  return SESSION_BADGES[status] ?? SESSION_BADGES.unknown;
}

const ACCOUNT_BADGES: Record<AccountStatus, StatusBadge> = {
  ready: { label: "ready", className: "ready", animated: false },
  pending_login: { label: "pending login", className: "pending_login", animated: true },
};

export function accountStatusBadge(status: AccountStatus): StatusBadge {
  return ACCOUNT_BADGES[status];
}
