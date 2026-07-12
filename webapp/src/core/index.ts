// Public surface of the framework-free core. Adapters (#12, #13) and the
// delivery layer (#14, #15, #16) wire the ports and call the use case factories
// from here; they never reach into individual modules.

// Domain
export type { Account, AccountStatus } from "./domain/account";
export { accountConfigVolumeName, ownsConfigVolume } from "./domain/account";
export * from "./domain/errors";
export type { FieldSpec, ProviderType, SeedingMethod } from "./domain/provider-type";
export {
  findProviderType,
  listProviderTypes,
  requiredAccountFields,
  requireProviderType,
} from "./domain/provider-type";
export { ACCOUNT_CONFIG_FILE, buildAnthropicEnv, wizardSkipConfig } from "./domain/seeding";
export type { Session, SessionContainer, SessionStatus } from "./domain/session";
export {
  isValidRepo,
  isValidSessionName,
  SESSION_LABELS,
  workspaceVolumeName,
} from "./domain/session";

// Ports
export type { AccountRepository } from "./ports/account-repository";
export type { Clock } from "./ports/clock";
export type {
  CloneContainerSpec,
  ContainerEngine,
  SessionContainerSpec,
} from "./ports/container-engine";
export type { IdGenerator } from "./ports/id-generator";

// Use cases
export { type CreateSessionInput, makeCreateSession } from "./usecases/create-session";
export { type DeleteAccountInput, makeDeleteAccount } from "./usecases/delete-account";
export { type DestroySessionInput, makeDestroySession } from "./usecases/destroy-session";
export { makeListSessions } from "./usecases/list-sessions";
export { type MarkAccountReadyInput, makeMarkAccountReady } from "./usecases/mark-account-ready";
export { makeRegisterAccount, type RegisterAccountInput } from "./usecases/register-account";
export { makeResetSession, type ResetSessionInput } from "./usecases/reset-session";
export { makeStartSession, type StartSessionInput } from "./usecases/start-session";
export { makeStopSession, type StopSessionInput } from "./usecases/stop-session";
