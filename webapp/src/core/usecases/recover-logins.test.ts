import { beforeEach, describe, expect, it } from "vitest";
import { FakeAccountRepository } from "../../../test/fake-account-repository";
import { FakeContainerEngine } from "../../../test/fake-container-engine";
import type { Account } from "../domain/account";
import { accountConfigVolumeName } from "../domain/account";
import { makeRecoverLogins } from "./recover-logins";

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

describe("recover-logins", () => {
  let accounts: FakeAccountRepository;
  let engine: FakeContainerEngine;
  let recoverLogins: ReturnType<typeof makeRecoverLogins>;

  beforeEach(() => {
    accounts = new FakeAccountRepository([account({})]);
    engine = new FakeContainerEngine();
    recoverLogins = makeRecoverLogins({ accounts, engine });
  });

  it("re-attaches to an orphaned Login Container without spawning a duplicate", async () => {
    engine.seedLoginContainer("acc-1");
    await recoverLogins();
    expect(engine.hasLoginContainer("acc-1")).toBe(true);
    expect(engine.runLoginSpecs).toHaveLength(0);
  });

  it("recreates a Login Container whose process crashed while down", async () => {
    // No seeded container: it vanished with the crash.
    await recoverLogins();
    expect(engine.hasLoginContainer("acc-1")).toBe(true);
    expect(engine.runLoginSpecs).toHaveLength(1);
  });

  it("replaces a crashed-but-exited Login Container with a running one", async () => {
    // Login Containers have no AutoRemove, so a crashed ttyd leaves an `exited`
    // container present. Recovery must not re-attach to that dead terminal.
    engine.seedLoginContainer("acc-1", "exited");
    await recoverLogins();
    expect(engine.hasLoginContainer("acc-1")).toBe(true);
    expect((await engine.getLoginContainer("acc-1"))?.state).toBe("running");
    expect(engine.runLoginSpecs).toHaveLength(1);
  });

  it("flips accounts whose login completed while the web-manager was down", async () => {
    engine.seedLoginContainer("acc-1");
    engine.putCredentials(accountConfigVolumeName("acc-1"));
    await recoverLogins();
    expect((await accounts.findById("acc-1"))?.status).toBe("ready");
    expect(engine.hasLoginContainer("acc-1")).toBe(false);
    expect(engine.runLoginSpecs).toHaveLength(0);
  });

  it("ignores accounts that are already ready", async () => {
    accounts = new FakeAccountRepository([account({ status: "ready" })]);
    recoverLogins = makeRecoverLogins({ accounts, engine });
    await recoverLogins();
    expect(engine.runLoginSpecs).toHaveLength(0);
  });
});
