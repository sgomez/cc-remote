import { describe, expect, it } from "vitest";
import type { AccountStatus, SessionStatus } from "~/core";
import { accountStatusBadge, sessionStatusBadge } from "./badges";

describe("sessionStatusBadge", () => {
  it("animates the live statuses (running, cloning) and not the terminal ones", () => {
    expect(sessionStatusBadge("running").animated).toBe(true);
    expect(sessionStatusBadge("cloning").animated).toBe(true);
    expect(sessionStatusBadge("stopped").animated).toBe(false);
    expect(sessionStatusBadge("clone_failed").animated).toBe(false);
  });

  it("uses the raw status as the CSS modifier so it maps to legacy tokens", () => {
    const statuses: SessionStatus[] = ["running", "stopped", "cloning", "clone_failed"];
    for (const s of statuses) {
      expect(sessionStatusBadge(s).className).toBe(s);
    }
  });

  it("humanizes clone_failed into a two-word label", () => {
    expect(sessionStatusBadge("clone_failed").label).toBe("clone failed");
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
