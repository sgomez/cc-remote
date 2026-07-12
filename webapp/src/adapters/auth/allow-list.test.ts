import { describe, expect, it } from "vitest";
import { isLoginAllowed, parseAllowList } from "./allow-list";

describe("parseAllowList", () => {
  it("returns an empty list for undefined / null / empty", () => {
    expect(parseAllowList(undefined)).toEqual([]);
    expect(parseAllowList(null)).toEqual([]);
    expect(parseAllowList("")).toEqual([]);
    expect(parseAllowList("   ")).toEqual([]);
  });

  it("splits, trims, and drops blank entries", () => {
    expect(parseAllowList("alice, bob ,  carol")).toEqual(["alice", "bob", "carol"]);
    expect(parseAllowList("alice,,bob,")).toEqual(["alice", "bob"]);
  });
});

describe("isLoginAllowed (fail-closed)", () => {
  it("admits nobody when the allow-list is empty", () => {
    expect(isLoginAllowed("alice", [])).toBe(false);
    expect(isLoginAllowed("anyone", parseAllowList(""))).toBe(false);
  });

  it("admits a listed login", () => {
    expect(isLoginAllowed("alice", ["alice", "bob"])).toBe(true);
  });

  it("rejects an unlisted login", () => {
    expect(isLoginAllowed("mallory", ["alice", "bob"])).toBe(false);
  });

  it("rejects a missing login even against a populated list", () => {
    expect(isLoginAllowed(undefined, ["alice"])).toBe(false);
    expect(isLoginAllowed(null, ["alice"])).toBe(false);
    expect(isLoginAllowed("", ["alice"])).toBe(false);
  });

  it("matches case-sensitively (GitHub canonical login)", () => {
    expect(isLoginAllowed("Alice", ["alice"])).toBe(false);
  });
});
