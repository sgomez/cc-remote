// Deployment layer: the process-wide background work the delivery layer owns.
// Nitro auto-registers plugins under serverDir, so this runs once per server
// start (dev and prod), on the same shared engine/repository the routes use.
//
//  - Login poller: recovers orphaned Login Containers, then polls the Account
//    Config Volumes so a completed `claude /login` flips its Account to `ready`
//    and its Login Container is destroyed. Nothing else drives that flip — the
//    accounts SSE stream only reports what the poller has already written.
//  - Graceful shutdown: SIGTERM/SIGINT stops running Session containers.

import { definePlugin } from "nitro";
import { registerGracefulShutdown, startLoginPoller } from "~/adapters/docker";
import { accountRepository, containerEngine } from "~/server/runtime";

export default definePlugin((nitro) => {
  const engine = containerEngine();

  const detachShutdown = registerGracefulShutdown(engine, {
    onStopped: (names) => {
      if (names.length > 0) console.log(`[shutdown] stopped sessions: ${names.join(", ")}`);
    },
  });

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
    detachShutdown();
  });
});
