// Integration test for the SSE log stream against a REAL Docker daemon.
//
// This covers the one link the adapter tests cannot: the delivery glue in
// src/server/log-stream.ts — the SSE framing, and (the part that actually
// worries me) the teardown. The browser closing the modal closes its
// EventSource, which aborts the request; if that abort did not reach the Docker
// follow, every modal open would leak a socket on a long-running server.
//
// Auth is the one thing mocked: the app is behind GitHub OAuth, which is not
// reproducible here, and it is not what this test is about. Everything below the
// guard — core use case, label guard, Docker follow, decoding — is real.
//
//   RUN_DOCKER_IT=1 pnpm test:docker

import Docker from "dockerode";
import { afterAll, describe, expect, it, vi } from "vitest";
import { configFromEnv } from "../src/adapters/docker/config";

vi.mock("../src/adapters/auth", () => ({
  requireSession: vi.fn(async () => ({ user: { id: "test" } })),
  getGithubAccessToken: vi.fn(async () => "token"),
}));

const { logStreamResponse } = await import("../src/server/log-stream");

const RUN = process.env.RUN_DOCKER_IT === "1";
const suite = RUN ? describe : describe.skip;

const suffix = Date.now().toString(36);
const SESSION = `it-sse-${suffix}`;
const CONTAINER = `cc-remote-session-${SESSION}`;

const config = configFromEnv({
  ...process.env,
  AGENT_NETWORK: process.env.AGENT_NETWORK || "bridge",
});
const docker = new Docker(config.host);

/** Read SSE text off the Response body until `stop()` says enough. */
async function collect(
  response: Response,
  until: (text: string) => boolean,
  timeoutMs = 8000,
): Promise<string> {
  const reader = (response.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  let text = "";
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
    if (until(text)) break;
  }
  reader.releaseLock();
  return text;
}

suite("log-stream SSE (real daemon)", () => {
  afterAll(async () => {
    await docker
      .getContainer(CONTAINER)
      .remove({ force: true })
      .catch(() => {});
  });

  it("rejects an invalid session name before touching Docker", async () => {
    const res = await logStreamResponse(new Request("http://x/logs"), "../../etc/passwd");

    expect(res.status).toBe(400);
  });

  it("reports a missing session as an SSE error event, not a dead stream", async () => {
    const res = await logStreamResponse(new Request("http://x/logs"), `ghost-${suffix}`);

    expect(res.status).toBe(200);
    const text = await collect(res, (t) => t.includes("event: error"));
    expect(text).toContain("event: error");
  });

  it("streams a live container's output as SSE events, and stops on abort", async () => {
    const c = await docker.createContainer({
      name: CONTAINER,
      Image: config.agentImage,
      Tty: true,
      Entrypoint: [],
      Cmd: ["sh", "-c", 'i=1; while true; do echo "tick $i"; i=$((i+1)); sleep 1; done'],
      Labels: {
        "cc-remote-session": "true",
        "cc-remote-session-name": SESSION,
        "cc-remote-repo": "octocat/Hello-World",
        "cc-remote-account-id": `it-${suffix}`,
      },
    });
    await c.start();

    const abort = new AbortController();
    const res = await logStreamResponse(
      new Request("http://x/logs", { signal: abort.signal }),
      SESSION,
    );

    // Lines must arrive as they are produced — "tick 3" only exists ~3s in, so
    // seeing it proves we are not just replaying a buffered tail.
    const text = await collect(res, (t) => t.includes("tick 3"), 12_000);

    expect(text).toContain('event: open\ndata: {"source":"session"}');
    expect(text).toContain("event: chunk");
    expect(text).toContain("tick 1");
    expect(text).toContain("tick 3");

    // Teardown: aborting the request (what a closed modal does) must stop the
    // Docker follow. If it leaked, the container would keep feeding a dead
    // stream — and the follow would still be attached to the daemon.
    abort.abort();
    await new Promise((r) => setTimeout(r, 1500));

    // The response body is closed: reading it now completes rather than yielding
    // more ticks.
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    const after = await Promise.race([
      reader.read(),
      new Promise<{ done: boolean }>((r) => setTimeout(() => r({ done: true }), 1500)),
    ]);
    expect(after.done).toBe(true);
  }, 25_000);
});
