// The SSE log stream's delivery logic, against the FakeContainerEngine — no
// Docker. This is where the stream's behaviour is actually pinned down: the
// guards, the event framing, and (the part that would otherwise leak a socket
// per modal open) the teardown when the client goes away.
//
// The real-daemon check lives in test/log-stream.integration.test.ts and is run
// once before delivering; it proves Docker really streams. Everything about how
// we FRAME and TEAR DOWN that stream is provable here, in the fast gate.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeContainerEngine } from "../../test/fake-container-engine";

const engine = new FakeContainerEngine();
const requireSession = vi.fn(async (_headers: Headers) => ({ user: { id: "u" } }));

vi.mock("~/adapters/auth", () => ({
  requireSession: (headers: Headers) => requireSession(headers),
  getGithubAccessToken: vi.fn(async () => "token"),
}));
vi.mock("~/server/runtime", () => ({
  containerEngine: () => engine,
}));

const { logStreamResponse } = await import("./log-stream");

/** Read the SSE body until `until` matches or the stream ends. */
async function readSse(res: Response, until: (t: string) => boolean): Promise<string> {
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  let text = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
    if (until(text)) break;
  }
  reader.releaseLock();
  return text;
}

function request(signal?: AbortSignal): Request {
  return new Request("http://x/api/sessions/s/logs", signal ? { signal } : undefined);
}

describe("logStreamResponse", () => {
  beforeEach(() => {
    engine.reset();
    requireSession.mockClear();
    requireSession.mockImplementation(async () => ({ user: { id: "u" } }));
  });

  describe("guards", () => {
    it("refuses an unauthenticated request", async () => {
      requireSession.mockImplementation(async () => {
        throw new Error("no session");
      });

      const res = await logStreamResponse(request(), "s");

      expect(res.status).toBe(401);
      expect(engine.logFollows).toEqual([]);
    });

    // The name is interpolated into a container name downstream, so it never
    // reaches Docker unvalidated.
    it("refuses an invalid session name without opening a stream", async () => {
      const res = await logStreamResponse(request(), "../../etc/passwd");

      expect(res.status).toBe(400);
      expect(engine.logFollows).toEqual([]);
    });

    // The label guard, surfaced honestly: an SSE error event, not a dead stream
    // the client waits on forever.
    it("reports an unknown session as an error event", async () => {
      const res = await logStreamResponse(request(), "ghost");

      expect(res.status).toBe(200);
      expect(await readSse(res, (t) => t.includes("event: error"))).toContain("event: error");
    });
  });

  describe("events", () => {
    it("announces which container it is following, then streams chunks", async () => {
      engine.seedRunningSession({ name: "s", repo: "o/r", accountId: "a" });

      const res = await logStreamResponse(request(), "s");
      const body = readSse(res, (t) => t.includes("tick 2"));
      await vi.waitFor(() => expect(engine.logFollows).toHaveLength(1));
      engine.lastFollow.sink.onChunk("tick 1\n");
      engine.lastFollow.sink.onChunk("tick 2\n");

      const text = await body;
      expect(text).toContain('event: open\ndata: {"source":"session"}');
      expect(text).toContain('event: chunk\ndata: {"text":"tick 1\\n"}');
      expect(text).toContain("tick 2");
    });

    // A clone_failed session's only container is the helper; the modal titles
    // itself off this.
    it("reports the clone helper as the source", async () => {
      engine.seedCloningSession({ name: "s", repo: "o/r", accountId: "a" });

      const res = await logStreamResponse(request(), "s");
      const text = await readSse(res, (t) => t.includes("event: open"));

      expect(text).toContain('"source":"clone"');
    });

    it("ends the stream when the container's output ends", async () => {
      engine.seedRunningSession({ name: "s", repo: "o/r", accountId: "a" });

      const res = await logStreamResponse(request(), "s");
      const body = readSse(res, (t) => t.includes("event: end"));
      await vi.waitFor(() => expect(engine.logFollows).toHaveLength(1));
      engine.lastFollow.sink.onEnd();

      expect(await body).toContain("event: end");
      // Ending must also release the follow — not just stop writing to it.
      expect(engine.lastFollow.closed).toBe(true);
    });

    it("surfaces a mid-stream failure as an error event and closes the follow", async () => {
      engine.seedRunningSession({ name: "s", repo: "o/r", accountId: "a" });

      const res = await logStreamResponse(request(), "s");
      const body = readSse(res, (t) => t.includes("event: error"));
      await vi.waitFor(() => expect(engine.logFollows).toHaveLength(1));
      engine.lastFollow.sink.onError(new Error("docker hung up"));

      expect(await body).toContain("docker hung up");
      expect(engine.lastFollow.closed).toBe(true);
    });
  });

  // Teardown is the whole reason this module is testable in isolation. Docker
  // holds a follow open for the life of the container, so a modal that closes
  // without tearing its stream down leaks a socket on a long-running server.
  describe("teardown", () => {
    it("closes the Docker follow when the client disconnects", async () => {
      engine.seedRunningSession({ name: "s", repo: "o/r", accountId: "a" });
      const abort = new AbortController();

      await logStreamResponse(request(abort.signal), "s");
      await vi.waitFor(() => expect(engine.logFollows).toHaveLength(1));
      expect(engine.lastFollow.closed).toBe(false);

      abort.abort(); // what the browser does when the modal closes

      await vi.waitFor(() => expect(engine.lastFollow.closed).toBe(true));
    });

    it("closes the follow when the consumer cancels the stream", async () => {
      engine.seedRunningSession({ name: "s", repo: "o/r", accountId: "a" });

      const res = await logStreamResponse(request(), "s");
      await vi.waitFor(() => expect(engine.logFollows).toHaveLength(1));
      await (res.body as ReadableStream).cancel();

      await vi.waitFor(() => expect(engine.lastFollow.closed).toBe(true));
    });

    it("opens exactly one follow per request", async () => {
      engine.seedRunningSession({ name: "s", repo: "o/r", accountId: "a" });

      await logStreamResponse(request(), "s");
      await vi.waitFor(() => expect(engine.logFollows).toHaveLength(1));

      expect(engine.logFollows).toHaveLength(1);
    });
  });
});
