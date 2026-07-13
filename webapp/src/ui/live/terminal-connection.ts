// Reconnect policy for the web terminal (U4). The socket drops constantly on a
// phone — the network flaps, and backgrounding the tab makes the browser close
// the WebSocket outright — and until now the only recovery was a page reload.
//
// Reconnecting is a *complete* recovery here, not a partial one: ttyd runs its
// command once per client, and that command is `tmux attach -d` onto the agent
// session that entrypoint.sh started (see console-entrypoint.sh). Claude keeps
// running while nobody is attached, and a fresh attach redraws the live screen.
// So the client has nothing to replay or reconcile — it only has to dial again.
//
// The browser cannot tell *why* a socket closed: a failed upgrade (the proxy's
// 401/404) and a lost signal both surface as close code 1006. So the policy is
// blind by necessity — retry a bounded number of times, then stop and offer a
// manual retry rather than hammer a container that is gone for good.
//
// Two rules carry most of the mobile win:
//
//   • A drop while the tab is HIDDEN does not burn attempts. The phone locking
//     is not a failing network; retrying against a backgrounded tab would spend
//     the whole budget in the dark and greet the user with "disconnected".
//     Hidden drops park in `suspended` and wait.
//   • Coming back — tab visible, network back, or the user tapping Reconnect —
//     dials immediately and resets the budget, instead of serving out a backoff
//     that was scheduled for a network that no longer exists.
//
// Pure and framework-free so the whole policy is unit-testable without a DOM or
// a socket; Terminal.tsx is the thin xterm/WebSocket glue around it.

/** How many consecutive failed dials before we give up and wait for the user. */
export const MAX_RECONNECT_ATTEMPTS = 8;

const BACKOFF_MS = [500, 1_000, 2_000, 4_000, 8_000] as const;
const MAX_BACKOFF_MS = 10_000;

/**
 * Backoff before the nth consecutive retry (`attempt` is 1-based). Exponential,
 * capped: ~0.5s → 10s, so the full budget spans roughly a minute of a genuinely
 * dead link while a one-off blip recovers in half a second. No jitter — this is
 * one user with one terminal, there is no herd to spread out.
 */
export function reconnectDelayMs(attempt: number): number {
  return BACKOFF_MS[attempt - 1] ?? MAX_BACKOFF_MS;
}

export type ConnectionState =
  /** Dialing. `attempt` is how many dials have already failed (0 on first open). */
  | { kind: "connecting"; attempt: number }
  | { kind: "open" }
  /** Dropped, backing off before retry number `attempt`. */
  | { kind: "waiting"; attempt: number; delayMs: number }
  /** Dropped while hidden/offline. Not a failure — resumes when the user returns. */
  | { kind: "suspended" }
  /** Budget spent. Only a manual retry gets us out of here. */
  | { kind: "lost" };

export type ConnectionEvent =
  | { type: "opened" }
  /** The socket closed on its own. `hidden` = tab backgrounded or browser offline. */
  | { type: "dropped"; hidden: boolean }
  /** Tab visible again, network back, or the user asked to reconnect. */
  | { type: "resumed" }
  /** The backoff elapsed. */
  | { type: "retry" };

export const INITIAL_CONNECTION: ConnectionState = { kind: "connecting", attempt: 0 };

/**
 * The reconnect state machine. `dropped` is the only interesting transition: a
 * hidden drop parks, and a visible one counts against the budget, resuming the
 * count from a `connecting` state (a dial that failed) but restarting it from
 * `open` (a connection that had worked, so this is a fresh outage).
 */
export function nextConnection(state: ConnectionState, event: ConnectionEvent): ConnectionState {
  switch (event.type) {
    case "opened":
      return { kind: "open" };

    case "dropped": {
      if (state.kind === "suspended" || state.kind === "lost") return state;
      if (event.hidden) return { kind: "suspended" };
      const attempt = (state.kind === "connecting" ? state.attempt : 0) + 1;
      if (attempt > MAX_RECONNECT_ATTEMPTS) return { kind: "lost" };
      return { kind: "waiting", attempt, delayMs: reconnectDelayMs(attempt) };
    }

    case "retry":
      // Only a backoff that is still pending may fire; a stale timer landing
      // after the user already forced a reconnect must not re-dial.
      return state.kind === "waiting" ? { kind: "connecting", attempt: state.attempt } : state;

    case "resumed":
      // A live socket needs nothing; anything else dials now, budget reset.
      return state.kind === "open" ? state : { kind: "connecting", attempt: 0 };
  }
}

/** Whether this state should dial a socket. */
export function shouldDial(state: ConnectionState): boolean {
  return state.kind === "connecting";
}

/**
 * Whether reaching this state means the terminal is showing a stale, frozen
 * screen that the reattaching tmux client is about to redraw over — i.e. the
 * xterm buffer should be reset when the *next* socket opens. False for the very
 * first dial, whose buffer is already empty.
 */
export function isReconnecting(state: ConnectionState): boolean {
  return !(state.kind === "connecting" && state.attempt === 0);
}

/** Whether to offer a manual "Reconnect" affordance. */
export function canRetry(state: ConnectionState): boolean {
  return state.kind === "waiting" || state.kind === "suspended" || state.kind === "lost";
}

/** Whether the status line should read as an error. */
export function isFailure(state: ConnectionState): boolean {
  return state.kind === "lost";
}

export function connectionLabel(state: ConnectionState): string {
  switch (state.kind) {
    case "connecting":
      return state.attempt === 0
        ? "connecting…"
        : `reconnecting… (${state.attempt}/${MAX_RECONNECT_ATTEMPTS})`;
    case "open":
      return "connected";
    case "waiting":
      return `connection lost — retrying (${state.attempt}/${MAX_RECONNECT_ATTEMPTS})`;
    case "suspended":
      return "paused — reconnects when you come back";
    case "lost":
      return "disconnected";
  }
}
