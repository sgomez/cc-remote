// Public surface of the Docker adapter. The delivery layer wires the engine
// (createDockerContainerEngine) into the core use cases and registers graceful
// shutdown; the WS proxy (#15) imports ttydBasePath so the terminal base path
// has one source of truth.

export {
  ACCOUNT_CONFIG_MOUNT,
  configFromEnv,
  type DockerAdapterConfig,
  parseDockerHost,
} from "./config";
export {
  loginTerminalBasePath,
  TTYD_PORT,
  ttydBasePath,
  ttydWebSocketUrl,
} from "./container-mapping";
export { CREDENTIALS_MARKER } from "./container-specs";
export {
  createDockerContainerEngine,
  DockerContainerEngine,
} from "./docker-container-engine";
export {
  type GracefulShutdownOptions,
  registerGracefulShutdown,
  stopRunningSessions,
} from "./graceful-shutdown";
export {
  DEFAULT_LOGIN_POLL_INTERVAL_MS,
  type LoginPollerDeps,
  type LoginPollerOptions,
  startLoginPoller,
} from "./login-poller";
