// Pure mapping between Docker's container view and the domain's SessionContainer
// (TDD'd; the dockerode calls in docker-container-engine.ts stay thin around
// these). The label vocabulary is the domain's SESSION_LABELS — the adapter
// never invents label keys.

import {
  LOGIN_LABELS,
  type LoginContainer,
  SESSION_LABELS,
  type SessionContainer,
} from "../../core";

/** The `cc-remote-session-<name>` container that runs the agent. */
export function mainContainerName(sessionName: string): string {
  return `cc-remote-session-${sessionName}`;
}

/** The `cc-remote-session-clone-<name>` two-phase clone helper. */
export function cloneContainerName(sessionName: string): string {
  return `cc-remote-session-clone-${sessionName}`;
}

/**
 * The `cc-remote-session` label guard (legacy `getSessionContainer`): reads
 * and mutations only ever touch containers carrying it, so a use case can
 * never reach an arbitrary host container.
 */
export function isSessionLabelled(labels: Record<string, string> | undefined | null): boolean {
  return labels?.[SESSION_LABELS.marker] === "true";
}

/**
 * Map a labelled container (its labels + raw engine state) to a
 * SessionContainer. `state` is passed through verbatim — status synthesis
 * (`cloning`/`clone_failed`) is the domain's job, not the adapter's.
 */
export function toSessionContainer(view: {
  labels: Record<string, string>;
  state: string;
}): SessionContainer {
  const { labels, state } = view;
  return {
    name: labels[SESSION_LABELS.name] ?? "",
    repo: labels[SESSION_LABELS.repo] ?? "",
    accountId: labels[SESSION_LABELS.accountId] ?? "",
    state,
    cloning: labels[SESSION_LABELS.cloning] === "true",
  };
}

/**
 * ttyd base path baked into the agent image CMD
 * (`ttyd -p 7681 --base-path /api/sessions/<name>/terminal`). The single
 * source of truth shared with the WS proxy (#15) so the two never drift.
 */
export function ttydBasePath(sessionName: string): string {
  return `/api/sessions/${sessionName}/terminal`;
}

/** The `cc-remote-login-<account-id>` ephemeral OAuth-login container (#14). */
export function loginContainerName(accountId: string): string {
  return `cc-remote-login-${accountId}`;
}

/**
 * The `cc-remote-login` label guard — the login analogue of `isSessionLabelled`.
 * Login Containers carry this marker, NOT the session marker, so they never
 * surface in session listings.
 */
export function isLoginLabelled(labels: Record<string, string> | undefined | null): boolean {
  return labels?.[LOGIN_LABELS.marker] === "true";
}

/** Map a login-labelled container (its labels + raw engine state) to a LoginContainer. */
export function toLoginContainer(view: {
  labels: Record<string, string>;
  state: string;
}): LoginContainer {
  return {
    accountId: view.labels[LOGIN_LABELS.accountId] ?? "",
    state: view.state,
  };
}

/**
 * ttyd base path for a Login Container, mirroring `ttydBasePath` for sessions.
 * Baked into the login container's CMD and matched by the WS proxy (#15) so the
 * terminal is reachable at one agreed path.
 */
export function loginTerminalBasePath(accountId: string): string {
  return `/api/accounts/${accountId}/login/terminal`;
}
