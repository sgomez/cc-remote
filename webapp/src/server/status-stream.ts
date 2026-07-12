// Shared SSE status-stream builder for the TSS API routes (#15). Auth-guards the
// request, then returns a `text/event-stream` Response that emits the current
// snapshot immediately (proving no buffering), re-emits only when the snapshot
// changes, and sends a keep-alive comment on every other tick so a live but
// unchanged stream still flushes progressively. Polling is used deliberately:
// Docker (session status) and SQLite (account status) have no change feed, and
// the legacy web-manager polled too.
//
// The wire format and change detection are the unit-tested pure helpers in
// sse.ts; this module owns only the stream/timer/abort lifecycle.

import { requireSession } from "~/adapters/auth";
import { ChangeTracker, formatSseComment, formatSseEvent } from "./sse";

const SSE_HEADERS = {
  "content-type": "text/event-stream",
  // no-transform stops Caddy/any proxy from buffering the stream.
  "cache-control": "no-cache, no-transform",
  connection: "keep-alive",
};

export type StatusStreamConfig<T> = {
  /** SSE event name for a changed snapshot (e.g. "sessions", "accounts"). */
  event: string;
  /** Produce the current snapshot; called on connect and every interval. */
  poll: () => Promise<T>;
  /** Poll cadence in ms (default 1000). */
  intervalMs?: number;
};

export async function statusStreamResponse<T>(
  request: Request,
  config: StatusStreamConfig<T>,
): Promise<Response> {
  try {
    await requireSession(request.headers);
  } catch {
    return new Response("Unauthorized", { status: 401 });
  }

  const intervalMs = config.intervalMs ?? 1000;
  const encoder = new TextEncoder();
  const tracker = new ChangeTracker();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;

      const enqueue = (chunk: string) => {
        if (!closed) controller.enqueue(encoder.encode(chunk));
      };

      const tick = async () => {
        try {
          const snapshot = await config.poll();
          enqueue(
            tracker.changed(snapshot)
              ? formatSseEvent(config.event, snapshot)
              : formatSseComment("keep-alive"),
          );
        } catch (error) {
          // A transient Docker/DB hiccup surfaces as an error event, not a dead
          // stream — the client keeps listening and the next tick recovers.
          enqueue(formatSseEvent("error", { message: (error as Error).message }));
        }
      };

      const stop = () => {
        if (closed) return;
        closed = true;
        clearInterval(timer);
        request.signal.removeEventListener("abort", stop);
        try {
          controller.close();
        } catch {
          // Controller already closed by the consumer; nothing to do.
        }
      };

      await tick(); // initial snapshot, flushed before the timer starts
      const timer = setInterval(tick, intervalMs);
      if (request.signal.aborted) stop();
      else request.signal.addEventListener("abort", stop);
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
