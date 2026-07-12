// Server composition root for the delivery layer (#15 WS/SSE; #16 UI). Lazily
// builds and memoizes the shared Docker engine and the SQLite-backed
// AccountRepository so every Nitro WS route, TSS SSE route, and server function
// talks to the same adapters. Kept out of `src/core` (framework-free) and out
// of the route modules (thin glue).
//
// Nothing here runs at import time — the engine and ORM are created on first
// use, so unit tests (which never import this) need no Docker daemon or DB.

import { initOrm, MikroOrmAccountRepository } from "~/adapters/db";
import { createDockerContainerEngine, type DockerContainerEngine } from "~/adapters/docker";
import type { AccountRepository } from "~/core";

let engine: DockerContainerEngine | undefined;

/** The shared Docker `ContainerEngine`, talking to the socket proxy. */
export function containerEngine(): DockerContainerEngine {
  engine ??= createDockerContainerEngine();
  return engine;
}

/**
 * Permission mode baked into seeded configs and passed to new agent containers
 * (`claude --permission-mode`). Defaults to `auto` — the unattended default the
 * legacy web-manager and agent image use (CLAUDE.md "Auto Mode").
 */
export function permissionMode(): string {
  return process.env.PERMISSION_MODE ?? "auto";
}

let accountsPromise: Promise<AccountRepository> | undefined;

/**
 * The shared SQLite-backed `AccountRepository`. The ORM is initialised once
 * (WAL, strict file permissions) and the promise memoized, so concurrent server
 * functions await the same instance instead of racing to open the DB file.
 */
export function accountRepository(): Promise<AccountRepository> {
  accountsPromise ??= initOrm().then((orm) => new MikroOrmAccountRepository(orm));
  return accountsPromise;
}
