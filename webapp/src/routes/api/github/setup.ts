// GitHub App setup callback (#34). GitHub redirects here after the owner
// completes the installation flow on github.com, carrying `installation_id`
// and `setup_action` query parameters. The handler redirects to the
// repositories page, which re-fetches from GitHub and shows the updated list.
// No auth guard — GitHub's redirect lands in the browser that was just on
// github.com, and the session cookie may have expired. The repositories page
// itself is auth-guarded and handles the sign-in flow.

import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/api/github/setup")({
  loader: () => {
    throw redirect({ to: "/repositories" });
  },
});
