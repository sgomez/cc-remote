import { describe, expect, it } from "vitest";
import {
  accountPickerOptions,
  canCreateSession,
  repoValid,
  sessionNameState,
  slugifySessionName,
} from "./forms";

describe("slugifySessionName", () => {
  it("lowercases and dashes out invalid runs", () => {
    expect(slugifySessionName("API Refactor!!")).toBe("api-refactor");
    expect(slugifySessionName("  Feature/Branch  ")).toBe("feature-branch");
  });

  it("trims edge dashes and keeps underscores and existing dashes", () => {
    expect(slugifySessionName("__weird__")).toBe("__weird__");
    expect(slugifySessionName("-x-")).toBe("x");
  });

  it("caps at 64 chars (the domain NAME_REGEX bound)", () => {
    expect(slugifySessionName("a".repeat(100))).toHaveLength(64);
  });

  it("returns empty for input with no usable characters", () => {
    expect(slugifySessionName("!!!")).toBe("");
  });
});

describe("sessionNameState", () => {
  it("is valid for a fresh, well-formed slug", () => {
    const s = sessionNameState("My Session", []);
    expect(s).toEqual({ slug: "my-session", taken: false, valid: true });
  });

  it("flags a name already in use as taken and invalid", () => {
    const s = sessionNameState("demo", ["demo", "other"]);
    expect(s.taken).toBe(true);
    expect(s.valid).toBe(false);
  });

  it("is invalid (not taken) when the input slugs to empty", () => {
    const s = sessionNameState("###", ["demo"]);
    expect(s.slug).toBe("");
    expect(s.valid).toBe(false);
    expect(s.taken).toBe(false);
  });
});

describe("repoValid", () => {
  it("accepts owner/name and trims surrounding space", () => {
    expect(repoValid("sgomez/cc-remote")).toBe(true);
    expect(repoValid("  acme/webapp  ")).toBe(true);
  });

  it("rejects a bare name or a URL", () => {
    expect(repoValid("cc-remote")).toBe(false);
    expect(repoValid("https://github.com/sgomez/cc-remote")).toBe(false);
  });
});

describe("accountPickerOptions", () => {
  it("marks only ready accounts selectable, greying (not dropping) pending_login", () => {
    const opts = accountPickerOptions([
      { id: "a", displayName: "A", providerType: "claude", status: "ready" },
      { id: "b", displayName: "B", providerType: "claude", status: "pending_login" },
    ]);
    expect(opts).toHaveLength(2); // pending shown, not hidden
    expect(opts.find((o) => o.id === "a")?.selectable).toBe(true);
    expect(opts.find((o) => o.id === "b")?.selectable).toBe(false);
  });
});

describe("canCreateSession", () => {
  const ready = { status: "ready" as const };
  it("requires a valid name, valid repo, and a ready account", () => {
    const nameState = sessionNameState("demo", []);
    expect(canCreateSession({ nameState, repo: "o/r", selectedAccount: ready })).toBe(true);
    expect(canCreateSession({ nameState, repo: "bad", selectedAccount: ready })).toBe(false);
    expect(
      canCreateSession({ nameState, repo: "o/r", selectedAccount: { status: "pending_login" } }),
    ).toBe(false);
    expect(canCreateSession({ nameState, repo: "o/r", selectedAccount: undefined })).toBe(false);
  });
});
