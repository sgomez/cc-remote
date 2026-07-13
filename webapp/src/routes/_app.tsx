// Authenticated app layout (#16): the pathless `/_app` route that wraps every
// in-app screen (sessions, accounts). Its `beforeLoad` is the auth gate — an
// unauthenticated visitor is redirected to /login before any child loader runs
// (API/SSE routes enforce 401 independently). It renders the left-sidebar shell
// (own view-transition-name so it never flickers) with the current user and a
// sign-out control; children render in the <Outlet/>.

import { createFileRoute, Link, Outlet, redirect, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { signOut } from "~/adapters/auth/client";
import { fetchSession } from "~/server/auth";
import { FeedbackProvider } from "~/ui/components/feedback";

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
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = () => setMenuOpen(false);

  // Escape closes the open drawer (the overlay handles click-outside).
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  const doSignOut = async () => {
    await signOut();
    router.navigate({ to: "/login" });
  };

  return (
    <FeedbackProvider>
      <div className="shell">
        {/* Mobile-only top bar; the burger opens the sidebar as a drawer. */}
        <header className="topbar">
          <button
            type="button"
            className="burger"
            aria-label="Open menu"
            aria-expanded={menuOpen}
            aria-controls="app-nav"
            onClick={() => setMenuOpen(true)}
          >
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
          <div className="brand">
            cc-remote<span className="tld">:~</span>
          </div>
        </header>

        {menuOpen && (
          <button
            type="button"
            className="sidebar-overlay"
            aria-label="Close menu"
            onClick={closeMenu}
          />
        )}

        <nav id="app-nav" className={`sidebar${menuOpen ? " open" : ""}`}>
          <div className="brand">
            cc-remote<span className="tld">:~</span>
            <span className="blink">▊</span>
          </div>
          <Link
            to="/sessions"
            className="nav-link"
            activeProps={{ className: "nav-link active" }}
            onClick={closeMenu}
          >
            <span>sessions</span>
          </Link>
          <Link
            to="/accounts"
            className="nav-link"
            activeProps={{ className: "nav-link active" }}
            onClick={closeMenu}
          >
            <span>accounts</span>
          </Link>
          <div className="sidebar-user">
            <span className="card-meta">{user?.name ?? user?.email ?? "signed in"}</span>
            <button type="button" className="btn small" onClick={doSignOut}>
              Sign out
            </button>
          </div>
        </nav>
        <main className="main">
          <Outlet />
        </main>
      </div>
    </FeedbackProvider>
  );
}
