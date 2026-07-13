import { describe, expect, it } from "vitest";
import { navigationTypes, sectionOf } from "./transitions";

const nav = (
  fromPath: string | undefined,
  toPath: string,
  over: Partial<{ reducedMotion: boolean; pathChanged: boolean }> = {},
) =>
  navigationTypes({
    fromPath,
    toPath,
    pathChanged: over.pathChanged ?? true,
    reducedMotion: over.reducedMotion ?? false,
  });

describe("sectionOf", () => {
  it("maps a section's list and its children to that section", () => {
    expect(sectionOf("/sessions")).toBe("sessions");
    expect(sectionOf("/sessions/api-refactor")).toBe("sessions");
    expect(sectionOf("/accounts/abc123")).toBe("accounts");
  });

  it("has no section for paths off the sidebar", () => {
    expect(sectionOf("/login")).toBeUndefined();
    expect(sectionOf("/")).toBeUndefined();
  });

  it("does not match a section that is merely a name prefix", () => {
    expect(sectionOf("/sessions-archive")).toBeUndefined();
  });
});

describe("navigationTypes", () => {
  it("morphs within a section, letting the shared elements carry it", () => {
    expect(nav("/sessions", "/sessions/api-refactor")).toEqual(["morph"]);
    expect(nav("/sessions/api-refactor", "/sessions")).toEqual(["morph"]);
    expect(nav("/accounts", "/accounts/abc123")).toEqual(["morph"]);
  });

  // The regression this guards: direction used to come from the history index,
  // and every sidebar click is a push — so both lateral directions came out
  // "forward" and the slide never mirrored.
  it("mirrors a lateral move: sidebar order decides, not the history index", () => {
    expect(nav("/sessions", "/accounts")).toEqual(["forward"]);
    expect(nav("/accounts", "/sessions")).toEqual(["backward"]);
  });

  it("takes direction from the section, not the depth of the path", () => {
    expect(nav("/sessions/api-refactor", "/accounts/abc123")).toEqual(["forward"]);
    expect(nav("/accounts/abc123", "/sessions/api-refactor")).toEqual(["backward"]);
  });

  it("skips the transition entirely under reduced motion", () => {
    expect(nav("/sessions", "/accounts", { reducedMotion: true })).toBe(false);
  });

  it("skips the transition when only search or hash changed", () => {
    expect(nav("/accounts/new", "/accounts/new", { pathChanged: false })).toBe(false);
  });

  it("leaves paths off the sidebar untyped, for a plain cross-fade", () => {
    expect(nav("/login", "/sessions")).toEqual([]);
    expect(nav(undefined, "/sessions")).toEqual([]);
  });
});
