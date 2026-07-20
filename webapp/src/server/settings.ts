// Deployment Settings server functions: thin delivery glue over the two settings
// use cases. No logic here — the "absent row means the domain default" rule and
// the Permission Mode validation both live in the core, so they are covered by
// core tests rather than by exercising a page.

import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { requireSession } from "~/adapters/auth";
import { type DeploymentSettings, makeGetSettings, makeUpdateSettings } from "~/core";
import { settingRepository } from "./runtime";

async function guard(): Promise<void> {
  await requireSession(getRequest().headers);
}

export const fetchSettings = createServerFn({ method: "GET" }).handler(
  async (): Promise<DeploymentSettings> => {
    await guard();
    return makeGetSettings({ settings: await settingRepository() })();
  },
);

export const updateSettings = createServerFn({ method: "POST" })
  .validator((data: { defaultPermissionMode: string }) => data)
  .handler(async ({ data }): Promise<DeploymentSettings> => {
    await guard();
    return makeUpdateSettings({ settings: await settingRepository() })(data);
  });

/**
 * The deployment default, for the session server functions. Create uses it when
 * the operator's form did not name a mode; reset uses it only for a Session
 * created before the permission-mode label existed.
 */
export async function deploymentDefaultPermissionMode(): Promise<string> {
  const settings = await makeGetSettings({ settings: await settingRepository() })();
  return settings.defaultPermissionMode;
}
