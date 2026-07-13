// read-workspace-state — the uncommitted-work guard (I2). Given a session name,
// report whether its `/workspace` holds work that Destroy/Reset would lose.
// Label-guarded like every session operation. The never-lie rule lives here:
//   - no labelled container            → SessionNotFoundError (guard)
//   - container not running            → unknown (stopped): a stopped container
//                                        can't be exec'd, so we cannot claim clean
//   - clone helper still running       → unknown (unavailable): no real workspace
//   - probe throws (exec/infra error)  → unknown (unavailable)
//   - probe ran                        → parseWorkspaceProbe decides clean/dirty
// "clean" is returned only when the git commands actually ran and said so.

import { SessionNotFoundError } from "../domain/errors";
import type { WorkspaceState } from "../domain/workspace-state";
import { parseWorkspaceProbe } from "../domain/workspace-state";
import type { ContainerEngine } from "../ports/container-engine";

export type ReadWorkspaceStateInput = { name: string };
export type ReadWorkspaceStateDeps = { engine: ContainerEngine };

export function makeReadWorkspaceState(deps: ReadWorkspaceStateDeps) {
  return async function readWorkspaceState(
    input: ReadWorkspaceStateInput,
  ): Promise<WorkspaceState> {
    const container = await deps.engine.getSessionContainer(input.name);
    if (!container) throw new SessionNotFoundError(input.name);

    if (container.state !== "running") return { kind: "unknown", reason: "stopped" };
    if (container.cloning) return { kind: "unknown", reason: "unavailable" };

    try {
      const probe = await deps.engine.probeWorkspaceGit(input.name);
      return parseWorkspaceProbe(probe);
    } catch {
      return { kind: "unknown", reason: "unavailable" };
    }
  };
}
