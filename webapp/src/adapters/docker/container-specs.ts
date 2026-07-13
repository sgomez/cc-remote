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

/** Shared hardening flags carried over from the legacy Express web-manager. */
function baseHostConfig(config: DockerAdapterConfig, binds: string[]): Docker.HostConfig {
  const hostConfig: Docker.HostConfig = {
    Binds: binds,
    RestartPolicy: { Name: config.restartPolicy },
    SecurityOpt: ["no-new-privileges:true"],
    PidsLimit: config.pidsLimit,
    NetworkMode: config.network,
  };
  if (config.memoryLimit) hostConfig.Memory = config.memoryLimit;
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
    HostConfig: baseHostConfig(config, binds),
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
    HostConfig: {
      Binds: [`${spec.accountConfigVolume}:${ACCOUNT_CONFIG_MOUNT}`],
      SecurityOpt: ["no-new-privileges:true"],
      PidsLimit: config.pidsLimit,
      NetworkMode: config.network,
    },
  };
}

/**
 * Clone-helper container (phase one). Entrypoint overridden to a bare clone +
 * chown; credentials arrive via GITHUB_TOKEN/GITHUB_REPO env, never the Cmd.
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
    HostConfig: {
      Binds: [`${spec.workspaceVolume}:${WORKSPACE_MOUNT}`],
      SecurityOpt: ["no-new-privileges:true"],
      NetworkMode: config.network,
    },
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
    HostConfig: {
      Binds: [`${volumeName}:${HELPER_VOLUME_MOUNT}`],
      SecurityOpt: ["no-new-privileges:true"],
    },
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
    HostConfig: {
      Binds: [`${volumeName}:${HELPER_VOLUME_MOUNT}:ro`],
      SecurityOpt: ["no-new-privileges:true"],
    },
  };
}
