import { describe, expect, it } from "vitest";
import { LOGIN_LABELS, SESSION_LABELS } from "../../core";
import {
  cloneContainerName,
  isLoginLabelled,
  isSessionLabelled,
  loginContainerName,
  loginTerminalBasePath,
  mainContainerName,
  toLoginContainer,
  toSessionContainer,
  ttydBasePath,
  ttydWebSocketUrl,
} from "./container-mapping";

describe("container name derivation", () => {
  it("names the main and clone containers from the session name", () => {
    expect(mainContainerName("demo")).toBe("cc-remote-session-demo");
    expect(cloneContainerName("demo")).toBe("cc-remote-session-clone-demo");
  });
});

describe("isSessionLabelled (the guard)", () => {
  it("accepts only containers carrying the session marker label", () => {
    expect(isSessionLabelled({ [SESSION_LABELS.marker]: "true" })).toBe(true);
  });

  it("rejects unlabelled, wrong-valued, and missing label sets", () => {
    expect(isSessionLabelled({ [SESSION_LABELS.marker]: "false" })).toBe(false);
    expect(isSessionLabelled({ other: "true" })).toBe(false);
    expect(isSessionLabelled({})).toBe(false);
    expect(isSessionLabelled(undefined)).toBe(false);
    expect(isSessionLabelled(null)).toBe(false);
  });
});

describe("toSessionContainer", () => {
  it("reads name/repo/accountId from labels and normalises the state", () => {
    const sc = toSessionContainer({
      labels: {
        [SESSION_LABELS.marker]: "true",
        [SESSION_LABELS.name]: "demo",
        [SESSION_LABELS.repo]: "octocat/hello",
        [SESSION_LABELS.accountId]: "acc-1",
      },
      state: "running",
    });
    expect(sc).toEqual({
      name: "demo",
      repo: "octocat/hello",
      accountId: "acc-1",
      state: "running",
      exitCode: null,
      cloning: false,
    });
  });

  it("marks cloning helpers via the cloning label", () => {
    const sc = toSessionContainer({
      labels: {
        [SESSION_LABELS.marker]: "true",
        [SESSION_LABELS.name]: "demo",
        [SESSION_LABELS.repo]: "octocat/hello",
        [SESSION_LABELS.accountId]: "acc-1",
        [SESSION_LABELS.cloning]: "true",
      },
      state: "exited",
    });
    expect(sc.cloning).toBe(true);
    expect(sc.state).toBe("exited");
  });

  it("does not synthesize status — raw state only", () => {
    // A cloning helper that exited is 'exited' here; the domain maps that to
    // 'clone_failed', never the adapter.
    const sc = toSessionContainer({
      labels: { [SESSION_LABELS.cloning]: "true" },
      state: "exited",
    });
    expect(sc.state).toBe("exited");
  });
});

describe("ttydBasePath", () => {
  it("matches the agent image CMD base path", () => {
    expect(ttydBasePath("demo")).toBe("/api/sessions/demo/terminal");
  });
});

describe("login container mapping", () => {
  it("names the login container from the account id", () => {
    expect(loginContainerName("acc-1")).toBe("cc-remote-login-acc-1");
  });

  it("guards on the login marker, distinct from the session marker", () => {
    expect(isLoginLabelled({ [LOGIN_LABELS.marker]: "true" })).toBe(true);
    expect(isLoginLabelled({ [SESSION_LABELS.marker]: "true" })).toBe(false);
    expect(isLoginLabelled({})).toBe(false);
    expect(isLoginLabelled(undefined)).toBe(false);
    expect(isLoginLabelled(null)).toBe(false);
  });

  it("reads the account id from labels and passes state through", () => {
    const lc = toLoginContainer({
      labels: { [LOGIN_LABELS.marker]: "true", [LOGIN_LABELS.accountId]: "acc-1" },
      state: "running",
    });
    expect(lc).toEqual({ accountId: "acc-1", state: "running" });
  });

  it("exposes a login terminal base path mirroring the session one", () => {
    expect(loginTerminalBasePath("acc-1")).toBe("/api/accounts/acc-1/login/terminal");
  });
});

describe("ttydWebSocketUrl", () => {
  it("targets the agent container's ttyd socket on the compose network", () => {
    expect(ttydWebSocketUrl("demo")).toBe(
      "ws://cc-remote-session-demo:7681/api/sessions/demo/terminal/ws",
    );
  });

  it("stays composed from the container name and base path (single source of truth)", () => {
    expect(ttydWebSocketUrl("demo")).toBe(
      `ws://${mainContainerName("demo")}:7681${ttydBasePath("demo")}/ws`,
    );
  });
});
