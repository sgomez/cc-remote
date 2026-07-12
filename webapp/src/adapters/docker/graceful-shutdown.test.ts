import { describe, expect, it, vi } from "vitest";
import { FakeContainerEngine } from "../../../test/fake-container-engine";
import { stopRunningSessions } from "./graceful-shutdown";

describe("stopRunningSessions", () => {
  it("stops every running main session container", async () => {
    const engine = new FakeContainerEngine();
    engine.seedRunningSession({ name: "a", repo: "o/a", accountId: "acc-1" });
    engine.seedRunningSession({ name: "b", repo: "o/b", accountId: "acc-1" });

    const stopped = await stopRunningSessions(engine);

    expect(stopped.sort()).toEqual(["a", "b"]);
    const after = await engine.listSessionContainers();
    expect(after.every((c) => c.state !== "running")).toBe(true);
  });

  it("ignores clone helpers and already-stopped containers", async () => {
    const engine = new FakeContainerEngine();
    engine.seedRunningSession({ name: "a", repo: "o/a", accountId: "acc-1" });
    await engine.stopContainer("a");
    // A running clone helper (cloning=true) must not be counted.
    await engine.runCloneContainer({
      sessionName: "c",
      repo: "o/c",
      accountId: "acc-1",
      workspaceVolume: "cc-remote-workspace-c",
      env: {},
      labels: {},
    });

    const stopped = await stopRunningSessions(engine);

    expect(stopped).toEqual([]);
  });

  it("is best-effort: one failure does not abort the rest", async () => {
    const engine = new FakeContainerEngine();
    engine.seedRunningSession({ name: "a", repo: "o/a", accountId: "acc-1" });
    engine.seedRunningSession({ name: "b", repo: "o/b", accountId: "acc-1" });
    const stop = vi.spyOn(engine, "stopContainer");
    stop.mockRejectedValueOnce(new Error("boom"));

    const stopped = await stopRunningSessions(engine);

    // 'a' threw, 'b' still stopped.
    expect(stopped).toHaveLength(1);
    expect(stop).toHaveBeenCalledTimes(2);
  });
});
