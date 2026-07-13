import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { navigationTypes } from "./ui/view-models/transitions";

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function getRouter() {
  return createRouter({
    routeTree,
    // Every navigation runs through the View Transitions API. The types come out
    // of `navigationTypes` (pure, tested) and land as
    // `:active-view-transition-type(...)` selectors in app.css: `morph` for
    // list↔detail, `forward`/`backward` for a lateral move across the sidebar.
    //
    // The router only passes types when the engine reports
    // `CSS.supports("selector(:active-view-transition-type(a))")`, and otherwise
    // falls back to a plain cross-fade — so these are a safe enhancement.
    defaultViewTransition: {
      types: ({ fromLocation, toLocation, pathChanged }) =>
        navigationTypes({
          fromPath: fromLocation?.pathname,
          toPath: toLocation.pathname,
          pathChanged,
          reducedMotion: prefersReducedMotion(),
        }),
    },
    scrollRestoration: true,
    defaultErrorComponent: () => <div style={{ padding: 24 }}>Internal Server Error</div>,
    defaultNotFoundComponent: () => <div style={{ padding: 24 }}>Not Found</div>,
  });
}
