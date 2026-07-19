import { createFileRoute, redirect } from "@tanstack/react-router";
import { fetchDeploymentState } from "~/server/bootstrap";

// Sessions is the landing page when the deployment is configured.
// While unconfigured, redirect to /bootstrap so the operator can set up
// the GitHub identity that makes sign-in possible.
export const Route = createFileRoute("/")({
  beforeLoad: async () => {
    const { configured } = await fetchDeploymentState();
    if (!configured) throw redirect({ to: "/bootstrap" });
    throw redirect({ to: "/sessions" });
  },
});
