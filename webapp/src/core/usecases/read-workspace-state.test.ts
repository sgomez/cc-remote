import { beforeEach, describe, expect, it } from "vitest";
import { FakeContainerEngine } from "../../../test/fake-container-engine";
import { SessionNotFoundError } from "../domain/errors";
import { WORKSPACE_PROBE_SEPARATOR } from "../domain/workspace-state";
import { makeReadWorkspaceState } from "./read-workspace-state";

const SEP = WORKSPACE_PROBE_SEPARATOR;

describe("read-workspace-state label guard", () => {
  let engine: FakeContainerEngine;
  beforeEach(() => {
    engine = new FakeContainerEngine();
  });

  it("refuses a session without the label (not found)", async () => {
    const read = makeReadWorkspaceState({ engine });
    await expect(read({ name: "ghost" })).rejects.toThrow(SessionNotFoundError);
  });
});

describe("read-workspace-state", () => {
  let engine: FakeContainerEngine;
  let read: ReturnType<typeof makeReadWorkspaceState>;
  beforeEach(() => {
    engine = new FakeContainerEngine();
    read = makeReadWorkspaceState({ engine });
  });

  it("returns unknown (stopped) for a stopped container, without probing", async () => {
    engine.seedRunningSession({ name: "s", repo: "o/r", accountId: "a" });
    await engine.stopContainer("s");

    expect(await read({ name: "s" })).toEqual({ kind: "unknown", reason: "stopped" });
    // A stopped container cannot be exec'd — the probe must not be attempted.
    expect(engine.probedWorkspaces).toEqual([]);
  });

  it("returns unknown (unavailable) while the clone helper is still running", async () => {
    engine.seedCloningSession({ name: "s", repo: "o/r", accountId: "a" });

    expect(await read({ name: "s" })).toEqual({ kind: "unknown", reason: "unavailable" });
    expect(engine.probedWorkspaces).toEqual([]);
  });

  it("reports clean when the probe says clean", async () => {
    engine.seedRunningSession({ name: "s", repo: "o/r", accountId: "a" });
    engine.nextWorkspaceProbe = { exitCode: 0, output: `${SEP}\n0\n` };

    expect(await read({ name: "s" })).toEqual({ kind: "clean" });
    expect(engine.probedWorkspaces).toEqual(["s"]);
  });

  it("reports dirty with counts when the probe says dirty", async () => {
    engine.seedRunningSession({ name: "s", repo: "o/r", accountId: "a" });
    engine.nextWorkspaceProbe = { exitCode: 0, output: ` M a\n?? b\n${SEP}\n2\n` };

    expect(await read({ name: "s" })).toEqual({ kind: "dirty", dirtyFiles: 2, aheadCommits: 2 });
  });

  it("returns unknown (unavailable) when the probe throws (exec/infra failure)", async () => {
    engine.seedRunningSession({ name: "s", repo: "o/r", accountId: "a" });
    engine.nextWorkspaceProbe = new Error("exec failed");

    expect(await read({ name: "s" })).toEqual({ kind: "unknown", reason: "unavailable" });
  });

  it("returns unknown (unavailable) when git failed inside the container (non-zero exit)", async () => {
    engine.seedRunningSession({ name: "s", repo: "o/r", accountId: "a" });
    engine.nextWorkspaceProbe = { exitCode: 3, output: "" };

    expect(await read({ name: "s" })).toEqual({ kind: "unknown", reason: "unavailable" });
  });
});
