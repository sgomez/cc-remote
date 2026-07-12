// Pure form-state derivation for the new-session flow and the account picker
// (#16). Session names are slugified to the domain's NAME_REGEX shape and
// validated with the domain guards (isValidSessionName / isValidRepo) so the UI
// never lets through a name the core would reject. The account picker greys out
// (never hides) pending_login accounts. Framework-free; colocated tests.

import type { AccountStatus } from "~/core";
import { isValidRepo, isValidSessionName } from "~/core";

/**
 * Reduce free-typed input to a valid session-name slug: lowercase, non
 * `[a-z0-9_-]` runs collapsed to `-`, edge dashes trimmed, capped at 64 chars
 * (the domain NAME_REGEX bound). Returns "" for input with no usable chars.
 */
export function slugifySessionName(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

export type SessionNameState = {
  slug: string;
  /** slug is a valid, unused session name. */
  valid: boolean;
  /** slug collides with an existing session. */
  taken: boolean;
};

export function sessionNameState(raw: string, existingNames: string[]): SessionNameState {
  const slug = slugifySessionName(raw);
  const taken = slug !== "" && existingNames.includes(slug);
  return { slug, taken, valid: slug !== "" && isValidSessionName(slug) && !taken };
}

/** A repo is valid when it matches the domain `owner/name` shape. */
export function repoValid(repo: string): boolean {
  return isValidRepo(repo.trim());
}

export type AccountPickerOption = {
  id: string;
  displayName: string;
  providerType: string;
  status: AccountStatus;
  /** Only ready accounts can run a session; pending_login is shown but greyed. */
  selectable: boolean;
};

export function accountPickerOptions(
  accounts: ReadonlyArray<{
    id: string;
    displayName: string;
    providerType: string;
    status: AccountStatus;
  }>,
): AccountPickerOption[] {
  return accounts.map((a) => ({
    id: a.id,
    displayName: a.displayName,
    providerType: a.providerType,
    status: a.status,
    selectable: a.status === "ready",
  }));
}

/** Whether the new-session form can submit: valid name, valid repo, a ready account. */
export function canCreateSession(input: {
  nameState: SessionNameState;
  repo: string;
  selectedAccount?: { status: AccountStatus };
}): boolean {
  return (
    input.nameState.valid && repoValid(input.repo) && input.selectedAccount?.status === "ready"
  );
}
