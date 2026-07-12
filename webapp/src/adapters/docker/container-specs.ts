// Pure builders: (SessionContainerSpec | CloneContainerSpec | seed request) +
// infra config -> dockerode ContainerCreateOptions. All the branching the
// adapter does (config-volume vs host-mount, infra env merge, hardening flags)
// lives here so it is unit-testable; docker-container-engine.ts just hands the
// result to dockerode. No domain decisions — those already happened in core.

import type Docker from "dockerode";
import type { CloneContainerSpec, SessionContainerSpec } from "../../core";
import {
  ACCOUNT_CONFIG_DIR_ENV,
  ACCOUNT_CONFIG_MOUNT,
  type DockerAdapterConfig,
  HOST_CLAUDE_DIR,
  HOST_CLAUDE_JSON,
  WORKSPACE_MOUNT,
} from "./config";
import { cloneContainerName, mainContainerName } from "./container-mapping";

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

/** Shared hardening flags carried over from legacy `web/server.js`. */
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
 * console) — the terminal every Session gets. Mounts either the Account Config
 * Volume (api-key / oauth) at a staging path, or the host Claude config
 * (claude-local, host-mount) directly.
 */
export function buildSessionCreateOptions(
  spec: SessionContainerSpec,
  config: DockerAdapterConfig,
): Docker.ContainerCreateOptions {
  const binds = [`${spec.workspaceVolume}:${WORKSPACE_MOUNT}`];
  const infra = infraEnv(config);

  if (spec.accountConfigVolume) {
    binds.push(`${spec.accountConfigVolume}:${ACCOUNT_CONFIG_MOUNT}`);
    // Tell entrypoint.sh to link ~/.claude(.json) into the staged volume.
    infra[ACCOUNT_CONFIG_DIR_ENV] = ACCOUNT_CONFIG_MOUNT;
  } else {
    // host-mount (claude-local): bind the host's onboarded config in place.
    if (!config.hostClaudeConfigPath || !config.hostClaudeJsonPath) {
      throw new Error(
        `Session '${spec.sessionName}' needs a host-mount config but ` +
          "CLAUDE_CONFIG_PATH / CLAUDE_JSON_PATH are not set. A deployment " +
          "without them cannot run claude-local Sessions.",
      );
    }
    binds.push(`${config.hostClaudeConfigPath}:${HOST_CLAUDE_DIR}`);
    binds.push(`${config.hostClaudeJsonPath}:${HOST_CLAUDE_JSON}`);
  }

  return {
    name: mainContainerName(spec.sessionName),
    Image: config.agentImage,
    Tty: true,
    OpenStdin: true,
    Env: mergeEnv(infra, spec.env),
    Labels: spec.labels,
    HostConfig: baseHostConfig(config, binds),
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
    Labels: spec.labels,
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
    HostConfig: {
      Binds: [`${volumeName}:${HELPER_VOLUME_MOUNT}:ro`],
      SecurityOpt: ["no-new-privileges:true"],
    },
  };
}
