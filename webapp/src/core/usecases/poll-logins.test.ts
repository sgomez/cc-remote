import { beforeEach, describe, expect, it } from "vitest";
import { FakeAccountRepository } from "../../../test/fake-account-repository";
import { FakeClock } from "../../../test/fake-clock";
import { FakeContainerEngine } from "../../../test/fake-container-engine";
import type { Account } from "../domain/account";
import { accountConfigVolumeName } from "../domain/account";
import { makePollLogins } from "./poll-logins";

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

describe("poll-logins", () => {
  let accounts: FakeAccountRepository;
  let engine: FakeContainerEngine;
  let clock: FakeClock;
  let pollLogins: ReturnType<typeof makePollLogins>;

  beforeEach(() => {
    accounts = new FakeAccountRepository([
      account({ id: "acc-1" }),
      account({ id: "acc-2" }),
      account({ id: "ready-1", providerType: "deepseek", status: "ready" }),
    ]);
    engine = new FakeContainerEngine();
    engine.seedLoginContainer("acc-1");
    engine.seedLoginContainer("acc-2");
    clock = new FakeClock();
    pollLogins = makePollLogins({ accounts, engine });
  });

  it("flips nothing while no credentials have appeared", async () => {
    const flipped = await pollLogins();
    expect(flipped).toEqual([]);
    expect((await accounts.findById("acc-1"))?.status).toBe("pending_login");
  });

  it("flips only the accounts whose credentials appeared this tick", async () => {
    // The clock advancing models successive poll intervals; credentials for
    // acc-1 land after the second interval.
    clock.advance(5_000);
    let flipped = await pollLogins();
    expect(flipped).toEqual([]);

    clock.advance(5_000);
    engine.putCredentials(accountConfigVolumeName("acc-1"));
    flipped = await pollLogins();

    expect(flipped.map((r) => r.accountId)).toEqual(["acc-1"]);
    expect((await accounts.findById("acc-1"))?.status).toBe("ready");
    expect(engine.hasLoginContainer("acc-1")).toBe(false);
    // acc-2 is still logging in.
    expect((await accounts.findById("acc-2"))?.status).toBe("pending_login");
    expect(engine.hasLoginContainer("acc-2")).toBe(true);
  });

  it("does not revisit accounts already ready", async () => {
    engine.putCredentials(accountConfigVolumeName("acc-1"));
    await pollLogins();
    const flipped = await pollLogins();
    expect(flipped).toEqual([]);
  });
});
