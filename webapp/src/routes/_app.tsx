// Authenticated app layout (#16): the pathless `/_app` route that wraps every
// in-app screen (sessions, accounts). Its `beforeLoad` is the auth gate — an
// unauthenticated visitor is redirected to /login before any child loader runs
// (API/SSE routes enforce 401 independently). It renders the left-sidebar shell
// (own view-transition-name so it never flickers) with the current user and a
// sign-out control; children render in the <Outlet/>.
//
// Below 720px the sidebar is an off-canvas drawer. While it is open the rest of
// the shell is `inert`, which is what makes it genuinely modal: inert removes a
// subtree from the tab order AND from the accessibility tree, so a keyboard or
// screen-reader user cannot end up driving the page hidden behind the drawer.
// That is containment by construction — no key-by-key focus trap to keep
// correct. It is also why the drawer MUST close when the viewport grows past the
// breakpoint (see the matchMedia effect): on desktop the sidebar is a static
// column, and a stuck `menuOpen` would leave the whole page inert.

import { createFileRoute, Link, Outlet, redirect, useRouter } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
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
  const burgerRef = useRef<HTMLButtonElement>(null);
  const navRef = useRef<HTMLElement>(null);

  // While the drawer is open: Escape closes it (the overlay handles
  // click-outside), focus moves into it, and on close focus returns to the
  // burger that opened it — so a keyboard user never loses their place.
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    navRef.current?.querySelector<HTMLElement>("a, button")?.focus();
    return () => {
      window.removeEventListener("keydown", onKey);
      burgerRef.current?.focus();
    };
  }, [menuOpen]);

  // Growing past the breakpoint turns the drawer back into a static column, so
  // drop `menuOpen` — otherwise the shell would stay inert on desktop, with no
  // burger left on screen to close it.
  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 721px)");
    const onChange = () => {
      if (desktop.matches) setMenuOpen(false);
    };
    onChange();
    desktop.addEventListener("change", onChange);
    return () => desktop.removeEventListener("change", onChange);
  }, []);

  const doSignOut = async () => {
    await signOut();
    router.navigate({ to: "/login" });
  };

  return (
    <FeedbackProvider>
      <div className="shell">
        {/* Mobile-only top bar; the burger opens the sidebar as a drawer. */}
        <header className="topbar" inert={menuOpen}>
          <button
            ref={burgerRef}
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

        <nav ref={navRef} id="app-nav" className={`sidebar${menuOpen ? " open" : ""}`}>
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
          <Link
            to="/repositories"
            className="nav-link"
            activeProps={{ className: "nav-link active" }}
            onClick={closeMenu}
          >
            <span>repositories</span>
          </Link>
          <div className="sidebar-user">
            <span className="card-meta">{user?.name ?? user?.email ?? "signed in"}</span>
            <button type="button" className="btn small" onClick={doSignOut}>
              Sign out
            </button>
          </div>
        </nav>
        <main className="main" inert={menuOpen}>
          <Outlet />
        </main>
      </div>
    </FeedbackProvider>
  );
}
