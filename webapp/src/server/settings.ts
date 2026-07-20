// Deployment Settings server functions: thin delivery glue over the two settings
// use cases. No logic here — the "absent row means the domain default" rule and
// the Permission Mode validation both live in the core, so they are covered by
// core tests rather than by exercising a page.
//
// Every export here MUST be a `createServerFn`. Route modules import from this
// file, and the TanStack Start plugin only strips server-fn handlers (and with
// them the server-only imports below) from the client bundle. A plain exported
// helper survives that pass and drags `./runtime` -> dockerode -> ssh2 ->
// cpu-features into the browser build, which fails to resolve a native binding.

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
