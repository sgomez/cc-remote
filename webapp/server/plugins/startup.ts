// Deployment layer: the process-wide background work the delivery layer owns.
// Nitro auto-registers plugins under serverDir, so this runs once per server
// start (dev and prod), on the same shared engine/repository the routes use.
//
//  - Login poller: recovers orphaned Login Containers, then polls the Account
//    Config Volumes so a completed `claude /login` flips its Account to `ready`
//    and its Login Container is destroyed. Nothing else drives that flip — the
//    accounts SSE stream only reports what the poller has already written.
//
// Deliberately NO session shutdown on SIGTERM: Sessions are independent sibling
// containers with their own `unless-stopped` policy, and web-manager restarts
// (every redeploy sends it SIGTERM) must not kill agents mid-task. The legacy
// stop-all-on-SIGTERM did exactly that — and `docker stop` marks a container
// manually stopped, so the sessions never came back on their own. Trade-off:
// `docker compose down` now can't remove the network while sessions run
// (harmless error); stop them from the UI first for a full teardown.

import { definePlugin } from "nitro";
import { startLoginPoller } from "~/adapters/docker";
import { accountRepository, containerEngine } from "~/server/runtime";

export default definePlugin((nitro) => {
  const engine = containerEngine();

  let stopPoller: (() => void) | undefined;

  // The repository opens SQLite lazily; the poller only exists once it does.
  void accountRepository().then((accounts) => {
    stopPoller = startLoginPoller(
      { engine, accounts },
      {
        onFlipped: (ids) => console.log(`[login-poller] account(s) ready: ${ids.join(", ")}`),
        onError: (err) => console.error("[login-poller] poll failed:", err),
      },
    );
    console.log("[login-poller] started");
  });

  nitro.hooks.hook("close", () => {
    stopPoller?.();
  });
});
