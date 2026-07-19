// Public surface of the framework-free core. Adapters (#12, #13) and the
// delivery layer (#14, #15, #16) wire the ports and call the use case factories
// from here; they never reach into individual modules.

// Domain
export type { Account, AccountStatus } from "./domain/account";
export { accountConfigVolumeName } from "./domain/account";
export type {
  BootstrapRecord,
  DeploymentState,
  ManifestConversionResponse,
} from "./domain/bootstrap";
export {
  deriveBootstrapRecordFromManifest,
  generateClaimToken,
  validateBootstrapRecord,
  verifyClaimToken,
} from "./domain/bootstrap";
export * from "./domain/errors";
export type { LoginContainer } from "./domain/login";
export { buildLoginLabels, LOGIN_LABELS } from "./domain/login";
export type { FieldSpec, ProviderType, SeedingMethod } from "./domain/provider-type";
export {
  findProviderType,
  listProviderTypes,
  requiredAccountFields,
  requireProviderType,
} from "./domain/provider-type";
export { ACCOUNT_CONFIG_FILE, buildAnthropicEnv, wizardSkipConfig } from "./domain/seeding";
export type {
  ContainerState,
  Session,
  SessionContainer,
  SessionStatus,
} from "./domain/session";
export {
  isValidRepo,
  isValidSessionName,
  SESSION_LABELS,
  toSessionStatus,
  workspaceVolumeName,
} from "./domain/session";
export type { SessionLogs, SessionLogsSource } from "./domain/session-logs";
export { createLogSanitizer, DEFAULT_LOG_TAIL, sanitizeLogText } from "./domain/session-logs";
export type { WorkspaceGitProbe, WorkspaceState } from "./domain/workspace-state";
export { parseWorkspaceProbe, WORKSPACE_PROBE_SEPARATOR } from "./domain/workspace-state";

// Ports
export type { AccountRepository } from "./ports/account-repository";
export type {
  BrokerSecretEntry,
  BrokerSecretRegistry,
} from "./ports/broker-secret-registry";
export type { Clock } from "./ports/clock";
export type {
  CloneContainerSpec,
  ContainerEngine,
  LogFollow,
  LoginContainerSpec,
  LogSink,
  SessionContainerSpec,
} from "./ports/container-engine";
export type {
  GitHubInstallation,
  GitHubTokenCredential,
  GitHubTokenIssuer,
} from "./ports/github-token-issuer";
export type { IdGenerator } from "./ports/id-generator";

// Use cases
export {
  type CheckLoginInput,
  type CheckLoginResult,
  makeCheckLogin,
} from "./usecases/check-login";
export { type CreateSessionInput, makeCreateSession } from "./usecases/create-session";
export { type DeleteAccountInput, makeDeleteAccount } from "./usecases/delete-account";
export { type DestroySessionInput, makeDestroySession } from "./usecases/destroy-session";
export {
  type FollowSessionLogsInput,
  makeFollowSessionLogs,
  type SessionLogSink,
} from "./usecases/follow-session-logs";
export { makeListSessions } from "./usecases/list-sessions";
export { type MarkAccountReadyInput, makeMarkAccountReady } from "./usecases/mark-account-ready";
export {
  BrokerTokenRefusedError,
  type MintBrokerTokenDeps,
  type MintBrokerTokenInput,
  makeMintBrokerToken,
} from "./usecases/mint-broker-token";
export { makePollLogins } from "./usecases/poll-logins";
export {
  makeReadSessionLogs,
  type ReadSessionLogsInput,
} from "./usecases/read-session-logs";
export {
  makeReadWorkspaceState,
  type ReadWorkspaceStateInput,
} from "./usecases/read-workspace-state";
export { makeRecoverLogins } from "./usecases/recover-logins";
export { makeRegisterAccount, type RegisterAccountInput } from "./usecases/register-account";
export { makeResetSession, type ResetSessionInput } from "./usecases/reset-session";
export { makeStartLogin, type StartLoginInput } from "./usecases/start-login";
export { makeStartSession, type StartSessionInput } from "./usecases/start-session";
export { makeStopSession, type StopSessionInput } from "./usecases/stop-session";
