// GitHub App Manifest Flow callback (#56). GitHub redirects here after the
// operator creates a new App through the App Manifest Flow, carrying a
// temporary code in the query string.
//
// This route exchanges the code for the App's credentials (App ID, slug,
// OAuth client ID/secret, private key) and stores them in a temp file on the
// data volume. The private key never reaches the browser. On success the
// operator is redirected to /bootstrap with a manifest key; the bootstrap
// page loads the pre-filled fields from the temp file.
//
// On error the operator is redirected back to /bootstrap with a clear error
// message. The one-hour expiry of GitHub's manifest flow is specifically
// caught and explained.
//
// No auth guard — this is part of the bootstrap flow that sits outside
// sign-in, gated by the Claim Token on the bootstrap page itself.

import { createFileRoute, redirect } from "@tanstack/react-router";
import { exchangeManifestCode } from "~/server/bootstrap";

export const Route = createFileRoute("/bootstrap/manifest/callback")({
  loader: async ({ location }) => {
    const search = location.search as Record<string, unknown>;
    const code = search?.code as string | undefined;

    if (!code) {
      throw redirect({ to: "/bootstrap" });
    }

    const result = await exchangeManifestCode({ data: { code } });

    if (!result.ok) {
      // Encode the error message for the URL — replace special chars so the
      // target page can read it from search params.
      throw redirect({
        to: "/bootstrap",
        search: { manifestError: result.errors[0] },
      });
    }

    // Redirect to bootstrap with only the manifest key. The bootstrap page
    // calls loadManifestResult to retrieve the pre-filled fields from the
    // temp file, keeping the private key on the server.
    throw redirect({
      to: "/bootstrap",
      search: { manifest: result.manifestKey },
    });
  },
  component: () => null,
});
