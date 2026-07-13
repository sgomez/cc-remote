import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

const SECTION = /^\/(sessions|accounts)(?:\/|$)/;
const reduceMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function getRouter() {
  return createRouter({
    routeTree,
    // Every navigation runs through the View Transitions API
    // (document.startViewTransition) for list→detail morphs (#16). We pass a
    // typed transition so CSS can distinguish list↔detail "morph" from
    // forward/backward stack moves via :active-view-transition-type. The router
    // feature-detects that support and falls back to a plain cross-fade;
    // returning false skips the transition entirely (same-path / reduced motion).
    // Baseline across Chrome/Safari/Firefox (Firefox 144+; typed transitions
    // Firefox 147+).
    defaultViewTransition: {
      types: ({ fromLocation, toLocation, pathChanged }) => {
        if (!pathChanged || reduceMotion()) return false;
        const from = fromLocation?.pathname.match(SECTION)?.[1];
        const to = toLocation.pathname.match(SECTION)?.[1];
        if (from && from === to) return ["morph"]; // list↔detail: named morphs carry it
        const fromIdx = fromLocation?.state.__TSR_index ?? 0;
        const toIdx = toLocation.state.__TSR_index ?? 0;
        return [toIdx < fromIdx ? "backward" : "forward"];
      },
    },
    scrollRestoration: true,
    defaultErrorComponent: () => <div style={{ padding: 24 }}>Internal Server Error</div>,
    defaultNotFoundComponent: () => <div style={{ padding: 24 }}>Not Found</div>,
  });
}
