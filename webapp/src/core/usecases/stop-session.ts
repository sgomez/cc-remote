// stop-session — stop a running session container. Refuses any container
// lacking the session label.

import { SessionNotFoundError } from "../domain/errors";
import { isAlreadyStopped } from "../domain/session";
import type { ContainerEngine } from "../ports/container-engine";

export type StopSessionInput = { name: string };
export type StopSessionDeps = { engine: ContainerEngine };

export function makeStopSession(deps: StopSessionDeps) {
  return async function stopSession(input: StopSessionInput): Promise<void> {
    const container = await deps.engine.getSessionContainer(input.name);
    if (!container) throw new SessionNotFoundError(input.name);
    // The user's intent ("this session should not be running") is already
    // satisfied for a container that is already stopped — a double-click, a
    // stale UI, or a container that crashed between page render and click all
    // land here, and none of them is an error worth surfacing. Calling
    // stopContainer anyway is what makes a real engine throw the 304 that
    // motivated this guard.
    if (isAlreadyStopped(container.state)) return;
    await deps.engine.stopContainer(input.name);
  };
}
