// Graceful shutdown: on SIGTERM/SIGINT the server stops running Session
// containers (legacy `handleShutdown`), so `docker compose down` leaves no
// agent running. Written against the ContainerEngine port, so the logic is
// covered by the same in-memory fake the core uses.

import type { ContainerEngine } from "../../core";

/**
 * Stop every running main Session container (best-effort). Clone helpers are
 * short-lived and left alone. Returns the names actually stopped.
 */
export async function stopRunningSessions(engine: ContainerEngine): Promise<string[]> {
  const containers = await engine.listSessionContainers();
  const running = [
    ...new Set(containers.filter((c) => !c.cloning && c.state === "running").map((c) => c.name)),
  ];

  const stopped: string[] = [];
  for (const name of running) {
    try {
      await engine.stopContainer(name);
      stopped.push(name);
    } catch {
      // Best-effort: one container failing to stop must not block the rest.
    }
  }
  return stopped;
}

export type GracefulShutdownOptions = {
  signals?: NodeJS.Signals[];
  onStopped?: (names: string[]) => void;
};

/**
 * Attach SIGTERM/SIGINT handlers that stop running Sessions. Returns a
 * disposer that detaches them (useful in tests / hot reload).
 */
export function registerGracefulShutdown(
  engine: ContainerEngine,
  options: GracefulShutdownOptions = {},
): () => void {
  const signals = options.signals ?? (["SIGTERM", "SIGINT"] as NodeJS.Signals[]);
  const handlers = new Map<NodeJS.Signals, () => void>();

  for (const signal of signals) {
    const handler = () => {
      void stopRunningSessions(engine).then((names) => options.onStopped?.(names));
    };
    handlers.set(signal, handler);
    process.on(signal, handler);
  }

  return () => {
    for (const [signal, handler] of handlers) process.off(signal, handler);
  };
}
