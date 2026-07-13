import { describe, expect, it } from "vitest";
import { workspaceSummary } from "./workspace";

describe("workspaceSummary", () => {
  it("phrases a clean workspace neutrally", () => {
    expect(workspaceSummary({ kind: "clean" })).toEqual({
      text: "Workspace is clean.",
      dirty: false,
    });
  });

  it("phrases dirty files and commits ahead together", () => {
    expect(workspaceSummary({ kind: "dirty", dirtyFiles: 3, aheadCommits: 2 })).toEqual({
      text: "3 files changed, 2 commits ahead — this work will be lost.",
      dirty: true,
    });
  });

  it("singularizes a single file and single commit", () => {
    expect(workspaceSummary({ kind: "dirty", dirtyFiles: 1, aheadCommits: 1 })).toEqual({
      text: "1 file changed, 1 commit ahead — this work will be lost.",
      dirty: true,
    });
  });

  it("omits the ahead clause when there are no commits ahead", () => {
    expect(workspaceSummary({ kind: "dirty", dirtyFiles: 2, aheadCommits: 0 })).toEqual({
      text: "2 files changed — this work will be lost.",
      dirty: true,
    });
  });

  it("omits the files clause when only commits are ahead", () => {
    expect(workspaceSummary({ kind: "dirty", dirtyFiles: 0, aheadCommits: 4 })).toEqual({
      text: "4 commits ahead — this work will be lost.",
      dirty: true,
    });
  });

  it("names the container-stopped case for unknown/stopped", () => {
    expect(workspaceSummary({ kind: "unknown", reason: "stopped" })).toEqual({
      text: "Workspace state unknown (container stopped).",
      dirty: false,
    });
  });

  it("phrases a generic unknown for unknown/unavailable", () => {
    expect(workspaceSummary({ kind: "unknown", reason: "unavailable" })).toEqual({
      text: "Workspace state unknown.",
      dirty: false,
    });
  });
});
