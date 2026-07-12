import { describe, expect, it } from "vitest";
import { listProviderTypes, requireProviderType } from "~/core";
import {
  accountCapabilities,
  deleteGuard,
  remoteControlPanel,
  seedingLabel,
  sessionActionState,
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

describe("sessionActionState — busy overlay on the lifecycle buttons", () => {
  it("running (idle): stop, reset, destroy in row order, none busy or disabled", () => {
    const btns = sessionActionState("running", null);
    expect(btns.map((b) => b.action)).toEqual(["stop", "reset", "destroy"]);
    expect(btns.every((b) => !b.busy && !b.disabled)).toBe(true);
  });

  it("stopped (idle): start, reset, destroy in row order", () => {
    expect(sessionActionState("stopped", null).map((b) => b.action)).toEqual([
      "start",
      "reset",
      "destroy",
    ]);
  });

  it("cloning: only destroy is offered", () => {
    expect(sessionActionState("cloning", null).map((b) => b.action)).toEqual(["destroy"]);
  });

  it("marks reset and destroy as confirm-gated, stop and start not", () => {
    const byAction = new Map(sessionActionState("running", null).map((b) => [b.action, b]));
    expect(byAction.get("reset")?.confirm).toBe(true);
    expect(byAction.get("destroy")?.confirm).toBe(true);
    expect(byAction.get("stop")?.confirm).toBe(false);
  });

  it("uses the progress label for each action", () => {
    const label = (status: Parameters<typeof sessionActionState>[0], busy: string) =>
      sessionActionState(status, busy as never).find((b) => b.action === busy)?.label;
    expect(label("running", "stop")).toBe("Stopping…");
    expect(label("stopped", "start")).toBe("Starting…");
    expect(label("running", "reset")).toBe("Resetting…");
    expect(label("running", "destroy")).toBe("Destroying…");
  });

  it("while an action is in flight: that button is busy and EVERY button is disabled", () => {
    const btns = sessionActionState("running", "stop");
    const stop = btns.find((b) => b.action === "stop");
    expect(stop?.busy).toBe(true);
    expect(stop?.label).toBe("Stopping…");
    expect(btns.every((b) => b.disabled)).toBe(true);
  });

  it("non-busy buttons keep their normal label while another action is in flight", () => {
    const reset = sessionActionState("running", "stop").find((b) => b.action === "reset");
    expect(reset?.busy).toBe(false);
    expect(reset?.label).toBe("Reset");
    expect(reset?.disabled).toBe(true);
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
