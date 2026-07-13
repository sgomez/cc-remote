// read-session-logs — the container output of a session, for diagnosing a
// session that did NOT come up. Label-guarded like every session operation, and
// deliberately NOT gated on the container running: a stopped/crashed container
// still has logs, and they are the whole reason this exists.
//
// The clone fallback is the load-bearing part. `getSessionContainer` resolves
// main-else-clone-helper, so for a `clone_failed` session — whose only container
// IS the helper — this returns the git clone error, tagged `source: "clone"` so
// the UI can say whose output it is showing.

import { SessionNotFoundError } from "../domain/errors";
import { DEFAULT_LOG_TAIL, type SessionLogs, sanitizeLogText } from "../domain/session-logs";
import type { ContainerEngine } from "../ports/container-engine";

export type ReadSessionLogsInput = { name: string; tail?: number };
export type ReadSessionLogsDeps = { engine: ContainerEngine };

export function makeReadSessionLogs(deps: ReadSessionLogsDeps) {
  return async function readSessionLogs(input: ReadSessionLogsInput): Promise<SessionLogs> {
    const container = await deps.engine.getSessionContainer(input.name);
    if (!container) throw new SessionNotFoundError(input.name);

    const text = await deps.engine.readSessionLogs(input.name, {
      tail: input.tail ?? DEFAULT_LOG_TAIL,
    });

    return { text: sanitizeLogText(text), source: container.cloning ? "clone" : "session" };
  };
}
