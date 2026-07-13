import { describe, expect, it } from "vitest";
import {
  parseWorkspaceProbe,
  WORKSPACE_PROBE_SEPARATOR,
  type WorkspaceGitProbe,
} from "./workspace-state";

const SEP = WORKSPACE_PROBE_SEPARATOR;

function probe(output: string, exitCode = 0): WorkspaceGitProbe {
  return { exitCode, output };
}

describe("parseWorkspaceProbe", () => {
  it("returns unknown when the probe is null (adapter could not exec)", () => {
    expect(parseWorkspaceProbe(null)).toEqual({ kind: "unknown", reason: "unavailable" });
  });

  it("returns unknown on a non-zero exit (repo missing / git failed)", () => {
    expect(parseWorkspaceProbe(probe("", 3))).toEqual({ kind: "unknown", reason: "unavailable" });
  });

  it("returns unknown when the separator is missing (malformed output)", () => {
    expect(parseWorkspaceProbe(probe("garbage without marker"))).toEqual({
      kind: "unknown",
      reason: "unavailable",
    });
  });

  it("reports clean for an empty status block and empty ahead-count", () => {
    expect(parseWorkspaceProbe(probe(`${SEP}\n`))).toEqual({ kind: "clean" });
  });

  it("reports clean for an empty status block and a zero ahead-count", () => {
    expect(parseWorkspaceProbe(probe(`${SEP}\n0\n`))).toEqual({ kind: "clean" });
  });

  it("counts dirty files from porcelain lines (ahead 0)", () => {
    const out = ` M src/a.ts\n?? src/b.ts\n${SEP}\n0\n`;
    expect(parseWorkspaceProbe(probe(out))).toEqual({
      kind: "dirty",
      dirtyFiles: 2,
      aheadCommits: 0,
    });
  });

  it("reports dirty for a clean tree that is ahead of upstream", () => {
    expect(parseWorkspaceProbe(probe(`${SEP}\n3\n`))).toEqual({
      kind: "dirty",
      dirtyFiles: 0,
      aheadCommits: 3,
    });
  });

  it("reports both counts when the tree is dirty and ahead", () => {
    const out = ` M a\n M b\n M c\n${SEP}\n2\n`;
    expect(parseWorkspaceProbe(probe(out))).toEqual({
      kind: "dirty",
      dirtyFiles: 3,
      aheadCommits: 2,
    });
  });

  it("treats a no-upstream (empty ahead) clean tree as clean, not dirty", () => {
    // git rev-list against a missing upstream fails; the script emits nothing.
    expect(parseWorkspaceProbe(probe(`${SEP}\n`))).toEqual({ kind: "clean" });
  });

  it("normalizes CRLF line endings from a TTY exec stream", () => {
    const out = ` M a\r\n?? b\r\n${SEP}\r\n1\r\n`;
    expect(parseWorkspaceProbe(probe(out))).toEqual({
      kind: "dirty",
      dirtyFiles: 2,
      aheadCommits: 1,
    });
  });
});
