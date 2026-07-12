// start-session — start a stopped session container. Refuses any container
// lacking the session label (getSessionContainer only returns labelled ones).

import { SessionNotFoundError } from "../domain/errors";
import type { ContainerEngine } from "../ports/container-engine";

export type StartSessionInput = { name: string };
export type StartSessionDeps = { engine: ContainerEngine };

export function makeStartSession(deps: StartSessionDeps) {
  return async function startSession(input: StartSessionInput): Promise<void> {
    const container = await deps.engine.getSessionContainer(input.name);
    if (!container) throw new SessionNotFoundError(input.name);
    await deps.engine.startContainer(input.name);
  };
}
