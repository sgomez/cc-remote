// The two READ paths of the engine, against a stubbed dockerode. They are the
// only places the exit code can enter the system, and they read it from two
// different dockerode shapes — `inspect` (State.ExitCode) and `listContainers`
// (no exit-code field at all, only the `Status` string). Both are unit-tested
// here; the write paths stay in the Docker-requiring integration suite.

import type Docker from "dockerode";
import { describe, expect, it } from "vitest";
import { SESSION_LABELS } from "../../core";
import type { DockerAdapterConfig } from "./config";
import { DockerContainerEngine } from "./docker-container-engine";

const LABELS = {
  [SESSION_LABELS.marker]: "true",
  [SESSION_LABELS.name]: "demo",
  [SESSION_LABELS.repo]: "o/r",
  [SESSION_LABELS.accountId]: "acc1",
};

/** A dockerode whose `inspect` returns one canned State. */
function dockerInspecting(state: {
  Status: string;
  ExitCode: number;
  OOMKilled?: boolean;
}): Docker {
  return {
    getContainer: () => ({
      inspect: async () => ({
        Config: { Labels: LABELS },
        State: { OOMKilled: false, ...state },
      }),
    }),
  } as unknown as Docker;
}

/** A dockerode whose `listContainers` returns canned ContainerInfo rows. */
function dockerListing(rows: Array<{ State: string; Status: string }>): Docker {
  return {
    listContainers: async () => rows.map((r) => ({ ...r, Labels: LABELS })),
  } as unknown as Docker;
}

const engineOver = (docker: Docker) => new DockerContainerEngine(docker, {} as DockerAdapterConfig);

describe("getSessionContainer (the inspect path)", () => {
  it("carries State.ExitCode into the domain container", async () => {
    const engine = engineOver(dockerInspecting({ Status: "exited", ExitCode: 3 }));
    const c = await engine.getSessionContainer("demo");
    expect(c).toMatchObject({ name: "demo", state: "exited", exitCode: 3 });
  });

  it("reports an OOM kill as `dead`, not as the clean stop its 137 would imply", async () => {
    // The kernel OOM-killer leaves exit 137 — the very code a normal
    // `docker stop` leaves. Only `inspect` can tell them apart (OOMKilled), and
    // `dead` is what the domain maps to `error`.
    const engine = engineOver(
      dockerInspecting({ Status: "exited", ExitCode: 137, OOMKilled: true }),
    );
    const c = await engine.getSessionContainer("demo");
    expect(c?.state).toBe("dead");
  });

  it("leaves a plain signalled stop (137, not OOM) as exited", async () => {
    const engine = engineOver(
      dockerInspecting({ Status: "exited", ExitCode: 137, OOMKilled: false }),
    );
    const c = await engine.getSessionContainer("demo");
    expect(c).toMatchObject({ state: "exited", exitCode: 137 });
  });
});

describe("listSessionContainers (the list path)", () => {
  it("recovers the exit code from the Status string, which has no exit-code field", async () => {
    const engine = engineOver(
      dockerListing([
        { State: "exited", Status: "Exited (137) 2 minutes ago" },
        { State: "exited", Status: "Exited (3) 11 seconds ago" },
        { State: "running", Status: "Up 3 hours" },
      ]),
    );
    const containers = await engine.listSessionContainers();
    expect(containers.map((c) => [c.state, c.exitCode])).toEqual([
      ["exited", 137],
      ["exited", 3],
      ["running", null],
    ]);
  });
});
