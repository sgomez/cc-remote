// Shared AccountRepository contract. Run against BOTH the in-memory fake (#11)
// and the SQLite MikroORM adapter (#12) so the fake stays an honest stand-in and
// the adapter honours the exact port semantics use cases rely on.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Account } from "../src/core/domain/account";
import type { AccountRepository } from "../src/core/ports/account-repository";

export type RepoHarness = {
  repo: AccountRepository;
  teardown: () => Promise<void>;
};

function sampleAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: "acc-1",
    providerType: "custom",
    displayName: "My Account",
    credentials: { apiKey: "sk-secret" },
    config: { baseUrl: "https://llm.example.com", model: "m1" },
    status: "ready",
    createdAt: new Date("2026-07-12T10:30:00.123Z"),
    ...overrides,
  };
}

export function runAccountRepositoryContract(
  label: string,
  createHarness: () => Promise<RepoHarness>,
) {
  describe(`AccountRepository contract: ${label}`, () => {
    let harness: RepoHarness;
    let repo: AccountRepository;

    beforeEach(async () => {
      harness = await createHarness();
      repo = harness.repo;
    });

    afterEach(async () => {
      await harness.teardown();
    });

    it("round-trips every field through create + findById", async () => {
      const account = sampleAccount();
      await repo.create(account);

      const loaded = await repo.findById(account.id);
      expect(loaded).toEqual(account);
    });

    it("returns null for an unknown id", async () => {
      expect(await repo.findById("nope")).toBeNull();
    });

    it("lists all persisted accounts", async () => {
      await repo.create(sampleAccount({ id: "acc-1", displayName: "A" }));
      await repo.create(sampleAccount({ id: "acc-2", displayName: "B" }));

      const all = await repo.findAll();
      expect(all.map((a) => a.id).sort()).toEqual(["acc-1", "acc-2"]);
    });

    it("returns an empty list when nothing is stored", async () => {
      expect(await repo.findAll()).toEqual([]);
    });

    it("persists updated fields", async () => {
      await repo.create(sampleAccount({ status: "pending_login" }));

      const updated = sampleAccount({
        status: "ready",
        displayName: "Renamed",
        credentials: { apiKey: "sk-rotated" },
      });
      await repo.update(updated);

      expect(await repo.findById("acc-1")).toEqual(updated);
    });

    it("deletes an account", async () => {
      await repo.create(sampleAccount());
      await repo.delete("acc-1");
      expect(await repo.findById("acc-1")).toBeNull();
    });

    it("does not blow up deleting an unknown id", async () => {
      await expect(repo.delete("ghost")).resolves.toBeUndefined();
    });

    it("rejects a duplicate id on create", async () => {
      await repo.create(sampleAccount());
      await expect(repo.create(sampleAccount())).rejects.toThrow();
    });

    it("rejects updating an unknown account", async () => {
      await expect(repo.update(sampleAccount({ id: "missing" }))).rejects.toThrow();
    });
  });
}
