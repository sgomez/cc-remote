import { describe, expect, it } from "vitest";
import {
  findProviderType,
  listProviderTypes,
  requiredAccountFields,
  requireProviderType,
} from "./provider-type";

describe("Provider Type catalogue", () => {
  it("exposes the four curated entries", () => {
    const ids = listProviderTypes().map((t) => t.id);
    expect(ids).toEqual(["claude-local", "claude", "deepseek", "custom"]);
  });

  it("looks a type up by id", () => {
    expect(findProviderType("deepseek")?.label).toBe("DeepSeek");
    expect(findProviderType("nope")).toBeUndefined();
  });

  it("declares claude-local as a host-mount, remote-control singleton", () => {
    const t = requireProviderType("claude-local");
    expect(t.seeding).toBe("host-mount");
    expect(t.remoteControl).toBe(true);
    expect(t.singleton).toBe(true);
    expect(t.accountFields).toEqual([]);
  });

  it("declares claude as an oauth remote-control type", () => {
    const t = requireProviderType("claude");
    expect(t.seeding).toBe("oauth");
    expect(t.remoteControl).toBe(true);
    expect(t.singleton).toBe(false);
  });

  it("declares deepseek as an api-key type carrying curated presets", () => {
    const t = requireProviderType("deepseek");
    expect(t.seeding).toBe("api-key");
    expect(t.remoteControl).toBe(false);
    expect(t.singleton).toBe(false);
    expect(t.presets?.baseUrl).toBe("https://api.deepseek.com/anthropic");
    expect(t.presets?.model).toBeTruthy();
    // deepseek supplies only its secret; baseUrl/model come from presets.
    expect(requiredAccountFields(t).map((f) => f.name)).toEqual(["apiKey"]);
  });

  it("declares custom as an api-key type whose accounts supply baseUrl and model", () => {
    const t = requireProviderType("custom");
    expect(t.seeding).toBe("api-key");
    expect(t.remoteControl).toBe(false);
    expect(t.presets).toBeUndefined();
    const fields = t.accountFields;
    expect(fields.find((f) => f.name === "baseUrl")?.store).toBe("config");
    expect(fields.find((f) => f.name === "model")?.store).toBe("config");
    expect(fields.find((f) => f.name === "apiKey")?.store).toBe("credentials");
  });

  it("requireProviderType throws on an unknown id", () => {
    expect(() => requireProviderType("glm")).toThrow();
  });
});
