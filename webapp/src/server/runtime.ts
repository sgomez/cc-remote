// Server composition root for the delivery layer (#15 WS/SSE; #16 UI wires more
// here later). Lazily builds and memoizes the shared Docker engine so the Nitro
// WS route and the TSS session-status SSE route talk to the same adapter. Kept
// out of `src/core` (framework-free) and out of the route modules (thin glue).
//
// Nothing here runs at import time — the engine is created on first use, so unit
// tests (which never import this) need no Docker daemon.
//
// The AccountRepository is deliberately NOT wired here yet: importing MikroORM
// (`~/adapters/db`) into the server bundle drags in knex and its unused SQL
// dialects (`mysql2`, ...) which the current build cannot resolve. That runtime
// wiring lands with the ORM-in-server build config in deployment (#17) and the
// account-status SSE stream that consumes it (#14).

import { createDockerContainerEngine, type DockerContainerEngine } from "~/adapters/docker";

let engine: DockerContainerEngine | undefined;

/** The shared Docker `ContainerEngine`, talking to the socket proxy. */
export function containerEngine(): DockerContainerEngine {
  engine ??= createDockerContainerEngine();
  return engine;
}
