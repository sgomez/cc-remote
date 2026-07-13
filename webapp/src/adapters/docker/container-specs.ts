// Pure builders: (SessionContainerSpec | CloneContainerSpec | seed request) +
// infra config -> dockerode ContainerCreateOptions. All the assembly the adapter
// does (volume mounts, infra env merge, hardening flags) lives here so it is
// unit-testable; docker-container-engine.ts just hands the result to dockerode.
// No domain decisions — those already happened in core. Containers mount named
// volumes only; no host path is ever bound in.

import type Docker from "dockerode";
import type { CloneContainerSpec, LoginContainerSpec, SessionContainerSpec } from "../../core";
import {
  ACCOUNT_CONFIG_DIR_ENV,
  ACCOUNT_CONFIG_MOUNT,
  type DockerAdapterConfig,
  WORKSPACE_MOUNT,
} from "./config";
import {
  cloneContainerName,
  loginContainerName,
  loginTerminalBasePath,
  mainContainerName,
} from "./container-mapping";

/**
 * Relative path (inside an Account Config Volume) whose appearance signals a
 * completed login — the OAuth credential store Claude Code writes. `hasCredentials`
 * polls for it; the Login Container flow (#14) depends on this being the marker.
 */
export const CREDENTIALS_MARKER = ".claude/.credentials.json";

/** Mount point used by the short-lived seed / credential-probe helper containers. */
export const HELPER_VOLUME_MOUNT = "/vol";

/** Clone command: env-interpolated only (never string-concatenated with request data). */
const CLONE_CMD =
  "find . -mindepth 1 -delete && " +
  'git clone "https://x-access-token:$GITHUB_TOKEN@github.com/$GITHUB_REPO.git" . && ' +
  "chown -R $PUID:$PGID .";

function toEnvArray(env: Record<string, string>): string[] {
  return Object.entries(env).map(([k, v]) => `${k}=${v}`);
}

/** Infra env every container gets, merged UNDER the domain env (domain wins). */
function infraEnv(config: DockerAdapterConfig): Record<string, string> {
  const env: Record<string, string> = { PUID: config.puid, PGID: config.pgid };
  if (config.gitUserName) env.GIT_USER_NAME = config.gitUserName;
  if (config.gitUserEmail) env.GIT_USER_EMAIL = config.gitUserEmail;
  return env;
}

function mergeEnv(base: Record<string, string>, override: Record<string, string>): string[] {
  return toEnvArray({ ...base, ...override });
}

/**
 * The agent image is built by `docker compose build`, which bakes
 * com.docker.compose.project/service labels into it — and containers inherit
 * image labels. Left alone, compose then treats every sibling container as a
 * replica of the claude-agent service (`deploy.replicas: 0`), so a
 * `docker compose up`/`down --remove-orphans` would stop or delete live
 * Sessions. Inherited labels can't be removed at create time, only overridden:
 * blank them so compose never claims ownership of what the adapter creates.
 */
function disownCompose(labels: Record<string, string> = {}): Record<string, string> {
  return {
    ...labels,
    "com.docker.compose.project": "",
    "com.docker.compose.service": "",
    "com.docker.compose.version": "",
  };
}

