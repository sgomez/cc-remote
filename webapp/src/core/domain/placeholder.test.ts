import { describe, expect, it } from "vitest";
import { appName, slugify } from "./placeholder";

describe("placeholder domain", () => {
  it("exposes the app name", () => {
    expect(appName).toBe("cc-remote");
  });

  it("slugifies a free-form label", () => {
    expect(slugify("  My Claude Account! ")).toBe("my-claude-account");
  });

  it("collapses runs of separators into a single dash", () => {
    expect(slugify("a__b--c  d")).toBe("a-b-c-d");
  });
});
