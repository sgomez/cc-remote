// Server composition root for the delivery layer (#15 WS/SSE; #16 UI). Lazily
// builds and memoizes the shared Docker engine, the SQLite-backed
// AccountRepository, and the BrokerSecretRegistry so every Nitro WS route, TSS
// SSE route, server function, and the broker plugin talks to the same adapters.
// Kept out of `src/core` (framework-free) and out of the route modules (thin glue).
//
// Nothing here runs at import time — the engine, ORM, and registry are created
// on first use, so unit tests (which never import this) need no Docker daemon
// or DB.

import { initOrm, MikroOrmAccountRepository, MikroOrmSettingRepository } from "~/adapters/db";
import { createDockerContainerEngine, type DockerContainerEngine } from "~/adapters/docker";
import type { AccountRepository, BrokerSecretRegistry, SettingRepository } from "~/core";

let engine: DockerContainerEngine | undefined;

/** The shared Docker `ContainerEngine`, talking to the socket proxy. */
export function containerEngine(): DockerContainerEngine {
  engine ??= createDockerContainerEngine();
  return engine;
}

/**
 * The broker URL sessions use to reach the credential broker. Defaults to the
 * Docker service name on the agents network, on the broker's dedicated port.
 */
export function brokerUrl(): string {
  return process.env.BROKER_URL ?? "http://web-manager:4001";
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

let settingsPromise: Promise<SettingRepository> | undefined;

/**
 * The shared SQLite-backed `SettingRepository` — the ONLY source of a Deployment
 * Setting. Nothing in the environment supplies or overrides one, so there is no
 * precedence question: `PERMISSION_MODE` is deliberately absent from
 * web-manager's environment, and reading it here would resurrect a second
 * apparent source that silently did nothing.
 */
export function settingRepository(): Promise<SettingRepository> {
  settingsPromise ??= initOrm().then((orm) => new MikroOrmSettingRepository(orm));
  return settingsPromise;
}

let secretRegistry: BrokerSecretRegistry | undefined;

/**
 * The shared in-memory `BrokerSecretRegistry`. Session provisioning registers
 * per-Session secrets here; the broker validates against the same store.
 * Survives as long as the process does — a server restart drops all entries
 * (a trade accepted while the durable token remains; the registry can move to
 * a more durable store later without touching the port interface).
 */
export function brokerSecretRegistry(): BrokerSecretRegistry {
  if (!secretRegistry) {
    const entries = new Map<string, { sessionName: string; repo: string }>();
    secretRegistry = {
      register(secret, sessionName, repo) {
        entries.set(secret, { sessionName, repo });
      },
      async lookup(secret) {
        const cached = entries.get(secret);
        if (cached) return cached;

        try {
          const entry = await containerEngine().findSessionBySecret(secret);
          if (entry) {
            entries.set(secret, entry);
            return entry;
          }
        } catch (err) {
          console.error("[broker-registry] failed to recover secret from docker:", err);
        }
        return null;
      },
    };
  }
  return secretRegistry;
}
