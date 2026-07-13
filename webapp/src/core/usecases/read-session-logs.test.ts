import { beforeEach, describe, expect, it } from "vitest";
import { FakeContainerEngine } from "../../../test/fake-container-engine";
import { SessionNotFoundError } from "../domain/errors";
import { DEFAULT_LOG_TAIL } from "../domain/session-logs";
import { makeReadSessionLogs } from "./read-session-logs";

describe("read-session-logs label guard", () => {
  it("refuses a session without a labelled container (not found)", async () => {
    const engine = new FakeContainerEngine();
    const read = makeReadSessionLogs({ engine });

    await expect(read({ name: "ghost" })).rejects.toThrow(SessionNotFoundError);
    // The guard must come first: no container was ever read.
    expect(engine.logReads).toEqual([]);
  });
});

describe("read-session-logs", () => {
  let engine: FakeContainerEngine;
  let read: ReturnType<typeof makeReadSessionLogs>;
  beforeEach(() => {
    engine = new FakeContainerEngine();
    read = makeReadSessionLogs({ engine });
  });

  it("reads the main container's logs, tagged as the session's own output", async () => {
    engine.seedRunningSession({ name: "s", repo: "o/r", accountId: "a" });
    engine.nextSessionLogs = "claude: listening for remote control\n";

    expect(await read({ name: "s" })).toEqual({
      text: "claude: listening for remote control\n",
      source: "session",
    });
    expect(engine.logReads).toEqual([{ sessionName: "s", tail: DEFAULT_LOG_TAIL }]);
  });

  // The point of the feature: a container that is NOT running is exactly when
  // logs matter, so the use case must never gate on `state === "running"`.
  it("reads the logs of a crashed container", async () => {
    engine.seedSession({ name: "s", repo: "o/r", accountId: "a", state: "exited", exitCode: 1 });
    engine.nextSessionLogs = "entrypoint.sh: fatal: could not chown /workspace\n";

    expect(await read({ name: "s" })).toEqual({
      text: "entrypoint.sh: fatal: could not chown /workspace\n",
      source: "session",
    });
  });

  it("reads the logs of a stopped container", async () => {
    engine.seedRunningSession({ name: "s", repo: "o/r", accountId: "a" });
    await engine.stopContainer("s");
    engine.nextSessionLogs = "bye\n";

    expect((await read({ name: "s" })).text).toBe("bye\n");
  });

  // A clone_failed session's ONLY container is the helper — its logs are the git
  // clone error, and `source` says so rather than passing them off as the agent's.
  it("falls back to the clone helper's logs, tagged as the clone's output", async () => {
    engine.seedCloningSession({ name: "s", repo: "o/r", accountId: "a" });
    engine.nextSessionLogs = "fatal: repository 'https://github.com/o/r' not found\n";

    expect(await read({ name: "s" })).toEqual({
      text: "fatal: repository 'https://github.com/o/r' not found\n",
      source: "clone",
    });
    expect(engine.logReads).toEqual([{ sessionName: "s", tail: DEFAULT_LOG_TAIL }]);
  });

  it("honours a caller-supplied tail size", async () => {
    engine.seedRunningSession({ name: "s", repo: "o/r", accountId: "a" });

    await read({ name: "s", tail: 50 });

    expect(engine.logReads).toEqual([{ sessionName: "s", tail: 50 }]);
  });

  // The adapter hands over raw TTY bytes; the panel renders text, so the escape
  // soup must be gone by the time it leaves the core.
  it("strips ANSI escapes from the container's raw output", async () => {
    engine.seedSession({ name: "s", repo: "o/r", accountId: "a", state: "exited", exitCode: 1 });
    engine.nextSessionLogs = "\u001b[0m\u001b[35;1m[11:23:16] N: boom\u001b[0m\r\n";

    expect(await read({ name: "s" })).toEqual({
      text: "[11:23:16] N: boom\n",
      source: "session",
    });
  });

  it("returns empty text for a container that has logged nothing", async () => {
    engine.seedRunningSession({ name: "s", repo: "o/r", accountId: "a" });
    engine.nextSessionLogs = "";

    expect(await read({ name: "s" })).toEqual({ text: "", source: "session" });
  });

  // A failed read must surface as a failure, not as "no logs" — the UI renders
  // an honest error instead of an empty box.
  it("propagates a read failure rather than reporting empty logs", async () => {
    engine.seedRunningSession({ name: "s", repo: "o/r", accountId: "a" });
    engine.nextSessionLogs = new Error("docker: 500 server error");

    await expect(read({ name: "s" })).rejects.toThrow("docker: 500 server error");
  });
});
