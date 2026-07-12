import { beforeEach, describe, expect, it } from "vitest";
import { FakeAccountRepository } from "../../../test/fake-account-repository";
import { FakeContainerEngine } from "../../../test/fake-container-engine";
import type { Account } from "../domain/account";
import { accountConfigVolumeName } from "../domain/account";
import { AccountInUseError, AccountNotFoundError } from "../domain/errors";
import { makeDeleteAccount } from "./delete-account";

function account(overrides: Partial<Account>): Account {
  return {
    id: "acc-1",
    providerType: "deepseek",
    displayName: "ds",
    credentials: { apiKey: "sk" },
    config: {},
    status: "ready",
    createdAt: new Date(0),
    ...overrides,
  };
}

describe("delete-account", () => {
  let accounts: FakeAccountRepository;
  let engine: FakeContainerEngine;
  let del: ReturnType<typeof makeDeleteAccount>;

  beforeEach(() => {
    accounts = new FakeAccountRepository([account({})]);
    engine = new FakeContainerEngine();
    del = makeDeleteAccount({ accounts, engine });
  });

  it("throws when the account does not exist", async () => {
    await expect(del({ accountId: "nope" })).rejects.toThrow(AccountNotFoundError);
  });

  it("refuses deletion while sessions labelled with the account exist", async () => {
    engine.seedRunningSession({ name: "s1", repo: "o/r", accountId: "acc-1" });
    engine.createVolume(accountConfigVolumeName("acc-1"));

    const err = await del({ accountId: "acc-1" }).catch((e) => e);
    expect(err).toBeInstanceOf(AccountInUseError);
    expect((err as AccountInUseError).sessions).toEqual(["s1"]);

    // row and volume untouched
    expect(await accounts.findById("acc-1")).not.toBeNull();
    expect(engine.hasVolume(accountConfigVolumeName("acc-1"))).toBe(true);
  });

  it("removes row and config volume when no sessions use it", async () => {
    engine.createVolume(accountConfigVolumeName("acc-1"));
    await del({ accountId: "acc-1" });
    expect(await accounts.findById("acc-1")).toBeNull();
    expect(engine.hasVolume(accountConfigVolumeName("acc-1"))).toBe(false);
  });

  it("ignores sessions of OTHER accounts", async () => {
    engine.seedRunningSession({ name: "other", repo: "o/r", accountId: "acc-2" });
    await del({ accountId: "acc-1" });
    expect(await accounts.findById("acc-1")).toBeNull();
  });

  it("deletes a host-mount account row without touching any volume", async () => {
    accounts = new FakeAccountRepository([
      account({ id: "local", providerType: "claude-local", credentials: {} }),
    ]);
    del = makeDeleteAccount({ accounts, engine });
    await del({ accountId: "local" });
    expect(await accounts.findById("local")).toBeNull();
  });
});
