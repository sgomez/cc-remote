import { describe, expect, it } from "vitest";
import {
  type ConnectionState,
  canRetry,
  connectionLabel,
  INITIAL_CONNECTION,
  isFailure,
  isReconnecting,
  MAX_RECONNECT_ATTEMPTS,
  nextConnection,
  reconnectDelayMs,
  shouldDial,
} from "./terminal-connection";

/** Drive the machine through a sequence of events, from a given start. */
function run(from: ConnectionState, ...events: Parameters<typeof nextConnection>[1][]) {
  return events.reduce(nextConnection, from);
}

/** Drop `n` times in a row while visible, retrying each backoff. */
function failedDials(n: number): ConnectionState {
  let state = INITIAL_CONNECTION;
  for (let i = 0; i < n; i++) {
    state = nextConnection(state, { type: "dropped", hidden: false });
    state = nextConnection(state, { type: "retry" });
  }
  return state;
}

describe("reconnectDelayMs", () => {
  it("backs off exponentially and then caps", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8].map(reconnectDelayMs)).toEqual([
      500, 1_000, 2_000, 4_000, 8_000, 10_000, 10_000, 10_000,
    ]);
  });
});

describe("nextConnection", () => {
  it("starts out dialing, without counting a reconnect", () => {
    expect(shouldDial(INITIAL_CONNECTION)).toBe(true);
    expect(isReconnecting(INITIAL_CONNECTION)).toBe(false);
    expect(connectionLabel(INITIAL_CONNECTION)).toBe("connecting…");
  });

  it("opens", () => {
    const state = nextConnection(INITIAL_CONNECTION, { type: "opened" });
    expect(state).toEqual({ kind: "open" });
    expect(canRetry(state)).toBe(false);
    expect(connectionLabel(state)).toBe("connected");
  });

  it("schedules a backed-off retry when a live socket drops", () => {
    const state = run(INITIAL_CONNECTION, { type: "opened" }, { type: "dropped", hidden: false });
    expect(state).toEqual({ kind: "waiting", attempt: 1, delayMs: 500 });
    expect(shouldDial(state)).toBe(false);
    expect(canRetry(state)).toBe(true);
  });

  it("dials again when the backoff elapses, remembering the attempt", () => {
    const state = run(
      INITIAL_CONNECTION,
      { type: "opened" },
      { type: "dropped", hidden: false },
      { type: "retry" },
    );
    expect(state).toEqual({ kind: "connecting", attempt: 1 });
    expect(shouldDial(state)).toBe(true);
    expect(isReconnecting(state)).toBe(true);
    expect(connectionLabel(state)).toBe(`reconnecting… (1/${MAX_RECONNECT_ATTEMPTS})`);
  });

  it("lengthens the backoff across consecutive failed dials", () => {
    const state = nextConnection(failedDials(2), { type: "dropped", hidden: false });
    expect(state).toEqual({ kind: "waiting", attempt: 3, delayMs: 2_000 });
  });

  it("restarts the budget after a connection that actually worked", () => {
    // Four failures, then a successful open: the next drop is attempt 1 again,
    // not attempt 5 — a link that reconnected is not a link that is failing.
    const state = run(failedDials(4), { type: "opened" }, { type: "dropped", hidden: false });
    expect(state).toEqual({ kind: "waiting", attempt: 1, delayMs: 500 });
  });

  it("gives up once the budget is spent", () => {
    const state = nextConnection(failedDials(MAX_RECONNECT_ATTEMPTS), {
      type: "dropped",
      hidden: false,
    });
    expect(state).toEqual({ kind: "lost" });
    expect(shouldDial(state)).toBe(false);
    expect(isFailure(state)).toBe(true);
    expect(canRetry(state)).toBe(true);
    expect(connectionLabel(state)).toBe("disconnected");
  });

  it("keeps retrying right up to the last attempt", () => {
    const state = nextConnection(failedDials(MAX_RECONNECT_ATTEMPTS - 1), {
      type: "dropped",
      hidden: false,
    });
    expect(state).toEqual({
      kind: "waiting",
      attempt: MAX_RECONNECT_ATTEMPTS,
      delayMs: 10_000,
    });
  });

  it("parks instead of burning attempts when the tab is hidden", () => {
    // The phone locks. Retrying now would spend the whole budget in the dark and
    // greet the user with "disconnected" when they come back.
    const state = run(INITIAL_CONNECTION, { type: "opened" }, { type: "dropped", hidden: true });
    expect(state).toEqual({ kind: "suspended" });
    expect(shouldDial(state)).toBe(false);
    expect(isFailure(state)).toBe(false);
    expect(connectionLabel(state)).toBe("paused — reconnects when you come back");
  });

  it("dials immediately, budget reset, when the user comes back", () => {
    for (const parked of [
      failedDials(3),
      { kind: "suspended" } as const,
      { kind: "lost" } as const,
    ]) {
      const state = nextConnection(parked, { type: "resumed" });
      expect(state).toEqual({ kind: "connecting", attempt: 0 });
      expect(shouldDial(state)).toBe(true);
    }
  });

  it("resuming while a backoff is pending skips the wait", () => {
    const waiting = run(INITIAL_CONNECTION, { type: "opened" }, { type: "dropped", hidden: false });
    expect(nextConnection(waiting, { type: "resumed" })).toEqual({
      kind: "connecting",
      attempt: 0,
    });
  });

  it("leaves a healthy socket alone when the tab is refocused", () => {
    const open: ConnectionState = { kind: "open" };
    expect(nextConnection(open, { type: "resumed" })).toBe(open);
  });

  it("ignores a backoff timer that lands after a forced reconnect", () => {
    // The user tapped Reconnect while a retry was scheduled: the stale timer
    // must not re-dial on top of the socket that is already connecting.
    const state = run(
      INITIAL_CONNECTION,
      { type: "opened" },
      { type: "dropped", hidden: false },
      { type: "resumed" },
      { type: "retry" },
    );
    expect(state).toEqual({ kind: "connecting", attempt: 0 });
  });

  it("ignores the close event that follows a drop we already handled", () => {
    const suspended: ConnectionState = { kind: "suspended" };
    expect(nextConnection(suspended, { type: "dropped", hidden: false })).toBe(suspended);
    const lost: ConnectionState = { kind: "lost" };
    expect(nextConnection(lost, { type: "dropped", hidden: false })).toBe(lost);
  });
});

describe("isReconnecting", () => {
  it("is true for every state whose screen is stale", () => {
    // Anything but the very first dial is drawing over a frozen screen that the
    // reattaching tmux client will redraw — the xterm buffer must be reset.
    expect(isReconnecting({ kind: "connecting", attempt: 0 })).toBe(false);
    expect(isReconnecting({ kind: "connecting", attempt: 1 })).toBe(true);
    expect(isReconnecting({ kind: "suspended" })).toBe(true);
    expect(isReconnecting({ kind: "lost" })).toBe(true);
  });
});
