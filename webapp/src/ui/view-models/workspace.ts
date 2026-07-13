// Pure view-model for the workspace uncommitted-work notice (I2), shown in the
// Destroy/Reset confirm dialogs. Turns a domain WorkspaceState into the copy the
// dialog renders plus a `dirty` flag the UI styles as a warning. Framework-free,
// colocated tests — matches the style of badges.ts / capabilities.ts.

import type { WorkspaceState } from "~/core";

export type WorkspaceSummary = {
  /** The line shown under the confirm body. */
  text: string;
  /** True when work would be lost — the dialog renders this as a warning. */
  dirty: boolean;
};

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/**
 * Copy for each state:
 *   - dirty   → "3 files changed, 2 commits ahead — this work will be lost."
 *               (only the non-zero halves appear)
 *   - clean   → neutral "Workspace is clean."
 *   - unknown → "Workspace state unknown (container stopped)." for a stopped
 *               container, else a plain "Workspace state unknown."
 */
export function workspaceSummary(state: WorkspaceState): WorkspaceSummary {
  switch (state.kind) {
    case "clean":
      return { text: "Workspace is clean.", dirty: false };
    case "dirty": {
      const parts: string[] = [];
      if (state.dirtyFiles > 0) parts.push(`${count(state.dirtyFiles, "file")} changed`);
      if (state.aheadCommits > 0) parts.push(`${count(state.aheadCommits, "commit")} ahead`);
      return { text: `${parts.join(", ")} — this work will be lost.`, dirty: true };
    }
    case "unknown":
      return {
        text:
          state.reason === "stopped"
            ? "Workspace state unknown (container stopped)."
            : "Workspace state unknown.",
        dirty: false,
      };
  }
}
