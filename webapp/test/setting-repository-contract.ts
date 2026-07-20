// Shared SettingRepository contract. Run against BOTH the in-memory fake and the
// SQLite MikroORM adapter, modelled on the AccountRepository contract, so the
// fake stays an honest stand-in and the adapter honours the exact semantics the
// settings use cases rely on — above all "absent key returns null", which is
// what makes a deployment that never opened Settings behave as it did before.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SettingRepository } from "../src/core/ports/setting-repository";

export type SettingRepoHarness = {
  repo: SettingRepository;
  teardown: () => Promise<void>;
};

export function runSettingRepositoryContract(
  label: string,
  createHarness: () => Promise<SettingRepoHarness>,
) {
  describe(`SettingRepository contract: ${label}`, () => {
    let harness: SettingRepoHarness;
    let repo: SettingRepository;

    beforeEach(async () => {
      harness = await createHarness();
      repo = harness.repo;
    });

    afterEach(async () => {
      await harness.teardown();
    });

    it("returns null for a key that was never written", async () => {
      expect(await repo.get("defaultPermissionMode")).toBeNull();
    });

    it("round-trips a stored value", async () => {
      await repo.set("defaultPermissionMode", "bypassPermissions");
      expect(await repo.get("defaultPermissionMode")).toBe("bypassPermissions");
    });

    it("overwrites an existing value rather than failing or duplicating", async () => {
      await repo.set("defaultPermissionMode", "auto");
      await repo.set("defaultPermissionMode", "bypassPermissions");
      expect(await repo.get("defaultPermissionMode")).toBe("bypassPermissions");
    });

    it("keeps keys independent", async () => {
      await repo.set("a", "1");
      await repo.set("b", "2");
      expect(await repo.get("a")).toBe("1");
      expect(await repo.get("b")).toBe("2");
    });

    it("stores the empty string as a value, distinct from absent", async () => {
      await repo.set("empty", "");
      expect(await repo.get("empty")).toBe("");
      expect(await repo.get("never-written")).toBeNull();
    });
  });
}
