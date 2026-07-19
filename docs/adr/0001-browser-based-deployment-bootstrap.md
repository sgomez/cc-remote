# Browser-based deployment bootstrap

## Status

proposed

## Decision

The deployment's GitHub identity (App ID, slug, private key, OAuth client credentials, sign-in allow-list) is no longer gathered by the console wizard. `setup.sh` asks only for infrastructure the host alone can supply, and the identity is registered from a browser screen served by web-manager once the stack is running, using GitHub's App Manifest Flow.

The driving reason is not form ergonomics. The Manifest Flow is what removes both real pains at once (creating the App by hand on github.com, and transcribing a multi-line PEM), and it requires a browser. On a headless VPS reached over SSH, the browser is the only client with a natural route to the deployment, because Caddy already terminates TLS on the public domain. A console-hosted manifest flow would need the operator to port-forward a localhost callback over SSH.

## Considered options

**Fix the wizard instead.** The existing PEM prompt already accepts a file path, but reads it inside the throwaway `node:22-slim` container, which mounts only the repo directory. Mounting `$HOME` read-only would fix the transcription pain in two lines. Rejected because it leaves manual App creation in place, which is the larger half of the problem.

**Serve the Manifest Flow from `setup.sh`.** `config.js` could run an ephemeral localhost HTTP server for the redirect, requiring no change to web-manager at all. Rejected for the SSH port-forwarding friction described above. This is the closest rejected alternative and the one most likely to be re-proposed.

**Make the auth module reconfigurable at runtime.** better-auth is constructed at module import from `process.env`, so config arriving after startup needs a memoised accessor with invalidation. Rejected: it would put mutable configuration inside the module that governs who may sign in, and would force a second static export to keep `@better-auth/cli` working. Instead the bootstrap writes its file and exits, and `restart: unless-stopped` restarts the process with the new values. Reconfiguration is a once-or-twice-per-deployment event, and it happens precisely when a restart is cheapest: no signed-in users, no open SSE streams, no attached terminals.

**Keep `.env` as a fallback source.** Rejected in favour of a single source. Two sources for the same five keys is a precedence rule that has to be explained forever, and it would leave `${GITHUB_APP_ID}` in the compose file documenting a path that no longer exists. The cost is that existing deployments must bootstrap once, via the "I already have an App" path.

## Consequences

- These secrets move from a `0600` `.env` on the host into the persisted `cc-remote-db` volume. That volume is already a credential store: better-auth keeps every user's GitHub access token there in cleartext. This does not open a new class of exposure, but it does raise what a backup of that volume is worth. In exchange, `.env` stops holding the App private key.
- Startup validation must admit an unconfigured deployment as legal rather than failing on missing GitHub configuration. The bootstrap must validate a candidate configuration in memory before persisting it, or an invalid write leaves the container crash-looping with no UI left to repair it.
- The sign-in allow-list is seeded from the App owner returned by the manifest conversion, so the fail-closed rule that an empty allow-list is a startup error stays intact and the allow-list is never briefly empty. The seeded value is editable at bootstrap, because an App registered under an organisation reports the organisation as owner, and seeding that would lock everyone out.
- Adding a second allowed user, or rotating the App, is done by reopening bootstrap from the host. No authenticated settings screen is introduced. That is a deliberate scope boundary, not an oversight.
