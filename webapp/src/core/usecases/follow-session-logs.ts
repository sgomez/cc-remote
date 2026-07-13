// follow-session-logs — the live counterpart of read-session-logs. Replays the
// tail, then keeps delivering output as the container produces it, so a user
// watching a session come up (or a clone fail) sees lines arrive instead of
// hammering a Refresh button.
//
// Same guarantees as the one-shot read: label-guarded, main-else-clone fallback,
// not gated on the container running. Two things it adds:
//
//   - Sanitizing is STATEFUL. The follow cuts output at arbitrary byte offsets,
//     so an ANSI escape or a CRLF can straddle a chunk boundary; a per-chunk
//     `sanitizeLogText` would leak the fragments into the panel.
//   - Teardown is the caller's obligation and ours: `close()` stops the engine
//     stream, and after it nothing more reaches the sink — a late chunk landing
//     on a closed SSE controller would throw on a dead stream.

import { SessionNotFoundError } from "../domain/errors";
import {
  createLogSanitizer,
  DEFAULT_LOG_TAIL,
  type SessionLogsSource,
} from "../domain/session-logs";
import type { ContainerEngine, LogFollow, LogSink } from "../ports/container-engine";

export type FollowSessionLogsInput = { name: string; tail?: number };
export type FollowSessionLogsDeps = { engine: ContainerEngine };

export type FollowSessionLogsResult = {
  /** Which container the output is coming from (the agent, or the clone helper). */
  source: SessionLogsSource;
  follow: LogFollow;
};

export function makeFollowSessionLogs(deps: FollowSessionLogsDeps) {
  return async function followSessionLogs(
    input: FollowSessionLogsInput,
    sink: LogSink,
  ): Promise<FollowSessionLogsResult> {
    const container = await deps.engine.getSessionContainer(input.name);
    if (!container) throw new SessionNotFoundError(input.name);

    const sanitizer = createLogSanitizer();
    let closed = false;

    // Everything the engine emits passes through here, so a single `closed`
    // check keeps a late chunk from reaching a sink the caller has abandoned.
    const guarded: LogSink = {
      onChunk(raw) {
        if (closed) return;
        const text = sanitizer.push(raw);
        if (text !== "") sink.onChunk(text);
      },
      onError(error) {
        if (closed) return;
        sink.onError(error);
      },
      onEnd() {
        if (closed) return;
        const rest = sanitizer.flush();
        if (rest !== "") sink.onChunk(rest);
        sink.onEnd();
      },
    };

    const follow = await deps.engine.followSessionLogs(
      input.name,
      { tail: input.tail ?? DEFAULT_LOG_TAIL },
      guarded,
    );

    return {
      source: container.cloning ? "clone" : "session",
      follow: {
        close() {
          if (closed) return;
          closed = true;
          follow.close();
        },
      },
    };
  };
}
