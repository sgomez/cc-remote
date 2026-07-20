import { describe, expect, it } from "vitest";
import {
  permissionModeBadge,
  permissionModeOptions,
  prefilledPermissionMode,
} from "./permission-mode";

describe("permissionModeOptions", () => {
  it("offers exactly the two modes the domain allows", () => {
    expect(permissionModeOptions().map((o) => o.value)).toEqual(["auto", "bypassPermissions"]);
  });

  // Raw mode identifiers ("bypassPermissions") tell an operator nothing without
  // Claude Code's docs open in another tab.
  it("labels the modes in plain words, not raw identifiers", () => {
    const [filtered, unfiltered] = permissionModeOptions();
    expect(filtered.label).toBe("Filtered");
    expect(unfiltered.label).toBe("Unfiltered");
    expect(filtered.description).toMatch(/safety classifier/i);
  });

  // The unfiltered option must say both what it permits and why this deployment
  // considers it acceptable, at the point of choosing.
  it("explains the unfiltered option and why the deployment allows it", () => {
    const unfiltered = permissionModeOptions()[1];
    expect(unfiltered.description).toMatch(/without asking/i);
    expect(unfiltered.notice).toMatch(/container/i);
  });
});

describe("prefilledPermissionMode", () => {
  it("starts from the deployment default so the common case needs no touch", () => {
    expect(prefilledPermissionMode("bypassPermissions")).toBe("bypassPermissions");
    expect(prefilledPermissionMode("auto")).toBe("auto");
  });

  // A default the server could not resolve must not leave the form on a mode
  // nobody chose; fall back to the filtered one.
  it("falls back to the filtered mode when the default is unusable", () => {
    expect(prefilledPermissionMode(undefined)).toBe("auto");
    expect(prefilledPermissionMode("plan")).toBe("auto");
  });
});

describe("permissionModeBadge", () => {
  it("describes each mode in the same words the selector uses", () => {
    expect(permissionModeBadge("auto")).toEqual({ label: "Filtered", tone: "neutral" });
    expect(permissionModeBadge("bypassPermissions")).toEqual({
      label: "Unfiltered",
      tone: "warn",
    });
  });

  // A Session created before the mode was recorded: showing nothing is honest,
  // inventing "Filtered" would not be.
  it("shows no badge for a Session whose mode was never recorded", () => {
    expect(permissionModeBadge(null)).toBeNull();
  });
});
