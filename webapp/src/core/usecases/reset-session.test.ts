import { beforeEach, describe, expect, it } from "vitest";
import { FakeAccountRepository } from "../../../test/fake-account-repository";
import { FakeContainerEngine } from "../../../test/fake-container-engine";
import { FakeIdGenerator } from "../../../test/fake-id-generator";
import type { Account } from "../domain/account";
import { AccountNotFoundError, SessionNotFoundError } from "../domain/errors";
import { workspaceVolumeName } from "../domain/session";
import { makeResetSession } from "./reset-session";

function account(overrides: Partial<Account> = {}): Account {
  return {
    id: "acc-1",
    providerType: "deepseek",
    displayName: "ds",
    credentials: { apiKey: "sk-ds" },
    config: {},
    status: "ready",
    createdAt: new Date(0),
    ...overrides,
  };
}

function setup() {
  const accounts = new FakeAccountRepository([account()]);
  const engine = new FakeContainerEngine();
  const ids = new FakeIdGenerator("uuid");
  const reset = makeResetSession({ accounts, engine, ids });
  return { accounts, engine, ids, reset };
}

describe("reset-session", () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });

  it("refuses a session without the label", async () => {
    await expect(ctx.reset({ name: "ghost", githubToken: "ght" })).rejects.toThrow(
      SessionNotFoundError,
    );
  });

  it("throws when the labelled account no longer exists", async () => {
    ctx.engine.seedRunningSession({ name: "s", repo: "o/r", accountId: "gone" });
    await expect(ctx.reset({ name: "s", githubToken: "ght" })).rejects.toThrow(
      AccountNotFoundError,
    );
  });

  it("recreates the session with a fresh SESSION_UUID from the labelled repo/account", async () => {
    ctx.engine.seedRunningSession({ name: "s", repo: "o/r", accountId: "acc-1" });
    await ctx.engine.createVolume(workspaceVolumeName("s"));

    const session = await ctx.reset({ name: "s", githubToken: "ght" });

    expect(session).toEqual({ name: "s", repo: "o/r", accountId: "acc-1", status: "running" });
    expect(ctx.engine.hasVolume(workspaceVolumeName("s"))).toBe(true);
    const spec = ctx.engine.runSessionSpecs.at(-1);
    expect(spec?.env.SESSION_UUID).toBe("uuid-1");
    expect(spec?.repo).toBe("o/r");
  });
});
