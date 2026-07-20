import { describe, expect, it } from "vitest";
import { FakeSettingRepository } from "../../../test/fake-setting-repository";
import { InvalidPermissionModeError } from "../domain/errors";
import { DEFAULT_PERMISSION_MODE } from "../domain/permission-mode";
import { DEFAULT_PERMISSION_MODE_KEY, makeGetSettings, makeUpdateSettings } from "./settings";

describe("getSettings", () => {
  it("falls back to the domain default when nothing was ever stored", async () => {
    const getSettings = makeGetSettings({ settings: new FakeSettingRepository() });
    expect(await getSettings()).toEqual({ defaultPermissionMode: DEFAULT_PERMISSION_MODE });
  });

  it("returns the stored default", async () => {
    const getSettings = makeGetSettings({
      settings: new FakeSettingRepository({
        [DEFAULT_PERMISSION_MODE_KEY]: "bypassPermissions",
      }),
    });
    expect(await getSettings()).toEqual({ defaultPermissionMode: "bypassPermissions" });
  });

  // A value written by an older build, or edited into the DB by hand, must not
  // take the Settings page down — nor silently become a mode nobody chose.
  it("falls back to the domain default when the stored value is not a valid mode", async () => {
    const getSettings = makeGetSettings({
      settings: new FakeSettingRepository({ [DEFAULT_PERMISSION_MODE_KEY]: "plan" }),
    });
    expect(await getSettings()).toEqual({ defaultPermissionMode: DEFAULT_PERMISSION_MODE });
  });
});

describe("updateSettings", () => {
  it("persists a valid default permission mode and returns the new settings", async () => {
    const settings = new FakeSettingRepository();
    const update = makeUpdateSettings({ settings });

    const result = await update({ defaultPermissionMode: "bypassPermissions" });

    expect(result).toEqual({ defaultPermissionMode: "bypassPermissions" });
    expect(await settings.get(DEFAULT_PERMISSION_MODE_KEY)).toBe("bypassPermissions");
  });

  it("rejects a mode outside the valid set without writing anything", async () => {
    const settings = new FakeSettingRepository();
    const update = makeUpdateSettings({ settings });

    await expect(update({ defaultPermissionMode: "plan" })).rejects.toThrow(
      InvalidPermissionModeError,
    );
    expect(await settings.get(DEFAULT_PERMISSION_MODE_KEY)).toBeNull();
  });

  it("overwrites a previously stored default", async () => {
    const settings = new FakeSettingRepository({
      [DEFAULT_PERMISSION_MODE_KEY]: "bypassPermissions",
    });
    const update = makeUpdateSettings({ settings });

    expect(await update({ defaultPermissionMode: "auto" })).toEqual({
      defaultPermissionMode: "auto",
    });
    expect(await settings.get(DEFAULT_PERMISSION_MODE_KEY)).toBe("auto");
  });
});
