// Deployment Settings — the preferences an operator changes from the browser
// instead of rerunning the installer and redeploying.
//
// Two thin use cases over the SettingRepository port. The "absent row means the
// domain default" rule lives here rather than in the page, so it is covered by
// core tests: a deployment that has never opened Settings behaves exactly as it
// did before the page existed.

import {
  assertValidPermissionMode,
  DEFAULT_PERMISSION_MODE,
  isValidPermissionMode,
  type PermissionMode,
} from "../domain/permission-mode";
import type { SettingRepository } from "../ports/setting-repository";

/** Row key for the deployment-wide default Permission Mode. */
export const DEFAULT_PERMISSION_MODE_KEY = "defaultPermissionMode";

export type DeploymentSettings = {
  defaultPermissionMode: PermissionMode;
};

export type SettingsDeps = {
  settings: SettingRepository;
};

export function makeGetSettings(deps: SettingsDeps) {
  return async function getSettings(): Promise<DeploymentSettings> {
    const stored = await deps.settings.get(DEFAULT_PERMISSION_MODE_KEY);
    // A stored value that is not a mode we offer (an older build, or a hand
    // edit) resolves to the default rather than taking the page down or
    // handing a Session a mode nobody chose.
    return {
      defaultPermissionMode:
        stored !== null && isValidPermissionMode(stored) ? stored : DEFAULT_PERMISSION_MODE,
    };
  };
}

export type UpdateSettingsInput = {
  defaultPermissionMode: string;
};

export function makeUpdateSettings(deps: SettingsDeps) {
  return async function updateSettings(input: UpdateSettingsInput): Promise<DeploymentSettings> {
    // Validate before writing: a rejected update must leave the stored value
    // exactly as it was.
    assertValidPermissionMode(input.defaultPermissionMode);
    await deps.settings.set(DEFAULT_PERMISSION_MODE_KEY, input.defaultPermissionMode);
    return { defaultPermissionMode: input.defaultPermissionMode };
  };
}
