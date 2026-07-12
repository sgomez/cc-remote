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
