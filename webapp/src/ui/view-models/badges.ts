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
  /** Whether the status dot pulses (running / cloning / pending_login). */
  animated: boolean;
};

const SESSION_BADGES: Record<SessionStatus, StatusBadge> = {
  running: { label: "running", className: "running", animated: true },
  starting: { label: "starting", className: "starting", animated: true },
  restarting: { label: "restarting", className: "restarting", animated: true },
  paused: { label: "paused", className: "paused", animated: false },
  stopped: { label: "stopped", className: "stopped", animated: false },
  error: { label: "error", className: "error", animated: false },
  cloning: { label: "cloning", className: "cloning", animated: true },
  clone_failed: { label: "clone failed", className: "clone_failed", animated: false },
  unknown: { label: "unknown", className: "unknown", animated: false },
};

export function sessionStatusBadge(status: SessionStatus): StatusBadge {
  return SESSION_BADGES[status];
}

const ACCOUNT_BADGES: Record<AccountStatus, StatusBadge> = {
  ready: { label: "ready", className: "ready", animated: false },
  pending_login: { label: "pending login", className: "pending_login", animated: true },
};

export function accountStatusBadge(status: AccountStatus): StatusBadge {
  return ACCOUNT_BADGES[status];
}
