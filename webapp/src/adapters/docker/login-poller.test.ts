import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeAccountRepository } from "../../../test/fake-account-repository";
import { FakeContainerEngine } from "../../../test/fake-container-engine";
import { type Account, accountConfigVolumeName } from "../../core";
import { startLoginPoller } from "./login-poller";

function account(overrides: Partial<Account>): Account {
  return {
    id: "acc-1",
    providerType: "claude",
    displayName: "Work Claude",
    credentials: {},
    config: {},
    status: "pending_login",
    createdAt: new Date(0),
    ...overrides,
  };
}

describe("login-poller", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("recovers on start: recreates a Login Container missing after a restart", async () => {
    const accounts = new FakeAccountRepository([account({})]);
    const engine = new FakeContainerEngine();
    const stop = startLoginPoller({ engine, accounts }, { intervalMs: 1_000 });
    await vi.advanceTimersByTimeAsync(0); // flush recovery microtasks
    expect(engine.hasLoginContainer("acc-1")).toBe(true);
    stop();
  });

  it("polls on the interval and flips accounts once credentials appear", async () => {
    const accounts = new FakeAccountRepository([account({})]);
    const engine = new FakeContainerEngine();
    engine.seedLoginContainer("acc-1");
    const flipped: string[][] = [];
    const stop = startLoginPoller(
      { engine, accounts },
      { intervalMs: 1_000, onFlipped: (ids) => flipped.push(ids) },
    );

    await vi.advanceTimersByTimeAsync(1_000);
    expect((await accounts.findById("acc-1"))?.status).toBe("pending_login");

    engine.putCredentials(accountConfigVolumeName("acc-1"));
    await vi.advanceTimersByTimeAsync(1_000);
    expect((await accounts.findById("acc-1"))?.status).toBe("ready");
    expect(engine.hasLoginContainer("acc-1")).toBe(false);
    expect(flipped).toEqual([["acc-1"]]);
    stop();
  });

  it("stops polling after the disposer runs", async () => {
    const accounts = new FakeAccountRepository([account({})]);
    const engine = new FakeContainerEngine();
    engine.seedLoginContainer("acc-1");
    const stop = startLoginPoller({ engine, accounts }, { intervalMs: 1_000 });
    await vi.advanceTimersByTimeAsync(0); // let the one-shot recovery pass drain
    stop();

    // With the interval cleared, credentials appearing must NOT be picked up.
    engine.putCredentials(accountConfigVolumeName("acc-1"));
    await vi.advanceTimersByTimeAsync(5_000);
    expect((await accounts.findById("acc-1"))?.status).toBe("pending_login");
  });
});
