// follow-session-logs — the live counterpart of read-session-logs. Replays the
// tail, then keeps delivering output as the container produces it, so a user
// watching a session come up (or a clone fail) sees lines arrive instead of
// hammering a Refresh button.
//
// Same guarantees as a one-shot read: label-guarded, main-else-clone fallback,
// not gated on the container running. What streaming forces on top:
//
//   - Sanitizing is STATEFUL. The follow cuts output at arbitrary byte offsets,
//     so an ANSI escape or a CRLF can straddle a chunk boundary; a per-chunk
//     `sanitizeLogText` would leak the fragments into the panel.
//   - `onOpen` comes FIRST, by construction. It is delivered before the engine
//     stream is even opened, so a chunk can never overtake it — the consumer
//     always knows which container it is reading before any of its output lands.
//   - The engine follow is ALWAYS released: on close, on end, on error, and even
//     when the stream ends before we are handed its handle. Docker holds a follow
//     open for the life of the container, so a missed release is a leaked socket.

import { SessionNotFoundError } from "../domain/errors";
import {
  createLogSanitizer,
  DEFAULT_LOG_TAIL,
  type SessionLogsSource,
} from "../domain/session-logs";
import type { ContainerEngine, LogFollow } from "../ports/container-engine";

/** Where a followed session's output is delivered. `onOpen` always fires first. */
export type SessionLogSink = {
  onOpen(source: SessionLogsSource): void;
  onChunk(text: string): void;
  onError(error: Error): void;
  onEnd(): void;
};

export type FollowSessionLogsInput = { name: string; tail?: number };
export type FollowSessionLogsDeps = { engine: ContainerEngine };

export function makeFollowSessionLogs(deps: FollowSessionLogsDeps) {
  return async function followSessionLogs(
    input: FollowSessionLogsInput,
    sink: SessionLogSink,
  ): Promise<LogFollow> {
    const container = await deps.engine.getSessionContainer(input.name);
    if (!container) throw new SessionNotFoundError(input.name);

    // Before a single byte can arrive: say whose output this is.
    sink.onOpen(container.cloning ? "clone" : "session");

    const sanitizer = createLogSanitizer();
    let closed = false;
    let handle: LogFollow | null = null;

    // Marks the follow finished and releases the engine stream. Safe to call
    // before `handle` exists — the post-await check below catches that case.
    const release = () => {
      closed = true;
      handle?.close();
    };

    // Everything the engine emits passes through here, so one `closed` check
    // keeps a late chunk from reaching a sink the caller has abandoned.
    const engineFollow = await deps.engine.followSessionLogs(
      input.name,
      { tail: input.tail ?? DEFAULT_LOG_TAIL },
      {
        onChunk(raw) {
          if (closed) return;
          const text = sanitizer.push(raw);
          if (text !== "") sink.onChunk(text);
        },
        onError(error) {
          if (closed) return;
          sink.onError(error);
          release();
        },
        onEnd() {
          if (closed) return;
          const rest = sanitizer.flush();
          if (rest !== "") sink.onChunk(rest);
          sink.onEnd();
          release();
        },
      },
    );

    handle = engineFollow;
    // The stream may have ended, failed, or been closed while it was opening —
    // in which case `release()` above found no handle to close. Close it now, or
    // it leaks for the life of the container.
    if (closed) engineFollow.close();

    return { close: release };
  };
}
