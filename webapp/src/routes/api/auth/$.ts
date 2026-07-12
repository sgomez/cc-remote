// Catch-all better-auth endpoint. All /api/auth/* requests (sign-in, callback,
// session, sign-out, ...) delegate to `auth.handler`. Server handlers only —
// the TanStack Start compiler keeps `auth` (and its better-sqlite3 dependency)
// out of the client bundle.

import { createFileRoute } from "@tanstack/react-router";
import { auth } from "~/adapters/auth/auth";

export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: ({ request }) => auth.handler(request),
      POST: ({ request }) => auth.handler(request),
    },
  },
});
