// Login Container — the ephemeral container created while registering an
// `oauth` Account (PRD §3, CONTEXT.md). It mounts ONLY the Account Config
// Volume and exposes a web terminal where the user completes the interactive
// `claude` login; once credentials appear in the volume the Account flips to
// `ready` and the container is destroyed. It carries its OWN marker label
// (`cc-remote-login`) — never the session marker — so it is invisible to
// session listings while sharing the `cc-remote-account-id` vocabulary.

import { SESSION_LABELS } from "./session";

/** A login-labelled container as reported by the ContainerEngine. */
export type LoginContainer = {
  accountId: string;
  /** Raw engine state (`running`, `exited`, ...); passed through verbatim. */
  state: string;
};

export const LOGIN_LABELS = {
  marker: "cc-remote-login",
  // Same key as the session account label — one vocabulary for "which Account".
  accountId: SESSION_LABELS.accountId,
} as const;

export function buildLoginLabels(input: { accountId: string }): Record<string, string> {
  return {
    [LOGIN_LABELS.marker]: "true",
    [LOGIN_LABELS.accountId]: input.accountId,
  };
}
