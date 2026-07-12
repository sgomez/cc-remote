import { beforeEach, describe, expect, it } from "vitest";
import { FakeAccountRepository } from "../../../test/fake-account-repository";
import { FakeContainerEngine } from "../../../test/fake-container-engine";
import { FakeIdGenerator } from "../../../test/fake-id-generator";
import type { Account } from "../domain/account";
import { accountConfigVolumeName } from "../domain/account";
import {
  AccountNotFoundError,
  AccountNotReadyError,
  CloneFailedError,
  InvalidRepoError,
  InvalidSessionNameError,
  SessionExistsError,
} from "../domain/errors";
import { SESSION_LABELS, workspaceVolumeName } from "../domain/session";
import { makeCreateSession } from "./create-session";

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

function setup(seed: Account[] = [account()]) {
  const accounts = new FakeAccountRepository(seed);
  const engine = new FakeContainerEngine();
  const ids = new FakeIdGenerator("uuid");
  const create = makeCreateSession({ accounts, engine, ids });
  return { accounts, engine, ids, create };
}

const input = { name: "s1", repo: "o/r", accountId: "acc-1", githubToken: "ght" };

describe("create-session", () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });

  it("validates the session name and repo", async () => {
    await expect(ctx.create({ ...input, name: "bad name" })).rejects.toThrow(
      InvalidSessionNameError,
    );
    await expect(ctx.create({ ...input, repo: "noslash" })).rejects.toThrow(InvalidRepoError);
  });

  it("rejects an unknown or not-ready account", async () => {
    await expect(ctx.create({ ...input, accountId: "nope" })).rejects.toThrow(AccountNotFoundError);

    const pending = setup([account({ id: "acc-2", status: "pending_login" })]);
    await expect(pending.create({ ...input, accountId: "acc-2" })).rejects.toThrow(
      AccountNotReadyError,
    );
  });

  it("refuses a duplicate session name", async () => {
    ctx.engine.seedRunningSession({ name: "s1", repo: "o/r", accountId: "acc-1" });
    await expect(ctx.create(input)).rejects.toThrow(SessionExistsError);
  });

  it("provisions the workspace volume and runs the main container two-phase", async () => {
    const session = await ctx.create(input);
    expect(session).toEqual({ name: "s1", repo: "o/r", accountId: "acc-1", status: "running" });

    expect(ctx.engine.hasVolume(workspaceVolumeName("s1"))).toBe(true);
    // clone helper was removed after a clean exit
    expect(await ctx.engine.getSessionContainer("s1")).toMatchObject({ cloning: false });

    const spec = ctx.engine.runSessionSpecs[0];
    expect(spec.labels[SESSION_LABELS.accountId]).toBe("acc-1");
    expect(spec.env.SESSION_UUID).toBe("uuid-1");
    expect(spec.env.ANTHROPIC_AUTH_TOKEN).toBe("sk-ds");
    expect(spec.accountConfigVolume).toBe("cc-remote-account-acc-1");
    expect(spec.remoteControl).toBe(false);
  });

  it("leaves the clone helper (clone_failed) and no main container when clone fails", async () => {
    ctx.engine.nextCloneExit = 1;
    await expect(ctx.create(input)).rejects.toThrow(CloneFailedError);
    expect(ctx.engine.runSessionSpecs).toHaveLength(0);
    const container = await ctx.engine.getSessionContainer("s1");
    expect(container).toMatchObject({ cloning: true, state: "exited" });
  });

  it("mounts the account's config volume and carries its remote-control capability", async () => {
    const oauth = setup([account({ id: "oauth-1", providerType: "claude", credentials: {} })]);
    await oauth.create({ ...input, accountId: "oauth-1" });
    expect(oauth.engine.runSessionSpecs[0].accountConfigVolume).toBe(
      accountConfigVolumeName("oauth-1"),
    );
    expect(oauth.engine.runSessionSpecs[0].remoteControl).toBe(true);
  });
});
