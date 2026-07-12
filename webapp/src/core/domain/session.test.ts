import { describe, expect, it } from "vitest";
import { InvalidRepoError, InvalidSessionNameError } from "./errors";
import {
  assertValidRepo,
  assertValidSessionName,
  buildSessionLabels,
  isValidRepo,
  isValidSessionName,
  SESSION_LABELS,
  toSessionStatus,
  workspaceVolumeName,
} from "./session";

describe("session name validation", () => {
  it("accepts alphanumerics, dashes and underscores up to 64 chars", () => {
    expect(isValidSessionName("my-session_1")).toBe(true);
    expect(isValidSessionName("a".repeat(64))).toBe(true);
  });

  it("rejects empty, over-long, or unsafe names", () => {
    expect(isValidSessionName("")).toBe(false);
    expect(isValidSessionName("a".repeat(65))).toBe(false);
    expect(isValidSessionName("has space")).toBe(false);
    expect(isValidSessionName("../etc")).toBe(false);
  });

  it("assertValidSessionName throws a domain error on bad input", () => {
    expect(() => assertValidSessionName("bad name")).toThrow(InvalidSessionNameError);
    expect(() => assertValidSessionName("ok")).not.toThrow();
  });
});

describe("repo validation", () => {
  it("accepts owner/repo shapes", () => {
    expect(isValidRepo("sgomez/cc-remote")).toBe(true);
    expect(isValidRepo("a.b_c-d/e.f_g-h")).toBe(true);
  });

  it("rejects anything without exactly one owner/repo split", () => {
    expect(isValidRepo("noslash")).toBe(false);
    expect(isValidRepo("a/b/c")).toBe(false);
    expect(isValidRepo("owner/")).toBe(false);
    expect(isValidRepo("has space/repo")).toBe(false);
  });

  it("assertValidRepo throws a domain error on bad input", () => {
    expect(() => assertValidRepo("noslash")).toThrow(InvalidRepoError);
  });
});

describe("session naming and labels", () => {
  it("names the workspace volume after the session", () => {
    expect(workspaceVolumeName("demo")).toBe("cc-remote-workspace-demo");
  });

  it("builds the canonical session labels including the account id", () => {
    const labels = buildSessionLabels({ name: "demo", repo: "o/r", accountId: "acc1" });
    expect(labels).toEqual({
      [SESSION_LABELS.marker]: "true",
      [SESSION_LABELS.name]: "demo",
      [SESSION_LABELS.repo]: "o/r",
      [SESSION_LABELS.accountId]: "acc1",
    });
    // The account id label replaces the legacy provider-id label.
    expect(SESSION_LABELS.accountId).toBe("cc-remote-account-id");
  });
});

describe("toSessionStatus", () => {
  it("maps a running main container to running", () => {
    expect(
      toSessionStatus({ name: "s", repo: "o/r", accountId: "a", state: "running", cloning: false }),
    ).toBe("running");
  });

  it("maps a non-running main container to stopped", () => {
    expect(
      toSessionStatus({ name: "s", repo: "o/r", accountId: "a", state: "exited", cloning: false }),
    ).toBe("stopped");
  });

  it("synthesizes cloning from a running clone helper", () => {
    expect(
      toSessionStatus({ name: "s", repo: "o/r", accountId: "a", state: "running", cloning: true }),
    ).toBe("cloning");
  });

  it("synthesizes clone_failed from an exited clone helper", () => {
    expect(
      toSessionStatus({ name: "s", repo: "o/r", accountId: "a", state: "exited", cloning: true }),
    ).toBe("clone_failed");
  });
});
