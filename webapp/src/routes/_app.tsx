// Authenticated app layout (#16): the pathless `/_app` route that wraps every
// in-app screen (sessions, accounts). Its `beforeLoad` is the auth gate — an
// unauthenticated visitor is redirected to /login before any child loader runs
// (API/SSE routes enforce 401 independently). It renders the left-sidebar shell
// (own view-transition-name so it never flickers) with the current user and a
// sign-out control; children render in the <Outlet/>.

import { createFileRoute, Link, Outlet, redirect, useRouter } from "@tanstack/react-router";
import { signOut } from "~/adapters/auth/client";
import { fetchSession } from "~/server/auth";

export const Route = createFileRoute("/_app")({
  beforeLoad: async () => {
    const session = await fetchSession();
    if (!session) throw redirect({ to: "/login" });
    return { user: session.user };
  },
  loader: ({ context }) => ({ user: context.user }),
  component: AppLayout,
});

function AppLayout() {
  const { user } = Route.useLoaderData();
  const router = useRouter();

  const doSignOut = async () => {
    await signOut();
    router.navigate({ to: "/login" });
  };

  return (
    <div className="shell">
      <nav className="sidebar">
        <div className="brand">
          cc-remote<span className="tld">:~</span>
          <span className="blink">▊</span>
        </div>
        <Link to="/sessions" className="nav-link" activeProps={{ className: "nav-link active" }}>
          <span>sessions</span>
        </Link>
        <Link to="/accounts" className="nav-link" activeProps={{ className: "nav-link active" }}>
          <span>accounts</span>
        </Link>
        <div className="sidebar-footer">
          Docker is the source of truth for sessions; accounts live in SQLite.
        </div>
        <div className="sidebar-user">
          <span className="card-meta">{user?.name ?? user?.email ?? "signed in"}</span>
          <button type="button" className="btn small" onClick={doSignOut}>
            sign out
          </button>
        </div>
      </nav>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
