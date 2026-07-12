import { describe, expect, it } from "vitest";
import type { SessionContainer } from "../domain/session";
import type { ContainerEngine } from "../ports/container-engine";
import { makeListSessions } from "./list-sessions";

function engineWith(containers: SessionContainer[]): ContainerEngine {
  return {
    listSessionContainers: async () => containers,
  } as unknown as ContainerEngine;
}

describe("list-sessions", () => {
  it("maps labelled containers to Sessions with derived status", async () => {
    const list = makeListSessions({
      engine: engineWith([
        { name: "run", repo: "o/r", accountId: "a1", state: "running", cloning: false },
        { name: "clone", repo: "o/r", accountId: "a2", state: "running", cloning: true },
        { name: "fail", repo: "o/r", accountId: "a3", state: "exited", cloning: true },
        { name: "stop", repo: "o/r", accountId: "a4", state: "exited", cloning: false },
      ]),
    });
    const sessions = await list();
    expect(sessions).toEqual([
      { name: "run", repo: "o/r", accountId: "a1", status: "running" },
      { name: "clone", repo: "o/r", accountId: "a2", status: "cloning" },
      { name: "fail", repo: "o/r", accountId: "a3", status: "clone_failed" },
      { name: "stop", repo: "o/r", accountId: "a4", status: "stopped" },
    ]);
  });

  it("prefers the main container when a clone helper for the same name lingers", async () => {
    const list = makeListSessions({
      engine: engineWith([
        { name: "s", repo: "o/r", accountId: "a1", state: "running", cloning: true },
        { name: "s", repo: "o/r", accountId: "a1", state: "running", cloning: false },
      ]),
    });
    const sessions = await list();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].status).toBe("running");
  });
});
