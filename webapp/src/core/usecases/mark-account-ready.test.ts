import { beforeEach, describe, expect, it } from "vitest";
import { FakeAccountRepository } from "../../../test/fake-account-repository";
import { FakeContainerEngine } from "../../../test/fake-container-engine";
import type { Account } from "../domain/account";
import { accountConfigVolumeName } from "../domain/account";
import { AccountNotFoundError, CredentialsNotFoundError } from "../domain/errors";
import { makeMarkAccountReady } from "./mark-account-ready";

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

describe("mark-account-ready", () => {
  let accounts: FakeAccountRepository;
  let engine: FakeContainerEngine;
  let markReady: ReturnType<typeof makeMarkAccountReady>;

  beforeEach(() => {
    accounts = new FakeAccountRepository([account({})]);
    engine = new FakeContainerEngine();
    markReady = makeMarkAccountReady({ accounts, engine });
  });

  it("throws when the account does not exist", async () => {
    await expect(markReady({ accountId: "nope" })).rejects.toThrow(AccountNotFoundError);
  });

  it("stays pending when no credentials are in the volume", async () => {
    await expect(markReady({ accountId: "acc-1" })).rejects.toThrow(CredentialsNotFoundError);
    expect((await accounts.findById("acc-1"))?.status).toBe("pending_login");
  });

  it("flips pending_login to ready once credentials are detected", async () => {
    engine.putCredentials(accountConfigVolumeName("acc-1"));
    const updated = await markReady({ accountId: "acc-1" });
    expect(updated.status).toBe("ready");
    expect((await accounts.findById("acc-1"))?.status).toBe("ready");
  });

  it("is idempotent for an already-ready account", async () => {
    accounts = new FakeAccountRepository([account({ status: "ready" })]);
    markReady = makeMarkAccountReady({ accounts, engine });
    const updated = await markReady({ accountId: "acc-1" });
    expect(updated.status).toBe("ready");
  });
});
