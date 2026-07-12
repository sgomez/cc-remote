// destroy-session — remove the session container and its workspace volume.
// Refuses any container lacking the session label.

import { SessionNotFoundError } from "../domain/errors";
import { workspaceVolumeName } from "../domain/session";
import type { ContainerEngine } from "../ports/container-engine";

export type DestroySessionInput = { name: string };
export type DestroySessionDeps = { engine: ContainerEngine };

export function makeDestroySession(deps: DestroySessionDeps) {
  return async function destroySession(input: DestroySessionInput): Promise<void> {
    const container = await deps.engine.getSessionContainer(input.name);
    if (!container) throw new SessionNotFoundError(input.name);

    if (container.state === "running") {
      await deps.engine.stopContainer(input.name);
    }
    await deps.engine.removeContainer(input.name);
    await deps.engine.removeVolume(workspaceVolumeName(input.name));
  };
}
