import { describe, expect, it } from "vitest";
import type { AccountStatus, SessionStatus } from "~/core";
import { accountStatusBadge, sessionStatusBadge } from "./badges";

describe("sessionStatusBadge", () => {
  it("animates the transient statuses (running, starting, restarting, cloning) and not the settled ones", () => {
    expect(sessionStatusBadge("running").animated).toBe(true);
    expect(sessionStatusBadge("starting").animated).toBe(true);
    expect(sessionStatusBadge("restarting").animated).toBe(true);
    expect(sessionStatusBadge("cloning").animated).toBe(true);
    expect(sessionStatusBadge("stopped").animated).toBe(false);
    expect(sessionStatusBadge("clone_failed").animated).toBe(false);
    expect(sessionStatusBadge("paused").animated).toBe(false);
    expect(sessionStatusBadge("error").animated).toBe(false);
    expect(sessionStatusBadge("unknown").animated).toBe(false);
  });

  it("uses the raw status as the CSS modifier so it maps to legacy tokens", () => {
    const statuses: SessionStatus[] = [
      "running",
      "starting",
      "restarting",
      "paused",
      "stopped",
      "error",
      "cloning",
      "clone_failed",
      "unknown",
    ];
    for (const s of statuses) {
      expect(sessionStatusBadge(s).className).toBe(s);
    }
  });

  it("humanizes clone_failed into a two-word label", () => {
    expect(sessionStatusBadge("clone_failed").label).toBe("clone failed");
  });

  it("labels error as crashed — distinct from a deliberate stop", () => {
    expect(sessionStatusBadge("error").label).toBe("crashed");
  });

  it("falls back to the unknown badge for a status this build doesn't recognise", () => {
    // Simulates a value the SSE stream sends that predates this build's type —
    // the bare Record lookup this replaced returned `undefined` and crashed
    // the component rendering it.
    const badge = sessionStatusBadge("some-future-status" as SessionStatus);
    expect(badge).toEqual(sessionStatusBadge("unknown"));
  });
});

describe("accountStatusBadge", () => {
  it("pulses pending_login and settles ready", () => {
    expect(accountStatusBadge("pending_login").animated).toBe(true);
    expect(accountStatusBadge("ready").animated).toBe(false);
  });

  it("keeps the raw status as the CSS modifier", () => {
    const statuses: AccountStatus[] = ["ready", "pending_login"];
    for (const s of statuses) {
      expect(accountStatusBadge(s).className).toBe(s);
    }
  });
});
