# Per-user commit identity

## Status

accepted

## Decision

A Session's git author is the **Commit Identity** of the signed-in user who provisioned it, resolved from their GitHub profile at container-create time and carried in that Session's environment. The deployment-wide `GIT_USER_NAME`/`GIT_USER_EMAIL` pair is removed from `config.js`, `config.json`, `.env`, the compose file, and the Docker adapter's config. No fallback replaces it.

The email is **always** the id-qualified GitHub `noreply` address, `<id>+<login>@users.noreply.github.com`, even when GitHub exposes the account's real address.

Only the Session container receives an identity. The clone helper and the Login Container never commit and carry none.

## Context

The wizard resolved git identity by shelling out to `git config --global` on the host. But `config.js` runs inside a throwaway `node:22-slim` container that never mounts `~/.gitconfig`, so the lookup always failed and every deployment silently fell back to `Claude Remote Agent <agent@example.com>`. That value was not a placeholder anyone had chosen; it was the failure mode. Commits made by agents were authored by an address belonging to no GitHub account, so GitHub attributed them to nobody.

The move from console configuration to browser configuration made this worth settling rather than patching: the deployment already knows exactly who is driving it, because sign-in is GitHub-only and gated by a fail-closed allow-list.

## Considered options

**Fix the host lookup instead.** Mounting `~/.gitconfig` into the wizard container would make the derived value real. Rejected: it produces one identity for the whole deployment when the deployment already authenticates individual users, and it reintroduces the host coupling that removing the `host-mount` Seeding Method deliberately eliminated.

**A bot identity, properly configured.** Prompt for a name and address and use them everywhere. Rejected as the primary model because it discards attribution the deployment already has for free. It also fails to solve the harder half: a bot address that does not belong to a GitHub account is exactly the situation that produced unattributed commits in the first place.

**A Settings screen.** Rejected. After this change nothing else in the compiled configuration is a candidate for it: the public domain, ports, auth secret, PUID/PGID and agent resource caps are all host facts that web-manager structurally cannot discover (`docker info` is blocked on the socket proxy and stays blocked). The one remaining candidate, permission mode, belongs on the create-Session form rather than a global page. Adding a screen for a single future setting is speculative surface, and ADR 0001 already drew this same boundary.

**Keep the deployment-wide value as a fallback.** Rejected on the same grounds ADR 0001 rejected an `.env` fallback for the Bootstrap File: two sources for one value is a precedence rule that has to be explained forever. Worse here, the fallback could only ever apply when the real identity is missing, which is precisely when committing should fail loudly rather than quietly author as nobody.

**Use the account's real email when GitHub exposes it.** Rejected. It is linked to the profile only while it stays verified on the account, and with "Block command line pushes that expose my email" enabled GitHub rejects the push outright (GH007). The noreply address is correct in both cases, so a real address is never the better choice.

**Preserve the original creator's identity across a reset.** Rejected. It requires reading the departing container's environment or adding a label, plus a branch for when it is absent, to serve a distinction that does not exist under a single-user allow-list. A reset adopts the identity of whoever performs it.

## Consequences

- **Sessions created before this change keep committing as `Claude Remote Agent` until they are recreated.** They carry the old environment, and container environment is immutable. `reset` fixes it but destroys the workspace volume, so this is not a free migration. To repair a Session in place without losing work: `docker exec -it cc-remote-session-<name> git config --global user.email "<id>+<login>@users.noreply.github.com"` and likewise for `user.name`.
- No schema change, no migration, and no re-login were required. The GitHub numeric id is read from better-auth's own `account.accountId`, which it writes from the provider profile on every sign-in, so it is already populated for existing users. `user.name` is likewise better-auth's default mapping of `profile.name || profile.login`.
- `buildCommitIdentity` throws rather than substituting a default when the login or the id is missing. Both are invariants by the time a Session can be created, so a throw means the delivery layer read the wrong field. Failing at Session creation is much cheaper than discovering the problem in a repository's history.
- Commits are no longer distinguishable as agent-authored by their author field. Provenance still exists: the push itself is attributed to the GitHub App, which is visible on the repository's activity.
- `entrypoint.sh` keeps its `[ -n "$GIT_USER_NAME" ]` guards. They are no longer about an optional deployment setting but about the Login Container, which has no Session identity and legitimately arrives with neither variable set.
