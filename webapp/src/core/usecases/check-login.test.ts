import { beforeEach, describe, expect, it } from "vitest";
import { FakeAccountRepository } from "../../../test/fake-account-repository";
import { FakeContainerEngine } from "../../../test/fake-container-engine";
import type { Account } from "../domain/account";
import { accountConfigVolumeName } from "../domain/account";
import { AccountNotFoundError } from "../domain/errors";
import { makeCheckLogin } from "./check-login";

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

describe("check-login", () => {
  let accounts: FakeAccountRepository;
  let engine: FakeContainerEngine;
  let checkLogin: ReturnType<typeof makeCheckLogin>;

  beforeEach(() => {
    accounts = new FakeAccountRepository([account({})]);
    engine = new FakeContainerEngine();
    engine.seedLoginContainer("acc-1");
    checkLogin = makeCheckLogin({ accounts, engine });
  });

  it("throws when the account does not exist", async () => {
    await expect(checkLogin({ accountId: "nope" })).rejects.toThrow(AccountNotFoundError);
  });

  it("stays pending (no throw) while credentials have not appeared", async () => {
    const result = await checkLogin({ accountId: "acc-1" });
    expect(result.flipped).toBe(false);
    expect((await accounts.findById("acc-1"))?.status).toBe("pending_login");
    // Container still running — the user is mid-login.
    expect(engine.hasLoginContainer("acc-1")).toBe(true);
  });

  it("flips to ready and destroys the Login Container once credentials appear", async () => {
    engine.putCredentials(accountConfigVolumeName("acc-1"));
    const result = await checkLogin({ accountId: "acc-1" });
    expect(result.flipped).toBe(true);
    expect((await accounts.findById("acc-1"))?.status).toBe("ready");
    expect(engine.hasLoginContainer("acc-1")).toBe(false);
  });

  it("cleans up a leftover container for an already-ready account", async () => {
    accounts = new FakeAccountRepository([account({ status: "ready" })]);
    checkLogin = makeCheckLogin({ accounts, engine });
    const result = await checkLogin({ accountId: "acc-1" });
    expect(result.flipped).toBe(false);
    expect(engine.hasLoginContainer("acc-1")).toBe(false);
  });
});
