// list-sessions — Docker is the source of truth. Read the labelled containers
// and synthesize `cloning`/`clone_failed` from the clone helper, preferring the
// main container when both exist momentarily (legacy GET /api/sessions).

import type { Session } from "../domain/session";
import { toSessionStatus } from "../domain/session";
import type { ContainerEngine } from "../ports/container-engine";

export type ListSessionsDeps = {
  engine: ContainerEngine;
};

export function makeListSessions(deps: ListSessionsDeps) {
  return async function listSessions(): Promise<Session[]> {
    const containers = await deps.engine.listSessionContainers();
    const byName = new Map<string, Session>();

    for (const container of containers) {
      const existing = byName.get(container.name);
      // Keep the main (non-cloning) container's view when both are present.
      if (existing && container.cloning) continue;
      byName.set(container.name, {
        name: container.name,
        repo: container.repo,
        accountId: container.accountId,
        status: toSessionStatus(container),
      });
    }

    return [...byName.values()];
  };
}
