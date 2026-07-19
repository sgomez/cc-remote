// Infrastructure configuration for the Docker adapter. These are deployment
// facts (from setup.sh / .env), NOT domain data: the agent image name, the
// compose network the sibling containers join, host uid/gid, and hardening
// limits. No host paths: agent containers mount named volumes only.

/** Where inside every container the workspace volume is mounted. */
export const WORKSPACE_MOUNT = "/workspace";

/** Container HOME (the node user). */
export const HOME_DIR = "/home/node";

/**
 * Staging mount point for an Account Config Volume. The whole volume is bound
 * here; entrypoint.sh symlinks ~/.claude and ~/.claude.json into it (see the
 * mount-strategy note in this directory's README). A single mount avoids
 * Docker volume-subpath fragility when the `.claude` dir does not yet exist on
 * a freshly-seeded api-key volume.
 */
export const ACCOUNT_CONFIG_MOUNT = `${HOME_DIR}/.claude-config`;

/** Env var read by entrypoint.sh to know it must link into a config volume. */
export const ACCOUNT_CONFIG_DIR_ENV = "ACCOUNT_CONFIG_DIR";

export type DockerHost = { protocol: "http"; host: string; port: number } | { socketPath: string };

export type DockerAdapterConfig = {
  /** dockerode connection target (socket proxy over TCP, or raw socket). */
  host: DockerHost;
  /** Agent image both phases run (`cc-remote-claude-agent` by default). */
  agentImage: string;
  /**
   * The AGENTS network (`cc-remote-agents`) every sibling container joins — the
   * one web-manager shares with them so the WS proxy can reach their ttyd. It is
   * NOT the control network the docker-socket-proxy lives on: no container this
   * adapter creates may ever be able to reach the proxy.
   */
  network: string;
  puid: string;
  pgid: string;
  pidsLimit: number;
  /**
   * Bytes. Applied as BOTH `Memory` and `MemorySwap` (see container-specs.ts).
   * Omitted / 0 = no limit — which is a deployment that one runaway build can
   * take down, so setup.sh always derives a value.
   */
  memoryLimit?: number;
  /** CPU quota in nano-CPUs (1 core = 1e9). Omitted / 0 = no limit. */
  nanoCpus?: number;
  restartPolicy: string;
};

/**
 * Docker's own floor for `Memory` (`--memory` rejects anything smaller).
 * Anything under it is rejected rather than silently clamped.
 */
export const MIN_MEMORY_BYTES = 6 * 1024 * 1024;

/** One CPU core, in the nano-CPU units `HostConfig.NanoCpus` wants. */
export const NANO_CPUS_PER_CORE = 1_000_000_000;

/** An `AGENT_*` limit that Docker would reject (or that is plainly a typo). */
export class AgentLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentLimitError";
  }
}

const MEMORY_UNITS: Record<string, number> = {
  b: 1,
  k: 1024,
  m: 1024 ** 2,
  g: 1024 ** 3,
};

/**
 * Parse a human memory size the way `docker run --memory` does: a bare number is
 * BYTES, a `b`/`k`/`m`/`g` suffix (case-insensitive, optional trailing `b`, so
 * `512M` and `512mb` both work) scales it, and a fraction like `1.5g` is allowed.
 *
 * This exists because the old code was `Number.parseInt(env.AGENT_MEMORY_LIMIT)`,
 * which turns the *natural* thing to write — `AGENT_MEMORY_LIMIT=2g` — into
 * `2`: a two-BYTE limit. Docker rejects that, so every Session would have failed
 * to create; a value like `2048m` would have silently become 2048 bytes. Rather
 * than guess, an unparseable or out-of-range value now throws.
 *
 * Empty/unset -> undefined (no limit). An explicit `0` -> undefined as well:
 * that is Docker's own "unlimited" spelling and the documented opt-out.
 *
 * NOTE: config.js (the setup wizard) re-implements this in plain JS — it runs in
 * a throwaway node:22-slim container that cannot import the webapp's TypeScript.
 * The two must agree; keep them in sync if the accepted format ever changes.
 */
