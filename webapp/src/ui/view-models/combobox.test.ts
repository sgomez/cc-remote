import { describe, expect, it } from "vitest";
import { comboboxEmptyState, filterOptions, highlightMatch, moveActiveIndex } from "./combobox";

describe("filterOptions", () => {
  const repos = ["sgomez/cc-remote", "sgomez/webapp-ui", "acme/tools"];

  it("returns everything for an empty (or whitespace-only) query", () => {
    expect(filterOptions(repos, "")).toEqual(repos);
    expect(filterOptions(repos, "   ")).toEqual(repos);
  });

  it("matches anywhere in owner/name, case-insensitively", () => {
    expect(filterOptions(repos, "cc-remote")).toEqual(["sgomez/cc-remote"]);
    expect(filterOptions(repos, "SGOMEZ")).toEqual(["sgomez/cc-remote", "sgomez/webapp-ui"]);
    expect(filterOptions(repos, "webapp")).toEqual(["sgomez/webapp-ui"]);
  });

  it("returns an empty array when nothing matches", () => {
    expect(filterOptions(repos, "nonexistent")).toEqual([]);
  });

  it("does not mutate the input array", () => {
    const copy = [...repos];
    filterOptions(repos, "");
    expect(repos).toEqual(copy);
  });
});

describe("highlightMatch", () => {
  it("returns a single unmatched segment for an empty query", () => {
    expect(highlightMatch("sgomez/cc-remote", "")).toEqual([
      { text: "sgomez/cc-remote", matched: false },
    ]);
  });

  it("splits into before/match/after segments, case-insensitively", () => {
    expect(highlightMatch("sgomez/cc-remote", "cc-remote")).toEqual([
      { text: "sgomez/", matched: false },
      { text: "cc-remote", matched: true },
    ]);
    expect(highlightMatch("sgomez/cc-remote", "CC-REMOTE")).toEqual([
      { text: "sgomez/", matched: false },
      { text: "cc-remote", matched: true },
    ]);
  });

  it("matches in the middle, keeping both surrounding segments", () => {
    expect(highlightMatch("acme/cc-remote-fork", "remote")).toEqual([
      { text: "acme/cc-", matched: false },
      { text: "remote", matched: true },
      { text: "-fork", matched: false },
    ]);
  });

  it("falls back to a single unmatched segment when the query doesn't occur", () => {
    expect(highlightMatch("acme/tools", "zzz")).toEqual([{ text: "acme/tools", matched: false }]);
  });
});

describe("moveActiveIndex", () => {
  it("from -1 (nothing highlighted), Down lands on the first option and Up on the last", () => {
    expect(moveActiveIndex(-1, 1, 3)).toBe(0);
    expect(moveActiveIndex(-1, -1, 3)).toBe(2);
  });

  it("wraps around both ends", () => {
    expect(moveActiveIndex(2, 1, 3)).toBe(0);
    expect(moveActiveIndex(0, -1, 3)).toBe(2);
  });

  it("steps by one within bounds", () => {
    expect(moveActiveIndex(0, 1, 3)).toBe(1);
    expect(moveActiveIndex(1, -1, 3)).toBe(0);
  });

  it("is always -1 when there are no options", () => {
    expect(moveActiveIndex(-1, 1, 0)).toBe(-1);
    expect(moveActiveIndex(-1, -1, 0)).toBe(-1);
  });
});

describe("comboboxEmptyState", () => {
  it("is 'no-options' when nothing was ever available", () => {
    expect(comboboxEmptyState(0, [])).toBe("no-options");
  });

  it("is 'no-matches' when options exist but the filter matches none", () => {
    expect(comboboxEmptyState(3, [])).toBe("no-matches");
  });

  it("is null when there are matches to render", () => {
    expect(comboboxEmptyState(3, ["acme/tools"])).toBeNull();
  });
});
