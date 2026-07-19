// Commit Identity: the git author a Session's agent commits as.
//
// It is the authenticated user who provisioned the Session, never a
// deployment-wide value. The email is always GitHub's id-qualified `noreply`
// address rather than the account's real address, for two reasons:
//
//  - Attribution. GitHub links a commit to a profile only when the address is
//    one it recognises for that account. `<id>+<login>@users.noreply.github.com`
//    always is; a real address is linked only while it stays verified on the
//    account, and the legacy `<login>@users.noreply.github.com` form only works
//    for accounts predating the id-qualified one.
//  - Push rejection. With "Block command line pushes that expose my email"
//    enabled, GitHub rejects (GH007) a push whose commits carry the account's
//    private address. The noreply address is immune.
//
// A real address is therefore never correct here, even when GitHub exposes one.

import { InvalidCommitIdentityError } from "./errors";

export type CommitIdentity = {
  name: string;
  email: string;
};

/** GitHub ids are numeric; anything else means we read the wrong field. */
const GITHUB_ID_REGEX = /^\d+$/;

export function githubNoreplyEmail(githubId: string, githubLogin: string): string {
  return `${githubId}+${githubLogin}@users.noreply.github.com`;
}

export function buildCommitIdentity(input: {
  name?: string | null;
  githubId: string;
  githubLogin: string;
}): CommitIdentity {
  const githubId = input.githubId.trim();
  const githubLogin = input.githubLogin.trim();

  if (!githubId) throw new InvalidCommitIdentityError("githubId");
  if (!GITHUB_ID_REGEX.test(githubId)) {
    throw new InvalidCommitIdentityError("githubId", `expected a numeric id, got "${githubId}"`);
  }
  if (!githubLogin) throw new InvalidCommitIdentityError("githubLogin");

  return {
    name: input.name?.trim() || githubLogin,
    email: githubNoreplyEmail(githubId, githubLogin),
  };
}
