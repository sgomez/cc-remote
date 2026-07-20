// Pure presentation of Permission Mode: the create-form selector, its prefill,
// and the Session detail badge. Framework-free with colocated tests, like the
// other view models — the wording an operator reads is behaviour worth pinning,
// and it must not drift between the selector and the badge.

import { DEFAULT_PERMISSION_MODE, isValidPermissionMode, type PermissionMode } from "~/core";

export type PermissionModeOption = {
  value: PermissionMode;
  label: string;
  description: string;
  /** Extra line shown only for a mode that needs justifying at the point of choice. */
  notice?: string;
};

/**
 * Plain descriptions rather than raw mode identifiers: an operator should not
 * need Claude Code's documentation open to know what they are choosing.
 */
export function permissionModeOptions(): PermissionModeOption[] {
  return [
    {
      value: "auto",
      label: "Filtered",
      description:
        "The agent works on its own, with Claude's background safety classifier vetting what it does.",
    },
    {
      value: "bypassPermissions",
      label: "Unfiltered",
      description:
        "The agent runs every command and edit without asking and without the safety classifier.",
      notice:
        "Acceptable here because the container is what bounds the damage: it mounts no host path, " +
        "carries no durable GitHub credential, and can reach only its own repository.",
    },
  ];
}

/**
 * What the create form starts on. Anything the server could not resolve to a
 * real mode falls back to the filtered one rather than leaving the form sitting
 * on a mode nobody chose.
 */
export function prefilledPermissionMode(deploymentDefault: string | undefined): PermissionMode {
  return deploymentDefault !== undefined && isValidPermissionMode(deploymentDefault)
    ? deploymentDefault
    : DEFAULT_PERMISSION_MODE;
}

export type PermissionModeBadge = {
  label: string;
  tone: "neutral" | "warn";
};

/**
 * The Session detail badge. `null` for a Session created before the mode was
 * recorded on its label — showing nothing is honest, and claiming a mode it was
 * never created in is not.
 */
export function permissionModeBadge(mode: PermissionMode | null): PermissionModeBadge | null {
  if (mode === null) return null;
  return mode === "bypassPermissions"
    ? { label: "Unfiltered", tone: "warn" }
    : { label: "Filtered", tone: "neutral" };
}
