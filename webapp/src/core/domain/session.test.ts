import { describe, expect, it } from "vitest";
import { InvalidRepoError, InvalidSessionNameError } from "./errors";
import {
  assertValidRepo,
  assertValidSessionName,
  buildSessionLabels,
  type ContainerState,
  isValidRepo,
  isValidSessionName,
  SESSION_LABELS,
  type SessionContainer,
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
    const labels = buildSessionLabels({
      name: "demo",
      repo: "o/r",
      accountId: "acc1",
      permissionMode: "auto",
    });
    expect(labels).toEqual({
      [SESSION_LABELS.marker]: "true",
      [SESSION_LABELS.name]: "demo",
      [SESSION_LABELS.repo]: "o/r",
      [SESSION_LABELS.accountId]: "acc1",
      [SESSION_LABELS.permissionMode]: "auto",
    });
    // The account id label replaces the legacy provider-id label.
    expect(SESSION_LABELS.accountId).toBe("cc-remote-account-id");
  });

  // The label is what lets a reset put the Session back in the mode it was
  // created in, rather than readopting whatever the deployment default is now.
  it("carries the permission mode so a reset can recover it", () => {
    const labels = buildSessionLabels({
      name: "demo",
      repo: "o/r",
      accountId: "acc1",
      permissionMode: "bypassPermissions",
    });
    expect(labels[SESSION_LABELS.permissionMode]).toBe("bypassPermissions");
    expect(SESSION_LABELS.permissionMode).toBe("cc-remote-permission-mode");
  });
});

describe("toSessionStatus", () => {
  const agent = (state: ContainerState, exitCode?: number | null): SessionContainer => ({
    name: "s",
    repo: "o/r",
    accountId: "a",
    state,
    exitCode,
    cloning: false,
    permissionMode: null,
  });
  const clone = (state: ContainerState, exitCode?: number | null): SessionContainer => ({
    ...agent(state, exitCode),
    cloning: true,
    permissionMode: null,
  });

  describe("main agent container", () => {
    it.each([
      ["running", "running"],
      ["created", "starting"],
      ["restarting", "restarting"],
      ["paused", "paused"],
      // Teardown in progress is not a failure — it is a stop that hasn't landed.
      ["removing", "stopped"],
      // Docker could not kill it: the container is broken, not stopped.
      ["dead", "error"],
      ["unknown", "unknown"],
    ] as const)("maps %s to %s", (state, expected) => {
      expect(toSessionStatus(agent(state))).toBe(expected);
    });

    it("maps a clean exit (0) to stopped", () => {
      expect(toSessionStatus(agent("exited", 0))).toBe("stopped");
    });

    it.each([
      // `docker stop` on a PID1 that ignores SIGTERM: SIGKILL after the timeout.
      [137, "SIGKILL after docker stop's timeout"],
      // A PID1 that exits on SIGTERM.
      [143, "graceful SIGTERM exit"],
    ] as const)("maps a signalled exit (%i) to stopped — %s", (code, _why) => {
      expect(toSessionStatus(agent("exited", code))).toBe("stopped");
    });

    it.each([1, 3, 127])("maps a crash exit (%i) to error", (code) => {
      expect(toSessionStatus(agent("exited", code))).toBe("error");
    });

    it.each([
      ["null", null],
      ["absent", undefined],
    ] as const)("maps an exit with a(n) %s exit code to stopped, never error", (_label, code) => {
      expect(toSessionStatus(agent("exited", code))).toBe("stopped");
    });
  });

  describe("clone helper", () => {
    it.each([
      "created",
      "running",
      "restarting",
      "paused",
      // The helper is briefly `removing` on the happy path, between the SSE
      // ticks that drive the list — reporting clone_failed here is the false
      // red flash this mapping exists to kill.
      "removing",
      "unknown",
    ] as const)("keeps a %s helper on cloning", (state) => {
      expect(toSessionStatus(clone(state))).toBe("cloning");
    });

    it("keeps a helper that exited cleanly on cloning (the main container is next)", () => {
      expect(toSessionStatus(clone("exited", 0))).toBe("cloning");
    });

    it.each([1, 128, 137, 143])("reports clone_failed on any non-zero helper exit (%i)", (code) => {
      // Asymmetry with the agent branch, on purpose: a signalled agent was
      // stopped (normal), but a signalled clone never finished (a failure).
      expect(toSessionStatus(clone("exited", code))).toBe("clone_failed");
    });

    it("reports clone_failed on a dead helper", () => {
      expect(toSessionStatus(clone("dead"))).toBe("clone_failed");
    });

    it("stays on cloning when the helper exited with an unreadable exit code", () => {
      expect(toSessionStatus(clone("exited", null))).toBe("cloning");
    });
  });
});
