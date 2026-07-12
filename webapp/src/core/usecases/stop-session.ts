// stop-session — stop a running session container. Refuses any container
// lacking the session label.

import { SessionNotFoundError } from "../domain/errors";
import type { ContainerEngine } from "../ports/container-engine";

export type StopSessionInput = { name: string };
export type StopSessionDeps = { engine: ContainerEngine };

export function makeStopSession(deps: StopSessionDeps) {
  return async function stopSession(input: StopSessionInput): Promise<void> {
    const container = await deps.engine.getSessionContainer(input.name);
    if (!container) throw new SessionNotFoundError(input.name);
    await deps.engine.stopContainer(input.name);
  };
}
