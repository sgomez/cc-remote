// Pure mapping between Docker's container view and the domain's SessionContainer
// (TDD'd; the dockerode calls in docker-container-engine.ts stay thin around
// these). The label vocabulary is the domain's SESSION_LABELS — the adapter
// never invents label keys.

import {
  type ContainerState,
  LOGIN_LABELS,
  type LoginContainer,
  SESSION_LABELS,
  type SessionContainer,
} from "../../core";

/** Docker's own lifecycle vocabulary — the only place it is spelled out. */
const CONTAINER_STATES: readonly ContainerState[] = [
  "running",
  "created",
  "restarting",
  "paused",
  "removing",
  "exited",
  "dead",
];

/**
 * Translate the engine's raw state string into the closed domain vocabulary.
 * The one mapping point (D6): core branches on `ContainerState`, never on
 * Docker's words, and a state Docker adds tomorrow lands on `unknown` rather
 * than being read as "stopped".
 */
export function toContainerState(raw: string): ContainerState {
  const state = raw.toLowerCase();
  return CONTAINER_STATES.find((known) => known === state) ?? "unknown";
}

/**
 * Docker's `ContainerInfo.Status` for an exited container, e.g.
 * `"Exited (137) 2 minutes ago"`. Anchored on `Exited` so the superficially
 * similar `"Restarting (1) 4 seconds ago"` — not a terminal exit — never matches.
 */
const EXITED_STATUS = /^Exited \((\d+)\)/;

/**
 * Pull the exit code out of the `Status` line of `docker.listContainers()`.
 *
 * The list endpoint's `ContainerInfo` carries NO exit-code field (unlike
 * `inspect`, which has `State.ExitCode`), yet the list is what drives the
 * sessions page and the 1s SSE status stream. This string is therefore the only
 * way that path can tell a deliberate stop from a crash. Returns `null` when
 * there is no code to read (running, paused, created, …) — the domain then
 * degrades to `stopped` rather than inventing an error.
 */
export function parseExitCode(status: string): number | null {
  const match = EXITED_STATUS.exec(status);
  if (!match) return null;
  const code = Number.parseInt(match[1], 10);
  return Number.isNaN(code) ? null : code;
}

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
 * SessionContainer. The state is normalised into the domain vocabulary here;
 * status synthesis (`cloning`/`clone_failed`/`error`) stays the domain's job.
 */
export function toSessionContainer(view: {
  labels: Record<string, string>;
  state: string;
  exitCode?: number | null;
}): SessionContainer {
  const { labels, state, exitCode } = view;
  return {
    name: labels[SESSION_LABELS.name] ?? "",
    repo: labels[SESSION_LABELS.repo] ?? "",
    accountId: labels[SESSION_LABELS.accountId] ?? "",
    state: toContainerState(state),
    exitCode: exitCode ?? null,
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

/** Port ttyd listens on inside every agent container (image `EXPOSE 7681`). */
export const TTYD_PORT = 7681;

/**
 * The ttyd WebSocket endpoint of a Session's agent container on the compose
 * network — where the #15 proxy bridges browser terminal frames. Composed from
 * the same `mainContainerName` + `ttydBasePath` the adapter creates the
 * container with, so the proxy target can never drift from the running ttyd.
 * ttyd serves its socket at `<base-path>/ws`.
 */
export function ttydWebSocketUrl(sessionName: string): string {
  return `ws://${mainContainerName(sessionName)}:${TTYD_PORT}${ttydBasePath(sessionName)}/ws`;
}

/**
 * The ttyd WebSocket endpoint of a Login Container on the compose network — the
 * login analogue of `ttydWebSocketUrl`, where the #16 login-terminal proxy
 * bridges frames. Composed from the same `loginContainerName` +
 * `loginTerminalBasePath` the adapter creates the Login Container with, so the
 * proxy target can never drift from the running ttyd (`<base-path>/ws`).
 */
export function loginTtydWebSocketUrl(accountId: string): string {
  return `ws://${loginContainerName(accountId)}:${TTYD_PORT}${loginTerminalBasePath(accountId)}/ws`;
}

/**
 * Decode the body of `GET /containers/{id}/logs` to text.
 *
 * Docker returns TWO different wire formats and only the container's `Tty` flag
 * says which: a container created WITHOUT a TTY gets a *multiplexed* stream —
 * each chunk prefixed by an 8-byte header (stream type, 3 zero bytes, then a
 * big-endian uint32 length) — while a TTY container gets the raw bytes. Ours are
 * created with `Tty: true` (see container-specs.ts), so in practice this is the
 * raw path; we sniff the framing anyway because the cost is a few bytes of
 * checking and the failure mode of guessing wrong is header bytes rendered as
 * binary junk in the user's log panel.
 *
 * Sniffing is safe: a valid header starts with a stream type of 0/1/2 followed
 * by three NUL bytes, which UTF-8 log text does not begin with, and we only
 * accept the framed reading if every frame walks cleanly to the end of the
 * buffer. Anything else is returned verbatim.
 */
export function decodeDockerLogs(buffer: Buffer): string {
  return demultiplexDockerLogs(buffer) ?? buffer.toString("utf8");
}

const LOG_HEADER_SIZE = 8;
const MAX_LOG_STREAM_TYPE = 2; // 0 stdin, 1 stdout, 2 stderr

/** The framed reading of `buffer`, or null if it isn't cleanly framed. */
function demultiplexDockerLogs(buffer: Buffer): string | null {
  const frames: Buffer[] = [];
  let offset = 0;

  while (offset < buffer.length) {
    if (offset + LOG_HEADER_SIZE > buffer.length) return null;
    if (buffer.readUInt8(offset) > MAX_LOG_STREAM_TYPE) return null;
    // Bytes 1-3 of a real header are always zero padding.
    if (buffer.readUInt8(offset + 1) !== 0) return null;
    if (buffer.readUInt8(offset + 2) !== 0) return null;
    if (buffer.readUInt8(offset + 3) !== 0) return null;

    const size = buffer.readUInt32BE(offset + 4);
    const start = offset + LOG_HEADER_SIZE;
    if (start + size > buffer.length) return null;

    frames.push(buffer.subarray(start, start + size));
    offset = start + size;
  }

  return frames.length > 0 ? Buffer.concat(frames).toString("utf8") : null;
}
