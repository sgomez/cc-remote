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

/**
 * The authenticated user is missing a field the Commit Identity is built from.
 * Both are invariants by the time a Session can be created (the fail-closed
 * allow-list rejects a sign-in without `githubLogin`, and better-auth writes
 * `accountId` on every sign-in), so this means the delivery layer read the wrong
 * field. Fail loud rather than author commits as nobody.
 */
export class InvalidCommitIdentityError extends DomainError {
  constructor(field: string, detail?: string) {
    super(
      "invalid_commit_identity",
      `Cannot build a commit identity: ${field} is missing or invalid` +
        (detail ? ` (${detail})` : "") +
        ". Sign out and sign in again to refresh the GitHub profile.",
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

export class LoginNotSupportedError extends DomainError {
  constructor(id: string) {
    super(
      "login_not_supported",
      `Account ${id} is not an OAuth account; it has no Login Container flow.`,
    );
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

export class RepositoryNotGrantedError extends DomainError {
  readonly repo: string;
  constructor(repo: string) {
    super(
      "repository_not_granted",
      `Repository "${repo}" is not covered by any GitHub App installation. Add it from the Repositories screen.`,
    );
    this.repo = repo;
  }
}

export class CloneFailedError extends DomainError {
  readonly exitCode: number;
  constructor(name: string, exitCode: number) {
    super("clone_failed", `Clone for session "${name}" failed with exit code ${exitCode}.`);
    this.exitCode = exitCode;
  }
}

/**
 * A Permission Mode outside the deployment's valid set reached the domain.
 * Thrown before a Session is created, so an operator never has to destroy a
 * Session to find out its agent could not start.
 */
export class InvalidPermissionModeError extends DomainError {
  constructor(mode: string) {
    super(
      "invalid_permission_mode",
      `Invalid permission mode: ${JSON.stringify(mode)}. Valid modes: auto, bypassPermissions.`,
    );
  }
}
