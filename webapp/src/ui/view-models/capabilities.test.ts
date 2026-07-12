import { describe, expect, it } from "vitest";
import { listProviderTypes, requireProviderType } from "~/core";
import {
  accountCapabilities,
  deleteGuard,
  remoteControlPanel,
  seedingLabel,
  sessionActions,
} from "./capabilities";

describe("sessionActions", () => {
  it("running: stop, reset, destroy — no start, no retry", () => {
    expect(sessionActions("running")).toEqual({
      canStart: false,
      canStop: true,
      canReset: true,
      canDestroy: true,
      canRetry: false,
    });
  });

  it("stopped: start, reset, destroy", () => {
    const a = sessionActions("stopped");
    expect(a.canStart).toBe(true);
    expect(a.canStop).toBe(false);
    expect(a.canReset).toBe(true);
    expect(a.canDestroy).toBe(true);
  });

  it("cloning: only destroy (mid-provision)", () => {
    expect(sessionActions("cloning")).toEqual({
      canStart: false,
      canStop: false,
      canReset: false,
      canDestroy: true,
      canRetry: false,
    });
  });

  it("clone_failed: retry + destroy, no reset", () => {
    const a = sessionActions("clone_failed");
    expect(a.canRetry).toBe(true);
    expect(a.canReset).toBe(false);
    expect(a.canDestroy).toBe(true);
  });
});

describe("seedingLabel / accountCapabilities", () => {
  it("humanizes each seeding method", () => {
    expect(seedingLabel("api-key")).toBe("API key");
    expect(seedingLabel("host-mount")).toBe("host mount");
    expect(seedingLabel("oauth")).toBe("OAuth");
  });

  it("reads capabilities straight from the catalogue entry", () => {
    const caps = accountCapabilities(requireProviderType("deepseek"));
    expect(caps).toEqual({ remoteControl: false, seedingLabel: "API key", singleton: false });
  });
});

describe("remoteControlPanel — driven by the catalogue for all four types", () => {
  it("matches each Provider Type's remoteControl flag", () => {
    for (const type of listProviderTypes()) {
      expect(remoteControlPanel(type).available).toBe(type.remoteControl);
    }
    // Explicit per-type assertions (the acceptance criterion names all four).
    expect(remoteControlPanel(requireProviderType("claude-local")).available).toBe(true);
    expect(remoteControlPanel(requireProviderType("claude")).available).toBe(true);
    expect(remoteControlPanel(requireProviderType("deepseek")).available).toBe(false);
    expect(remoteControlPanel(requireProviderType("custom")).available).toBe(false);
  });

  it("names the provider in the unavailable note", () => {
    const note = remoteControlPanel(requireProviderType("deepseek")).unavailableNote;
    expect(note).toContain("DeepSeek");
  });
});

describe("deleteGuard", () => {
  it("allows deletion with no sessions", () => {
    expect(deleteGuard(0)).toEqual({ deletable: true });
  });

  it("blocks with a singular reason for one session", () => {
    const g = deleteGuard(1);
    expect(g.deletable).toBe(false);
    expect(g.reason).toBe("deletion blocked — destroy its 1 session first");
  });

  it("blocks with a plural reason for many", () => {
    expect(deleteGuard(3).reason).toBe("deletion blocked — destroy its 3 sessions first");
  });
});
