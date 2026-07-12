import { describe, expect, it } from "vitest";
import { SESSION_LABELS } from "../../core";
import {
  cloneContainerName,
  isSessionLabelled,
  mainContainerName,
  toSessionContainer,
  ttydBasePath,
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
  it("reads name/repo/accountId from labels and passes state through", () => {
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