/**
 * THE hardening. Every container this adapter creates goes through here — the
 * Session, the Login Container, the clone helper and both short-lived volume
 * helpers. It is a single function precisely because it used not to be: each of
 * those five built its `HostConfig` inline and only the Session ever got
 * `Memory`, while the clone helper — the one that unpacks arbitrarily large
 * repos — had no `PidsLimit` at all. A table of five hand-maintained copies is
 * how a limit goes missing; adding one here cannot miss a call site.
 *
 * What it pins, and why:
 *
 * - `NetworkMode` — `config.network` is the AGENTS network, which
 *   docker-socket-proxy is NOT on, so nothing inside an agent container can
 *   reach the Docker API (the S1 trust boundary; see docker-compose.yaml).
 * - `Memory` + `MemorySwap` — an agent runs untrusted, AI-generated code under
 *   `--permission-mode auto`. Unbounded, one runaway build or alloc bomb takes
 *   the whole VPS down, *including web-manager*, i.e. the thing you would use to
 *   log in and kill it. `MemorySwap` is set EQUAL to `Memory` on purpose: that
 *   is Docker's spelling for "no swap". Leaving it unset defaults swap to 2x the
 *   limit, so a "2g" container can still touch 4g and thrash the host's disk —
 *   the cap would look real and not be one. (On a host with swap accounting off,
 *   Docker only *warns*; the memory cap still applies.)
 * - `NanoCpus` — uniformly, even on the seed helper that just writes a JSON file
 *   and could not care less. A CPU share costs a short-lived container nothing,
 *   and "apply it only where it matters" is the reasoning that produced the
 *   missing `PidsLimit` above.
 * - `PidsLimit` — fork-bomb ceiling.
 * - `no-new-privileges` — no setuid escalation.
 *
 * The Session adds its restart policy on top; the ephemeral containers must not
 * have one (they are expected to exit).
 */
function baseHostConfig(config: DockerAdapterConfig, binds: string[]): Docker.HostConfig {
  const hostConfig: Docker.HostConfig = {
    Binds: binds,
    SecurityOpt: ["no-new-privileges:true"],
    PidsLimit: config.pidsLimit,
    NetworkMode: config.network,
  };
  if (config.memoryLimit) {
    hostConfig.Memory = config.memoryLimit;
    hostConfig.MemorySwap = config.memoryLimit;
  }
  if (config.nanoCpus) hostConfig.NanoCpus = config.nanoCpus;
  return hostConfig;
}

/**
 * Main agent container. Runs the image default entrypoint + CMD (ttyd web
 * console) — the terminal every Session gets. Mounts its workspace volume plus
 * the Account Config Volume (staged at ACCOUNT_CONFIG_MOUNT, which entrypoint.sh
 * symlinks ~/.claude(.json) into).
 */
export function buildSessionCreateOptions(
  spec: SessionContainerSpec,
  config: DockerAdapterConfig,
): Docker.ContainerCreateOptions {
  const binds = [
    `${spec.workspaceVolume}:${WORKSPACE_MOUNT}`,
    `${spec.accountConfigVolume}:${ACCOUNT_CONFIG_MOUNT}`,
  ];
  // Tell entrypoint.sh to link ~/.claude(.json) into the staged volume.
  const infra = { ...infraEnv(config), [ACCOUNT_CONFIG_DIR_ENV]: ACCOUNT_CONFIG_MOUNT };

  return {
    name: mainContainerName(spec.sessionName),
    Image: config.agentImage,
    Tty: true,
    OpenStdin: true,
    Env: mergeEnv(infra, spec.env),
    Labels: disownCompose(spec.labels),
    HostConfig: { ...baseHostConfig(config, binds), RestartPolicy: { Name: config.restartPolicy } },
  };
}

/**
 * Login Container (#14). The image default ENTRYPOINT (entrypoint.sh) still
 * runs — it symlinks `~/.claude(.json)` into the mounted Account Config Volume
 * (`ACCOUNT_CONFIG_DIR`), so credentials the login writes persist to the volume
 * where `hasCredentials` polls. The default CMD is REPLACED with a ttyd bound to
 * the login base path so the WS proxy (#15) can reach it. It mounts ONLY the
 * config volume — no workspace, no repo, and crucially no GITHUB_TOKEN — so
 * nothing but the interactive `claude` login can happen inside. Ephemeral: no
 * restart policy (once login completes the poll destroys it).
 */
export function buildLoginCreateOptions(
  spec: LoginContainerSpec,
  config: DockerAdapterConfig,
): Docker.ContainerCreateOptions {
  const env = infraEnv(config);
  env[ACCOUNT_CONFIG_DIR_ENV] = ACCOUNT_CONFIG_MOUNT;

  const ttyd =
    `ttyd -p 7681 --base-path ${loginTerminalBasePath(spec.accountId)} ` +
    "-W /usr/local/bin/console-entrypoint.sh";

  return {
    name: loginContainerName(spec.accountId),
    Image: config.agentImage,
    Tty: true,
    OpenStdin: true,
    Cmd: ["sh", "-c", ttyd],
    Env: toEnvArray(env),
    Labels: disownCompose(spec.labels),
    // No RestartPolicy: ephemeral (the login poll destroys it once login completes).
    HostConfig: baseHostConfig(config, [`${spec.accountConfigVolume}:${ACCOUNT_CONFIG_MOUNT}`]),
  };
}

