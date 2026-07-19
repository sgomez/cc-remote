import { beforeEach, describe, expect, it } from "vitest";
import { FakeAccountRepository } from "../../../test/fake-account-repository";
import { FakeBrokerSecretRegistry } from "../../../test/fake-broker-secret-registry";
import { FakeContainerEngine } from "../../../test/fake-container-engine";
import { FakeGitHubTokenIssuer } from "../../../test/fake-github-token-issuer";
import { FakeIdGenerator } from "../../../test/fake-id-generator";
import type { Account } from "../domain/account";
import { accountConfigVolumeName } from "../domain/account";
import {
  AccountNotFoundError,
  AccountNotReadyError,
  CloneFailedError,
  InvalidRepoError,
  InvalidSessionNameError,
  RepositoryNotGrantedError,
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
  const cloneIssuer = new FakeGitHubTokenIssuer();
  const secretRegistry = new FakeBrokerSecretRegistry();
  // Seed a default "all" installation so existing tests still pass.
  cloneIssuer.installations = [
    {
      id: 1,
      account: { login: "o", avatarUrl: "", type: "User" },
      repositorySelection: "all",
      repositories: [],
      htmlUrl: "",
    },
  ];
  const create = makeCreateSession({
    accounts,
    engine,
    ids,
    cloneIssuer,
    secretRegistry,
    brokerUrl: "http://broker:4001",
  });
  return { accounts, engine, ids, cloneIssuer, secretRegistry, create };
}

const commitIdentity = {
  name: "Sergio Gómez",
  email: "580701+sgomez@users.noreply.github.com",
};
const input = { name: "s1", repo: "o/r", accountId: "acc-1", commitIdentity };

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

  it("accepts a repo covered by an 'all' installation", async () => {
    ctx.cloneIssuer.installations = [
      {
        id: 1,
        account: { login: "o", avatarUrl: "", type: "User" },
        repositorySelection: "all",
        repositories: [],
        htmlUrl: "",
      },
    ];
    await expect(ctx.create(input)).resolves.toMatchObject({ name: "s1" });
  });

  it("refuses a repo covered by an 'all' installation of another owner", async () => {
    ctx.cloneIssuer.installations = [
      {
        id: 1,
        account: { login: "other-owner", avatarUrl: "", type: "User" },
        repositorySelection: "all",
        repositories: [],
        htmlUrl: "",
      },
    ];
    await expect(ctx.create(input)).rejects.toThrow(RepositoryNotGrantedError);
  });

  it("handles case-insensitive repository and owner matching", async () => {
    ctx.cloneIssuer.installations = [
      {
        id: 1,
        account: { login: "O", avatarUrl: "", type: "User" },
        repositorySelection: "selected",
        repositories: ["O/R"],
        htmlUrl: "",
      },
    ];
    await expect(ctx.create({ ...input, repo: "o/r" })).resolves.toMatchObject({ name: "s1" });
  });

  it("accepts a repo in a 'selected' installation's repository list", async () => {
    ctx.cloneIssuer.installations = [
      {
        id: 1,
        account: { login: "o", avatarUrl: "", type: "User" },
        repositorySelection: "selected",
        repositories: ["o/r", "o/other"],
        htmlUrl: "",
      },
    ];
    await expect(ctx.create(input)).resolves.toMatchObject({ name: "s1" });
  });

  it("refuses a repo not in any installation", async () => {
    ctx.cloneIssuer.installations = [];
    await expect(ctx.create(input)).rejects.toThrow(RepositoryNotGrantedError);
  });

  it("refuses a repo outside a 'selected' installation's repository list", async () => {
    ctx.cloneIssuer.installations = [
      {
        id: 1,
        account: { login: "o", avatarUrl: "", type: "User" },
        repositorySelection: "selected",
        repositories: ["other/repo"],
        htmlUrl: "",
      },
    ];
    await expect(ctx.create(input)).rejects.toThrow(RepositoryNotGrantedError);
  });

  it("calls listInstallations to check the grant before provisioning", async () => {
    ctx.cloneIssuer.installations = [
      {
        id: 1,
        account: { login: "o", avatarUrl: "", type: "User" },
        repositorySelection: "all",
        repositories: [],
        htmlUrl: "",
      },
    ];
    await ctx.create(input);
    expect(ctx.cloneIssuer.listInstallationsCalls).toBe(1);
  });

  it("throws RepositoryNotGrantedError before provisioning any containers", async () => {
    // No installations seeded — the grant check should fail before any
    // container or volume is created.
    ctx.cloneIssuer.installations = [];
    await expect(ctx.create(input)).rejects.toThrow(RepositoryNotGrantedError);
    expect(ctx.engine.runSessionSpecs).toHaveLength(0);
    expect(ctx.engine.volumes.size).toBe(0);
  });

  it("provisions the workspace volume and runs the main container two-phase", async () => {
    const session = await ctx.create(input);
    expect(session).toEqual({ name: "s1", repo: "o/r", accountId: "acc-1", status: "running" });

    expect(ctx.cloneIssuer.issuedRepos).toEqual(["o/r"]);

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

  it("registers the broker secret and injects broker env vars", async () => {
    await ctx.create(input);
    // The FakeIdGenerator returns "secret-uuid-1" for newSecret().
    expect(ctx.secretRegistry.lookedUpSecrets).toHaveLength(0); // lookup, not register

    const spec = ctx.engine.runSessionSpecs[0];
    expect(spec.env.CC_BROKER_SECRET).toBe("secret-uuid-1");
    expect(spec.env.CC_BROKER_URL).toBe("http://broker:4001");
    // The durable token is gone — git credentials are fetched on demand from the broker.
    expect(spec.env.GITHUB_TOKEN).toBeUndefined();
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
