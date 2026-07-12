import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
  return createRouter({
    routeTree,
    // Every navigation runs through the View Transitions API
    // (document.startViewTransition) for list→detail morphs (#16). Firefox,
    // which lacks the API, degrades to instant swaps.
    defaultViewTransition: true,
    scrollRestoration: true,
    defaultErrorComponent: () => <div style={{ padding: 24 }}>Internal Server Error</div>,
    defaultNotFoundComponent: () => <div style={{ padding: 24 }}>Not Found</div>,
  });
}
