// SSE stream of Session status (#15). Docker is the source of truth, so this
// polls the labelled containers and pushes the list whenever it changes —
// notably the two-phase `cloning` → `running` / `clone_failed` transition the
// UI (#16) morphs on. A plain TSS server route: streaming Responses flow through
// the fetch handler without buffering (proven by the #3 prototype).

import { createFileRoute } from "@tanstack/react-router";
import { makeListSessions } from "~/core";
import { containerEngine } from "~/server/runtime";
import { statusStreamResponse } from "~/server/status-stream";

export const Route = createFileRoute("/api/sessions/status")({
  server: {
    handlers: {
      GET: ({ request }) => {
        const listSessions = makeListSessions({ engine: containerEngine() });
        return statusStreamResponse(request, {
          event: "sessions",
          // Stable order so equal states serialize equally for change detection.
          poll: async () => (await listSessions()).sort((a, b) => a.name.localeCompare(b.name)),
        });
      },
    },
  },
});
