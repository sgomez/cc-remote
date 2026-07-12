// Domain errors. Framework-free; the delivery layer maps these to HTTP codes.
// Each carries a stable `code` so adapters can branch without string matching.

export class DomainError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = new.target.name;
    this.code = code;
  }
}

export class UnknownProviderTypeError extends DomainError {
  constructor(id: string) {
    super("unknown_provider_type", `Unknown provider type: ${id}`);
  }
}

export class MissingAccountFieldError extends DomainError {
  constructor(field: string) {
    super("missing_account_field", `Missing required account field: ${field}`);
  }
}

export class SingletonAccountExistsError extends DomainError {
  constructor(providerType: string) {
    super(
      "singleton_account_exists",
      `A ${providerType} account already exists; this provider type is a singleton.`,
    );
  }
}

export class AccountNotFoundError extends DomainError {
  constructor(id: string) {
    super("account_not_found", `Account not found: ${id}`);
  }
}

export class AccountNotReadyError extends DomainError {
  constructor(id: string) {
    super("account_not_ready", `Account ${id} is not ready; complete its login first.`);
  }
}

export class AccountInUseError extends DomainError {
  readonly sessions: string[];
  constructor(id: string, sessions: string[]) {
    super(
      "account_in_use",
      `Account ${id} cannot be deleted while ${sessions.length} session(s) use it: ${sessions.join(", ")}.`,
    );
    this.sessions = sessions;
  }
}

export class CredentialsNotFoundError extends DomainError {
  constructor(id: string) {
    super(
      "credentials_not_found",
      `No credentials detected in the config volume for account ${id}.`,
    );
  }
}

export class InvalidSessionNameError extends DomainError {
  constructor(name: string) {
    super(
      "invalid_session_name",
      `Invalid session name "${name}": use 1-64 alphanumerics, dashes or underscores.`,
    );
  }
}

export class InvalidRepoError extends DomainError {
  constructor(repo: string) {
    super("invalid_repo", `Invalid repository "${repo}": expected owner/repo.`);
  }
}

export class SessionExistsError extends DomainError {
  constructor(name: string) {
    super("session_exists", `A session named "${name}" already exists.`);
  }
}

export class SessionNotFoundError extends DomainError {
  constructor(name: string) {
    super("session_not_found", `Session not found: ${name}`);
  }
}

export class CloneFailedError extends DomainError {
  readonly exitCode: number;
  constructor(name: string, exitCode: number) {
    super("clone_failed", `Clone for session "${name}" failed with exit code ${exitCode}.`);
    this.exitCode = exitCode;
  }
}
