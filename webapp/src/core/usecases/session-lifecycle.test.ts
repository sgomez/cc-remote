import { beforeEach, describe, expect, it } from "vitest";
import { FakeContainerEngine } from "../../../test/fake-container-engine";
import { SessionNotFoundError } from "../domain/errors";
import { workspaceVolumeName } from "../domain/session";
import { makeDestroySession } from "./destroy-session";
import { makeStartSession } from "./start-session";
import { makeStopSession } from "./stop-session";

describe("start/stop/destroy-session label guard", () => {
  let engine: FakeContainerEngine;
  beforeEach(() => {
    engine = new FakeContainerEngine();
  });

  it("start refuses a session without the label (not found)", async () => {
    const start = makeStartSession({ engine });
    await expect(start({ name: "ghost" })).rejects.toThrow(SessionNotFoundError);
  });

  it("stop refuses a session without the label (not found)", async () => {
    const stop = makeStopSession({ engine });
    await expect(stop({ name: "ghost" })).rejects.toThrow(SessionNotFoundError);
  });

  it("destroy refuses a session without the label (not found)", async () => {
    const destroy = makeDestroySession({ engine });
    await expect(destroy({ name: "ghost" })).rejects.toThrow(SessionNotFoundError);
  });
});

describe("start-session", () => {
  it("starts a labelled session container", async () => {
    const engine = new FakeContainerEngine();
    engine.seedRunningSession({ name: "s", repo: "o/r", accountId: "a" });
    await engine.stopContainer("s");
    await makeStartSession({ engine })({ name: "s" });
    expect((await engine.getSessionContainer("s"))?.state).toBe("running");
  });
});

describe("stop-session", () => {
  it("stops a labelled session container", async () => {
    const engine = new FakeContainerEngine();
    engine.seedRunningSession({ name: "s", repo: "o/r", accountId: "a" });
    await makeStopSession({ engine })({ name: "s" });
    expect((await engine.getSessionContainer("s"))?.state).toBe("exited");
  });

  // The bug this guards against: a double-click, a stale UI, two SSE-driven
  // clients, or a container that crashed between page render and click all
  // route a second `stop` at an already-stopped session. Without the guard,
  // the second call reaches the engine and (against a real Docker daemon)
  // throws the 304 "already stopped" — surfacing an error for something that
  // was already the user's stated intent.
  it("stopping an already-stopped session again is a silent no-op (double-click / stale UI)", async () => {
    const engine = new FakeContainerEngine();
    engine.seedRunningSession({ name: "s", repo: "o/r", accountId: "a" });
    const stop = makeStopSession({ engine });

    await stop({ name: "s" });
    await expect(stop({ name: "s" })).resolves.toBeUndefined();
  });

  // "Already effectively stopped" states: none of these need an actual
  // `stopContainer` call. The fake throws if the use case calls it anyway
  // (see FakeContainerEngine#stopContainer), which is what makes these tests
  // meaningful rather than vacuous.
  it.each([
    "created",
    "exited",
    "dead",
    "removing",
  ] as const)("is a silent no-op for a container that is already %s", async (state) => {
    const engine = new FakeContainerEngine();
    engine.seedSession({ name: "s", repo: "o/r", accountId: "a", state });

    await expect(makeStopSession({ engine })({ name: "s" })).resolves.toBeUndefined();
    // Unchanged: proves stopContainer (which would throw for this state) was
    // never called.
    expect((await engine.getSessionContainer("s"))?.state).toBe(state);
  });

  // "Still up" states: Docker's `Running` flag holds for both, so a stop call
  // is not redundant — it is what actually brings the container down.
  it("actually stops a paused container (paused is still up, not already stopped)", async () => {
    const engine = new FakeContainerEngine();
    engine.seedSession({ name: "s", repo: "o/r", accountId: "a", state: "paused" });

    await makeStopSession({ engine })({ name: "s" });
    expect((await engine.getSessionContainer("s"))?.state).toBe("exited");
  });

  it("actually stops a restarting container (mid crash-loop, not already stopped)", async () => {
    const engine = new FakeContainerEngine();
    engine.seedSession({ name: "s", repo: "o/r", accountId: "a", state: "restarting" });

    await makeStopSession({ engine })({ name: "s" });
    expect((await engine.getSessionContainer("s"))?.state).toBe("exited");
  });

  // `unknown` must never be treated as "already stopped" by assumption — the
  // domain deliberately refuses to read an unrecognized state as safe to skip.
  it("attempts to stop a container in an unrecognized state, rather than assuming it's already stopped", async () => {
    const engine = new FakeContainerEngine();
    engine.seedSession({ name: "s", repo: "o/r", accountId: "a", state: "unknown" });

    await makeStopSession({ engine })({ name: "s" });
    expect((await engine.getSessionContainer("s"))?.state).toBe("exited");
  });
});

describe("destroy-session", () => {
  it("removes the container and its workspace volume", async () => {
    const engine = new FakeContainerEngine();
    engine.seedRunningSession({ name: "s", repo: "o/r", accountId: "a" });
    await engine.createVolume(workspaceVolumeName("s"));

    await makeDestroySession({ engine })({ name: "s" });

    expect(await engine.getSessionContainer("s")).toBeNull();
    expect(engine.hasVolume(workspaceVolumeName("s"))).toBe(false);
  });
});
