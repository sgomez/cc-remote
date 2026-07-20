import { describe, expect, it } from "vitest";
import { InvalidPermissionModeError } from "./errors";
import {
  assertValidPermissionMode,
  DEFAULT_PERMISSION_MODE,
  isValidPermissionMode,
  PERMISSION_MODES,
} from "./permission-mode";

describe("permission mode", () => {
  it("offers exactly the two modes this deployment has exercised", () => {
    expect(PERMISSION_MODES).toEqual(["auto", "bypassPermissions"]);
  });

  it("defaults to the filtered mode", () => {
    expect(DEFAULT_PERMISSION_MODE).toBe("auto");
  });

  it.each(PERMISSION_MODES)("accepts %s", (mode) => {
    expect(isValidPermissionMode(mode)).toBe(true);
    expect(() => assertValidPermissionMode(mode)).not.toThrow();
  });

  // Claude Code understands these, but this deployment has never run a Session
  // in them, so the domain refuses them rather than shipping an untested mode.
  it.each([
    "default",
    "acceptEdits",
    "plan",
    "dontAsk",
    "",
    "AUTO",
    "auto ",
  ])("rejects %o", (mode) => {
    expect(isValidPermissionMode(mode)).toBe(false);
    expect(() => assertValidPermissionMode(mode)).toThrow(InvalidPermissionModeError);
  });

  it("names the offending value and the valid set in the error", () => {
    const err = new InvalidPermissionModeError("plan");
    expect(err.code).toBe("invalid_permission_mode");
    expect(err.message).toContain("plan");
    expect(err.message).toContain("bypassPermissions");
  });
});
