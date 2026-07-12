import { beforeEach, describe, expect, it } from "vitest";
import { FakeAccountRepository } from "../../../test/fake-account-repository";
import { FakeContainerEngine } from "../../../test/fake-container-engine";
import type { Account } from "../domain/account";
import { AccountNotFoundError, LoginNotSupportedError } from "../domain/errors";
import { makeStartLogin } from "./start-login";

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

describe("start-login", () => {
  let accounts: FakeAccountRepository;
  let engine: FakeContainerEngine;
  let startLogin: ReturnType<typeof makeStartLogin>;

  beforeEach(() => {
    accounts = new FakeAccountRepository([account({})]);
    engine = new FakeContainerEngine();
    startLogin = makeStartLogin({ accounts, engine });
  });

  it("throws when the account does not exist", async () => {
    await expect(startLogin({ accountId: "nope" })).rejects.toThrow(AccountNotFoundError);
  });

  it("refuses a non-oauth account", async () => {
    accounts = new FakeAccountRepository([account({ providerType: "deepseek", status: "ready" })]);
    startLogin = makeStartLogin({ accounts, engine });
    await expect(startLogin({ accountId: "acc-1" })).rejects.toThrow(LoginNotSupportedError);
  });

  it("starts a labelled Login Container for a pending account", async () => {
    const login = await startLogin({ accountId: "acc-1" });
    expect(login?.accountId).toBe("acc-1");
    expect(engine.hasLoginContainer("acc-1")).toBe(true);
    const spec = engine.runLoginSpecs.at(-1);
    expect(spec?.accountConfigVolume).toBe("cc-remote-account-acc-1");
    expect(spec?.labels["cc-remote-login"]).toBe("true");
  });

  it("is idempotent: reuses an existing container instead of creating another", async () => {
    engine.seedLoginContainer("acc-1");
    const login = await startLogin({ accountId: "acc-1" });
    expect(login?.accountId).toBe("acc-1");
    expect(engine.runLoginSpecs).toHaveLength(0);
  });

  it("returns null (no container) for an already-ready account", async () => {
    accounts = new FakeAccountRepository([account({ status: "ready" })]);
    startLogin = makeStartLogin({ accounts, engine });
    const login = await startLogin({ accountId: "acc-1" });
    expect(login).toBeNull();
    expect(engine.hasLoginContainer("acc-1")).toBe(false);
  });
});
