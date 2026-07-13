// SSE route for a Session's container logs — the live half of the Logs modal.
// Thin delivery glue: the stream/teardown lifecycle lives in src/server/log-stream.ts
// (sibling of status-stream.ts), where it is exercised against a real daemon.

import { createFileRoute } from "@tanstack/react-router";
import { logStreamResponse } from "~/server/log-stream";

export const Route = createFileRoute("/api/sessions/$sessionName/logs")({
  server: {
    handlers: {
      GET: ({ request, params }) => logStreamResponse(request, params.sessionName),
    },
  },
});
