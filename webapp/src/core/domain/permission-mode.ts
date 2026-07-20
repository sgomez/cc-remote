// Permission Mode — how much a Session's agent may do without asking.
//
// Claude Code accepts a wider set (`default`, `acceptEdits`, `plan`, `dontAsk`,
// …), but this deployment only ever exercises two, and offering a mode nobody
// has run would let an operator create a Session whose agent never starts. The
// value used to be an unvalidated string travelling from a file the operator
// wrote straight to a command-line flag; now that a browser supplies it, it is
// validated before a Session exists rather than after its container fails.

import { InvalidPermissionModeError } from "./errors";

/**
 * `auto` runs behind Claude's background safety classifier;
 * `bypassPermissions` runs unfiltered. Container isolation is what bounds the
 * damage in either case — see docs/security.md.
 */
export const PERMISSION_MODES = ["auto", "bypassPermissions"] as const;

export type PermissionMode = (typeof PERMISSION_MODES)[number];

/** Applied when neither the Session nor the Deployment Setting names one. */
export const DEFAULT_PERMISSION_MODE: PermissionMode = "auto";

export function isValidPermissionMode(mode: string): mode is PermissionMode {
  return (PERMISSION_MODES as readonly string[]).includes(mode);
}

export function assertValidPermissionMode(mode: string): asserts mode is PermissionMode {
  if (!isValidPermissionMode(mode)) throw new InvalidPermissionModeError(mode);
}

/**
 * The mode a Session runs in when its own choice is absent — a Session created
 * before the mode was recorded on the container, so its label is missing.
 */
export function resolvePermissionMode(
  chosen: string | undefined,
  deploymentDefault: PermissionMode,
): PermissionMode {
  if (chosen === undefined || chosen === "") return deploymentDefault;
  assertValidPermissionMode(chosen);
  return chosen;
}
