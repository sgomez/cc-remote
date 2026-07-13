// Workspace git state — the uncommitted-work guard (I2). Destroy and Reset tear
// down a Session's workspace volume, so before the user confirms we surface
// whether `/workspace` holds work that would be lost. Docker is probed by the
// adapter (an exec into the running container); this module owns the pure
// interpretation of that probe into a domain value, plus the never-lie rule:
// "clean" is reported ONLY when the git commands actually ran and said so —
// every other case ("container stopped", exec failed, repo missing) is
// explicitly "unknown", never a fake "clean".

/**
 * The three states the UI distinguishes. `dirty` carries the counts so the
 * view-model can phrase "3 files changed, 2 commits ahead"; `unknown` carries a
 * reason so the copy can name the container-stopped case specifically.
 */
export type WorkspaceState =
  | { kind: "clean" }
  | { kind: "dirty"; dirtyFiles: number; aheadCommits: number }
  | { kind: "unknown"; reason: "stopped" | "unavailable" };

/**
 * Raw capture of the git probe the ContainerEngine runs inside the workspace.
 * Deliberately dumb (exit code + combined stdout) so the adapter stays thin and
 * all interpretation lives here, unit-tested without Docker.
 */
export type WorkspaceGitProbe = {
  /** Exit code of the probe script (0 = the git commands ran cleanly). */
  exitCode: number;
  /** Combined stdout of the probe script (status block, separator, ahead count). */
  output: string;
};

/**
 * Line the probe script prints between the porcelain status block and the
 * ahead-count. Shared with the Docker adapter (which builds the command) so the
 * two never drift — the adapter imports this constant rather than hard-coding it.
 */
export const WORKSPACE_PROBE_SEPARATOR = "--cc-remote-git-ahead--";

/**
 * Interpret a git probe into a WorkspaceState. Never invents "clean": a null
 * probe (adapter couldn't run it), a non-zero exit (repo missing / git failed),
 * or a malformed output (no separator) all map to `unknown`. Only a clean exit
 * with a parseable output yields clean/dirty.
 *
 * `dirty` = any uncommitted change OR any commit ahead of upstream. With no
 * upstream, `git rev-list --count @{upstream}..HEAD` fails and the script emits
 * an empty ahead-block; ahead is then counted as 0 (unpushed commits can't be
 * computed without an upstream), so the working-tree cleanliness still decides.
 */
export function parseWorkspaceProbe(probe: WorkspaceGitProbe | null): WorkspaceState {
  if (probe?.exitCode !== 0) return { kind: "unknown", reason: "unavailable" };

  const normalized = probe.output.replace(/\r/g, "");
  const sepIndex = normalized.indexOf(WORKSPACE_PROBE_SEPARATOR);
  if (sepIndex === -1) return { kind: "unknown", reason: "unavailable" };

  const statusBlock = normalized.slice(0, sepIndex);
  const aheadBlock = normalized.slice(sepIndex + WORKSPACE_PROBE_SEPARATOR.length);

  const dirtyFiles = statusBlock.split("\n").filter((line) => line.trim().length > 0).length;
  const aheadRaw = aheadBlock.trim();
  const aheadCommits = /^\d+$/.test(aheadRaw) ? Number(aheadRaw) : 0;

  if (dirtyFiles === 0 && aheadCommits === 0) return { kind: "clean" };
  return { kind: "dirty", dirtyFiles, aheadCommits };
}
