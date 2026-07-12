// Infrastructure configuration for the Docker adapter. These are deployment
// facts (from setup.sh / .env), NOT domain data: the agent image name, the
// compose network the sibling containers join, host uid/gid, hardening limits,
// and the optional host Claude config paths for claude-local (host-mount).

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

/** Host-mount targets for claude-local (unchanged from legacy). */
export const HOST_CLAUDE_DIR = `${HOME_DIR}/.claude`;
export const HOST_CLAUDE_JSON = `${HOME_DIR}/.claude.json`;

export type DockerHost = { protocol: "http"; host: string; port: number } | { socketPath: string };

export type DockerAdapterConfig = {
  /** dockerode connection target (socket proxy over TCP, or raw socket). */
  host: DockerHost;
  /** Agent image both phases run (`cc-remote-claude-agent` by default). */
  agentImage: string;
  /** Compose network the sibling containers join so the WS proxy can reach them. */
  network: string;
  puid: string;
  pgid: string;
  pidsLimit: number;
  /** Bytes; omitted = no limit. */
  memoryLimit?: number;
  restartPolicy: string;
  gitUserName?: string;
  gitUserEmail?: string;
  /** claude-local host bind sources; absent = deployment has no claude-local. */
  hostClaudeConfigPath?: string;
  hostClaudeJsonPath?: string;
};

/** Parse `tcp://host:port` (the socket-proxy form) or fall back to the raw socket. */
export function parseDockerHost(dockerHost: string | undefined): DockerHost {
  const match = dockerHost?.match(/^tcp:\/\/([^:/]+):(\d+)$/);
  if (match) {
    return { protocol: "http", host: match[1], port: Number.parseInt(match[2], 10) };
  }
  return { socketPath: "/var/run/docker.sock" };
}

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): DockerAdapterConfig {
  const memory = Number.parseInt(env.AGENT_MEMORY_LIMIT ?? "", 10);
  const pids = Number.parseInt(env.AGENT_PIDS_LIMIT ?? "", 10);
  return {
    host: parseDockerHost(env.DOCKER_HOST),
    agentImage: env.AGENT_IMAGE || "cc-remote-claude-agent",
    // NETWORKS is disabled on the socket proxy, so the network cannot be
    // discovered at runtime (legacy inspected it) — it must be configured.
    network: env.AGENT_NETWORK || "cc-remote_default",
    puid: env.PUID || "1000",
    pgid: env.PGID || "1000",
    pidsLimit: Number.isInteger(pids) && pids > 0 ? pids : 4096,
    memoryLimit: Number.isInteger(memory) && memory > 0 ? memory : undefined,
    restartPolicy: env.AGENT_RESTART_POLICY || "unless-stopped",
    gitUserName: env.GIT_USER_NAME || undefined,
    gitUserEmail: env.GIT_USER_EMAIL || undefined,
    hostClaudeConfigPath: env.CLAUDE_CONFIG_PATH || undefined,
    hostClaudeJsonPath: env.CLAUDE_JSON_PATH || undefined,
  };
}
