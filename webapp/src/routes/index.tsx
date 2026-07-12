import { createFileRoute, redirect } from "@tanstack/react-router";

// Sessions is the landing page (#16); the auth guard on the /_app layout
// bounces unauthenticated users on to /login.
export const Route = createFileRoute("/")({
  beforeLoad: () => {
    throw redirect({ to: "/sessions" });
  },
});
