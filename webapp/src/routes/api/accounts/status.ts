// SSE stream of Account status (#16, mirroring the session-status stream #15).
// SQLite is the source of truth for Accounts, so this polls the repository and
// pushes the (id, status) list whenever it changes — notably the
// `pending_login` → `ready` flip the Login-Container poller performs, which the
// accounts UI morphs on inside a View Transition. A plain TSS server route:
// streaming Responses flow through the fetch handler without buffering.

import { createFileRoute } from "@tanstack/react-router";
import { accountRepository } from "~/server/runtime";
import { statusStreamResponse } from "~/server/status-stream";

export const Route = createFileRoute("/api/accounts/status")({
  server: {
    handlers: {
      GET: ({ request }) =>
        statusStreamResponse(request, {
          event: "accounts",
          poll: async () => {
            const accounts = await accountRepository().then((r) => r.findAll());
            // Only id + status: the fields the UI morphs on. Stable order so
            // equal states serialize equally for change detection.
            return accounts
              .map((a) => ({ id: a.id, status: a.status }))
              .sort((x, y) => x.id.localeCompare(y.id));
          },
        }),
    },
  },
});
