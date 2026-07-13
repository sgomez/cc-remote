import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeContainerEngine } from "../../../test/fake-container-engine";
import { SessionNotFoundError } from "../domain/errors";
import { DEFAULT_LOG_TAIL } from "../domain/session-logs";
import { makeFollowSessionLogs } from "./follow-session-logs";

const ESC = "\u001b";

function spySink() {
  return { onOpen: vi.fn(), onChunk: vi.fn(), onError: vi.fn(), onEnd: vi.fn() };
}

describe("follow-session-logs label guard", () => {
  it("refuses a session without a labelled container, opening no stream", async () => {
    const engine = new FakeContainerEngine();
    const follow = makeFollowSessionLogs({ engine });

    await expect(follow({ name: "ghost" }, spySink())).rejects.toThrow(SessionNotFoundError);
    expect(engine.logFollows).toEqual([]);
  });
});

describe("follow-session-logs", () => {
  let engine: FakeContainerEngine;
  let follow: ReturnType<typeof makeFollowSessionLogs>;
  beforeEach(() => {
    engine = new FakeContainerEngine();
    follow = makeFollowSessionLogs({ engine });
  });

  it("opens a follow on the main container and streams its output", async () => {
    engine.seedRunningSession({ name: "s", repo: "o/r", accountId: "a" });
    const sink = spySink();

    await follow({ name: "s" }, sink);
    engine.lastFollow.sink.onChunk("agent starting\n");
    engine.lastFollow.sink.onChunk("listening\n");

    expect(sink.onOpen).toHaveBeenCalledWith("session");
    expect(sink.onChunk.mock.calls.flat()).toEqual(["agent starting\n", "listening\n"]);
    expect(engine.lastFollow.tail).toBe(DEFAULT_LOG_TAIL);
  });

  // Watching a clone fail in real time is exactly the case this serves.
  it("follows the clone helper when there is no main container", async () => {
    engine.seedCloningSession({ name: "s", repo: "o/r", accountId: "a" });
    const sink = spySink();

    await follow({ name: "s" }, sink);
    engine.lastFollow.sink.onChunk("Cloning into '/workspace'...\n");

    expect(sink.onOpen).toHaveBeenCalledWith("clone");
    expect(sink.onChunk).toHaveBeenCalledWith("Cloning into '/workspace'...\n");
  });

  it("follows a container that is not running", async () => {
    engine.seedSession({ name: "s", repo: "o/r", accountId: "a", state: "exited", exitCode: 1 });

    await expect(follow({ name: "s" }, spySink())).resolves.toBeDefined();
  });

  // Stateful sanitizing: the escape straddles the chunk boundary, which a
  // one-shot read never had to survive.
  it("sanitizes ANSI escapes across chunk boundaries", async () => {
    engine.seedRunningSession({ name: "s", repo: "o/r", accountId: "a" });
    const sink = spySink();
    await follow({ name: "s" }, sink);

    // The colour escape is cut in half by the chunk boundary, and so is the CRLF.
    engine.lastFollow.sink.onChunk(`ready ${ESC}[3`);
    engine.lastFollow.sink.onChunk("2mgreen\r");
    engine.lastFollow.sink.onChunk("\ndone\n");

    // Escape gone, CRLF joined into one newline, not a fragment in sight.
    expect(sink.onChunk.mock.calls.flat().join("")).toBe("ready green\ndone\n");
  });

  it("does not emit a chunk that sanitizes away to nothing", async () => {
    engine.seedRunningSession({ name: "s", repo: "o/r", accountId: "a" });
    const sink = spySink();
    await follow({ name: "s" }, sink);

    engine.lastFollow.sink.onChunk(`${ESC}[0m`);

    expect(sink.onChunk).not.toHaveBeenCalled();
  });

  it("flushes a held-back fragment when the stream ends", async () => {
    engine.seedRunningSession({ name: "s", repo: "o/r", accountId: "a" });
    const sink = spySink();
    await follow({ name: "s" }, sink);

    engine.lastFollow.sink.onChunk("tail\r");
    engine.lastFollow.sink.onEnd();

    expect(sink.onChunk.mock.calls.flat().join("")).toBe("tail\r");
    expect(sink.onEnd).toHaveBeenCalledOnce();
  });

  it("surfaces a stream error", async () => {
    engine.seedRunningSession({ name: "s", repo: "o/r", accountId: "a" });
    const sink = spySink();
    await follow({ name: "s" }, sink);

    const boom = new Error("docker hung up");
    engine.lastFollow.sink.onError(boom);

    expect(sink.onError).toHaveBeenCalledWith(boom);
  });

  it("propagates a failure to open the stream", async () => {
    engine.seedRunningSession({ name: "s", repo: "o/r", accountId: "a" });
    engine.nextFollowError = new Error("docker: 500");

    await expect(follow({ name: "s" }, spySink())).rejects.toThrow("docker: 500");
  });

  // Teardown. A leaked follow per modal open is a real resource bug, and a chunk
  // arriving after close would land on a sink (an SSE controller) that is gone.
  describe("close()", () => {
    it("tears down the engine stream", async () => {
      engine.seedRunningSession({ name: "s", repo: "o/r", accountId: "a" });
      const handle = await follow({ name: "s" }, spySink());

      expect(engine.lastFollow.closed).toBe(false);
      handle.close();
      expect(engine.lastFollow.closed).toBe(true);
    });

    it("silences output that arrives after close", async () => {
      engine.seedRunningSession({ name: "s", repo: "o/r", accountId: "a" });
      const sink = spySink();
      const handle = await follow({ name: "s" }, sink);

      handle.close();
      engine.lastFollow.sink.onChunk("late line\n");
      engine.lastFollow.sink.onEnd();
      engine.lastFollow.sink.onError(new Error("late boom"));

      expect(sink.onChunk).not.toHaveBeenCalled();
      expect(sink.onEnd).not.toHaveBeenCalled();
      expect(sink.onError).not.toHaveBeenCalled();
    });

    it("releases the engine follow when the stream ends on its own", async () => {
      engine.seedRunningSession({ name: "s", repo: "o/r", accountId: "a" });
      await follow({ name: "s" }, spySink());

      engine.lastFollow.sink.onEnd();

      // Not just "stop writing to it" — Docker holds the follow open for the
      // life of the container, so it must actually be released.
      expect(engine.lastFollow.closed).toBe(true);
    });

    it("releases the engine follow when the stream errors", async () => {
      engine.seedRunningSession({ name: "s", repo: "o/r", accountId: "a" });
      await follow({ name: "s" }, spySink());

      engine.lastFollow.sink.onError(new Error("docker hung up"));

      expect(engine.lastFollow.closed).toBe(true);
    });

    // The leak: Docker can end (or fail) the stream while it is still opening,
    // i.e. before we hold its handle. Releasing "the handle we have" would be a
    // no-op there, and the follow would stay attached for the container's life.
    it("releases a follow that ended before its handle came back", async () => {
      engine.seedRunningSession({ name: "s", repo: "o/r", accountId: "a" });
      engine.followHook = (sink) => sink.onEnd();

      await follow({ name: "s" }, spySink());

      expect(engine.lastFollow.closed).toBe(true);
    });

    it("releases a follow that errored before its handle came back", async () => {
      engine.seedRunningSession({ name: "s", repo: "o/r", accountId: "a" });
      engine.followHook = (sink) => sink.onError(new Error("instant boom"));

      await follow({ name: "s" }, spySink());

      expect(engine.lastFollow.closed).toBe(true);
    });

    it("is idempotent", async () => {
      engine.seedRunningSession({ name: "s", repo: "o/r", accountId: "a" });
      const handle = await follow({ name: "s" }, spySink());

      handle.close();
      handle.close();

      expect(engine.logFollows).toHaveLength(1);
    });
  });
});