/**
 * Clone-helper container (phase one). Entrypoint overridden to a bare clone +
 * chown; credentials arrive via GITHUB_TOKEN/GITHUB_REPO env, never the Cmd.
 * Fully hardened like everything else: `git clone` of a hostile or merely huge
 * repo is one of the few things here that can genuinely exhaust RAM.
 */
export function buildCloneCreateOptions(
  spec: CloneContainerSpec,
  config: DockerAdapterConfig,
): Docker.ContainerCreateOptions {
  return {
    name: cloneContainerName(spec.sessionName),
    Image: config.agentImage,
    WorkingDir: WORKSPACE_MOUNT,
    Entrypoint: [],
    Cmd: ["sh", "-c", CLONE_CMD],
    Env: mergeEnv(infraEnv(config), spec.env),
    Labels: disownCompose(spec.labels),
    HostConfig: baseHostConfig(config, [`${spec.workspaceVolume}:${WORKSPACE_MOUNT}`]),
  };
}

/**
 * Short-lived helper that writes `content` to `filePath` inside `volumeName`.
 * Content and path travel as env vars so nothing is interpolated into the shell
 * (the seeded JSON can contain anything). Files are chowned to the node user so
 * the agent container can read/write them. The engine drives create -> start ->
 * wait -> remove explicitly (no AutoRemove, which would race the exit-code read).
 */
export function buildSeedCreateOptions(
  volumeName: string,
  filePath: string,
  content: string,
  config: DockerAdapterConfig,
): Docker.ContainerCreateOptions {
  return {
    Image: config.agentImage,
    Entrypoint: [],
    Cmd: [
      "sh",
      "-c",
      'mkdir -p "$(dirname "' +
        HELPER_VOLUME_MOUNT +
        '/$SEED_PATH")" && ' +
        'printf %s "$SEED_CONTENT" > "' +
        HELPER_VOLUME_MOUNT +
        '/$SEED_PATH" && ' +
        `chown -R $PUID:$PGID ${HELPER_VOLUME_MOUNT}`,
    ],
    Env: toEnvArray({
      SEED_PATH: filePath,
      SEED_CONTENT: content,
      PUID: config.puid,
      PGID: config.pgid,
    }),
    Labels: disownCompose(),
    // Hardened like the rest, even though this helper only writes a JSON file and
    // needs no network at all: `baseHostConfig` pins NetworkMode explicitly, because
    // omitting it would drop the container on Docker's default bridge — which is
    // *not* the socket proxy's network and so happens to be safe, but "safe by
    // accident" is not a property to rely on. EVERY container this adapter creates
    // is pinned to the agents network and carries the same limits.
    HostConfig: baseHostConfig(config, [`${volumeName}:${HELPER_VOLUME_MOUNT}`]),
  };
}

/**
 * Short-lived helper whose exit code reports whether the credential marker
 * exists in `volumeName` (0 = present). The engine reads only the exit code.
 */
export function buildHasCredentialsCreateOptions(
  volumeName: string,
  config: DockerAdapterConfig,
): Docker.ContainerCreateOptions {
  return {
    Image: config.agentImage,
    Entrypoint: [],
    Cmd: ["sh", "-c", `test -f "${HELPER_VOLUME_MOUNT}/${CREDENTIALS_MARKER}"`],
    Labels: disownCompose(),
    // Same hardening as the seed helper above: no container this adapter creates is
    // left to Docker's default network choice, or to no resource limits.
    HostConfig: baseHostConfig(config, [`${volumeName}:${HELPER_VOLUME_MOUNT}:ro`]),
  };
}
