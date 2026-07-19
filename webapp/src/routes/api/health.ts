// Health check endpoint used by the bootstrap screen to detect when the
// deployment has restarted after saving configuration. The browser polls
// this during the restart window; a 200 response means the server is back
// and the operator can be redirected to /login.

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: () =>
        new Response(JSON.stringify({ ok: true }), {
          headers: { "Content-Type": "application/json" },
        }),
    },
  },
});
