// login-poller — wires the Login Container state machine to wall-clock time.
// On start it runs one recovery pass (rediscover orphaned containers / flip
// logins that completed while the web-manager was down), then polls on an
// interval to detect newly-completed logins and flip their Accounts to `ready`.
// It is pure orchestration over the core use cases and the ports, so the state
// logic is covered by the same fakes the core uses; only the interval is real.
// Wired at server startup by the deployment layer (#17), which owns engine
// creation.

import {
  type AccountRepository,
  type ContainerEngine,
  makePollLogins,
  makeRecoverLogins,
} from "../../core";

/** Default gap between credential polls. */
export const DEFAULT_LOGIN_POLL_INTERVAL_MS = 3_000;

export type LoginPollerDeps = {
  engine: ContainerEngine;
  accounts: AccountRepository;
};

export type LoginPollerOptions = {
  intervalMs?: number;
  /** Notified with the accounts that flipped to `ready` on each pass. */
  onFlipped?: (accountIds: string[]) => void;
  /** Notified on a poll/recovery failure — a failed tick must not kill the loop. */
  onError?: (err: unknown) => void;
};

/**
 * Start the login poller: recover once, then poll on an interval. Returns a
 * disposer that stops the loop (call it on shutdown / hot reload).
 */
export function startLoginPoller(
  deps: LoginPollerDeps,
  options: LoginPollerOptions = {},
): () => void {
  const intervalMs = options.intervalMs ?? DEFAULT_LOGIN_POLL_INTERVAL_MS;
  const recoverLogins = makeRecoverLogins(deps);
  const pollLogins = makePollLogins(deps);

  const tick = async () => {
    try {
      const flipped = await pollLogins();
      if (flipped.length > 0) options.onFlipped?.(flipped.map((r) => r.accountId));
    } catch (err) {
      options.onError?.(err);
    }
  };

  // Kick off recovery, then let the interval take over. A recovery failure is
  // reported but never blocks polling.
  void recoverLogins().catch((err) => options.onError?.(err));

  const timer = setInterval(tick, intervalMs);
  // Do not keep the process alive solely for the poller.
  if (typeof timer.unref === "function") timer.unref();

  return () => clearInterval(timer);
}
