import { beforeEach, describe, expect, it } from "vitest";
import { FakeAccountRepository } from "../../../test/fake-account-repository";
import { FakeClock } from "../../../test/fake-clock";
import { FakeContainerEngine } from "../../../test/fake-container-engine";
import { FakeIdGenerator } from "../../../test/fake-id-generator";
import { accountConfigVolumeName } from "../domain/account";
import {
  MissingAccountFieldError,
  SingletonAccountExistsError,
  UnknownProviderTypeError,
} from "../domain/errors";
import { ACCOUNT_CONFIG_FILE } from "../domain/seeding";
import { makeRegisterAccount } from "./register-account";

function setup() {
  const accounts = new FakeAccountRepository();
  const engine = new FakeContainerEngine();
  const clock = new FakeClock();
  const ids = new FakeIdGenerator("acc");
  const register = makeRegisterAccount({ accounts, engine, clock, ids });
  return { accounts, engine, clock, ids, register };
}

describe("register-account", () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });

  it("rejects an unknown provider type", async () => {
    await expect(
      ctx.register({ providerType: "glm", displayName: "x", fields: {} }),
    ).rejects.toThrow(UnknownProviderTypeError);
  });

  it("rejects a missing required field", async () => {
    await expect(
      ctx.register({ providerType: "deepseek", displayName: "ds", fields: {} }),
    ).rejects.toThrow(MissingAccountFieldError);
  });

  it("registers an api-key account: ready, volume created and seeded", async () => {
    const account = await ctx.register({
      providerType: "deepseek",
      displayName: "My DeepSeek",
      fields: { apiKey: "sk-ds" },
    });

    expect(account.id).toBe("acc-1");
    expect(account.status).toBe("ready");
    expect(account.credentials).toEqual({ apiKey: "sk-ds" });
    expect(account.config).toEqual({});
    expect(account.createdAt).toEqual(ctx.clock.now());

    const volume = accountConfigVolumeName("acc-1");
    expect(ctx.engine.hasVolume(volume)).toBe(true);
    const seeded = ctx.engine.seededFiles.get(volume)?.get(ACCOUNT_CONFIG_FILE);
    expect(JSON.parse(seeded as string)).toMatchObject({ hasCompletedOnboarding: true });

    // persisted
    expect(await ctx.accounts.findById("acc-1")).not.toBeNull();
  });

  it("splits custom fields into credentials and config", async () => {
    const account = await ctx.register({
      providerType: "custom",
      displayName: "Local LLM",
      fields: { apiKey: "sk-c", baseUrl: "https://llm.example.com", model: "m1" },
    });
    expect(account.credentials).toEqual({ apiKey: "sk-c" });
    expect(account.config).toEqual({ baseUrl: "https://llm.example.com", model: "m1" });
  });

  it("registers an oauth account as pending_login with a seeded volume", async () => {
    const account = await ctx.register({
      providerType: "claude",
      displayName: "Work Claude",
      fields: {},
    });
    expect(account.status).toBe("pending_login");
    expect(ctx.engine.hasVolume(accountConfigVolumeName(account.id))).toBe(true);
  });

  it("registers a host-mount account ready with NO volume", async () => {
    const account = await ctx.register({
      providerType: "claude-local",
      displayName: "Local",
      fields: {},
    });
    expect(account.status).toBe("ready");
    expect(ctx.engine.hasVolume(accountConfigVolumeName(account.id))).toBe(false);
    expect(ctx.engine.volumes.size).toBe(0);
  });

  it("enforces the claude-local singleton", async () => {
    await ctx.register({ providerType: "claude-local", displayName: "one", fields: {} });
    await expect(
      ctx.register({ providerType: "claude-local", displayName: "two", fields: {} }),
    ).rejects.toThrow(SingletonAccountExistsError);
  });

  it("allows many accounts of a non-singleton type", async () => {
    await ctx.register({ providerType: "deepseek", displayName: "a", fields: { apiKey: "1" } });
    await ctx.register({ providerType: "deepseek", displayName: "b", fields: { apiKey: "2" } });
    expect((await ctx.accounts.findAll()).length).toBe(2);
  });
});
