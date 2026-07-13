// SSE stream of a Session's container logs — the live half of the Logs modal.
// Sibling of status-stream.ts: that one polls, this one is push-driven off a real
// Docker follow. Lives here (not in the route) so the stream/teardown lifecycle is
// testable against a real daemon without a browser session.
//
// Unlike the status stream (src/server/status-stream.ts) this is NOT polled:
// Docker gives us a real follow stream, so the events are push-driven. It sends
// `open` (which container we are following), then a `chunk` per piece of output
// — starting with the replayed tail — then `end` when the container's stream
// closes, or `error` if the read fails.
//
// Teardown is the whole risk here. Docker holds a follow open for the life of
// the container, so every abandoned stream is a leaked socket on a long-running
// server. `request.signal` fires when the browser closes the EventSource (which
// is what closing the modal does), and that aborts the follow.

import { requireSession } from "~/adapters/auth";
import { isValidSessionName, makeFollowSessionLogs } from "~/core";
import { containerEngine } from "~/server/runtime";
import { formatSseEvent } from "~/server/sse";

const SSE_HEADERS = {
  "content-type": "text/event-stream",
  // no-transform stops Caddy/any proxy from buffering the stream — without it
  // the "live" part of a live log is a lie.
  "cache-control": "no-cache, no-transform",
  connection: "keep-alive",
};

export async function logStreamResponse(request: Request, sessionName: string): Promise<Response> {
  try {
    await requireSession(request.headers);
  } catch {
    return new Response("Unauthorized", { status: 401 });
  }

  // Defence in depth: the name is interpolated into a container name downstream.
  if (!isValidSessionName(sessionName)) {
    return new Response("Invalid session name", { status: 400 });
  }

  const follow = makeFollowSessionLogs({ engine: containerEngine() });
  const encoder = new TextEncoder();

  // Hoisted so BOTH teardown paths reach the same follow: the request aborting
  // (browser closed the EventSource) and the consumer cancelling the stream.
  let closed = false;
  let handle: { close(): void } | null = null;
  let stop = () => {
    closed = true;
    handle?.close();
  };

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enqueue = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          // The consumer is gone (tab closed mid-write); stop feeding it.
          stop();
        }
      };

      stop = () => {
        if (closed) return;
        closed = true;
        request.signal.removeEventListener("abort", stop);
        handle?.close();
        try {
          controller.close();
        } catch {
          // Already closed by the consumer; nothing to do.
        }
      };

      try {
        const started = await follow(
          { name: sessionName },
          {
            onChunk: (text) => enqueue(formatSseEvent("chunk", { text })),
            onError: (error) => {
              enqueue(formatSseEvent("error", { message: error.message }));
              stop();
            },
            // The container exited (or Docker closed the follow). Say so and end
            // the stream rather than leaving the client waiting on a dead socket.
            onEnd: () => {
              enqueue(formatSseEvent("end", {}));
              stop();
            },
          },
        );
        handle = started.follow;
        enqueue(formatSseEvent("open", { source: started.source }));

        // The client may have vanished while Docker was opening the stream.
        if (request.signal.aborted) stop();
        else request.signal.addEventListener("abort", stop);
      } catch (error) {
        // A missing session (the label guard) or a Docker failure: report it as
        // an error event rather than a dead stream, then close.
        enqueue(formatSseEvent("error", { message: (error as Error).message }));
        stop();
      }
    },

    // The consumer dropped the connection — tear the Docker follow down with it.
    cancel() {
      stop();
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