export function parseMemoryBytes(raw: string | undefined, varName = "AGENT_MEMORY_LIMIT"): number {
  const value = (raw ?? "").trim();
  if (value === "") return 0;

  const match = value.match(/^(\d+(?:\.\d+)?)\s*([bkmg])?b?$/i);
  if (!match) {
    throw new AgentLimitError(
      `${varName} must be a byte count or a size like 512m / 2g / 1.5g (got "${value}")`,
    );
  }

  const scale = MEMORY_UNITS[(match[2] ?? "b").toLowerCase()];
  const bytes = Math.floor(Number.parseFloat(match[1]) * scale);
  if (bytes === 0) return 0; // explicit opt-out

  if (bytes < MIN_MEMORY_BYTES) {
    throw new AgentLimitError(
      `${varName} must be at least ${MIN_MEMORY_BYTES} bytes (6m), Docker's minimum ` +
        `(got "${value}" = ${bytes} bytes). Set 0 to disable the limit explicitly.`,
    );
  }
  return bytes;
}

/**
 * Parse a CPU quota in cores (`1`, `1.5`, `0.5`) into nano-CPUs. Empty/unset or
 * `0` -> 0 (no limit). Negative/garbage throws, same fail-loud rule as memory.
 */
export function parseNanoCpus(raw: string | undefined, varName = "AGENT_CPU_LIMIT"): number {
  const value = (raw ?? "").trim();
  if (value === "") return 0;

  if (!/^\d+(?:\.\d+)?$/.test(value)) {
    throw new AgentLimitError(
      `${varName} must be a positive number of CPU cores like 1, 1.5 or 0.5 (got "${value}")`,
    );
  }
  return Math.floor(Number.parseFloat(value) * NANO_CPUS_PER_CORE);
}

/** Parse `tcp://host:port` (the socket-proxy form) or fall back to the raw socket. */
export function parseDockerHost(dockerHost: string | undefined): DockerHost {
  const match = dockerHost?.match(/^tcp:\/\/([^:/]+):(\d+)$/);
  if (match) {
    return { protocol: "http", host: match[1], port: Number.parseInt(match[2], 10) };
  }
  return { socketPath: "/var/run/docker.sock" };
}

/**
 * Deployment facts for the Docker adapter.
 *
 * THROWS (`AgentLimitError`) on an unparseable memory/CPU limit instead of
 * falling back to "no limit": a bad `AGENT_MEMORY_LIMIT` would otherwise leave
 * every agent container unbounded — the exact failure this config exists to
 * prevent — and do it silently. `loadDeploymentConfig` runs the same parse in
 * the container's `validate:env` preflight, so a typo in `.env` is reported at
 * start, with everything else that is wrong, rather than at first Session create.
 * (`AGENT_PIDS_LIMIT` keeps its permissive fallback: it falls back to 4096, i.e.
 * to a *limit*, so a bad value there cannot fail open.)
 */
export function configFromEnv(env: NodeJS.ProcessEnv = process.env): DockerAdapterConfig {
  const memory = parseMemoryBytes(env.AGENT_MEMORY_LIMIT);
  const nanoCpus = parseNanoCpus(env.AGENT_CPU_LIMIT);
  const pids = Number.parseInt(env.AGENT_PIDS_LIMIT ?? "", 10);
  return {
    host: parseDockerHost(env.DOCKER_HOST),
    agentImage: env.AGENT_IMAGE || "cc-remote-claude-agent",
    // The AGENTS network — never the control network the socket proxy sits on.
    // NETWORKS is disabled on the socket proxy, so it cannot be discovered at
    // runtime (legacy inspected it); it must be configured, and the default must
    // fail safe: an agent container that landed on the proxy's network could
    // POST /containers/create with `Binds: ["/:/host"]` (the proxy does not vet
    // request bodies) and own the host. See docker-compose.yaml's `networks:`.
    network: env.AGENT_NETWORK || "cc-remote-agents",
    puid: env.PUID || "1000",
    pgid: env.PGID || "1000",
    pidsLimit: Number.isInteger(pids) && pids > 0 ? pids : 4096,
    memoryLimit: memory > 0 ? memory : undefined,
    nanoCpus: nanoCpus > 0 ? nanoCpus : undefined,
    restartPolicy: env.AGENT_RESTART_POLICY || "unless-stopped",
  };
}
